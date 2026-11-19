// plot.js - a road plan model's plot - its terrain (shaded, with contours), features, and options, with the plan's
// coordinates along its sides - for a model to find the places of a plan's notes on

import {
    cellContours, contourInterval, contourLevel, niceStep, planMarkers, roadColor, roadFeatureColor, streamColor, svgPoints, svgPolyline,
    svgText, terrainShade
} from '../../viewer/lib/draw.js';
import {escapeHtml, px} from '../../viewer/lib/format.js';
import {Buffer} from 'node:buffer';
import {grayPng} from './png.js';
import {rangeContourInterval} from './siteCommand.js';


// The plot's margins, in pixels - the left and bottom margins have the plan's coordinates
const marginLeft = 64;
const marginRight = 16;
const marginTop = 34;
const marginBottom = 34;


// The options' colors - the first is the viewer's road color
const optionColors = [roadColor, '#e07b00', '#7b3fc4', '#0a8f8f', '#7a8a00', '#1f3f9e'];


// The features' colors - the streams' and roads' are the viewer's
const featureColors = {
    'stream': streamColor, 'road': roadFeatureColor, 'trail': roadFeatureColor, 'rock': '#555555', 'exclusion': '#d0312d'
};


// The smallest terrain cell that's drawn, in pixels - a finer grid's cells are drawn several together
const cellPixels = 1.5;


// Create a road plan model's plot - "topo" is the plan's topography grid object (the viewer's planTopo), "width" is
// the plot's width, in pixels, and "box" is the part of the plan to plot ([x1, y1, x2, y2], in the plan's coordinates) -
// or null, for all of it. A box's plot is a closer look: its contour interval is its own elevations', and it's no
// taller than it's wide. "map" is the plan's topographic map image (a PNG image's base64 text), to plot it in place of
// the terrain - with the plan's coordinates' grid, to find the map's places by - or null. Returns the plot's SVG
// markup, and its "width" and "height".
export function planPlot(plan, topo, width = 1400, box = null, map = null) {
    const {units} = plan;
    const {spacing, nCols, nRows} = topo;

    // The plot's part of the plan - "north" is its north side's distance from the grid's
    const [west, south, east, top] = box === null ? [0, 0, topo.width, topo.height] :
        [Math.max(0, box[0]), Math.max(0, box[1]), Math.min(topo.width, box[2]), Math.min(topo.height, box[3])];
    const north = topo.height - top;
    const scale = Math.min(
        (width - marginLeft - marginRight) / (east - west),
        box === null ? Infinity : (width - marginTop - marginBottom) / (top - south)
    );
    const plotWidth = (east - west) * scale;
    const plotHeight = (top - south) * scale;
    const height = Math.round(plotHeight + marginTop + marginBottom);
    const planX = (x) => marginLeft + (x - west) * scale;
    const planY = (y) => marginTop + (top - y) * scale;
    const isInside = ({x, y}) => x >= west && x <= east && y >= south && y <= top;
    const elements = [];

    // The topographic map image is the plan's ground, edge to edge - a box's plot shows its part of it (the rest is
    // covered by the plot's margins)
    let interval = null;
    if (map !== null) {
        elements.push(
            `<rect x="${marginLeft}" y="${marginTop}" width="${px(plotWidth)}" height="${px(plotHeight)}" fill="#f4f1ea"/>`,
            `<image x="${px(planX(0))}" y="${px(planY(topo.height))}" width="${px(topo.width * scale)}" ` +
                `height="${px(topo.height * scale)}" preserveAspectRatio="none" href="data:image/png;base64,${map}"/>`
        );
    } else {
        // The terrain's cells - a fine grid's cells are drawn "step" grid cells together. The last cells are to the
        // grid's edge (or the box's).
        const step = Math.max(1, Math.floor(cellPixels / (spacing * scale)));
        const cols = gridSteps(Math.floor(west / spacing), Math.min(nCols - 1, Math.ceil(east / spacing)), step);
        const rows = gridSteps(Math.floor(north / spacing), Math.min(nRows - 1, Math.ceil((topo.height - south) / spacing)), step);
        const cellX = (ixCol) => marginLeft + (cols[ixCol] * spacing - west) * scale;
        const cellY = (ixRow) => marginTop + (rows[ixRow] * spacing - north) * scale;

        // The shaded terrain - lit from the northwest
        const shade = terrainShade(topo, cols, rows);
        const image = Buffer.from(grayPng(cols.length, rows.length, shade)).toString('base64');
        const imageWidth = cellX(cols.length - 1) - cellX(0);
        const imageHeight = cellY(rows.length - 1) - cellY(0);
        elements.push(
            `<rect x="${marginLeft}" y="${marginTop}" width="${px(plotWidth)}" height="${px(plotHeight)}" fill="#f4f1ea"/>`,
            `<image x="${px(cellX(0))}" y="${px(cellY(0))}" width="${px(imageWidth)}" height="${px(imageHeight)}" ` +
                `preserveAspectRatio="none" opacity="0.55" href="data:image/png;base64,${image}"/>`
        );

        // The contours - the index contours are labeled. A box's contour interval is its elevations'.
        interval = contourInterval(plan, topo);
        if (box !== null) {
            let minZ = Infinity;
            let maxZ = -Infinity;
            for (const row of rows) {
                for (const col of cols) {
                    minZ = Math.min(minZ, topo.rows[row][col]);
                    maxZ = Math.max(maxZ, topo.rows[row][col]);
                }
            }
            interval = rangeContourInterval(maxZ - minZ, units);
        }
        const segments = new Float64Array(8);
        const minorPath = [];
        const indexPath = [];
        const labels = new Map();
        for (let ixRow = 0; ixRow < rows.length - 1; ixRow++) {
            const rowTop = topo.rows[rows[ixRow]];
            const rowBottom = topo.rows[rows[ixRow + 1]];
            const yTop = cellY(ixRow);
            const cellHeight = (rows[ixRow + 1] - rows[ixRow]) * spacing * scale;
            for (let ixCol = 0; ixCol < cols.length - 1; ixCol++) {
                const zNW = rowTop[cols[ixCol]];
                const zNE = rowTop[cols[ixCol + 1]];
                const zSE = rowBottom[cols[ixCol + 1]];
                const zSW = rowBottom[cols[ixCol]];
                const zMax = Math.max(zNW, zNE, zSE, zSW);
                const xLeft = cellX(ixCol);
                const cellWidth = (cols[ixCol + 1] - cols[ixCol]) * spacing * scale;
                for (let ixLevel = Math.ceil(Math.min(zNW, zNE, zSE, zSW) / interval); ; ixLevel++) {
                    const level = contourLevel(ixLevel, interval);
                    if (level > zMax) {
                        break;
                    }
                    const isIndex = ixLevel % 5 === 0;
                    const segmentCount = cellContours(zNW, zNE, zSE, zSW, level, segments);
                    for (let ixSegment = 0; ixSegment < segmentCount; ixSegment++) {
                        const ix = ixSegment * 4;
                        const x1 = xLeft + segments[ix] * cellWidth;
                        const y1 = yTop + segments[ix + 1] * cellHeight;
                        (isIndex ? indexPath : minorPath).push(
                            `M${px(x1)} ${px(y1)}L${px(xLeft + segments[ix + 2] * cellWidth)} ${px(yTop + segments[ix + 3] * cellHeight)}`
                        );

                        // An index contour's label - one in each block of the plot, so they're spread over it
                        if (isIndex) {
                            const key = `${level}/${Math.floor(x1 / labelBlock)}/${Math.floor(y1 / labelBlock)}`;
                            if (!labels.has(key)) {
                                labels.set(key, [level, x1, y1]);
                            }
                        }
                    }
                }
            }
        }
        elements.push(
            `<path d="${minorPath.join('')}" fill="none" stroke="#8f6f45" stroke-width="0.6"/>`,
            `<path d="${indexPath.join('')}" fill="none" stroke="#7a5a35" stroke-width="1.1"/>`
        );
        for (const [level, x, y] of labels.values()) {
            elements.push(svgText(`${level}`, x, y, 9, 'middle', '#5a4020', false));
        }
    }

    // The features - a stream or a road is a line, a trail is a dotted line, and a rock outcrop or an exclusion area is
    // a dashed outline
    for (const feature of topo.features) {
        const {type, points} = feature;
        const line = type !== 'rock' && type !== 'exclusion';
        const coords = [];
        for (const point of line ? points : [...points, points[0]]) {
            coords.push(planX(point.x), planY(point.y));
        }
        const dashes = line ? (type === 'trail' ? '2 3' : null) : '5 3';
        elements.push(svgPolyline(coords, featureColors[type], type === 'stream' ? 2 : 1.2, dashes));
        const ixInside = [];
        for (let ix = 0; ix < points.length; ix++) {
            if (isInside(points[ix])) {
                ixInside.push(ix);
            }
        }
        if ('name' in feature && ixInside.length > 0) {
            // A line's name is at its middle point within the plot, and an area's is at its first
            const ixName = ixInside[line ? Math.floor(ixInside.length / 2) : 0] * 2;
            const [x, y] = [coords[ixName], coords[ixName + 1]];
            const fontSize = type === 'road' || type === 'trail' ? 9 : 11;
            elements.push(svgText(feature.name, x, y - 6, fontSize, 'middle', featureColors[type], false));
        }
    }

    // The options - each in its color, with its stations, existing roads (dashed), and structures
    const legend = [];
    for (let ixOption = 0; ixOption < plan.options.length; ixOption++) {
        const option = plan.options[ixOption];
        const color = optionColors[ixOption % optionColors.length];
        const {alignment} = option;
        const stations = [0];
        const coords = [planX(alignment[0].x), planY(alignment[0].y)];
        for (let ix = 1; ix < alignment.length; ix++) {
            stations.push(stations[ix - 1] + Math.hypot(alignment[ix].x - alignment[ix - 1].x, alignment[ix].y - alignment[ix - 1].y));
            coords.push(planX(alignment[ix].x), planY(alignment[ix].y));
        }
        const length = stations[stations.length - 1];
        elements.push(svgPolyline(coords, 'white', 4.5), svgPolyline(coords, color, 2.5));
        legend.push([`${ixOption}: ${option.name}`, color]);

        // Find the alignment's pixel at a station
        const stationPixel = (stationValue) => {
            let ix = 1;
            while (ix < stations.length - 1 && stations[ix] < stationValue) {
                ix += 1;
            }
            const run = stations[ix] - stations[ix - 1];
            const fraction = run > 0 ? Math.max(0, Math.min(1, (stationValue - stations[ix - 1]) / run)) : 0;
            return [
                coords[ix * 2 - 2] + (coords[ix * 2] - coords[ix * 2 - 2]) * fraction,
                coords[ix * 2 - 1] + (coords[ix * 2 + 1] - coords[ix * 2 - 1]) * fraction
            ];
        };

        // The structures
        for (const structure of option.structures ?? []) {
            const {type} = structure;
            const [x, y] = stationPixel(structure.station);
            if (type === 'existingRoad') {
                // The existing road's line - from its station to its end station, through the alignment's points between
                const existing = [x, y];
                for (let ix = 0; ix < stations.length; ix++) {
                    if (stations[ix] > structure.station && stations[ix] < structure.endStation) {
                        existing.push(coords[ix * 2], coords[ix * 2 + 1]);
                    }
                }
                existing.push(...stationPixel(structure.endStation));
                elements.push(svgPolyline(existing, '#111111', 1.5, '4 3'));
            } else if (type === 'culvert') {
                elements.push(`<circle cx="${px(x)}" cy="${px(y)}" r="4" fill="${color}" stroke="#111111"/>`);
            } else {
                // A wall is a square, a bridge is a triangle, and a turnout is a diamond
                const marker = structureMarkers[type].map(([dx, dy]) => [x + dx, y + dy]).flat();
                elements.push(`<polygon points="${svgPoints(marker)}" fill="${color}" stroke="#111111"/>`);
            }
        }

        // The stations
        const tick = niceStep(length, 8);
        for (let stationValue = tick; stationValue < length; stationValue += tick) {
            const [x, y] = stationPixel(stationValue);
            elements.push(svgText(`${Math.round(stationValue)}`, x + 5, y - 6, 9, 'start', color, false));
        }
    }

    // The start and end points
    for (const [point, label, color] of planMarkers(plan)) {
        if (isInside(point)) {
            const x = planX(point.x);
            const y = planY(point.y);
            elements.push(
                `<circle cx="${px(x)}" cy="${px(y)}" r="6" fill="${color}" stroke="white" stroke-width="2"/>`,
                svgText(label, x + 9, y - 9, 13, 'start', color, true)
            );
        }
    }

    // A box's plot ends at its frame - the plan beyond it is covered by the plot's margins (the plot's renderer fails
    // on a clipped group with an image)
    const right = marginLeft + plotWidth;
    const bottom = marginTop + plotHeight;
    if (box !== null) {
        elements.push(
            `<path d="M0 0H${width}V${height}H0ZM${marginLeft} ${marginTop}V${px(bottom)}H${px(right)}V${marginTop}Z" fill="white"/>`
        );
    }

    // The frame and the plan's coordinates
    elements.push(
        `<rect x="${marginLeft}" y="${marginTop}" width="${px(plotWidth)}" height="${px(plotHeight)}" fill="none" stroke="#333333"/>`
    );
    const tick = niceStep(Math.max(east - west, top - south), 10);
    const gridLine = (coords) => (
        map !== null ? [`<path d="M${px(coords[0])} ${px(coords[1])}L${px(coords[2])} ${px(coords[3])}" stroke="#222222" ` +
            'stroke-width="0.7" stroke-opacity="0.45" stroke-dasharray="6 4"/>'] : []
    );
    for (let x = Math.ceil(west / tick) * tick; x <= east + 1e-9; x += tick) {
        elements.push(
            ...gridLine([planX(x), marginTop, planX(x), bottom]),
            svgPolyline([planX(x), bottom, planX(x), bottom + 5], '#333333', 1),
            svgText(`${Math.round(x)}`, planX(x), bottom + 15, 11, 'middle', '#333333', false)
        );
    }
    for (let y = Math.ceil(south / tick) * tick; y <= top + 1e-9; y += tick) {
        elements.push(
            ...gridLine([marginLeft, planY(y), right, planY(y)]),
            svgPolyline([marginLeft - 5, planY(y), marginLeft, planY(y)], '#333333', 1),
            svgText(`${Math.round(y)}`, marginLeft - 8, planY(y), 11, 'end', '#333333', false)
        );
    }

    // The title and the options' legend
    const title = `${plan.title} - ${map !== null ? 'topographic map' : `contours every ${interval} ${units}`}, coordinates in ${units}`;
    elements.push(svgText(title, marginLeft, 16, 14, 'start', '#222222', true));
    for (let ixLegend = 0; ixLegend < legend.length; ixLegend++) {
        const [name, color] = legend[ixLegend];
        const y = marginTop + 14 + ixLegend * 16;
        elements.push(svgPolyline([right - 190, y, right - 170, y], color, 2.5), svgText(name, right - 164, y, 11, 'start', color, true));
    }

    return {
        'svg': `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" ` +
            `aria-label="${escapeHtml(plan.title)}">${elements.join('')}</svg>`,
        width,
        height
    };
}


// The size of an index contour label's block of the plot, in pixels - a contour has one label in a block
const labelBlock = 260;


// The structures' markers - their polygons' points, in pixels from the structure
const structureMarkers = {
    'retainingWall': [[-4, -4], [4, -4], [4, 4], [-4, 4]],
    'bridge': [[0, -5], [5, 4], [-5, 4]],
    'turnout': [[0, -5], [5, 0], [0, 5], [-5, 0]]
};


// Get a grid dimension's indexes at a step, from its first index to its last - the last index is the dimension's last
function gridSteps(first, last, step) {
    const indexes = [];
    for (let index = first; index < last; index += step) {
        indexes.push(index);
    }
    indexes.push(last);
    return indexes;
}


// Read a plan's topographic map image - its base64 text, or null if it has none. The image is a file beside the plan,
// or a data URL - the image itself (the Cutfill application's plans).
export function planMapBase64(io, planPath, plan) {
    const image = plan.image ?? '';
    const dataPrefix = image.match(/^data:image\/[a-z]+;base64,/i)?.[0] ?? null;
    if (dataPrefix !== null) {
        return image.slice(dataPrefix.length);
    }
    try {
        return Buffer.from(io.readBytes(`${planPath.slice(0, planPath.lastIndexOf('/') + 1)}${image}`)).toString('base64');
    } catch {
        return null;
    }
}
