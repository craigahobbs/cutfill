// explore.js - the full-window 3D explorer's view, moved with the mouse: drag to move, drag with the right button (or
// shift) to rotate and tilt, the wheel to zoom, and double-click to center

import {argsParse, argsURL} from './args.js';
import {escapeHtml, number, round, unitLabel} from './format.js';
import {exploreStyle, svgOpen, svgText} from './draw.js';
import {groundPoint, maxZoom, projection, view3DParts} from './view3d.js';
import {opText, opsToSvg} from './canvas.js';


// The 3D explorer's view argument names
const exploreViewArgs = ['azimuth', 'tilt', 'exaggeration', 'zoom', 'x', 'y', 'z'];


// The 3D explorer's rotation and tilt, in degrees, of a drag across the view's width or down its height - a drag across
// the view turns it half around, and a drag down it tilts it from the side to above
const orbitAzimuth = 180;
const orbitTilt = 90;


// The 3D explorer's tilt and vertical exaggeration limits
const [minTilt, maxTilt] = [5, 90];
const [minExaggeration, maxExaggeration] = [1, 5];


// Compute the next zoom step (by the square root of two) in a direction (1 is in, -1 is out)
function zoomStep(zoom, direction) {
    const step = Math.round(2 * (Math.log(zoom) / Math.log(2))) + direction;
    return Math.max(1, Math.min(maxZoom, round(2 ** (step / 2), 3)));
}


// The distance within which a view's center is on the ground
const groundTolerance = 1e-6;


export class Explorer {
    constructor(data, globals, args) {
        this.data = data;
        this.globals = globals;
        this.ixOption = data.optionIndex(args.option);
        this.analysis = data.analysis(this.ixOption);
        this.rows = data.rows(this.ixOption);
        this.state = {};
        for (const name of exploreViewArgs) {
            this.state[name] = args[name] ?? null;
        }

        // The reset view is the whole site, from the default direction
        const defaults = argsParse({});
        this.reset = {};
        for (const name of exploreViewArgs) {
            this.reset[name] = defaults[name] ?? null;
        }
        this.view = null;
        this.drag = null;
    }


    // The 3D explorer's back-to-the-report URL
    backURL() {
        const backArgs = {'explore': null};
        for (const name of exploreViewArgs) {
            backArgs[name] = null;
        }
        return argsURL(this.globals, backArgs);
    }


    // The 3D explorer's URL, with its view - its center to a hundredth
    viewURL() {
        const {state} = this;
        const viewArgs = {'explore': true, ...state};
        for (const name of ['x', 'y', 'z']) {
            if (state[name] !== null) {
                viewArgs[name] = round(state[name], 2);
            }
        }
        return argsURL(this.globals, viewArgs);
    }


    // Compute the view for the explorer's width and height (default is the last view's)
    updateView(width = this.width, height = this.height) {
        this.width = width;
        this.height = height;
        // The terrain is smoothed wherever its limits allow (see view3DParts)
        this.view = projection(this.data.topo, {...this.state, 'fill': true, 'smooth': true}, width, height);
        return this.view;
    }


    // Draw the 3D explorer's view, filling the width and height - returns the drawing (view3DParts) with the view status
    // overlay - the report link, the controls, and their help are left to the page. "smoothLimits" are the smooth
    // terrain's limits (default is the SVG drawing's - see view3DParts).
    render(width, height, smoothLimits) {
        const drawing = this.draw3D(width, height, smoothLimits);
        drawing.ops.push(this.status());
        return drawing;
    }


    // Draw the 3D explorer's view as SVG markup, with the report link
    renderSvg(width, height, smoothLimits) {
        const drawing = this.draw3D(width, height, smoothLimits);
        const backText = svgText('Back to the report', 12, 20, 14, 'start', '#1f4e8c', true);
        return `${svgOpen(drawing.width, drawing.height, drawing.label, exploreStyle)}${opsToSvg(drawing.ops)}` +
            `<a href="${escapeHtml(this.backURL())}">${backText}</a>${opsToSvg([this.status()])}</svg>`;
    }


    // Draw the 3D view, without the overlay
    draw3D(width, height, smoothLimits) {
        const {data} = this;
        const view = this.updateView(width, height);
        return view3DParts(data.plan, data.topo, this.rows, this.ixOption, this.analysis, view, smoothLimits);
    }


    // Create the view status overlay's drawing operation
    status() {
        const {state, view, height} = this;
        const text = `Center x ${number(view.xc, 0)}, y ${number(view.yc, 0)}, z ${number(view.zc, 0)} ` +
            `${unitLabel(this.data.plan.units, 'length')} - zoom ${round(view.zoom, 2)}x, rotation ${round(state.azimuth, 1)}, ` +
            `tilt ${round(state.tilt, 1)}, exaggeration ${round(state.exaggeration, 2)}x`;
        return opText(text, 12, height - 14, 12, 'start', '#222', false);
    }


    // Move a view's center by pixels - the view's points move by them. The moved center keeps the view's center
    // elevation, so the whole view moves by the pixels, whatever the ground's elevation (the projection is orthographic).
    // The center stays within the topography.
    moveCenter(view, dx, dy) {
        const {state} = this;
        const {topo} = this.data;
        const across = -dx / view.scale;
        const away = dy / (view.scale * view.sinTilt);
        const x = view.xc + across * view.cosAz + away * view.sinAz;
        const y = view.yc - across * view.sinAz + away * view.cosAz;
        state.x = Math.max(0, Math.min(topo.width, x));
        state.y = Math.max(0, Math.min(topo.height, y));
        state.z = view.zc;
        this.updateView();
    }


    // Move the view's center along its line of sight to the ground, without changing the view - so it rotates and zooms
    // around the ground at the view's center. A view whose center's line of sight misses the topography is left as it
    // is. Returns true if the view's center moved.
    ground() {
        const {state, view} = this;
        const point = groundPoint(view, this.data.topo, view.width * 0.5, view.cy);
        if (point === null) {
            return false;
        }
        if (Math.hypot(point[0] - view.xc, point[1] - view.yc, point[2] - view.zc) < groundTolerance) {
            return false;
        }
        [state.x, state.y, state.z] = point;
        this.updateView();
        return true;
    }


    // Start a drag - "move" moves the view, and "orbit" rotates and tilts it around its center
    dragStart(mode) {
        this.drag = {mode, 'state': {...this.state}, 'view': this.view};
    }


    // Drag the view by pixels from the drag's start - returns true if the view changed
    dragMove(dx, dy) {
        const {drag, state} = this;
        if (drag === null) {
            return false;
        }
        Object.assign(state, drag.state);
        if (drag.mode === 'move') {
            this.moveCenter(drag.view, dx, dy);
        } else {
            // Drag right to turn the view's near side right (a rotation rounded to 360 degrees is 0)
            const azimuth = drag.state.azimuth + dx * orbitAzimuth / drag.view.width;
            state.azimuth = round((((azimuth % 360) + 360) % 360), 1) % 360;
            // Drag down to tilt the view toward the view from above
            state.tilt = round(Math.max(minTilt, Math.min(maxTilt, drag.state.tilt + dy * orbitTilt / drag.view.height)), 1);
            this.updateView();
        }
        return true;
    }


    // End a drag - a moved view's center is moved to the ground. Returns true if the view changed.
    dragEnd() {
        const {drag} = this;
        this.drag = null;
        return drag !== null && drag.mode === 'move' && this.ground();
    }


    // Zoom the view by a factor around a view point - the ground point under it stays under it. Returns true if the
    // view changed.
    zoomAt(px, py, factor) {
        const {view, state} = this;
        const zoom = Math.max(1, Math.min(maxZoom, round(view.zoom * factor, 3)));
        if (zoom === view.zoom) {
            return false;
        }
        const ratio = zoom / view.zoom;
        state.zoom = zoom;
        const zoomed = this.updateView();
        this.moveCenter(zoomed, (1 - ratio) * (px - view.width * 0.5), (1 - ratio) * (py - view.cy));
        this.ground();
        return true;
    }


    // Center the view on the ground under a view point, and zoom it by a factor - returns true if the view changed (a
    // point off the topography doesn't change it)
    centerAt(px, py, factor) {
        const {view, state} = this;
        const point = groundPoint(view, this.data.topo, px, py);
        if (point === null) {
            return false;
        }
        [state.x, state.y, state.z] = point;
        state.zoom = Math.max(1, Math.min(maxZoom, round(view.zoom * factor, 3)));
        this.updateView();
        return true;
    }


    // Run a view command - "in" and "out" zoom, "north" faces north, "top" views from above, and "reset" views the whole
    // site. Returns true if the view changed.
    command(name) {
        const {state} = this;
        const before = {...state};
        if (name === 'in' || name === 'out') {
            state.zoom = zoomStep(this.view.zoom, name === 'in' ? 1 : -1);
        } else if (name === 'north') {
            state.azimuth = 0;
        } else if (name === 'top') {
            state.tilt = maxTilt;
        } else if (name === 'reset') {
            Object.assign(state, this.reset);
        }
        this.updateView();
        return exploreViewArgs.some((argName) => state[argName] !== before[argName]);
    }


    // Set the vertical exaggeration - returns true if the view changed
    setExaggeration(value) {
        const exaggeration = Math.max(minExaggeration, Math.min(maxExaggeration, value));
        if (Number.isNaN(exaggeration) || exaggeration === this.state.exaggeration) {
            return false;
        }
        this.state.exaggeration = exaggeration;
        this.updateView();
        return true;
    }


    // Handle a key down event - returns "render" if the view changed, "back" to return to the report, or null. The arrow
    // keys move the view an eighth of its width or height, and + and - zoom it.
    keyDown(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return null;
        }
        const {key, code} = event;
        const {view} = this;
        if (code === 'Escape') {
            return 'back';
        } else if (code === 'ArrowLeft' || code === 'ArrowRight') {
            this.moveCenter(view, (code === 'ArrowLeft' ? 1 : -1) * view.width / 8, 0);
            this.ground();
        } else if (code === 'ArrowUp' || code === 'ArrowDown') {
            this.moveCenter(view, 0, (code === 'ArrowUp' ? 1 : -1) * view.height / 8);
            this.ground();
        } else if (key === '+' || key === '=') {
            this.command('in');
        } else if (key === '-' || key === '_') {
            this.command('out');
        } else {
            return null;
        }
        return 'render';
    }
}
