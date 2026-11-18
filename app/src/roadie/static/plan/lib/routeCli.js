// routeCli.js - the "route", "profile", and "options" commands: engineer a road option, re-design an existing option's
// profile and structures, or engineer a plan's standard options (a port of the Python planning tools', but for the
// existing roads the route follows)

import {alignmentPolyline, followRoads, resamplePolyline, routeLattice, routeSearch, smoothCurves, viaTurnBacks} from './route.js';
import {analyzeOption, planTopo} from '../../viewer/lib/model.js';
import {designStructures, existingMask} from './structures.js';
import {drawAreaText, drawCrossings} from './draws.js';
import {fixedTrim, number as formatNumber} from '../../viewer/lib/format.js';
import {lineIndex, nearestLine} from './roads.js';
import {orderPlan, planText, readPlan} from './planFile.js';
import {pyFixed, pyRound} from './numeric.js';
import {createDesign} from './design.js';
import {designProfile} from './profile.js';
import {parseArgs} from 'node:util';


// The design options' usage text lines - the route, profile, and options commands'
const designUsage = [
    '  -w, --width WIDTH              the road width (default is 14 feet / 4.3 meters)',
    '  -s, --surface SURFACE          the road surface - native, gravel, asphalt, or concrete (default is gravel)',
    '  --cut-slope SLOPE              the cut slope ratio H:V (default is 1)',
    '  --fill-slope SLOPE             the fill slope ratio H:V (default is 1.5)',
    '  -g, --grade GRADE              the design grade, in percent (default is 1 less than the maximum grade)',
    '  --switchback-grade GRADE       the maximum grade on tight curves, in percent (default is 8)',
    '  --turnouts SPACING             the turnout spacing, 0 for none (default is 400 feet / 120 meters for roads',
    '                                 under 16 feet wide)',
    '  --bridge-fill DEPTH            replace stream crossing fills deeper than this with a bridge, up to 150 feet /',
    '                                 45 meters long (default is no bridges)'
];


// The route and profile commands' usage text lines
export const routeUsage = [
    'usage: plan route <plan.json> -n NAME [-v X,Y]... [options]',
    '       plan profile <plan.json> -n NAME [options]',
    '',
    '  route      Engineer a road option - a least-cost horizontal alignment search (through the via points), a',
    '             vertical profile design, and structures - and add it to the road plan model (or replace it). The',
    '             route follows the plan\'s existing roads where that costs less than a new road. The road is the',
    '             one with the lowest cost score of the searches with each grade penalty weight.',
    '  profile    Re-design an existing option\'s vertical profile and structures (after its alignment is edited)',
    '',
    '  A road is within its grade limit: where its profile can\'t be - it can\'t reach the end point\'s ground, or an',
    '  existing road\'s - it\'s an error, and the option isn\'t written.',
    '',
    'options:',
    '  -n, --name NAME                the option name (an existing option is replaced)',
    '  -d, --description TEXT         an option description line (may be repeated)',
    ...designUsage,
    '  --existing-road STATION,END    a station range where the road follows an existing road - its grade follows',
    '                                 the ground, with no earthwork or structures (may be repeated; profile keeps',
    '                                 the option\'s existing roads by default, and route finds them)',
    '  -v, --via X,Y                  a via point (route only; may be repeated)',
    '  --all-new                      an all-new road - the route doesn\'t follow the plan\'s existing roads (route',
    '                                 only)',
    '  --grade-weight WEIGHT          the route search\'s penalty weight for ground steeper than the design grade',
    '                                 (route only; default is the weight of 1, 0.5, and 0.25 whose road has the',
    '                                 lowest cost score)',
    '  --slope-weight WEIGHT          the side slope earthwork weight (route only; default is 1)'
];


// The options command's usage text lines
export const optionsUsage = [
    'usage: plan options <plan.json> [options]',
    '',
    '  Engineer a road plan model\'s standard options, and put its options in cost score order (the best first):',
    '',
    '  Existing Roads  The road that follows the plan\'s existing roads where that costs less than a new road ("plan',
    '                  route") - if it follows any',
    '  New Road        An all-new road ("plan route --all-new") - the existing roads may not be usable',
    '',
    '  The plan\'s options of those names are replaced, and its other options are kept as they are. Run it again after',
    '  the plan\'s features or criteria change.',
    '',
    'options:',
    ...designUsage
];


// The route, profile, and options commands - each is a function of the command's arguments and the command line's
// input and output functions that returns the command's exit code and its output text lines, or null if the arguments
// are invalid
export const routeCommands = {
    'route': (args, io) => routeCommand('route', args, io),
    'profile': (args, io) => routeCommand('profile', args, io),
    'options': optionsCommand
};


// The commands' design options, the route and profile commands' option options, and the route command's
const designOptions = {
    'width': {'type': 'string', 'short': 'w'},
    'surface': {'type': 'string', 'short': 's', 'default': 'gravel'},
    'cut-slope': {'type': 'string', 'default': '1'},
    'fill-slope': {'type': 'string', 'default': '1.5'},
    'grade': {'type': 'string', 'short': 'g'},
    'switchback-grade': {'type': 'string', 'default': '8'},
    'turnouts': {'type': 'string'},
    'bridge-fill': {'type': 'string'}
};
const optionOptions = {
    'name': {'type': 'string', 'short': 'n'},
    'description': {'type': 'string', 'short': 'd', 'multiple': true},
    'existing-road': {'type': 'string', 'multiple': true}
};
const routeOptions = {
    'via': {'type': 'string', 'short': 'v', 'multiple': true},
    'all-new': {'type': 'boolean', 'default': false},
    'grade-weight': {'type': 'string'},
    'slope-weight': {'type': 'string', 'default': '1'}
};


// The road surfaces
const surfaces = ['native', 'gravel', 'asphalt', 'concrete'];


// Parse a command's arguments - returns the arguments object, or null if they're invalid
function parseCommandArgs(command, args) {
    let parsed;
    try {
        const options = {
            ...designOptions, ...(command === 'options' ? {} : optionOptions), ...(command === 'route' ? routeOptions : {})
        };
        parsed = parseArgs({args, options, 'allowPositionals': true});
    } catch {
        return null;
    }
    const {values, positionals} = parsed;
    const parseNumber = (text) => (text.trim() === '' ? NaN : Number(text));
    const number = (name) => (name in values ? parseNumber(values[name]) : null);
    const numbers = (name) => (values[name] ?? []).map((text) => text.split(',').map(parseNumber));
    const commandArgs = {
        'plan': positionals[0],
        'name': values.name,
        'description': values.description ?? null,
        'width': number('width'),
        'surface': values.surface,
        'cutSlope': number('cut-slope'),
        'fillSlope': number('fill-slope'),
        'grade': number('grade'),
        'switchbackGrade': number('switchback-grade'),
        'turnouts': number('turnouts'),
        'bridgeFill': number('bridge-fill'),
        'existingRoads': 'existing-road' in values ? numbers('existing-road') : null,
        'via': numbers('via'),
        'allNew': values['all-new'] ?? false,
        'gradeWeight': number('grade-weight'),
        'slopeWeight': number('slope-weight')
    };

    // The plan, the option name (but for the options command), and valid numbers are required
    if (positionals.length !== 1 || (command !== 'options' && commandArgs.name === undefined) ||
        !surfaces.includes(commandArgs.surface) ||
        Object.values(commandArgs).some(Number.isNaN) ||
        [...commandArgs.existingRoads ?? [], ...commandArgs.via].some((pair) => pair.length !== 2 || pair.some(Number.isNaN))) {
        return null;
    }
    return commandArgs;
}


// The route search's soft grade bands and grade margins - if the profile can't reach the end elevation within the grade
// limits, the route is searched again with stricter grade penalties
const routeSearches = [[0.03, 0], [0.01, 0.005], [0, 0.015], [0, 0.03]];


// The "route" and "profile" commands
function routeCommand(command, args, io) {
    const commandArgs = parseCommandArgs(command, args);
    if (commandArgs === null) {
        return null;
    }

    // Read the road plan model
    const {plan, error} = readPlan(io, commandArgs.plan);
    if (error !== undefined) {
        return {'code': 1, 'lines': error};
    }

    // Engineer the option
    const engineered = engineerOption(command, plan, planTopo(plan), commandArgs);
    if (engineered.error !== null) {
        return {'code': 1, 'lines': [...engineered.lines, `error: ${engineered.error}`]};
    }
    io.writeFile(commandArgs.plan, planText(orderPlan(plan)));
    return {'code': 0, 'lines': [...engineered.lines, wroteLine(commandArgs.plan)]};
}


// The report's last line - the plan that was written
function wroteLine(planPath) {
    return `Wrote ${planPath} - run "plan evaluate ${planPath}" for the full analysis and cost`;
}


// The standard options' names
const roadsName = 'Existing Roads';
const newName = 'New Road';


// The "options" command - engineer the plan's standard options, and put its options in cost score order
function optionsCommand(args, io) {
    const commandArgs = parseCommandArgs('options', args);
    if (commandArgs === null) {
        return null;
    }

    // Read the road plan model
    const {plan, error} = readPlan(io, commandArgs.plan);
    if (error !== undefined) {
        return {'code': 1, 'lines': error};
    }
    const topo = planTopo(plan);
    const routeArgs = {...commandArgs, 'description': null, 'existingRoads': null, 'via': [], 'gradeWeight': null, 'slopeWeight': 1};
    const removeOption = (optionName) => {
        plan.options = plan.options.filter(({name}) => name !== optionName);
    };

    const lines = [];

    // The road that follows the plan's existing roads where that costs less than a new road - if it follows any
    let followsRoads = false;
    if (topo.features.some(({type}) => type === 'road')) {
        const roadsOption = engineerOption('route', plan, topo, {...routeArgs, 'name': roadsName, 'allNew': false});
        if (roadsOption.error !== null) {
            return {'code': 1, 'lines': [...roadsOption.lines, `error: ${roadsOption.error}`]};
        }
        followsRoads = plan.options.find(({name}) => name === roadsName).structures.some(({type}) => type === 'existingRoad');
        lines.push(...(followsRoads ? roadsOption.lines : [`No "${roadsName}" option: the least-cost road follows no existing roads`]));
    }
    if (!followsRoads) {
        removeOption(roadsName);
    }

    // The all-new road - the existing roads may not be usable
    const newOption = engineerOption('route', plan, topo, {...routeArgs, 'name': newName, 'allNew': true});
    lines.push(...newOption.lines);
    if (newOption.error !== null) {
        if (!followsRoads) {
            return {'code': 1, 'lines': [...lines, `error: ${newOption.error}`]};
        }
        removeOption(newName);
        lines.push(`No "${newName}" option: ${newOption.error}`);
    }

    // The plan's options, in cost score order
    const scored = plan.options.map((option, ixOption) => ({option, 'analysis': analyzeOption(plan, ixOption, topo)})).
        sort((first, second) => first.analysis.score - second.analysis.score);
    plan.options = scored.map(({option}) => option);
    lines.push(...scored.map(({option, analysis}, ixOption) => (
        `Option ${ixOption}: "${option.name}" - cost score ${formatNumber(analysis.score, 1)}, design warnings: ${analysis.warnings.length}`
    )));
    io.writeFile(commandArgs.plan, planText(orderPlan(plan)));
    return {'code': 0, 'lines': [...lines, wroteLine(commandArgs.plan)]};
}


// The route search's grade penalty weights. The search's penalty for ground steeper than the design grade stands in
// for the earthwork that a road needs there - it isn't a cost, so no one weight is right: a heavy penalty takes a road
// far around for gentler ground, and a light one takes it across ground that needs deep cuts and fills. A road's real
// cost is its cost score, so a route is searched with each weight, and the road with the lowest cost score is the
// route's (bestRoad - it's never worse than the first weight's road). On a steep hill, the scores are within a few
// percent of each other from a weight of 0.5 to 0.25, and they rise either side - on gentle ground, the roads are the
// same.
const gradeWeights = [1, 0.5, 0.25];


// Engineer an option of a plan - "command" is "route" (the option's alignment, profile, and structures) or "profile"
// (the profile and structures of the option's alignment), and "commandArgs" is the command's arguments. A route is
// searched with each grade penalty weight (or the argument's), and the option is the best of their roads (bestRoad).
// The option is added to the plan's options, or it replaces the option of its name. Returns the report's "lines" and
// the "error" - null, or why there's no option (the plan is as it was).
function engineerOption(command, plan, topo, commandArgs) {
    const design = createDesign(plan, commandArgs);
    const {options} = plan;
    const ixExisting = options.findIndex((option) => option.name === commandArgs.name);
    const ixOption = ixExisting === -1 ? options.length : ixExisting;
    const existingOption = ixExisting === -1 ? null : options[ixExisting];
    const roads = lineIndex(topo.features, 'road', Math.max(topo.spacing, design.minRadius) * 2);
    if (command === 'profile' && existingOption === null) {
        return {'lines': [], 'error': `no option named "${commandArgs.name}"`};
    }

    // Design each road's alignment, profile, and structures - a route's searches are of one lattice
    const isRoute = command === 'route';
    const followsRoads = !commandArgs.allNew && commandArgs.existingRoads === null;
    const routeNodes = isRoute ? routeLattice(topo, design, commandArgs.slopeWeight, followsRoads ? roads : null) : null;
    const designedRoads = [];
    let failed = null;
    for (const gradeWeight of (isRoute && commandArgs.gradeWeight === null ? gradeWeights : [commandArgs.gradeWeight])) {
        const lines = [];
        const designed = isRoute ? routeAlignment(plan, topo, design, roads, routeNodes, {...commandArgs, gradeWeight}, lines) :
            profileAlignment(topo, design, existingOption, commandArgs, plan.units);

        // A road that isn't within the grade limit isn't a road
        let error = null;
        if (designed === null) {
            error = 'no route found (blocked by exclusion areas or the topography boundary?)';
        } else if (designed.failure !== null) {
            const grade = `${fixedTrim(design.grade * 100, 1)}% grade limit`;
            error = isRoute ?
                `no road within the ${grade} - the profile ${designed.failure} (try other via points, a longer corridor, or a ` +
                    'steeper grade)' :
                `the alignment is too steep for the ${grade} - the profile ${designed.failure} (edit the alignment, or route it again)`;
        }
        if (error !== null) {
            failed ??= {lines, error};
        } else {
            // Structures (the existing roads within the road's length, measured along the option's alignment points as
            // the viewer does - an existing road to the road's end is to its last station, so nothing is placed between
            // them)
            const {x, y, stations, profile, sideSlope} = designed;
            const pointsX = Array.from(x, (value) => pyRound(value, 2));
            const pointsY = Array.from(y, (value) => pyRound(value, 2));
            let length = 0;
            for (let ix = 0; ix < x.length - 1; ix++) {
                length += Math.sqrt((pointsX[ix + 1] - pointsX[ix]) ** 2 + (pointsY[ix + 1] - pointsY[ix]) ** 2);
            }
            const alignmentLength = Math.floor(length * 10) / 10;
            const existingRoads = designed.existingRoads.filter(([start]) => start < alignmentLength);
            const structures = designStructures(topo, design, x, y, stations, profile, sideSlope, existingRoads, alignmentLength);

            // The road's option, and its cost score
            const description = commandArgs.description ?? existingOption?.description ?? null;
            const {width, cutSlope, fillSlope, surface} = design;
            const option = {
                'name': commandArgs.name,
                ...(description !== null && description.length > 0 ? {description} : {}),
                'section': {width, cutSlope, fillSlope, surface},
                'alignment': pointsX.map((pointX, ix) => ({'x': pointX, 'y': pointsY[ix], 'z': pyRound(profile[ix], 2)})),
                structures
            };
            options[ixOption] = option;
            const {score, warnings} = analyzeOption(plan, ixOption, topo);
            designedRoads.push({option, designed, existingRoads, lines, score, 'warnings': warnings.length});
        }
    }

    // No road? The plan is as it was.
    if (designedRoads.length === 0) {
        return failed;
    }
    const {option, designed, existingRoads, lines} = designedRoads[bestRoad(designedRoads)];
    options[ixOption] = option;

    // Report
    lines.push(...optionReport(plan, topo, design, roads, option, designed, existingRoads), ...designed.notes);
    return {lines, 'error': null};
}


// Find the best of a route's roads (objects with a road's design "warnings" count and its cost "score"), in the
// order of their searches - the index of the road with the lowest cost score, as it's reported (to a tenth), of the
// roads with no more design warnings than the first road. It's the first of the roads with that score - so the best
// road is never worse than the first road, by its cost score or by its design warnings.
export function bestRoad(roads) {
    const reported = (road) => Math.round(road.score * 10);
    let ixBest = 0;
    for (let ix = 1; ix < roads.length; ix++) {
        if (roads[ix].warnings <= roads[0].warnings && reported(roads[ix]) < reported(roads[ixBest])) {
            ixBest = ix;
        }
    }
    return ixBest;
}


// Design a route's alignment and its profile - the least-cost alignment of a route lattice ("routeNodes") from the
// plan's start point, through the via points, to its end point. If the profile can't meet the grade limits
// (gradeFailure), the route is searched again with stricter grade penalties (a line of "lines" reports each). Returns
// the alignment's "x" and "y" coordinates and "stations", its "profile", "ground", and "sideSlope" (designProfile), its
// "existingRoads" ([station, end station] ranges), its "notes" (the report's lines for the via points it turns back
// at), and its "failure" (the last search's gradeFailure) - or null if there's no route.
function routeAlignment(plan, topo, design, roads, routeNodes, commandArgs, lines) {
    // The existing roads are the argument's ranges, or the plan's existing roads that the route follows
    const followsRoads = !commandArgs.allNew && commandArgs.existingRoads === null;
    let existingRoads = commandArgs.existingRoads ?? [];

    // Search for the horizontal alignment through the via points - each leg starts with the previous leg's heading.
    // The legs, and the searches with stricter grades, search one lattice.
    const waypoints = [[plan.start.x, plan.start.y], ...commandArgs.via, [plan.end.x, plan.end.y]];
    const {lattice} = routeNodes;
    let alignment;
    let designed;
    let failure;
    for (const [ixSearch, [softBand, gradeMargin]] of routeSearches.entries()) {
        const path = [];
        const existing = [];
        let heading = null;
        for (let ixWaypoint = 1; ixWaypoint < waypoints.length; ixWaypoint++) {
            const leg = routeSearch(
                routeNodes, design, waypoints[ixWaypoint - 1], waypoints[ixWaypoint], commandArgs.gradeWeight, heading, softBand,
                gradeMargin
            );
            if (leg === null) {
                return null;
            }
            ({heading} = leg);
            path.push(...(path.length === 0 ? leg.path : leg.path.slice(1)));
            existing.push(...(existing.length === 0 ? leg.existing : leg.existing.slice(1)));
        }

        // The route's runs along existing roads are the roads' lines - the rest is smoothed to the minimum radius
        const interval = Math.max(design.stationInterval, Math.min(lattice, topo.spacing) * 0.5);
        const followed = followRoads(path, existing, roads, lattice, 2 * design.minRadius, design.minRadius);
        const smooth = smoothCurves(followed.points, interval, design.minRadius, followed.ranges);
        alignment = resamplePolyline(smooth.x, smooth.y, interval);
        if (followsRoads) {
            existingRoads = smooth.ranges;
        }
        designed = designProfile(
            topo, design, alignment.x, alignment.y, alignment.stations, existingMask(alignment.stations, existingRoads)
        );
        failure = gradeFailure(design, alignment.stations, designed, plan.units);
        if (failure === null) {
            break;
        }
        if (ixSearch < routeSearches.length - 1) {
            lines.push(`The profile ${failure} - searching with stricter grades`);
        }
    }

    // A via point the road turns back at is off its corridor - the road goes out to it and returns
    const notes = viaTurnBacks(alignment.x, alignment.y, alignment.stations, commandArgs.via, 10 * design.minRadius).map(
        ({via, station}) => `NOTE: the road turns back at the via point ${commandArgs.via[via].join(',')} (station ` +
            `${pyFixed(station, 0)}) - if it isn't a switchback you meant, move the via point along the road's corridor, or drop it`
    );
    return {...alignment, ...designed, existingRoads, notes, failure};
}


// Get a designed profile's failure to meet the grade limits - the report's text of what the profile can't do within
// them: reach an existing road's ground, or end at the end point's - or null if it meets them
function gradeFailure(design, stations, {profile, ground, unreachable}, units) {
    if (unreachable !== null) {
        return `can't reach the existing road at station ${pyFixed(stations[unreachable], 0)}`;
    }
    const endDepth = ground.at(-1) - profile.at(-1);
    return Math.abs(endDepth) <= design.tieTolerance ? null :
        `ends ${pyFixed(Math.abs(endDepth), 1)} ${units} ${endDepth > 0 ? 'below' : 'above'} the end point`;
}


// Design the profile of an option's alignment - its existing roads are the argument's ranges, or the option's existing
// road structures. An alignment that's already at the stations' interval (the route command's, or this command's) is
// kept as it is. Returns the alignment and its profile (like routeAlignment).
function profileAlignment(topo, design, option, commandArgs, units) {
    const existingRoads = commandArgs.existingRoads ??
        (option.structures ?? []).filter((structure) => structure.type === 'existingRoad').map(
            (structure) => [structure.station, structure.endStation]
        );
    const interval = Math.max(design.stationInterval, topo.spacing * 0.5);
    const alignment = alignmentPolyline(option.alignment, interval, existingRoads);
    const designed = designProfile(
        topo, design, alignment.x, alignment.y, alignment.stations, existingMask(alignment.stations, existingRoads)
    );
    const failure = gradeFailure(design, alignment.stations, designed, units);
    return {...alignment, ...designed, existingRoads, 'notes': [], failure};
}


// Get an existing road structure's roads' names, and its grade as it's built (it isn't designed, so it may be over
// the maximum grade) - the average "grade" of its length, in percent (null if it has no length), and the grade of its
// "steepest" minimum radius' length. "roads" is the existing roads' index, and "x", "y", "z", and "stations" are the
// road's alignment.
export function existingRoadGrades(roads, minRadius, x, y, z, stations, structure) {
    const names = [];
    const ixRoad = [];
    for (let ix = 0; ix < x.length; ix++) {
        if (stations[ix] >= structure.station && stations[ix] <= structure.endStation) {
            ixRoad.push(ix);
            const name = nearestLine(roads, x[ix], y[ix], minRadius)?.name ?? null;
            if (name !== null && !names.includes(name)) {
                names.push(name);
            }
        }
    }
    if (ixRoad.length < 2) {
        return {names, 'grade': null, 'steepest': null};
    }
    const roadGrade = (ix1, ix2) => Math.abs(z[ix2] - z[ix1]) / (stations[ix2] - stations[ix1]) * 100;
    let steepest = 0;
    let ixAhead = 0;
    for (let ixBehind = 0; ixBehind < ixRoad.length; ixBehind++) {
        while (ixAhead < ixRoad.length - 1 && stations[ixRoad[ixAhead]] - stations[ixRoad[ixBehind]] < minRadius) {
            ixAhead += 1;
        }
        if (stations[ixRoad[ixAhead]] - stations[ixRoad[ixBehind]] >= minRadius) {
            steepest = Math.max(steepest, roadGrade(ixRoad[ixBehind], ixRoad[ixAhead]));
        }
    }
    return {names, 'grade': roadGrade(ixRoad[0], ixRoad.at(-1)), steepest};
}


// Create an option's report lines - its length, the new road's grades and depths, its existing roads (with the roads'
// names and grades), its structures' counts, its cost score and design warnings, and notes if the road is along the
// site's edge, or it crosses unmapped draws
function optionReport(plan, topo, design, roads, option, designed, existingRoads) {
    const {units} = plan;
    const {x, y, stations, profile, ground} = designed;
    const {structures} = option;
    const last = x.length - 1;
    const lines = [];
    const mask = existingMask(stations, existingRoads);
    let maxGrade = -Infinity;
    let maxDepth = -Infinity;
    let minDepth = Infinity;
    for (let ix = 0; ix <= last; ix++) {
        if (ix > 0) {
            const grade = mask[ix] && mask[ix - 1] ? 0 : Math.abs(profile[ix] - profile[ix - 1]) / (stations[ix] - stations[ix - 1]) * 100;
            maxGrade = Math.max(maxGrade, grade);
        }
        maxDepth = Math.max(maxDepth, ground[ix] - profile[ix]);
        minDepth = Math.min(minDepth, ground[ix] - profile[ix]);
    }
    lines.push(
        `Option "${option.name}": ${pyFixed(stations[last], 0)} ${units} long, ${x.length} alignment points, ` +
        `max grade ${pyFixed(maxGrade, 1)}%, max cut ${pyFixed(Math.max(0, maxDepth), 1)}, max fill ${pyFixed(Math.max(0, -minDepth), 1)}`
    );
    for (const structure of structures.filter(({type}) => type === 'existingRoad')) {
        const {names, grade, steepest} = existingRoadGrades(roads, design.minRadius, x, y, profile, stations, structure);
        const gradeText = grade === null ? '' : ` - its grade averages ${pyFixed(grade, 1)}%` +
            `${steepest > grade ? `, ${pyFixed(steepest, 1)}% over its steepest ${formatNumber(design.minRadius)} ${units}` : ''}`;
        lines.push(
            `Existing road: stations ${pyFixed(structure.station, 1)} to ${pyFixed(structure.endStation, 1)}` +
            `${names.length > 0 ? ` (${names.join(', ')})` : ''}${gradeText}`
        );
    }
    const counts = [];
    for (const [type, name] of Object.entries(structureNames)) {
        const count = structures.filter((structure) => structure.type === type).length;
        if (count > 0) {
            counts.push(`${count} ${name}${count === 1 ? '' : 's'}`);
        }
    }
    lines.push(`Structures: ${counts.join(', ') || 'none'}`);
    const analysis = analyzeOption(plan, plan.options.indexOf(option), topo);
    lines.push(`Cost score: ${formatNumber(analysis.score, 1)}, design warnings: ${analysis.warnings.length}`);

    // A road within its minimum radius of the site's edge has no room there - the site may be too small for it (unless
    // its start or end point is as near the edge)
    let ixEdge = 0;
    const edgeDistance = (ix) => Math.min(x[ix], y[ix], topo.width - x[ix], topo.height - y[ix]);
    for (let ix = 1; ix <= last; ix++) {
        if (edgeDistance(ix) < edgeDistance(ixEdge)) {
            ixEdge = ix;
        }
    }
    if (edgeDistance(ixEdge) < Math.min(design.minRadius, edgeDistance(0), edgeDistance(last))) {
        lines.push(
            `NOTE: the road is ${pyFixed(Math.max(0, edgeDistance(ixEdge)), 0)} ${units} from the site's edge at station ` +
            `${pyFixed(stations[ixEdge], 0)} - the site may be too small for the best route (the site model's "margin")`
        );
    }

    // A draw that isn't a stream of the plan has no culvert where the road crosses it
    const crossings = drawCrossings(topo, units, x, y, stations, mask);
    if (crossings.length > 0) {
        const texts = crossings.map((crossing) => (
            `draw ${crossing.number} (${drawAreaText(units, crossing.area)}) at station ${pyFixed(crossing.station, 0)} ` +
            `(${pyFixed(crossing.x, 0)},${pyFixed(crossing.y, 0)})`
        ));
        lines.push(
            `NOTE: the road crosses ${crossings.length === 1 ? 'an unmapped draw' : `${crossings.length} unmapped draws`} - ` +
            `${texts.join(', ')} - a draw that carries water needs a culvert: add it as a stream ("plan draws"), and engineer ` +
            'the road again'
        );
    }
    return lines;
}


// The structure types' names, in the report's order
const structureNames = {
    'existingRoad': 'existing road', 'bridge': 'bridge', 'culvert': 'culvert', 'retainingWall': 'retaining wall', 'turnout': 'turnout'
};
