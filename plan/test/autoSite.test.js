import {autoSite, item, notesAnswer, pngBytes, runAuto, siteLatLong} from './autoHelpers.js';
import {siteEast, siteNorth, testImage, testIo, testPages} from './terrainHelpers.js';
import assert from 'node:assert/strict';
import test from 'node:test';


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
        'The lot is at 40.0003, -105.2785 and 40.0004, -105.2786. The far field is at 41.5, -106.5; 41.6, -106.5; 41.6, -106.6.',
        'From the start to the top, at 40.002, -105.2765.'
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
            {'name': 'Far', 'where': '', 'points': far.slice(0, 1)},
            {'name': 'start', 'where': '', 'points': []},
            {'name': 'Top', 'where': '', 'points': [{'latitude': 40.002, 'longitude': -105.2765}]}
        ]
    })};
    const io = await runAuto(site, {'args': ['--model', 'test-model'], answers});
    assert.equal(io.code, 0);
    assert.deepEqual(io.asks.map(({key}) => key), ['notes']);
    assert.deepEqual(io.output.join('').split('\n').filter((line) => line.startsWith('Notes: ')), [
        'Notes: a bridge replaces a stream crossing\'s fill deeper than 2 meters',
        'Notes: avoid "Easement" - an exclusion area of the notes\' 4 corners',
        'Notes: pass through "Gate" - the notes\' point',
        'Notes: pass through "start" - it\'s the road\'s start point',
        'Notes: pass through "Top" - it\'s the road\'s end point',
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
    assert.deepEqual(io.descriptions.filter((line) => /^- (Easement|Gate):/.test(line)), [
        '- Easement: the notes\' place to avoid. Its coordinates are the notes\'. Verify it.',
        '- Gate: the notes\' place to pass through (the gate). Its coordinates are the notes\'. Verify it.'
    ]);

    // A bridge - the notes' fill depth is the options', in a steep-sided valley (the road crosses it on a 12 meter fill)
    const valleySite = autoSite({'notes': ['Bridge the creek.']});
    const steepValley = (east, north) => 1700 + 0.36 * Math.abs(east - siteEast - 40) + 0.02 * (north - siteNorth);
    const structures = async (bridgeFill) => {
        const bridged = await runAuto(valleySite, {
            'args': ['--model', 'test-model'], 'answers': {'notes': notesAnswer({bridgeFill})}, 'elevation': steepValley
        });
        return bridged.plan.options[0].structures.map(({type}) => type).filter((type) => type === 'bridge' || type === 'culvert');
    };
    assert.deepEqual(await structures(null), ['culvert']);
    assert.deepEqual(await structures(2), ['bridge']);

    // A longitude the notes give west is negative
    const west = await runAuto(autoSite({'notes': [`Pass the gate at ${gate.latitude} N, ${-gate.longitude} W.`]}), {
        'args': ['--model', 'test-model'],
        'answers': {'notes': notesAnswer({'passThrough': [{'name': 'Gate', 'where': '', 'points': [gate]}]})}
    });
    assert.deepEqual(west.site.passThrough, [{'name': 'Gate', ...gate, 'found': {'place': 'Gate'}}]);
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

    // The plan that failed is its site - the larger one
    const steepPlan = JSON.parse(steep.files['plans/road.json']);
    assert.deepEqual([steepPlan.options, steepPlan.site.margin, steep.site.margin], [[], 338, 338]);

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
