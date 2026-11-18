import {planData, simplePlan} from './viewFixtures.js';
import {project, projection, smoothLimitsCanvas, view3DParts} from '../lib/view3d.js';
import {Explorer} from '../lib/explore.js';
import {argsParse} from '../lib/args.js';
import assert from 'node:assert/strict';
import {elevation} from '../lib/model.js';
import {exploreStyle} from '../lib/draw.js';
import {fixturePlan} from './fixture.js';
import {opsToSvg} from '../lib/canvas.js';
import test from 'node:test';


// The overlay text element attributes
const textAttr = 'font-family="sans-serif" text-anchor="start" dominant-baseline="middle"';
const textStroke = 'stroke="white" stroke-width="3" paint-order="stroke"';


// Create a plan's 3D explorer, and draw it at 800 by 600 pixels
function explore(planValue, globals = {'vFile': 'plans/fixture.json', 'vExplore': true}) {
    const explorer = new Explorer(planData(planValue), globals, argsParse(globals));
    explorer.render(800, 600);
    return explorer;
}


// The explorer's view state - [x, y, z, azimuth, tilt, zoom], with the view center to a hundredth
function viewState(explorer) {
    const {state} = explorer;
    const center = [state.x, state.y, state.z].map((value) => (value !== null ? Math.round(value * 100) / 100 : null));
    return [...center, state.azimuth, state.tilt, state.zoom];
}


// Project a ground point to the explorer's view - [px, py]
function groundPixel(explorer, x, y) {
    return project(explorer.view, x, y, elevation(explorer.data.topo, x, y)).slice(0, 2);
}


// Assert that pixels are within a twentieth of a pixel of the expected pixels
function assertPixel(actual, expected) {
    assert.ok(
        Math.abs(actual[0] - expected[0]) < 0.05 && Math.abs(actual[1] - expected[1]) < 0.05,
        `${actual} is not ${expected}`
    );
}


test('Explorer, the view arguments', () => {
    // The default view
    let explorer = new Explorer(planData(fixturePlan()), {'vFile': 'plans/fixture.json'}, argsParse({'vFile': 'plans/fixture.json'}));
    assert.equal(explorer.ixOption, 0);
    assert.equal(explorer.view, null);
    assert.equal(explorer.drag, null);
    assert.deepEqual(explorer.state, {'azimuth': 30, 'tilt': 35, 'exaggeration': 1.5, 'zoom': 1, 'x': null, 'y': null, 'z': null});
    assert.deepEqual(explorer.reset, explorer.state);
    assert.equal(explorer.backURL(), "#var.vFile='plans%2Ffixture.json'");
    assert.equal(explorer.viewURL(), "#var.vExplore=true&var.vFile='plans%2Ffixture.json'");

    // The view arguments - the report link keeps the plan and its option, but not the view, and the explorer's URL keeps
    // its view. The reset view is the default view.
    const globals = {
        'vFile': 'plans/fixture.json', 'vExplore': true, 'vOption': 1, 'vAzimuth': 120, 'vTilt': 50, 'vExaggeration': 2, 'vZoom': 2,
        'vX': 100, 'vY': 50, 'vZ': 510
    };
    explorer = new Explorer(planData(fixturePlan()), globals, argsParse(globals));
    assert.equal(explorer.ixOption, 1);
    assert.deepEqual(explorer.state, {'azimuth': 120, 'tilt': 50, 'exaggeration': 2, 'zoom': 2, 'x': 100, 'y': 50, 'z': 510});
    assert.deepEqual(explorer.reset, {'azimuth': 30, 'tilt': 35, 'exaggeration': 1.5, 'zoom': 1, 'x': null, 'y': null, 'z': null});
    assert.equal(explorer.backURL(), "#var.vFile='plans%2Ffixture.json'&var.vOption=1");
    assert.equal(
        explorer.viewURL(),
        "#var.vAzimuth=120&var.vExaggeration=2&var.vExplore=true&var.vFile='plans%2Ffixture.json'&var.vOption=1&var.vTilt=50&" +
            'var.vX=100&var.vY=50&var.vZ=510&var.vZoom=2'
    );
    assert.equal(explorer.analysis.name, 'Bridge - East');

    // An option index beyond the options is the last option, and a negative index is the first
    assert.equal(new Explorer(planData(fixturePlan()), {}, argsParse({'vOption': 5})).ixOption, 1);
    assert.equal(new Explorer(planData(fixturePlan()), {}, argsParse({'vOption': -1})).ixOption, 0);
    assert.equal(new Explorer(planData(fixturePlan()), {}, argsParse({})).backURL(), '#var=');
});


test('Explorer.renderSvg', () => {
    const globals = {'vFile': 'plans/fixture.json', 'vExplore': true, 'vOption': 1, 'vAzimuth': 120, 'vZoom': 2, 'vX': 100, 'vY': 50};
    const explorer = new Explorer(planData(fixturePlan()), globals, argsParse(globals));
    const svg = explorer.renderSvg(800, 600);

    // The drawing fills the width and height, without margins
    assert.equal(
        exploreStyle,
        'background: #f4f1ea; border: 1px solid #ccc; display: block; max-width: 100%; height: auto; break-inside: avoid; margin: 0;'
    );
    const svgOpen = '<svg width="800" height="600" viewBox="0 0 800 600" role="img" ' +
        `aria-label="3D view of the Bridge - East road plan option" style="${exploreStyle}">`;
    assert.ok(svg.startsWith(`${svgOpen}<polygon points="`));

    // The view is the view arguments' fill view, with smooth terrain
    const {view, data} = explorer;
    assert.deepEqual(view, projection(data.topo, {...explorer.state, 'fill': true, 'smooth': true}, 800, 600));
    assert.deepEqual([view.width, view.height, view.cy, view.zoom, view.smooth, view.xc, view.yc], [800, 600, 300, 2, true, 100, 50]);
    const parts = view3DParts(data.plan, data.topo, data.rows(1), 1, data.analysis(1), view);
    assert.equal(parts.smooth, 3);

    // The overlays - the report link and the view status (the view center is on the ground)
    const status = `<text x="12" y="586" font-size="12" ${textAttr} fill="#222" ${textStroke}>Center x 100, y 50, z 506 ft - zoom 2x, ` +
        'rotation 120, tilt 35, exaggeration 1.5x</text>';
    const backLink = '<a href="#var.vFile=&#039;plans%2Ffixture.json&#039;&amp;var.vOption=1">' +
        `<text x="12" y="20" font-size="14" ${textAttr} fill="#1f4e8c" ${textStroke} font-weight="bold">Back to the report</text></a>`;
    assert.equal(svg, `${svgOpen}${opsToSvg(parts.ops)}${backLink}${status}</svg>`);

    // The drawing with other terrain limits
    const limited = explorer.renderSvg(800, 600, {...smoothLimitsCanvas, 'points': 300});
    const limitedParts = view3DParts(data.plan, data.topo, data.rows(1), 1, data.analysis(1), view, {...smoothLimitsCanvas, 'points': 300});
    assert.deepEqual([limitedParts.step, limitedParts.smooth, limitedParts.pointLimited], [2, 1, true]);
    assert.ok(limited.startsWith(`${svgOpen}${opsToSvg(limitedParts.ops)}${backLink}`));
});


test('Explorer.render', () => {
    const explorer = explore(simplePlan(), {'vFile': 'simple.json', 'vExplore': true});
    const drawing = explorer.render(400, 300);
    const {view, data} = explorer;
    const parts = view3DParts(data.plan, data.topo, data.rows(0), 0, data.analysis(0), view);

    // The drawing's size, label, and terrain - the 55 pixel grid cells are divided in four (the SVG drawing's limit)
    assert.deepEqual(
        {...drawing, 'ops': null},
        {
            'width': 400, 'height': 300, 'label': '3D view of the Flat road plan option', 'ops': null, 'cells': 256, 'smooth': 4,
            'step': 1, 'pointLimited': false
        }
    );
    assert.equal(drawing.ops.filter((op) => op.t === 0).length, 16 * 16);

    // The drawing's operations, then the view status, in meters (the report link and the controls are left to the page)
    assert.equal(drawing.ops.length, parts.ops.length + 1);
    assert.deepEqual(drawing.ops.slice(0, -1).map((op) => op.t), parts.ops.map((op) => op.t));
    assert.deepEqual(drawing.ops.at(-1), {
        't': 3,
        'text': 'Center x 20, y 20, z 107 m - zoom 1x, rotation 30, tilt 35, exaggeration 1.5x',
        'x': 12,
        'y': 286,
        'size': 12,
        'anchor': 'start',
        'f': '#222',
        'bold': false
    });

    // The view status - the zoom and exaggeration to two decimal places
    explorer.command('in');
    explorer.setExaggeration(1.25);
    explorer.dragStart('orbit');
    explorer.dragMove(-20, 15);
    assert.equal(
        explorer.render(400, 300).ops.at(-1).text,
        'Center x 20, y 20, z 107 m - zoom 1.41x, rotation 21, tilt 39.5, exaggeration 1.25x'
    );

    // The canvas terrain limits - the cells are at least 3 pixels, or as small as the point limit allows
    explorer.command('reset');
    let canvas = explorer.render(400, 300, smoothLimitsCanvas);
    assert.deepEqual([canvas.smooth, canvas.step, canvas.pointLimited], [8, 1, false]);
    canvas = explorer.render(400, 300, {...smoothLimitsCanvas, 'points': 400});
    assert.deepEqual([canvas.smooth, canvas.step, canvas.pointLimited], [4, 1, true]);
});


test('Explorer, dragging to move', () => {
    const explorer = explore(fixturePlan());
    assert.equal(Math.round(explorer.view.zc * 100) / 100, 532.74);

    // The dragged ground point follows the mouse - the view center keeps its elevation as it moves (it's above the ground,
    // to fit the marker poles)
    const start = groundPixel(explorer, 150, 120);
    explorer.dragStart('move');
    assert.equal(explorer.dragMove(50, -30), true);
    assertPixel(groundPixel(explorer, 150, 120), [start[0] + 50, start[1] - 30]);
    assert.deepEqual(viewState(explorer), [153.3, 136.35, 532.74, 30, 35, 1]);

    // A drag moves from where it started, not from its last move
    assert.equal(explorer.dragMove(-100, 40), true);
    assertPixel(groundPixel(explorer, 150, 120), [start[0] - 100, start[1] + 40]);
    assert.equal(explorer.dragMove(50, -30), true);
    assert.deepEqual(viewState(explorer), [153.3, 136.35, 532.74, 30, 35, 1]);

    // The drag's end moves the view center along its line of sight to the ground - the view doesn't change
    const centerZ = elevation(explorer.data.topo, 169.04, 163.61);
    assert.equal(explorer.dragEnd(), true);
    assert.equal(explorer.drag, null);
    assert.deepEqual(viewState(explorer), [169.04, 163.61, 518.05, 30, 35, 1]);
    assert.ok(Math.abs(centerZ - 518.05) < 0.1);
    assertPixel(groundPixel(explorer, 150, 120), [start[0] + 50, start[1] - 30]);

    // Without a drag, a drag's move and end do nothing
    assert.equal(explorer.dragMove(10, 10), false);
    assert.equal(explorer.dragEnd(), false);

    // A drag that doesn't move leaves the grounded view as it is
    explorer.dragStart('move');
    assert.equal(explorer.dragMove(0, 0), true);
    assert.equal(explorer.dragEnd(), false);
    assert.deepEqual(viewState(explorer), [169.04, 163.61, 518.05, 30, 35, 1]);

    // A zoomed view, from above, facing east - the dragged point still follows the mouse
    Object.assign(explorer.state, {'azimuth': 90, 'tilt': 90, 'zoom': 4});
    explorer.updateView();
    const zoomed = groundPixel(explorer, 180, 150);
    explorer.dragStart('move');
    explorer.dragMove(-30, 20);
    assertPixel(groundPixel(explorer, 180, 150), [zoomed[0] - 30, zoomed[1] + 20]);
    assert.equal(explorer.dragEnd(), true);
    assert.deepEqual(viewState(explorer), [173.41, 157.06, 516.4, 90, 90, 4]);

    // The view center stays within the topography (400 x 300 feet)
    explorer.dragStart('move');
    explorer.dragMove(-5000, -5000);
    assert.deepEqual(viewState(explorer).slice(0, 2), [0, 0]);
    explorer.dragMove(5000, 5000);
    assert.deepEqual(viewState(explorer).slice(0, 2), [400, 300]);
});


test('Explorer, dragging to rotate and tilt', () => {
    const explorer = explore(fixturePlan());

    // A drag across the view's width turns it half around, and down its height tilts it 90 degrees - around the view's
    // center, which doesn't move
    explorer.dragStart('orbit');
    assert.equal(explorer.dragMove(200, 60), true);
    assert.deepEqual(viewState(explorer), [null, null, null, 75, 44, 1]);
    assert.deepEqual([explorer.view.width, explorer.view.height], [800, 600]);
    assert.equal(explorer.dragMove(-200, -60), true);
    assert.deepEqual(viewState(explorer), [null, null, null, 345, 26, 1]);

    // The rotation is from 0 to 360 degrees, and the tilt is from 5 to 90 degrees
    assert.equal(explorer.dragMove(-1000, -1000), true);
    assert.deepEqual(viewState(explorer), [null, null, null, 165, 5, 1]);
    assert.equal(explorer.dragMove(1000, 1000), true);
    assert.deepEqual(viewState(explorer), [null, null, null, 255, 90, 1]);
    assert.equal(explorer.dragMove(330 * 800 / 180, 0), true);
    assert.deepEqual(viewState(explorer), [null, null, null, 0, 35, 1]);

    // The rotation is to a tenth of a degree, after it's wrapped
    assert.equal(explorer.dragMove(1676, 0), true);
    assert.equal(explorer.state.azimuth, 47.1);
    assert.equal(explorer.dragMove(330 * 800 / 180, 0), true);

    // The drag's end doesn't change the view
    assert.equal(explorer.dragEnd(), false);
    assert.deepEqual(viewState(explorer), [null, null, null, 0, 35, 1]);
    assert.equal(explorer.view.cosAz, 1);
});


test('Explorer.ground', () => {
    const explorer = explore(fixturePlan());

    // The default view's center is above the ground - it's moved along its line of sight to the ground
    const ground = groundPixel(explorer, 230, 160);
    assert.equal(explorer.ground(), true);
    assert.deepEqual(viewState(explorer), [215.24, 176.4, 518.51, 30, 35, 1]);
    assertPixel(groundPixel(explorer, 230, 160), ground);
    assert.equal(explorer.ground(), false);

    // A view whose center's line of sight misses the topography isn't moved
    Object.assign(explorer.state, {'x': 0, 'y': 0, 'z': 800, 'azimuth': 210});
    explorer.updateView();
    assert.equal(explorer.ground(), false);
    assert.deepEqual(viewState(explorer), [0, 0, 800, 210, 35, 1]);
});


test('Explorer.zoomAt', () => {
    const explorer = explore(fixturePlan());

    // The ground point under the mouse stays under it
    const mouse = groundPixel(explorer, 280, 200);
    assert.equal(explorer.zoomAt(...mouse, 1.5), true);
    assertPixel(groundPixel(explorer, 280, 200), mouse);
    assert.deepEqual(viewState(explorer), [235.89, 182.65, 527.18, 30, 35, 1.5]);
    assert.equal(explorer.zoomAt(...mouse, 3), true);
    assertPixel(groundPixel(explorer, 280, 200), mouse);
    assert.deepEqual(viewState(explorer), [264.88, 193.49, 537.38, 30, 35, 4.5]);

    // The zoom is from 1 to 64 - a zoom at its limit doesn't change the view
    assert.equal(explorer.zoomAt(...mouse, 100), true);
    assertPixel(groundPixel(explorer, 280, 200), mouse);
    assert.equal(explorer.state.zoom, 64);
    assert.equal(explorer.zoomAt(...mouse, 2), false);
    assert.equal(explorer.zoomAt(...mouse, 0.001), true);
    assertPixel(groundPixel(explorer, 280, 200), mouse);
    assert.equal(explorer.state.zoom, 1);
    assert.equal(explorer.zoomAt(...mouse, 0.5), false);
});


test('Explorer.centerAt', () => {
    const explorer = explore(fixturePlan());

    // Center the view on the ground under a point, and zoom in
    const point = groundPixel(explorer, 280, 200);
    assert.equal(explorer.centerAt(...point, 2), true);
    const [x, y, z] = viewState(explorer);
    assert.deepEqual([x, y].map(Math.round), [280, 200]);
    assert.ok(Math.abs(z - elevation(explorer.data.topo, x, y)) < 0.01);
    assert.deepEqual(viewState(explorer).slice(3), [30, 35, 2]);
    assertPixel(groundPixel(explorer, x, y), [400, 300]);

    // Zoom out - not past the whole site
    assert.equal(explorer.centerAt(400, 300, 0.25), true);
    assert.deepEqual(viewState(explorer).slice(3), [30, 35, 1]);

    // A point off the topography doesn't change the view
    const state = {...explorer.state};
    assert.equal(explorer.centerAt(5, 5, 2), false);
    assert.deepEqual(explorer.state, state);
});


test('Explorer.command and Explorer.setExaggeration', () => {
    const globals = {'vFile': 'plans/fixture.json', 'vExplore': true, 'vAzimuth': 120, 'vTilt': 50, 'vZoom': 3, 'vX': 100, 'vY': 50};
    const explorer = explore(fixturePlan(), globals);

    // Zoom in and out by the square root of two - from the nearest step, and from 1 to 64
    assert.equal(explorer.command('in'), true);
    assert.equal(explorer.state.zoom, 4);
    assert.equal(explorer.command('out'), true);
    assert.equal(explorer.state.zoom, 2.828);
    for (const [command, count, zoom] of [['out', 3, 1], ['in', 12, 64]]) {
        for (let ix = 0; ix < count; ix++) {
            assert.equal(explorer.command(command), true);
        }
        assert.equal(explorer.state.zoom, zoom);
        assert.equal(explorer.command(command), false);
    }
    assert.equal(explorer.view.zoom, 64);

    // Face north, and view from above
    assert.equal(explorer.command('north'), true);
    assert.equal(explorer.command('north'), false);
    assert.equal(explorer.command('top'), true);
    assert.equal(explorer.command('top'), false);
    assert.deepEqual(viewState(explorer), [100, 50, null, 0, 90, 64]);

    // The vertical exaggeration - from 1 to 5
    assert.equal(explorer.setExaggeration(2.5), true);
    assert.equal(explorer.view.exaggeration, 2.5);
    assert.equal(explorer.setExaggeration(2.5), false);
    assert.equal(explorer.setExaggeration(10), true);
    assert.equal(explorer.state.exaggeration, 5);
    assert.equal(explorer.setExaggeration(0), true);
    assert.equal(explorer.state.exaggeration, 1);
    assert.equal(explorer.setExaggeration(Number.NaN), false);
    assert.equal(explorer.state.exaggeration, 1);

    // Reset - the whole site, from the default direction
    assert.equal(explorer.command('reset'), true);
    assert.deepEqual(explorer.state, explorer.reset);
    assert.deepEqual(explorer.view, projection(explorer.data.topo, {...explorer.reset, 'fill': true, 'smooth': true}, 800, 600));
    assert.equal(explorer.command('reset'), false);

    // An unknown command does nothing
    assert.equal(explorer.command('other'), false);
});


test('Explorer.keyDown', () => {
    const explorer = explore(fixturePlan());
    const press = (code, key = '', modifiers = {}) => explorer.keyDown({code, key, ...modifiers});
    explorer.command('north');
    explorer.ground();
    assert.deepEqual(viewState(explorer), [200, 186.71, 515.6, 0, 35, 1]);

    // The arrows move the view an eighth of its width (right and left) or height (forward and back) - then its center is
    // moved to the ground
    assert.equal(Math.round(100 / explorer.view.scale * 100) / 100, 67.24);
    assert.equal(press('ArrowRight'), 'render');
    assert.deepEqual(viewState(explorer).slice(0, 3), [267.24, 149.85, 532.81]);
    assert.equal(press('ArrowLeft'), 'render');
    assert.deepEqual(viewState(explorer).slice(0, 3), [200, 186.71, 515.6]);
    assert.equal(press('ArrowUp'), 'render');
    assert.deepEqual(viewState(explorer).slice(0, 3), [200, 256.64, 524]);
    assert.equal(press('ArrowDown'), 'render');
    assert.deepEqual(viewState(explorer).slice(0, 3), [200, 186.71, 515.6]);

    // + and - zoom in and out
    assert.equal(press('Equal', '+'), 'render');
    assert.equal(press('Equal', '='), 'render');
    assert.equal(explorer.state.zoom, 2);
    assert.equal(press('Minus', '-'), 'render');
    assert.equal(press('Minus', '_'), 'render');
    assert.equal(explorer.state.zoom, 1);

    // Escape returns to the report
    assert.equal(press('Escape', 'Escape'), 'back');

    // Other keys, and keys with the control, command, or option key, do nothing
    const state = {...explorer.state};
    for (const [code, key] of [['KeyQ', 'q'], ['KeyH', 'h'], ['Space', ' '], ['Digit0', '0'], ['Home', 'Home']]) {
        assert.equal(press(code, key), null);
    }
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
        for (const [code, key] of [['Escape', 'Escape'], ['Equal', '+'], ['ArrowLeft', 'ArrowLeft']]) {
            assert.equal(press(code, key, {[modifier]: true}), null);
        }
    }
    assert.deepEqual(explorer.state, state);
});
