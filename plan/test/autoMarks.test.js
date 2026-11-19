import {autoSite, notesAnswer, runAuto, siteLatLong, siteRoad} from './autoHelpers.js';
import assert from 'node:assert/strict';
import test from 'node:test';


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

    // If the notes change, the notes are asked again - a mark of a place the notes name is kept (its name is the same
    // in any case - a model doesn't write it the same way every time), and a mark that was found for a place the notes
    // don't name any more is removed
    const lowerNotes = notesAnswer({'surface': 'gravel', 'avoid': [{'name': 'barn', 'where': 'north', 'points': []}]});
    const changed = await runAuto({...foundSite, 'notes': ['Stay off the barn!']}, {args, 'answers': {'notes': lowerNotes}, io});
    assert.deepEqual([changed.code, changed.asks.map(({key}) => key)], [0, ['notes']]);
    assert.deepEqual(changed.site.exclusions, foundSite.exclusions);
    assert.ok(changed.output.join('').includes('\nNotes: avoid "barn" - the plan config\'s exclusion area\n'));
    assert.deepEqual(changed.descriptions.filter((line) => line.startsWith('- Barn: ')), [
        '- Barn: the notes\' place to avoid (north). The model "test-model" found it on the site\'s map - "A block." Verify it.'
    ]);
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
        'Notes: "Via Oak" passes through "Oak"',
        'Option 0: "Existing Roads" - cost score 25.8, design warnings: 0',
        'Option 1: "New Road" - cost score 72.5, design warnings: 0',
        'Option 2: "Via Oak" - cost score 89.2, design warnings: 0',
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
    const {descriptions} = io;
    assert.deepEqual(descriptions.filter((line) => /^- (Existing|Exclusion|Places)/.test(line) || line.startsWith('**Options.**')), [
        '- Existing roads: Farm track',
        '- Exclusion areas: Barn',
        '- Places to pass through: Oak, Place 2',
        '**Options.** Another corridor, "North Corridor" (through 262,352), was engineered and not kept - it costs 3.3 times the ' +
            'least-cost option (cost score 85.1, more than 3 times).'
    ]);
});


test('auto, a place to pass through that\'s a dead end', async () => {
    // The plan config's place to pass through is at the end of its road that's a dead end, off the road's way - the road
    // would go out to it along the road and return, so its option passes it by. The report and the descriptions say so.
    const base = autoSite();
    const site = autoSite({
        'roads': [{'name': 'Mine Rd', 'points': [[300, 261], [420, 100]].map(([x, y]) => siteLatLong(base, x, y))}],
        'passThrough': [{'name': 'Mine', ...siteLatLong(base, 420, 100)}]
    });
    const io = await runAuto(site);
    assert.equal(io.code, 0);
    const lines = io.output.join('').split('\n');
    assert.deepEqual(lines.filter((line) => /^Option|^Notes|^NOTE: the via/.test(line)), [
        'Option "New Road": 377 meters long, 102 alignment points, max grade 3.6%, max cut 0.0, max fill 0.1',
        'Option "North Corridor": 464 meters long, 125 alignment points, max grade 2.0%, max cut 0.1, max fill 0.1',
        'Option "Via Mine": 403 meters long, 109 alignment points, max grade 3.5%, max cut 0.0, max fill 0.2',
        'NOTE: the via point 420,100 is a dead end off the road\'s way - the road would go out to it and return, so it passes it ' +
            'by, 138 meters from it (station 220)',
        'Notes: "Via Mine" passes 138 meters from "Mine" - it\'s a dead end off the road\'s way',
        'Option 0: "New Road" - cost score 72.5, design warnings: 0',
        'Option 1: "Via Mine" - cost score 76.9, design warnings: 0',
        'Option 2: "North Corridor" - cost score 85.1, design warnings: 0'
    ]);
    assert.deepEqual(io.descriptions.filter((line) => /^- (Existing|Places)/.test(line) || line.startsWith('**Options.**')), [
        '- Existing roads: Mine Rd',
        '- Places to pass through: Mine',
        '**Options.** "Via Mine" passes 138 meters from "Mine" - the place is a dead end off the road\'s way (the road would go out ' +
            'to it and return), so the road passes it by.'
    ]);

    // The option doesn't follow the dead end's road - it's a new road, near the standard option's
    const option = io.plan.options.find(({name}) => name === 'Via Mine');
    assert.deepEqual(option.structures.filter(({type}) => type === 'existingRoad'), []);
    assert.equal(Math.round(Math.min(...option.alignment.map(({x, y}) => Math.hypot(x - 420, y - 100)))), 138);
});


test('auto, the options\' limit', async () => {
    // The site has an existing road from the start point to the end point, and the notes' four places to pass through -
    // the plan keeps its four best options. The site has no topographic map image, so the model is asked of its terrain.
    const site = autoSite({'notes': ['Go by the trees.'], 'criteria': {'maxGrade': 9}});
    const point = (x, y) => ({'found': true, x, y, 'why': 'Trees.'});
    const answers = {
        'notes': notesAnswer({
            'purpose': '', 'width': 5, 'surface': 'gravel', 'maxGrade': 10,
            'passThrough': ['Oak', 'Elm', 'Ash', 'Fir', 'Gate'].map((name) => ({name, 'where': 'a tree', 'points': []}))
        }),
        'Oak': point(200, 300), 'Elm': point(300, 150), 'Ash': point(400, 250), 'Fir': point(250, 400), 'Gate': point(152, 160)
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
        'Option 1: "Via Ash" - cost score 41.6, design warnings: 0',
        'Option 2: "New Road" - cost score 43.0, design warnings: 0',
        'Option 3: "Via Elm" - cost score 48.4, design warnings: 0'
    ]);

    // A place the model finds at the road's start point isn't a place to pass through - the road is from it
    assert.ok(lines.includes('Notes: pass through "Gate" - it\'s the road\'s start point'));
    assert.deepEqual(io.site.passThrough.map(({name}) => name), ['Oak', 'Elm', 'Ash', 'Fir']);

    // The site's own criteria are the plan's, and the arguments' road is the options'
    assert.deepEqual(io.plan.criteria, {'maxGrade': 9});
    assert.deepEqual(io.plan.options.map(({name, section}) => [name, section.width, section.surface]), [
        ['Existing Roads', 4, 'native'], ['Via Ash', 4, 'native'], ['New Road', 4, 'native'], ['Via Elm', 4, 'native']
    ]);

    // The other corridor is the first option that isn't kept - even if it costs less (its cost score is 85.1, and "Via
    // Fir"'s is 111.7)
    const corridor = await runAuto(autoSite({'notes': ['Go by the trees.']}), {'args': ['--model', 'test-model'], 'answers': {
        'notes': notesAnswer({'passThrough': ['Oak', 'Elm', 'Fir'].map((name) => ({name, 'where': '', 'points': []}))}),
        'Oak': point(200, 300), 'Elm': point(300, 150), 'Fir': point(500, 420)
    }});
    const corridorLines = corridor.output.join('').split('\n');
    assert.ok(corridorLines.includes('Cost score: 85.1, design warnings: 0'));
    assert.deepEqual(corridorLines.filter((line) => /^Option \d|^Other/.test(line)), [
        'Other corridor: "North Corridor" (through 262,352) - its middle is an average of 105 meters from the standard options',
        'Option 0: "New Road" - cost score 72.5, design warnings: 0',
        'Option 1: "Via Elm" - cost score 79.2, design warnings: 0',
        'Option 2: "Via Oak" - cost score 86.8, design warnings: 0',
        'Option 3: "Via Fir" - cost score 111.7, design warnings: 0'
    ]);
});
