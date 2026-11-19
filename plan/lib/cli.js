// cli.js - the SageRoad planning tools' command line (see bin/plan.js) - for the tools' development: a road is planned in
// the SageRoad application. The commands read and write a plan's files - the tools they run make the plan in memory.

import {
    corridorNames, corridorOption, engineerOption, keepOptions, roadSurfaces, ruledOutError, standardOptions
} from './engineer.js';
import {loadSite, siteCommand, siteUsage} from './siteCommand.js';
import {readPlan, writePlan} from './planFile.js';
import {autoPlan} from './auto.js';
import {parseArgs} from 'node:util';
import {planTopo} from '../../viewer/lib/model.js';


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
    '  --model MODEL          the Ollama model to ask (default is none - the site\'s notes aren\'t read) - the SageRoad',
    '                         application\'s (the command line doesn\'t ask a model)',
    '  --fresh                ask the model again - don\'t use its saved answer, and look for the notes\' places again',
    '  --fetch                fetch the site\'s data from the USGS again - an existing plan\'s, if it\'s the site\'s, is kept',
    '  -w, --width WIDTH      the road width (default is the notes\', or 14 feet / 4.3 meters)',
    '  -s, --surface SURFACE  the road surface - native, gravel, asphalt, or concrete (default is the notes\', or gravel)'
];


// The design options' usage text lines - the route and options commands'
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


// The route command's usage text lines
export const routeUsage = [
    'usage: plan route <plan.json> -n NAME [-v X,Y]... [options]',
    '',
    '  Engineer a road option - a least-cost horizontal alignment search (through the via points), a vertical profile',
    '  design, and structures - and add it to the road plan model (or replace it). The route follows the plan\'s',
    '  existing roads where that costs less than a new road. The road is the one with the lowest cost score of the',
    '  searches with each grade penalty weight.',
    '',
    '  A road is within its grade limit: where its profile can\'t be - it can\'t reach the end point\'s ground, or an',
    '  existing road\'s - it\'s an error, and the option isn\'t written.',
    '',
    'options:',
    '  -n, --name NAME                the option name (an existing option is replaced)',
    '  -d, --description TEXT         an option description line (may be repeated)',
    ...designUsage,
    '  --existing-road STATION,END    a station range where the road follows an existing road - its grade follows',
    '                                 the ground, with no earthwork or structures (may be repeated - by default,',
    '                                 the route finds them)',
    '  -v, --via X,Y                  a via point (may be repeated)',
    '  --all-new                      an all-new road - the route doesn\'t follow the plan\'s existing roads',
    '  --rule-out NAME                an existing road that the route doesn\'t follow - a private or closed road,',
    '                                 say (may be repeated)',
    '  --grade-weight WEIGHT          the route search\'s penalty weight for ground steeper than the design grade',
    '                                 (default is the weight of 1, 0.5, and 0.25 whose road has the lowest cost',
    '                                 score)',
    '  --slope-weight WEIGHT          the side slope earthwork weight (default is 1)'
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
    '  X Corridor      Another corridor (North, South, East, or West of the least-cost road) - the least-cost road',
    '                  around the middles of the roads above, through the middle of that search\'s road ("plan route',
    '                  --via"), if it\'s a real choice: within the grade limit, apart from them, and at most three times',
    '                  the least-cost road\'s cost score',
    '',
    '  The plan\'s options of those names are replaced, and its other options are kept as they are. Run it again after',
    '  the plan\'s features or criteria change.',
    '',
    'options:',
    ...designUsage,
    '  --rule-out NAME                an existing road that the roads don\'t follow - a private or closed road, say',
    '                                 (may be repeated)'
];


// The "auto" command's options
const autoOptions = {
    'model': {'type': 'string'},
    'fresh': {'type': 'boolean', 'default': false},
    'fetch': {'type': 'boolean', 'default': false},
    'width': {'type': 'string', 'short': 'w'},
    'surface': {'type': 'string', 'short': 's'}
};


// The "auto" command - plan a road by procedure (autoPlan), from the plan config's file to the plan's. The plan
// config's file is written if the run changed it (its marks, or its margin). "io" is the tools' input and output
// functions. Returns the command's exit code and its output text lines, or null if its arguments are invalid.
export async function autoCommand(args, io) {
    let parsed;
    try {
        parsed = parseArgs({args, 'options': autoOptions, 'allowPositionals': true});
    } catch {
        return null;
    }
    const {values, positionals} = parsed;
    const width = 'width' in values ? Number(values.width) : null;
    if (positionals.length !== 2 || values.model === '' || (width !== null && !(width > 0)) ||
        ('surface' in values && !roadSurfaces.includes(values.surface))) {
        return null;
    }
    const [sitePath, planPath] = positionals;
    const loaded = loadSite(io, sitePath, planPath);
    if ('error' in loaded) {
        return {'code': 1, 'lines': loaded.error};
    }

    // Plan the road, and write its files - a plan that failed is its site (and the options it had)
    const {code, lines, plan, site} = await autoPlan(io, planPath, loaded.site, loaded.plan, {
        'model': values.model ?? null, 'isFresh': values.fresh, 'isFetch': values.fetch, width, 'surface': values.surface ?? null
    });
    if (site !== loaded.site) {
        io.writeFile(sitePath, `${JSON.stringify(site, null, 4)}\n`);
    }
    if (plan !== null) {
        writePlan(io, planPath, plan);
    }
    return {code, 'lines': [...loaded.lines, ...lines, ...(code === 0 ? [`Wrote ${planPath}`] : [])]};
}


// The commands' design options and road rule options, and the route command's option options and route options
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
const ruleOptions = {
    'rule-out': {'type': 'string', 'multiple': true}
};
const routeOptions = {
    'via': {'type': 'string', 'short': 'v', 'multiple': true},
    'all-new': {'type': 'boolean', 'default': false},
    'grade-weight': {'type': 'string'},
    'slope-weight': {'type': 'string', 'default': '1'}
};


// Parse a command's arguments - returns the arguments object, or null if they're invalid
function parseCommandArgs(command, args) {
    let parsed;
    try {
        const options = {...designOptions, ...ruleOptions, ...(command === 'route' ? {...optionOptions, ...routeOptions} : {})};
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
        'ruleOut': values['rule-out'] ?? [],
        'gradeWeight': number('grade-weight'),
        'slopeWeight': number('slope-weight')
    };

    // The plan, the option name (but for the options command), and valid numbers are required
    if (positionals.length !== 1 || (command !== 'options' && commandArgs.name === undefined) ||
        !roadSurfaces.includes(commandArgs.surface) ||
        Object.values(commandArgs).some(Number.isNaN) ||
        [...commandArgs.existingRoads ?? [], ...commandArgs.via].some((pair) => pair.length !== 2 || pair.some(Number.isNaN))) {
        return null;
    }
    return commandArgs;
}


// Read a command's plan - returns the "plan" and its topography ("topo"), or the command's "error" result (the plan
// can't be loaded, or it has no existing road of a name that's ruled out)
function commandPlan(io, commandArgs) {
    const {plan, error} = readPlan(io, commandArgs.plan);
    if (error !== undefined) {
        return {'error': {'code': 1, 'lines': error}};
    }
    const topo = planTopo(plan);
    const ruleOutError = ruledOutError(topo, commandArgs.ruleOut);
    return ruleOutError !== null ? {'error': {'code': 1, 'lines': [ruleOutError]}} : {plan, topo};
}


// The "route" command - engineer an option of a plan
export function routeCommand(args, io) {
    const commandArgs = parseCommandArgs('route', args);
    if (commandArgs === null) {
        return null;
    }
    const {plan, topo, error} = commandPlan(io, commandArgs);
    if (error !== undefined) {
        return error;
    }
    const engineered = engineerOption(plan, topo, commandArgs);
    if (engineered.error !== null) {
        return {'code': 1, 'lines': [...engineered.lines, `error: ${engineered.error}`]};
    }
    writePlan(io, commandArgs.plan, plan);
    return {'code': 0, 'lines': [...engineered.lines, `Wrote ${commandArgs.plan}`]};
}


// The "options" command - engineer a plan's standard options and another corridor, and put its options in cost score
// order. The result has the options' "names", whether a standard option is at the site's edge ("atEdge" - the site may
// be too small for it), and the description's note of another corridor that isn't an option ("corridorNote" - or null).
export function optionsCommand(args, io) {
    const commandArgs = parseCommandArgs('options', args);
    if (commandArgs === null) {
        return null;
    }
    const {plan, topo, error} = commandPlan(io, commandArgs);
    if (error !== undefined) {
        return error;
    }
    const standard = standardOptions(plan, topo, commandArgs);
    if (standard.error !== null) {
        return {'code': 1, 'lines': [...standard.lines, `error: ${standard.error}`]};
    }
    const corridor = corridorOption(plan, topo, commandArgs, standard.followsRoads);
    const optionLines = keepOptions(plan, topo);
    writePlan(io, commandArgs.plan, plan);
    return {
        'code': 0,
        'lines': [...standard.lines, ...corridor.lines, ...optionLines, `Wrote ${commandArgs.plan}`],
        'names': plan.options.map(({name}) => name).filter((name) => standard.names.includes(name) || corridorNames.includes(name)),
        'atEdge': standard.atEdge,
        'corridorNote': corridor.note
    };
}


// The commands' synopses - each command's usage's first lines
const synopsis = [autoUsage, siteUsage, optionsUsage, routeUsage].flatMap(
    (usageLines) => usageLines.slice(0, usageLines.indexOf('')).map((line) => line.replace(/^usage: /, ''))
);


// The command line's usage text lines
const usage = [
    ...synopsis.map((line, ixLine) => `${ixLine === 0 ? 'usage:' : '      '} ${line}`),
    '',
    '  auto      Plan a road by procedure - its site, options, and descriptions - as the SageRoad application does',
    '            (without a model)',
    '  site      Create a road plan model\'s site from a road site model - its topography (USGS lidar terrain),',
    '            georeference, start and end points, features, and topographic map image',
    '  options   Engineer a road plan model\'s standard options - the road that follows its existing roads, an',
    '            all-new road, and another corridor',
    '  route     Engineer a road option - its alignment (following existing roads where that costs less), profile,',
    '            and structures',
    '',
    'Each command\'s usage is its "-h" argument\'s output.'
];


// The commands - each is a function of the command's arguments and the command line's input and output functions
// (see bin/plan.js) that returns the command's exit code and its output text lines, or null if the arguments are
// invalid - and each command's usage text lines
const commands = {
    'auto': [autoCommand, autoUsage],
    'site': [siteCommand, siteUsage],
    'options': [optionsCommand, optionsUsage],
    'route': [routeCommand, routeUsage]
};


// The command line's main entry point - "io" is the command line's input and output functions. Its "write" function
// writes the output text. Returns the process exit code.
export async function cliMain(argv, io) {
    const [name, ...args] = argv;
    const [command, commandUsage] = Object.hasOwn(commands, name) ? commands[name] : [() => null, usage];
    const help = argv.includes('-h') || argv.includes('--help');
    const result = help ? {'code': 0, 'lines': commandUsage} : await command(args, io) ?? {'code': 1, 'lines': commandUsage};
    io.write(`${result.lines.join('\n')}\n`);
    return result.code;
}
