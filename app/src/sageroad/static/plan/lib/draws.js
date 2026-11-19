// draws.js - find a site's draws (the valleys that carry water in a storm) from its terrain, and add the unmapped draws
// that a road crosses to the plan, as streams

import {lineIndex, nearestLine} from './roads.js';
import {StateHeap} from './route.js';
import {simplifyLine} from './features.js';


// The units of a draw's drainage area - the unit's name, its area in square plan units, the default least drainage
// area of a draw, and the least length of a draw (in plan units)
const areaUnits = {
    'feet': {'name': 'acres', 'area': 43560, 'minArea': 3, 'minLength': 100},
    'meters': {'name': 'hectares', 'area': 10000, 'minArea': 1.2, 'minLength': 30}
};


// The neighbors of a grid cell - [row step, column step, distance]
const neighbors = [
    [-1, -1, Math.SQRT2], [-1, 0, 1], [-1, 1, Math.SQRT2], [0, -1, 1], [0, 1, 1], [1, -1, Math.SQRT2], [1, 0, 1], [1, 1, Math.SQRT2]
];


// Find a topography's draws - the lines of its grid points that drain at least an area (in square plan units). Each
// grid point drains to its lowest neighbor - the grid's hollows are filled first, so every point drains to the grid's
// edge (a road's fill across a draw is a hollow: its culvert isn't in the terrain). A draw runs from its head down to
// the grid's edge, or to its point on a longer draw. Returns the draw objects, the largest first - a draw's "area" (the
// area it drains, at its end), its "points" ([x, y] arrays, from its head down), and the area that drains to each of
// its points ("areas" - at its point on a longer draw, the area it drains above that draw).
export function topoDraws(topo, minArea) {
    // A terrain's draws are kept (they're its elevation rows', whatever its features) - a plan's options are each
    // checked against them, and a plan's run adds the draws they cross and checks them again
    let areaDraws = topoDrawsCache.get(topo.rows);
    if (areaDraws === undefined) {
        areaDraws = new Map();
        topoDrawsCache.set(topo.rows, areaDraws);
    }
    const key = `${topo.spacing} ${minArea}`;
    if (!areaDraws.has(key)) {
        areaDraws.set(key, findDraws(topo, minArea));
    }
    return areaDraws.get(key);
}
const topoDrawsCache = new WeakMap();


// Find a topography's draws (topoDraws)
function findDraws(topo, minArea) {
    const {rows, nRows, nCols, spacing} = topo;
    const count = nRows * nCols;
    const isEdge = (cell) => {
        const row = Math.floor(cell / nCols);
        const col = cell - row * nCols;
        return row === 0 || col === 0 || row === nRows - 1 || col === nCols - 1;
    };

    // Fill the hollows - the grid's points, from its edge inward, lowest first, are at least a little above the point
    // they're reached from (priority-flood)
    const filled = new Float64Array(count);
    const reached = new Uint8Array(count);
    const heap = new StateHeap();
    const rise = spacing * 1e-5;
    for (let cell = 0; cell < count; cell++) {
        if (isEdge(cell)) {
            filled[cell] = rows[Math.floor(cell / nCols)][cell % nCols];
            reached[cell] = 1;
            heap.push(filled[cell], cell);
        }
    }
    while (heap.count > 0) {
        heap.pop();
        const {'cost': level, 'state': cell} = heap;
        const row = Math.floor(cell / nCols);
        const col = cell - row * nCols;
        for (const [rowStep, colStep] of neighbors) {
            const row2 = row + rowStep;
            const col2 = col + colStep;
            const cell2 = row2 * nCols + col2;
            if (row2 >= 0 && row2 < nRows && col2 >= 0 && col2 < nCols && !reached[cell2]) {
                filled[cell2] = Math.max(rows[row2][col2], level + rise);
                reached[cell2] = 1;
                heap.push(filled[cell2], cell2);
            }
        }
    }

    // Each point drains to its steepest neighbor below it - the grid's edge points drain off the grid
    const down = new Int32Array(count).fill(-1);
    const above = new Int32Array(count);
    for (let cell = 0; cell < count; cell++) {
        if (!isEdge(cell)) {
            const row = Math.floor(cell / nCols);
            const col = cell - row * nCols;
            let steepest = 0;
            for (const [rowStep, colStep, distance] of neighbors) {
                const cell2 = (row + rowStep) * nCols + col + colStep;
                const slope = (filled[cell] - filled[cell2]) / distance;
                if (slope > steepest) {
                    steepest = slope;
                    down[cell] = cell2;
                }
            }
            above[down[cell]] += 1;
        }
    }

    // The points that drain through each point - a point is counted once every point above it has been
    const drains = new Float64Array(count).fill(1);
    const ready = [];
    for (let cell = 0; cell < count; cell++) {
        if (above[cell] === 0) {
            ready.push(cell);
        }
    }
    while (ready.length > 0) {
        const cell = ready.pop();
        const cell2 = down[cell];
        if (cell2 !== -1) {
            drains[cell2] += drains[cell];
            above[cell2] -= 1;
            if (above[cell2] === 0) {
                ready.push(cell2);
            }
        }
    }

    // The draws' heads - the points that drain the area, with no such point above them - and each head's length, in
    // points, down to the grid's edge
    const minCells = minArea / (spacing * spacing);
    const hasAbove = new Uint8Array(count);
    for (let cell = 0; cell < count; cell++) {
        if (drains[cell] >= minCells && down[cell] !== -1) {
            hasAbove[down[cell]] = 1;
        }
    }
    const heads = [];
    for (let cell = 0; cell < count; cell++) {
        if (drains[cell] >= minCells && !hasAbove[cell]) {
            let length = 0;
            for (let cell2 = cell; cell2 !== -1; cell2 = down[cell2]) {
                length += 1;
            }
            heads.push([cell, length]);
        }
    }

    // The draws, the longest first - a draw ends at its point on a longer draw
    const claimed = new Uint8Array(count);
    const draws = [];
    for (const [head] of heads.sort(([head1, length1], [head2, length2]) => length2 - length1 || head1 - head2)) {
        const cells = [];
        let end = head;
        for (let cell = head; cell !== -1 && (cells.length === 0 || !claimed[cells.at(-1)]); cell = down[cell]) {
            cells.push(cell);
            if (!claimed[cell]) {
                end = cell;
            }
        }
        const areas = cells.map((cell) => drains[claimed[cell] ? end : cell] * spacing * spacing);
        for (const cell of cells) {
            claimed[cell] = 1;
        }
        draws.push({
            head,
            'area': areas.at(-1),
            'points': cells.map((cell) => [(cell % nCols) * spacing, (nRows - 1 - Math.floor(cell / nCols)) * spacing]),
            areas
        });
    }
    return draws.sort((draw1, draw2) => draw2.area - draw1.area || draw1.head - draw2.head).map(
        ({area, points, areas}) => ({area, points, areas})
    );
}


// Get a line's length
function lineLength(points) {
    let length = 0;
    for (let ix = 1; ix < points.length; ix++) {
        length += Math.hypot(points[ix][0] - points[ix - 1][0], points[ix][1] - points[ix - 1][1]);
    }
    return length;
}


// Get a plan's unmapped draws - the draws of its terrain that drain at least an area (in acres or hectares - null is
// the default area) and aren't along its streams. Each is a draw's part that isn't along one of the plan's streams,
// from its head down to the stream, and the area that drains to each of its points (at the stream, the area above it).
// A draw's number is its place among the terrain's draws, so it's the same once another draw is a stream. Returns the
// "draws", by the area their parts drain (the largest first) - each draw's "number", "area" (in acres or hectares),
// "points" ([x, y] arrays), points' "areas", and "length" - and the least area, "minArea".
export function planDraws(topo, units, area = null) {
    const areaUnit = areaUnits[units];
    const minArea = area ?? areaUnit.minArea;
    const streamDistance = Math.max(3 * topo.spacing, areaUnit.minLength * 0.5);
    const streams = lineIndex(topo.features, 'stream', streamDistance);
    const draws = topoDraws(topo, minArea * areaUnit.area).map((draw, ixDraw) => {
        const ixStream = draw.points.findIndex(([x, y]) => nearestLine(streams, x, y, streamDistance) !== null);
        const count = ixStream === -1 ? draw.points.length : ixStream + 1;
        const points = draw.points.slice(0, count);
        const areas = draw.areas.slice(0, count).map((value) => value / areaUnit.area);
        if (ixStream > 0) {
            areas[ixStream] = areas[ixStream - 1];
        }
        return {'number': ixDraw + 1, 'area': areas.at(-1), points, areas, 'length': lineLength(points)};
    }).filter(({length}) => length >= areaUnit.minLength).sort((draw1, draw2) => draw2.area - draw1.area || draw1.number - draw2.number);
    return {draws, minArea};
}


// Format a draw's drainage area, in acres or hectares
export function drawAreaText(units, value) {
    return `${Number(value.toFixed(value < 1 ? 2 : 1))} ${areaUnits[units].name}`;
}


// Find the unmapped draws (planDraws) that a road crosses - "x", "y", and "stations" are the road's alignment (its
// stations are evenly spaced), and "existing" is its existing roads' station mask (an existing road has its own
// culverts). A road crosses a draw where one of its stations is within half the stations' interval of the draw's line.
// Returns the crossing objects, in station order - the draw's "number", the "area" it drains, and the "station" and
// point ("x" and "y") of the road's first crossing of it.
export function drawCrossings(topo, units, x, y, stations, existing) {
    const {draws} = planDraws(topo, units);
    const tolerance = (stations[1] - stations[0]) * 0.505;
    const lines = lineIndex(draws.map(({number, points}) => (
        {'type': 'draw', 'name': number, 'points': points.map(([drawX, drawY]) => ({'x': drawX, 'y': drawY}))}
    )), 'draw', 4 * topo.spacing);
    const crossings = [];
    for (let ix = 0; ix < x.length; ix++) {
        const number = existing[ix] ? null : nearestLine(lines, x[ix], y[ix], tolerance)?.name ?? null;
        if (number !== null && !crossings.some((crossing) => crossing.number === number)) {
            const {area} = draws.find((draw) => draw.number === number);
            crossings.push({number, area, 'station': stations[ix], 'x': x[ix], 'y': y[ix]});
        }
    }
    return crossings;
}


// Add a plan's draws (planDraws - "numbers" are their numbers, at the least "area") to it as streams - "topo" is the
// plan's topography (planTopo), which isn't the plan's once its features change. A draw's stream is named for it
// ("Draw NUMBER"), and it's the draw's part that isn't along the plan's streams. Returns the report's "lines", and the
// "error" - null, or the draw that the plan doesn't have (the plan is as it was).
export function addDraws(plan, topo, numbers, area = null) {
    const {units} = plan;
    const {draws} = planDraws(topo, units, area);
    const lines = [];
    const streams = [];
    for (const number of numbers) {
        const draw = draws.find((planDraw) => planDraw.number === number) ?? null;
        if (draw === null) {
            return {'lines': [], 'error': `no draw ${number}`};
        }
        const points = simplifyLine(draw.points, topo.spacing * 0.75);
        const name = `Draw ${number}`;
        streams.push({'type': 'stream', 'points': points.map(([x, y]) => ({x, y})), name, 'added': true});
        lines.push(
            `Added stream "${name}": draw ${number} (drains ${drawAreaText(units, draw.area)}), ${points.length} points, ` +
            `${Math.round(lineLength(points))} ${units} long, from ${points[0].join(',')} to ${points.at(-1).join(',')}`
        );
    }
    plan.topography = {...plan.topography, 'features': [...topo.features, ...streams]};
    return {lines, 'error': null};
}
