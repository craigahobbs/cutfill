import {
    createDesign, crossSection, featureStreams, groundElevation, groundGradient, sectionCut, sectionFill, sectionSlopeWidth, sectionWall,
    sectionWallLeft, sectionWallRight
} from '../lib/design.js';
import {designArgs, expected, hillPlan, planePlan} from './roadFixtures.js';
import assert from 'node:assert/strict';
import {planTopo} from '../../viewer/lib/model.js';
import test from 'node:test';


// Get the Python planning tools' design as a design object
function pythonDesign(design) {
    return {
        'feet': design.feet,
        'grade': design.grade,
        'switchbackGrade': design.switchback_grade,
        'minRadius': design.min_radius,
        'rockCutSlope': design.rock_cut_slope,

        // The maximum slope height - the Python tools' slopes had none
        'maxSlopeHeight': design.feet ? 60 : 18,
        'width': design.width,
        'halfWidth': design.half_width,
        'surface': design.surface,
        'cutSlope': design.cut_slope,
        'fillSlope': design.fill_slope,

        // The planning tools' stations are at least 5 feet (1.5 meters) apart - the Python tools' had no least interval
        'stationInterval': design.feet ? 5 : 1.5,
        'costCut': design.cost_cut,
        'costRock': design.cost_rock,
        'costFill': design.cost_fill,
        'costBorrow': design.cost_borrow,
        'costWaste': design.cost_waste,
        'costArea': design.cost_area,
        'costWall': design.cost_wall,
        'costLength': design.cost_length,
        'costCulvert': design.cost_culvert,

        // An existing road's upgrade - the Python tools' route search didn't follow existing roads
        'costExisting': design.width * (design.feet ? 13 * 0.3048 * 0.3048 : 13),
        'shrink': design.shrink,

        // The most a road's cut or fill is deep - the Python tools' profile design's depth limit
        'maxDepth': design.feet ? 60 : 18,
        'turnoutSpacing': design.turnout_spacing,
        'bridgeFill': design.bridge_fill,
        'tieTolerance': design.tie_tolerance
    };
}


test('createDesign', () => {
    // A feet plan's defaults - the design grade is 1% less than the maximum grade, and the unit costs are per foot
    const design = createDesign(planePlan(), designArgs());
    assert.deepEqual(design, pythonDesign(expected['design-feet']));
    assert.deepEqual(
        [design.feet, design.grade, design.switchbackGrade, design.minRadius, design.width, design.turnoutSpacing, design.tieTolerance],
        [true, 0.11, 0.08, 50, 14, 400, 1]
    );
    assert.equal(design.costCut, 20 * (0.3048 * 0.3048 * 0.3048));
    assert.equal(design.costArea, 2.75 * (0.3048 * 0.3048));

    // A meters plan with design criteria and cost rates
    const meters = createDesign(hillPlan(), designArgs());
    assert.deepEqual(meters, pythonDesign(expected['design-meters']));
    assert.deepEqual(
        [meters.feet, meters.grade, meters.minRadius, meters.rockCutSlope, meters.width, meters.turnoutSpacing, meters.tieTolerance],
        [false, 0.1 - 0.01, 12, 0.25, 4.3, 120, 0.3]
    );
    assert.equal(meters.costLength, 4.3 * (25 + 2 + 0.75) + 45);
    assert.equal(meters.costCulvert, 6000 + 1000 * 0.45 * 4.3 * 3);

    // The arguments - a wide road has no turnouts, and the switchback grade is at most the design grade
    const args = designArgs({
        'grade': 9, 'width': 16, 'surface': 'asphalt', 'cutSlope': 0.75, 'fillSlope': 2, 'switchbackGrade': 12, 'turnouts': 0,
        'bridgeFill': 6
    });
    const custom = createDesign(planePlan(), args);
    assert.deepEqual(custom, pythonDesign(expected['design-custom']));
    assert.deepEqual(
        [custom.grade, custom.switchbackGrade, custom.width, custom.surface, custom.cutSlope, custom.fillSlope, custom.turnoutSpacing,
            custom.bridgeFill],
        [0.09, 0.09, 16, 'asphalt', 0.75, 2, 0, 6]
    );
    assert.equal(createDesign(planePlan(), designArgs({'width': 16})).turnoutSpacing, 0);
    assert.equal(createDesign(planePlan({'units': 'meters'}), designArgs({'width': 5})).turnoutSpacing, 0);
    assert.equal(createDesign(planePlan(), designArgs({'turnouts': 250})).turnoutSpacing, 250);

    // A null width or surface is the plan's design criteria's - a wide road's, without turnouts - and the arguments'
    // win over them
    const criteriaPlan = {...planePlan(), 'criteria': {'width': 30, 'surface': 'asphalt'}};
    const criteria = createDesign(criteriaPlan, designArgs({'surface': null}));
    assert.deepEqual([criteria.width, criteria.halfWidth, criteria.surface, criteria.turnoutSpacing], [30, 15, 'asphalt', 0]);
    assert.equal(criteria.costLength, createDesign(planePlan(), designArgs({'width': 30, 'surface': 'asphalt'})).costLength);
    const argued = createDesign(criteriaPlan, designArgs({'width': 12, 'surface': 'native'}));
    assert.deepEqual([argued.width, argued.surface, argued.turnoutSpacing], [12, 'native', 400]);
    const plain = createDesign(planePlan(), designArgs({'surface': null}));
    assert.deepEqual([plain.width, plain.surface], [14, 'gravel']);
});


test('groundElevation and groundGradient', () => {
    // A plane rising 10% to the north - outside the grid, the ground is the grid's nearest point's
    const plane = planTopo(planePlan());
    assert.equal(groundElevation(plane, 50, 50), 105);
    assert.equal(groundElevation(plane, -10, 120), 110);
    assert.equal(groundElevation(plane, 150, -5), 100);
    const [gradientX, gradientY] = groundGradient(plane, 50, 50);
    assert.equal(gradientX, 0);
    assert.ok(Math.abs(gradientY - 0.1) < 1e-12);

    // A hill - within, at the edges of, and outside the grid
    const hill = planTopo(hillPlan());
    assert.deepEqual(
        expected.topo.map(({x, y}) => ({x, y, 'z': groundElevation(hill, x, y), 'gradient': groundGradient(hill, x, y)})),
        expected.topo
    );
    assert.deepEqual(groundGradient(hill, 250, -30), [0, 0]);
});


test('featureStreams', () => {
    const [stream1, stream2] = featureStreams(planTopo(hillPlan()));
    assert.deepEqual(stream1, {'name': 'West Creek', 'points': [{'x': 60, 'y': 0}, {'x': 61, 'y': 100}, {'x': 60, 'y': 200}]});
    assert.deepEqual(stream2, {'name': 'stream', 'points': [{'x': 0, 'y': 150}, {'x': 200, 'y': 151}]});
    assert.deepEqual(featureStreams(planTopo(planePlan())), []);
});


test('crossSection', () => {
    // The Python planning tools' cross sections - their slopes had no maximum height
    const sectionHeight = (maxSlopeHeight, ...args) => Array.from(crossSection(...args, maxSlopeHeight, new Float64Array(6)));
    const section = (...args) => sectionHeight(Infinity, ...args);
    assert.deepEqual(expected.sections.map(({args}) => ({args, 'out': section(...args)})), expected.sections);

    // A plane cross slope of 0.1 at grade - half the road is cut and half is fill, each with its slope
    let values = section(0, 0.1, 5, 1, 1.5);
    assert.ok(Math.abs(values[sectionCut] - (1.25 + 0.25 / 1.8)) < 1e-12);
    assert.ok(Math.abs(values[sectionFill] - (1.25 + 0.25 / (2 * (2 / 3 - 0.1)))) < 1e-12);
    assert.ok(Math.abs(values[sectionSlopeWidth] - (0.5 / 0.9 + 0.5 / (2 / 3 - 0.1))) < 1e-12);
    assert.deepEqual([values[sectionWall], values[sectionWallLeft], values[sectionWallRight]], [0, 0, 0]);

    // A fill side slope steeper than the fill slope can't daylight - it's a wall (and so is a cut side slope steeper
    // than the cut slope)
    values = section(0, 0.8, 5, 1, 1.5);
    assert.deepEqual([values[sectionWall], values[sectionWallLeft], values[sectionWallRight]], [4, 0, 4]);
    values = section(1.5, 1.2, 6, 1, 1.5);
    assert.deepEqual([values[sectionWallLeft], values[sectionWallRight]], [8.7, 5.699999999999999]);

    // A level cross section at grade has no earthwork
    assert.deepEqual(section(0, 0, 5, 1, 1.5), [0, 0, 0, 0, 0, 0]);

    // A slope that doesn't daylight within the maximum slope height is a wall, too. On a side slope of 0.5, a cut that's
    // 4 deep at the road's edge has a slope that's 8 high (and 8 wide), and a fill that's 1 deep has a slope that's 4
    // high (and 6 wide).
    const rounded = (maxSlopeHeight) => sectionHeight(maxSlopeHeight, 1.5, 0.5, 5, 1, 1.5).map((value) => Math.round(value * 1e9) / 1e9);
    assert.deepEqual(rounded(8), [32, 4, 14, 0, 0, 0]);
    assert.deepEqual(rounded(7.9), [16, 4, 6, 4, 4, 0]);
    assert.deepEqual(rounded(3.9), [16, 1, 0, 5, 4, 1]);
});
