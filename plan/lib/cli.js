// cli.js - the Roadie planning tools' command line (see bin/plan.js)

import {autoCommand, autoUsage} from './auto.js';
import {describeCommand, describeUsage, keepCommand, keepUsage} from './options.js';
import {draftCommand, draftUsage} from './draft.js';
import {drawsCommand, drawsUsage} from './draws.js';
import {featureCommand, featureUsage} from './featureCommand.js';
import {locateCommand, locateUsage} from './locate.js';
import {optionsUsage, routeCommands, routeUsage} from './routeCli.js';
import {plotCommand, plotUsage} from './plot.js';
import {siteCommand, siteUsage} from './siteCommand.js';
import {cliMain as roadieMain} from '../../viewer/lib/cli.js';
import {roadieTypes} from '../../viewer/lib/model.js';
import {schemaDocMarkdown} from '../../viewer/lib/schemaDoc.js';
import {siteTypes} from './site.js';


// The command line's usage text lines
const usage = [
    'usage: plan auto <site.json> <plan.json> [--model MODEL]',
    '       plan site <site.json> <plan.json>',
    '       plan plot <plan.json> <plot.png> [--box X1,Y1,X2,Y2]',
    '       plan locate <plan.json> [--xy] <latitude,longitude | x,y>...',
    '       plan feature <plan.json> TYPE [-n NAME] X,Y X,Y...',
    '       plan draws <plan.json> [--add NUMBER]...',
    '       plan options <plan.json> [options]',
    '       plan route <plan.json> -n NAME [-v X,Y]... [options]',
    '       plan profile <plan.json> -n NAME [options]',
    '       plan evaluate <plan.json> [--detail]',
    '       plan keep <plan.json> NAME...',
    '       plan draft <plan.json> <descriptions.md>',
    '       plan describe <plan.json> <descriptions.md>',
    '       plan doc [site | plan]',
    '',
    '  auto      Plan a road by procedure - its site, options, and descriptions - asking a model what the site\'s',
    '            notes ask for',
    '  site      Create a road plan model\'s site from a road site model - its topography (USGS lidar terrain),',
    '            georeference, start and end points, features, and topographic map image',
    '  plot      Plot a road plan model - its terrain, features, and options',
    '  locate    Convert latitudes and longitudes to a road plan model\'s coordinates, and back',
    '  feature   Add a topographic feature to a road plan model, or remove its features of a name',
    '  draws     List a road plan model\'s draws - the valleys of its terrain that aren\'t along its streams - or add',
    '            one as a stream',
    '  options   Engineer a road plan model\'s standard options - the road that follows its existing roads, and an',
    '            all-new road',
    '  route     Engineer a road option - its alignment (following existing roads where that costs less), profile,',
    '            and structures',
    '  profile   Re-design an existing option\'s profile and structures',
    '  evaluate  Print a road plan model\'s analysis and cost (--detail adds each option\'s station table)',
    '  keep      Keep a road plan model\'s named options, in cost score order, and remove its others',
    '  draft     Write a draft of a road plan model\'s descriptions - the plan\'s and its options\' facts',
    '  describe  Set a road plan model\'s and its options\' descriptions from a Markdown file',
    '  doc       Print the road site model documentation - or the road plan model documentation',
    '',
    'Each command\'s usage is its "-h" argument\'s output. The commands that change a plan are logged, in order, in',
    'its work directory ("<plan>.work/commands.txt").'
];


// The "evaluate" command - a road plan model's analysis and cost (the Roadie command line's)
function evaluateCommand(args, io) {
    const files = args.filter((arg) => arg !== '--detail');
    if (files.length !== 1 || files[0].startsWith('-')) {
        return null;
    }
    const output = [];
    const code = roadieMain(['evaluate', ...args], {'readFile': io.readFile, 'write': (text) => output.push(text)});
    return {code, 'lines': output.join('').replace(/\n$/, '').split('\n')};
}


// The "doc" command - the road site model's documentation, or the road plan model's
function docCommand(args) {
    const [model = 'site'] = args;
    if (args.length > 1 || (model !== 'site' && model !== 'plan')) {
        return null;
    }
    return {'code': 0, 'lines': model === 'site' ? schemaDocMarkdown(siteTypes, 'RoadSite') : schemaDocMarkdown(roadieTypes, 'RoadPlan')};
}


// The commands - each is a function of the command's arguments and the command line's input and output functions
// (see bin/plan.js) that returns the command's exit code and its output text lines, or null if the arguments are
// invalid - and each command's usage text lines
const commands = {
    'auto': [autoCommand, autoUsage],
    'site': [siteCommand, siteUsage],
    'plot': [plotCommand, plotUsage],
    'locate': [locateCommand, locateUsage],
    'feature': [featureCommand, featureUsage],
    'draws': [drawsCommand, drawsUsage],
    'options': [routeCommands.options, optionsUsage],
    'route': [routeCommands.route, routeUsage],
    'profile': [routeCommands.profile, routeUsage],
    'evaluate': [evaluateCommand, usage],
    'keep': [keepCommand, keepUsage],
    'draft': [draftCommand, draftUsage],
    'describe': [describeCommand, describeUsage],
    'doc': [docCommand, usage]
};


// The commands that change a road plan model - they're logged in the plan's work directory
const planCommands = ['auto', 'site', 'feature', 'draws', 'options', 'route', 'profile', 'keep', 'describe'];


// The plan's work directory's log of the commands that changed the plan
const commandLog = 'commands.txt';


// A command argument that needs no quotes in the command log
const rPlainArg = /^[\w@%+=:,./-]+$/;


// The command line's main entry point - "io" is the command line's input and output functions. Its "write" function
// writes the output text. Returns the process exit code.
//
// A command that changes a road plan model is logged in the plan's work directory ("<plan>.work/commands.txt") - the
// commands that made the plan, in order, for the plan's update.
export async function cliMain(argv, io) {
    const [name, ...args] = argv;
    const [command, commandUsage] = Object.hasOwn(commands, name) ? commands[name] : [() => null, usage];
    const help = argv.includes('-h') || argv.includes('--help');
    const written = [];
    const commandIo = {...io, 'writeFile': (path, text) => {
        written.push(path);
        io.writeFile(path, text);
    }};
    const result = help ? {'code': 0, 'lines': commandUsage} : await command(args, commandIo) ?? {'code': 1, 'lines': commandUsage};
    // The plan is the last JSON file a command writes, but for its work directory's - whose name is the site command's
    const planPath = written.findLast((path) => /\.json$/i.test(path) && !path.includes('.work/')) ?? null;
    if (result.code === 0 && planCommands.includes(name) && planPath !== null) {
        const logPath = `${planPath.replace(/\.json$/i, '')}.work/${commandLog}`;
        let log = '';
        try {
            log = io.readFile(logPath);
        } catch {
            // The plan's first command
        }
        const line = ['plan.js', ...argv].map((arg) => (rPlainArg.test(arg) ? arg : `'${arg.replaceAll('\'', '\'\\\'\'')}'`)).join(' ');
        io.writeFile(logPath, `${log}${line}\n`);
    }
    io.write(`${result.lines.join('\n')}\n`);
    return result.code;
}
