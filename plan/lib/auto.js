// auto.js - the "auto" command - plan a road by procedure: the tools do every step of the plan, in order, and a model
// (if there is one) is asked only the questions that the tools can't answer - what the site's notes ask for, and
// where the places they name are on the map. Each question is small, its answer is a JSON object that's checked, and
// the answers are saved in the plan's work directory - a planning session's model doesn't run the plan.

import {describeCommand, keepCommand} from './options.js';
import {drawCrossings, drawsCommand} from './draws.js';
import {orderPlan, planText, readPlan} from './planFile.js';
import {planCriteria, planTopo} from '../../viewer/lib/model.js';
import {planMapBase64, planPlot} from './plot.js';
import {Buffer} from 'node:buffer';
import {draftLines} from './draft.js';
import {existingMask} from './structures.js';
import {featureCommand} from './featureCommand.js';
import {parseArgs} from 'node:util';
import {polylineStations} from './route.js';
import {routeCommands} from './routeCli.js';
import {siteCommand} from './siteCommand.js';


// The steps of a plan - their keys (the status function's), and what they do. The notes are read only with a model.
export const autoSteps = [
    {'key': 'site', 'text': 'Build the site - its lidar terrain, streams, roads, and map, from the USGS', 'isModel': false},
    {'key': 'notes', 'text': 'Read the notes - the model is asked what they ask for', 'isModel': true},
    {'key': 'options', 'text': 'Engineer the road options', 'isModel': false},
    {'key': 'describe', 'text': 'Describe the plan, and draw its plots', 'isModel': false}
];


// The "auto" command's usage text lines
export const autoUsage = [
    'usage: plan auto <site.json> <plan.json> [--model MODEL] [--fresh] [--fetch] [options]',
    '',
    '  Plan a road by procedure: create the plan\'s site, engineer its standard options (and add the unmapped draws they',
    '  cross, as streams), keep the best options, and set the descriptions - their facts. With a model (an Ollama model -',
    '  a local model, or one of Ollama\'s cloud models), the model is asked what the site\'s notes ask for - the road\'s',
    '  width and surface, a maximum grade, the existing roads to rule out, and the places to avoid or to pass through -',
    '  and where each place is on the site\'s map, and the plan acts on its answers. The answers are saved in the plan\'s',
    '  work directory ("decisions.json"), and they\'re used again - correct an answer there, and run the command again.',
    '',
    'options:',
    '  --model MODEL          the Ollama model to ask (default is none - the site\'s notes aren\'t read). The Ollama host',
    '                         is the environment\'s "OLLAMA_HOST" (default is "http://127.0.0.1:11434").',
    '  --fresh                ask the model again - don\'t use the saved answers',
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


// The directives' limits - a width, a maximum grade, and a minimum radius that the notes can ask for (in feet and
// meters), and the most places of a kind
const limits = {
    'feet': {'width': [8, 40], 'minRadius': [25, 500]},
    'meters': {'width': [2.4, 12], 'minRadius': [8, 150]}
};
const gradeLimits = [3, 25];
const placeLimit = 6;


// The most of the site that a place to avoid may cover, and the most options of a plan
const placeArea = 0.25;
const optionLimit = 4;


// The notes question's answer schema
const placeSchema = {
    'type': 'array',
    'items': {
        'type': 'object', 'properties': {'name': {'type': 'string'}, 'where': {'type': 'string'}}, 'required': ['name', 'where']
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
        'ruleOutRoads': {'type': 'array', 'items': {'type': 'string'}},
        'avoid': placeSchema,
        'passThrough': placeSchema,
        'unhandled': {'type': 'array', 'items': {'type': 'string'}}
    },
    'required': ['purpose', 'width', 'surface', 'maxGrade', 'minRadius', 'ruleOutRoads', 'avoid', 'passThrough', 'unhandled']
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

    // The plan's report, and its status - what it's doing. They're shown as the plan is made, if the input and output
    // functions have a "progress" function (of the report's new lines) and a "status" function (of the status' text,
    // and its step's key - autoSteps).
    const report = async (...reportLines) => {
        lines.push(...reportLines);
        await io.progress?.(reportLines);
    };
    const status = async (step, text) => {
        await io.status?.(text, step);
    };

    // Create the plan's site
    await status('site', 'Creating the site - its terrain, streams, roads, and map are the USGS\'s');
    const site = await siteCommand([sitePath, planPath, ...(values.fetch ? ['--fetch'] : [])], io);
    if (site.code !== 0) {
        return site;
    }
    await report(...site.lines.slice(0, -1));
    const {notes = [], 'criteria': siteCriteria = {}} = JSON.parse(io.readFile(sitePath));
    const loadPlan = () => readPlan(io, planPath).plan;
    const savePlan = (plan) => io.writeFile(planPath, planText(orderPlan(plan)));
    let plan = loadPlan();
    let topo = planTopo(plan);
    const {units} = plan;

    // The saved answers - they're the site's (its notes', and its grid's)
    const decisionsPath = `${work}/decisions.json`;
    const signature = JSON.stringify([notes, plan.georeference, topo.width, topo.height]);
    const answers = new Map();
    if (!values.fresh) {
        try {
            const saved = JSON.parse(io.readFile(decisionsPath));
            for (const [key, answer] of Object.entries(saved.site === signature ? saved.answers : {})) {
                answers.set(key, answer);
            }
        } catch {
            // There are no saved answers
        }
    }

    // Ask the model a question - or use its saved answer
    const ask = async (key, question, images, schema) => {
        if (!answers.has(key)) {
            answers.set(key, await io.ask({model, question, images, schema}));
            io.writeFile(
                decisionsPath, `${JSON.stringify({model, 'site': signature, 'answers': Object.fromEntries(answers)}, null, 4)}\n`
            );
        }
        return answers.get(key);
    };

    // The notes' directives
    let directives = {'purpose': null, 'width': null, 'surface': null, 'avoid': [], 'passThrough': [], 'ruleOutRoads': [], 'unhandled': []};
    const limitations = [];
    const roadNames = [...new Set(topo.features.filter(({type, name = null}) => type === 'road' && name !== null).map(({name}) => name))];
    try {
        if (model === null) {
            if (notes.length > 0) {
                await report('Notes: not read - there\'s no model (--model)');
                limitations.push('The site\'s notes weren\'t read - the plan is the tools\' alone.');
            }
        } else if (notes.length > 0) {
            await status('notes', `Asking the model "${model}" what the site's notes ask for`);
            const answer = await ask('notes', notesQuestion(plan, notes, roadNames), [], notesSchema);
            directives = notesDirectives(answer, units);

            // The design criteria - the site model's own are the plan's
            const criteria = {};
            for (const member of ['maxGrade', 'minRadius']) {
                if (directives[member] !== null && !(member in siteCriteria)) {
                    criteria[member] = directives[member];
                }
            }
            if (Object.keys(criteria).length > 0) {
                plan.criteria = {...plan.criteria, ...criteria};
                savePlan(plan);
                await report(`Notes: ${Object.entries(criteria).map(([member, value]) => `${criteriaNames[member]} ${value}`).join(', ')}`);
            }
            if (directives.width !== null || directives.surface !== null) {
                await report(`Notes: the road is ${[
                    ...(directives.width !== null ? [`${directives.width} ${units} wide`] : []),
                    ...(directives.surface !== null ? [directives.surface] : [])
                ].join(', ')}`);
            }

            // The existing roads the notes rule out
            for (const roadName of directives.ruleOutRoads) {
                const match = roadNames.find((name) => name.toLowerCase() === roadName.toLowerCase()) ?? null;
                if (match === null) {
                    directives.unhandled.push(`rule out the road "${roadName}" (the site has no road of that name)`);
                } else {
                    featureCommand([planPath, '--remove', match], io);
                    await report(`Notes: the existing road "${match}" is ruled out`);
                }
            }
            plan = loadPlan();
            topo = planTopo(plan);

            // The places the notes say to avoid - each is an exclusion area
            for (const place of directives.avoid) {
                await status('notes', `Asking the model "${model}" where "${place.name}" is on the map`);
                const area = await locateArea(io, ask, work, planPath, plan, topo, place);
                if ('problem' in area) {
                    directives.unhandled.push(`avoid "${place.name}" (${place.where}) - ${area.problem}`);
                } else {
                    featureCommand([planPath, '--remove', place.name], io);
                    const [west, south, east, north] = area.box;
                    const corners = [[west, south], [east, south], [east, north], [west, north]].map((corner) => corner.join(','));
                    featureCommand([planPath, 'exclusion', '-n', place.name, ...corners], io);
                    place.note = `${place.name}: the notes' place to avoid (${place.where}). The model "${model}" found it on the ` +
                        `site's map, from x ${west} to ${east} and y ${south} to ${north} - "${area.why}" Verify it.`;
                    await report(`Notes: avoid "${place.name}" - an exclusion area from x ${west} to ${east}, y ${south} to ${north}`);
                    plan = loadPlan();
                    topo = planTopo(plan);
                }
            }

            // The places the notes say to pass through - each is an option's via point
            for (const place of directives.passThrough) {
                await status('notes', `Asking the model "${model}" where "${place.name}" is on the map`);
                const point = await locatePoint(io, ask, work, planPath, plan, topo, place);
                if (point === null) {
                    directives.unhandled.push(`pass through "${place.name}" (${place.where}) - the model didn't find it on the map`);
                } else {
                    place.point = point;
                }
            }
        }
    } catch ({message}) {
        return fail([`error: ${message}`]);
    }

    // Engineer the standard options - and add the unmapped draws they cross, as streams, until they cross none
    const designArgs = [
        ...((width ?? directives.width) !== null ? ['--width', `${width ?? directives.width}`] : []),
        ...((values.surface ?? directives.surface) !== null ? ['--surface', values.surface ?? directives.surface] : [])
    ];
    let options;
    const draws = [];
    for (;;) {
        await status('options', 'Engineering the standard options');
        options = routeCommands.options([planPath, ...designArgs], io);
        if (options.code !== 0) {
            return fail(options.lines);
        }
        plan = loadPlan();
        topo = planTopo(plan);

        // A draw that's a stream isn't an unmapped draw, so each pass adds new draws - until the options cross none
        const crossed = crossedDraws(plan, topo).filter((number) => !draws.includes(number));
        if (crossed.length === 0) {
            break;
        }
        drawsCommand([planPath, ...crossed.flatMap((number) => ['--add', `${number}`])], io);
        draws.push(...crossed);
    }
    if (draws.length > 0) {
        const drawNames = draws.map((number) => `Draw ${number}`).join(', ');
        await report(`Draws: added the unmapped draws the options crossed, as streams - ${drawNames}`);
    }
    await report(...options.lines.filter((line) => !/^Option \d+: |^Wrote /.test(line)));

    // The options through the notes' places
    const names = plan.options.filter(({name}) => standardNames.includes(name)).map(({name}) => name);
    for (const place of directives.passThrough.filter(({point = null}) => point !== null)) {
        const name = `Via ${place.name}`;
        await status('options', `Engineering the option "${name}"`);
        const routed = routeCommands.route([planPath, '-n', name, '-v', place.point.join(','), ...designArgs], io);
        if (routed.code === 0) {
            names.push(name);
            await report(
                ...routed.lines.filter((line) => !/^Wrote /.test(line)),
                `Notes: "${name}" passes through "${place.name}" at ${place.point.join(',')}`
            );
        } else {
            directives.unhandled.push(
                `pass through "${place.name}" (${place.where}) at ${place.point.join(',')} - ${routed.lines.at(-1).replace(/^error: /, '')}`
            );
        }
    }

    // Keep the plan's options - those it engineered, the best first
    await status('describe', 'Writing the descriptions and the plots');
    let kept = keepCommand([planPath, ...names], io);
    if (names.length > optionLimit) {
        kept = keepCommand([planPath, ...loadPlan().options.slice(0, optionLimit).map(({name}) => name)], io);
    }
    await report(...kept.lines.filter((line) => /^Option \d+: /.test(line)));

    // The descriptions - the plan's facts, and what the plan did with its notes
    plan = loadPlan();
    for (const text of directives.unhandled) {
        await report(`Notes: NOT acted on - ${text}`);
    }
    if (directives.unhandled.length > 0) {
        limitations.push(`These of the site's notes weren't acted on: ${directives.unhandled.join('; ')}.`);
    }
    const descriptionsPath = `${work}/descriptions.md`;
    io.writeFile(descriptionsPath, `${draftLines(plan, {
        'purpose': directives.purpose,
        'featureNotes': [
            ...directives.avoid.filter(({note = null}) => note !== null).map(({note}) => note),
            ...(draws.length > 0 ? [drawsNote] : [])
        ],
        limitations
    }).join('\n')}\n`);
    describeCommand([planPath, descriptionsPath], io);

    // Plot the plan - its terrain, and its topographic map
    plan = loadPlan();
    topo = planTopo(plan);
    io.writeBytes(`${work}/plan.png`, await io.renderPng(planPlot(plan, topo).svg));
    const map = planMapBase64(io, planPath, plan);
    if (map !== null) {
        io.writeBytes(`${work}/map.png`, await io.renderPng(planPlot(plan, topo, 1400, null, map).svg));
    }
    await report(`Wrote ${planPath} - its descriptions are "${descriptionsPath}", and its plots are in "${work}/"`);
    return {'code': 0, lines};
}


// The descriptions' note of the draws that were added
const drawsNote = 'The draws are the terrain\'s unmapped draws that the options crossed - each crossing has a culvert.';


// The standard options' names
const standardNames = ['Existing Roads', 'New Road'];


// The criteria's names in the report
const criteriaNames = {'maxGrade': 'maximum grade', 'minRadius': 'minimum radius'};


// Get the numbers of the unmapped draws that a plan's standard options cross
function crossedDraws(plan, topo) {
    const numbers = [];
    for (const option of plan.options.filter(({name}) => standardNames.includes(name))) {
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
        `- "ruleOutRoads": the existing roads the notes say the road must not use - their names, of the site's roads` +
            `${roadNames.length > 0 ? ` (${roadNames.map((name) => `"${name}"`).join(', ')})` : ' (it has none)'}`,
        '- "avoid": the places the notes say the road must avoid, keep off, or stay out of - each one\'s short "name", and "where" ' +
            'it is, in the notes\' words',
        '- "passThrough": the places the notes say the road must pass through or go by - each one\'s "name" and "where"',
        '- "unhandled": each other instruction of the notes that these members don\'t cover, in the notes\' words (not the road\'s ' +
            'description or purpose)'
    ].join('\n');
}


// Check the notes question's answer, and get its directives - what isn't valid is unhandled
function notesDirectives(answer, units) {
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
    const places = (member) => (Array.isArray(answer[member]) ? answer[member] : []).
        map((place) => ({'name': text(place?.name).replace(/^[^A-Za-z0-9]+/, ''), 'where': text(place?.where)})).
        filter(({name}) => name !== '').slice(0, placeLimit);
    const surface = text(answer.surface).toLowerCase();
    return {
        'purpose': text(answer.purpose) !== '' ? text(answer.purpose) : null,
        'width': within('width', limits[units].width, 'a width of'),
        'surface': surfaces.includes(surface) ? surface : null,
        'maxGrade': within('maxGrade', gradeLimits, 'a maximum grade of'),
        'minRadius': within('minRadius', limits[units].minRadius, 'a minimum radius of'),
        'ruleOutRoads': (Array.isArray(answer.ruleOutRoads) ? answer.ruleOutRoads : []).map(text).filter((name) => name !== ''),
        'avoid': places('avoid'),
        'passThrough': places('passThrough'),
        unhandled
    };
}





// Plot a plan for a question - its topographic map (or its terrain, if it has no map), all of it or a box of it. The
// plot is written to the plan's work directory, to see what the model was asked. Returns its base64 text and the
// question's description of it. (The plot's image is awaited - a browser's is made later.)
async function questionPlot(io, work, planPath, plan, topo, name, box) {
    const map = planMapBase64(io, planPath, plan);
    const png = await io.renderPng(planPlot(plan, topo, 1400, box, map).svg);
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
    const sitePlot = await questionPlot(io, work, planPath, plan, topo, place.name, null);
    const first = areaBox(plan, topo, await ask(`avoid:${place.name}`, [
        sitePlot.text, '', `The road's planning notes say it must avoid: ${placeText}.`, '',
        `Find it on the map. ${answerText} If you can't find it, answer with "found" false.`
    ].join('\n'), [sitePlot.image], areaSchema));
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
    const boxPlot = await questionPlot(io, work, planPath, estimate, planTopo(estimate), place.name, box);
    const second = areaBox(plan, topo, await ask(`avoid:${place.name}:closer`, [
        boxPlot.text, '', `The road's planning notes say it must avoid: ${placeText}.`, '',
        `The red dashed rectangle, "estimate", is a first estimate of where it is. Correct it. ${answerText} If the estimate is ` +
            'right, answer with it.'
    ].join('\n'), [boxPlot.image], areaSchema));
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


// Find a place to pass through on the site's map - returns its point ([x, y], whole numbers), or null if the model
// didn't find it, or the point isn't within the site
async function locatePoint(io, ask, work, planPath, plan, topo, place) {
    const sitePlot = await questionPlot(io, work, planPath, plan, topo, place.name, null);
    const answer = await ask(`via:${place.name}`, [
        sitePlot.text, '',
        `The road's planning notes say it must pass through: "${place.name}"${place.where !== '' ? ` - ${place.where}` : ''}.`, '',
        'Find it on the map, and answer with a point there for the road to pass through, in the plan\'s coordinates - its "x" and ' +
            '"y" - on open ground. In "why", say in one sentence what you see there. If you can\'t find it, answer with "found" false.'
    ].join('\n'), [sitePlot.image], pointSchema);
    const {x, y} = answer;
    const isInside = typeof x === 'number' && typeof y === 'number' && x >= 0 && x <= topo.width && y >= 0 && y <= topo.height;
    if (answer.found !== true || !isInside) {
        return null;
    }
    return [Math.round(x), Math.round(y)];
}
