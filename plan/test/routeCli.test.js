import {bestRoad, corridorReason, optionsUsage, routeCommands, routeUsage} from '../lib/routeCli.js';
import {blockedPlan, expected, hillPlan, planePlan, roadPlan} from './roadFixtures.js';
import {planText, validatePlan} from '../../viewer/lib/model.js';
import assert from 'node:assert/strict';
import test from 'node:test';


// Run a route or profile command on a plan ("plan.json") - returns the command's result (null for a usage error) and
// the written plan (null if it wasn't written)
function run(plan, argv) {
    const files = {'plan.json': typeof plan === 'string' ? plan : JSON.stringify(plan)};
    const written = [];
    const result = routeCommands[argv[0]](argv.slice(1), {
        'readFile': (path) => {
            if (!(path in files)) {
                throw new Error(`No such file "${path}"`);
            }
            return files[path];
        },
        'writeFile': (path, text) => written.push([path, text])
    });
    assert.ok(written.length <= 1);
    return {result, 'written': written.length === 1 ? written[0] : null, 'plan': written.length === 1 ? JSON.parse(written[0][1]) : null};
}


// Run one of the Python planning tools' commands on a plan - returns the command's result and the written plan. The
// Python planning tools' routes were searched with a grade penalty weight of 1.
function runExpected(plan, name) {
    const [command, ...args] = expected.commands[name].argv;
    const weightArgs = command === 'route' && !args.includes('--grade-weight') ? ['--grade-weight', '1'] : [];
    const ran = run(plan, [command, 'plan.json', ...args, ...weightArgs]);

    // The Python planning tools' last line names their "evaluate" command
    const pythonLine = (line) => line.replace(/^Wrote (\S+)$/, 'Wrote $1 - run "plan evaluate $1" for the full analysis and cost');
    return {...ran, 'result': {...ran.result, 'lines': ran.result.lines.map(pythonLine)}};
}


// Get a command's result as the Python planning tools' results have them - their existing roads' lines have no grades
function pythonResult({code, lines}) {
    return {code, 'lines': lines.map((line) => line.replace(/^(Existing road: .*?) - its grade averages .*$/, '$1'))};
}


// Get a plan's options as the Python planning tools' results have them - every "step"th alignment point, and the last
function summarize(options, step) {
    return options.map((option) => ({
        ...option,
        'alignment': option.alignment.filter((point, ix) => ix % step === 0 || ix === option.alignment.length - 1),
        'alignmentCount': option.alignment.length
    }));
}


// A plan of a plane (8%, or too steep for the grade limit) with three hand-made options - one with an existing road
function profilePlan(rise = 0.08) {
    const plan = planePlan({rise});
    plan.start = {'x': 50, 'y': 0};
    plan.end = {'x': 50, 'y': 100};
    plan.options = [
        {
            'name': 'Test',
            'description': ['Kept'],
            'section': {'width': 14},
            'alignment': [{'x': 50, 'y': 0}, {'x': 50, 'y': 100}],
            'structures': [{'type': 'existingRoad', 'station': 50.5, 'endStation': 100}]
        },
        {
            'name': 'Curve',
            'description': [],
            'section': {'width': 14},
            'alignment': [{'x': 10, 'y': 10}, {'x': 60, 'y': 20}, {'x': 80, 'y': 50}, {'x': 40, 'y': 70}, {'x': 60, 'y': 95}]
        },
        {'name': 'Down', 'section': {'width': 14}, 'alignment': [{'x': 50, 'y': 100}, {'x': 50, 'y': 0}]}
    ];
    return plan;
}


// A plan of a 20% plane, without options
function switchbackPlan() {
    const plan = planePlan({'rise': 0.2, 'size': 61});
    plan.start = {'x': 100, 'y': 100};
    plan.end = {'x': 300, 'y': 500};
    delete plan.options;
    return plan;
}


test('routeUsage', () => {
    assert.deepEqual(routeUsage.slice(0, 2), ['usage: plan route <plan.json> -n NAME [-v X,Y]... [options]', '']);
    assert.ok(routeUsage.every((line) => line.length <= 120));
    assert.deepEqual(Object.keys(routeCommands), ['route', 'options']);
    assert.equal(optionsUsage[0], 'usage: plan options <plan.json> [options]');
    assert.ok(optionsUsage.every((line) => line.length <= 120));
    assert.deepEqual(optionsUsage.slice(-12, -2), routeUsage.slice(13, 23));
    assert.ok(optionsUsage.at(-2).startsWith('  --rule-out NAME '));
    assert.ok(routeUsage.some((line) => line.startsWith('  --rule-out NAME ')));
});


test('route, a switchback road', () => {
    // A 20% plane needs a switchback road to climb at the design grade - the first search's profile can't reach the end,
    // so the route is searched again with stricter grades
    const {result, written, plan} = runExpected(switchbackPlan(), 'route-plane');
    const {code, lines, options} = expected.commands['route-plane'];
    assert.deepEqual(result, {code, lines});
    assert.equal(code, 0);
    assert.deepEqual(lines, [
        'The profile ends 17.6 feet below the end point - searching with stricter grades',
        'Option "Switchbacks": 783 feet long, 158 alignment points, max grade 11.0%, max cut 8.8, max fill 3.9',
        'Structures: 1 turnout',
        'Cost score: 73.0, design warnings: 0',
        'Wrote plan.json - run "plan evaluate plan.json" for the full analysis and cost'
    ]);

    // The option is added to the plan - its alignment is from the start point to the end point, on the ground at both
    assert.deepEqual(summarize(plan.options, 10), options);
    const [option] = plan.options;
    assert.deepEqual(Object.keys(plan), ['title', 'units', 'topography', 'start', 'end', 'options']);
    assert.deepEqual(Object.keys(option), ['name', 'section', 'alignment', 'structures']);
    assert.deepEqual(option.section, {'width': 14, 'cutSlope': 1, 'fillSlope': 1.5, 'surface': 'gravel'});
    assert.equal(option.alignment.length, 158);
    assert.deepEqual(option.alignment[0], {'x': 100, 'y': 100, 'z': 120});
    assert.deepEqual(option.alignment.at(-1), {'x': 300, 'y': 500, 'z': 200});
    assert.deepEqual(option.structures, [{'type': 'turnout', 'station': 366.6, 'endStation': 416.6, 'side': 'left'}]);

    // The road is longer than the climb at the design grade, and no steeper than it
    const grades = option.alignment.slice(1).map((point, ix) => {
        const prev = option.alignment[ix];
        return Math.abs(point.z - prev.z) / Math.hypot(point.x - prev.x, point.y - prev.y);
    });
    assert.ok(Math.max(...grades) <= 0.11 + 0.002);
    assert.ok(80 / 0.11 < 783);

    // The plan is written as the plan file's text, and it's a valid road plan model
    assert.equal(written[0], 'plan.json');
    assert.equal(written[1], planText(plan));
    assert.ok('plan' in validatePlan(plan));
});


test('route, via points, streams, rock, and an exclusion area', () => {
    // The Python planning tools' report, then the notes - the road goes out to its second via point and returns, and
    // it's along the site's edge
    const {result, plan} = runExpected(hillPlan(), 'route-hill');
    const {code, lines, options} = expected.commands['route-hill'];
    assert.deepEqual(result, {code, 'lines': [
        ...lines.slice(0, -1),
        'NOTE: the road is 5 meters from the site\'s edge at station 431 - the site may be too small for the best route (the site ' +
            'model\'s "margin")',
        'NOTE: the road turns back at the via point 150,60 (station 645) - if it isn\'t a switchback you meant, move the via point ' +
            'along the road\'s corridor, or drop it',
        lines.at(-1)
    ]});
    assert.deepEqual(summarize(plan.options, 10), options);
    const [option] = plan.options;
    assert.deepEqual(option.description, ['A road', 'Second line']);
    assert.deepEqual(option.section, {'width': 4.3, 'cutSlope': 1, 'fillSlope': 1.5, 'surface': 'gravel'});
    assert.equal(lines[0], 'Option "Hill Road": 900 meters long, 241 alignment points, max grade 9.0%, max cut 2.9, max fill 4.2');
    assert.deepEqual(lines.slice(1, 3), ['Structures: 1 bridge, 7 culverts, 7 turnouts', 'Cost score: 545.8, design warnings: 0']);
    assert.deepEqual([...new Set(option.structures.map(({type}) => type))].sort(), ['bridge', 'culvert', 'turnout']);
    assert.ok('plan' in validatePlan(plan));
});


test('route, the grade penalty weights', () => {
    // A route is searched with each grade penalty weight (1, 0.5, and 0.25), and the road is the one with the lowest
    // cost score - here, a lighter weight's road is shorter and costs less than the weight of 1's
    const routed = (args) => run(hillPlan(), ['route', 'plan.json', '-n', 'Hill', ...args]);
    const road = routed([]);
    assert.deepEqual(road.result.lines.slice(0, 3), [
        'Option "Hill": 261 meters long, 71 alignment points, max grade 9.0%, max cut 1.8, max fill 2.2',
        'Structures: 2 culverts, 2 turnouts',
        'Cost score: 92.9, design warnings: 0'
    ]);
    assert.deepEqual(routed(['--grade-weight', '1']).result.lines.slice(0, 3), [
        'Option "Hill": 298 meters long, 81 alignment points, max grade 8.4%, max cut 1.7, max fill 1.8',
        'Structures: 2 culverts, 2 turnouts',
        'Cost score: 98.0, design warnings: 0'
    ]);
    assert.deepEqual(routed(['--grade-weight', '0.5']).plan, road.plan);

    // With a design grade of 7%, the weight of 1's road costs the least
    assert.equal(routed(['-g', '7']).result.lines[2], 'Cost score: 99.6, design warnings: 0');
    assert.deepEqual(routed(['-g', '7']).plan, routed(['-g', '7', '--grade-weight', '1']).plan);
    assert.equal(routed(['-g', '7', '--grade-weight', '0.25']).result.lines[2], 'Cost score: 105.8, design warnings: 0');
});


test('bestRoad', () => {
    // The road with the lowest cost score, as it's reported - the first of the roads with that score
    const road = (warnings, score) => ({warnings, score});
    assert.equal(bestRoad([road(0, 10)]), 0);
    assert.equal(bestRoad([road(0, 10), road(0, 8), road(0, 9)]), 1);
    assert.equal(bestRoad([road(0, 10), road(0, 8), road(0, 8)]), 1);
    assert.equal(bestRoad([road(0, 10), road(0, 10), road(0, 12)]), 0);
    assert.equal(bestRoad([road(0, 527.04), road(0, 526.96), road(0, 526.94)]), 2);

    // A road with more design warnings than the first road isn't the best, whatever its score - and one with fewer is
    // only the best if its score is lower
    assert.equal(bestRoad([road(0, 10), road(1, 5), road(0, 9)]), 2);
    assert.equal(bestRoad([road(2, 10), road(0, 80), road(1, 9), road(3, 1)]), 2);
    assert.equal(bestRoad([road(1, 10), road(0, 11)]), 0);
});


test('route, the design arguments', () => {
    const {result, plan} = runExpected(hillPlan(), 'route-hill-custom');
    const {code, lines, options} = expected.commands['route-hill-custom'];
    assert.deepEqual(pythonResult(result), {code, lines});
    assert.equal(result.lines[1], 'Existing road: stations 0.0 to 30.0 - its grade averages 0.2%, 5.4% over its steepest 12 meters');
    assert.deepEqual(summarize(plan.options, 10), options);
    const [option] = plan.options;
    assert.deepEqual(option.section, {'width': 6, 'cutSlope': 0.75, 'fillSlope': 2, 'surface': 'asphalt'});
    assert.deepEqual(option.structures[0], {'type': 'existingRoad', 'station': 0, 'endStation': 30, 'name': 'Existing road'});
    assert.ok(option.structures.every(({type}) => type !== 'turnout'));
    // (The Python planning tools broke grade where this road leaves its existing road - their vertical curves weren't
    // held to the existing road's ground - so its maximum grade was 7.7%)
    assert.deepEqual(lines, [
        'Option "Wide": 304 meters long, 83 alignment points, max grade 7.0%, max cut 1.9, max fill 3.0',
        'Existing road: stations 0.0 to 30.0',
        'Structures: 1 existing road, 3 culverts',
        'Cost score: 176.2, design warnings: 0',
        'Wrote plan.json - run "plan evaluate plan.json" for the full analysis and cost'
    ]);
});


test('route, existing roads', () => {
    // An existing road, east and then north to the end point, costs less than a new road straight there - the route is
    // a new road east to the existing road, and then it follows it. The existing road is from the minimum radius after
    // the route joins it (the junction's curve is new road), to the end point.
    let {result, plan} = run(roadPlan(), ['route', 'plan.json', '-n', 'Road']);
    assert.deepEqual(result, {'code': 0, 'lines': [
        'Option "Road": 569 feet long, 115 alignment points, max grade 0.3%, max cut 0.1, max fill 0.0',
        'Existing road: stations 144.9 to 568.7 (Mill Rd) - its grade averages 3.6%, 5.0% over its steepest 50 feet',
        'Structures: 1 existing road, 1 culvert',
        'Cost score: 23.5, design warnings: 0',
        'Wrote plan.json'
    ]});
    let [option] = plan.options;
    assert.deepEqual(option.structures, [
        {'type': 'culvert', 'station': 54.9, 'name': 'Sag cross drain'},
        {'type': 'existingRoad', 'station': 144.9, 'endStation': 568.7, 'name': 'Existing road'}
    ]);
    assert.ok('plan' in validatePlan(plan));

    // The alignment is along the existing road (east at y = 47, then north at x = 329), on the ground - but for the 11
    // points of its corner, which the route's move across it cuts
    const onRoad = option.alignment.filter(({x, y}) => (y === 47 && x >= 141) || (x === 329 && y >= 47));
    assert.equal(onRoad.length, 33 + 52);
    assert.equal(option.alignment.filter(({x, y}) => y !== 47 && x !== 329).length, 11);
    assert.ok(onRoad.every(({x, y, z}) => x < 141 + 50 || Math.abs(z - (100 + 0.05 * y)) < 0.011));
    assert.deepEqual(
        [option.alignment[0], option.alignment.at(-1)],
        [{'x': 47, 'y': 47, 'z': 102.34}, {'x': 329, 'y': 352.5, 'z': 117.62}]
    );

    // Through a via point on the existing road, it's the same road
    assert.deepEqual(run(roadPlan(), ['route', 'plan.json', '-n', 'Road', '-v', '188,47']).plan, plan);

    // An all-new road is straight to the end point
    ({result, plan} = run(roadPlan(), ['route', 'plan.json', '-n', 'Road', '--all-new']));
    assert.deepEqual(result.lines.slice(0, 3), [
        'Option "Road": 418 feet long, 85 alignment points, max grade 4.3%, max cut 0.2, max fill 0.0',
        'Structures: 1 turnout',
        'Cost score: 21.1, design warnings: 0'
    ]);
    ([option] = plan.options);
    assert.deepEqual(option.structures, [{'type': 'turnout', 'station': 184, 'endStation': 234, 'side': 'left'}]);

    // The existing road arguments are the road's existing roads - the route doesn't follow the plan's
    ({result, plan} = run(roadPlan(), ['route', 'plan.json', '-n', 'Road', '--existing-road', '0,30']));
    assert.deepEqual(result.lines.slice(0, 3), [
        'Option "Road": 418 feet long, 85 alignment points, max grade 3.8%, max cut 0.1, max fill 0.0',
        'Existing road: stations 0.0 to 30.0 - its grade averages 4.5%',
        'Structures: 1 existing road, 1 turnout'
    ]);
    assert.equal(plan.options[0].alignment.length, 85);

    // A plan whose existing road has no name
    const unnamed = roadPlan();
    delete unnamed.topography.features[0].name;
    assert.equal(
        run(unnamed, ['route', 'plan.json', '-n', 'Road']).result.lines[1],
        'Existing road: stations 144.9 to 568.7 - its grade averages 3.6%, 5.0% over its steepest 50 feet'
    );
});


// A plan of six valleys down to the south, 400 feet apart (each drains 7 acres), without streams - 2,400 x 800 feet. The
// start point is west of the first valley's bottom, and the end point is east of it - or, with "far", east of the last
// valley's. With "road", an existing road is between the start point and the first valley's end point.
function valleysPlan({far = false, road = false} = {}) {
    const elevations = [];
    for (let row = 0; row < 41; row++) {
        elevations.push(Array.from({'length': 121}, (unused, col) => (
            Math.round((100 + 0.05 * Math.abs((col * 20) % 400 - 200) + 0.02 * (40 - row) * 20) * 100) / 100
        )));
    }
    const features = road ? [{'type': 'road', 'points': [{'x': 94, 'y': 94}, {'x': 305.5, 'y': 94}]}] : [];
    return {
        'title': 'Valleys',
        'units': 'feet',
        'topography': {'spacing': 20, elevations, features},
        'start': {'x': 94, 'y': 94},
        'end': {'x': far ? 2303 : 305.5, 'y': 94},
        'options': []
    };
}


test('route, the unmapped draws a road crosses', () => {
    // A valley that drains 3 acres or more is a draw - a road that crosses one that isn't a stream of the plan has no
    // culvert there, which the report notes
    const note = (draws) => `NOTE: the road crosses ${draws} - a draw that carries water needs a culvert (a plan's run adds ` +
        'it as a stream, and engineers the road again)';
    let {result} = run(valleysPlan(), ['route', 'plan.json', '-n', 'Across']);
    assert.deepEqual(result.lines.slice(0, 4), [
        'Option "Across": 212 feet long, 23 alignment points, max grade 5.2%, max cut 0.1, max fill 1.2',
        'Structures: 1 culvert, 1 turnout',
        'Cost score: 20.6, design warnings: 0',
        note('an unmapped draw - draw 1 (7.2 acres) at station 106 (200,94)')
    ]);

    // Once the draw is a stream of the plan, it isn't unmapped - the road has its culvert
    const stream = valleysPlan();
    stream.topography.features.push({'type': 'stream', 'name': 'First Draw', 'points': [{'x': 200, 'y': 800}, {'x': 200, 'y': 0}]});
    const streamRun = run(stream, ['route', 'plan.json', '-n', 'Across']);
    assert.deepEqual(streamRun.result.lines.slice(1, 4), [
        'Structures: 1 culvert, 1 turnout', 'Cost score: 23.5, design warnings: 0', 'Wrote plan.json'
    ]);
    assert.equal(streamRun.plan.options[0].structures.find(({type}) => type === 'culvert').name, 'First Draw culvert');

    // A road's first crossing of each draw, in station order
    ({result} = run(valleysPlan({'far': true}), ['route', 'plan.json', '-n', 'Across']));
    assert.equal(result.lines[3], note(
        '6 unmapped draws - draw 1 (7.2 acres) at station 110 (204,94), draw 2 (7.2 acres) at station 510 (604,94), draw 3 (7.2 ' +
        'acres) at station 910 (1004,94), draw 4 (7.2 acres) at station 1309 (1403,94), draw 5 (7.2 acres) at station 1709 ' +
        '(1803,94), draw 6 (6.8 acres) at station 2109 (2203,94)'
    ));

    // An existing road has its own culverts - its draws aren't noted, but for its part that isn't an existing road
    const routed = run(valleysPlan({'road': true}), ['route', 'plan.json', '-n', 'Across']);
    assert.deepEqual(routed.result.lines.slice(1, 4), [
        'Existing road: stations 0.0 to 211.5 - its grade averages 0.0%, 5.0% over its steepest 50 feet',
        'Structures: 1 existing road',
        'Cost score: 3.9, design warnings: 0'
    ]);
    assert.equal(routed.result.lines.length, 5);
    ({result} = run(valleysPlan({'road': true}), ['route', 'plan.json', '-n', 'Across', '--existing-road', '0,50']));
    assert.equal(result.lines[4], note('an unmapped draw - draw 1 (7.2 acres) at station 106 (200,94)'));
});


// A plan of a 30% plane with an existing road straight up it - between exclusion areas, so there's no room for an
// all-new road's switchbacks - and an "All New" option
function corridorPlan() {
    const plan = planePlan({'rise': 0.3, 'size': 41});
    plan.topography.features = [
        {'type': 'road', 'points': [{'x': 47, 'y': 47}, {'x': 47, 'y': 352.5}]},
        {'type': 'exclusion', 'points': [{'x': -10, 'y': -10}, {'x': 15, 'y': -10}, {'x': 15, 'y': 410}, {'x': -10, 'y': 410}]},
        {'type': 'exclusion', 'points': [{'x': 80, 'y': -10}, {'x': 410, 'y': -10}, {'x': 410, 'y': 410}, {'x': 80, 'y': 410}]}
    ];
    plan.start = {'x': 47, 'y': 47};
    plan.end = {'x': 47, 'y': 352.5};
    plan.options = [{'name': 'New Road', 'section': {'width': 14}, 'alignment': [{'x': 47, 'y': 47}, {'x': 47, 'y': 352.5}]}];
    return plan;
}


test('options', () => {
    // The plan's standard options - the road that follows its existing roads where that costs less than a new road, and
    // an all-new road. The plan's options are in cost score order, the best first.
    const {result, written, plan} = run(roadPlan(), ['options', 'plan.json']);
    assert.deepEqual(result, {'code': 0, 'lines': [
        'Option "Existing Roads": 569 feet long, 115 alignment points, max grade 0.3%, max cut 0.1, max fill 0.0',
        'Existing road: stations 144.9 to 568.7 (Mill Rd) - its grade averages 3.6%, 5.0% over its steepest 50 feet',
        'Structures: 1 existing road, 1 culvert',
        'Cost score: 23.5, design warnings: 0',
        'Option "New Road": 418 feet long, 85 alignment points, max grade 4.3%, max cut 0.2, max fill 0.0',
        'Structures: 1 turnout',
        'Cost score: 21.1, design warnings: 0',
        'No other corridor: "East Corridor" (through 235,188) is in the standard options\' corridor - its middle is an average ' +
            'of 31 feet from them (a corridor apart is 200 feet or more)',
        'Option 0: "New Road" - cost score 21.1, design warnings: 0',
        'Option 1: "Existing Roads" - cost score 23.5, design warnings: 0',
        'Wrote plan.json'
    ], 'names': ['New Road', 'Existing Roads'], 'atEdge': false, 'corridorNote': 'Another corridor, "East Corridor" (through ' +
        '235,188), was engineered and not kept - it is in the standard options\' corridor - its middle is an average of 31 feet ' +
        'from them (a corridor apart is 200 feet or more).'});
    assert.equal(written[1], planText(plan));
    assert.ok('plan' in validatePlan(plan));
    assert.deepEqual(plan.options.map(({name}) => name), ['New Road', 'Existing Roads']);

    // They're the route command's roads
    const routed = (args) => run(roadPlan(), ['route', 'plan.json', ...args]).plan.options[0];
    assert.deepEqual(plan.options[0], routed(['-n', 'New Road', '--all-new']));
    assert.deepEqual(plan.options[1], routed(['-n', 'Existing Roads']));

    // Engineered again, the standard options are replaced, and the plan's other options are kept - with the design
    // options, a wider road's
    plan.options.push({'name': 'Trail', 'section': {'width': 14}, 'alignment': [{'x': 47, 'y': 47}, {'x': 329, 'y': 352.5}]});
    const again = run(plan, ['options', 'plan.json', '-w', '20', '-s', 'asphalt']);
    assert.deepEqual(again.result.lines.slice(-4, -1), [
        'Option 0: "Trail" - cost score 19.6, design warnings: 0',
        'Option 1: "Existing Roads" - cost score 36.4, design warnings: 0',
        'Option 2: "New Road" - cost score 44.0, design warnings: 0'
    ]);
    assert.deepEqual(again.plan.options.map(({section}) => section.width), [14, 20, 20]);
    assert.deepEqual(again.plan.options[1].section, {'width': 20, 'cutSlope': 1, 'fillSlope': 1.5, 'surface': 'asphalt'});
});


test('options and route, an existing road that\'s ruled out', () => {
    // The roads don't follow a road that's ruled out (by its name, in any case) - it's the plan's road still. There's no
    // "Existing Roads" option, and the route is the all-new road's.
    const {result, plan} = run(roadPlan(), ['options', 'plan.json', '--rule-out', 'mill rd']);
    assert.deepEqual(result.lines.slice(0, -1), [
        'Option "New Road": 418 feet long, 85 alignment points, max grade 4.3%, max cut 0.2, max fill 0.0',
        'Structures: 1 turnout',
        'Cost score: 21.1, design warnings: 0',
        'No other corridor: "South Corridor" (through 188,212) is in the standard options\' corridor - its middle is an average ' +
            'of 0 feet from them (a corridor apart is 200 feet or more)',
        'Option 0: "New Road" - cost score 21.1, design warnings: 0'
    ]);
    assert.deepEqual(plan.topography.features.filter(({type}) => type === 'road').map(({name}) => name), ['Mill Rd']);
    const routed = (args) => run(roadPlan(), ['route', 'plan.json', '-n', 'Road', ...args]).plan.options[0];
    assert.deepEqual(routed(['--rule-out', 'Mill Rd']), routed(['--all-new']));

    // A road that isn't the plan's can't be ruled out - nor can a road without a name
    for (const command of [['options', 'plan.json'], ['route', 'plan.json', '-n', 'Road']]) {
        for (const name of ['Nope Rd', '']) {
            const unknown = run(roadPlan(), [...command, '--rule-out', 'Mill Rd', '--rule-out', name]);
            assert.deepEqual([unknown.result, unknown.written], [
                {'code': 1, 'lines': [`error: The plan has no existing road named "${name}" to rule out`]}, null
            ]);
        }
    }
});


test('options, a plan without existing roads', () => {
    // There's only the new road - the plan's stale "Existing Roads" option is removed
    const plan = profilePlan();
    plan.options.push({...plan.options[1], 'name': 'Existing Roads'});
    let {result, plan: written} = run(plan, ['options', 'plan.json']);
    assert.deepEqual(result.lines, [
        'Option "New Road": 100 feet long, 22 alignment points, max grade 8.1%, max cut 0.0, max fill 0.0',
        'Structures: none',
        'Cost score: 4.7, design warnings: 0',
        'No other corridor: "West Corridor" (through 47,70) is in the standard options\' corridor - its middle is an average ' +
            'of 0 feet from them (a corridor apart is 200 feet or more)',
        'Option 0: "Test" - cost score 3.3, design warnings: 0',
        'Option 1: "Down" - cost score 4.6, design warnings: 2',
        'Option 2: "New Road" - cost score 4.7, design warnings: 0',
        'Option 3: "Curve" - cost score 7.9, design warnings: 2',
        'Wrote plan.json'
    ]);
    assert.deepEqual(written.options.map(({name}) => name), ['Test', 'Down', 'New Road', 'Curve']);

    // The plan's existing roads aren't on the least-cost road's way - it's the new road
    const far = roadPlan([[282, 47], [329, 47], [329, 94]]);
    ({result, 'plan': written} = run(far, ['options', 'plan.json']));
    assert.deepEqual(result.lines.slice(0, 2), [
        'No "Existing Roads" option: the least-cost road follows no existing roads',
        'Option "New Road": 418 feet long, 85 alignment points, max grade 4.3%, max cut 0.2, max fill 0.0'
    ]);
    assert.deepEqual(written.options.map(({name}) => name), ['New Road']);
});


test('options, no road within the grade limit', () => {
    // There's no all-new road within the grade limit, but the existing road is one (as it's built) - the plan's stale
    // "New Road" option is removed
    const {result, plan} = run(corridorPlan(), ['options', 'plan.json']);
    assert.deepEqual(result, {'code': 0, 'lines': [
        'Option "Existing Roads": 306 feet long, 63 alignment points, max grade 0.0%, max cut 0.0, max fill 0.0',
        'Existing road: stations 0.0 to 305.5 - its grade averages 30.0%, 30.0% over its steepest 50 feet',
        'Structures: 1 existing road',
        'Cost score: 5.7, design warnings: 0',
        'The profile ends 58.0 feet below the end point - searching with stricter grades',
        'The profile ends 58.0 feet below the end point - searching with stricter grades',
        'The profile ends 58.0 feet below the end point - searching with stricter grades',
        'No "New Road" option: no road within the 11% grade limit - the profile ends 58.0 feet below the end point (try other via ' +
            'points, a longer corridor, or a steeper grade)',
        'No other corridor: "East Corridor" (through 47,212) is in the standard options\' corridor - its middle is an average ' +
            'of 0 feet from them (a corridor apart is 200 feet or more)',
        'Option 0: "Existing Roads" - cost score 5.7, design warnings: 0',
        'Wrote plan.json'
    ], 'names': ['Existing Roads'], 'atEdge': false, 'corridorNote': 'Another corridor, "East Corridor" (through 47,212), was ' +
        'engineered and not kept - it is in the standard options\' corridor - its middle is an average of 0 feet from them (a ' +
        'corridor apart is 200 feet or more).'});
    assert.deepEqual(plan.options.map(({name}) => name), ['Existing Roads']);

    // Without the existing road, there's no road - it's an error, and the plan isn't written
    const noRoad = corridorPlan();
    noRoad.topography.features.shift();
    const failed = run(noRoad, ['options', 'plan.json']);
    assert.deepEqual(failed.result.lines.slice(-2), [
        'The profile ends 58.0 feet below the end point - searching with stricter grades',
        'error: no road within the 11% grade limit - the profile ends 58.0 feet below the end point (try other via points, a ' +
            'longer corridor, or a steeper grade)'
    ]);
    assert.deepEqual([failed.result.code, failed.written], [1, null]);

    // Neither is there a road that follows the plan's existing roads, where they don't reach the end point
    const short = corridorPlan();
    short.topography.features[0].points[1].y = 150;
    const shortRun = run(short, ['options', 'plan.json']);
    assert.equal(shortRun.result.code, 1);
    assert.ok(shortRun.result.lines.at(-1).startsWith('error: no road within the 11% grade limit - '));
    assert.equal(shortRun.written, null);
});


// Create a plan of a hill between the start and end points - there are roads around each side of it (the east side is
// higher)
function hillCorridorPlan() {
    const plan = planePlan({'size': 61});
    plan.topography.elevations = plan.topography.elevations.map((row, ixRow) => row.map((value, col) => {
        const [x, y] = [col * 10, (60 - ixRow) * 10];
        return Math.round((100 + 80 * Math.exp(-((x - 300) ** 2 + (y - 300) ** 2) / 20000) + 0.03 * (600 - x)) * 100) / 100;
    }));
    plan.start = {'x': 300, 'y': 40};
    plan.end = {'x': 300, 'y': 560};
    return plan;
}


test('options, another corridor', () => {
    // The least-cost road around the standard option's middle goes around the hill's other side - the road through its
    // middle is the other corridor's option, named for its side of the least-cost road
    const plan = hillCorridorPlan();
    plan.options = [{'name': 'West Corridor', 'section': {'width': 14}, 'alignment': [plan.start, plan.end]}];
    const {result, plan: written} = run(plan, ['options', 'plan.json']);
    assert.deepEqual(result, {'code': 0, 'lines': [
        'Option "New Road": 661 feet long, 134 alignment points, max grade 10.0%, max cut 1.9, max fill 0.1',
        'Structures: 1 turnout',
        'Cost score: 40.8, design warnings: 0',
        'Option "East Corridor": 645 feet long, 131 alignment points, max grade 5.7%, max cut 2.0, max fill 0.1',
        'Structures: 1 turnout',
        'Cost score: 43.7, design warnings: 0',
        'Other corridor: "East Corridor" (through 470,306) - its middle is an average of 220 feet from the standard options',
        'Option 0: "New Road" - cost score 40.8, design warnings: 0',
        'Option 1: "East Corridor" - cost score 43.7, design warnings: 0',
        'Wrote plan.json'
    ], 'names': ['New Road', 'East Corridor'], 'atEdge': false, 'corridorNote': null});

    // It's the route command's road through the via point - and an earlier corridor (of any side) is replaced
    assert.deepEqual(written.options.map(({name}) => name), ['New Road', 'East Corridor']);
    const [routed] = run(hillCorridorPlan(), ['route', 'plan.json', '-n', 'East Corridor', '-v', '470,306']).plan.options;
    assert.deepEqual(written.options[1], routed);
});


test('options, no other corridor', () => {
    // The standard option's corridor is a strip between exclusion areas - there's no way around its middle
    const plan = planePlan({'rise': 0.05, 'size': 101});
    plan.topography.features = [
        {'type': 'exclusion', 'points': [{'x': -10, 'y': -10}, {'x': 400, 'y': -10}, {'x': 400, 'y': 1010}, {'x': -10, 'y': 1010}]},
        {'type': 'exclusion', 'points': [{'x': 600, 'y': -10}, {'x': 1010, 'y': -10}, {'x': 1010, 'y': 1010}, {'x': 600, 'y': 1010}]}
    ];
    plan.start = {'x': 500, 'y': 50};
    plan.end = {'x': 500, 'y': 950};
    const {result} = run(plan, ['options', 'plan.json']);
    assert.deepEqual([result.lines[3], result.names, result.corridorNote], [
        'No other corridor: there\'s no way around the standard options\' corridor within the site',
        ['New Road'],
        'There\'s no other corridor - no way around the standard options\' corridor within the site.'
    ]);
});


test('corridorReason', () => {
    // The other corridor's road is a real choice if it's a road, it doesn't turn back at its via point, it's apart from the
    // standard options, and it costs at most three times the least-cost option
    const road = {'error': null, 'turnsBack': false};
    const measured = [];
    const distance = (value) => () => {
        measured.push('distance');
        return value;
    };
    const score = (value) => () => {
        measured.push('score');
        return value;
    };
    assert.equal(corridorReason(road, distance(250), 200, score(300), 100, 'feet'), null);
    assert.equal(corridorReason(road, distance(200), 200, score(300), 100, 'feet'), null);
    assert.deepEqual(measured, ['distance', 'score', 'distance', 'score']);
    assert.equal(
        corridorReason(road, distance(150.4), 200, score(300), 100, 'meters'),
        'is in the standard options\' corridor - its middle is an average of 150 meters from them (a corridor apart is 200 meters ' +
            'or more)'
    );
    assert.equal(
        corridorReason(road, distance(250), 200, score(3456.7), 1000, 'feet'),
        'costs 3.5 times the least-cost option (cost score 3,456.7, more than 3 times)'
    );

    // A road that isn't one, or turns back, isn't measured
    measured.length = 0;
    assert.equal(
        corridorReason({'error': 'no road within the 11% grade limit', 'turnsBack': false}, distance(0), 200, score(0), 100, 'feet'),
        'isn\'t a road: no road within the 11% grade limit'
    );
    const turnsBack = {'error': null, 'turnsBack': true};
    assert.equal(corridorReason(turnsBack, distance(0), 200, score(0), 100, 'feet'), 'turns back at its via point');
    assert.deepEqual(measured, []);
});


test('options, invalid arguments', () => {
    // The route command's option arguments aren't the options command's
    for (const args of [[], ['plan.json', 'other'], ['plan.json', '-n', 'Road'], ['plan.json', '--all-new'], ['plan.json', '-w', 'a']]) {
        assert.equal(run(roadPlan(), ['options', ...args]).result, null);
    }

    // A plan that can't be loaded
    assert.deepEqual(run('{', ['options', 'plan.json']).result, {'code': 1, 'lines': ['error: Could not load the road plan "plan.json"']});
});


test('route, an option is replaced', () => {
    const {result, plan} = run(profilePlan(), ['route', 'plan.json', '-n', 'Test']);
    assert.deepEqual(result, {'code': 0, 'lines': [
        'Option "Test": 100 feet long, 22 alignment points, max grade 8.1%, max cut 0.0, max fill 0.0',
        'Structures: none',
        'Cost score: 4.7, design warnings: 0',
        'Wrote plan.json'
    ]});

    // The option keeps its place and its description - its structures are the new road's
    assert.deepEqual(plan.options.map((option) => option.name), ['Test', 'Curve', 'Down']);
    assert.deepEqual(plan.options[0].description, ['Kept']);
    assert.deepEqual(plan.options[0].structures, []);
    assert.equal(plan.options[0].alignment.length, 22);
});


test('route, no road within the grade limit', () => {
    // A road straight up a 30% plane can't climb it within the grade limit - every search's profile ends below the end
    // point, so there's no road: it's an error, and the plan isn't written
    const {result, written} = run(profilePlan(0.3), ['route', 'plan.json', '-n', 'Test']);
    assert.deepEqual(result, {'code': 1, 'lines': [
        'The profile ends 19.0 feet below the end point - searching with stricter grades',
        'The profile ends 19.0 feet below the end point - searching with stricter grades',
        'The profile ends 19.0 feet below the end point - searching with stricter grades',
        'error: no road within the 11% grade limit - the profile ends 19.0 feet below the end point (try other via points, a ' +
            'longer corridor, or a steeper grade)'
    ]});
    assert.equal(written, null);

    // With a steeper design grade, there's a road
    assert.equal(run(profilePlan(0.3), ['route', 'plan.json', '-n', 'Test', '-g', '31']).result.code, 0);

    // Down the plane, the profile ends above the end point
    const down = profilePlan(0.3);
    [down.start, down.end] = [down.end, down.start];
    assert.equal(
        run(down, ['route', 'plan.json', '-n', 'Test']).result.lines.at(-1),
        'error: no road within the 11% grade limit - the profile ends 19.0 feet above the end point (try other via points, a ' +
            'longer corridor, or a steeper grade)'
    );

    // An existing road's range that isn't along one of the plan's roads has no grade to report
    assert.deepEqual(run(profilePlan(), ['route', 'plan.json', '-n', 'Test', '--existing-road', '20,22']).result.lines.slice(1, 3), [
        'Existing road: stations 20.0 to 22.0', 'Structures: 1 existing road'
    ]);

    // An existing road partway up the plane follows the ground - the grade limit can't reach it
    const existing = run(profilePlan(0.3), ['route', 'plan.json', '-n', 'Test', '--existing-road', '50,60']).result;
    assert.deepEqual([existing.code, existing.lines.at(-1)], [
        1,
        'error: no road within the 11% grade limit - the profile can\'t reach the existing road at station 53 (try other via ' +
            'points, a longer corridor, or a steeper grade)'
    ]);
});


test('route, no route', () => {
    const {result, written} = runExpected(blockedPlan(), 'route-blocked');
    const {code, lines} = expected.commands['route-blocked'];
    assert.deepEqual(result, {code, lines});
    assert.deepEqual(result, {'code': 1, 'lines': ['error: no route found (blocked by exclusion areas or the topography boundary?)']});
    assert.equal(written, null);
});


test('route, the plan can\'t be loaded', () => {
    const error = {'code': 1, 'lines': ['error: Could not load the road plan "missing.json"']};
    assert.deepEqual(run(profilePlan(), ['route', 'missing.json', '-n', 'Test']).result, error);
    assert.deepEqual(
        run('Not JSON', ['route', 'plan.json', '-n', 'Test']).result,
        {'code': 1, 'lines': ['error: Could not load the road plan "plan.json"']}
    );

    // An invalid plan isn't engineered
    const invalid = profilePlan();
    invalid.topography.spacing = 0;
    const {result, written} = run(invalid, ['route', 'plan.json', '-n', 'Test']);
    assert.deepEqual(result, {
        'code': 1,
        'lines': [
            'error: The road plan "plan.json" is invalid:',
            '',
            'Invalid value 0 (type "number") for member "topography.spacing", expected type "float" [> 0]'
        ]
    });
    assert.equal(written, null);
});


test('route, invalid arguments', () => {
    for (const args of [
        [],
        ['plan.json'],
        ['-n', 'Test'],
        ['plan.json', 'other.json', '-n', 'Test'],
        ['plan.json', '-n', 'Test', '--unknown'],
        ['plan.json', '-n', 'Test', '-s', 'mud'],
        ['plan.json', '-n', 'Test', '-w', 'wide'],
        ['plan.json', '-n', 'Test', '-g', '1o'],
        ['plan.json', '-n', 'Test', '--bridge-fill', 'deep'],
        ['plan.json', '-n', 'Test', '--existing-road', '100'],
        ['plan.json', '-n', 'Test', '--existing-road', '100,end'],
        ['plan.json', '-n', 'Test', '--existing-road', '100,200,300']
    ]) {
        assert.equal(run(profilePlan(), ['route', ...args]).result, null, args.join(' '));
    }

    // The via points and weights
    for (const args of [['-v', '50'], ['-v', '50,north'], ['--grade-weight', 'heavy'], ['--slope-weight', '']]) {
        assert.equal(run(profilePlan(), ['route', 'plan.json', '-n', 'Test', ...args]).result, null, args.join(' '));
    }
});
