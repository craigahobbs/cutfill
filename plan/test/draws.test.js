import {addDraws, drawAreaText, planDraws, topoDraws} from '../lib/draws.js';
import assert from 'node:assert/strict';
import {planTopo} from '../../viewer/lib/model.js';
import test from 'node:test';


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


// Get a plan's draws (planDraws), as text - each one's number, the area it drains, its length, and where it starts and
// ends
function drawTexts(plan, area = null) {
    const {draws} = planDraws(planTopo(plan), plan.units, area);
    return draws.map(({number, 'area': drawArea, points, length}) => (
        `${number}: drains ${drawAreaText(plan.units, drawArea)} - ${Math.round(length)} long, from ${points[0].join(',')} to ` +
            `${points.at(-1).join(',')}`
    ));
}


test('planDraws', () => {
    // The plan's draws that drain at least 3 acres - it has none
    assert.deepEqual(planDraws(planTopo(valleyPlan()), 'feet'), {'draws': [], 'minArea': 3});

    // A draw's number, its drainage area, its length, and where it starts and ends
    assert.deepEqual(drawTexts(valleyPlan(), 0.1), ['1: drains 1.3 acres - 270 long, from 100,270 to 100,0']);

    // A meters plan's areas are hectares - a draw drains at least 1.2 hectares
    assert.equal(planDraws(planTopo(valleyPlan('meters')), 'meters').minArea, 1.2);
    assert.deepEqual(drawTexts(valleyPlan('meters')), ['1: drains 5.5 hectares - 230 long, from 100,230 to 100,0']);

    // A draw shorter than 100 feet isn't one - the side draw is 84 feet
    assert.deepEqual(drawTexts(forkPlan(), 0.07), ['1: drains 0.53 acres - 190 long, from 100,190 to 100,0']);

    // Many draws - the largest first
    const many = drawTexts(valleysPlan(), 0.1);
    assert.deepEqual([many.length, many[0], many[19]], [
        24, '1: drains 0.27 acres - 180 long, from 40,180 to 40,0', '20: drains 0.27 acres - 180 long, from 800,180 to 800,0'
    ]);
});


test('planDraws, the plan\'s streams', () => {
    // A draw along a stream isn't one
    assert.deepEqual(drawTexts(streamPlan([[100, 300], [100, 0]]), 0.1), []);

    // A draw above a stream is its part down to the stream - within 50 feet of it - and the area that part drains
    assert.deepEqual(drawTexts(streamPlan([[100, 100], [100, 0]]), 0.1), ['1: drains 0.61 acres - 120 long, from 100,270 to 100,150']);

    // A stream away from the draw isn't its stream
    assert.deepEqual(drawTexts(streamPlan([[10, 300], [10, 0]]), 0.1), ['1: drains 1.3 acres - 270 long, from 100,270 to 100,0']);
});


test('addDraws', () => {
    // The draw is added as a stream, named for it - its line, simplified. The plan's topography is a new one.
    const plan = valleyPlan();
    const {topography} = plan;
    assert.deepEqual(addDraws(plan, planTopo(plan), [1], 0.1), {'error': null, 'lines': [
        'Added stream "Draw 1": draw 1 (drains 1.3 acres), 2 points, 270 feet long, from 100,270 to 100,0'
    ]});
    assert.deepEqual(plan.topography.features, [
        {'type': 'stream', 'points': [{'x': 100, 'y': 270}, {'x': 100, 'y': 0}], 'name': 'Draw 1', 'added': true}
    ]);
    assert.deepEqual([Object.keys(plan.topography.features[0]), 'features' in topography], [['type', 'points', 'name', 'added'], false]);
    assert.deepEqual({...plan, 'topography': {'spacing': 10, 'elevations': plan.topography.elevations}}, valleyPlan());

    // It's along a stream now, so it isn't a draw - and the plan is as it was
    assert.deepEqual(drawTexts(plan, 0.1), []);
    const added = plan.topography;
    assert.deepEqual(addDraws(plan, planTopo(plan), [1], 0.1), {'error': 'no draw 1', 'lines': []});
    assert.equal(plan.topography, added);

    // Several draws are added at once - a draw's number doesn't change when another draw is added, and the added draws
    // (and those beside them) aren't draws any more
    const several = valleysPlan();
    assert.deepEqual(addDraws(several, planTopo(several), [3, 1], 0.07).lines.map((line) => line.replace(/\(drains .*$/, '')), [
        'Added stream "Draw 3": draw 3 ', 'Added stream "Draw 1": draw 1 '
    ]);
    assert.deepEqual(several.topography.features.map(({name}) => name), ['Draw 3', 'Draw 1']);
    const before = drawTexts(valleysPlan(), 0.07);
    const after = drawTexts(several, 0.07);
    assert.deepEqual([before.length, after.length, after[0]], [24, 20, '5: drains 0.27 acres - 210 long, from 200,210 to 200,0']);
    assert.deepEqual(after, before.slice(4));

    // A draw above a stream is added down to the stream - after the plan's features
    const above = streamPlan([[100, 100], [100, 0]]);
    addDraws(above, planTopo(above), [1], 0.1);
    assert.deepEqual(above.topography.features, [
        {'type': 'stream', 'points': [{'x': 100, 'y': 100}, {'x': 100, 'y': 0}], 'name': 'Creek'},
        {'type': 'stream', 'points': [{'x': 100, 'y': 270}, {'x': 100, 'y': 150}], 'name': 'Draw 1', 'added': true}
    ]);

    // The default least area of a draw
    const meters = valleyPlan('meters');
    assert.equal(addDraws(meters, planTopo(meters), [1]).error, null);
});


test('topoDraws, a terrain\'s draws are found once', () => {
    // The draws are the terrain's - they're the same for another topography of its elevation rows, whatever its features
    const plan = valleyPlan();
    const draws = topoDraws(planTopo(plan), 1000);
    assert.equal(topoDraws(planTopo({...plan, 'topography': {...plan.topography, 'features': []}}), 1000), draws);

    // Another least area's draws, another spacing's, and another terrain's, are their own
    assert.notEqual(topoDraws(planTopo(plan), 2000), draws);
    assert.notEqual(topoDraws(planTopo({...plan, 'topography': {...plan.topography, 'spacing': 20}}), 1000), draws);
    assert.notEqual(topoDraws(planTopo(valleyPlan()), 1000), draws);
    assert.deepEqual(topoDraws(planTopo(valleyPlan()), 1000), draws);
});
