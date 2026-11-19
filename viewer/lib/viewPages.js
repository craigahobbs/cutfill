// viewPages.js - the SageRoad viewer's plan pages: a road plan's report, and its 3D explorer

import {escapeHtml, round} from './format.js';
import {hitTitle, paintOps} from './canvas.js';
import {Explorer} from './explore.js';
import {argsURL} from './args.js';
import {buildReport} from './report.js';
import {exploreStyle} from './draw.js';
import {planPad} from './planView.js';
import {reportBudget} from './smoothing.js';
import {smoothLimitsCanvas} from './view3d.js';


// The document font size, in pixels (12pt)
const fontSize = 16;


// The maximum report view width, in pixels
const maxWidth = 1200;


// The canvas 3D drawings' print resolution, as a multiple of the drawing's size in CSS pixels, and their background color
// (the SVG drawings' style background)
const printRatio = 2;
const canvasBackground = '#f4f1ea';


// Paint a canvas 3D drawing (a report view's or the explorer's) at a pixel ratio - the canvas bitmap is the drawing's
// size times the ratio. The canvas's CSS size is the drawing's - its width, and with "fixedHeight", its height
// (otherwise, its height follows its width).
function paintCanvas(canvas, drawing, ratio, fixedHeight) {
    const {width, height} = drawing;
    const bitmapWidth = Math.round(width * ratio);
    const bitmapHeight = Math.round(height * ratio);
    if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
        canvas.width = bitmapWidth;
        canvas.height = bitmapHeight;
        canvas.style.width = `${width}px`;
        if (fixedHeight) {
            canvas.style.height = `${height}px`;
        }
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(bitmapWidth / width, 0, 0, bitmapHeight / height, 0, 0);

    // The drawing's background is painted, not left to the canvas's style, so it prints (printing omits backgrounds)
    ctx.fillStyle = canvasBackground;
    ctx.fillRect(0, 0, width, height);
    paintOps(ctx, drawing.ops);
}


// Find a mouse event's point in a canvas 3D drawing's coordinates - the canvas has a 1 pixel border
function drawingPoint(canvas, drawing, event) {
    const rect = canvas.getBoundingClientRect();
    const scale = drawing.width / rect.width;
    return [(event.clientX - rect.left - 1) * scale, (event.clientY - rect.top - 1) * scale];
}


// Show the title (tooltip) of a canvas 3D drawing's shape under the mouse
function showCanvasTitle(canvas, drawing, event) {
    if (drawing !== null) {
        const title = hitTitle(drawing.ops, ...drawingPoint(canvas, drawing, event));
        if ((canvas.title || null) !== title) {
            canvas.title = title ?? '';
        }
    }
}


// The delay after the 3D explorer's view stops changing before it draws its still view and puts the view in the URL, in
// milliseconds
const refineDelay = 250;


// The local storage key of the 3D explorer's measured terrain cell drawing cost (smoothing.js)
export const cellCostKey = 'sageRoadCellCost';


// Compute the report view width for the window width, in pixels
function viewWidth(window) {
    return Math.max(400, Math.min(maxWidth, window.innerWidth - 3 * fontSize));
}



// The report page - the 3D views are drawn progressively after the page renders, nearest the viewport first
export class ReportPage {
    constructor(app, data, globals, args, headerId) {
        this.app = app;
        this.data = data;
        this.globals = globals;
        this.args = args;
        this.closed = false;
        this.timeoutId = null;
        this.observer = null;
        this.width = viewWidth(app.window);
        this.renderReport(headerId);
    }


    renderReport(headerId = null) {
        const {app, data} = this;
        const {window} = app;
        const scrollY = headerId === null && this.report !== undefined ? window.scrollY : null;
        const report = buildReport(data, this.globals, this.args, this.width, true);
        this.report = report;
        app.render(report.title, report.html, headerId);
        if (scrollY !== null) {
            window.scrollTo(0, scrollY);
        }

        // The plan view click handler - open the 3D explorer centered on the clicked ground point, zoomed in 4x
        const planSvg = app.main.querySelector('svg.sageroad-plan');
        planSvg?.addEventListener('click', (event) => {
            const rect = planSvg.getBoundingClientRect();
            const {topo} = data;
            const {scale, height, width} = report.plan;
            const pxValue = event.clientX - rect.left;
            const pyValue = event.clientY - rect.top;
            const x = Math.max(0, Math.min(topo.width, (pxValue * width / rect.width - planPad) / scale));
            const y = Math.max(0, Math.min(topo.height, topo.height - (pyValue * height / rect.height - planPad) / scale));
            window.location.hash = argsURL(this.globals, {'explore': true, 'x': round(x, 1), 'y': round(y, 1), 'z': null, 'zoom': 4});
        });

        // Draw the 3D views - the visible ones first, then the rest, one per task so the page stays responsive
        this.canvases = [...app.main.querySelectorAll('canvas[data-view]')];
        this.drawings = this.canvases.map(() => null);
        this.pending = new Set(this.canvases.keys());
        this.observer?.disconnect();
        this.observer = new window.IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    this.drawView(parseInt(entry.target.dataset.view, 10));
                }
            }
        }, {'rootMargin': '50% 0px'});
        for (const [ixView, canvas] of this.canvases.entries()) {
            this.observer.observe(canvas);
            canvas.addEventListener('mousemove', (event) => showCanvasTitle(canvas, this.drawings[ixView], event));
        }
        this.scheduleViews();
    }


    // Draw a 3D view as finely as fits its time budget
    drawView(ixView) {
        if (this.closed || !this.pending.has(ixView)) {
            return;
        }
        this.pending.delete(ixView);
        this.observer.unobserve(this.canvases[ixView]);
        const {app} = this;
        const {smoothing, window} = app;
        const timeBegin = performance.now();
        const points = smoothing.targetPoints(reportBudget);
        const drawing = this.report.views[ixView].render({...smoothLimitsCanvas, points});
        this.drawings[ixView] = drawing;
        paintCanvas(this.canvases[ixView], drawing, window.devicePixelRatio || 1, false);

        // Measure the drawing - through the next animation frame, so the canvas's rasterization counts
        const {cells} = drawing;
        window.requestAnimationFrame(() => {
            smoothing.recordCost(performance.now() - timeBegin, cells);
            app.storageSet(cellCostKey, smoothing.cellCost);
            app.logTime(`3D view ${ixView + 1} - ${drawing.ops.length} operations, ${cells} cells, step ${drawing.step}, ` +
                `smooth ${drawing.smooth}${drawing.pointLimited ? ` (${points} point limit)` : ''} - drawn`, timeBegin);
        });
    }


    scheduleViews() {
        this.app.window.clearTimeout(this.timeoutId);
        this.timeoutId = this.app.window.setTimeout(() => {
            const [ixView] = this.pending;
            if (ixView !== undefined) {
                this.drawView(ixView);
                this.scheduleViews();
            }
        }, 0);
    }


    resize() {
        const width = viewWidth(this.app.window);
        if (width !== this.width) {
            this.width = width;
            this.app.window.clearTimeout(this.resizeId);
            this.resizeId = this.app.window.setTimeout(() => this.renderReport(), 100);
        }
    }


    // Draw every 3D view before printing - at print resolution (at least twice the screen's, about 300 dots per inch for a
    // report-width view)
    print() {
        for (const ixView of [...this.pending]) {
            this.drawView(ixView);
        }
        const ratio = Math.max(printRatio, this.app.window.devicePixelRatio || 1);
        for (const [ixView, canvas] of this.canvases.entries()) {
            if (this.drawings[ixView] !== null) {
                paintCanvas(canvas, this.drawings[ixView], ratio, false);
            }
        }
    }


    close() {
        this.closed = true;
        this.app.window.clearTimeout(this.timeoutId);
        this.app.window.clearTimeout(this.resizeId);
        this.observer?.disconnect();
    }
}


// The 3D explorer's controls, for its help - [input, action]
const exploreHelp = [
    ['Drag', 'move'],
    ['Right-drag or Shift+drag', 'rotate and tilt'],
    ['Wheel or pinch', 'zoom'],
    ['Double-click', 'center there and zoom in (with Shift, out)'],
    ['Arrow, +, and \u2212 keys', 'move and zoom'],
    ['Esc', 'back to the report']
];


// The local storage key of whether the 3D explorer's help is hidden
export const helpHiddenKey = 'sageRoadExploreHelpHidden';


// The 3D explorer's zoom per pixel of a wheel's scrolling, and of a trackpad's pinch (a wheel event with the control key),
// and a wheel's line, in pixels
const wheelZoom = 0.002;
const pinchZoom = 0.01;
const wheelLine = 16;


// The 3D explorer page - drawn on a canvas, redrawn once per animation frame as the mouse (or the keys, or the controls)
// change the view. Smooth terrain is drawn as finely as fits the moving view's frame time budget, then, once the view
// stops, as finely as fits the still view's budget (smoothing.js), and the view is put in the page's URL (so it's
// reloaded, or linked). The road segments' tooltips (the SVG drawing's titles) are found by hit-testing the drawing
// operations.
export class ExplorePage {
    constructor(app, data, globals, args) {
        this.app = app;
        this.explorer = new Explorer(data, globals, args);
        this.url = this.explorer.viewURL();
        this.frameId = null;
        this.refineId = null;
        this.drawing = null;
        this.pointer = null;
        app.document.title = `${data.plan.title} - 3D`;
        app.document.body.classList.toggle('sageroad-explore', true);
        app.window.scrollTo(0, 0);
        const helpHidden = app.storageGet(helpHiddenKey) === true;
        const helpItems = exploreHelp.map(([input, action]) => `<li><strong>${input}</strong> - ${action}</li>`);
        app.main.innerHTML = '<div class="sageroad-explorer"><canvas role="img"></canvas>' +
            `<a class="sageroad-explorer-back" href="${escapeHtml(this.explorer.backURL())}">Back to the report</a>` +
            '<div class="sageroad-explorer-tools">' +
            '<button type="button" data-command="in" title="Zoom in" aria-label="Zoom in">+</button>' +
            '<button type="button" data-command="out" title="Zoom out" aria-label="Zoom out">&minus;</button>' +
            '<button type="button" data-command="north" title="Face north">North</button>' +
            '<button type="button" data-command="top" title="View from above">Top</button>' +
            '<button type="button" data-command="reset" title="View the whole site">Reset</button>' +
            '<label title="Vertical exaggeration">Exaggeration <input type="range" min="1" max="5" step="0.25"></label>' +
            '<button type="button" data-command="help" title="Show or hide the controls" aria-label="Controls" ' +
            `aria-controls="sageroad-explorer-help" aria-expanded="${!helpHidden}">?</button></div>` +
            `<ul id="sageroad-explorer-help" class="sageroad-explorer-help"${helpHidden ? ' hidden' : ''}>${helpItems.join('')}</ul></div>`;
        this.root = app.main.firstElementChild;
        this.canvas = this.root.querySelector('canvas');
        this.canvas.setAttribute('style', exploreStyle);
        this.back = this.root.querySelector('a');
        this.exaggeration = this.root.querySelector('input');
        this.help = this.root.querySelector('ul');
        this.helpButton = this.root.querySelector('button[data-command="help"]');

        // The mouse's (or pen's, or a finger's) drags, its wheel, and its double-clicks - and the controls
        const {canvas} = this;
        canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
        canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
        canvas.addEventListener('pointerup', (event) => this.pointerUp(event));
        canvas.addEventListener('pointercancel', (event) => this.pointerUp(event));
        canvas.addEventListener('wheel', (event) => this.wheel(event), {'passive': false});
        canvas.addEventListener('dblclick', (event) => {
            const [x, y] = drawingPoint(canvas, this.drawing, event);
            this.update(() => this.explorer.centerAt(x, y, event.shiftKey ? 0.5 : 2));
        });
        canvas.addEventListener('contextmenu', (event) => event.preventDefault());
        this.root.querySelector('.sageroad-explorer-tools').addEventListener('click', (event) => {
            const button = event.target.closest('button');
            if (button !== null) {
                this.command(button.dataset.command);
            }
        });
        this.exaggeration.addEventListener('input', () => {
            this.update(() => this.explorer.setExaggeration(parseFloat(this.exaggeration.value)));
        });
        this.draw(false);
    }


    size() {
        const {window} = this.app;
        return [Math.max(320, window.innerWidth), Math.max(240, window.innerHeight)];
    }


    // Change the view - "change" changes the explorer's view (for the window's size) and returns true if it changed
    update(change) {
        this.explorer.updateView(...this.size());
        if (change()) {
            this.scheduleDraw();
        }
    }


    // A pointer is down - the main button drags the view, and the right button (or the main button with shift or
    // control) rotates and tilts it. Another pointer's drag (a second finger's) is ignored.
    pointerDown(event) {
        const {pointer} = this;
        if ((pointer !== null && pointer.id !== event.pointerId) || (event.button !== 0 && event.button !== 2)) {
            return;
        }
        const orbit = event.button === 2 || event.shiftKey || event.ctrlKey;
        this.pointer = {'id': event.pointerId, 'start': drawingPoint(this.canvas, this.drawing, event)};
        this.canvas.setPointerCapture?.(event.pointerId);
        this.canvas.title = '';
        this.root.classList.add('sageroad-explorer-dragging');
        this.explorer.updateView(...this.size());
        this.explorer.dragStart(orbit ? 'orbit' : 'move');
    }


    // A pointer moved - a drag changes the view, and otherwise the mouse shows the road's tooltips. A drag whose buttons
    // are up (its pointer up was missed) is ended.
    pointerMove(event) {
        const {pointer} = this;
        if (pointer === null) {
            showCanvasTitle(this.canvas, this.drawing, event);
        } else if (event.pointerId === pointer.id) {
            if (event.buttons === 0) {
                this.pointerUp(event);
            } else {
                const [x, y] = drawingPoint(this.canvas, this.drawing, event);
                this.update(() => this.explorer.dragMove(x - pointer.start[0], y - pointer.start[1]));
            }
        }
    }


    pointerUp(event) {
        if (this.pointer?.id === event.pointerId) {
            this.pointer = null;
            this.root.classList.remove('sageroad-explorer-dragging');
            this.update(() => this.explorer.dragEnd());
        }
    }


    // The wheel (or a trackpad's pinch) zooms around the mouse
    wheel(event) {
        event.preventDefault();
        const [x, y] = drawingPoint(this.canvas, this.drawing, event);
        const pixels = event.deltaY * (event.deltaMode === 1 ? wheelLine : 1);
        const factor = Math.exp(-pixels * (event.ctrlKey ? pinchZoom : wheelZoom));
        this.update(() => this.explorer.zoomAt(x, y, factor));
    }


    // A control's command - the help's shows or hides it, and the others change the view (see Explorer.command)
    command(name) {
        if (name === 'help') {
            const {help} = this;
            help.hidden = !help.hidden;
            this.helpButton.setAttribute('aria-expanded', `${!help.hidden}`);
            this.app.storageSet(helpHiddenKey, help.hidden);
        } else {
            this.update(() => this.explorer.command(name));
        }
    }


    // Draw the view - "still" draws the smooth terrain for the still view's frame time budget
    draw(still) {
        this.frameId = null;
        const {app, canvas, explorer} = this;
        const {smoothing, window} = app;
        const timeBegin = performance.now();
        const [width, height] = this.size();
        const points = smoothing.points(still);
        const drawing = explorer.render(width, height, {...smoothLimitsCanvas, points});
        this.drawing = drawing;
        const timeBuilt = performance.now();
        canvas.setAttribute('aria-label', drawing.label);
        paintCanvas(canvas, drawing, window.devicePixelRatio || 1, true);
        const timePainted = performance.now();
        this.back.href = explorer.backURL();
        this.exaggeration.value = `${explorer.state.exaggeration}`;
        canvas.dataset.frame = `${parseInt(canvas.dataset.frame ?? '0', 10) + 1}`;

        // Measure the frame - through the next animation frame, so the canvas's rasterization counts
        const {cells} = drawing;
        window.requestAnimationFrame(() => {
            const frameTime = performance.now() - timeBegin;
            smoothing.record(frameTime, cells, still);
            if (still) {
                app.storageSet(cellCostKey, smoothing.cellCost);
            }
            app.logTime(`3D explorer ${still ? 'still' : 'moving'} frame - ${drawing.ops.length} operations, ${cells} cells, ` +
                `step ${drawing.step}, smooth ${drawing.smooth}${drawing.pointLimited ? ` (${points} point limit)` : ''} - built in ` +
                `${(timeBuilt - timeBegin).toFixed(1)} ms, painted in ${(timePainted - timeBuilt).toFixed(1)} ms, frame`, timeBegin);
        });

        // Once the view stops changing, put it in the URL (replacing it, so the browser's back button returns to the
        // report), and draw the still view, if its larger budget draws the terrain more finely
        window.clearTimeout(this.refineId);
        this.refineId = null;
        if (!still) {
            this.refineId = window.setTimeout(() => {
                this.refineId = null;
                const url = explorer.viewURL();
                if (url !== this.url) {
                    this.url = url;
                    window.history.replaceState(null, '', url);
                }
                if (drawing.pointLimited && smoothing.points(true) > points) {
                    this.draw(true);
                }
            }, refineDelay);
        }
    }


    scheduleDraw() {
        this.app.window.clearTimeout(this.refineId);
        this.refineId = null;
        if (this.frameId === null) {
            this.frameId = this.app.window.requestAnimationFrame(() => this.draw(false));
        }
    }


    resize() {
        this.scheduleDraw();
    }


    keyDown(event) {
        this.explorer.updateView(...this.size());
        const result = this.explorer.keyDown(event);
        if (result === 'back') {
            this.app.window.location.hash = this.explorer.backURL();
        } else if (result === 'render') {
            event.preventDefault();
            this.scheduleDraw();
        }
    }


    close() {
        if (this.frameId !== null) {
            this.app.window.cancelAnimationFrame(this.frameId);
        }
        this.app.window.clearTimeout(this.refineId);
        this.app.document.body.classList.toggle('sageroad-explore', false);
        this.app.storageSet(cellCostKey, this.app.smoothing.cellCost);
    }
}
