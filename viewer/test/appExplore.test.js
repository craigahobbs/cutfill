import {fakeBrowser, fakeContext, fire, flush, startApp} from './appHelpers.js';
import {groundPoint, project, smoothLimitsCanvas} from '../lib/view3d.js';
import {Explorer} from '../lib/explore.js';
import {PlanData} from '../lib/planData.js';
import {argsParse} from '../lib/args.js';
import assert from 'node:assert/strict';
import {fixturePlan} from './fixture.js';
import {paintOps} from '../lib/canvas.js';
import test from 'node:test';
import {validatePlan} from '../lib/model.js';


// The 3D explorer page's URL hash
const exploreHash = "#var.vFile='plans/fixture.json'&var.vExplore=true";


// Create a browser at the fixture plan's 3D explorer - "cellCost" is the measured terrain cell cost in local storage, and
// "storage" is more local storage
function exploreBrowser(testContext, {cellCost = '1', search = '', hash = exploreHash, storage = {}} = {}) {
    return fakeBrowser(testContext, {
        search, hash,
        'files': {'plans/fixture.json': JSON.stringify(fixturePlan())},
        'storage': {...(cellCost !== null ? {'sageRoadCellCost': cellCost} : {}), ...storage}
    });
}


// The calls that paint the fixture plan's 3D explorer drawing, at a size and terrain point limit
function paintCalls(width, height, points) {
    const data = new PlanData(validatePlan(fixturePlan()).plan, 'plans/fixture.json');
    const globals = {'vFile': 'plans/fixture.json', 'vExplore': true};
    const drawing = new Explorer(data, globals, argsParse(globals)).render(width, height, {...smoothLimitsCanvas, points});
    const calls = [['getContext', '2d'], ['setTransform', 1, 0, 0, 1, 0, 0], ['fillStyle', '#f4f1ea'], ['fillRect', 0, 0, width, height]];
    paintOps(fakeContext(calls), drawing.ops);
    return calls;
}


// The number of times a canvas has been painted
function paintCount(canvas) {
    return canvas.calls.filter(([name]) => name === 'getContext').length;
}


// The text of the canvas's last painting, in order
function paintedText(canvas) {
    const calls = canvas.calls.slice(canvas.calls.findLastIndex(([name]) => name === 'getContext'));
    return calls.filter(([name]) => name === 'fillText').map(([, text]) => text);
}


// The explorer's view status - the last text of the canvas's last painting
function viewStatus(canvas) {
    return paintedText(canvas).at(-1);
}


// Press a key - returns whether its default action was prevented
function keyDown(browser, code, key = '', modifiers = {}) {
    return fire(browser, browser.document, 'keydown', {code, key, ...modifiers}).defaultPrevented;
}


// Show a 3D explorer page's canvas at its size, at the top left of the window
function showCanvas(canvas) {
    canvas.getBoundingClientRect = () => ({'left': 0, 'top': 0, 'width': canvas.width, 'height': canvas.height});
}


// The explorer's ground point under a page point - the canvas has a 1 pixel border
function pageGround(app, x, y) {
    const {explorer} = app.page;
    return groundPoint(explorer.view, explorer.data.topo, x - 1, y - 1);
}


// Assert that a world point is within a twentieth of a pixel of a page point
function assertAt(app, point, x, y) {
    const [px, py] = project(app.page.explorer.view, ...point);
    assert.ok(Math.abs(px - (x - 1)) < 0.05 && Math.abs(py - (y - 1)) < 0.05, `${px},${py} is not ${x - 1},${y - 1}`);
}


test('the 3D explorer page', async (context) => {
    const browser = exploreBrowser(context);
    const {clock, document, main} = browser;
    const app = await startApp(browser);
    assert.equal(document.title, 'Fixture Plan - 3D');
    assert.equal(document.body.className, 'sageroad-explore');
    assert.deepEqual(browser.scrolls, [['scrollTo', 0, 0], ['scrollTo', 0, 0]]);
    assert.deepEqual(browser.fetches, ['plans/fixture.json']);
    assert.deepEqual(browser.logs, []);
    assert.equal(app.page.explorer.data.file, 'plans/fixture.json');

    // The page is a canvas that fills the window, less the page's margins, a link back to the report, the controls, and
    // their help
    assert.deepEqual([...main.querySelectorAll('*')].map((element) => element.tagName), [
        'DIV', 'CANVAS', 'A', 'DIV', 'BUTTON', 'BUTTON', 'BUTTON', 'BUTTON', 'BUTTON', 'LABEL', 'INPUT', 'BUTTON', 'UL',
        ...Array.from({'length': 6}, () => ['LI', 'STRONG']).flat()
    ]);
    assert.equal(main.firstElementChild.className, 'sageroad-explorer');
    const canvas = main.querySelector('canvas');
    assert.equal(canvas.getAttribute('role'), 'img');
    assert.equal(canvas.getAttribute('aria-label'), '3D view of the Direct road plan option');
    assert.equal(canvas.width, 976);
    assert.equal(canvas.height, 720);
    assert.equal(canvas.style.width, '976px');
    assert.equal(canvas.style.height, '720px');
    assert.equal(canvas.style.margin, '0px');
    assert.equal(canvas.style.display, 'block');
    assert.equal(canvas.dataset.frame, '1');
    assert.equal(
        main.querySelector('a').outerHTML,
        '<a class="sageroad-explorer-back" href="#var.vFile=\'plans%2Ffixture.json\'">Back to the report</a>'
    );

    // The controls - zoom in and out, face north, view from above, view the whole site, the vertical exaggeration, and
    // the help, which is shown
    assert.deepEqual(
        [...main.querySelectorAll('.sageroad-explorer-tools button')].map((button) => [button.dataset.command, button.textContent]),
        [['in', '+'], ['out', '\u2212'], ['north', 'North'], ['top', 'Top'], ['reset', 'Reset'], ['help', '?']]
    );
    const input = main.querySelector('input');
    assert.deepEqual([input.type, input.min, input.max, input.step, input.value], ['range', '1', '5', '0.25', '1.5']);
    assert.equal(main.querySelector('label').textContent, 'Exaggeration ');
    const help = main.querySelector('ul');
    assert.equal(help.hidden, false);
    assert.equal(main.querySelector('button[data-command="help"]').getAttribute('aria-expanded'), 'true');
    assert.deepEqual([...help.querySelectorAll('li')].map((item) => item.textContent), [
        'Drag - move',
        'Right-drag or Shift+drag - rotate and tilt',
        'Wheel or pinch - zoom',
        'Double-click - center there and zoom in (with Shift, out)',
        'Arrow, +, and \u2212 keys - move and zoom',
        'Esc - back to the report'
    ]);

    // The canvas is painted with the view's drawing - with the terrain points that fit a moving view's time budget (100
    // milliseconds) at the measured cell cost (1 millisecond)
    assert.equal(paintCount(canvas), 1);
    assert.deepEqual(canvas.calls, paintCalls(976, 720, 85));
    assert.deepEqual(canvas.calls.slice(0, 20), [
        ['getContext', '2d'],
        ['setTransform', 1, 0, 0, 1, 0, 0],
        ['fillStyle', '#f4f1ea'],
        ['fillRect', 0, 0, 976, 720],
        ['miterLimit', 4],
        ['setLineDash', []],
        ['globalAlpha', 1],
        ['beginPath'],
        ['moveTo', 602.5127559220302, 119.50594458497434],
        ['lineTo', 664.9196874493437, 112.56389106025097],
        ['lineTo', 700.9503461659366, 158.98428803741066],
        ['lineTo', 638.5434146386232, 165.9263415621338],
        ['closePath'],
        ['fillStyle', 'rgb(135,124,83)'],
        ['fill'],
        ['strokeStyle', 'rgb(135,124,83)'],
        ['lineWidth', 0.6],
        ['lineCap', 'butt'],
        ['lineJoin', 'miter'],
        ['stroke']
    ]);

    // The drawing ends with the view's status
    assert.deepEqual(canvas.calls.slice(-5), [
        ['textAlign', 'left'],
        ['textBaseline', 'middle'],
        ['strokeText', 'Center x 200, y 150, z 533 ft - zoom 1x, rotation 30, tilt 35, exaggeration 1.5x', 12, 706],
        ['fillStyle', '#222'],
        ['fillText', 'Center x 200, y 150, z 533 ft - zoom 1x, rotation 30, tilt 35, exaggeration 1.5x', 12, 706]
    ]);
    assert.deepEqual(paintedText(canvas), [
        '2+00', 'Road', 'End', 'N', 'Center x 200, y 150, z 533 ft - zoom 1x, rotation 30, tilt 35, exaggeration 1.5x'
    ]);

    // The frame is measured in the next animation frame, and the still view is drawn a quarter second later
    assert.equal(clock.frames.size, 1);
    assert.deepEqual([...clock.timeouts.values()].map(({time}) => time), [250]);

    // Printing doesn't paint the explorer
    fire(browser, browser.window, 'beforeprint');
    fire(browser, browser.window, 'afterprint');
    assert.equal(paintCount(canvas), 1);
});


test('the 3D explorer page of a plan option and view', async (context) => {
    const browser = exploreBrowser(context, {'hash': `${exploreHash}&var.vOption=1&var.vAzimuth=100&var.vZoom=2&var.vX=120&var.vY=80`});
    const {document, main, window} = browser;
    await startApp(browser);
    const canvas = main.querySelector('canvas');
    assert.equal(document.title, 'Fixture Plan - 3D');
    assert.equal(canvas.getAttribute('aria-label'), '3D view of the Bridge - East road plan option');
    assert.equal(viewStatus(canvas), 'Center x 120, y 80, z 510 ft - zoom 2x, rotation 100, tilt 35, exaggeration 1.5x');

    // The link back to the report keeps the option
    assert.equal(main.querySelector('a').getAttribute('href'), "#var.vFile='plans%2Ffixture.json'&var.vOption=1");

    // So does the escape key - the report isn't the explorer's full-window page
    assert.equal(keyDown(browser, 'Escape', 'Escape'), false);
    assert.equal(window.location.hash, "#var.vFile='plans%2Ffixture.json'&var.vOption=1");
    await flush();
    assert.equal(document.title, 'Fixture Plan');
    assert.equal(document.body.className, '');
    assert.equal(main.querySelector('h2:nth-of-type(2)').textContent, 'Bridge - East');
});


test('the 3D explorer page fills the window', async (context) => {
    // A small window's explorer is at least 320 by 240 pixels - without a device pixel ratio, so is its canvas's bitmap
    const browser = exploreBrowser(context);
    const {clock, main, window} = browser;
    window.innerWidth = 300;
    window.innerHeight = 200;
    window.devicePixelRatio = undefined;
    await startApp(browser);
    const canvas = main.querySelector('canvas');
    assert.deepEqual([canvas.width, canvas.height, canvas.style.width, canvas.style.height], [320, 240, '320px', '240px']);
    assert.deepEqual(canvas.calls.slice(0, 4), [
        ['getContext', '2d'], ['setTransform', 1, 0, 0, 1, 0, 0], ['fillStyle', '#f4f1ea'], ['fillRect', 0, 0, 320, 240]
    ]);

    // Resizing the window draws the view again, in the next animation frame
    clock.runFrame();
    window.innerWidth = 1224;
    window.innerHeight = 848;
    fire(browser, window, 'resize');
    fire(browser, window, 'resize');
    assert.equal(clock.frames.size, 1);
    assert.equal(paintCount(canvas), 1);
    clock.runFrame();
    assert.equal(paintCount(canvas), 2);
    assert.equal(canvas.dataset.frame, '2');
    assert.deepEqual([canvas.width, canvas.height, canvas.style.width, canvas.style.height], [1176, 800, '1176px', '800px']);
    assert.deepEqual(canvas.calls.slice(-paintCalls(1176, 800, 85).length), paintCalls(1176, 800, 85));

    // The canvas's bitmap is the drawing's size times the device pixel ratio
    window.devicePixelRatio = 2;
    fire(browser, window, 'resize');
    clock.runFrame();
    assert.equal(paintCount(canvas), 3);
    assert.deepEqual([canvas.width, canvas.height, canvas.style.width, canvas.style.height], [2352, 1600, '1176px', '800px']);
    assert.deepEqual(canvas.calls.filter(([name]) => name === 'setTransform' || name === 'fillRect').slice(-2), [
        ['setTransform', 2, 0, 0, 2, 0, 0], ['fillRect', 0, 0, 1176, 800]
    ]);

    // A view of the same size keeps the canvas's bitmap
    canvas.style.width = '100%';
    fire(browser, window, 'resize');
    clock.runFrame();
    assert.equal(paintCount(canvas), 4);
    assert.deepEqual([canvas.width, canvas.height, canvas.style.width, canvas.style.height], [2352, 1600, '100%', '800px']);
});


test('the 3D explorer page keys', async (context) => {
    const browser = exploreBrowser(context);
    const {clock, main} = browser;
    await startApp(browser);
    const canvas = main.querySelector('canvas');
    clock.runFrame();
    assert.equal(clock.frames.size, 0);

    // A key changes the view - the view is drawn in the next animation frame, once for all of the keys before it
    assert.equal(keyDown(browser, 'Equal', '+'), true);
    assert.equal(clock.frames.size, 1);
    assert.equal(keyDown(browser, 'Equal', '='), true);
    assert.equal(keyDown(browser, 'ArrowRight', 'ArrowRight'), true);
    assert.equal(clock.frames.size, 1);
    assert.equal(paintCount(canvas), 1);
    assert.equal(canvas.dataset.frame, '1');
    clock.runFrame();
    assert.equal(paintCount(canvas), 2);
    assert.equal(canvas.dataset.frame, '2');
    assert.equal(viewStatus(canvas), 'Center x 239, y 149, z 524 ft - zoom 2x, rotation 30, tilt 35, exaggeration 1.5x');

    // Other keys, and keys with a control, command, or option key, are left alone
    assert.equal(keyDown(browser, 'KeyZ', 'z'), false);
    assert.equal(keyDown(browser, 'KeyQ', 'q'), false);
    assert.equal(keyDown(browser, 'ArrowLeft', 'ArrowLeft', {'ctrlKey': true}), false);
    assert.equal(keyDown(browser, 'ArrowLeft', 'ArrowLeft', {'metaKey': true}), false);
    assert.equal(keyDown(browser, 'ArrowLeft', 'ArrowLeft', {'altKey': true}), false);
    assert.equal(clock.frames.size, 1);
    clock.runFrame();
    assert.equal(paintCount(canvas), 2);

    // Zoom out, and move back
    assert.equal(keyDown(browser, 'Minus', '-'), true);
    assert.equal(keyDown(browser, 'ArrowDown', 'ArrowDown'), true);
    clock.runFrame();
    assert.equal(paintCount(canvas), 3);
    assert.equal(viewStatus(canvas), 'Center x 220, y 116, z 513 ft - zoom 1.41x, rotation 30, tilt 35, exaggeration 1.5x');
    assert.equal(canvas.getAttribute('aria-label'), '3D view of the Direct road plan option');
    assert.equal(main.querySelector('a').getAttribute('href'), "#var.vFile='plans%2Ffixture.json'");
});


test('the 3D explorer page leaves the keys of focused inputs alone', async (context) => {
    const browser = exploreBrowser(context);
    const {clock, document, main} = browser;
    await startApp(browser);
    clock.runFrame();

    // An input (the exaggeration's, say), a text area, a select, and editable content
    const editable = document.createElement('div');
    editable.tabIndex = 0;
    Object.defineProperty(editable, 'isContentEditable', {'value': true});
    const inputs = ['textarea', 'select'].map((tagName) => document.createElement(tagName));
    for (const element of [main.querySelector('input'), ...inputs, editable]) {
        document.body.append(element);
        element.focus();
        assert.equal(document.activeElement, element);
        assert.equal(keyDown(browser, 'ArrowRight', 'ArrowRight'), false);
        assert.equal(keyDown(browser, 'Escape', 'Escape'), false);
        assert.equal(clock.frames.size, 0);
        assert.equal(browser.window.location.hash, exploreHash);
        element.remove();
    }

    // The focused link back to the report, and the focused controls, don't take the keys
    for (const element of [main.querySelector('a'), main.querySelector('button')]) {
        element.focus();
        assert.equal(document.activeElement, element);
        assert.equal(keyDown(browser, 'ArrowRight', 'ArrowRight'), true);
    }
    assert.equal(clock.frames.size, 1);
});


test('the 3D explorer page draws its still view', async (context) => {
    const browser = exploreBrowser(context, {'search': '?debug'});
    const {clock, main, window} = browser;
    await startApp(browser);
    const canvas = main.querySelector('canvas');
    assert.deepEqual(browser.logs, ['SageRoad: render in 0.0 ms']);

    // The moving view's frame is measured - a fast frame (30 milliseconds, over at least 2000 cells, moves the cell cost
    // estimate 30% of the way from 1 millisecond to 0.015) raises the moving view's point limit
    clock.time = 30;
    clock.runFrame();
    assert.deepEqual(browser.logs.slice(1), [
        'SageRoad: 3D explorer moving frame - 522 operations, 80 cells, step 4, smooth 1 (85 point limit) - built in 0.0 ms, ' +
            'painted in 0.0 ms, frame in 30.0 ms'
    ]);
    assert.equal(window.localStorage.getItem('sageRoadCellCost'), '1');

    // A quarter second after the view stops moving, the still view is drawn - with the points that fit its time budget
    // (500 milliseconds)
    assert.deepEqual([...clock.timeouts.values()].map(({time}) => time), [250]);
    clock.runTimeout();
    assert.equal(clock.time, 250);
    assert.equal(paintCount(canvas), 2);
    assert.equal(canvas.dataset.frame, '2');
    assert.deepEqual(canvas.calls.slice(-paintCalls(976, 720, 425).length), paintCalls(976, 720, 425));
    assert.equal(clock.timeouts.size, 0);

    // The still view's frame is measured - and the cell cost estimate is kept in local storage
    clock.time = 900;
    clock.runFrame();
    assert.deepEqual(browser.logs.slice(2), [
        'SageRoad: 3D explorer still frame - 777 operations, 300 cells, step 2, smooth 1 (425 point limit) - built in 0.0 ms, ' +
            'painted in 0.0 ms, frame in 650.0 ms'
    ]);
    assert.equal(window.localStorage.getItem('sageRoadCellCost'), '0.5906499999999999');

    // A key draws the moving view - with its raised point limit
    assert.equal(keyDown(browser, 'ArrowRight', 'ArrowRight'), true);
    clock.runFrame();
    assert.equal(paintCount(canvas), 3);
    clock.runFrame();
    assert.deepEqual(browser.logs.slice(3), [
        'SageRoad: 3D explorer moving frame - 522 operations, 80 cells, step 4, smooth 1 (121 point limit) - built in 0.0 ms, ' +
            'painted in 0.0 ms, frame in 0.0 ms'
    ]);
    assert.deepEqual([...clock.timeouts.values()].map(({time}) => time), [1150]);

    // Another key, before the still view is drawn, puts it off - the last frame was fast, so this one has more points
    clock.time = 1000;
    assert.equal(keyDown(browser, 'ArrowRight', 'ArrowRight'), true);
    assert.equal(clock.timeouts.size, 0);
    clock.runFrame();
    assert.equal(paintCount(canvas), 4);
    assert.deepEqual([...clock.timeouts.values()].map(({time}) => time), [1250]);
    clock.runFrame();
    assert.deepEqual(browser.logs.slice(4), [
        'SageRoad: 3D explorer moving frame - 572 operations, 129 cells, step 3, smooth 1 (206 point limit) - built in 0.0 ms, ' +
            'painted in 0.0 ms, frame in 0.0 ms'
    ]);
    clock.runTimeout();
    assert.equal(paintCount(canvas), 5);
    assert.equal(viewStatus(canvas), 'Center x 322, y 91, z 528 ft - zoom 1x, rotation 30, tilt 35, exaggeration 1.5x');

    // A very slow still frame lowers the still view's point limit
    clock.time = 101250;
    clock.runFrame();
    assert.deepEqual(browser.logs.slice(5), [
        'SageRoad: 3D explorer still frame - 733 operations, 272 cells, step 2, smooth 1 (425 point limit) - built in 0.0 ms, ' +
            'painted in 0.0 ms, frame in 100000.0 ms'
    ]);

    // The still view isn't drawn when its point limit isn't more than the moving view's (294 points, after its fast frames)
    assert.equal(keyDown(browser, 'ArrowRight', 'ArrowRight'), true);
    clock.runFrame();
    assert.equal(paintCount(canvas), 6);
    assert.equal(clock.timeouts.size, 1);
    clock.runTimeout();
    assert.equal(clock.time, 101500);
    assert.equal(paintCount(canvas), 6);
    assert.equal(clock.timeouts.size, 0);
    clock.runFrame();
    assert.deepEqual(browser.logs.slice(6), [
        'SageRoad: 3D explorer moving frame - 500 operations, 104 cells, step 3, smooth 1 (294 point limit) - built in 0.0 ms, ' +
            'painted in 0.0 ms, frame in 250.0 ms'
    ]);
});


test('the 3D explorer page draws all of the terrain when it fits the time budget', async (context) => {
    // No measured cell cost - the still view has the points for every grid cell, smoothed - and a fast computer's cell
    // cost - the moving view does, too, so the still view isn't drawn
    for (const [cellCost, expectedLogs] of [
        [
            null,
            [
                'SageRoad: 3D explorer moving frame - 43747 operations, 43200 cells, step 1, smooth 6 (53125 point limit) - ' +
                    'built in 0.0 ms, painted in 0.0 ms, frame in 0.0 ms',
                'SageRoad: 3D explorer still frame - 59347 operations, 58800 cells, step 1, smooth 7 - ' +
                    'built in 0.0 ms, painted in 0.0 ms, frame in 0.0 ms'
            ]
        ],
        [
            '0.0001',
            [
                'SageRoad: 3D explorer moving frame - 59347 operations, 58800 cells, step 1, smooth 7 - ' +
                    'built in 0.0 ms, painted in 0.0 ms, frame in 0.0 ms'
            ]
        ]
    ]) {
        const browser = exploreBrowser(context, {cellCost, 'search': '?debug'});
        const {clock} = browser;
        await startApp(browser);
        clock.runFrame();
        assert.equal(clock.timeouts.size, 1);
        clock.runTimeout();
        clock.runFrame();
        assert.deepEqual(browser.logs.slice(1), expectedLogs);
        assert.equal(clock.timeouts.size, 0);
        assert.equal(clock.frames.size, 0);
    }
});


test('the 3D explorer page titles', async (context) => {
    const browser = exploreBrowser(context);
    const {main} = browser;
    await startApp(browser);
    const canvas = main.querySelector('canvas');

    // The canvas is shown at its size, at the top left of the window, with a 1 pixel border
    canvas.getBoundingClientRect = () => ({'left': 0, 'top': 0, 'width': 976, 'height': 720});
    const mouseMove = (x, y) => {
        fire(browser, canvas, 'pointermove', {'pointerId': 1, 'clientX': x + 1, 'clientY': y + 1});
        return canvas.title;
    };

    // The road's segments have titles - the terrain and the drawing's background don't
    assert.equal(mouseMove(537, 375), '2+40: grade 523.0, ground 519.8, fill 3.2');
    assert.equal(mouseMove(538, 380), '2+36: grade 522.3, ground 518.4, fill 3.9');
    assert.equal(mouseMove(538, 300), '');
    assert.equal(mouseMove(651, 272), '3+40: grade 537.0, ground 538.9, cut 1.9');
    assert.equal(mouseMove(652, 272), '3+40: grade 537.0, ground 538.9, cut 1.9');
    assert.equal(mouseMove(5, 5), '');
    assert.equal(mouseMove(6, 5), '');
});


test('the 3D explorer page is left', async (context) => {
    const browser = exploreBrowser(context, {'search': '?debug'});
    const {clock, document, main, window} = browser;
    await startApp(browser);
    const canvas = main.querySelector('canvas');

    // The frame is measured, and a key is pressed
    clock.time = 30;
    clock.runFrame();
    assert.equal(keyDown(browser, 'ArrowRight', 'ArrowRight'), true);
    assert.equal(clock.frames.size, 1);
    assert.equal(clock.timeouts.size, 0);
    assert.equal(window.localStorage.getItem('sageRoadCellCost'), '1');

    // Leave the explorer for the report - the key's frame is canceled, and the cell cost estimate is kept in local storage
    window.location.hash = "#var.vFile='plans/fixture.json'";
    await flush();
    assert.equal(document.title, 'Fixture Plan');
    assert.equal(document.body.className, '');
    assert.equal(clock.frames.size, 0);
    assert.equal(paintCount(canvas), 1);
    assert.equal(window.localStorage.getItem('sageRoadCellCost'), '0.7044999999999999');

    // The report's 3D view is drawn with the points that fit its time budget at the explorer's cell cost estimate
    clock.runTimeout();
    clock.runFrame();
    assert.deepEqual(browser.logs.slice(-1), [
        'SageRoad: 3D view 1 - 594 operations, 140 cells, step 3, smooth 1 (302 point limit) - drawn in 0.0 ms'
    ]);

    // The explorer, again - it has its moving view's point limit, and the still view is drawn before leaving it again
    window.location.hash = exploreHash;
    await flush();
    assert.equal(document.title, 'Fixture Plan - 3D');
    assert.equal(document.body.className, 'sageroad-explore');
    clock.runFrame();
    assert.deepEqual(browser.logs.slice(-2), [
        'SageRoad: render in 0.0 ms',
        'SageRoad: 3D explorer moving frame - 522 operations, 80 cells, step 4, smooth 1 (121 point limit) - built in 0.0 ms, ' +
            'painted in 0.0 ms, frame in 0.0 ms'
    ]);
    assert.equal(clock.timeouts.size, 1);
    window.location.hash = '#var=';
    await flush();
    assert.equal(document.title, 'SageRoad');
    assert.equal(document.body.className, '');
    assert.equal(clock.timeouts.size, 0);
    assert.equal(clock.frames.size, 0);
});


test('the 3D explorer page drags', async (context) => {
    const browser = exploreBrowser(context);
    const {clock, main} = browser;
    const app = await startApp(browser);
    const canvas = main.querySelector('canvas');
    const root = main.firstElementChild;
    showCanvas(canvas);
    const captures = [];
    canvas.setPointerCapture = (pointerId) => captures.push(pointerId);
    clock.runFrame();
    const pointer = (type, x, y, properties = {}) => fire(browser, canvas, type, {
        'pointerId': 1, 'button': 0, 'buttons': type === 'pointerup' ? 0 : 1, 'clientX': x, 'clientY': y, ...properties
    });

    // Without a drag, the mouse shows the road's tooltips
    pointer('pointermove', 538, 376, {'buttons': 0});
    assert.equal(canvas.title, '2+40: grade 523.0, ground 519.8, fill 3.2');

    // A drag moves the view - the ground point under the mouse follows it, and the view is drawn once per animation
    // frame. The road's tooltip is cleared.
    const ground = pageGround(app, 500, 400);
    pointer('pointerdown', 500, 400);
    assert.deepEqual(captures, [1]);
    assert.equal(root.className, 'sageroad-explorer sageroad-explorer-dragging');
    assert.equal(canvas.title, '');
    assert.equal(clock.frames.size, 0);
    pointer('pointermove', 520, 380);
    pointer('pointermove', 560, 370);
    assert.equal(clock.frames.size, 1);
    clock.runFrame();
    assert.equal(paintCount(canvas), 2);
    assertAt(app, ground, 560, 370);
    assert.equal(viewStatus(canvas), 'Center x 157, y 142, z 533 ft - zoom 1x, rotation 30, tilt 35, exaggeration 1.5x');

    // The drag's end moves the view center along its line of sight to the ground - the view doesn't change
    pointer('pointerup', 560, 370);
    assert.equal(root.className, 'sageroad-explorer');
    clock.runFrame();
    assert.equal(paintCount(canvas), 3);
    assertAt(app, ground, 560, 370);
    const grounded = 'Center x 172, y 169, z 518 ft - zoom 1x, rotation 30, tilt 35, exaggeration 1.5x';
    assert.equal(viewStatus(canvas), grounded);

    // Without a drag, a pointer up does nothing
    pointer('pointerup', 560, 370);
    assert.equal(clock.frames.size, 1);
    clock.runFrame();
    assert.equal(paintCount(canvas), 3);

    // A drag with the right button rotates and tilts the view around its center - so does a drag with shift or control.
    // A drag across the view's width turns it half around, and down its height tilts it 90 degrees.
    for (const [properties, expected] of [
        [{'button': 2}, 'rotation 40, tilt 44'],
        [{'shiftKey': true}, 'rotation 50, tilt 53'],
        [{'ctrlKey': true}, 'rotation 60, tilt 62']
    ]) {
        pointer('pointerdown', 400, 300, properties);
        pointer('pointermove', 400 + 976 / 18, 300 + 72, properties);
        clock.runFrame();
        assert.equal(viewStatus(canvas), `Center x 172, y 169, z 518 ft - zoom 1x, ${expected}, exaggeration 1.5x`);
        pointer('pointerup', 400, 300);
        clock.runFrame();
    }

    // Another pointer's drag (a second finger's) is ignored, as is the middle button
    pointer('pointerdown', 400, 300);
    pointer('pointerdown', 300, 200, {'pointerId': 2});
    pointer('pointermove', 350, 250, {'pointerId': 2});
    pointer('pointerup', 350, 250, {'pointerId': 2});
    assert.equal(root.className, 'sageroad-explorer sageroad-explorer-dragging');
    pointer('pointerup', 400, 300);
    clock.runFrame();
    pointer('pointerdown', 400, 300, {'button': 1});
    assert.equal(root.className, 'sageroad-explorer');
    assert.deepEqual(captures, [1, 1, 1, 1, 1]);

    // A drag whose pointer up is missed (its buttons are up) is ended by its next move, and a canceled drag is ended
    pointer('pointerdown', 400, 300);
    pointer('pointermove', 450, 300, {'buttons': 0});
    assert.equal(root.className, 'sageroad-explorer');
    pointer('pointerdown', 400, 300);
    pointer('pointercancel', 400, 300);
    assert.equal(root.className, 'sageroad-explorer');
    assert.equal(clock.frames.size, 0);

    // The canvas has no context menu (the right button drags)
    assert.equal(fire(browser, canvas, 'contextmenu').defaultPrevented, true);
});


test('the 3D explorer page wheel and double-clicks', async (context) => {
    const browser = exploreBrowser(context);
    const {clock, main} = browser;
    const app = await startApp(browser);
    const canvas = main.querySelector('canvas');
    showCanvas(canvas);
    clock.runFrame();

    // The wheel zooms around the mouse - the ground point under it stays under it
    const ground = pageGround(app, 600, 300);
    const wheel = fire(browser, canvas, 'wheel', {'clientX': 600, 'clientY': 300, 'deltaY': -100, 'deltaMode': 0});
    assert.equal(wheel.defaultPrevented, true);
    clock.runFrame();
    assertAt(app, ground, 600, 300);
    assert.equal(viewStatus(canvas), 'Center x 226, y 173, z 522 ft - zoom 1.22x, rotation 30, tilt 35, exaggeration 1.5x');

    // A wheel's lines are 16 pixels, and a trackpad's pinch (the wheel with the control key) zooms faster
    fire(browser, canvas, 'wheel', {'clientX': 600, 'clientY': 300, 'deltaY': -3, 'deltaMode': 1});
    clock.runFrame();
    assertAt(app, ground, 600, 300);
    assert.equal(app.page.explorer.state.zoom, 1.344);
    fire(browser, canvas, 'wheel', {'clientX': 600, 'clientY': 300, 'deltaY': -10, 'deltaMode': 0, 'ctrlKey': true});
    clock.runFrame();
    assertAt(app, ground, 600, 300);
    assert.equal(app.page.explorer.state.zoom, 1.485);

    // A zoom out past the whole site stops at it - then the wheel doesn't change the view
    fire(browser, canvas, 'wheel', {'clientX': 600, 'clientY': 300, 'deltaY': 1000, 'deltaMode': 0});
    clock.runFrame();
    assert.equal(app.page.explorer.state.zoom, 1);
    const paints = paintCount(canvas);
    fire(browser, canvas, 'wheel', {'clientX': 600, 'clientY': 300, 'deltaY': 100, 'deltaMode': 0});
    assert.equal(clock.frames.size, 1);
    clock.runFrame();
    assert.equal(paintCount(canvas), paints);

    // A double-click centers the view on the ground there, and zooms in - with shift, out
    const point = pageGround(app, 300, 450);
    fire(browser, canvas, 'dblclick', {'clientX': 300, 'clientY': 450});
    clock.runFrame();
    assertAt(app, point, 489, 361);
    assert.equal(app.page.explorer.state.zoom, 2);
    fire(browser, canvas, 'dblclick', {'clientX': 489, 'clientY': 361, 'shiftKey': true});
    clock.runFrame();
    assertAt(app, point, 489, 361);
    assert.equal(app.page.explorer.state.zoom, 1);

    // A double-click off the site doesn't change the view
    fire(browser, canvas, 'dblclick', {'clientX': 5, 'clientY': 5});
    assert.equal(clock.frames.size, 1);
    clock.runFrame();
    assert.equal(clock.frames.size, 0);
});


test('the 3D explorer page controls', async (context) => {
    const browser = exploreBrowser(context);
    const {clock, main, window} = browser;
    await startApp(browser);
    const canvas = main.querySelector('canvas');
    clock.runFrame();
    const click = (command) => fire(browser, main.querySelector(`button[data-command="${command}"]`), 'click');

    // Zoom in and out, face north, view from above, and view the whole site
    for (const [command, status] of [
        ['in', 'Center x 200, y 150, z 533 ft - zoom 1.41x, rotation 30, tilt 35, exaggeration 1.5x'],
        ['in', 'Center x 200, y 150, z 533 ft - zoom 2x, rotation 30, tilt 35, exaggeration 1.5x'],
        ['out', 'Center x 200, y 150, z 533 ft - zoom 1.41x, rotation 30, tilt 35, exaggeration 1.5x'],
        ['north', 'Center x 200, y 150, z 533 ft - zoom 1.41x, rotation 0, tilt 35, exaggeration 1.5x'],
        ['top', 'Center x 200, y 150, z 533 ft - zoom 1.41x, rotation 0, tilt 90, exaggeration 1.5x']
    ]) {
        click(command);
        clock.runFrame();
        assert.equal(viewStatus(canvas), status);
    }

    // The vertical exaggeration
    const input = main.querySelector('input');
    input.value = '3';
    fire(browser, input, 'input');
    clock.runFrame();
    assert.equal(viewStatus(canvas), 'Center x 200, y 150, z 531 ft - zoom 1.41x, rotation 0, tilt 90, exaggeration 3x');
    assert.equal(input.value, '3');

    // Reset - the exaggeration's control is reset, too
    click('reset');
    clock.runFrame();
    assert.equal(viewStatus(canvas), 'Center x 200, y 150, z 533 ft - zoom 1x, rotation 30, tilt 35, exaggeration 1.5x');
    assert.equal(input.value, '1.5');

    // A control that doesn't change the view doesn't draw it, and a click between the controls does nothing
    const paints = paintCount(canvas);
    click('reset');
    click('out');
    fire(browser, main.querySelector('label'), 'click');
    clock.runFrame();
    assert.equal(paintCount(canvas), paints);

    // Hide and show the help - whether it's hidden is kept in local storage
    const help = main.querySelector('ul');
    const helpButton = main.querySelector('button[data-command="help"]');
    click('help');
    assert.equal(help.hidden, true);
    assert.equal(helpButton.getAttribute('aria-expanded'), 'false');
    assert.equal(window.localStorage.getItem('sageRoadExploreHelpHidden'), 'true');
    click('help');
    assert.equal(help.hidden, false);
    assert.equal(helpButton.getAttribute('aria-expanded'), 'true');
    assert.equal(window.localStorage.getItem('sageRoadExploreHelpHidden'), 'false');
    assert.equal(clock.frames.size, 0);
    assert.equal(paintCount(canvas), paints);
});


test('the 3D explorer page help is hidden', async (context) => {
    const browser = exploreBrowser(context, {'storage': {'sageRoadExploreHelpHidden': 'true'}});
    const {main} = browser;
    await startApp(browser);
    assert.equal(main.querySelector('ul').hidden, true);
    assert.equal(main.querySelector('button[data-command="help"]').getAttribute('aria-expanded'), 'false');
});


test('the 3D explorer page URL', async (context) => {
    const browser = exploreBrowser(context);
    const {clock, document, main, window} = browser;
    const app = await startApp(browser);
    const {page} = app;
    const {length} = window.history;
    clock.runFrame();

    // The view that hasn't changed leaves the URL as it is
    clock.runTimeout();
    assert.equal(window.location.hash, exploreHash);

    // Once a changed view stops changing, it's put in the URL - replacing it, without leaving the explorer
    assert.equal(keyDown(browser, 'ArrowRight', 'ArrowRight'), true);
    assert.equal(keyDown(browser, 'Equal', '+'), true);
    clock.runFrame();
    assert.equal(window.location.hash, exploreHash);
    clock.runTimeout();
    assert.equal(
        window.location.hash,
        "#var.vExplore=true&var.vFile='plans%2Ffixture.json'&var.vX=263.14&var.vY=123.92&var.vZ=528.55&var.vZoom=1.414"
    );
    assert.equal(window.history.length, length);
    await flush();
    assert.equal(app.page, page);
    assert.equal(document.title, 'Fixture Plan - 3D');

    // A view that's changed back leaves the URL as it is
    clock.runFrame();
    main.querySelector('button[data-command="in"]').click();
    main.querySelector('button[data-command="out"]').click();
    clock.runFrame();
    const {hash} = window.location;
    clock.runTimeout();
    assert.equal(window.location.hash, hash);

    // The URL's view is the explorer's when it's loaded
    const reloaded = exploreBrowser(context, {hash});
    const reloadedApp = await startApp(reloaded);
    assert.deepEqual(
        reloadedApp.page.explorer.state,
        {'azimuth': 30, 'tilt': 35, 'exaggeration': 1.5, 'zoom': 1.414, 'x': 263.14, 'y': 123.92, 'z': 528.55}
    );
});
