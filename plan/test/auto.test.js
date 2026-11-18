import {layoutLatLong, siteLayout} from '../lib/terrain.js';
import {siteEast, siteNorth, testImage, testIo, testItem, testLine, testPages, testSite} from './terrainHelpers.js';
import assert from 'node:assert/strict';
import {autoUsage} from '../lib/auto.js';
import {cliMain} from '../lib/cli.js';
import test from 'node:test';
import {validatePlan} from '../../viewer/lib/model.js';


// The test site's elevation model - a gentle valley down to the south, east of the site's center
const item = testItem('CO_New_2020', 'x47y443', '2022-02-10');
const valley = (east, north) => 1700 + 0.03 * Math.abs(east - siteEast - 40) + 0.02 * (north - siteNorth);
const pngBytes = Uint8Array.from([137, 80, 78, 71]);


// A test site - its grid is 61 x 54 points, 10 meters apart, and its start and end points are at 150, 150 and 449, 372
function autoSite(members = {}) {
    return testSite({'margin': 150, 'spacing': 10, ...members});
}


// Get a test site's road - a GeoJSON line of the plan's points
function siteRoad(site, name, points) {
    const layout = siteLayout(site);
    return testLine({name}, points.map(([x, y]) => {
        const [latitude, longitude] = layoutLatLong(layout, x, y);
        return [longitude, latitude];
    }));
}


// Run the "auto" command for a site - "answers" are the model's: its notes answer ("notes"), and each place's answers
// by its name (an area's answer and its closer answer, or a point's answer). Returns the tools' input and output
// functions object (testIo), with the command's exit "code", the model's "asks", and the written "plan".
async function runAuto(site, {args = [], answers = {}, roads = [], elevation = valley, mapImage = pngBytes, files = {}, io = null} = {}) {
    const autoIo = io ?? testIo({
        'files': {...files, 'site.json': JSON.stringify(site)},
        'images': {[item.downloadURL]: testImage({elevation})},
        'pages': testPages({'items': [item], roads}),
        mapImage
    });
    autoIo.files['site.json'] = JSON.stringify(site);
    autoIo.output.length = 0;
    autoIo.asks = [];
    autoIo.renderPng = () => pngBytes;
    autoIo.ask = ({model, question, images, schema}) => {
        const place = question.match(/must (?:avoid|pass through): "([^"]*)"/)?.[1] ?? null;
        const key = place === null ? 'notes' : `${place}${question.includes('first estimate') ? ':closer' : ''}`;
        autoIo.asks.push({model, key, 'images': images.length, 'members': Object.keys(schema.properties).length});
        return key in answers ? Promise.resolve(answers[key]) : Promise.reject(new Error(`The model "${model}" failed (no ${key})`));
    };
    const code = await cliMain(['auto', 'site.json', 'plans/road.json', ...args], autoIo);
    return Object.assign(autoIo, {code, 'plan': code === 0 ? JSON.parse(autoIo.files['plans/road.json']) : null});
}


// The site command's report of the test site
const siteLines = `\
Grid: 61 x 54 at 10 meters spacing (600 x 530 meters)
Elevations: 1695.0 to 1715.7 meters, contours every 1 meters
Elevation model: CO_New_2020 (2022-02-10)
Features: 0 streams, 0 roads, 0 trails, 0 exclusion areas
Topographic map image: plans/road.png
start: "Start" (150, 150) at 40.00000, -105.28000, ground 1703.6
end: "End" (448.87, 372.07) at 40.00200, -105.27650, ground 1705.6
`;


// The command's last line
const wroteLine = 'Wrote plans/road.json - its descriptions are "plans/road.work/descriptions.md", and its plots are in ' +
    '"plans/road.work/"\n';


test('auto', async () => {
    // Without a model, the plan is the tools' - the site, its standard options (with the draw they cross, as a stream),
    // and the descriptions' facts. The site's notes aren't read.
    const io = await runAuto(autoSite({'notes': ['A gravel road.']}));
    assert.equal(io.code, 0);
    assert.equal(io.output.join(''), `\
${siteLines}Notes: not read - there's no model (--model)
Draws: added the unmapped draws the options crossed, as streams - Draw 1
Option "New Road": 377 meters long, 102 alignment points, max grade 3.6%, max cut 0.1, max fill 0.1
Structures: 1 culvert, 3 turnouts
Cost score: 72.6, design warnings: 0
Option 0: "New Road" - cost score 72.6, design warnings: 0
${wroteLine}`);
    assert.deepEqual(io.asks, []);
    assert.ok('plan' in validatePlan(io.plan));
    assert.deepEqual(io.plan.options.map(({name}) => name), ['New Road']);
    assert.deepEqual(io.plan.topography.features.map(({type, name}) => [type, name]), [['stream', 'Draw 1']]);

    // The plan's descriptions are the draft's, with what the plan did - and its plots are its terrain's and its map's
    const descriptions = io.files['plans/road.work/descriptions.md'].split('\n');
    assert.deepEqual(descriptions.slice(0, 3), ['# Plan', '', '**The site.** From "Start" (elevation 1,704 meters) to "End" (elevation ' +
        '1,706 meters). The straight line between them climbs 2 meters in 372 meters (0.5%).']);
    assert.ok(descriptions.includes(
        '- The draws are the terrain\'s unmapped draws that the options crossed - each crossing has a culvert.'
    ));
    assert.ok(descriptions.find((line) => line.startsWith('**Limitations.**')).endsWith(
        ' bid estimates. The site\'s notes weren\'t read - the plan is the tools\' alone.'
    ));
    assert.deepEqual(io.plan.description, descriptions.slice(2, descriptions.indexOf('# Option: New Road') - 1));
    assert.deepEqual(io.written.filter((path) => !path.includes('/terrain/') && path !== 'plans/road.json'), [
        'plans/road.png', 'plans/road.work/descriptions.md', 'plans/road.work/plan.png', 'plans/road.work/map.png',
        'plans/road.work/commands.txt'
    ]);
    assert.equal(io.files['plans/road.work/commands.txt'], 'plan.js auto site.json plans/road.json\n');

    // A site without notes
    const plain = await runAuto(autoSite());
    assert.equal(plain.output.join(''), io.output.join('').replace('Notes: not read - there\'s no model (--model)\n', ''));
    assert.ok(plain.files['plans/road.work/descriptions.md'].includes(' bid estimates.\n'));
});


test('auto, the notes', async () => {
    // The model is asked what the notes ask for, and where their places are on the map - and the plan acts on its answers
    const site = autoSite({'notes': ['A paved driveway to the house, 5 meters wide.', 'Stay off the barn.']});
    site.start.label = 'Gate';
    site.end.label = 'House';
    const answers = {
        'notes': {
            'purpose': '  A paved driveway\nto the house. ',
            'width': 5,
            'surface': 'Asphalt',
            'maxGrade': 10,
            'minRadius': 20,
            'ruleOutRoads': ['mill rd', 'Nope Rd'],
            'avoid': [
                {'name': 'Barn', 'where': 'north of the gate'}, {'name': 'Pond', 'where': ''}, {'name': 'Shed', 'where': 'by the gate'},
                {'name': 'Well', 'where': 'in the field'}, {'name': 'Yard', 'where': 'at the gate'}, {'name': 'Field', 'where': 'south'}
            ],
            'passThrough': [
                {'name': 'Ford', 'where': 'at the creek'}, {'name': 'Cliff', 'where': 'up high'}, {'name': 'Stall', 'where': 'in the barn'}
            ],
            'unhandled': ['Paint it blue.']
        },

        // The barn's rectangle is corrected on a closer look, the pond isn't found, the shed's is the start point's, and
        // the well's correction isn't valid - it covers the site. The yard's rectangle contains the start point, so it's
        // cut back from it, and the field's is too much of the site.
        'Barn': {'found': true, 'west': 300, 'south': 60, 'east': 380, 'north': 120.4, 'why': 'A  block.'},
        'Barn:closer': {'found': true, 'west': 370, 'south': 110, 'east': 310, 'north': 70, 'why': 'The barn.'},
        'Pond': {'found': false, 'west': 0, 'south': 0, 'east': 0, 'north': 0, 'why': ''},
        'Shed': {'found': true, 'west': 140, 'south': 140, 'east': 160, 'north': 160, 'why': 'A shed.'},
        'Well': {'found': true, 'west': 500, 'south': 400, 'east': 560, 'north': 460, 'why': 7},
        'Well:closer': {'found': true, 'west': -50, 'south': -50, 'east': 900, 'north': 900, 'why': 'All of it.'},
        'Yard': {'found': true, 'west': 100, 'south': 100, 'east': 300, 'north': 200, 'why': 'A yard.'},
        'Yard:closer': {'found': false, 'west': 0, 'south': 0, 'east': 0, 'north': 0, 'why': ''},
        'Field': {'found': true, 'west': 0, 'south': 0, 'east': 600, 'north': 300, 'why': 'A field.'},

        // The ford is found, the cliff's point isn't in the site, and the stall is in the barn - there's no road through it
        'Ford': {'found': true, 'x': 300.4, 'y': 299.6, 'why': 'A ford.'},
        'Cliff': {'found': true, 'x': 9999, 'y': 100, 'why': 'A cliff.'},
        'Stall': {'found': true, 'x': 340, 'y': 90, 'why': 'A stall.'}
    };
    const roads = [siteRoad(site, 'Mill Rd', [[100, 500], [500, 500]])];
    const io = await runAuto(site, {'args': ['--model', 'test-model'], answers, roads});
    assert.equal(io.code, 0);
    assert.equal(io.output.join(''), `\
${siteLines.replace('0 roads', '1 road').replace('"Start"', '"Gate"').replace('"End"', '"House"').
        replace('ground 1703.6', 'ground 1703.6, nearest road "Mill Rd" 350 meters away').
        replace('ground 1705.6', 'ground 1705.6, nearest road "Mill Rd" 128 meters away')}\
Notes: maximum grade 10, minimum radius 20
Notes: the road is 5 meters wide, asphalt
Notes: the existing road "Mill Rd" is ruled out
Notes: avoid "Barn" - an exclusion area from x 310 to 370, y 70 to 110
Notes: avoid "Well" - an exclusion area from x 500 to 560, y 400 to 460
Notes: avoid "Yard" - an exclusion area from x 170 to 300, y 100 to 200
Draws: added the unmapped draws the options crossed, as streams - Draw 1
Option "New Road": 384 meters long, 83 alignment points, max grade 3.6%, max cut 0.1, max fill 0.1
Structures: 1 culvert
Cost score: 122.3, design warnings: 1
Option "Via Ford": 384 meters long, 83 alignment points, max grade 3.6%, max cut 0.1, max fill 0.1
Structures: 1 culvert
Cost score: 122.7, design warnings: 1
Notes: "Via Ford" passes through "Ford" at 300,300
Option 0: "New Road" - cost score 122.3, design warnings: 1
Option 1: "Via Ford" - cost score 122.7, design warnings: 1
Notes: NOT acted on - Paint it blue.
Notes: NOT acted on - rule out the road "Nope Rd" (the site has no road of that name)
Notes: NOT acted on - avoid "Pond" () - the model didn't find it on the map
Notes: NOT acted on - avoid "Shed" (by the gate) - the model's rectangle for it has no size
Notes: NOT acted on - avoid "Field" (south) - the model's rectangle for it covers more than a quarter of the site
Notes: NOT acted on - pass through "Cliff" (up high) - the model didn't find it on the map
Notes: NOT acted on - pass through "Stall" (in the barn) at 340,90 - no route found (blocked by exclusion areas or the \
topography boundary?)
${wroteLine}`);

    // The questions - the notes', and each place's (an area has a closer look, too), with their plots
    assert.deepEqual(io.asks.map(({key, images}) => [key, images]), [
        ['notes', 0], ['Barn', 1], ['Barn:closer', 1], ['Pond', 1], ['Shed', 1], ['Well', 1], ['Well:closer', 1], ['Yard', 1],
        ['Yard:closer', 1], ['Field', 1], ['Ford', 1], ['Cliff', 1], ['Stall', 1]
    ]);
    assert.ok(io.asks.every(({model}) => model === 'test-model'));
    assert.deepEqual(io.written.filter((path) => path.includes('/ask/')), [
        'plans/road.work/ask/barn.png', 'plans/road.work/ask/barn-box.png', 'plans/road.work/ask/pond.png',
        'plans/road.work/ask/shed.png', 'plans/road.work/ask/well.png', 'plans/road.work/ask/well-box.png',
        'plans/road.work/ask/yard.png', 'plans/road.work/ask/yard-box.png', 'plans/road.work/ask/field.png',
        'plans/road.work/ask/ford.png', 'plans/road.work/ask/cliff.png', 'plans/road.work/ask/stall.png'
    ]);

    // The plan - its criteria, its features, and its options
    assert.ok('plan' in validatePlan(io.plan));
    assert.deepEqual(io.plan.criteria, {'maxGrade': 10, 'minRadius': 20});
    assert.deepEqual(io.plan.topography.features.map(({type, name, points}) => [type, name, points.length]), [
        ['exclusion', 'Barn', 4], ['exclusion', 'Well', 4], ['exclusion', 'Yard', 4], ['stream', 'Draw 1', 2]
    ]);
    assert.deepEqual(io.plan.topography.features[0].points, [
        {'x': 310, 'y': 70}, {'x': 370, 'y': 70}, {'x': 370, 'y': 110}, {'x': 310, 'y': 110}
    ]);
    assert.deepEqual(io.plan.options.map(({name, section}) => [name, section.width, section.surface]), [
        ['New Road', 5, 'asphalt'], ['Via Ford', 5, 'asphalt']
    ]);

    // The descriptions - the road's purpose, what the model found, and the notes that weren't acted on
    const descriptions = io.files['plans/road.work/descriptions.md'].split('\n');
    assert.equal(descriptions[2], 'A paved driveway to the house.');
    assert.deepEqual(descriptions.filter((line) => line.startsWith('- Barn') || line.startsWith('- Well')), [
        '- Barn: the notes\' place to avoid (north of the gate). The model "test-model" found it on the site\'s map, from x 310 to ' +
            '370 and y 70 to 110 - "The barn." Verify it.',
        '- Well: the notes\' place to avoid (in the field). The model "test-model" found it on the site\'s map, from x 500 to ' +
            '560 and y 400 to 460 - "" Verify it.'
    ]);
    assert.ok(descriptions.find((line) => line.startsWith('**Limitations.**')).endsWith(
        ' These of the site\'s notes weren\'t acted on: Paint it blue.; rule out the road "Nope Rd" (the site has no road of that ' +
        'name); avoid "Pond" () - the model didn\'t find it on the map; avoid "Shed" (by the gate) - the model\'s rectangle for it ' +
        'has no size; avoid "Field" (south) - the model\'s rectangle for it covers more than a quarter of the site; pass through ' +
        '"Cliff" (up high) - the model didn\'t find it on the map; pass through "Stall" (in the barn) at 340,90 - no route found ' +
        '(blocked by exclusion areas or the topography boundary?).'
    ));
});


test('auto, the saved answers', async () => {
    // The model's answers are saved in the plan's work directory - they're used again, so the model isn't asked twice
    const site = autoSite({'notes': ['Stay off the barn.']});
    const notes = {
        'purpose': 'A road.', 'width': null, 'surface': 'gravel', 'maxGrade': null, 'minRadius': null, 'ruleOutRoads': [],
        'avoid': [{'name': 'Barn', 'where': 'north'}], 'passThrough': [], 'unhandled': []
    };
    const barn = {'found': true, 'west': 300, 'south': 60, 'east': 380, 'north': 120, 'why': 'A block.'};
    const answers = {notes, 'Barn': barn, 'Barn:closer': barn};
    const args = ['--model', 'test-model'];
    const io = await runAuto(site, {args, answers});
    assert.deepEqual([io.code, io.asks.length], [0, 3]);
    assert.ok(io.output.join('').includes('\nNotes: the road is gravel\n'));
    const saved = JSON.parse(io.files['plans/road.work/decisions.json']);
    assert.deepEqual([saved.model, saved.answers], ['test-model', {notes, 'avoid:Barn': barn, 'avoid:Barn:closer': barn}]);
    const exclusion = (plan) => plan.topography.features.filter(({type}) => type === 'exclusion').map(({points}) => [points[0], points[2]]);
    assert.deepEqual(exclusion(io.plan), [[{'x': 300, 'y': 60}, {'x': 380, 'y': 120}]]);

    // Again, the answers are the saved ones - a corrected answer is the plan's
    saved.answers['avoid:Barn:closer'] = {...barn, 'east': 400};
    io.files['plans/road.work/decisions.json'] = JSON.stringify(saved);
    const again = await runAuto(site, {args, 'answers': {}, io});
    assert.deepEqual([again.code, again.asks.length], [0, 0]);
    assert.deepEqual(exclusion(again.plan), [[{'x': 300, 'y': 60}, {'x': 400, 'y': 120}]]);

    // With --fresh, the model is asked again - as it is if the site's notes change, or if the saved answers can't be read
    const fresh = await runAuto(site, {'args': [...args, '--fresh'], answers, io});
    assert.deepEqual([fresh.code, fresh.asks.length, exclusion(fresh.plan)], [0, 3, [[{'x': 300, 'y': 60}, {'x': 380, 'y': 120}]]]);
    const changed = await runAuto({...site, 'notes': ['Stay off the barn!']}, {args, answers, io});
    assert.deepEqual([changed.code, changed.asks.length], [0, 3]);
    io.files['plans/road.work/decisions.json'] = '{';
    const unread = await runAuto({...site, 'notes': ['Stay off the barn!']}, {args, answers, io});
    assert.deepEqual([unread.code, unread.asks.length], [0, 3]);
});


test('auto, existing roads and the options\' limit', async () => {
    // The site has an existing road from the start point to the end point, and the notes' four places to pass through -
    // the plan keeps its four best options. The site has no topographic map image, so the model is asked of its terrain.
    const site = autoSite({'notes': ['Go by the trees.'], 'criteria': {'maxGrade': 9}});
    const point = (x, y) => ({'found': true, x, y, 'why': 'Trees.'});
    const answers = {
        'notes': {
            'purpose': '', 'width': 5, 'surface': 'gravel', 'maxGrade': 10, 'minRadius': null, 'ruleOutRoads': [], 'avoid': [],
            'passThrough': ['Oak', 'Elm', 'Ash', 'Fir'].map((name) => ({name, 'where': 'a tree'})), 'unhandled': []
        },
        'Oak': point(200, 300), 'Elm': point(300, 150), 'Ash': point(400, 250), 'Fir': point(250, 400)
    };
    const roads = [siteRoad(site, 'Mill Rd', [[150, 150], [448.87, 372.07]])];
    const io = await runAuto(site, {'args': ['--model', 'test-model', '-w', '4', '-s', 'native'], answers, roads, 'mapImage': null});
    assert.equal(io.code, 0);
    const lines = io.output.join('').split('\n');
    assert.deepEqual(lines.filter((line) => /^Notes: |^Option \d|^Topographic|^No /.test(line)), [
        'Notes: the road is 5 meters wide, gravel',
        'Notes: "Via Oak" passes through "Oak" at 200,300',
        'Notes: "Via Elm" passes through "Elm" at 300,150',
        'Notes: "Via Ash" passes through "Ash" at 400,250',
        'Notes: "Via Fir" passes through "Fir" at 250,400',
        'Option 0: "Existing Roads" - cost score 21.3, design warnings: 0',
        'Option 1: "New Road" - cost score 37.9, design warnings: 0',
        'Option 2: "Via Ash" - cost score 39.0, design warnings: 0',
        'Option 3: "Via Elm" - cost score 40.6, design warnings: 0'
    ]);

    // The site's own criteria are the plan's, and the arguments' road is the options'
    assert.deepEqual(io.plan.criteria, {'maxGrade': 9});
    assert.deepEqual(io.plan.options.map(({name, section}) => [name, section.width, section.surface]), [
        ['Existing Roads', 4, 'native'], ['New Road', 4, 'native'], ['Via Ash', 4, 'native'], ['Via Elm', 4, 'native']
    ]);
    assert.ok(!io.written.includes('plans/road.work/map.png') && io.written.includes('plans/road.work/plan.png'));
});


test('auto, a model\'s answers that aren\'t valid', async () => {
    // The notes' answer's members that aren't what they should be are nothing - or they aren't acted on
    const site = autoSite({'notes': ['A road.']});
    const answers = {'notes': {
        'purpose': 5, 'width': '12', 'surface': 7, 'maxGrade': 99, 'minRadius': 1, 'ruleOutRoads': 'Mill Rd', 'avoid': 'the barn',
        'passThrough': [null, {'name': 5}, {'name': '- Gap -'}], 'unhandled': null
    }, 'Gap -': {'found': 'yes', 'x': 300, 'y': 300, 'why': ''}};
    const io = await runAuto(site, {'args': ['--model', 'test-model'], answers});
    assert.equal(io.code, 0);
    assert.deepEqual(io.output.join('').split('\n').filter((line) => line.startsWith('Notes: ')), [
        'Notes: NOT acted on - a width of "12" (it isn\'t from 2.4 to 12)',
        'Notes: NOT acted on - a maximum grade of 99 (it isn\'t from 3 to 25)',
        'Notes: NOT acted on - a minimum radius of 1 (it isn\'t from 8 to 150)',
        'Notes: NOT acted on - pass through "Gap -" () - the model didn\'t find it on the map'
    ]);
    assert.deepEqual(io.asks.map(({key}) => key), ['notes', 'Gap -']);
    assert.equal(io.plan.criteria, undefined);
    assert.deepEqual(io.plan.options.map(({name, section}) => [name, section.width, section.surface]), [['New Road', 4.3, 'gravel']]);
    assert.equal(io.files['plans/road.work/descriptions.md'].split('\n')[2].slice(0, 13), '**The site.**');

    // An area's answer that isn't numbers
    const area = await runAuto(site, {'args': ['--model', 'test-model'], 'answers': {
        'notes': {...answers.notes, 'width': 3, 'avoid': [{'name': 'Barn', 'where': 'north'}], 'passThrough': []},
        'Barn': {'found': true, 'west': '300', 'south': 60, 'east': 380, 'north': 120, 'why': ''}
    }});
    assert.ok(area.output.join('').includes('Notes: NOT acted on - avoid "Barn" (north) - the model didn\'t find it on the map\n'));
    assert.ok(area.output.join('').includes('\nNotes: the road is 3 meters wide\n'));
});


test('auto, failures', async () => {
    // The model fails - it's an error (the plan's site is made)
    const site = autoSite({'notes': ['A road.']});
    const failed = await runAuto(site, {'args': ['--model', 'test-model']});
    assert.equal(failed.code, 1);
    assert.equal(failed.output.join(''), `${siteLines}error: The model "test-model" failed (no notes)\n`);

    // There's no road within the grade limit - the site's a steep plane
    const steep = await runAuto(autoSite(), {'elevation': (east, north) => 1700 + 0.5 * (north - siteNorth)});
    assert.equal(steep.code, 1);
    assert.ok(steep.output.join('').endsWith(
        'error: no road within the 11% grade limit - the profile ends 60.7 meters below the end point (try other via points, a ' +
        'longer corridor, or a steeper grade)\n'
    ));
    assert.ok(!steep.written.includes('plans/road.work/descriptions.md'));

    // The site can't be made
    const invalid = await runAuto({'title': 'Site'});
    assert.equal(invalid.code, 1);
    assert.equal(invalid.output.join('').split('\n')[0], 'error: The road site "site.json" is invalid:');
});


test('auto, usage', async () => {
    const usage = `${autoUsage.join('\n')}\n`;
    assert.ok(autoUsage.every((line) => line.length <= 120));
    assert.equal(autoUsage[0], 'usage: plan auto <site.json> <plan.json> [--model MODEL] [--fresh] [options]');
    for (const args of [
        [], ['site.json'], ['site.json', 'road.json', 'other.json'], ['site.json', 'road.json', '--model', ''],
        ['site.json', 'road.json', '-w', 'wide'], ['site.json', 'road.json', '-w', '0'], ['site.json', 'road.json', '-s', 'mud'],
        ['site.json', 'road.json', '--unknown']
    ]) {
        const io = testIo();
        assert.deepEqual([await cliMain(['auto', ...args], io), io.output.join('')], [1, usage]);
    }
});
