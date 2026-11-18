import {draftLines, draftUsage, lineRuns} from '../lib/draft.js';
import {planePlan, roadPlan} from './roadFixtures.js';
import assert from 'node:assert/strict';
import {cliMain} from '../lib/cli.js';
import {fixturePlan} from '../../viewer/test/fixture.js';
import test from 'node:test';
import {testIo} from './terrainHelpers.js';


// The draft's limitations
const limitations = '**Limitations.** The terrain is the USGS 3D Elevation Program\'s lidar ground elevations, and the streams, ' +
    'roads, and trails are the USGS National Map\'s. What they lack - buildings, property lines, utilities, and unmapped roads and ' +
    'drainages - isn\'t in the plan unless it was added. Turnarounds aren\'t modeled. The cost scores compare the options - they ' +
    'aren\'t bid estimates.';


// The existing roads' upgrade line
const upgrade = '- **Existing road upgrade.** An existing road is costed as an upgrade, with no earthwork - verify its width, grade, ' +
    'and surface in the field.';


// Run a planning command on a plan ("road.json") - returns the plan's files
async function command(plan, args) {
    const io = testIo({'files': {'road.json': JSON.stringify(plan)}});
    assert.equal(await cliMain([args[0], 'road.json', ...args.slice(1)], io), 0);
    return io;
}


test('draft', async () => {
    // The fixture plan's draft - the plan's facts, and each option's
    const io = await command(fixturePlan(), ['draft', 'work/descriptions.md']);
    assert.equal(
        io.output.join(''),
        'Wrote work/descriptions.md - the plan\'s and 2 options\' facts. Add what the tools don\'t know, and set the descriptions ' +
            'with "plan describe road.json work/descriptions.md"\n'
    );
    assert.deepEqual(io.written, ['work/descriptions.md']);
    assert.equal(io.files['work/descriptions.md'], `\
# Plan

**The site.** From "Road" (elevation 504 feet) to the end point (elevation 533 feet). The straight line between them climbs 30 \
feet in 422 feet (7.1%).

**Design criteria.** Maximum grade 12%, minimum curve radius 50 feet, maximum retaining wall height 20 feet.

${limitations}

# Option: Direct

The least-cost option - its cost score is 48.6. It's 440 feet long and 12 feet wide, gravel, and its maximum grade is 20.9%.

- **Line.** From the start, it runs northeast for about 200 feet, east for about 110 feet, and northeast for about 130 feet to the end.
- **Structures.** 1 culvert (Creek culvert, station 2+11, 1.5 ft), 1 retaining wall (stations 2+60 to 3+00), 1 turnout.
- **Earthwork.** 108 cy of cut and 338 cy of fill, with 237 cy of borrow (import). Its deepest cut is 2.0 feet (station 3+43). \
Its deepest fill is 7.0 feet (station 2+13).
- **Cost.** Its largest items: surfacing (gravel) 10.2, culverts (1) 10.1, retaining walls 6.1.
- **Design warnings.** Grade 20.9% exceeds the maximum grade (12%) from 2+11 to 3+11.

# Option: Bridge - East

It costs 703% more than the least-cost option, "Direct" - its cost score is 390.2. It's 464 feet long and 14 feet wide, asphalt, \
and its new road's maximum grade is 9.9%.

- **Line.** From the start, it runs east for about 230 feet and northeast for about 230 feet to the end.
- **Existing road.** It follows an existing road for 100 feet (stations 3+00 to 4+00).
${upgrade}
- **Structures.** 1 bridge (stations 1+60 to 2+50).
- **Earthwork.** 448 cy of cut and 67 cy of fill, with 350 cy of waste (export). Its deepest cut is 10.9 feet (station 2+98). \
Its deepest fill is 5.3 feet (station 1+59).
- **Cost.** Its largest items: bridges 316.1, mobilization 35.5, surfacing (asphalt) 14.6.
- **Design warnings.** The bridge deck is below the ground from 2+35 to 2+48.
`);

    // The draft is the describe command's file
    const described = testIo({'files': {...io.files}});
    assert.equal(await cliMain(['describe', 'road.json', 'work/descriptions.md'], described), 0);
    assert.equal(described.output.join(''), `\
The plan's description: 5 lines
Option "Direct"'s description: 7 lines
Option "Bridge - East"'s description: 9 lines
Wrote road.json
`);

    // A plan with one option
    const plan = fixturePlan();
    plan.options.pop();
    const one = await command(plan, ['draft', 'descriptions.md']);
    assert.ok(one.output.join('').startsWith('Wrote descriptions.md - the plan\'s and 1 option\'s facts. '));
});


test('draft, options that aren\'t in cost order', () => {
    // The least-cost option is the one with the lowest cost score, wherever it is - here, it has no structures
    const plan = fixturePlan();
    plan.options.reverse();
    plan.options[1].structures.push(
        {'type': 'culvert', 'station': 50, 'diameter': 2.5}, {'type': 'turnout', 'station': 300, 'endStation': 350}
    );
    plan.options.push({'name': 'Plain', 'section': {'width': 12}, 'alignment': plan.options[1].alignment.map(({x, y}) => ({x, y}))});
    const lines = draftLines(plan);

    // An option that costs the same as the least-cost option, and one with many culverts - its first six are listed
    const same = fixturePlan();
    same.options = [same.options[0], {...same.options[0], 'name': 'Same'}];
    same.options[1].structures = [1, 2, 3, 4, 5, 6, 7].map((number) => ({'type': 'culvert', 'station': number * 10}));
    same.options[0].structures = same.options[1].structures.slice(0, 6);
    assert.deepEqual(draftLines(same).filter((line) => line.startsWith('- **Structures.**') || / - its cost score is /.test(line)), [
        'The least-cost option - its cost score is 80.0. It\'s 440 feet long and 12 feet wide, gravel, and its maximum grade is 20.9%.',
        '- **Structures.** 6 culverts (station 0+10, 1.5 ft; station 0+20, 1.5 ft; station 0+30, 1.5 ft; station 0+40, 1.5 ft; station ' +
            '0+50, 1.5 ft; station 0+60, 1.5 ft).',
        'It costs 10% more than the least-cost option, "Direct" - its cost score is 88.4. It\'s 440 feet long and 12 feet wide, ' +
            'gravel, and its maximum grade is 20.9%.',
        '- **Structures.** 7 culverts (station 0+10, 1.5 ft; station 0+20, 1.5 ft; station 0+30, 1.5 ft; station 0+40, 1.5 ft; station ' +
            '0+50, 1.5 ft; station 0+60, 1.5 ft; ...).'
    ]);
    const equal = fixturePlan();
    equal.options = [equal.options[0], {...equal.options[0], 'name': 'Equal'}];
    assert.ok(draftLines(equal).includes(
        'It costs the same as the least-cost option, "Direct" - its cost score is 48.6. It\'s 440 feet long and 12 feet wide, gravel, ' +
            'and its maximum grade is 20.9%.'
    ));
    assert.deepEqual(lines.filter((line) => line.startsWith('- **Structures.**') || / - its cost score is /.test(line)), [
        'It costs 1,011% more than the least-cost option, "Plain" - its cost score is 390.2. It\'s 464 feet long and 14 feet wide, ' +
            'asphalt, and its new road\'s maximum grade is 9.9%.',
        '- **Structures.** 1 bridge (stations 1+60 to 2+50).',
        'It costs 69% more than the least-cost option, "Plain" - its cost score is 59.3. It\'s 440 feet long and 12 feet wide, ' +
            'gravel, and its maximum grade is 20.9%.',
        '- **Structures.** 2 culverts (Creek culvert, station 2+11, 1.5 ft; station 0+50, 2.5 ft), 1 retaining wall (stations 2+60 ' +
            'to 3+00), 2 turnouts.',
        'The least-cost option - its cost score is 35.1. It\'s 440 feet long and 12 feet wide, gravel, and its maximum grade is 27.9%.',
        '- **Structures.** None.'
    ]);
});


test('draft, existing roads and added features', async () => {
    // The standard options of a plan with an existing road - and features that were added to it, which the draft lists
    const plan = roadPlan();
    plan.start.label = 'Gate';
    plan.end.label = 'House';
    plan.topography.features.push(
        {'type': 'stream', 'name': 'North Draw', 'points': [{'x': 0, 'y': 380}, {'x': 100, 'y': 380}], 'added': true},
        {'type': 'stream', 'name': 'North Draw', 'points': [{'x': 100, 'y': 380}, {'x': 200, 'y': 390}], 'added': true},
        {'type': 'stream', 'points': [{'x': 0, 'y': 390}, {'x': 100, 'y': 395}], 'added': true},
        {'type': 'exclusion', 'points': [{'x': 0, 'y': 300}, {'x': 20, 'y': 300}, {'x': 20, 'y': 320}], 'added': true},
        {'type': 'road', 'name': 'Old Track', 'points': [{'x': 380, 'y': 0}, {'x': 390, 'y': 100}], 'added': true}
    );
    const engineered = JSON.parse((await command(plan, ['options'])).files['road.json']);
    const lines = draftLines(engineered);
    assert.deepEqual(lines.slice(2, 12), [
        '**The site.** From "Gate" (elevation 102 feet) to "House" (elevation 118 feet). The straight line between them climbs 15 ' +
            'feet in 416 feet (3.7%).',
        '',
        '**Design criteria.** Maximum grade 12%, minimum curve radius 50 feet, maximum retaining wall height 20 feet.',
        '',
        '**Features added to the site.** They aren\'t the USGS\'s - verify them in the field:',
        '',
        '- Streams: North Draw, 1 unnamed',
        '- Existing roads: Old Track',
        '- Exclusion areas: 1 unnamed',
        ''
    ]);

    // The existing road's names and its grades as it's built
    assert.deepEqual(lines.slice(lines.indexOf('# Option: Existing Roads'), lines.indexOf('# Option: Existing Roads') + 7), [
        '# Option: Existing Roads',
        '',
        'It costs 11% more than the least-cost option, "New Road" - its cost score is 23.5. It\'s 569 feet long and 14 feet wide, ' +
            'gravel, and its new road\'s maximum grade is 4.9%.',
        '',
        '- **Line.** From the start, it runs east for about 310 feet and north for about 260 feet to the end.',
        '- **Existing road.** It follows Mill Rd for 424 feet (stations 1+45 to 5+69) - as built, its grade averages 3.6%, and 5% ' +
            'over its steepest 50 feet.',
        upgrade
    ]);
    assert.deepEqual(lines.slice(lines.indexOf('# Option: New Road') + 5, lines.indexOf('# Option: New Road') + 9), [
        '- **Structures.** 1 turnout.',
        '- **Earthwork.** 27 cy of cut and 5 cy of fill, with 18 cy of waste (export). Its deepest cut is 0.2 feet (station 0+56). ' +
            'It has no fill.',
        '- **Cost.** Its largest items: surfacing (gravel) 11.2, ditches and cross drains 5.7, mobilization 1.9.',
        '- **Design warnings.** None.'
    ]);
});


test('draft, a meters plan down a steep plane', () => {
    // The end point is below the start point, and the straight line between them is steeper than the maximum grade. The
    // existing road is as steep, as it's built - over the maximum grade - and the option has no earthwork.
    const plan = planePlan({'units': 'meters', 'rise': 0.3});
    plan.start = {'x': 50, 'y': 100};
    plan.end = {'x': 50, 'y': 0};
    plan.options = [{
        'name': 'Down',
        'section': {'width': 4.3},
        'alignment': [{'x': 50, 'y': 100}, {'x': 50, 'y': 75}, {'x': 50, 'y': 50}, {'x': 50, 'y': 25}, {'x': 50, 'y': 0}],
        'structures': [{'type': 'existingRoad', 'station': 0, 'endStation': 100}]
    }];
    assert.deepEqual(draftLines(plan).slice(2, -2), [
        '**The site.** From the start point (elevation 130 meters) to the end point (elevation 100 meters). The straight line ' +
            'between them descends 30 meters in 100 meters (30%) - steeper than the maximum grade, so a road is longer than the ' +
            'straight line.',
        '',
        '**Design criteria.** Maximum grade 12%, minimum curve radius 15 meters, maximum retaining wall height 6 meters.',
        '',
        limitations,
        '',
        '# Option: Down',
        '',
        'The least-cost option - its cost score is 6.1. It\'s 100 meters long and 4.3 meters wide, gravel, and its new road\'s ' +
            'maximum grade is 0%.',
        '',
        '- **Line.** From the start, it runs south for about 100 meters to the end.',
        '- **Existing road.** It follows an existing road for 100 meters (stations 0+000 to 0+100) - as built, its grade averages ' +
            '30%, which is over the 12% maximum grade.',
        upgrade,
        '- **Structures.** None.',
        '- **Earthwork.** 0 m³ of cut and 0 m³ of fill. It has no cut. It has no fill.'
    ]);
});


test('lineRuns', () => {
    // A road's line - the compass directions it runs in, and how far in each
    const runs = (points) => {
        const x = points.map((point) => point[0]);
        const y = points.map((point) => point[1]);
        const stations = [0];
        for (let ix = 1; ix < points.length; ix++) {
            stations.push(stations[ix - 1] + Math.hypot(x[ix] - x[ix - 1], y[ix] - y[ix - 1]));
        }
        return lineRuns(x, y, stations).map(({direction, length}) => [direction, Math.round(length)]);
    };
    assert.deepEqual(runs([[0, 0], [100, 0]]), [['east', 100]]);
    assert.deepEqual(runs([[0, 0], [0, -240]]), [['south', 240]]);

    // The line is sampled in 24 equal lengths, so a run's length is about its road's
    assert.deepEqual(runs([[0, 0], [120, 0], [120, 120], [0, 240], [-120, 240]]), [
        ['east', 132], ['north', 110], ['northwest', 177], ['west', 110]
    ]);

    // A short run is a part of its longer neighbor - the one before it, or the one after it
    assert.deepEqual(runs([[0, 0], [400, 0], [400, 30], [600, 30]]), [['east', 630]]);
    assert.deepEqual(runs([[0, 0], [0, 20], [300, 20], [300, 320]]), [['east', 336], ['north', 284]]);
    assert.deepEqual(runs([[0, 0], [300, 0], [300, 300], [320, 300]]), [['east', 310], ['north', 310]]);
    assert.deepEqual(runs([[0, 0], [300, 0], [330, 30], [330, 330], [630, 330]]), [['east', 353], ['north', 314], ['east', 275]]);
    assert.deepEqual(runs([[0, 0], [400, 400], [400, 420], [600, 420]]), [['northeast', 589], ['east', 196]]);

    // A road of many runs is five runs, at most - its shortest are parts of their neighbors
    assert.deepEqual(runs([[0, 0], [100, 0], [100, 110], [220, 110], [220, 240], [360, 240], [360, 390], [520, 390]]), [
        ['east', 114], ['north', 341], ['east', 152], ['north', 152], ['east', 152]
    ]);
});


test('draft, a plan that cannot be loaded and usage', async () => {
    const io = testIo({'files': {'road.json': '{'}});
    assert.equal(await cliMain(['draft', 'road.json', 'descriptions.md'], io), 1);
    assert.deepEqual([io.output.join(''), io.written], ['error: Could not load the road plan "road.json"\n', []]);

    // The usage
    const usage = `${draftUsage.join('\n')}\n`;
    assert.ok(draftUsage.every((line) => line.length <= 120));
    for (const args of [[], ['road.json'], ['road.json', 'text.md', 'other.md'], ['--all', 'text.md'], ['road.json', '-x']]) {
        const usageIo = testIo();
        assert.deepEqual([await cliMain(['draft', ...args], usageIo), usageIo.output.join('')], [1, usage]);
    }
});
