import {autoSite, item, notesAnswer, optionsLines, runAuto, siteLatLong, siteLines, siteRoad, valley, wroteLine} from './autoHelpers.js';
import {autoUsage, cliMain} from '../lib/cli.js';
import {orderPlan, planText, validatePlan} from '../../viewer/lib/model.js';
import {siteNorth, testImage, testIo, testPages} from './terrainHelpers.js';
import assert from 'node:assert/strict';
import {autoSteps} from '../lib/auto.js';
import test from 'node:test';


test('auto', async () => {
    // Without a model, the plan is the tools' - the site, its standard options (with the draw they cross, as a stream),
    // and the descriptions' facts. The site's notes aren't read.
    const site = autoSite({'notes': ['A gravel road.']});
    const io = await runAuto(site);
    assert.equal(io.code, 0);
    assert.equal(io.output.join(''), `\
${siteLines}Notes: not read - there's no model (--model)
Draws: added the unmapped draws the options crossed, as streams - Draw 1
${optionsLines}Option 0: "New Road" - cost score 72.4, design warnings: 0
Option 1: "North Corridor" - cost score 85.1, design warnings: 0
${wroteLine}`);
    assert.deepEqual(io.asks, []);
    assert.ok('plan' in validatePlan(io.plan));
    assert.deepEqual(io.plan.options.map(({name}) => name), ['New Road', 'North Corridor']);
    assert.deepEqual(io.plan.topography.features.map(({type, name}) => [type, name]), [['stream', 'Draw 1']]);

    // The plan config is the plan's site model - its file isn't changed
    assert.deepEqual([io.plan.site, io.site], [site, site]);
    assert.ok(!io.written.includes('site.json'));

    // The plan's descriptions are the draft's, with what the plan did
    const {descriptions} = io;
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
    assert.deepEqual(io.plan.options.map(({description}) => description.length), [7, 7]);

    // The plan's file is written once, when it's made - in the model's order
    assert.deepEqual(io.written.filter((path) => !path.includes('/terrain/')), ['plans/road.png', 'plans/road.json']);
    assert.equal(io.files['plans/road.json'], planText(orderPlan(validatePlan(io.plan).plan)));

    // The site can't be made - the USGS's services fail - so there's no plan
    const noSite = await runAuto(autoSite(), {'io': testIo()});
    assert.deepEqual([noSite.code, noSite.output.join('').split('\n')[0].slice(0, 7), 'plans/road.json' in noSite.files], [
        1, 'error: ', false
    ]);

    // The site's plan isn't a plan - it's as it was
    const badPlan = JSON.stringify({'options': [{'name': 'Bad'}]});
    const invalid = testIo({'images': {[item.downloadURL]: testImage({'elevation': valley})}, 'pages': testPages({'items': [item]})});
    invalid.files['plans/road.json'] = badPlan;
    await runAuto(autoSite(), {'io': invalid});
    assert.deepEqual([invalid.code, invalid.output.join('').split('\n').at(-4), invalid.files['plans/road.json']], [
        1, 'error: The road plan "plans/road.json" is invalid:', badPlan
    ]);

    // A site without notes
    const plain = await runAuto(autoSite());
    assert.equal(plain.output.join(''), io.output.join('').replace('Notes: not read - there\'s no model (--model)\n', ''));
    assert.ok(plain.descriptions.find((line) => line.startsWith('**Limitations.**')).endsWith(' bid estimates.'));

    // The plan's description says what its draws are - a plan on a plane has none
    const drawsNote = (lines) => lines.filter((line) => line.includes('unmapped draws')).length;
    const plane = await runAuto(autoSite(), {'elevation': (east, north) => 1700 + 0.02 * (north - siteNorth)});
    assert.deepEqual(plane.plan.options.map(({name}) => name), ['New Road', 'South Corridor']);
    assert.deepEqual([plane.plan.topography.features, drawsNote(plane.descriptions)], [[], 0]);
    assert.equal(drawsNote(plain.descriptions), 1);
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
        'options: Engineering another corridor',
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
Option "New Road": 383 meters long, 83 alignment points, max grade 3.6%, max cut 0.1, max fill 0.1
Structures: 1 culvert
Cost score: 122.2, design warnings: 1
Option "North Corridor": 485 meters long, 105 alignment points, max grade 2.1%, max cut 0.1, max fill 0.1
Structures: 1 culvert
Cost score: 150.4, design warnings: 0
Other corridor: "North Corridor" (through 226,367) - its middle is an average of 97 meters from the standard options
Option "Via Ford": 384 meters long, 83 alignment points, max grade 3.6%, max cut 0.1, max fill 0.1
Structures: 1 culvert
Cost score: 122.7, design warnings: 1
Notes: "Via Ford" passes through "Ford"
Option 0: "New Road" - cost score 122.2, design warnings: 1
Option 1: "Via Ford" - cost score 122.7, design warnings: 1
Option 2: "North Corridor" - cost score 150.4, design warnings: 0
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
    assert.deepEqual(io.plan.criteria, {'width': 5, 'surface': 'asphalt', 'maxGrade': 10, 'minRadius': 20});
    assert.deepEqual(io.plan.topography.features.map(({type, name, points}) => [type, name, points.length]), [
        ['road', 'Mill Rd', 2], ['exclusion', 'Barn', 4], ['exclusion', 'Well', 4], ['exclusion', 'Yard', 4], ['stream', 'Draw 1', 2]
    ]);
    assert.deepEqual(io.plan.topography.features[1].points, [
        {'x': 310, 'y': 70}, {'x': 370, 'y': 70}, {'x': 370, 'y': 110}, {'x': 310, 'y': 110}
    ]);
    assert.deepEqual(io.plan.options.map(({name, section}) => [name, section.width, section.surface]), [
        ['New Road', 5, 'asphalt'], ['Via Ford', 5, 'asphalt'], ['North Corridor', 5, 'asphalt']
    ]);

    // The descriptions - the road's purpose, the marks the model found, and the notes that weren't acted on
    const {descriptions} = io;
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
        ' These of the site\'s notes weren\'t acted on: Paint it blue; rule out the road "Nope Rd" (the site has no road of that ' +
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


test('auto, the plan config\'s road', async () => {
    // Without a model, the plan config's width and surface are the options' road
    const site = autoSite({'criteria': {'width': 6, 'surface': 'concrete'}});
    const io = await runAuto(site);
    assert.equal(io.code, 0);
    assert.deepEqual(io.plan.criteria, {'width': 6, 'surface': 'concrete'});
    assert.deepEqual(io.plan.options.map(({name, section}) => [name, section.width, section.surface]), [
        ['New Road', 6, 'concrete'], ['South Corridor', 6, 'concrete']
    ]);

    // The plan config's width and surface win over the notes' - the notes' maximum grade is the plan's still
    const notedSite = autoSite({'notes': ['A 5 meter asphalt road, at most 10%.'], 'criteria': {'width': 6, 'surface': 'concrete'}});
    const noted = await runAuto(notedSite, {
        'args': ['--model', 'test-model'], 'answers': {'notes': notesAnswer({'width': 5, 'surface': 'asphalt', 'maxGrade': 10})}
    });
    assert.equal(noted.code, 0);
    assert.deepEqual(noted.output.join('').split('\n').filter((line) => line.startsWith('Notes: ')), ['Notes: maximum grade 10']);
    assert.deepEqual(noted.plan.criteria, {'width': 6, 'surface': 'concrete', 'maxGrade': 10});
    assert.ok(noted.plan.options.every(({section}) => section.width === 6 && section.surface === 'concrete'));

    // The plan config's width with the notes' surface
    const mixed = await runAuto(autoSite({'notes': ['A 5 meter asphalt road.'], 'criteria': {'width': 6}}), {
        'args': ['--model', 'test-model'], 'answers': {'notes': notesAnswer({'width': 5, 'surface': 'asphalt'})}
    });
    assert.deepEqual(mixed.output.join('').split('\n').filter((line) => line.startsWith('Notes: ')), ['Notes: the road is asphalt']);
    assert.deepEqual(mixed.plan.criteria, {'width': 6, 'surface': 'asphalt'});
    assert.ok(mixed.plan.options.every(({section}) => section.width === 6 && section.surface === 'asphalt'));
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
    assert.equal(io.descriptions[2].slice(0, 13), '**The site.**');

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
