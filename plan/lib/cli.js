// cli.js - the Roadie planning tools' command line (see bin/plan.js) - for the tools' development: a road is planned in
// the Roadie application

import {autoCommand, autoUsage} from './auto.js';
import {optionsUsage, routeCommands, routeUsage} from './routeCli.js';
import {siteCommand, siteUsage} from './siteCommand.js';


// The commands' synopses - each command's usage's first lines
const synopsis = [autoUsage, siteUsage, optionsUsage, routeUsage].flatMap(
    (usageLines) => usageLines.slice(0, usageLines.indexOf('')).map((line) => line.replace(/^usage: /, ''))
);


// The command line's usage text lines
const usage = [
    ...synopsis.map((line, ixLine) => `${ixLine === 0 ? 'usage:' : '      '} ${line}`),
    '',
    '  auto      Plan a road by procedure - its site, options, and descriptions - as the Roadie application does',
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
    'options': [routeCommands.options, optionsUsage],
    'route': [routeCommands.route, routeUsage]
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
