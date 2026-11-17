// explore.js - the full-window 3D explorer, controlled with the keyboard

import {escapeHtml, number, round, unitLabel} from './format.js';
import {exploreStyle, svgOpen, svgText} from './draw.js';
import {maxZoom, projection, view3DParts} from './view3d.js';
import {opRect, opText, opsToSvg} from './canvas.js';
import {argsURL} from './args.js';


// The 3D explorer's keyboard help lines
const exploreHelp = [
    'Arrows or W A S D - move',
    '+ / - - zoom in / out',
    'Q / E or Shift+Left / Right - rotate',
    'Shift+Up / Down - tilt (view from above / from the side)',
    'R / F or Page Up / Down - raise / lower',
    '[ / ] - less / more vertical exaggeration',
    'T - top view, N - face north, 0 - reset',
    'H - hide this help, Esc - back to the report'
];


// The 3D explorer's view argument names
const exploreViewArgs = ['azimuth', 'tilt', 'exaggeration', 'zoom', 'x', 'y', 'z'];


// Compute the next zoom step (by the square root of two) in a direction (1 is in, -1 is out)
function zoomStep(zoom, direction) {
    const step = Math.round(2 * (Math.log(zoom) / Math.log(2))) + direction;
    return Math.max(1, Math.min(maxZoom, round(2 ** (step / 2), 3)));
}


export class Explorer {
    constructor(data, globals, args) {
        this.data = data;
        this.globals = globals;
        this.ixOption = data.optionIndex(args.option);
        this.analysis = data.analysis(this.ixOption);
        this.rows = data.rows(this.ixOption);
        this.state = {'help': true};
        for (const name of exploreViewArgs) {
            this.state[name] = args[name] ?? null;
        }
        this.initial = {...this.state};
        this.view = null;
    }


    // The 3D explorer's back-to-the-report URL
    backURL() {
        const backArgs = {'explore': null};
        for (const name of exploreViewArgs) {
            backArgs[name] = null;
        }
        return argsURL(this.globals, backArgs);
    }


    // Compute the view for the explorer's width and height
    updateView(width, height) {
        this.width = width;
        this.height = height;
        // The terrain is smoothed wherever its limits allow (see view3DParts)
        this.view = projection(this.data.topo, {...this.state, 'fill': true, 'smooth': true}, width, height);
        return this.view;
    }


    // Draw the 3D explorer's view, filling the width and height - returns the drawing (view3DParts) with the overlays
    // (the keyboard help and the view status) - the report link is left to the page. "smoothLimits" are the smooth
    // terrain's limits (default is the SVG drawing's - see view3DParts).
    render(width, height, smoothLimits) {
        const drawing = this.draw3D(width, height, smoothLimits);
        for (const overlay of this.overlays()) {
            drawing.ops.push(overlay);
        }
        return drawing;
    }


    // Draw the 3D explorer's view as SVG markup, with the report link
    renderSvg(width, height, smoothLimits) {
        const drawing = this.draw3D(width, height, smoothLimits);
        const backText = svgText('Back to the report', 12, 20, 14, 'start', '#1f4e8c', true);
        return `${svgOpen(drawing.width, drawing.height, drawing.label, exploreStyle)}${opsToSvg(drawing.ops)}` +
            `<a href="${escapeHtml(this.backURL())}">${backText}</a>${opsToSvg(this.overlays())}</svg>`;
    }


    // Draw the 3D view, without the overlays
    draw3D(width, height, smoothLimits) {
        const {data} = this;
        const view = this.updateView(width, height);
        return view3DParts(data.plan, data.topo, this.rows, this.ixOption, this.analysis, view, smoothLimits);
    }


    // Create the overlays' drawing operations - the keyboard help and the view status
    overlays() {
        const {state, view, height} = this;
        const helpLines = state.help ? exploreHelp : ['H - keyboard help'];
        const helpTop = height - 36 - 18 * helpLines.length;
        const overlays = [opRect(8, helpTop - 6, 380, 18 * helpLines.length + 8, 4, 'white', 0.75)];
        for (let ixLine = 0; ixLine < helpLines.length; ixLine++) {
            overlays.push(opText(helpLines[ixLine], 16, helpTop + 7 + 18 * ixLine, 12, 'start', '#222', false));
        }
        const status = `Center x ${number(view.xc, 0)}, y ${number(view.yc, 0)}, z ${number(view.zc, 0)} ` +
            `${unitLabel(this.data.plan.units, 'length')} - zoom ${round(view.zoom, 2)}x, rotation ${round(state.azimuth, 1)}, ` +
            `tilt ${round(state.tilt, 1)}, exaggeration ${round(state.exaggeration, 2)}x`;
        overlays.push(opText(status, 12, height - 14, 12, 'start', '#222', false));
        return overlays;
    }


    // Handle a key down event - returns "render" if the view changed, "back" to return to the report, or null. The view
    // is updated for the width and height, so key presses between renders move from the moved view.
    keyDown(event, width = this.width, height = this.height) {
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return null;
        }
        const {key, code} = event;
        const shift = event.shiftKey;
        const {state, view} = this;
        const {topo} = this.data;

        // Back to the report
        if (code === 'Escape') {
            return 'back';
        }

        // The keys - the arrow keys move, or with shift, rotate and tilt
        let moveRight = 0;
        let moveForward = 0;
        let moveUp = 0;
        if ((code === 'ArrowLeft' && !shift) || code === 'KeyA') {
            moveRight = -1;
        } else if ((code === 'ArrowRight' && !shift) || code === 'KeyD') {
            moveRight = 1;
        } else if ((code === 'ArrowUp' && !shift) || code === 'KeyW') {
            moveForward = 1;
        } else if ((code === 'ArrowDown' && !shift) || code === 'KeyS') {
            moveForward = -1;
        } else if (code === 'KeyR' || code === 'PageUp') {
            moveUp = 1;
        } else if (code === 'KeyF' || code === 'PageDown') {
            moveUp = -1;
        } else if (key === '+' || key === '=') {
            state.zoom = zoomStep(state.zoom, 1);
        } else if (key === '-' || key === '_') {
            state.zoom = zoomStep(state.zoom, -1);
        } else if (code === 'KeyQ' || code === 'ArrowLeft') {
            state.azimuth = (state.azimuth + 350) % 360;
        } else if (code === 'KeyE' || code === 'ArrowRight') {
            state.azimuth = (state.azimuth + 10) % 360;
        } else if (code === 'ArrowUp') {
            state.tilt = Math.min(90, state.tilt + 5);
        } else if (code === 'ArrowDown') {
            state.tilt = Math.max(5, state.tilt - 5);
        } else if (key === '[') {
            state.exaggeration = Math.max(1, state.exaggeration - 0.25);
        } else if (key === ']') {
            state.exaggeration = Math.min(5, state.exaggeration + 0.25);
        } else if (code === 'KeyT') {
            state.tilt = 90;
        } else if (code === 'KeyN') {
            state.azimuth = 0;
        } else if (key === '0' || code === 'Home') {
            Object.assign(state, this.initial, {'help': state.help});
        } else if (code === 'KeyH' || key === '?') {
            state.help = !state.help;
        } else {
            return null;
        }

        // Move the view center an eighth of the view's width (left, right, forward, and back) or height (up and down) -
        // the moved center keeps its elevation
        if (moveRight !== 0 || moveForward !== 0 || moveUp !== 0) {
            const {scale, cosAz, sinAz} = view;
            const stepXY = view.width / 8 / scale;
            const stepZ = view.height / 8 / (scale * state.exaggeration);
            const x = view.xc + (moveRight * cosAz + moveForward * sinAz) * stepXY;
            const y = view.yc + (moveForward * cosAz - moveRight * sinAz) * stepXY;
            state.x = round(Math.max(0, Math.min(topo.width, x)), 1);
            state.y = round(Math.max(0, Math.min(topo.height, y)), 1);
            state.z = round(view.zc + moveUp * stepZ, 1);
        }
        this.updateView(width, height);
        return 'render';
    }
}
