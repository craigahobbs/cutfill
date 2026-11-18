// viewPages.js - the Roadie viewer's plan pages: a road plan's report, and its 3D explorer

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


// Show the title (tooltip) of a canvas 3D drawing's shape under the mouse
function showCanvasTitle(canvas, drawing, event) {
    if (drawing !== null) {
        const rect = canvas.getBoundingClientRect();
        const scale = drawing.width / rect.width;
        const title = hitTitle(drawing.ops, (event.clientX - rect.left - 1) * scale, (event.clientY - rect.top - 1) * scale);
        if ((canvas.title || null) !== title) {
            canvas.title = title ?? '';
        }
    }
}


// The delay after the last key press before the 3D explorer draws its still view, in milliseconds
const refineDelay = 250;


// The local storage key of the 3D explorer's measured terrain cell drawing cost (smoothing.js)
export const cellCostKey = 'roadieCellCost';


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
        const planSvg = app.main.querySelector('svg.roadie-plan');
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


// The 3D explorer page - drawn on a canvas, redrawn once per animation frame as the keys change the view. Smooth terrain
// is drawn as finely as fits the moving view's frame time budget, then, once the keys stop, as finely as fits the still
// view's budget (smoothing.js). The road segments' tooltips (the SVG drawing's titles) are found by hit-testing the
// drawing operations.
export class ExplorePage {
    constructor(app, data, globals, args) {
        this.app = app;
        this.explorer = new Explorer(data, globals, args);
        this.frameId = null;
        this.refineId = null;
        this.drawing = null;
        app.document.title = `${data.plan.title} - 3D`;
        app.document.body.classList.toggle('roadie-explore', true);
        app.window.scrollTo(0, 0);
        app.main.innerHTML = '<div class="roadie-explorer"><canvas role="img"></canvas>' +
            `<a class="roadie-explorer-back" href="${escapeHtml(this.explorer.backURL())}">Back to the report</a></div>`;
        this.canvas = app.main.querySelector('canvas');
        this.canvas.setAttribute('style', exploreStyle);
        this.back = app.main.querySelector('a');
        this.canvas.addEventListener('mousemove', (event) => showCanvasTitle(this.canvas, this.drawing, event));
        this.draw(false);
    }


    size() {
        const {window} = this.app;
        return [Math.max(320, window.innerWidth - 3 * fontSize), Math.max(240, window.innerHeight - 3 * fontSize)];
    }


    // Draw the view - "still" draws the smooth terrain for the still view's frame time budget
    draw(still) {
        this.frameId = null;
        const {app, canvas} = this;
        const {smoothing, window} = app;
        const timeBegin = performance.now();
        const [width, height] = this.size();
        const points = smoothing.points(still);
        const drawing = this.explorer.render(width, height, {...smoothLimitsCanvas, points});
        this.drawing = drawing;
        const timeBuilt = performance.now();
        canvas.setAttribute('aria-label', drawing.label);
        paintCanvas(canvas, drawing, window.devicePixelRatio || 1, true);
        const timePainted = performance.now();
        this.back.href = this.explorer.backURL();
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

        // Once the keys stop, draw the still view, if its larger budget draws the terrain more finely
        window.clearTimeout(this.refineId);
        this.refineId = null;
        if (!still && drawing.pointLimited) {
            this.refineId = window.setTimeout(() => {
                this.refineId = null;
                if (smoothing.points(true) > points) {
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
        const [width, height] = this.size();
        const result = this.explorer.keyDown(event, width, height);
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
        this.app.document.body.classList.toggle('roadie-explore', false);
        this.app.storageSet(cellCostKey, this.app.smoothing.cellCost);
    }
}
