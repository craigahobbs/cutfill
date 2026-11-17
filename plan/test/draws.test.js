import {drawsUsage, topoDraws} from '../lib/draws.js';
import assert from 'node:assert/strict';
import {cliMain} from '../lib/cli.js';
import {planText} from '../lib/planFile.js';
import {planTopo} from '../../viewer/lib/model.js';
import test from 'node:test';
import {testIo} from './terrainHelpers.js';


// Create a plan of a grid of elevations from a function of x and y - 10 foot (or meter) spacing
function gridPlan(nCols, nRows, elevationFn, units = 'feet') {
    const elevations = [];
    for (let row = 0; row < nRows; row++) {
        const y = (nRows - 1 - row) * 10;
        elevations.push(Array.from({'length': nCols}, (unused, col) => Math.round(elevationFn(col * 10, y) * 1000) / 1000));
    }
    return {
        'title': 'Draws',
        units,
        'topography': {'spacing': 10, elevations},
        'start': {'x': 10, 'y': 10},
        'end': {'x': 90, 'y': 90},
        'options': []
    };
}


// A plan of a valley down to the south, along x = 100 - 200 x 300 feet (or meters), with a hump across it (or not)
function valleyPlan(units = 'feet', hump = 0) {
    return gridPlan(21, 31, (x, y) => 100 + 0.5 * Math.abs(x - 100) + 0.05 * y + (y === 100 ? hump : 0), units);
}


// The valley plan, with a stream
function streamPlan(points) {
    const plan = valleyPlan();
    plan.topography.features = [{'type': 'stream', 'name': 'Creek', 'points': points.map(([x, y]) => ({x, y}))}];
    return plan;
}


// A plan of a valley down to the south (along x = 100), with a side valley from the east (along y = 120)
function forkPlan() {
    return gridPlan(21, 31, (x, y) => {
        if (x === 100) {
            return 98 + 0.1 * y;
        } else if (y === 120 && x > 100) {
            return 110 + 0.03 * (x - 100);
        }
        return 100 + 0.1 * y + 0.02 * Math.abs(x - 100);
    });
}


// A plan of 24 valleys down to the south, 40 feet apart - 1,000 x 300 feet
function valleysPlan() {
    return gridPlan(101, 31, (x, y) => 100 + 0.1 * y + 0.2 * Math.abs((x + 20) % 40 - 20) + 0.0001 * x);
}


// Run the "draws" command on a plan ("road.json") - returns its exit code, its output, and the written plan (null if
// it wasn't written)
async function draws(args, plan = valleyPlan()) {
    const io = testIo({'files': {'road.json': typeof plan === 'string' ? plan : JSON.stringify(plan)}});
    const code = await cliMain(['draws', 'road.json', ...args], io);
    const written = io.written.includes('road.json') ? io.files['road.json'] : null;
    return {code, 'output': io.output.join(''), written, 'plan': written !== null ? JSON.parse(written) : null};
}


// The draws list's last line
const addLine = 'Add each draw that a road might cross as a stream - "plan draws road.json --add NUMBER -n NAME" (--end X,Y ends it there)';


test('topoDraws', () => {
    // The valley is the plan's draw - from where it drains the area (0.1 acres) down to the grid's south edge. The
    // grid's edge points drain off the grid, so the draw drains the 552 points within it and above its end.
    const [draw, ...others] = topoDraws(planTopo(valleyPlan()), 4356);
    assert.deepEqual(others, []);
    assert.equal(draw.area, 55200);
    assert.deepEqual(draw.points, Array.from({'length': 28}, (unused, ix) => [100, 270 - ix * 10]));

    // The area that drains to each of its points - more at each point down the valley
    assert.equal(draw.areas.length, 28);
    assert.deepEqual([draw.areas[0], draw.areas.at(-1)], [5700, 55200]);
    assert.ok(draw.areas.every((area, ix) => ix === 0 || area > draw.areas[ix - 1]));

    // A larger area's draw starts farther down the valley
    assert.deepEqual(topoDraws(planTopo(valleyPlan()), 21780)[0].points[0], [100, 180]);

    // No point of the plan drains two acres
    assert.deepEqual(topoDraws(planTopo(valleyPlan()), 87120), []);
});


test('topoDraws, a hollow', () => {
    // A hump across the valley (a road's fill) makes a hollow above it - the hollow is filled, so the draw is the
    // same, down to the grid's edge
    const [draw, ...others] = topoDraws(planTopo(valleyPlan('feet', 5)), 4356);
    const [valley] = topoDraws(planTopo(valleyPlan()), 4356);
    assert.deepEqual(others, []);
    assert.deepEqual([draw.area, draw.points], [valley.area, valley.points]);
});


test('topoDraws, a side draw', () => {
    // The side valley's draw ends at its point on the main valley's draw, which is longer - the largest draw is first
    const [main, side, ...others] = topoDraws(planTopo(forkPlan()), 3100);
    assert.deepEqual(others, []);
    assert.deepEqual([main.area, main.points[0], main.points.at(-1), main.points.length], [23200, [100, 190], [100, 0], 20]);
    assert.deepEqual([side.area, side.areas.at(-2), side.areas.at(-1)], [14600, 14600, 14600]);
    assert.deepEqual(side.points, [...[180, 170, 160, 150, 140, 130, 120, 110].map((x) => [x, 120]), [100, 110]]);
    assert.ok(main.points.some(([x, y]) => x === 100 && y === 110));
});


test('draws', async () => {
    // The plan's draws that drain at least 3 acres - it has none
    assert.deepEqual(await draws([]), {
        'code': 0, 'output': 'No draws drain at least 3 acres (but for those along the plan\'s streams)\n', 'written': null, 'plan': null
    });

    // A draw's number, its drainage area, its length, and where it starts and ends
    assert.deepEqual([(await draws(['--area', '0.1'])).output], [`\
Draws that drain at least 0.1 acres, and aren't along the plan's streams - the largest first:
1: drains 1.3 acres - 270 feet long, from 100,270 to 100,0
${addLine}
`]);

    // A meters plan's areas are hectares - a draw drains at least 1.2 hectares
    assert.deepEqual((await draws([], valleyPlan('meters'))).output, `\
Draws that drain at least 1.2 hectares, and aren't along the plan's streams - the largest first:
1: drains 5.5 hectares - 230 meters long, from 100,230 to 100,0
${addLine}
`);

    // A draw shorter than 100 feet isn't listed - the side draw is 84 feet
    assert.deepEqual((await draws(['--area', '0.07'], forkPlan())).output, `\
Draws that drain at least 0.07 acres, and aren't along the plan's streams - the largest first:
1: drains 0.53 acres - 190 feet long, from 100,190 to 100,0
${addLine}
`);
});


test('draws, many draws', async () => {
    // The 20 largest draws are listed
    const lines = (await draws(['--area', '0.1'], valleysPlan())).output.split('\n');
    assert.equal(lines.length, 24);
    assert.equal(lines[1], '1: drains 0.27 acres - 180 feet long, from 40,180 to 40,0');
    assert.equal(lines[20], '20: drains 0.27 acres - 180 feet long, from 800,180 to 800,0');
    assert.deepEqual(lines.slice(21), ['... and 4 smaller draws', addLine, '']);
});


test('draws, the plan\'s streams', async () => {
    // A draw along a stream isn't listed
    assert.equal(
        (await draws(['--area', '0.1'], streamPlan([[100, 300], [100, 0]]))).output,
        'No draws drain at least 0.1 acres (but for those along the plan\'s streams)\n'
    );

    // A draw above a stream is its part down to the stream - within 50 feet of it - and the area that part drains
    assert.equal((await draws(['--area', '0.1'], streamPlan([[100, 100], [100, 0]]))).output, `\
Draws that drain at least 0.1 acres, and aren't along the plan's streams - the largest first:
1: drains 0.61 acres - 120 feet long, from 100,270 to 100,150
${addLine}
`);

    // A stream away from the draw isn't its stream
    assert.ok((await draws(['--area', '0.1'], streamPlan([[10, 300], [10, 0]]))).output.includes('270 feet long, from 100,270 to 100,0'));
});


test('draws, add a draw', async () => {
    // The draw is added as a stream - its line, simplified
    const added = await draws(['--area', '0.1', '--add', '1', '-n', 'Draw']);
    let {code, output, plan} = added;
    assert.deepEqual([code, output], [0, `\
Added stream "Draw": draw 1 (drains 1.3 acres), 2 points, 270 feet long, from 100,270 to 100,0
Wrote road.json - plot it to check the stream against the terrain
`]);
    assert.deepEqual(plan.topography.features, [{'type': 'stream', 'name': 'Draw', 'points': [{'x': 100, 'y': 270}, {'x': 100, 'y': 0}]}]);
    assert.equal(added.written, planText(plan));
    assert.deepEqual({...plan, 'topography': {'spacing': 10, 'elevations': plan.topography.elevations}}, valleyPlan());

    // It's along a stream now, so it isn't a draw
    assert.equal(
        (await draws(['--area', '0.1'], plan)).output,
        'No draws drain at least 0.1 acres (but for those along the plan\'s streams)\n'
    );
    assert.deepEqual(await draws(['--area', '0.1', '--add', '1'], plan), {
        'code': 1, 'output': 'error: no draw 1 - run "plan draws road.json" for the plan\'s draws\n', 'written': null, 'plan': null
    });

    // A stream without a name, to the draw's point nearest an end point - it drains the area above that point
    ({code, output, plan} = await draws(['--area', '0.1', '--add', '1', '--end', '90,205']));
    assert.deepEqual([code, output], [0, `\
Added stream: draw 1 (drains 0.39 acres), 2 points, 60 feet long, from 100,270 to 100,210
Wrote road.json - plot it to check the stream against the terrain
`]);
    assert.deepEqual(plan.topography.features, [{'type': 'stream', 'points': [{'x': 100, 'y': 270}, {'x': 100, 'y': 210}]}]);

    // A draw above a stream is added down to the stream - after the plan's features
    ({plan} = await draws(['--area', '0.1', '--add', '1', '-n', 'Upper Creek'], streamPlan([[100, 100], [100, 0]])));
    assert.deepEqual(plan.topography.features, [
        {'type': 'stream', 'points': [{'x': 100, 'y': 100}, {'x': 100, 'y': 0}], 'name': 'Creek'},
        {'type': 'stream', 'name': 'Upper Creek', 'points': [{'x': 100, 'y': 270}, {'x': 100, 'y': 150}]}
    ]);

    // A draw that isn't one of the plan's, and an end point at the draw's head
    assert.deepEqual(await draws(['--area', '0.1', '--add', '2']), {
        'code': 1, 'output': 'error: no draw 2 - run "plan draws road.json" for the plan\'s draws\n', 'written': null, 'plan': null
    });
    assert.deepEqual(await draws(['--area', '0.1', '--add', '1', '--end', '100,300']), {
        'code': 1, 'output': 'error: draw 1 ends at its head at 100,300\n', 'written': null, 'plan': null
    });
});


test('draws, a plan that cannot be loaded', async () => {
    const io = testIo();
    assert.equal(await cliMain(['draws', 'missing.json'], io), 1);
    assert.equal(io.output.join(''), 'error: Could not load the road plan "missing.json"\n');
    assert.deepEqual(
        [(await draws([], '{"title": "Plan"}')).code, (await draws([], '{"title": "Plan"}')).output.split('\n')[0]],
        [1, 'error: The road plan "road.json" is invalid:']
    );
});


test('draws, usage', async () => {
    const usage = `${drawsUsage.join('\n')}\n`;
    assert.ok(usage.startsWith('usage: plan draws <plan.json> [--area AREA]\n'));
    const io = testIo();
    assert.equal(await cliMain(['draws', '-h'], io), 0);
    assert.equal(io.output.join(''), usage);

    // Invalid arguments - no plan (or two), areas and numbers that aren't, a name or an end point without a draw to
    // add, and an end point that isn't a point
    for (const args of [
        [], ['other.json'], ['--area', '0'], ['--area', 'big'], ['--add', '0'], ['--add', '1.5'], ['--add', 'one'], ['-n', 'Draw'],
        ['--end', '10,10'], ['--add', '1', '-n', ''], ['--add', '1', '--end', '10'], ['--add', '1', '--end', '10,ten'],
        ['--add', '1', '--end', ','], ['--unknown']
    ]) {
        const invalid = testIo({'files': {'road.json': JSON.stringify(valleyPlan())}});
        const argv = args.length === 0 ? ['draws'] : ['draws', 'road.json', ...args];
        assert.equal(await cliMain(argv, invalid), 1, args.join(' '));
        assert.equal(invalid.output.join(''), usage, args.join(' '));
    }
});
