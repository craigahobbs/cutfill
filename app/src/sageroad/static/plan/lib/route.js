// route.js - the road's horizontal alignment: the least-cost route search (which follows the plan's existing roads
// where that's cheaper than a new road), curve smoothing, and polyline utilities (a port of the Python planning
// tools', but for the existing roads, and a road's overlaps of itself)

import {
    crossSection, featureStreams, groundElevation, groundGradient, sectionCut, sectionFill, sectionSlopeWidth, sectionWall
} from './design.js';
import {featureIndexes, pointInPolygons, segmentIntersect} from '../../viewer/lib/model.js';
import {hypot, interp, linspace, pyRound} from './numeric.js';
import {nearestLine, segmentNearest} from './roads.js';


// The route search's 16 move directions ([dx, dy] lattice steps), in angle order
const moves = [
    [1, 0], [2, 1], [1, 1], [1, 2], [0, 1], [-1, 2], [-1, 1], [-2, 1],
    [-1, 0], [-2, -1], [-1, -1], [-1, -2], [0, -1], [1, -2], [1, -1], [2, -1]
];


// The moves of a route's half circle - a route turns a direction a move, so it reverses its heading in no fewer
export const halfCircleMoves = moves.length / 2;


// The number of heading states of a route search node - the 16 move directions, and no heading (the start)
const headingCount = moves.length + 1;


// Create a route search's lattice - the lattice's nodes and the cost of each move from every node. A move's cost is
// its length's road and its earthwork on the ground's side slope, weighted by "slopeWeight". The lattice doesn't
// depend on a search's start and end points or its grade penalties, so a route's legs and its searches with stricter
// grades use one lattice.
//
// "roads" is the index of the plan's existing roads (roads.js), or null for an all-new road. A move along an existing
// road costs its length's upgrade - there's no earthwork, grade limit, or culvert, and the road turns as it does - so
// the route follows the existing roads where that's cheaper than a new road, and joins and leaves them where it's
// cheapest.
//
// A new road's surface doesn't overlie a stream, but where it crosses it - a move that comes within the road's half-width
// of a stream, and doesn't cross it, runs in the stream's channel (routeSearch doesn't take it).
//
// Returns the lattice object for the routeSearch function - the "lattice" spacing, its "nX" by "nY" nodes, and each
// move's arrays of its cost from every node ("moveCosts" - infinite where there's no move), the ground's grade along it
// ("moveGrades"), whether it's along an existing road ("moveRoads"), the number of streams it crosses ("moveCulverts"),
// and whether it runs in a stream's channel ("moveChannels").
export function routeLattice(topo, design, slopeWeight, roads = null) {
    // The lattice is as fine as the minimum radius' turns allow (a turn is 22.5 degrees a step) - a finer lattice finds
    // a cheaper road, on gentler ground
    const lattice = Math.max(topo.spacing * 0.75, design.minRadius * 0.47);
    const nX = Math.trunc(topo.width / lattice) + 1;
    const nY = Math.trunc(topo.height / lattice) + 1;
    const nodeCount = nX * nY;
    const exclusions = featureIndexes(topo, 'exclusion');
    const rocks = featureIndexes(topo, 'rock');
    const streams = featureStreams(topo);

    // The nodes' elevations, and the nodes within the exclusion areas
    const nodeZ = new Float64Array(nodeCount);
    const blocked = new Uint8Array(nodeCount);
    for (let row = 0; row < nY; row++) {
        for (let col = 0; col < nX; col++) {
            const node = row * nX + col;
            nodeZ[node] = groundElevation(topo, col * lattice, row * lattice);
            blocked[node] = pointInPolygons(col * lattice, row * lattice, exclusions) ? 1 : 0;
        }
    }

    // The nodes on the existing roads - those within the tolerance of a road's line. A move is along an existing road
    // if it's between two of them and it's on the road in between, too (so it isn't a move from one road to another, or
    // across a switchback).
    const roadTolerance = lattice * roadToleranceLattice;
    const roadNodes = new Uint8Array(nodeCount);
    for (const segment of roads?.segments ?? []) {
        const rowEnd = Math.min(nY - 1, Math.floor((Math.max(segment.y1, segment.y2) + roadTolerance) / lattice));
        const colEnd = Math.min(nX - 1, Math.floor((Math.max(segment.x1, segment.x2) + roadTolerance) / lattice));
        for (let row = Math.max(0, Math.ceil((Math.min(segment.y1, segment.y2) - roadTolerance) / lattice)); row <= rowEnd; row++) {
            for (let col = Math.max(0, Math.ceil((Math.min(segment.x1, segment.x2) - roadTolerance) / lattice)); col <= colEnd; col++) {
                if (segmentNearest(segment, col * lattice, row * lattice)[0] <= roadTolerance) {
                    roadNodes[row * nX + col] = 1;
                }
            }
        }
    }
    const isRoadMove = (x1, y1, x2, y2) => [0.25, 0.5, 0.75].every(
        (fraction) => nearestLine(roads, x1 + fraction * (x2 - x1), y1 + fraction * (y2 - y1), roadTolerance) !== null
    );

    // A move is at most two lattice steps, so only the nodes near a stream segment can cross it, or run in its channel
    const margin = 3 * lattice + design.halfWidth;
    const latticeFirst = (v1, v2) => Math.max(0, Math.floor((Math.min(v1, v2) - margin) / lattice));
    const latticeEnd = (v1, v2, count) => Math.min(count, Math.ceil((Math.max(v1, v2) + margin) / lattice) + 1);

    // Each move from every node
    const moveLengths = [];
    const moveCosts = [];
    const moveGrades = [];
    const moveRoads = [];
    const moveCulverts = [];
    const moveChannels = [];
    const section = new Float64Array(6);
    for (const [dx, dy] of moves) {
        const length = Math.sqrt(dx * dx + dy * dy) * lattice;
        const ux = dx * lattice / length;
        const uy = dy * lattice / length;
        const costs = new Float64Array(nodeCount).fill(Infinity);
        const grades = new Float64Array(nodeCount);
        const roadMoves = new Uint8Array(nodeCount);
        const culverts = new Uint8Array(nodeCount);
        const channels = new Uint8Array(nodeCount);
        for (let row = 0; row < nY; row++) {
            for (let col = 0; col < nX; col++) {
                // The move's end is within the topography, and neither it nor the node is within an exclusion area?
                const x1 = col * lattice;
                const y1 = row * lattice;
                const x2 = x1 + dx * lattice;
                const y2 = y1 + dy * lattice;
                const row2 = row + dy;
                const col2 = col + dx;
                const node = row * nX + col;
                const inside = x2 >= 0 && y2 >= 0 && x2 <= topo.width && y2 <= topo.height;
                const inLattice = row2 >= 0 && row2 < nY && col2 >= 0 && col2 < nX;
                if (!inside || !inLattice || blocked[node] || blocked[row2 * nX + col2]) {
                    continue;
                }

                // A move along an existing road is the road's upgrade
                if (roadNodes[node] && roadNodes[row2 * nX + col2] && isRoadMove(x1, y1, x2, y2)) {
                    roadMoves[node] = 1;
                    costs[node] = length * design.costExisting;
                    continue;
                }

                // Bench section earthwork at the ground line, with walls where the side slope is too steep
                const midX = (x1 + x2) * 0.5;
                const midY = (y1 + y2) * 0.5;
                const [gradientX, gradientY] = groundGradient(topo, midX, midY);
                const sideSlope = -uy * gradientX + ux * gradientY;
                crossSection(0, sideSlope, design.halfWidth, design.cutSlope, design.fillSlope, design.maxSlopeHeight, section);
                const cutCost = pointInPolygons(midX, midY, rocks) ? design.costRock : design.costCut;
                costs[node] = length * (design.costLength + slopeWeight * (
                    section[sectionCut] * cutCost + section[sectionFill] * design.costFill +
                    section[sectionSlopeWidth] * design.costArea + section[sectionWall] * design.costWall
                ));
                grades[node] = Math.abs(groundElevation(topo, x2, y2) - nodeZ[node]) / length;
            }
        }

        // The streams the move crosses - each needs a culvert (an existing road has its own) - and the streams it runs in
        // the channel of: it's within the road's half-width of the stream, and it doesn't cross it
        for (const {points} of streams) {
            const crossing = new Set();
            const near = new Set();
            for (let ixPoint = 1; ixPoint < points.length; ixPoint++) {
                const point1 = points[ixPoint - 1];
                const point2 = points[ixPoint];
                const rowEnd = latticeEnd(point1.y, point2.y, nY);
                const colEnd = latticeEnd(point1.x, point2.x, nX);
                for (let row = latticeFirst(point1.y, point2.y); row < rowEnd; row++) {
                    for (let col = latticeFirst(point1.x, point2.x); col < colEnd; col++) {
                        const node = row * nX + col;
                        if (roadMoves[node]) {
                            continue;
                        }
                        const x1 = col * lattice;
                        const y1 = row * lattice;
                        const x2 = x1 + dx * lattice;
                        const y2 = y1 + dy * lattice;
                        if (segmentIntersect(x1, y1, x2, y2, point1.x, point1.y, point2.x, point2.y) !== null) {
                            culverts[node] += 1;
                            crossing.add(node);
                        } else if (segmentDistance(x1, y1, x2, y2, point1.x, point1.y, point2.x, point2.y) < design.halfWidth) {
                            near.add(node);
                        }
                    }
                }
            }
            for (const node of near) {
                if (!crossing.has(node)) {
                    channels[node] = 1;
                }
            }
        }
        moveLengths.push(length);
        moveCosts.push(costs);
        moveGrades.push(grades);
        moveRoads.push(roadMoves);
        moveCulverts.push(culverts);
        moveChannels.push(channels);
    }
    return {lattice, nX, nY, moveLengths, moveCosts, moveGrades, moveRoads, moveCulverts, moveChannels, blocked, exclusions};
}


// Search a route lattice (routeLattice) for the least-cost horizontal alignment from a start point to an end point
// ([x, y] arrays). The lattice's nodes have heading states, so the alignment's turns have a radius. A move's cost is
// the lattice's and its climb beyond the design grade, weighted by "gradeWeight" - the climb must be absorbed by
// earthwork (soft, up to "softBand" over the design grade, less "gradeMargin") or it makes the end unreachable (hard).
// A turning move is limited to the switchback grade, and a move that crosses a stream has a culvert - a turning move's,
// too. A new road's move doesn't run in a stream's channel, but from the start point or to the end point (a road's
// point may be on a stream). "startHeading" is the heading at the start (the previous leg's final heading), or null.
//
// The lattice's "barrier", if it has one, is its nodes that the route doesn't go through (corridorBarrier).
//
// "endHeading" is the heading at the end, or null for any - the route's last move is in its direction (the route joins
// another route's path at one of its points, with the path's heading there).
//
// Returns the route's "path" (an array of [x, y] points), its points' "existing" flags (the move to the point is along
// an existing road) and "headings" (the heading of the move to the point - the start's is the start heading), the
// "lattice" spacing, and the final "heading" - or null if there's no route.
export function routeSearch(
    routeNodes, design, start, end, gradeWeight, startHeading = null, softBand = 0.03, gradeMargin = 0, endHeading = null
) {
    const {lattice, nX, nY, moveLengths, moveCosts, moveGrades, moveRoads, moveCulverts, moveChannels, barrier = null} = routeNodes;
    const {costLength, costCulvert} = design;
    const moveCount = moves.length;
    const nodeCount = nX * nY;

    // The cost of a move's climb beyond a grade limit
    const gradeLimit = design.grade - gradeMargin;
    const turnLimit = design.switchbackGrade - gradeMargin;
    const excessCost = (groundGrade, limitGrade, length) => {
        const excess = Math.max(0, groundGrade - limitGrade) * length;
        const soft = Math.min(excess, softBand * length);
        return gradeWeight * (soft * costLength * 15 + (excess - soft) * costLength * 300);
    };

    // The start and end points' nodes
    const startNode = routeNode(routeNodes, start);
    const endNode = routeNode(routeNodes, end);

    // Dijkstra over the (node, heading) states - equal-cost states are taken in state order (row, column, heading)
    const best = new Float64Array(nodeCount * headingCount).fill(Infinity);
    const parent = new Int32Array(nodeCount * headingCount).fill(-1);
    const heap = new StateHeap();
    const startState = startNode * headingCount + (startHeading ?? moveCount);
    const turnPenalty = costLength * lattice * 0.15;
    let finalState = null;
    best[startState] = 0;
    heap.push(0, startState);
    while (heap.count > 0) {
        heap.pop();
        const {cost, state} = heap;
        if (cost > best[state]) {
            continue;
        }
        const node = Math.floor(state / headingCount);
        const heading = state % headingCount;
        if (node === endNode && (endHeading === null || heading === endHeading)) {
            finalState = state;
            break;
        }

        // Straight ahead and one direction either side - or from the start, any direction. On an existing road (the
        // move to the node was along it), the next move along it is in any direction - the road turns as it does.
        const noHeading = heading === moveCount;
        const onRoad = !noHeading && moveRoads[heading][node - moves[heading][1] * nX - moves[heading][0]] === 1;
        const anyHeading = noHeading || onRoad;
        const nextCount = anyHeading ? moveCount : 3;
        for (let ixNext = 0; ixNext < nextCount; ixNext++) {
            const nextHeading = anyHeading ? ixNext : (heading + moveCount - 1 + ixNext) % moveCount;
            const turn = noHeading ? 0 : Math.min(
                (nextHeading - heading + moveCount) % moveCount, (heading - nextHeading + moveCount) % moveCount
            );
            const roadMove = moveRoads[nextHeading][node] === 1;
            if (turn > 1 && !roadMove) {
                continue;
            }
            const [dx, dy] = moves[nextHeading];
            const nextNode = node + dy * nX + dx;
            if (!roadMove && moveChannels[nextHeading][node] === 1 && node !== startNode && nextNode !== endNode) {
                continue;
            }
            let moveCost = moveCosts[nextHeading][node];
            if (moveCost === Infinity) {
                continue;
            }
            if (!roadMove) {
                // The climb beyond the design grade - or, for a turning move, the switchback grade
                const length = moveLengths[nextHeading];
                const groundGrade = moveGrades[nextHeading][node];
                if (turn === 0) {
                    moveCost += excessCost(groundGrade, gradeLimit, length);
                } else {
                    moveCost = moveCost + excessCost(groundGrade, turnLimit, length) + turnPenalty;
                }
                for (let culverts = moveCulverts[nextHeading][node]; culverts > 0; culverts--) {
                    moveCost += costCulvert;
                }
            }
            if (barrier !== null && barrier[nextNode] === 1) {
                continue;
            }
            const nextState = nextNode * headingCount + nextHeading;
            const nextCost = cost + moveCost;
            if (nextCost < best[nextState]) {
                best[nextState] = nextCost;
                parent[nextState] = state;
                heap.push(nextCost, nextState);
            }
        }
    }
    if (finalState === null) {
        return null;
    }

    // Trace the path - it starts and ends at the start and end points
    const path = [];
    const existing = [];
    const headings = [];
    for (let state = finalState; state !== -1; state = parent[state]) {
        const node = Math.floor(state / headingCount);
        const heading = state % headingCount;
        path.push([(node % nX) * lattice, Math.floor(node / nX) * lattice]);
        existing.push(parent[state] !== -1 && moveRoads[heading][Math.floor(parent[state] / headingCount)] === 1);
        headings.push(heading === moveCount ? null : heading);
    }
    path.reverse();
    existing.reverse();
    headings.reverse();
    path[0] = [start[0], start[1]];
    path[path.length - 1] = [end[0], end[1]];
    return {path, existing, headings, lattice, 'heading': finalState % headingCount};
}


// Get a point's node of a route's lattice (routeLattice) - the nearest node. A point beside an exclusion area isn't
// within it, though its nearest node may be: its node is then the nearest of its lattice cell's nodes that isn't
// within an area (if there's one - a point in a gap that's narrower than the lattice has no route).
export function routeNode({lattice, nX, nY, blocked, exclusions}, [x, y]) {
    const nodeAt = (col, row) => Math.min(nY - 1, Math.max(0, row)) * nX + Math.min(nX - 1, Math.max(0, col));
    let node = nodeAt(pyRound(x / lattice), pyRound(y / lattice));
    if (blocked[node] === 1 && !pointInPolygons(x, y, exclusions)) {
        const col = Math.floor(x / lattice);
        const row = Math.floor(y / lattice);
        let nodeDistance = Infinity;
        for (const cellNode of [nodeAt(col, row), nodeAt(col + 1, row), nodeAt(col, row + 1), nodeAt(col + 1, row + 1)]) {
            const distance = hypot((cellNode % nX) * lattice - x, Math.floor(cellNode / nX) * lattice - y);
            if (blocked[cellNode] === 0 && distance < nodeDistance) {
                node = cellNode;
                nodeDistance = distance;
            }
        }
    }
    return node;
}


// The distance from an existing road's line that the route search's nodes are on the road within, in lattice spacings
const roadToleranceLattice = 0.75;


// Create a route lattice's barrier (routeSearch) - its nodes within a distance ("halfWidth") of lines (each an object
// of its points' "x" and "y" coordinate arrays), but for the nodes within that distance of the open points ([x, y]
// arrays). Returns the barrier - a Uint8Array of the lattice's nodes, 1 for a node in the barrier.
export function corridorBarrier(routeNodes, lines, halfWidth, openPoints) {
    const {lattice, nX, nY} = routeNodes;
    const barrier = new Uint8Array(nX * nY);
    const nodesNear = (x1, y1, x2, y2, isNear) => {
        const colEnd = Math.min(nX - 1, Math.floor((Math.max(x1, x2) + halfWidth) / lattice));
        const rowEnd = Math.min(nY - 1, Math.floor((Math.max(y1, y2) + halfWidth) / lattice));
        const nodes = [];
        for (let row = Math.max(0, Math.ceil((Math.min(y1, y2) - halfWidth) / lattice)); row <= rowEnd; row++) {
            for (let col = Math.max(0, Math.ceil((Math.min(x1, x2) - halfWidth) / lattice)); col <= colEnd; col++) {
                if (isNear(col * lattice, row * lattice)) {
                    nodes.push(row * nX + col);
                }
            }
        }
        return nodes;
    };
    for (const {x, y} of lines) {
        for (let ix = 1; ix < x.length; ix++) {
            const segment = {'x1': x[ix - 1], 'y1': y[ix - 1], 'x2': x[ix], 'y2': y[ix]};
            for (const node of nodesNear(x[ix - 1], y[ix - 1], x[ix], y[ix], (nodeX, nodeY) => (
                segmentNearest(segment, nodeX, nodeY)[0] <= halfWidth
            ))) {
                barrier[node] = 1;
            }
        }
    }
    for (const [x, y] of openPoints) {
        for (const node of nodesNear(x, y, x, y, (nodeX, nodeY) => Math.hypot(nodeX - x, nodeY - y) <= halfWidth)) {
            barrier[node] = 0;
        }
    }
    return barrier;
}


// Follow the existing roads of a route search's path (an array of [x, y] points, and its points' "existing" flags) -
// the path's runs along existing roads are moved onto the roads' lines ("roads" is the existing roads' index, and
// "lattice" is the search's lattice spacing). A run is an existing road where it's "minLength" long, at least, less
// the "transition" at each end where it joins a new road - the junction's curve is new road. Returns the path's
// "points" and its existing roads' "ranges" ([station, end station] arrays, along the points).
export function followRoads(path, existing, roads, lattice, minLength, transition) {
    const points = path.map(([x, y]) => [x, y]);
    const last = path.length - 1;
    const runs = [];
    for (let ix = 1; ix <= last; ix++) {
        if (existing[ix]) {
            // The run of moves along an existing road - from the point before the first to the last's point
            const ixStart = ix - 1;
            while (ix < last && existing[ix + 1]) {
                ix += 1;
            }
            const run = path.slice(ixStart, ix + 1);
            const runLength = polylineStations(run.map((point) => point[0]), run.map((point) => point[1])).at(-1);
            const trimStart = ixStart === 0 ? 0 : transition;
            const trimEnd = ix === last ? 0 : transition;
            if (runLength - trimStart - trimEnd >= minLength) {
                runs.push([ixStart, ix, trimStart, trimEnd]);

                // The run's points are the road's - but for the path's start and end points
                for (let ixPoint = Math.max(1, ixStart); ixPoint <= Math.min(last - 1, ix); ixPoint++) {
                    const nearest = nearestLine(roads, path[ixPoint][0], path[ixPoint][1], lattice);
                    points[ixPoint] = [nearest.x, nearest.y];
                }
            }
        }
    }
    const stations = polylineStations(points.map((point) => point[0]), points.map((point) => point[1]));
    return {
        points,
        'ranges': runs.map(([ixStart, ixEnd, trimStart, trimEnd]) => [stations[ixStart] + trimStart, stations[ixEnd] - trimEnd])
    };
}


// Find the via points that a road turns back at - "x", "y", and "stations" are the road's alignment, "vias" is the via
// points ([x, y] arrays), and "reach" is the distance along the road, before and after a via point, that's compared: the
// road turns back where the straight line between its points that far before and after the via point is less than half
// their distance along the road (a road that only passes a via point gets on with its way). Returns the turn-back
// objects - the via point's index ("via") and its station on the road ("station").
export function viaTurnBacks(x, y, stations, vias, reach) {
    const turnBacks = [];
    vias.forEach(([viaX, viaY], via) => {
        // The via point's alignment point, and the points the reach before and after it
        let ixVia = 0;
        for (let ix = 1; ix < x.length; ix++) {
            if (Math.hypot(x[ix] - viaX, y[ix] - viaY) < Math.hypot(x[ixVia] - viaX, y[ixVia] - viaY)) {
                ixVia = ix;
            }
        }
        let ixBefore = ixVia;
        while (ixBefore > 0 && stations[ixVia] - stations[ixBefore] < reach) {
            ixBefore -= 1;
        }
        let ixAfter = ixVia;
        while (ixAfter < x.length - 1 && stations[ixAfter] - stations[ixVia] < reach) {
            ixAfter += 1;
        }
        const chord = Math.hypot(x[ixAfter] - x[ixBefore], y[ixAfter] - y[ixBefore]);
        if (chord < 0.5 * (stations[ixAfter] - stations[ixBefore])) {
            turnBacks.push({via, 'station': stations[ixVia]});
        }
    });
    return turnBacks;
}


// Find where a road overlaps itself - a road doesn't cross itself, or run along itself. "x", "y", and "stations" are the
// road's alignment, and "width" is the road's width: two parts of the road overlap where their center lines are within
// the width of each other (their beds share ground). The parts of a curve are that near each other, so two parts
// overlap only if they're more than "minGap" apart along the road - a half circle of the minimum radius (a road's
// curves are no tighter, so parts that far apart are a full turn's width apart, at least). Returns the alignment
// points' overlaps (an Int32Array - the last point of the last part that overlaps the part that begins at a point, or -1
// if none does), or null if the road doesn't overlap itself.
export function roadOverlaps(x, y, stations, width, minGap) {
    // The road's parts are its alignment's segments - each is in its first point's cell, and the first points of two
    // segments that are within the width of each other are within a cell's size
    let maxLength = 0;
    for (let ix = 1; ix < x.length; ix++) {
        maxLength = Math.max(maxLength, stations[ix] - stations[ix - 1]);
    }
    const cellSize = width + 2 * maxLength;
    const cells = new Map();
    let overlaps = null;
    for (let ix = 0; ix < x.length - 1; ix++) {
        const row = Math.floor(y[ix] / cellSize);
        const col = Math.floor(x[ix] / cellSize);
        for (let cellRow = row - 1; cellRow <= row + 1; cellRow++) {
            for (let cellCol = col - 1; cellCol <= col + 1; cellCol++) {
                for (const ixOther of cells.get(`${cellRow},${cellCol}`) ?? []) {
                    if (stations[ix] - stations[ixOther + 1] > minGap && segmentDistance(
                        x[ix], y[ix], x[ix + 1], y[ix + 1], x[ixOther], y[ixOther], x[ixOther + 1], y[ixOther + 1]
                    ) < width) {
                        overlaps ??= new Int32Array(x.length).fill(-1);
                        overlaps[ixOther] = ix + 1;
                    }
                }
            }
        }
        const key = `${row},${col}`;
        if (!cells.has(key)) {
            cells.set(key, []);
        }
        cells.get(key).push(ix);
    }
    return overlaps;
}


// Get the distance between two segments - zero if they cross
function segmentDistance(x1, y1, x2, y2, x3, y3, x4, y4) {
    if (segmentIntersect(x1, y1, x2, y2, x3, y3, x4, y4) !== null) {
        return 0;
    }
    const first = {x1, y1, x2, y2};
    const second = {'x1': x3, 'y1': y3, 'x2': x4, 'y2': y4};
    return Math.min(
        segmentNearest(second, x1, y1)[0], segmentNearest(second, x2, y2)[0], segmentNearest(first, x3, y3)[0],
        segmentNearest(first, x4, y4)[0]
    );
}


// A binary min-heap of route search states, by cost and then by state - the items are in typed arrays, which grow as
// they fill
export class StateHeap {
    constructor(capacity = 1024) {
        this.costs = new Float64Array(capacity);
        this.states = new Int32Array(capacity);
        this.count = 0;

        // The item that pop removed
        this.cost = 0;
        this.state = 0;
    }

    push(cost, state) {
        if (this.count === this.costs.length) {
            const costs = new Float64Array(this.count * 2);
            const states = new Int32Array(this.count * 2);
            costs.set(this.costs);
            states.set(this.states);
            this.costs = costs;
            this.states = states;
        }

        // Sift the new item up from the end
        const {costs, states} = this;
        let ix = this.count;
        this.count += 1;
        while (ix > 0) {
            const ixParent = (ix - 1) >> 1;
            if (costs[ixParent] < cost || (costs[ixParent] === cost && states[ixParent] < state)) {
                break;
            }
            costs[ix] = costs[ixParent];
            states[ix] = states[ixParent];
            ix = ixParent;
        }
        costs[ix] = cost;
        states[ix] = state;
    }

    // Remove the first item - it's the heap's "cost" and "state"
    pop() {
        // Sift the last item down from the top
        const {costs, states} = this;
        [this.cost] = costs;
        [this.state] = states;
        this.count -= 1;
        const {count} = this;
        const cost = costs[count];
        const state = states[count];
        let ix = 0;
        for (;;) {
            let ixChild = 2 * ix + 1;
            if (ixChild >= count) {
                break;
            }
            const ixRight = ixChild + 1;
            if (ixRight < count &&
                (costs[ixRight] < costs[ixChild] || (costs[ixRight] === costs[ixChild] && states[ixRight] < states[ixChild]))) {
                ixChild = ixRight;
            }
            if (!(costs[ixChild] < cost || (costs[ixChild] === cost && states[ixChild] < state))) {
                break;
            }
            costs[ix] = costs[ixChild];
            states[ix] = states[ixChild];
            ix = ixChild;
        }
        costs[ix] = cost;
        states[ix] = state;
    }
}


// Get the stations (cumulative lengths) of a polyline's points
export function polylineStations(x, y) {
    const stations = new Float64Array(x.length);
    for (let ix = 1; ix < x.length; ix++) {
        stations[ix] = stations[ix - 1] + hypot(x[ix] - x[ix - 1], y[ix] - y[ix - 1]);
    }
    return stations;
}


// Resample a polyline (arrays of x and y coordinates) at an even interval - returns its "x" and "y" coordinate arrays
// and their "stations"
export function resamplePolyline(pointsX, pointsY, interval) {
    const pointStations = polylineStations(pointsX, pointsY);
    const length = pointStations[pointStations.length - 1];
    const stations = linspace(length, Math.max(2, Math.ceil(length / interval) + 1));
    return {
        'x': stations.map((stationValue) => interp(stationValue, pointStations, pointsX)),
        'y': stations.map((stationValue) => interp(stationValue, pointStations, pointsY)),
        stations
    };
}


// Compute the circumradius at each polyline point (infinite at the ends and on straight runs)
export function turnRadius(x, y) {
    const radius = new Float64Array(x.length).fill(Infinity);
    for (let ix = 1; ix < x.length - 1; ix++) {
        const ax = x[ix - 1];
        const ay = y[ix - 1];
        const bx = x[ix];
        const by = y[ix];
        const cx = x[ix + 1];
        const cy = y[ix + 1];
        const cross = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
        if (cross > 1e-9) {
            radius[ix] = hypot(bx - ax, by - ay) * hypot(cx - bx, cy - by) * hypot(cx - ax, cy - ay) / (2 * cross);
        }
    }
    return radius;
}


// The passes of a polyline's smoothing. The route search's turns are a lattice step at a time, which the "turnPasses"
// smooth - every point of the polyline. A new road joins an existing road at any angle, though, and a sharp junction's
// curve takes many more passes to widen to the minimum radius at a fine station interval (the passes a corner needs
// grow with its angle, and as the interval shrinks). So after the turn passes, up to "smoothPasses" in all smooth only
// the points near the curves that are still too tight - the rest of the polyline stays where the route search found
// it. A junction sharper than about 130 degrees isn't smoothed to the minimum radius - it needs a switchback.
const turnPasses = 400;
const smoothPasses = 5000;


// Resample a polyline (an array of [x, y] points) and smooth it (keeping the endpoints) until its curves meet the
// minimum radius. The polyline's existing roads (the "ranges" of its stations - [station, end station] arrays) are
// kept as they are - an existing road's curves are its own. Where a new road meets an existing road's end at a
// corner, the corner is the junction's curve: the existing road's end is smoothed with the new road, and it's new
// road (up to four of the minimum radius of it). Returns the smoothed polyline's "x" and "y" coordinate arrays, and
// the existing roads' "ranges" of the smoothed polyline's stations.
export function smoothCurves(points, interval, minRadius, ranges = []) {
    const resampled = resamplePolyline(points.map((point) => point[0]), points.map((point) => point[1]), interval);
    let {x, y} = resampled;

    // The existing roads' points - a range's first and last points, and the points between them
    const fixed = new Uint8Array(x.length);
    const fixedRanges = [];
    for (const [start, end] of ranges) {
        const ixStart = resampled.stations.findIndex((stationValue) => stationValue >= start - 1e-6);
        const ixEnd = resampled.stations.findLastIndex((stationValue) => stationValue <= end + 1e-6);
        if (ixStart !== -1 && ixStart < ixEnd) {
            fixed.fill(1, ixStart, ixEnd + 1);
            fixedRanges.push({'ends': [ixStart, ixEnd], 'junctions': [0, 0]});
        }
    }
    const junctionLimit = Math.ceil(4 * minRadius / interval);

    for (let ixSmooth = 0; ixSmooth < smoothPasses; ixSmooth++) {
        const radius = turnRadius(x, y);

        // An existing road's end at a corner with the new road is the junction's curve
        for (const {ends, junctions} of fixedRanges) {
            for (const [end, step] of [[0, 1], [1, -1]]) {
                const ix = ends[end];
                if (ends[0] <= ends[1] && ix >= 2 && ix < radius.length - 2 && junctions[end] < junctionLimit &&
                    radius[ix] < minRadius * 1.1) {
                    fixed[ix] = 0;
                    ends[end] += step;
                    junctions[end] += 1;
                }
            }
        }

        let radiusMin = Infinity;
        for (let ix = 2; ix < radius.length - 2; ix++) {
            if (!fixed[ix]) {
                radiusMin = Math.min(radiusMin, radius[ix]);
            }
        }
        if (radiusMin >= minRadius * 1.1) {
            break;
        }

        // After the turn passes, only the points near a curve that's still too tight are smoothed
        const smoothed = new Uint8Array(x.length);
        if (ixSmooth < turnPasses) {
            smoothed.fill(1);
        } else {
            for (let ix = 2; ix < radius.length - 2; ix++) {
                if (!fixed[ix] && radius[ix] < minRadius * 1.1) {
                    smoothed.fill(1, Math.max(0, ix - junctionLimit), ix + junctionLimit + 1);
                }
            }
        }
        const smooth = (values) => values.map((value, ix) => (
            ix === 0 || ix === values.length - 1 || fixed[ix] || !smoothed[ix] ? value :
                (values[ix - 1] + 2 * value + values[ix + 1]) * 0.25
        ));
        x = smooth(x);
        y = smooth(y);
    }
    const stations = polylineStations(x, y);
    return {
        x,
        y,
        'ranges': fixedRanges.filter(({ends}) => ends[0] < ends[1]).map(({ends}) => [stations[ends[0]], stations[ends[1]]])
    };
}
