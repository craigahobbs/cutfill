// auto.js - the "auto" command - plan a road by procedure: the tools do every step of the plan, in order, and a model
// (if there is one) is asked only the questions that the tools can't answer - what the plan config's notes ask for, and
// where the places they name are on the map. Each question is small, and its answer is a JSON object that's checked -
// a model doesn't run the plan. The places it finds are the plan config's marks (its exclusion areas and its places to
// pass through), so a plan that's made again doesn't look for them again - and a mark can be corrected.

import {addDraws, drawCrossings} from './draws.js';
import {corridorNames, routeCommands} from './routeCli.js';
import {describeCommand, keepCommand} from './options.js';
import {layoutPoint, siteLayout} from './terrain.js';
import {planCriteria, planTopo} from '../../viewer/lib/model.js';
import {planMapBase64, planPlot} from './plot.js';
import {readPlan, writePlan} from './planFile.js';
import {Buffer} from 'node:buffer';
import {draftLines} from './draft.js';
import {existingMask} from './structures.js';
import {parseArgs} from 'node:util';
import {planLatLong} from '../../viewer/lib/geo.js';
import {polylineStations} from './route.js';
import {round} from '../../viewer/lib/format.js';
import {siteCommand} from './siteCommand.js';


// The steps of a plan - their keys (the status function's), and what they do. The notes are read only with a model.
export const autoSteps = [
    {'key': 'site', 'text': 'Build the site - its lidar terrain, streams, roads, and map, from the USGS', 'isModel': false},
    {'key': 'notes', 'text': 'Read the notes - the model is asked what they ask for, and where their places are', 'isModel': true},
    {'key': 'options', 'text': 'Engineer the road options', 'isModel': false},
    {'key': 'describe', 'text': 'Describe the plan', 'isModel': false}
];


// The "auto" command's usage text lines
export const autoUsage = [
    'usage: plan auto <site.json> <plan.json> [--model MODEL] [--fresh] [--fetch] [options]',
    '',
    '  Plan a road by procedure: create the plan\'s site, engineer its standard options (and add the unmapped draws they',
    '  cross, as streams), keep the best options, and set the descriptions - their facts. If the standard options are at',
    '  the site\'s edge, or there\'s no road within the grade limit, the site\'s margin is enlarged (at most twice). With a',
    '  model (an Ollama model - a local model, or one of Ollama\'s cloud models), the model is asked what the site\'s notes',
    '  ask for - the road\'s width and surface, a maximum grade, bridges, the existing roads to rule out, and the places to',
    '  avoid or to pass through - and where each place is on the site\'s map, unless the notes give its coordinates. The',
    '  places are the site\'s marks - its exclusion areas and places to pass through - so the site file is updated: a',
    '  mark that was found isn\'t looked for again, and a mark for a place that the notes no longer name is removed.',
    '',
    'options:',
    '  --model MODEL          the Ollama model to ask (default is none - the site\'s notes aren\'t read) - the Roadie',
    '                         application\'s (the command line doesn\'t ask a model)',
    '  --fresh                ask the model again - don\'t use its saved answer, and look for the notes\' places again',
    '  --fetch                fetch the site\'s data from the USGS again - an existing plan\'s, if it\'s the site\'s, is kept',
    '  -w, --width WIDTH      the road width (default is the notes\', or 14 feet / 4.3 meters)',
    '  -s, --surface SURFACE  the road surface - native, gravel, asphalt, or concrete (default is the notes\', or gravel)'
];


// The command's options
const commandOptions = {
    'model': {'type': 'string'},
    'fresh': {'type': 'boolean', 'default': false},
    'fetch': {'type': 'boolean', 'default': false},
    'width': {'type': 'string', 'short': 'w'},
    'surface': {'type': 'string', 'short': 's'}
};


// The road surfaces
const surfaces = ['native', 'gravel', 'asphalt', 'concrete'];


// The directives' limits - a width, a maximum grade, a minimum radius, and a bridge's fill depth that the notes can ask
// for (in feet and meters), and the most places of a kind
const limits = {
    'feet': {'width': [8, 40], 'minRadius': [25, 500], 'bridgeFill': [3, 100]},
    'meters': {'width': [2.4, 12], 'minRadius': [8, 150], 'bridgeFill': [1, 30]}
};
const gradeLimits = [3, 25];
const placeLimit = 6;


// The most of the site that a place to avoid may cover, and the most options of a plan
const placeArea = 0.25;
const optionLimit = 4;


// The most times that a site is enlarged, and how much its margin is enlarged
const enlargeLimit = 2;
const enlargeFactor = 1.5;


// The notes question's answer schema
const placeSchema = {
    'type': 'array',
    'items': {
        'type': 'object',
        'properties': {
            'name': {'type': 'string'},
            'where': {'type': 'string'},
            'points': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'properties': {'latitude': {'type': 'number'}, 'longitude': {'type': 'number'}},
                    'required': ['latitude', 'longitude']
                }
            }
        },
        'required': ['name', 'where', 'points']
    }
};
const notesSchema = {
    'type': 'object',
    'properties': {
        'purpose': {'type': 'string'},
        'width': {'type': ['number', 'null']},
        'surface': {'type': ['string', 'null']},
        'maxGrade': {'type': ['number', 'null']},
        'minRadius': {'type': ['number', 'null']},
        'bridgeFill': {'type': ['number', 'null']},
        'ruleOutRoads': {'type': 'array', 'items': {'type': 'string'}},
        'avoid': placeSchema,
        'passThrough': placeSchema,
        'unhandled': {'type': 'array', 'items': {'type': 'string'}}
    },
    'required': [
        'purpose', 'width', 'surface', 'maxGrade', 'minRadius', 'bridgeFill', 'ruleOutRoads', 'avoid', 'passThrough', 'unhandled'
    ]
};


// The place questions' answer schemas - an area's rectangle, and a point
const areaSchema = {
    'type': 'object',
    'properties': {
        'found': {'type': 'boolean'}, 'west': {'type': 'number'}, 'south': {'type': 'number'}, 'east': {'type': 'number'},
        'north': {'type': 'number'}, 'why': {'type': 'string'}
    },
    'required': ['found', 'west', 'south', 'east', 'north', 'why']
};
const pointSchema = {
    'type': 'object',
    'properties': {'found': {'type': 'boolean'}, 'x': {'type': 'number'}, 'y': {'type': 'number'}, 'why': {'type': 'string'}},
    'required': ['found', 'x', 'y', 'why']
};


// The "auto" command - "io" is the tools' input and output functions. Its "ask" function asks a model a question
// (ollamaAsk's question object) and returns its answer. Returns the command's exit code and its output text lines,
// or null if its arguments are invalid.
export async function autoCommand(args, io) {
    let parsed;
    try {
        parsed = parseArgs({args, 'options': commandOptions, 'allowPositionals': true});
    } catch {
        return null;
    }
    const {values, positionals} = parsed;
    const width = 'width' in values ? Number(values.width) : null;
    if (positionals.length !== 2 || values.model === '' || (width !== null && !(width > 0)) ||
        ('surface' in values && !surfaces.includes(values.surface))) {
        return null;
    }
    const [sitePath, planPath] = positionals;
    const model = values.model ?? null;
    const work = `${planPath.replace(/\.json$/i, '')}.work`;
    const lines = [];
    const fail = (errorLines) => ({'code': 1, 'lines': [...lines, ...errorLines]});
    const failure = (error) => fail(error.lines ?? [`error: ${error.message}`]);

    // The plan's report, and its status - what it's doing. The status is shown as the plan is made, if the input and
    // output functions have a "status" function (of the status' text, and its step's key - autoSteps).
    const report = (...reportLines) => {
        lines.push(...reportLines);
    };
    const status = async (step, text) => {
        await io.status?.(text, step);
    };

    // Create the plan's site. The plan config is the plan's site model - the run updates its file, when its marks or its
    // margin change, and creates the site again (its site data is kept, if its grid is the same). The notes' design
    // criteria are the plan's, but for the plan config's own.
    await status('site', 'Creating the site - its terrain, streams, roads, and map are the USGS\'s');
    const site = await siteCommand([sitePath, planPath, ...(values.fetch ? ['--fetch'] : [])], io);
    if (site.code !== 0) {
        return site;
    }
    report(...site.lines.slice(0, -1));
    const loadPlan = () => readPlan(io, planPath).plan;
    let plan = loadPlan();
    let topo = planTopo(plan);
    let config = plan.site;
    const {units} = plan;
    const notesCriteria = {};
    const updateConfig = (oldConfig, members) => {
        const updated = {...oldConfig, ...members};
        for (const [member, value] of Object.entries(members)) {
            if (value === null) {
                delete updated[member];
            }
        }
        io.writeFile(sitePath, `${JSON.stringify(updated, null, 4)}\n`);
        return updated;
    };
    const createSite = async () => {
        const created = await siteCommand([sitePath, planPath], io);
        if (created.code !== 0) {
            throw Object.assign(new Error('The site wasn\'t created'), {'lines': created.lines});
        }
        if (Object.keys(notesCriteria).length > 0) {
            const sited = loadPlan();
            sited.criteria = {...sited.criteria, ...notesCriteria};
            writePlan(io, planPath, sited);
        }
        return created;
    };

    // The model's saved answers - they're used again: the notes' answer while the notes and the model are the same, and a
    // place's answer while the site's grid is the same, too (a place that's found is the plan config's mark, though)
    const notes = config.notes ?? [];
    const decisionsPath = `${work}/decisions.json`;
    const grid = JSON.stringify([plan.georeference, topo.width, topo.height]);
    const answers = new Map();
    if (!values.fresh) {
        try {
            const saved = JSON.parse(io.readFile(decisionsPath));
            if (saved.model === model && JSON.stringify(saved.notes) === JSON.stringify(notes)) {
                for (const [key, answer] of Object.entries(saved.answers)) {
                    if (key === 'notes' || saved.grid === grid) {
                        answers.set(key, answer);
                    }
                }
            }
        } catch {
            // There are no saved answers
        }
    }
    const ask = async (key, schema, questionFn) => {
        if (!answers.has(key)) {
            const {question, images = []} = await questionFn();
            answers.set(key, await io.ask({model, question, images, schema}));
            io.writeFile(decisionsPath, `${JSON.stringify({model, notes, grid, 'answers': Object.fromEntries(answers)}, null, 4)}\n`);
        }
        return answers.get(key);
    };

    // The notes' directives
    let directives = {
        'purpose': null, 'width': null, 'surface': null, 'maxGrade': null, 'minRadius': null, 'bridgeFill': null, 'ruleOutRoads': [],
        'avoid': [], 'passThrough': [], 'unhandled': []
    };
    const limitations = [];
    const ruledOut = [];
    const roadNames = [...new Set(topo.features.filter(({type, name = null}) => type === 'road' && name !== null).map(({name}) => name))];
    try {
        if (model === null) {
            if (notes.length > 0) {
                report('Notes: not read - there\'s no model (--model)');
                limitations.push('The site\'s notes weren\'t read - the plan is the tools\' alone.');
            }
        } else if (notes.length > 0) {
            await status('notes', `Asking the model "${model}" what the site's notes ask for`);
            const question = notesQuestion(plan, notes, roadNames);
            const answer = await ask('notes', notesSchema, () => ({question}));
            directives = notesDirectives(answer, units, notes);

            // The design criteria - the plan config's own are the plan's
            for (const member of ['maxGrade', 'minRadius']) {
                if (directives[member] !== null && !(member in (config.criteria ?? {}))) {
                    notesCriteria[member] = directives[member];
                }
            }
            if (Object.keys(notesCriteria).length > 0) {
                plan.criteria = {...plan.criteria, ...notesCriteria};
                writePlan(io, planPath, plan);
                report(`Notes: ${Object.entries(notesCriteria).map(([member, value]) => `${criteriaNames[member]} ${value}`).join(', ')}`);
            }
            if (directives.width !== null || directives.surface !== null) {
                report(`Notes: the road is ${[
                    ...(directives.width !== null ? [`${directives.width} ${units} wide`] : []),
                    ...(directives.surface !== null ? [directives.surface] : [])
                ].join(', ')}`);
            }
            if (directives.bridgeFill !== null) {
                report(`Notes: a bridge replaces a stream crossing's fill deeper than ${directives.bridgeFill} ${units}`);
            }

            // The existing roads the notes rule out - the options don't follow them (they're the plan's roads still)
            for (const roadName of directives.ruleOutRoads) {
                const match = roadNames.find((name) => name.toLowerCase() === roadName.toLowerCase()) ?? null;
                if (match === null) {
                    directives.unhandled.push(`rule out the road "${roadName}" (the site has no road of that name)`);
                } else {
                    ruledOut.push(match);
                    report(`Notes: the existing road "${match}" is ruled out - the options don't follow it`);
                }
            }

            // The notes' places - the plan config's marks
            const marks = await findPlaces(io, ask, status, {
                work, planPath, plan, topo, config, model, directives, 'isFresh': values.fresh
            });
            report(...marks.lines);
            if (marks.members !== null) {
                config = updateConfig(config, marks.members);
                await createSite();
            }
        }
    } catch (error) {
        return failure(error);
    }

    // Engineer the options - the standard options, and an option through each place to pass through - and add the
    // unmapped draws they cross, as streams, until they cross none. If the site may be too small for the standard
    // options, its margin is enlarged and its site is created again.
    const designArgs = [
        ...((width ?? directives.width) !== null ? ['--width', `${width ?? directives.width}`] : []),
        ...((values.surface ?? directives.surface) !== null ? ['--surface', values.surface ?? directives.surface] : []),
        ...(directives.bridgeFill !== null ? ['--bridge-fill', `${directives.bridgeFill}`] : []),
        ...ruledOut.flatMap((name) => ['--rule-out', name])
    ];
    let options;
    let names;
    let placeLines;
    let placeUnhandled;
    const draws = [];
    for (let enlargements = 0; ;) {
        await status('options', 'Engineering the standard options');
        options = routeCommands.options([planPath, ...designArgs], io);
        const isGradeFailure = options.code !== 0 && options.lines.at(-1).startsWith('error: no road within the ');
        if ((isGradeFailure || (options.code === 0 && options.atEdge)) && enlargements < enlargeLimit) {
            enlargements += 1;
            const margin = Math.round(siteLayout(config).margin * enlargeFactor);
            report(
                `Site: ${isGradeFailure ? 'there\'s no road within the grade limit' : 'the standard options are at the site\'s edge'} - ` +
                    `the site's margin is enlarged to ${margin} ${units}`
            );
            await status('site', 'Creating the larger site - its terrain, streams, roads, and map are the USGS\'s');
            config = updateConfig(config, {margin});
            try {
                report(...(await createSite()).lines.slice(0, -1));
            } catch (error) {
                return failure(error);
            }
            continue;
        }
        if (options.code !== 0) {
            return fail([
                ...options.lines,
                ...(isGradeFailure ? [
                    `error: The site was enlarged ${enlargements} times - the road needs a higher maximum grade (the plan config's ` +
                        'design criteria)'
                ] : [])
            ]);
        }
        plan = loadPlan();
        topo = planTopo(plan);
        ({names} = options);

        // The options through the places to pass through
        placeLines = [];
        placeUnhandled = [];
        const layout = siteLayout(config);
        for (const [ixPlace, place] of (config.passThrough ?? []).entries()) {
            const placeName = place.name ?? `Place ${ixPlace + 1}`;
            const [x, y] = layoutPoint(layout, place.latitude, place.longitude).map((value) => Math.round(value));
            const name = `Via ${placeName}`;
            if (x < 0 || y < 0 || x > topo.width || y > topo.height) {
                placeUnhandled.push(`pass through "${placeName}" - it isn't within the site`);
                continue;
            }
            await status('options', `Engineering the option "${name}"`);
            const routed = routeCommands.route([planPath, '-n', name, '-v', `${x},${y}`, ...designArgs], io);
            if (routed.code === 0) {
                names.push(name);
                placeLines.push(...routed.lines.filter((line) => !/^Wrote /.test(line)), `Notes: "${name}" passes through "${placeName}"`);
            } else {
                placeUnhandled.push(`pass through "${placeName}" - ${routed.lines.at(-1).replace(/^error: /, '')}`);
            }
        }

        // The unmapped draws the options cross - each is added as a stream, and the options are engineered again
        plan = loadPlan();
        topo = planTopo(plan);
        const crossed = crossedDraws(plan, topo, names).filter((number) => !draws.includes(number));
        if (crossed.length === 0) {
            break;
        }
        addDraws(io, planPath, crossed);
        draws.push(...crossed);
    }
    if (draws.length > 0) {
        report(`Draws: added the unmapped draws the options crossed, as streams - ${draws.map((number) => `Draw ${number}`).join(', ')}`);
    }
    report(...options.lines.filter((line) => !/^Option \d+: |^Wrote /.test(line)), ...placeLines);
    directives.unhandled.push(...placeUnhandled);

    // Keep the plan's options - those it engineered, the best first. If there are too many, the other corridor is the
    // first that isn't kept.
    await status('describe', 'Writing the descriptions');
    let kept = keepCommand([planPath, ...names], io);
    if (names.length > optionLimit) {
        const ordered = loadPlan().options.map(({name}) => name);
        const isCorridor = (name) => corridorNames.includes(name);
        const keptNames = [...ordered.filter((name) => !isCorridor(name)), ...ordered.filter(isCorridor)];
        kept = keepCommand([planPath, ...keptNames.slice(0, optionLimit)], io);
    }
    report(...kept.lines.filter((line) => /^Option \d+: /.test(line)));

    // The descriptions - the plan's facts, and what the plan did with its notes
    plan = loadPlan();
    for (const text of directives.unhandled) {
        report(`Notes: NOT acted on - ${text}`);
    }
    if (directives.unhandled.length > 0) {
        limitations.push(`These of the site's notes weren't acted on: ${directives.unhandled.join('; ')}.`);
    }
    const descriptionsPath = `${work}/descriptions.md`;
    io.writeFile(descriptionsPath, `${draftLines(plan, {
        'purpose': directives.purpose,
        'featureNotes': [...markNotes(config, directives), ...(draws.length > 0 ? [drawsNote] : [])],
        'optionNotes': options.corridorNote !== null ? [options.corridorNote] : [],
        limitations
    }).join('\n')}\n`);
    describeCommand([planPath, descriptionsPath], io);
    report(`Wrote ${planPath} - its descriptions are "${descriptionsPath}"`);
    return {'code': 0, lines};
}


// The descriptions' note of the draws that were added
const drawsNote = 'The draws are the terrain\'s unmapped draws that the options crossed - each crossing has a culvert.';


// The criteria's names in the report
const criteriaNames = {'maxGrade': 'maximum grade', 'minRadius': 'minimum radius'};


// Get the numbers of the unmapped draws that a plan's options of names cross
function crossedDraws(plan, topo, names) {
    const numbers = [];
    for (const option of plan.options.filter(({name}) => names.includes(name))) {
        const x = option.alignment.map((point) => point.x);
        const y = option.alignment.map((point) => point.y);
        const stations = polylineStations(x, y);
        const existingRoads = option.structures.filter(({type}) => type === 'existingRoad').map(
            ({station, endStation}) => [station, endStation]
        );
        for (const {number} of drawCrossings(topo, plan.units, x, y, stations, existingMask(stations, existingRoads))) {
            if (!numbers.includes(number)) {
                numbers.push(number);
            }
        }
    }
    return numbers;
}


// Find the notes' places - the plan config's marks. A place to avoid is an exclusion area, and a place to pass through is
// a point: the notes' coordinates, or where the model finds it on the site's map. A place that has a mark - one that was
// found for it, or the author's mark of its name - isn't found again, and a mark that was found for a place that the
// notes don't name any more is removed. If "isFresh", the marks that were found are found again. Returns the report's
// "lines", and the plan config's members that changed ("members" - its "exclusions" and "passThrough", or null if
// they're the same). A place that isn't found is unhandled.
async function findPlaces(io, ask, status, {work, planPath, plan, topo, config, model, directives, isFresh}) {
    const lines = [];
    const layout = siteLayout(config);
    const latLong = (x, y) => {
        const [latitude, longitude] = planLatLong(plan, x, y);
        return {'latitude': round(latitude, 7), 'longitude': round(longitude, 7)};
    };
    const isInside = ({latitude, longitude}) => {
        const [x, y] = layoutPoint(layout, latitude, longitude);
        return x >= 0 && y >= 0 && x <= topo.width && y <= topo.height;
    };
    const isCurrent = (places) => ({found = null}) => found === null || (!isFresh && places.some(({name}) => name === found.place));
    const isMark = (place) => ({name = null, found = null}) => (found?.place ?? name) === place.name;
    const exclusions = (config.exclusions ?? []).filter(isCurrent(directives.avoid));
    const passThrough = (config.passThrough ?? []).filter(isCurrent(directives.passThrough));
    const unhandled = (kind, place, problem) => {
        directives.unhandled.push(`${kind} "${place.name}"${place.where !== '' ? ` (${place.where})` : ''} - ${problem}`);
    };

    // The places to avoid - each is an exclusion area
    for (const place of directives.avoid) {
        if (exclusions.some(isMark(place))) {
            lines.push(`Notes: avoid "${place.name}" - the plan config's exclusion area`);
        } else if (place.points !== null) {
            if (place.points.length < 3) {
                unhandled('avoid', place, `the notes give ${place.points.length} of its corners (an area has three or more)`);
            } else if (!place.points.some(isInside)) {
                unhandled('avoid', place, 'its corners aren\'t within the site');
            } else {
                exclusions.push({'name': place.name, 'points': place.points, 'found': {'place': place.name}});
                lines.push(`Notes: avoid "${place.name}" - an exclusion area of the notes' ${place.points.length} corners`);
            }
        } else {
            await status('notes', `Asking the model "${model}" where "${place.name}" is on the map`);
            const area = await locateArea(io, ask, work, planPath, plan, topo, place);
            if ('problem' in area) {
                unhandled('avoid', place, area.problem);
            } else {
                const [west, south, east, north] = area.box;
                const corners = [[west, south], [east, south], [east, north], [west, north]].map(([x, y]) => latLong(x, y));
                exclusions.push({'name': place.name, 'points': corners, 'found': {'place': place.name, model, 'why': area.why}});
                lines.push(`Notes: avoid "${place.name}" - an exclusion area from x ${west} to ${east}, y ${south} to ${north}`);
            }
        }
    }

    // The places to pass through - each is a point that an option passes through
    for (const place of directives.passThrough) {
        if (passThrough.some(isMark(place))) {
            lines.push(`Notes: pass through "${place.name}" - the plan config's place to pass through`);
        } else if (place.points !== null) {
            if (place.points.length !== 1) {
                unhandled('pass through', place, `the notes give ${place.points.length} points for it (a place is one point)`);
            } else if (!isInside(place.points[0])) {
                unhandled('pass through', place, 'it isn\'t within the site');
            } else {
                passThrough.push({'name': place.name, ...place.points[0], 'found': {'place': place.name}});
                lines.push(`Notes: pass through "${place.name}" - the notes' point`);
            }
        } else {
            await status('notes', `Asking the model "${model}" where "${place.name}" is on the map`);
            const point = await locatePoint(io, ask, work, planPath, plan, topo, place);
            if (point === null) {
                unhandled('pass through', place, 'the model didn\'t find it on the map');
            } else {
                const [x, y] = point.point;
                passThrough.push({'name': place.name, ...latLong(x, y), 'found': {'place': place.name, model, 'why': point.why}});
                lines.push(`Notes: pass through "${place.name}" - at x ${x}, y ${y}`);
            }
        }
    }

    // The plan config's members that changed
    const members = {
        'exclusions': exclusions.length > 0 ? exclusions : null,
        'passThrough': passThrough.length > 0 ? passThrough : null
    };
    const isSame = Object.entries(members).every(([member, value]) => JSON.stringify(value) === JSON.stringify(config[member] ?? null));
    return {lines, 'members': isSame ? null : members};
}


// Get the descriptions' notes of the plan config's marks that a plan found for the notes' places
function markNotes(config, directives) {
    const notes = [];
    const kinds = [['avoid', 'exclusions', directives.avoid], ['pass through', 'passThrough', directives.passThrough]];
    for (const [kind, member, places] of kinds) {
        for (const mark of config[member] ?? []) {
            const place = places.find(({name}) => name === mark.found?.place) ?? null;
            if (place !== null) {
                const {model = null, why = ''} = mark.found;
                notes.push(
                    `${mark.name}: the notes' place to ${kind}${place.where !== '' ? ` (${place.where})` : ''}. ` +
                    `${model !== null ? `The model "${model}" found it on the site's map${why !== '' ? ` - "${why}"` : '.'}` :
                        'Its coordinates are the notes\'.'} Verify it.`
                );
            }
        }
    }
    return notes;
}


// Create the notes question - what the site's notes ask for, as directives
function notesQuestion(plan, notes, roadNames) {
    const {units} = plan;
    return [
        `These are the planning notes of a road from "${plan.start.label}" to "${plan.end.label}" - the site is "${plan.title}":`,
        '',
        ...notes.map((note) => `- ${note}`),
        '',
        'Translate the notes into these members. Use only what the notes say - don\'t add anything of your own:',
        '',
        '- "purpose": one sentence that says what the road is and what it\'s for',
        `- "width": the road's width, in ${units}, if the notes give a number - else null`,
        '- "surface": the road\'s surface, if the notes say - "native", "gravel", "asphalt", or "concrete" - else null',
        '- "maxGrade": the road\'s maximum grade, in percent, if the notes give a number - else null',
        `- "minRadius": the road's minimum curve radius, in ${units}, if the notes give a number - else null`,
        `- "bridgeFill": the depth of a stream crossing's fill, in ${units}, that the notes say a bridge replaces, if they give ` +
            'a number - else null',
        `- "ruleOutRoads": the existing roads the notes say the road must not use - their names, of the site's roads` +
            `${roadNames.length > 0 ? ` (${roadNames.map((name) => `"${name}"`).join(', ')})` : ' (it has none)'}`,
        '- "avoid": the places the notes say the road must avoid, keep off, or stay out of - each one\'s short "name", "where" it ' +
            'is, in the notes\' words, and its "points" - the corners\' latitudes and longitudes that the notes give for it, as ' +
            'they give them (none, if they give none)',
        '- "passThrough": the places the notes say the road must pass through or go by - each one\'s "name", "where", and ' +
            '"points" (the latitude and longitude that the notes give for it, if any)',
        '- "unhandled": each other instruction of the notes that these members don\'t cover, in the notes\' words (not the road\'s ' +
            'description or purpose)'
    ].join('\n');
}


// Check the notes question's answer, and get its directives - what isn't valid is unhandled. A place's "points" are
// null if the notes give it no coordinates, or its coordinates ({latitude, longitude} objects) - each number of which is
// one of the notes' (as the notes give it, or its negative - "116.2 W" is a longitude of -116.2).
function notesDirectives(answer, units, notes) {
    const text = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
    const unhandled = (Array.isArray(answer.unhandled) ? answer.unhandled : []).map(text).filter((value) => value !== '');
    const within = (member, [least, most], name) => {
        const value = answer[member] ?? null;
        if (value !== null && !(typeof value === 'number' && value >= least && value <= most)) {
            unhandled.push(`${name} ${JSON.stringify(value)} (it isn't from ${least} to ${most})`);
            return null;
        }
        return value;
    };
    const notesNumbers = new Set((notes.join(' ').match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
    const isNotesNumber = (value, most) => typeof value === 'number' && Math.abs(value) <= most && notesNumbers.has(Math.abs(value));
    const places = (member, kind) => (Array.isArray(answer[member]) ? answer[member] : []).
        map((place) => {
            const name = text(place?.name).replace(/^[^A-Za-z0-9]+/, '');
            const where = text(place?.where);
            const points = Array.isArray(place?.points) && place.points.length > 0 ? place.points : null;
            if (points !== null && !points.every((point) => isNotesNumber(point?.latitude, 90) && isNotesNumber(point?.longitude, 180))) {
                unhandled.push(`${kind} "${name}" - the coordinates the model read for it aren't the notes'`);
                return {name, where, 'points': undefined};
            }
            return {name, where, 'points': points?.map(({latitude, longitude}) => ({latitude, longitude})) ?? null};
        }).
        filter(({name, points}) => name !== '' && points !== undefined).slice(0, placeLimit);
    const surface = text(answer.surface).toLowerCase();
    return {
        'purpose': text(answer.purpose) !== '' ? text(answer.purpose) : null,
        'width': within('width', limits[units].width, 'a width of'),
        'surface': surfaces.includes(surface) ? surface : null,
        'maxGrade': within('maxGrade', gradeLimits, 'a maximum grade of'),
        'minRadius': within('minRadius', limits[units].minRadius, 'a minimum radius of'),
        'bridgeFill': within('bridgeFill', limits[units].bridgeFill, 'a bridge for fill deeper than'),
        'ruleOutRoads': (Array.isArray(answer.ruleOutRoads) ? answer.ruleOutRoads : []).map(text).filter((name) => name !== ''),
        'avoid': places('avoid', 'avoid'),
        'passThrough': places('passThrough', 'pass through'),
        unhandled
    };
}



// Plot a plan for a question - its topographic map (or its terrain, if it has no map), all of it or a box of it,
// without its options: a plan that's made again asks of the plot it asked of before. The plot is written to the plan's
// work directory, to see what the model was asked. Returns its base64 text and the question's description of it. (The
// plot's image is awaited - a browser's is made later.)
async function questionPlot(io, work, planPath, plan, topo, name, box) {
    const map = planMapBase64(io, planPath, plan);
    const png = await io.renderPng(planPlot({...plan, 'options': []}, topo, 1400, box, map).svg);
    io.writeBytes(`${work}/ask/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${box === null ? '' : '-box'}.png`, png);
    const {units} = plan;
    const pointText = ({x, y, label}, color) => `"${label}" (the ${color} dot, at x ${Math.round(x)}, y ${Math.round(y)})`;
    return {
        'image': Buffer.from(png).toString('base64'),
        'text': `This is ${map !== null ? 'the topographic map' : 'a shaded terrain plot, with contours,'} of the site of a planned road` +
            `${box !== null ? ' - a part of it' : ''}. The numbers along its left and bottom sides are the plan's coordinates, in ` +
            `${units}: x increases to the east (right), and y increases to the north (up).` +
            `${map !== null ? ' The dashed lines are the coordinates\' grid, and the small lavender blocks are buildings.' : ''} ` +
            `The road is from ${pointText(plan.start, 'green')} to ${pointText(plan.end, 'red')}.`
    };
}


// Find a place to avoid on the site's map - the model is asked for its rectangle on the site's map, and then to
// correct that rectangle on a closer look. Returns the rectangle's "box" ([west, south, east, north], whole numbers)
// and "why" (what the model saw there) - or its "problem", if the model didn't find it or its rectangle isn't a place's.
async function locateArea(io, ask, work, planPath, plan, topo, place) {
    const answerText = 'Answer with the rectangle that encloses all of it, in the plan\'s coordinates - its "west" and "east" sides ' +
        '(x), and its "south" and "north" sides (y). The rectangle must not contain the road\'s start or end point. In "why", say in ' +
        'one sentence what you see there.';
    const placeText = `"${place.name}"${place.where !== '' ? ` - ${place.where}` : ''}`;

    // The place's rectangle on the site's map
    const first = areaBox(plan, topo, await ask(`avoid:${place.name}`, areaSchema, async () => {
        const sitePlot = await questionPlot(io, work, planPath, plan, topo, place.name, null);
        return {'images': [sitePlot.image], 'question': [
            sitePlot.text, '', `The road's planning notes say it must avoid: ${placeText}.`, '',
            `Find it on the map. ${answerText} If you can't find it, answer with "found" false.`
        ].join('\n')};
    }));
    if ('problem' in first) {
        return first;
    }

    // A closer look - the rectangle is drawn on it, to be corrected
    const [west, south, east, north] = first.box;
    const pad = Math.max(0.5 * (east - west), 0.5 * (north - south), 0.05 * Math.max(topo.width, topo.height));
    const box = [Math.max(0, west - pad), Math.max(0, south - pad), Math.min(topo.width, east + pad), Math.min(topo.height, north + pad)];
    const estimate = {...plan, 'topography': {...plan.topography, 'features': [...topo.features, {
        'type': 'exclusion', 'name': 'estimate',
        'points': [{'x': west, 'y': south}, {'x': east, 'y': south}, {'x': east, 'y': north}, {'x': west, 'y': north}]
    }]}};
    const second = areaBox(plan, topo, await ask(`avoid:${place.name}:closer`, areaSchema, async () => {
        const boxPlot = await questionPlot(io, work, planPath, estimate, planTopo(estimate), place.name, box);
        return {'images': [boxPlot.image], 'question': [
            boxPlot.text, '', `The road's planning notes say it must avoid: ${placeText}.`, '',
            `The red dashed rectangle, "estimate", is a first estimate of where it is. Correct it. ${answerText} If the estimate ` +
                'is right, answer with it.'
        ].join('\n')};
    }));
    return 'problem' in second ? first : second;
}


// Check an area question's answer - returns its "box" (whole numbers, within the site) and "why" - or its "problem", if
// it wasn't found or its rectangle isn't a place's: it has no size, or it covers more than a part of the site. A
// rectangle that contains the road's start or end point is cut back from the point, by the road's minimum radius - a
// model puts a place that's beside a point up against it, and the road needs room to leave the point.
function areaBox(plan, topo, answer) {
    const numbers = ['west', 'south', 'east', 'north'].map((member) => answer[member]);
    if (answer.found !== true || !numbers.every((value) => typeof value === 'number' && Number.isFinite(value))) {
        return {'problem': 'the model didn\'t find it on the map'};
    }
    let box = [
        Math.max(0, Math.min(numbers[0], numbers[2])), Math.max(0, Math.min(numbers[1], numbers[3])),
        Math.min(topo.width, Math.max(numbers[0], numbers[2])), Math.min(topo.height, Math.max(numbers[1], numbers[3]))
    ];
    const clear = planCriteria(plan).minRadius;
    const area = ([west, south, east, north]) => Math.max(0, east - west) * Math.max(0, north - south);
    for (const {x, y} of [plan.start, plan.end]) {
        const [west, south, east, north] = box;
        if (x >= west && x <= east && y >= south && y <= north) {
            // The largest of the rectangle's parts to the point's west, east, south, and north
            const parts = [
                [west, south, x - clear, north], [x + clear, south, east, north], [west, south, east, y - clear],
                [west, y + clear, east, north]
            ];
            box = parts.reduce((best, part) => (area(part) > area(best) ? part : best));
        }
    }
    box = [Math.ceil(box[0]), Math.ceil(box[1]), Math.floor(box[2]), Math.floor(box[3])];
    if (box[2] - box[0] < clear || box[3] - box[1] < clear) {
        return {'problem': 'the model\'s rectangle for it has no size'};
    }
    if (area(box) > placeArea * topo.width * topo.height) {
        return {'problem': 'the model\'s rectangle for it covers more than a quarter of the site'};
    }
    return {box, 'why': typeof answer.why === 'string' ? answer.why.replace(/\s+/g, ' ').trim() : ''};
}


// Find a place to pass through on the site's map - returns its "point" ([x, y], whole numbers) and "why" (what the model
// saw there), or null if the model didn't find it, or the point isn't within the site
async function locatePoint(io, ask, work, planPath, plan, topo, place) {
    const answer = await ask(`via:${place.name}`, pointSchema, async () => {
        const sitePlot = await questionPlot(io, work, planPath, plan, topo, place.name, null);
        return {'images': [sitePlot.image], 'question': [
            sitePlot.text, '',
            `The road's planning notes say it must pass through: "${place.name}"${place.where !== '' ? ` - ${place.where}` : ''}.`, '',
            'Find it on the map, and answer with a point there for the road to pass through, in the plan\'s coordinates - its "x" ' +
                'and "y" - on open ground. In "why", say in one sentence what you see there. If you can\'t find it, answer with ' +
                '"found" false.'
        ].join('\n')};
    });
    const {x, y} = answer;
    const isInside = typeof x === 'number' && typeof y === 'number' && x >= 0 && x <= topo.width && y >= 0 && y <= topo.height;
    if (answer.found !== true || !isInside) {
        return null;
    }
    return {'point': [Math.round(x), Math.round(y)], 'why': typeof answer.why === 'string' ? answer.why.replace(/\s+/g, ' ').trim() : ''};
}
