// planView.js - the plan view and profile view drawings

import {
    cellContours, colors, contourInterval, contourLevel, labelHalfWidth, labelX, minRoadPx, niceStep, planMarkers, rgb, roadColor,
    roadFeatureColor, roadSides, samplePoints, streamColor, svgOpen, svgPolygon, svgPolyline, svgStyle, svgText
} from './draw.js';
import {centerlineAt, planCriteria, sampleAt} from './model.js';
import {fixedTrim, station as formatStation, number, px, unitLabel} from './format.js';
import {unproject} from './view3d.js';


// The plan view's padding, in pixels
export const planPad = 10;


// The features' names' font size, the space kept around a name and around the road (its highlighted centerline's half
// width), and the farthest that the road's edge is from a name's place for the name to be beside the road there, in
// pixels - and the places along a line feature that its name is tried at (fractions of its length - its middle first)
const nameSize = 11;
const nameGap = 2;
const roadGap = 3;
const besideMax = 2 * nameSize;
const nameFractions = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];


// Get a label's box - a [left, top, right, bottom] array - from its center and its font size
function labelBox(label, fontSize, x, y) {
    const halfWidth = labelHalfWidth(label, fontSize);
    const halfHeight = fontSize * 0.6;
    return [x - halfWidth, y - halfHeight, x + halfWidth, y + halfHeight];
}


// Get a line's points (a coordinates array's) at fractions of its length
function linePoints(coords, length, fractions) {
    return fractions.map((fraction) => {
        let remaining = fraction * length;
        let ix = 2;
        let segment = Math.hypot(coords[2] - coords[0], coords[3] - coords[1]);
        while (remaining > segment) {
            remaining -= segment;
            ix += 2;
            segment = Math.hypot(coords[ix] - coords[ix - 2], coords[ix + 1] - coords[ix - 1]);
        }
        const ratio = remaining / Math.max(segment, Number.EPSILON);
        return [coords[ix - 2] + (coords[ix] - coords[ix - 2]) * ratio, coords[ix - 1] + (coords[ix + 1] - coords[ix - 1]) * ratio];
    });
}


// Get the boxes that a label's box - its center and its half width and half height - is over
function boxesOver(boxes, x, y, halfWidth, halfHeight) {
    const left = x - halfWidth;
    const right = x + halfWidth;
    const top = y - halfHeight;
    const bottom = y + halfHeight;
    return boxes.filter((box) => left < box[2] && right > box[0] && top < box[3] && bottom > box[1]);
}


// The road's boxes are kept by the cells of a grid that they're in (a map of a cell's key to its boxes), so a label's
// box is tested against the road's boxes near it - a road has thousands. This is the cells' size, in pixels.
const cellSize = 64;


// Add a box to the cells it's in
function cellsAdd(cells, box) {
    for (let cellX = Math.floor(box[0] / cellSize); cellX <= Math.floor(box[2] / cellSize); cellX++) {
        for (let cellY = Math.floor(box[1] / cellSize); cellY <= Math.floor(box[3] / cellSize); cellY++) {
            const key = `${cellX},${cellY}`;
            const boxes = cells.get(key) ?? [];
            boxes.push(box);
            cells.set(key, boxes);
        }
    }
}


// Get the cells' boxes that a label's box is over - a box that's in more than one cell may be there more than once
function cellsOver(cells, x, y, halfWidth, halfHeight) {
    const near = [];
    for (let cellX = Math.floor((x - halfWidth) / cellSize); cellX <= Math.floor((x + halfWidth) / cellSize); cellX++) {
        for (let cellY = Math.floor((y - halfHeight) / cellSize); cellY <= Math.floor((y + halfHeight) / cellSize); cellY++) {
            near.push(...cells.get(`${cellX},${cellY}`) ?? []);
        }
    }
    return boxesOver(near, x, y, halfWidth, halfHeight);
}


// Create the features' names' markup - "names" is an array of [name, color, points] arrays, in the order they're placed.
// A name is at the first of its points where it's within the drawing and clear of the boxes ("boxes" - the drawing's
// other labels, and the names placed before it) and of the road ("roadCells"). A name that has no such point is beside
// the road, at the first of its points that the road is over - above the road there, below it, left of it, or right of
// it, where the road's edge is near the point - and a name that fits nowhere isn't drawn.
function featureNames(names, boxes, roadCells, width, height) {
    const elements = [];
    for (const [name, color, points] of names) {
        const halfWidth = labelHalfWidth(name, nameSize) + nameGap;
        const halfHeight = nameSize * 0.6 + nameGap;
        const fits = ([x, y]) => (
            x - halfWidth >= 0 && y - halfHeight >= 0 && x + halfWidth <= width && y + halfHeight <= height &&
            boxesOver(boxes, x, y, halfWidth, halfHeight).length === 0
        );

        // The name's places on its feature, and its places beside the road
        const beside = [];
        let place = null;
        for (const point of points) {
            const [x, y] = point;
            const over = cellsOver(roadCells, x, y, halfWidth, halfHeight);
            if (over.length === 0 && fits(point)) {
                place = point;
                break;
            } else if (over.length > 0) {
                const top = Math.min(...over.map((box) => box[1]));
                const bottom = Math.max(...over.map((box) => box[3]));
                const left = Math.min(...over.map((box) => box[0]));
                const right = Math.max(...over.map((box) => box[2]));
                beside.push(...[
                    [x, top - halfHeight - 0.5, y - top],
                    [x, bottom + halfHeight + 0.5, bottom - y],
                    [left - halfWidth - 0.5, y, x - left],
                    [right + halfWidth + 0.5, y, right - x]
                ].filter(([, , distance]) => distance <= besideMax));
            }
        }
        place ??= beside.find((point) => fits(point) && cellsOver(roadCells, point[0], point[1], halfWidth, halfHeight).length === 0) ??
            null;
        if (place !== null) {
            const [x, y] = place;
            boxes.push([x - halfWidth + nameGap, y - halfHeight + nameGap, x + halfWidth - nameGap, y + halfHeight - nameGap]);
            elements.push(svgText(name, x, y, nameSize, 'middle', color, false));
        }
    }
    return elements.join('');
}


// Create the plan view SVG markup - "outlines" is an array of [number, view, [x, y]] arrays of 3D views (projection)
// whose visible areas are outlined, with their numbers marked on the road at [x, y]. Returns the markup and the plan
// view's scale and height (for the click handler).
export function planView(plan, topo, analyses, ixOption, width, outlines) {
    const {units} = plan;
    const {spacing, nRows, nCols} = topo;
    const topoHeight = topo.height;
    const pad = planPad;
    const scale = (width - 2 * pad) / topo.width;
    const height = Math.round(topoHeight * scale + 2 * pad);
    const elements = [];

    // Contours
    const interval = contourInterval(plan, topo);
    const {rows} = topo;
    const segments = new Float64Array(8);
    const minorPath = [];
    const indexPath = [];
    for (let row = 0; row < nRows - 1; row++) {
        const rowTop = rows[row];
        const rowBottom = rows[row + 1];
        for (let col = 0; col < nCols - 1; col++) {
            const zNW = rowTop[col];
            const zNE = rowTop[col + 1];
            const zSE = rowBottom[col + 1];
            const zSW = rowBottom[col];
            const zMax = Math.max(zNW, zNE, zSE, zSW);
            for (let ixLevel = Math.ceil(Math.min(zNW, zNE, zSE, zSW) / interval); ; ixLevel++) {
                const level = contourLevel(ixLevel, interval);
                if (level > zMax) {
                    break;
                }
                const isIndex = ixLevel % 5 === 0;
                const segmentCount = cellContours(zNW, zNE, zSE, zSW, level, segments);
                for (let ixSegment = 0; ixSegment < segmentCount; ixSegment++) {
                    const ix = ixSegment * 4;
                    (isIndex ? indexPath : minorPath).push(
                        `M${px(pad + (col + segments[ix]) * spacing * scale)} ${px(pad + (row + segments[ix + 1]) * spacing * scale)}` +
                        `L${px(pad + (col + segments[ix + 2]) * spacing * scale)} ${px(pad + (row + segments[ix + 3]) * spacing * scale)}`
                    );
                }
            }
        }
    }
    elements.push(`<path d="${minorPath.join('')}" fill="none" stroke="#b89a72" stroke-width="0.6"/>`);
    elements.push(`<path d="${indexPath.join('')}" fill="none" stroke="#8a6a45" stroke-width="1.3"/>`);

    // Features - their names are drawn where they fit (featureNames), once the drawing's other labels and its road are
    // known: an area's name is at its center or, if it doesn't fit there, halfway to one of its corners, and a line's is
    // at its middle or, if it doesn't fit there, elsewhere along it. The pieces of a line (the features of its type and
    // name) have one name.
    const boxes = [];
    const roadCells = new Map();
    const areaNames = [];
    const lineNames = new Map();
    for (const feature of topo.features) {
        const {type} = feature;
        const coords = [];
        let sumX = 0;
        let sumY = 0;
        let lineLength = 0;
        for (const point of feature.points) {
            const pxValue = pad + point.x * scale;
            const pyValue = pad + (topoHeight - point.y) * scale;
            if (coords.length > 0) {
                lineLength += Math.hypot(pxValue - coords[coords.length - 2], pyValue - coords[coords.length - 1]);
            }
            coords.push(pxValue, pyValue);
            sumX += pxValue;
            sumY += pyValue;
        }
        if (type === 'stream') {
            elements.push(svgPolyline(coords, streamColor, 2.5));
        } else if (type === 'road') {
            elements.push(svgPolyline(coords, 'white', 3.5));
            elements.push(svgPolyline(coords, roadFeatureColor, 1.5));
        } else if (type === 'trail') {
            elements.push(svgPolyline(coords, roadFeatureColor, 1));
        } else if (type === 'rock') {
            elements.push(svgPolygon(coords, 'rgba(110,110,110,0.35)', '#555555', 1));
        } else {
            elements.push(svgPolygon(coords, 'rgba(208,49,45,0.12)', '#d0312d', 1.5));
        }
        const name = feature.name ?? null;
        if (name !== null && (type === 'stream' || type === 'road' || type === 'trail')) {
            const key = `${type} ${name}`;
            const line = lineNames.get(key) ?? {name, 'color': type === 'stream' ? '#1d4f9e' : '#444', 'length': 0, 'pieces': []};
            line.length += lineLength;
            line.pieces.push([lineLength, coords]);
            lineNames.set(key, line);
        } else if (name !== null) {
            const centerX = sumX / feature.points.length;
            const centerY = sumY / feature.points.length;
            const points = [[centerX, centerY]];
            for (let ix = 0; ix < coords.length; ix += 2) {
                points.push([(centerX + coords[ix]) * 0.5, (centerY + coords[ix + 1]) * 0.5]);
            }
            areaNames.push([name, '#444', points]);
        }
    }

    // Other options' centerlines
    for (let ixAnalysis = 0; ixAnalysis < analyses.length; ixAnalysis++) {
        if (ixAnalysis !== ixOption) {
            const coords = [];
            for (const point of analyses[ixAnalysis].alignment) {
                coords.push(pad + point.x * scale, pad + (topoHeight - point.y) * scale);
            }
            elements.push(svgPolyline(coords, '#777777', 1.5, '6 4'));
        }
    }

    // The features' names' place in the drawing - over the features and the other options, and under the road
    const ixNames = elements.length;
    elements.push('');

    // The selected option's footprint
    const analysis = analyses[ixOption];
    const option = plan.options[ixOption];
    const {section} = option;
    const halfWidth = section.width * 0.5;
    const {samples} = analysis;
    const surfaceFill = rgb(colors[section.surface ?? 'gravel']);
    const bridgeFill = rgb(colors.bridge);
    const existingFill = rgb(colors.existing);
    let prevCoords = null;
    for (let ixSample = 0; ixSample < samples.length; ixSample++) {
        const sample = samples[ixSample];
        const coords = [];
        for (const point of samplePoints(sample, halfWidth)) {
            coords.push(pad + point[0] * scale, pad + (topoHeight - point[1]) * scale);
        }
        if (ixSample > 0) {
            const prev = samples[ixSample - 1];
            for (const [sideName, ixDay, ixEdge] of roadSides) {
                const {kind} = sample[sideName];
                const kindPrev = prev[sideName].kind;
                if (kind === 'wall' || kindPrev === 'wall') {
                    elements.push(svgPolyline([
                        prevCoords[ixEdge * 2], prevCoords[ixEdge * 2 + 1], coords[ixEdge * 2], coords[ixEdge * 2 + 1]
                    ], '#333333', 3));
                } else if (kind !== 'none' || kindPrev !== 'none') {
                    // A slope that ends at this sample tapers to the road's edge, in the previous sample's color
                    const color = rgb(colors[kind !== 'none' ? kind : kindPrev]);
                    elements.push(svgPolygon([
                        prevCoords[ixEdge * 2], prevCoords[ixEdge * 2 + 1],
                        prevCoords[ixDay * 2], prevCoords[ixDay * 2 + 1],
                        coords[ixDay * 2], coords[ixDay * 2 + 1],
                        coords[ixEdge * 2], coords[ixEdge * 2 + 1]
                    ], color, color, 0.5));
                }
            }
            let fill = surfaceFill;
            if (prev.bridge && sample.bridge) {
                fill = bridgeFill;
            } else if (prev.existing && sample.existing) {
                fill = existingFill;
            }
            elements.push(svgPolygon([
                prevCoords[2], prevCoords[3], coords[2], coords[3], coords[4], coords[5], prevCoords[4], prevCoords[5]
            ], fill, fill, 0.5));

            // The features' names are clear of the road - its sample interval's surface and slopes, and its centerline
            const box = [Infinity, Infinity, -Infinity, -Infinity];
            for (const intervalCoords of [prevCoords, coords]) {
                for (let ix = 0; ix < 8; ix += 2) {
                    box[0] = Math.min(box[0], intervalCoords[ix] - roadGap);
                    box[1] = Math.min(box[1], intervalCoords[ix + 1] - roadGap);
                    box[2] = Math.max(box[2], intervalCoords[ix] + roadGap);
                    box[3] = Math.max(box[3], intervalCoords[ix + 1] + roadGap);
                }
            }
            cellsAdd(roadCells, box);
        }
        prevCoords = coords;
    }

    // A road narrower than the minimum drawn width is also drawn as a highlighted centerline
    if (2 * halfWidth * scale < minRoadPx) {
        const coords = [];
        for (const sample of samples) {
            coords.push(pad + sample.x * scale, pad + (topoHeight - sample.y) * scale);
        }
        elements.push(svgPolyline(coords, 'white', 6));
        elements.push(svgPolyline(coords, roadColor, 3));
    }

    // Culverts
    for (const structure of option.structures ?? []) {
        if (structure.type === 'culvert') {
            const sample = sampleAt(samples, structure.station);
            const points = samplePoints(sample, halfWidth);
            const [pointLeft, , , pointRight] = points;
            elements.push(svgPolyline([
                pad + pointLeft[0] * scale, pad + (topoHeight - pointLeft[1]) * scale,
                pad + pointRight[0] * scale, pad + (topoHeight - pointRight[1]) * scale
            ], streamColor, 3));
        }
    }

    // Station ticks
    const {length} = analysis;
    const tickStep = niceStep(length, 8);
    for (let stationValue = tickStep; stationValue < length; stationValue += tickStep) {
        const [x, y] = centerlineAt(samples, stationValue);
        const pxValue = pad + x * scale;
        const pyValue = pad + (topoHeight - y) * scale;
        elements.push(`<circle cx="${px(pxValue)}" cy="${px(pyValue)}" r="2.5" fill="#222"/>`);
        const label = formatStation(stationValue, units);
        elements.push(svgText(label, pxValue + 6, pyValue - 8, 10, 'start', '#222', false));
        boxes.push(labelBox(label, 10, pxValue + 6 + labelHalfWidth(label, 10), pyValue - 8));
    }

    // Start and end markers
    for (const [point, label, color] of planMarkers(plan)) {
        const pxValue = pad + point.x * scale;
        const pyValue = pad + (topoHeight - point.y) * scale;
        elements.push(`<circle cx="${px(pxValue)}" cy="${px(pyValue)}" r="6" fill="${color}" stroke="white" stroke-width="2"/>`);
        elements.push(svgText(label, labelX(label, 13, pxValue, width), pyValue - 14, 13, 'middle', color, true));
        boxes.push([pxValue - 7, pyValue - 7, pxValue + 7, pyValue + 7]);
        boxes.push(labelBox(label, 13, labelX(label, 13, pxValue, width), pyValue - 14));
    }

    // Scale bar
    const barLength = niceStep(topo.width, 5);
    const barPx = barLength * scale;
    const barY = height - pad - 12;
    elements.push(`<rect x="${pad + 8}" y="${barY - 14}" width="${px(barPx + 16)}" height="26" fill="white" fill-opacity="0.8"/>`);
    elements.push(svgPolyline([pad + 16, barY, pad + 16 + barPx, barY], '#222', 3));
    const barLabel = `${number(barLength, 0)} ${unitLabel(units, 'length')} — contours ${fixedTrim(interval, 2)} ` +
        `${unitLabel(units, 'length')}`;
    elements.push(svgText(barLabel, pad + 16, barY - 7, 10, 'start', '#222', false));
    boxes.push([pad + 8, barY - 14, pad + 16 + Math.max(barPx + 8, 2 * labelHalfWidth(barLabel, 10)), barY + 12]);

    // North arrow
    elements.push(svgPolygon([width - 30, pad + 8, width - 37, pad + 28, width - 23, pad + 28], '#222', '#222', 1));
    elements.push(svgText('N', width - 30, pad + 38, 11, 'middle', '#222', true));
    boxes.push([width - 37, pad + 8, width - 23, pad + 45]);

    // The 3D views' visible areas - their corners projected onto the ground - as light dashed outlines, then their
    // numbers marked on the road (on top of the outlines)
    for (const [outlineNumber, view] of outlines) {
        const coords = [];
        const viewWidth = view.width;
        const viewHeight = view.height;
        for (const [cornerX, cornerY] of [[0, 0], [viewWidth, 0], [viewWidth, viewHeight], [0, viewHeight]]) {
            const point = unproject(view, topo, cornerX, cornerY);
            coords.push(pad + point[0] * scale, pad + (topoHeight - point[1]) * scale);
        }
        elements.push(svgPolygon(coords, 'none', 'rgba(31,78,140,0.55)', 1, `3D view ${outlineNumber} area`, ' stroke-dasharray="5 4"'));
    }
    for (const [outlineNumber, , marker] of outlines) {
        const pxValue = pad + marker[0] * scale;
        const pyValue = pad + (topoHeight - marker[1]) * scale;
        elements.push(`<circle cx="${px(pxValue)}" cy="${px(pyValue)}" r="9" fill="#1f4e8c" stroke="white" stroke-width="1.5"/>`);
        boxes.push([pxValue - 10, pyValue - 10, pxValue + 10, pyValue + 10]);
        elements.push(`<text x="${px(pxValue)}" y="${px(pyValue)}" font-size="11" font-family="sans-serif" font-weight="bold" ` +
            `text-anchor="middle" dominant-baseline="central" fill="white">${outlineNumber}</text>`);
    }

    // The features' names - the areas', then the lines' from the longest line to the shortest, each at its longest piece
    // that has a place for it
    const names = [...areaNames];
    for (const {name, color, pieces} of [...lineNames.values()].sort((line, other) => other.length - line.length)) {
        pieces.sort((piece, other) => other[0] - piece[0]);
        names.push([name, color, pieces.flatMap(([pieceLength, coords]) => linePoints(coords, pieceLength, nameFractions))]);
    }
    elements[ixNames] = featureNames(names, boxes, roadCells, width, height);

    const svgElement = svgOpen(
        width, height, `Plan view of the ${option.name} road plan option`, `${svgStyle} cursor: crosshair;`, ' class="sageroad-plan"'
    );
    const svg = `${svgElement}${elements.join('')}</svg>`;
    return {svg, scale, height};
}


// Create the profile view SVG markup
export function profileView(plan, option, analysis, width, height) {
    const {units} = plan;
    const lengthUnit = unitLabel(units, 'length');
    const {samples} = analysis;
    const length = Math.max(analysis.length, 1e-9);
    const {maxGrade} = planCriteria(plan);
    const elements = [];

    // Elevation range
    let minZ = null;
    let maxZ = null;
    for (const sample of samples) {
        const low = Math.min(sample.z, sample.ground);
        const high = Math.max(sample.z, sample.ground);
        minZ = minZ === null ? low : Math.min(minZ, low);
        maxZ = maxZ === null ? high : Math.max(maxZ, high);
    }
    // The elevation grid lines are at least a unit apart (their labels are whole numbers) - so a level road has a range
    const zStep = Math.max(1, niceStep(maxZ - minZ, 6));
    minZ = Math.floor(minZ / zStep) * zStep - zStep;
    maxZ = Math.ceil(maxZ / zStep) * zStep;

    // Plot area
    const left = 64;
    const right = width - 16;
    const top = 16;
    const bottom = height - 40;
    const xScale = (right - left) / length;
    const yScale = (bottom - top) / (maxZ - minZ);

    // Grid and axes
    for (let z = minZ; z <= maxZ + 1e-9; z += zStep) {
        const pyValue = bottom - (z - minZ) * yScale;
        elements.push(svgPolyline([left, pyValue, right, pyValue], '#dddddd', 1));
        elements.push(svgText(number(z, 0), left - 6, pyValue, 10, 'end', '#444', false));
    }
    const stationStep = niceStep(length, 10);
    for (let stationValue = 0; stationValue <= length + 1e-9; stationValue += stationStep) {
        const pxValue = left + stationValue * xScale;
        elements.push(svgPolyline([pxValue, top, pxValue, bottom], '#dddddd', 1));
        elements.push(svgText(formatStation(stationValue, units), pxValue, bottom + 14, 10, 'middle', '#444', false));
    }
    elements.push(svgText('Station', (left + right) * 0.5, height - 10, 11, 'middle', '#444', true));
    elements.push(svgText(`Elevation (${lengthUnit}) — vertical exaggeration ${fixedTrim(yScale / xScale, 1)}x`,
        left + 6, top + 8, 11, 'start', '#444', true));

    // Cut and fill areas
    for (let ixRun = 0; ixRun < samples.length - 1;) {
        const sample = samples[ixRun];
        const isCut = sample.ground >= sample.z;
        const isBridge = sample.bridge;
        let ixEnd = ixRun + 1;
        while (ixEnd < samples.length - 1 && (samples[ixEnd].ground >= samples[ixEnd].z) === isCut && samples[ixEnd].bridge === isBridge) {
            ixEnd += 1;
        }
        if (!isBridge) {
            const gradeCoords = [];
            const groundCoords = [];
            for (let ixSample = ixRun; ixSample <= ixEnd; ixSample++) {
                const runSample = samples[ixSample];
                const pxValue = left + runSample.station * xScale;
                gradeCoords.push(pxValue, bottom - (runSample.z - minZ) * yScale);
                groundCoords.push(bottom - (runSample.ground - minZ) * yScale, pxValue);
            }
            gradeCoords.push(...groundCoords.reverse());
            const color = rgb(colors[isCut ? 'cut' : 'fill']);
            elements.push(svgPolygon(gradeCoords, color, color, 0.5));
        }
        ixRun = ixEnd;
    }

    // Ground line
    const groundCoords = [];
    for (const sample of samples) {
        groundCoords.push(left + sample.station * xScale, bottom - (sample.ground - minZ) * yScale);
    }
    elements.push(svgPolyline(groundCoords, '#6b4a2b', 1.5));

    // Structures - the wall and turnout labels share a row, so a label that would overlap the previous one is omitted
    let labelRight = null;
    for (const structure of option.structures ?? []) {
        // A structure beyond the end of the road (a design warning) is drawn at the end
        const {type} = structure;
        const stationValue = Math.min(structure.station, length);
        const endStation = Math.min(structure.endStation ?? stationValue, length);
        const px1 = left + stationValue * xScale;
        const px2 = left + endStation * xScale;
        if (type === 'bridge') {
            const sample1 = sampleAt(samples, stationValue);
            const sample2 = sampleAt(samples, endStation);
            const py1 = bottom - (sample1.z - minZ) * yScale;
            const py2 = bottom - (sample2.z - minZ) * yScale;
            elements.push(svgPolygon([px1, py1, px2, py2, px2, py2 + 6, px1, py1 + 6], '#786858', '#786858', 1));
            elements.push(svgText('Bridge', (px1 + px2) * 0.5, Math.min(py1, py2) - 10, 10, 'middle', '#444', true));
        } else if (type === 'culvert') {
            const sample = sampleAt(samples, stationValue);
            const pyValue = bottom - (sample.ground - minZ) * yScale;
            elements.push(`<circle cx="${px(px1)}" cy="${px(pyValue)}" r="5" fill="white" stroke="${streamColor}" stroke-width="2.5"/>`);
        } else {
            let color = '#2a8f8f';
            if (type === 'retainingWall') {
                color = '#555555';
            } else if (type === 'existingRoad') {
                color = '#706e68';
            }
            if (type === 'existingRoad') {
                // The existing road's (as-built) section is shaded
                elements.push(`<rect x="${px(px1)}" y="${top}" width="${px(Math.max(2, px2 - px1))}" height="${bottom - top}" ` +
                    'fill="rgba(112,110,104,0.12)"/>');
            }
            elements.push(`<rect x="${px(px1)}" y="${bottom - 8}" width="${px(Math.max(2, px2 - px1))}" height="8" fill="${color}"/>`);
            let label = 'Turnout';
            if (type === 'retainingWall') {
                label = 'Wall';
            } else if (type === 'existingRoad') {
                label = 'Existing road';
            }
            const halfLabel = labelHalfWidth(label, 10);
            const labelXValue = (px1 + px2) * 0.5;
            if (labelRight === null || labelXValue - halfLabel > labelRight + 4) {
                elements.push(svgText(label, labelXValue, bottom - 16, 10, 'middle', color, true));
                labelRight = labelXValue + halfLabel;
            }
        }
    }

    // Grade line - steep segments are highlighted. Each run of segments that are steep, or aren't, is a line - a
    // segment that doesn't start where the segment before it ends (a step in the grade) starts a line, too.
    let gradeCoords = null;
    let gradeSteep = false;
    let gradePrev = null;
    const gradeLine = () => {
        if (gradeCoords !== null) {
            elements.push(svgPolyline(gradeCoords, gradeSteep ? '#e01e1e' : '#1f2d3d', gradeSteep ? 3 : 2));
        }
    };
    for (const grade of analysis.grades) {
        const steep = !grade.existing && Math.abs(grade.grade) > maxGrade + 1e-6;
        if (gradePrev === null || steep !== gradeSteep || grade.station !== gradePrev.endStation || grade.z !== gradePrev.endZ) {
            gradeLine();
            gradeCoords = [left + grade.station * xScale, bottom - (grade.z - minZ) * yScale];
            gradeSteep = steep;
        }
        gradeCoords.push(left + grade.endStation * xScale, bottom - (grade.endZ - minZ) * yScale);
        gradePrev = grade;
    }
    gradeLine();

    // Legend
    const legendX = right - 250;
    const legends = [
        ['Cut', rgb(colors.cut)], ['Fill', rgb(colors.fill)], ['Ground', '#6b4a2b'], ['Grade', '#1f2d3d'],
        [`Over ${fixedTrim(maxGrade, 1)}%`, '#e01e1e']
    ];
    for (let ixLegend = 0; ixLegend < legends.length; ixLegend++) {
        const [legend, color] = legends[ixLegend];
        const lx = legendX + ixLegend * 50;
        elements.push(`<rect x="${lx}" y="${top + 2}" width="10" height="10" fill="${color}"/>`);
        elements.push(svgText(legend, lx + 13, top + 8, 10, 'start', '#444', false));
    }

    return `${svgOpen(width, height, `Profile of the ${option.name} road plan option`)}${elements.join('')}</svg>`;
}
