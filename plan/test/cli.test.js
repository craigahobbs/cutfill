import assert from 'node:assert/strict';
import {cliMain} from '../lib/cli.js';
import test from 'node:test';


// Run the command line - returns the exit code and the output
async function run(argv) {
    const output = [];
    const code = await cliMain(argv, {'write': (text) => output.push(text)});
    return {code, 'output': output.join('')};
}


// The command line's usage
const usage = `\
usage: plan auto <site.json> <plan.json> [--model MODEL] [--fresh] [--fetch] [options]
       plan site <site.json> <plan.json> [--fetch]
       plan options <plan.json> [options]
       plan route <plan.json> -n NAME [-v X,Y]... [options]

  auto      Plan a road by procedure - its site, options, and descriptions - as the Roadie application does
            (without a model)
  site      Create a road plan model's site from a road site model - its topography (USGS lidar terrain),
            georeference, start and end points, features, and topographic map image
  options   Engineer a road plan model's standard options - the road that follows its existing roads, an
            all-new road, and another corridor
  route     Engineer a road option - its alignment (following existing roads where that costs less), profile,
            and structures

Each command's usage is its "-h" argument's output.
`;


test('cliMain usage', async () => {
    assert.deepEqual(await run([]), {'code': 1, 'output': usage});
    assert.deepEqual(await run(['unknown']), {'code': 1, 'output': usage});
    assert.deepEqual(await run(['toString']), {'code': 1, 'output': usage});
    assert.deepEqual(await run(['plot', 'plan.json', 'plan.png']), {'code': 1, 'output': usage});
});


test('cliMain help', async () => {
    // The usage, when it's asked for - the command line's, and a command's
    assert.deepEqual(await run(['-h']), {'code': 0, 'output': usage});
    assert.deepEqual(await run(['unknown', '--help']), {'code': 0, 'output': usage});
    const route = await run(['route', '-h']);
    assert.equal(route.code, 0);
    assert.ok(route.output.startsWith('usage: plan route <plan.json> -n NAME [-v X,Y]... [options]\n'));
    assert.deepEqual(await run(['route']), {'code': 1, 'output': route.output});
});
