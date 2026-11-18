import {autoSteps, autoUsage} from '../lib/auto.js';
import {layoutLatLong, siteLayout} from '../lib/terrain.js';
import {siteEast, siteNorth, testImage, testIo, testItem, testLine, testPages, testSite} from './terrainHelpers.js';
import assert from 'node:assert/strict';
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


// Get a test site's latitude and longitude of a plan point (rounded to ten-millionths of a degree, as the marks that a
// plan finds are)
function siteLatLong(site, x, y) {
    const [latitude, longitude] = layoutLatLong(siteLayout(site), x, y);
    return {'latitude': Math.round(latitude * 1e7) / 1e7, 'longitude': Math.round(longitude * 1e7) / 1e7};
}


// The notes question's answer, with overrides
function notesAnswer(members = {}) {
    return {
        'purpose': 'A road.', 'width': null, 'surface': null, 'maxGrade': null, 'minRadius': null, 'bridgeFill': null, 'ruleOutRoads': [],
        'avoid': [], 'passThrough': [], 'unhandled': [], ...members
    };
}


// Run the "auto" command for a site (its file, "site.json" - or, if "site" is null, the file as it is) - "answers" are
// the model's: its notes answer ("notes"), and each place's answers by its name (an area's answer and its closer
// answer, or a point's answer). Returns the tools' input and output functions object (testIo), with the command's exit
// "code", the model's "asks", the written "plan", and the plan config file's "site".
async function runAuto(
    site, {args = [], answers = {}, roads = [], elevation = valley, mapImage = pngBytes, io = null, status = false} = {}
) {
    const autoIo = io ?? testIo({
        'images': {[item.downloadURL]: testImage({elevation})},
        'pages': testPages({'items': [item], roads}),
        mapImage
    });
    if (site !== null) {
        autoIo.files['site.json'] = JSON.stringify(site);
    }
    autoIo.output.length = 0;
    autoIo.asks = [];
    autoIo.renderPng = () => pngBytes;

    // The plan's statuses - what it's doing, as it's made
    autoIo.statuses = [];
    if (status) {
        autoIo.status = (text, step) => Promise.resolve(autoIo.statuses.push(`${step}: ${text}`));
    }
    autoIo.ask = ({model, question, images, schema}) => {
        const place = question.match(/must (?:avoid|pass through): "([^"]*)"/)?.[1] ?? null;
        const key = place === null ? 'notes' : `${place}${question.includes('first estimate') ? ':closer' : ''}`;
        autoIo.asks.push({model, key, 'images': images.length, 'members': Object.keys(schema.properties).length});
        return key in answers ? Promise.resolve(answers[key]) : Promise.reject(new Error(`The model "${model}" failed (no ${key})`));
    };
    const code = await cliMain(['auto', 'site.json', 'plans/road.json', ...args], autoIo);
    return Object.assign(autoIo, {
        code, 'plan': code === 0 ? JSON.parse(autoIo.files['plans/road.json']) : null, 'site': JSON.parse(autoIo.files['site.json'])
    });
}


// The site command's report of the test site
const siteLines = `\
Grid: 61 x 54 at 10 meters spacing (600 x 530 meters), a margin of 150 meters
Elevations: 1695.0 to 1715.7 meters, contours every 1 meters
Elevation model: CO_New_2020 (2022-02-10)
Features: 0 streams, 0 roads, 0 trails, 0 exclusion areas
Topographic map image: plans/road.png
start: "Start" (150, 150) at 40.00000, -105.28000, ground 1703.6
end: "End" (448.87, 372.07) at 40.00200, -105.27650, ground 1705.6
`;


// The standard options' report of the test site - the new road, and the other corridor
const optionsLines = `\
Option "New Road": 377 meters long, 102 alignment points, max grade 3.6%, max cut 0.1, max fill 0.1
Structures: 1 culvert, 3 turnouts
Cost score: 72.6, design warnings: 0
Option "North Corridor": 401 meters long, 108 alignment points, max grade 3.6%, max cut 0.1, max fill 0.1
Structures: 1 culvert, 3 turnouts
Cost score: 76.9, design warnings: 0
Other corridor: "North Corridor" (through 262,315) - its middle is an average of 64 meters from the standard options
`;


// The command's last line
const wroteLine = 'Wrote plans/road.json - its descriptions are "plans/road.work/descriptions.md"\n';


test('auto', async () => {
    // Without a model, the plan is the tools' - the site, its standard options (with the draw they cross, as a stream),
    // and the descriptions' facts. The site's notes aren't read.
    const site = autoSite({'notes': ['A gravel road.']});
    const io = await runAuto(site);
    assert.equal(io.code, 0);
    assert.equal(io.output.join(''), `\
${siteLines}Notes: not read - there's no model (--model)
Draws: added the unmapped draws the options crossed, as streams - Draw 1
${optionsLines}Option 0: "New Road" - cost score 72.6, design warnings: 0
Option 1: "North Corridor" - cost score 76.9, design warnings: 0
${wroteLine}`);
    assert.deepEqual(io.asks, []);
    assert.ok('plan' in validatePlan(io.plan));
    assert.deepEqual(io.plan.options.map(({name}) => name), ['New Road', 'North Corridor']);
    assert.deepEqual(io.plan.topography.features.map(({type, name}) => [type, name]), [['stream', 'Draw 1']]);

    // The plan config is the plan's site model - its file isn't changed
    assert.deepEqual([io.plan.site, io.site], [site, site]);
    assert.ok(!io.written.includes('site.json'));

    // The plan's descriptions are the draft's, with what the plan did
    const descriptions = io.files['plans/road.work/descriptions.md'].split('\n');
    assert.deepEqual(descriptions.slice(0, 3), ['# Plan', '', '**The site.** From "Start" (elevation 1,704 meters) to "End" (elevation ' +
        '1,706 meters). The straight line between them climbs 2 meters in 372 meters (0.5%).']);
    assert.ok(descriptions.includes(
        '- The draws are the terrain\'s unmapped draws that the options crossed - each crossing has a culvert.'
    ));
    assert.ok(descriptions.find((line) => line.startsWith('**Limitations.**')).endsWith(
        ' bid estimates. The site\'s notes weren\'t read - the plan is the tools\' alone.'
    ));
    assert.ok(!descriptions.some((line) => line.startsWith('**Options.**')));
    assert.deepEqual(io.plan.description, descriptions.slice(2, descriptions.indexOf('# Option: New Road') - 1));
    assert.deepEqual(io.written.filter((path) => !path.includes('/terrain/') && path !== 'plans/road.json'), [
        'plans/road.png', 'plans/road.work/descriptions.md'
    ]);

    // A site without notes
    const plain = await runAuto(autoSite());
    assert.equal(plain.output.join(''), io.output.join('').replace('Notes: not read - there\'s no model (--model)\n', ''));
    assert.ok(plain.files['plans/road.work/descriptions.md'].includes(' bid estimates.\n'));
});


test('auto, the notes', async () => {
    // The model is asked what the notes ask for, and where their places are on the map - and the plan acts on its answers.
    // The places it finds are the plan config's marks.
    const site = autoSite({'notes': ['A paved driveway to the house, 5 meters wide.', 'Stay off the barn.']});
    site.start.label = 'Gate';
    site.end.label = 'House';
    const answers = {
        'notes': notesAnswer({
            'purpose': '  A paved driveway\nto the house. ',
            'width': 5,
            'surface': 'Asphalt',
            'maxGrade': 10,
            'minRadius': 20,
            'ruleOutRoads': ['mill rd', 'Nope Rd'],
            'avoid': [
                {'name': 'Barn', 'where': 'north of the gate', 'points': []}, {'name': 'Pond', 'where': '', 'points': []},
                {'name': 'Shed', 'where': 'by the gate', 'points': []}, {'name': 'Well', 'where': 'in the field', 'points': []},
                {'name': 'Yard', 'where': 'at the gate', 'points': []}, {'name': 'Field', 'where': 'south', 'points': []}
            ],
            'passThrough': [
                {'name': 'Ford', 'where': 'at the creek', 'points': []}, {'name': 'Cliff', 'where': 'up high', 'points': []},
                {'name': 'Stall', 'where': 'in the barn', 'points': []}
            ],
            'unhandled': ['Paint it blue.']
        }),

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
    const io = await runAuto(site, {'args': ['--model', 'test-model'], answers, roads, 'status': true});
    assert.equal(io.code, 0);

    // The plan's statuses - what it's doing, as it's made (the options are engineered again, with the draw they cross)
    assert.deepEqual(autoSteps.map(({key, isModel}) => [key, isModel]), [
        ['site', false], ['notes', true], ['options', false], ['describe', false]
    ]);
    const optionStatuses = [
        'options: Engineering the standard options', 'options: Engineering the option "Via Ford"',
        'options: Engineering the option "Via Stall"'
    ];
    assert.deepEqual(io.statuses, [
        'site: Creating the site - its terrain, streams, roads, and map are the USGS\'s',
        'notes: Asking the model "test-model" what the site\'s notes ask for',
        ...['Barn', 'Pond', 'Shed', 'Well', 'Yard', 'Field', 'Ford', 'Cliff', 'Stall'].map(
            (name) => `notes: Asking the model "test-model" where "${name}" is on the map`
        ),
        ...optionStatuses,
        ...optionStatuses,
        'describe: Writing the descriptions'
    ]);
    assert.equal(io.output.join(''), `\
${siteLines.replace('0 roads', '1 road').replace('"Start"', '"Gate"').replace('"End"', '"House"').
        replace('ground 1703.6', 'ground 1703.6, nearest road "Mill Rd" 350 meters away').
        replace('ground 1705.6', 'ground 1705.6, nearest road "Mill Rd" 128 meters away')}\
Notes: maximum grade 10, minimum radius 20
Notes: the road is 5 meters wide, asphalt
Notes: the existing road "Mill Rd" is ruled out - the options don't follow it
Notes: avoid "Barn" - an exclusion area from x 310 to 370, y 70 to 110
Notes: avoid "Well" - an exclusion area from x 500 to 560, y 400 to 460
Notes: avoid "Yard" - an exclusion area from x 170 to 300, y 100 to 200
Notes: pass through "Ford" - at x 300, y 300
Notes: pass through "Stall" - at x 340, y 90
Draws: added the unmapped draws the options crossed, as streams - Draw 1
Option "New Road": 384 meters long, 83 alignment points, max grade 3.6%, max cut 0.1, max fill 0.1
Structures: 1 culvert
Cost score: 122.3, design warnings: 1
Option "South Corridor": 499 meters long, 108 alignment points, max grade 3.6%, max cut 0.1, max fill 0.1
Structures: 1 culvert
Cost score: 155.9, design warnings: 2
Other corridor: "South Corridor" (through 348,160) - its middle is an average of 82 meters from the standard options
Option "Via Ford": 384 meters long, 83 alignment points, max grade 3.6%, max cut 0.1, max fill 0.1
Structures: 1 culvert
Cost score: 122.7, design warnings: 1
Notes: "Via Ford" passes through "Ford"
Option 0: "New Road" - cost score 122.3, design warnings: 1
Option 1: "Via Ford" - cost score 122.7, design warnings: 1
Option 2: "South Corridor" - cost score 155.9, design warnings: 2
Notes: NOT acted on - Paint it blue.
Notes: NOT acted on - rule out the road "Nope Rd" (the site has no road of that name)
Notes: NOT acted on - avoid "Pond" - the model didn't find it on the map
Notes: NOT acted on - avoid "Shed" (by the gate) - the model's rectangle for it has no size
Notes: NOT acted on - avoid "Field" (south) - the model's rectangle for it covers more than a quarter of the site
Notes: NOT acted on - pass through "Cliff" (up high) - the model didn't find it on the map
Notes: NOT acted on - pass through "Stall" - no route found (blocked by exclusion areas or the topography boundary?)
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

    // The places the model found are the plan config's marks - its file is updated, and it's the plan's site model
    const found = (place, why) => ({place, 'model': 'test-model', why});
    assert.deepEqual(io.site, {
        ...site,
        'exclusions': [
            {'name': 'Barn', 'points': [[310, 70], [370, 70], [370, 110], [310, 110]].map(([x, y]) => siteLatLong(site, x, y)),
                'found': found('Barn', 'The barn.')},
            {'name': 'Well', 'points': [[500, 400], [560, 400], [560, 460], [500, 460]].map(([x, y]) => siteLatLong(site, x, y)),
                'found': found('Well', '')},
            {'name': 'Yard', 'points': [[170, 100], [300, 100], [300, 200], [170, 200]].map(([x, y]) => siteLatLong(site, x, y)),
                'found': found('Yard', 'A yard.')}
        ],
        'passThrough': [
            {'name': 'Ford', ...siteLatLong(site, 300, 300), 'found': found('Ford', 'A ford.')},
            {'name': 'Stall', ...siteLatLong(site, 340, 90), 'found': found('Stall', 'A stall.')}
        ]
    });
    assert.deepEqual(io.plan.site, io.site);

    // The plan - its criteria, its features, and its options
    assert.ok('plan' in validatePlan(io.plan));
    assert.deepEqual(io.plan.criteria, {'maxGrade': 10, 'minRadius': 20});
    assert.deepEqual(io.plan.topography.features.map(({type, name, points}) => [type, name, points.length]), [
        ['road', 'Mill Rd', 2], ['exclusion', 'Barn', 4], ['exclusion', 'Well', 4], ['exclusion', 'Yard', 4], ['stream', 'Draw 1', 2]
    ]);
    assert.deepEqual(io.plan.topography.features[1].points, [
        {'x': 310, 'y': 70}, {'x': 370, 'y': 70}, {'x': 370, 'y': 110}, {'x': 310, 'y': 110}
    ]);
    assert.deepEqual(io.plan.options.map(({name, section}) => [name, section.width, section.surface]), [
        ['New Road', 5, 'asphalt'], ['Via Ford', 5, 'asphalt'], ['South Corridor', 5, 'asphalt']
    ]);

    // The descriptions - the road's purpose, the marks the model found, and the notes that weren't acted on
    const descriptions = io.files['plans/road.work/descriptions.md'].split('\n');
    assert.equal(descriptions[2], 'A paved driveway to the house.');
    assert.deepEqual(descriptions.filter((line) => /^- (Exclusion areas|Places to pass through|Barn|Well|Ford):/.test(line)), [
        '- Exclusion areas: Barn, Well, Yard',
        '- Places to pass through: Ford, Stall',
        '- Barn: the notes\' place to avoid (north of the gate). The model "test-model" found it on the site\'s map - "The barn." ' +
            'Verify it.',
        '- Well: the notes\' place to avoid (in the field). The model "test-model" found it on the site\'s map. Verify it.',
        '- Ford: the notes\' place to pass through (at the creek). The model "test-model" found it on the site\'s map - "A ford." ' +
            'Verify it.'
    ]);
    assert.ok(descriptions.find((line) => line.startsWith('**Limitations.**')).endsWith(
        ' These of the site\'s notes weren\'t acted on: Paint it blue.; rule out the road "Nope Rd" (the site has no road of that ' +
        'name); avoid "Pond" - the model didn\'t find it on the map; avoid "Shed" (by the gate) - the model\'s rectangle for it ' +
        'has no size; avoid "Field" (south) - the model\'s rectangle for it covers more than a quarter of the site; pass through ' +
        '"Cliff" (up high) - the model didn\'t find it on the map; pass through "Stall" - no route found (blocked by exclusion ' +
        'areas or the topography boundary?).'
    ));

    // Run again, with the updated plan config - the plan's site data is kept (the USGS isn't asked for it), the model isn't
    // asked (its marks are the plan config's, and its other answers are saved) and its questions aren't plotted, and the
    // plan's notes are acted on as they were: its options are the same
    const first = {'plan': io.plan, 'notes': io.output.join('').split('\n').filter((line) => line.startsWith('Notes:'))};
    const [urlCount, writtenCount] = [io.urls.length, io.written.length];
    const again = await runAuto(null, {'args': ['--model', 'test-model'], io});
    assert.equal(again.code, 0);
    assert.equal(again.output[0].split(' - ')[0], 'Site: the plan\'s site data is kept');
    assert.equal(io.urls.length, urlCount);
    assert.deepEqual(again.asks, []);
    assert.deepEqual(io.written.slice(writtenCount).filter((path) => path.includes('/ask/') || path === 'site.json'), []);
    assert.deepEqual(again.output.join('').split('\n').filter((line) => line.startsWith('Notes:')), [
        ...first.notes.slice(0, 3),
        'Notes: avoid "Barn" - the plan config\'s exclusion area',
        'Notes: avoid "Well" - the plan config\'s exclusion area',
        'Notes: avoid "Yard" - the plan config\'s exclusion area',
        'Notes: pass through "Ford" - the plan config\'s place to pass through',
        'Notes: pass through "Stall" - the plan config\'s place to pass through',
        ...first.notes.slice(8)
    ]);
    assert.deepEqual(again.plan.options, first.plan.options);
    assert.deepEqual(again.plan.criteria, first.plan.criteria);
    const featureNames = ({topography}) => topography.features.map(({type, name}) => `${type} ${name}`).sort();
    assert.deepEqual(featureNames(again.plan), featureNames(first.plan));
});


test('auto, the saved answers and the plan config\'s marks', async () => {
    // The model's notes answer is saved in the plan's work directory, and the places it finds are the plan config's marks
    const site = autoSite({'notes': ['Stay off the barn.']});
    const notes = notesAnswer({'surface': 'gravel', 'avoid': [{'name': 'Barn', 'where': 'north', 'points': []}]});
    const barn = {'found': true, 'west': 300, 'south': 60, 'east': 380, 'north': 120, 'why': 'A block.'};
    const answers = {notes, 'Barn': barn, 'Barn:closer': barn};
    const args = ['--model', 'test-model'];
    const io = await runAuto(site, {args, answers});
    assert.deepEqual([io.code, io.asks.length], [0, 3]);
    assert.ok(io.output.join('').includes('\nNotes: the road is gravel\n'));
    const saved = JSON.parse(io.files['plans/road.work/decisions.json']);
    assert.deepEqual([saved.model, saved.notes, saved.answers], [
        'test-model', ['Stay off the barn.'], {notes, 'avoid:Barn': barn, 'avoid:Barn:closer': barn}
    ]);
    const exclusion = (plan) => plan.topography.features.filter(({type}) => type === 'exclusion').map(({points}) => [points[0], points[2]]);
    assert.deepEqual(exclusion(io.plan), [[{'x': 300, 'y': 60}, {'x': 380, 'y': 120}]]);
    const foundSite = io.site;
    assert.deepEqual(foundSite.exclusions.map(({name, found}) => [name, found.place]), [['Barn', 'Barn']]);

    // Again, the mark is the plan config's - a corrected mark is the plan's (its "found" removed, it's the author's)
    const corrected = {...foundSite, 'exclusions': [{
        'name': 'Barn', 'points': [[300, 60], [400, 60], [400, 120], [300, 120]].map(([x, y]) => siteLatLong(site, x, y))
    }]};
    const again = await runAuto(corrected, {args, 'answers': {}, io});
    assert.deepEqual([again.code, again.asks.length], [0, 0]);
    assert.deepEqual(exclusion(again.plan), [[{'x': 300, 'y': 60}, {'x': 400, 'y': 120}]]);
    assert.deepEqual(again.site, corrected);

    // With --fresh, the model is asked again, and its marks are found again - but the author's marks are kept
    const fresh = await runAuto(foundSite, {'args': [...args, '--fresh'], answers, io});
    assert.deepEqual([fresh.code, fresh.asks.length, exclusion(fresh.plan)], [0, 3, [[{'x': 300, 'y': 60}, {'x': 380, 'y': 120}]]]);
    const freshAuthor = await runAuto(corrected, {'args': [...args, '--fresh'], answers, io});
    assert.deepEqual([freshAuthor.code, freshAuthor.asks.map(({key}) => key)], [0, ['notes']]);
    assert.deepEqual(freshAuthor.site, corrected);
    assert.ok(freshAuthor.output.join('').includes('\nNotes: avoid "Barn" - the plan config\'s exclusion area\n'));

    // If the notes change, the notes are asked again - a mark of a place the notes name is kept, and a mark that was found
    // for a place the notes don't name any more is removed
    const changed = await runAuto({...foundSite, 'notes': ['Stay off the barn!']}, {args, answers, io});
    assert.deepEqual([changed.code, changed.asks.map(({key}) => key)], [0, ['notes']]);
    assert.deepEqual(changed.site.exclusions, foundSite.exclusions);
    const removed = await runAuto({...foundSite, 'notes': ['A road.']}, {args, 'answers': {'notes': notesAnswer()}, io});
    assert.deepEqual([removed.code, removed.asks.map(({key}) => key)], [0, ['notes']]);
    assert.equal(removed.site.exclusions, undefined);
    assert.deepEqual(exclusion(removed.plan), []);

    // The notes are asked again if the saved answers can't be read, or the model changes
    io.files['plans/road.work/decisions.json'] = '{';
    const unread = await runAuto({...site, 'notes': ['Stay off the barn!']}, {args, answers, io});
    assert.deepEqual([unread.code, unread.asks.length], [0, 3]);
    const other = await runAuto(null, {'args': ['--model', 'other-model'], answers, io});
    assert.deepEqual([other.code, other.asks.map(({key}) => key)], [0, ['notes']]);
});


test('auto, the notes\' coordinates and bridges', async () => {
    // A place the notes give the coordinates of isn't looked for on the map - its mark is the notes' coordinates
    const base = autoSite();
    const corners = [[300, 60], [380, 60], [380, 120], [300, 120]].map(([x, y]) => siteLatLong(base, x, y));
    const gate = siteLatLong(base, 300, 300);
    const text = (points) => points.map(({latitude, longitude}) => `${latitude}, ${longitude}`).join('; ');
    const site = autoSite({'notes': [
        `Keep off the easement - its corners are ${text(corners)}.`,
        `Pass the gate at ${text([gate])}.`,
        'Replace a stream crossing\'s fill deeper than 2 meters with a bridge.',
        'The lot is at 40.0003, -105.2785 and 40.0004, -105.2786. The far field is at 41.5, -106.5; 41.6, -106.5; 41.6, -106.6.'
    ]});
    const lot = [{'latitude': 40.0003, 'longitude': -105.2785}, {'latitude': 40.0004, 'longitude': -105.2786}];
    const far = [{'latitude': 41.5, 'longitude': -106.5}, {'latitude': 41.6, 'longitude': -106.5}, {'latitude': 41.6, 'longitude': -106.6}];
    const answers = {'notes': notesAnswer({
        'bridgeFill': 2,
        'avoid': [
            {'name': 'Easement', 'where': '', 'points': corners},
            {'name': 'Lot', 'where': 'west', 'points': lot},
            {'name': 'Field', 'where': 'far', 'points': far},
            {'name': 'Shed', 'where': '', 'points': [{'latitude': 40.1, 'longitude': -105.2}, ...far.slice(1)]}
        ],
        'passThrough': [
            {'name': 'Gate', 'where': 'the gate', 'points': [gate]},
            {'name': 'Posts', 'where': '', 'points': lot},
            {'name': 'Far', 'where': '', 'points': far.slice(0, 1)}
        ]
    })};
    const io = await runAuto(site, {'args': ['--model', 'test-model'], answers});
    assert.equal(io.code, 0);
    assert.deepEqual(io.asks.map(({key}) => key), ['notes']);
    assert.deepEqual(io.output.join('').split('\n').filter((line) => line.startsWith('Notes: ')), [
        'Notes: a bridge replaces a stream crossing\'s fill deeper than 2 meters',
        'Notes: avoid "Easement" - an exclusion area of the notes\' 4 corners',
        'Notes: pass through "Gate" - the notes\' point',
        'Notes: "Via Gate" passes through "Gate"',
        'Notes: NOT acted on - avoid "Shed" - the coordinates the model read for it aren\'t the notes\'',
        'Notes: NOT acted on - avoid "Lot" (west) - the notes give 2 of its corners (an area has three or more)',
        'Notes: NOT acted on - avoid "Field" (far) - its corners aren\'t within the site',
        'Notes: NOT acted on - pass through "Posts" - the notes give 2 points for it (a place is one point)',
        'Notes: NOT acted on - pass through "Far" - it isn\'t within the site'
    ]);
    assert.deepEqual([io.site.exclusions, io.site.passThrough], [
        [{'name': 'Easement', 'points': corners, 'found': {'place': 'Easement'}}],
        [{'name': 'Gate', ...gate, 'found': {'place': 'Gate'}}]
    ]);
    assert.deepEqual(io.plan.options.map(({name}) => name), ['New Road', 'Via Gate', 'North Corridor']);
    assert.deepEqual(io.files['plans/road.work/descriptions.md'].split('\n').filter((line) => /^- (Easement|Gate):/.test(line)), [
        '- Easement: the notes\' place to avoid. Its coordinates are the notes\'. Verify it.',
        '- Gate: the notes\' place to pass through (the gate). Its coordinates are the notes\'. Verify it.'
    ]);

    // A bridge - the notes' fill depth is the options', in a steep-sided valley
    const valleySite = autoSite({'notes': ['Bridge the creek.']});
    const steepValley = (east, north) => 1700 + 0.4 * Math.abs(east - siteEast - 40) + 0.02 * (north - siteNorth);
    const structures = async (bridgeFill) => {
        const bridged = await runAuto(valleySite, {
            'args': ['--model', 'test-model'], 'answers': {'notes': notesAnswer({bridgeFill})}, 'elevation': steepValley
        });
        return bridged.plan.options[0].structures.map(({type}) => type).filter((type) => type === 'bridge' || type === 'culvert');
    };
    assert.deepEqual(await structures(null), ['culvert', 'culvert']);
    assert.deepEqual(await structures(2), ['bridge', 'culvert']);

    // A longitude the notes give west is negative
    const west = await runAuto(autoSite({'notes': [`Pass the gate at ${gate.latitude} N, ${-gate.longitude} W.`]}), {
        'args': ['--model', 'test-model'],
        'answers': {'notes': notesAnswer({'passThrough': [{'name': 'Gate', 'where': '', 'points': [gate]}]})}
    });
    assert.deepEqual(west.site.passThrough, [{'name': 'Gate', ...gate, 'found': {'place': 'Gate'}}]);
});


test('auto, the plan config\'s marks', async () => {
    // The plan config's exclusion areas, roads (an existing road that the USGS doesn't map), and places to pass through are
    // the plan's - without a model
    const base = autoSite();
    const site = autoSite({
        'exclusions': [
            {'name': 'Barn', 'points': [[300, 60], [380, 60], [380, 120], [300, 120]].map(([x, y]) => siteLatLong(base, x, y))}
        ],
        'roads': [{'name': 'Farm track', 'points': [[150, 150], [300, 150], [448.87, 372.07]].map(([x, y]) => siteLatLong(base, x, y))}],
        'passThrough': [{'name': 'Oak', ...siteLatLong(base, 200, 320)}, siteLatLong(base, 900, 900)]
    });
    const io = await runAuto(site);
    assert.equal(io.code, 0);
    const lines = io.output.join('').split('\n');
    assert.deepEqual(lines.filter((line) => /^Features|^Existing road|^Option \d|^Notes/.test(line)), [
        'Features: 0 streams, 0 roads, 0 trails, 1 exclusion area, 1 road of the site\'s',
        'Existing road: stations 0.0 to 415.1 (Farm track) - its grade averages 0.4%, 3.3% over its steepest 15 meters',
        'Existing road: stations 435.9 to 461.8 (Farm track) - its grade averages 3.3%, 3.3% over its steepest 15 meters',
        'Notes: "Via Oak" passes through "Oak"',
        'Option 0: "Existing Roads" - cost score 25.8, design warnings: 0',
        'Option 1: "New Road" - cost score 72.6, design warnings: 0',
        'Option 2: "Via Oak" - cost score 84.4, design warnings: 0',
        'Notes: NOT acted on - pass through "Place 2" - it isn\'t within the site'
    ]);
    assert.deepEqual(io.plan.topography.features.map(({type, name, added}) => [type, name, added]), [
        ['exclusion', 'Barn', true], ['road', 'Farm track', true], ['stream', 'Draw 1', true]
    ]);
    assert.deepEqual(io.site, site);

    // Again - the plan's site data is kept, and the plan config's marks are the plan's
    const again = await runAuto(null, {io});
    assert.deepEqual(again.output.slice(0, 2).join('').split('\n').slice(0, 2), [
        'Site: the plan\'s site data is kept - its terrain, streams, roads, trails, and map (its grid is the site\'s - fetch them ' +
            'again with --fetch)',
        'Features: 1 exclusion area, 1 road from the site'
    ]);
    assert.deepEqual(again.plan.topography.features.map(({type, name}) => [type, name]), [
        ['stream', 'Draw 1'], ['exclusion', 'Barn'], ['road', 'Farm track']
    ]);

    // The descriptions - the plan's added features, its places to pass through, and the other corridor that isn't an option
    const descriptions = io.files['plans/road.work/descriptions.md'].split('\n');
    assert.deepEqual(descriptions.filter((line) => /^- (Existing|Exclusion|Places)/.test(line) || line.startsWith('**Options.**')), [
        '- Existing roads: Farm track',
        '- Exclusion areas: Barn',
        '- Places to pass through: Oak, Place 2',
        '**Options.** Another corridor, "North Corridor" (through 262,315), was engineered and not kept - it is in the standard ' +
            'options\' corridor - its middle is an average of 52 meters from them (a corridor apart is 60 meters or more).'
    ]);
});


test('auto, the options\' limit', async () => {
    // The site has an existing road from the start point to the end point, and the notes' four places to pass through -
    // the plan keeps its four best options. The site has no topographic map image, so the model is asked of its terrain.
    const site = autoSite({'notes': ['Go by the trees.'], 'criteria': {'maxGrade': 9}});
    const point = (x, y) => ({'found': true, x, y, 'why': 'Trees.'});
    const answers = {
        'notes': notesAnswer({
            'purpose': '', 'width': 5, 'surface': 'gravel', 'maxGrade': 10,
            'passThrough': ['Oak', 'Elm', 'Ash', 'Fir'].map((name) => ({name, 'where': 'a tree', 'points': []}))
        }),
        'Oak': point(200, 300), 'Elm': point(300, 150), 'Ash': point(400, 250), 'Fir': point(250, 400)
    };
    const roads = [siteRoad(site, 'Mill Rd', [[150, 150], [448.87, 372.07]])];
    const io = await runAuto(site, {'args': ['--model', 'test-model', '-w', '4', '-s', 'native'], answers, roads, 'mapImage': null});
    assert.equal(io.code, 0);
    const lines = io.output.join('').split('\n');
    assert.deepEqual(lines.filter((line) => /^Notes: "|^Option \d/.test(line)), [
        'Notes: "Via Oak" passes through "Oak"',
        'Notes: "Via Elm" passes through "Elm"',
        'Notes: "Via Ash" passes through "Ash"',
        'Notes: "Via Fir" passes through "Fir"',
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

    // The other corridor is the first option that isn't kept - even if it costs less
    const corridor = await runAuto(autoSite({'notes': ['Go by the trees.']}), {'args': ['--model', 'test-model'], 'answers': {
        'notes': notesAnswer({'passThrough': ['Oak', 'Elm', 'Ash'].map((name) => ({name, 'where': '', 'points': []}))}),
        'Oak': point(200, 300), 'Elm': point(300, 150), 'Ash': point(400, 250)
    }});
    assert.deepEqual(corridor.output.join('').split('\n').filter((line) => /^Option \d|^Other/.test(line)), [
        'Other corridor: "North Corridor" (through 262,315) - its middle is an average of 64 meters from the standard options',
        'Option 0: "New Road" - cost score 72.6, design warnings: 0',
        'Option 1: "Via Ash" - cost score 77.7, design warnings: 0',
        'Option 2: "Via Elm" - cost score 79.1, design warnings: 0',
        'Option 3: "Via Oak" - cost score 81.7, design warnings: 0'
    ]);
});


test('auto, a model\'s answers that aren\'t valid', async () => {
    // The notes' answer's members that aren't what they should be are nothing - or they aren't acted on
    const site = autoSite({'notes': ['A road.']});
    const answers = {'notes': {
        'purpose': 5, 'width': '12', 'surface': 7, 'maxGrade': 99, 'minRadius': 1, 'bridgeFill': 500, 'ruleOutRoads': 'Mill Rd',
        'avoid': 'the barn', 'passThrough': [null, {'name': 5}, {'name': '- Gap -', 'points': 'here'}], 'unhandled': null
    }, 'Gap -': {'found': 'yes', 'x': 300, 'y': 300, 'why': ''}};
    const io = await runAuto(site, {'args': ['--model', 'test-model'], answers});
    assert.equal(io.code, 0);
    assert.deepEqual(io.output.join('').split('\n').filter((line) => line.startsWith('Notes: ')), [
        'Notes: NOT acted on - a width of "12" (it isn\'t from 2.4 to 12)',
        'Notes: NOT acted on - a maximum grade of 99 (it isn\'t from 3 to 25)',
        'Notes: NOT acted on - a minimum radius of 1 (it isn\'t from 8 to 150)',
        'Notes: NOT acted on - a bridge for fill deeper than 500 (it isn\'t from 1 to 30)',
        'Notes: NOT acted on - pass through "Gap -" - the model didn\'t find it on the map'
    ]);
    assert.deepEqual(io.asks.map(({key}) => key), ['notes', 'Gap -']);
    assert.equal(io.plan.criteria, undefined);
    assert.deepEqual(io.plan.options.map(({name, section}) => [name, section.width, section.surface]), [
        ['New Road', 4.3, 'gravel'], ['North Corridor', 4.3, 'gravel']
    ]);
    assert.equal(io.files['plans/road.work/descriptions.md'].split('\n')[2].slice(0, 13), '**The site.**');

    // An area's answer that isn't numbers, and a place's coordinates that aren't
    const area = await runAuto(site, {'args': ['--model', 'test-model'], 'answers': {
        'notes': notesAnswer({
            'width': 3,
            'avoid': [
                {'name': 'Barn', 'where': 'north', 'points': []},
                {'name': 'Pen', 'where': '', 'points': [{'latitude': '40', 'longitude': -105}, {}, null]}
            ],
            'passThrough': [{'name': 'Rock', 'where': '', 'points': []}]
        }),
        'Barn': {'found': true, 'west': '300', 'south': 60, 'east': 380, 'north': 120, 'why': ''},
        'Rock': {'found': true, 'x': 300, 'y': 300, 'why': 7}
    }});
    assert.deepEqual(area.output.join('').split('\n').filter((line) => line.startsWith('Notes: ')), [
        'Notes: the road is 3 meters wide',
        'Notes: pass through "Rock" - at x 300, y 300',
        'Notes: "Via Rock" passes through "Rock"',
        'Notes: NOT acted on - avoid "Pen" - the coordinates the model read for it aren\'t the notes\'',
        'Notes: NOT acted on - avoid "Barn" (north) - the model didn\'t find it on the map'
    ]);
    assert.deepEqual(area.site.passThrough.map(({found}) => found), [{'place': 'Rock', 'model': 'test-model', 'why': ''}]);
});


test('auto, a site that\'s too small', async () => {
    // The standard options are at the site's edge - its margin is enlarged, and the plan is made again. A fence across the
    // site leaves only a strip along its west edge.
    const base = autoSite();
    const fence = {'name': 'Fence', 'points': [[10, 200], [700, 200], [700, 330], [10, 330]].map(([x, y]) => siteLatLong(base, x, y))};
    const io = await runAuto(autoSite({'exclusions': [fence]}), {'status': true});
    assert.equal(io.code, 0);
    assert.deepEqual(io.output.join('').split('\n').filter((line) => /^Grid|^Site:/.test(line)), [
        'Grid: 61 x 54 at 10 meters spacing (600 x 530 meters), a margin of 150 meters',
        'Site: the standard options are at the site\'s edge - the site\'s margin is enlarged to 225 meters',
        'Grid: 76 x 69 at 10 meters spacing (750 x 680 meters), a margin of 225 meters'
    ]);
    assert.deepEqual(io.statuses.filter((text) => text.startsWith('site:')), [
        'site: Creating the site - its terrain, streams, roads, and map are the USGS\'s',
        'site: Creating the larger site - its terrain, streams, roads, and map are the USGS\'s'
    ]);
    assert.deepEqual([io.site.margin, io.plan.site.margin], [225, 225]);

    // There's no road within the grade limit, on a steep plane - the site is enlarged twice, and then it's an error
    const steep = await runAuto(autoSite(), {'elevation': (east, north) => 1700 + 0.5 * (north - siteNorth)});
    assert.equal(steep.code, 1);
    const steepLines = steep.output.join('').split('\n');
    assert.deepEqual(steepLines.filter((line) => line.startsWith('Site:')), [
        'Site: there\'s no road within the grade limit - the site\'s margin is enlarged to 225 meters',
        'Site: there\'s no road within the grade limit - the site\'s margin is enlarged to 338 meters'
    ]);
    assert.deepEqual(steepLines.slice(-3), [
        'error: no road within the 11% grade limit - the profile ends 60.8 meters below the end point (try other via points, a ' +
            'longer corridor, or a steeper grade)',
        'error: The site was enlarged 2 times - the road needs a higher maximum grade (the plan config\'s design criteria)',
        ''
    ]);
    assert.ok(!steep.written.includes('plans/road.work/descriptions.md'));

    // The larger site can't be made - the USGS's product service fails
    const pages = testPages({'items': [item]});
    let productQueries = 0;
    const failedIo = testIo({
        'images': {[item.downloadURL]: testImage({'elevation': (east, north) => 1700 + 0.5 * (north - siteNorth)})},
        'pages': (url) => {
            const isProducts = url.startsWith('https://tnmaccess.nationalmap.gov/');
            productQueries += isProducts ? 1 : 0;
            return isProducts && productQueries > 1 ? Promise.reject(new Error('The service failed')) : pages(url);
        },
        'mapImage': pngBytes
    });
    const larger = await runAuto(autoSite(), {'io': failedIo});
    assert.equal(larger.code, 1);
    assert.deepEqual(larger.output.join('').split('\n').slice(-3), [
        'Site: there\'s no road within the grade limit - the site\'s margin is enlarged to 225 meters', 'error: The service failed', ''
    ]);
});


test('auto, failures', async () => {
    // The model fails - it's an error (the plan's site is made)
    const site = autoSite({'notes': ['A road.']});
    const failed = await runAuto(site, {'args': ['--model', 'test-model']});
    assert.equal(failed.code, 1);
    assert.equal(failed.output.join(''), `${siteLines}error: The model "test-model" failed (no notes)\n`);

    // There's no route - the end point is in an exclusion area - and the site isn't enlarged
    const base = autoSite();
    const yard = {'name': 'Yard', 'points': [[400, 320], [500, 320], [500, 420], [400, 420]].map(([x, y]) => siteLatLong(base, x, y))};
    const blocked = await runAuto(autoSite({'exclusions': [yard]}));
    assert.equal(blocked.code, 1);
    assert.deepEqual(blocked.output.join('').split('\n').slice(-2), [
        'error: no route found (blocked by exclusion areas or the topography boundary?)', ''
    ]);
    assert.equal(blocked.site.margin, 150);

    // The site can't be made
    const invalid = await runAuto({'title': 'Site'});
    assert.equal(invalid.code, 1);
    assert.equal(invalid.output.join('').split('\n')[0], 'error: The road site "site.json" is invalid:');
});


test('auto, usage', async () => {
    const usage = `${autoUsage.join('\n')}\n`;
    assert.ok(autoUsage.every((line) => line.length <= 120));
    assert.equal(autoUsage[0], 'usage: plan auto <site.json> <plan.json> [--model MODEL] [--fresh] [--fetch] [options]');
    for (const args of [
        [], ['site.json'], ['site.json', 'road.json', 'other.json'], ['site.json', 'road.json', '--model', ''],
        ['site.json', 'road.json', '-w', 'wide'], ['site.json', 'road.json', '-w', '0'], ['site.json', 'road.json', '-s', 'mud'],
        ['site.json', 'road.json', '--unknown']
    ]) {
        const io = testIo();
        assert.deepEqual([await cliMain(['auto', ...args], io), io.output.join('')], [1, usage]);
    }
});
