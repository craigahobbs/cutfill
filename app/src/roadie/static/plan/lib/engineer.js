// engineer.js - engineer a plan's road options: a road option (its route's alignment, its profile, and its structures),
// the plan's standard options, and another corridor (a port of the Python planning tools', but for the existing roads
// the route follows, and the other corridor)

import {
    corridorBarrier, followRoads, polylineStations, resamplePolyline, routeLattice, routeSearch, smoothCurves, viaTurnBacks
} from './route.js';
import {designStructures, existingMask} from './structures.js';
import {drawAreaText, drawCrossings} from './draws.js';
import {fixedTrim, number as formatNumber} from '../../viewer/lib/format.js';
import {lineIndex, nearestLine} from './roads.js';
import {pyFixed, pyRound} from './numeric.js';
import {analyzeOption} from '../../viewer/lib/model.js';
import {createDesign} from './design.js';
import {designProfile} from './profile.js';


// Create a road's engineering arguments - the defaults, with other arguments: its option's "name" and "description"
// (lines, or null to keep the option's), the road's "width" and "surface", its "cutSlope" and "fillSlope" ratios, its
// design "grade" and "switchbackGrade" (in percent), its "turnouts" spacing, the fill depth of a stream crossing that a
// bridge replaces ("bridgeFill"), its "existingRoads" ([station, end station] ranges - null to find them), its "via"
// points ([x, y] arrays), whether it's all new ("allNew" - it doesn't follow the plan's existing roads), the names of
// the existing roads it doesn't follow ("ruleOut"), and its route search's "gradeWeight" (null for the best of several)
// and "slopeWeight". A null argument is its default.
export function roadArguments(args = {}) {
    return {
        'description': null, 'width': null, 'surface': 'gravel', 'cutSlope': 1, 'fillSlope': 1.5, 'grade': null, 'switchbackGrade': 8,
        'turnouts': null, 'bridgeFill': null, 'existingRoads': null, 'via': [], 'allNew': false, 'ruleOut': [], 'gradeWeight': null,
        'slopeWeight': 1, ...args
    };
}


// The road surfaces
export const roadSurfaces = ['native', 'gravel', 'asphalt', 'concrete'];


// The route search's soft grade bands and grade margins - if the profile can't reach the end elevation within the grade
// limits, the route is searched again with stricter grade penalties
const routeSearches = [[0.03, 0], [0.01, 0.005], [0, 0.015], [0, 0.03]];



// Get the plan's existing roads that a road may follow - all but those that are ruled out (by name, in any case)
function followedRoads(topo, ruleOut) {
    const names = ruleOut.map((name) => name.toLowerCase());
    return topo.features.filter(({type, name = ''}) => type === 'road' && !names.includes(name.toLowerCase()));
}


// Check the roads that are ruled out - each is one of the plan's existing roads. Returns the error line, or null.
export function ruledOutError(topo, ruleOut) {
    const names = new Set(topo.features.filter(({type}) => type === 'road').map(({name = ''}) => name.toLowerCase()));
    const unknown = ruleOut.find((name) => name === '' || !names.has(name.toLowerCase())) ?? null;
    return unknown !== null ? `error: The plan has no existing road named "${unknown}" to rule out` : null;
}



// The standard options' names
const roadsName = 'Existing Roads';
const newName = 'New Road';


// Engineer a plan's standard options - the road that follows the plan's existing roads where that costs less than a
// new road ("Existing Roads" - if it follows any), and an all-new road ("New Road" - the existing roads may not be
// usable). "args" are the roads' arguments (roadArguments). The plan's options of those names are replaced. Returns
// the report's "lines", the "error" (null, or why there's no road - "isGrade" is true if none is within the grade
// limit, and the plan's options are as they were), the standard options' "names", whether they follow existing roads
// ("followsRoads"), and whether one is at the site's edge ("atEdge" - the site may be too small for it).
export function standardOptions(plan, topo, args) {
    const routeArgs = standardArguments(args);
    const {options} = plan;
    const removeOption = (optionName) => {
        plan.options = plan.options.filter(({name}) => name !== optionName);
    };
    const lines = [];

    // The road that follows the plan's existing roads where that costs less than a new road - if it follows any
    let followsRoads = false;
    let atEdge = false;
    if (followedRoads(topo, args.ruleOut).length > 0) {
        const roadsOption = engineerOption(plan, topo, {...routeArgs, 'name': roadsName, 'allNew': false});
        if (roadsOption.error !== null) {
            // There may be an all-new road yet
            lines.push(...roadsOption.lines, `No "${roadsName}" option: ${roadsOption.error}`);
        } else {
            followsRoads = plan.options.find(({name}) => name === roadsName).structures.some(({type}) => type === 'existingRoad');
            atEdge = followsRoads && roadsOption.atEdge;
            lines.push(...(followsRoads ? roadsOption.lines : [`No "${roadsName}" option: the least-cost road follows no existing roads`]));
        }
    }
    if (!followsRoads) {
        removeOption(roadsName);
    }

    // The all-new road - the existing roads may not be usable
    const newOption = engineerOption(plan, topo, {...routeArgs, 'name': newName, 'allNew': true});
    lines.push(...newOption.lines);
    if (newOption.error !== null) {
        if (!followsRoads) {
            plan.options = options;
            return {lines, 'error': newOption.error, 'isGrade': newOption.isGrade, 'names': [], followsRoads, atEdge};
        }
        removeOption(newName);
        lines.push(`No "${newName}" option: ${newOption.error}`);
    } else {
        atEdge ||= newOption.atEdge;
    }
    const names = plan.options.map(({name}) => name).filter((name) => name === roadsName || name === newName);
    return {lines, 'error': null, 'isGrade': false, names, followsRoads, atEdge};
}


// Get the standard options' arguments - a road's arguments, without those that are an option's own
function standardArguments(args) {
    return {...args, 'description': null, 'existingRoads': null, 'via': [], 'gradeWeight': null, 'slopeWeight': 1};
}


// Keep a plan's options of names (all of them, if "names" is null), in cost score order - the lowest (the best) first -
// and remove its others. Returns the report's lines - each option's cost score and design warnings.
export function keepOptions(plan, topo, names = null) {
    const kept = plan.options.map((option, ixOption) => ({option, 'analysis': analyzeOption(plan, ixOption, topo)})).
        filter(({option}) => names === null || names.includes(option.name)).
        sort((first, second) => first.analysis.score - second.analysis.score);
    plan.options = kept.map(({option}) => option);
    return kept.map(({option, analysis}, ixOption) => (
        `Option ${ixOption}: "${option.name}" - cost score ${formatNumber(analysis.score, 1)}, design warnings: ${analysis.warnings.length}`
    ));
}



// The other corridor's names - for its side of the least-cost road (east, north, west, and south)
export const corridorNames = ['East', 'North', 'West', 'South'].map((side) => `${side} Corridor`);


// The other corridor's search - its band's half-width (a fraction of the distance between the start and end points, at
// least a number of minimum radii), the part of each standard option that the band is around (its middle - stations
// as fractions of its length), and the most the other corridor's cost score may be (a multiple of the least-cost
// standard option's)
const corridorWidth = 0.05;
const corridorRadii = 4;
const corridorMiddle = [0.2, 0.8];
const corridorCost = 3;


// The other corridor's road's grade penalty weight - one weight, for its time. On a steep hill, the roads' cost scores
// are within a few percent of each other from a weight of 0.5 to 0.25 (gradeWeights), and the first weight's road
// may turn back at the via point.
const corridorGradeWeight = 0.5;


// Engineer another corridor, if there's one that's a real choice against the plan's standard options (standardOptions)
// - the least-cost road outside a band around the standard options' middles (the start and end points are outside it),
// whose middle point is the corridor's via point. The corridor's option is the road through the via point (without the
// band, and with one grade penalty weight), if it's a real choice: it's within the grade limit, it doesn't turn back at
// the via point, its middle is an average of the band's half-width from the standard options, at least, and its cost
// score is at most the multiple of the least-cost standard option's. "args" are the standard options' arguments, and
// "followsRoads" is true if they follow existing roads. The plan's other corridor options are removed. Returns the
// report's "lines", the option's "name" (null if there's none), and the description's "note" of why there's none (null
// if there's an option).
export function corridorOption(plan, topo, args, followsRoads) {
    const routeArgs = standardArguments(args);
    plan.options = plan.options.filter(({name}) => !corridorNames.includes(name));
    const standard = plan.options.filter(({name}) => name === roadsName || name === newName);
    const design = createDesign(plan, routeArgs);
    const {start, end, units} = plan;
    const halfWidth = Math.max(corridorWidth * Math.hypot(end.x - start.x, end.y - start.y), corridorRadii * design.minRadius);
    const none = (reason, sentence) => ({'lines': [`No other corridor: ${reason}`], 'name': null, 'note': sentence});

    // The least-cost road around the band
    const roads = lineIndex(followedRoads(topo, routeArgs.ruleOut), 'road', Math.max(topo.spacing, design.minRadius) * 2);
    const routeNodes = optionLattice(topo, design, routeArgs, followsRoads ? roads : null);
    const middles = standard.map(({alignment}) => alignmentMiddle(alignment, halfWidth / 4));
    const barrier = corridorBarrier(routeNodes, middles, halfWidth, [[start.x, start.y], [end.x, end.y]]);
    const [[softBand, gradeMargin]] = routeSearches;
    const [gradeWeight] = gradeWeights;
    const found = routeSearch(
        {...routeNodes, barrier}, design, [start.x, start.y], [end.x, end.y], gradeWeight, null, softBand, gradeMargin
    );
    if (found === null) {
        return none(
            'there\'s no way around the standard options\' corridor within the site',
            'There\'s no other corridor - no way around the standard options\' corridor within the site.'
        );
    }

    // Its via point is the middle of its road, and its name is its middle's side of the least-cost road's middle (the
    // direction from the one's center to the other's)
    const {path} = found;
    const pathStations = polylineStations(path.map(([x]) => x), path.map(([, y]) => y));
    const ixMiddle = pathStations.findIndex((station) => station >= pathStations.at(-1) * 0.5);
    const via = path[ixMiddle].map((value) => pyRound(value));
    const scores = standard.map((option) => analyzeOption(plan, plan.options.indexOf(option), topo).score);
    const least = standard[scores.indexOf(Math.min(...scores))];
    const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
    const center = ({x, y}) => [mean(x), mean(y)];
    const [corridorX, corridorY] = center(alignmentMiddle(path.map(([x, y]) => ({x, y})), halfWidth / 4));
    const [leastX, leastY] = center(alignmentMiddle(least.alignment, halfWidth / 4));
    const side = Math.round(Math.atan2(corridorY - leastY, corridorX - leastX) / (Math.PI * 0.5));
    const name = corridorNames[(side + 4) % 4];

    // The road through the via point - it's an option if it's a real choice
    const engineered = engineerOption(
        plan, topo, {...routeArgs, name, 'allNew': !followsRoads, 'via': [via], 'gradeWeight': corridorGradeWeight}
    );
    const option = plan.options.find((planOption) => planOption.name === name);
    let distance = null;
    const middleDistance = () => {
        const standardLines = lineIndex(standard.map(({alignment}) => ({'type': 'road', 'points': alignment})), 'road', Infinity);
        const middle = alignmentMiddle(option.alignment, halfWidth / 4);
        distance = mean(middle.x.map((x, ix) => nearestLine(standardLines, x, middle.y[ix]).distance));
        return distance;
    };
    const score = () => analyzeOption(plan, plan.options.indexOf(option), topo).score;
    const viaText = `"${name}" (through ${via.join(',')})`;
    const reason = corridorReason(engineered, middleDistance, halfWidth, score, Math.min(...scores), units);
    if (reason !== null) {
        plan.options = plan.options.filter((planOption) => planOption !== option);
        return none(`${viaText} ${reason}`, `Another corridor, ${viaText}, was engineered and not kept - it ${reason}.`);
    }
    return {
        'lines': [
            ...engineered.lines,
            `Other corridor: ${viaText} - its middle is an average of ${pyFixed(distance, 0)} ${units} from the standard options`
        ],
        name,
        'note': null
    };
}


// Get why the other corridor's road isn't a real choice against the standard options - or null if it is. "engineered"
// is engineerOption's result. If it's a road, "distanceFn" is a function that returns the average distance of its
// middle from the standard options, and "scoreFn" is a function that returns its cost score. "halfWidth" is the
// corridor's band's half-width, and "leastScore" is the least-cost standard option's cost score.
export function corridorReason(engineered, distanceFn, halfWidth, scoreFn, leastScore, units) {
    if (engineered.error !== null) {
        return `isn't a road: ${engineered.error}`;
    } else if (engineered.turnsBack) {
        return 'turns back at its via point';
    }
    const distance = distanceFn();
    if (distance < halfWidth) {
        return `is in the standard options' corridor - its middle is an average of ${pyFixed(distance, 0)} ${units} from them ` +
            `(a corridor apart is ${pyFixed(halfWidth, 0)} ${units} or more)`;
    }
    const score = scoreFn();
    if (score > corridorCost * leastScore) {
        return `costs ${pyFixed(score / leastScore, 1)} times the least-cost option (cost score ${formatNumber(score, 1)}, more than ` +
            `${corridorCost} times)`;
    }
    return null;
}


// Get an option's alignment's middle (the corridor's part of it), resampled at an interval - its "x" and "y"
// coordinate arrays
function alignmentMiddle(alignment, interval) {
    const resampled = resamplePolyline(alignment.map(({x}) => x), alignment.map(({y}) => y), interval);
    const length = resampled.stations.at(-1);
    const [first, last] = corridorMiddle.map((fraction) => fraction * length);
    const indexes = [...resampled.stations.keys()].filter((ix) => resampled.stations[ix] >= first && resampled.stations[ix] <= last);
    return {'x': indexes.map((ix) => resampled.x[ix]), 'y': indexes.map((ix) => resampled.y[ix])};
}


// The route search's grade penalty weights. The search's penalty for ground steeper than the design grade stands in
// for the earthwork that a road needs there - it isn't a cost, so no one weight is right: a heavy penalty takes a road
// far around for gentler ground, and a light one takes it across ground that needs deep cuts and fills. A road's real
// cost is its cost score, so a route is searched with each weight, and the road with the lowest cost score is the
// route's (bestRoad - it's never worse than the first weight's road). On a steep hill, the scores are within a few
// percent of each other from a weight of 0.5 to 0.25, and they rise either side - on gentle ground, the roads are the
// same.
const gradeWeights = [1, 0.5, 0.25];


// Get a route's lattice (routeLattice) - "roads" is the index of the existing roads it follows, or null for an all-new
// road's. A topography's lattices are kept: a plan's options are searched on two of them - the lattice with its
// existing roads, and the lattice without.
function optionLattice(topo, design, commandArgs, roads) {
    let lattices = topoLattices.get(topo);
    if (lattices === undefined) {
        lattices = new Map();
        topoLattices.set(topo, lattices);
    }
    const ruleOut = roads !== null ? commandArgs.ruleOut.map((name) => name.toLowerCase()) : null;
    const key = JSON.stringify([design, commandArgs.slopeWeight, ruleOut]);
    if (!lattices.has(key)) {
        lattices.set(key, routeLattice(topo, design, commandArgs.slopeWeight, roads));
    }
    return lattices.get(key);
}
const topoLattices = new WeakMap();


// Engineer an option of a plan - its alignment, profile, and structures - "commandArgs" is the road's arguments
// (roadArguments). The route is searched with each grade penalty weight (or the argument's), and the option is the best
// of their roads (bestRoad). The option is added to the plan's options, or it replaces the option of its name. Returns
// the report's "lines" and the "error" - null, or why there's no option (the plan is as it was - "isGrade" is true if
// there's no road within the grade limit) - and if there's an option, whether it's at the site's edge ("atEdge" - the
// site may be too small for it), and whether it turns back at a via point ("turnsBack").
export function engineerOption(plan, topo, commandArgs) {
    const design = createDesign(plan, commandArgs);
    const planOptions = plan.options;
    const options = [...planOptions];
    plan.options = options;
    const ixExisting = options.findIndex((option) => option.name === commandArgs.name);
    const ixOption = ixExisting === -1 ? options.length : ixExisting;
    const existingOption = ixExisting === -1 ? null : options[ixExisting];
    const roads = lineIndex(followedRoads(topo, commandArgs.ruleOut), 'road', Math.max(topo.spacing, design.minRadius) * 2);

    // Design each road's alignment, profile, and structures - the searches are of one lattice
    const followsRoads = !commandArgs.allNew && commandArgs.existingRoads === null;
    const latticeNodes = optionLattice(topo, design, commandArgs, followsRoads ? roads : null);
    const pathDesigns = new Map();
    const designedRoads = [];
    let failed = null;
    for (const gradeWeight of (commandArgs.gradeWeight === null ? gradeWeights : [commandArgs.gradeWeight])) {
        const lines = [];
        const designed = routeAlignment(plan, topo, design, roads, latticeNodes, {...commandArgs, gradeWeight}, lines, pathDesigns);

        // A road that isn't within the grade limit isn't a road
        let error = null;
        if (designed === null) {
            error = 'no route found (blocked by exclusion areas or the topography boundary?)';
        } else if (designed.failure !== null) {
            const grade = `${fixedTrim(design.grade * 100, 1)}% grade limit`;
            error = `no road within the ${grade} - the profile ${designed.failure} (try other via points, a longer corridor, or a ` +
                'steeper grade)';
        }
        if (error !== null) {
            failed ??= {lines, error, 'isGrade': designed !== null};
        } else {
            // Structures (the existing roads within the road's length, measured along the option's alignment points as
            // the viewer does - an existing road to the road's end is to its last station, so nothing is placed between
            // them)
            const {x, y, stations, profile, sideSlope} = designed;
            const pointsX = Array.from(x, (value) => pyRound(value, 2));
            const pointsY = Array.from(y, (value) => pyRound(value, 2));
            let length = 0;
            for (let ix = 0; ix < x.length - 1; ix++) {
                length += Math.sqrt((pointsX[ix + 1] - pointsX[ix]) ** 2 + (pointsY[ix + 1] - pointsY[ix]) ** 2);
            }
            const alignmentLength = Math.floor(length * 10) / 10;
            const existingRoads = designed.existingRoads.filter(([start]) => start < alignmentLength);
            const structures = designStructures(topo, design, x, y, stations, profile, sideSlope, existingRoads, alignmentLength);

            // The road's option, and its cost score
            const description = commandArgs.description ?? existingOption?.description ?? null;
            const {width, cutSlope, fillSlope, surface} = design;
            const option = {
                'name': commandArgs.name,
                ...(description !== null && description.length > 0 ? {description} : {}),
                'section': {width, cutSlope, fillSlope, surface},
                'alignment': pointsX.map((pointX, ix) => ({'x': pointX, 'y': pointsY[ix], 'z': pyRound(profile[ix], 2)})),
                structures
            };
            options[ixOption] = option;
            const {score, warnings} = analyzeOption(plan, ixOption, topo);
            designedRoads.push({option, designed, existingRoads, lines, score, 'warnings': warnings.length});
        }
    }

    // No road? The plan is as it was.
    if (designedRoads.length === 0) {
        plan.options = planOptions;
        return failed;
    }
    const {option, designed, existingRoads, lines} = designedRoads[bestRoad(designedRoads)];
    options[ixOption] = option;

    // Report
    lines.push(...optionReport(plan, topo, design, roads, option, designed, existingRoads), ...designed.notes);
    const atEdge = edgeStation(topo, design, designed.x, designed.y) !== null;
    return {lines, 'error': null, atEdge, 'turnsBack': designed.notes.length > 0};
}


// Get the station where a road (its alignment's "x" and "y" coordinate arrays) is nearest the site's edge, if it's
// within its minimum radius of the edge there - it has no room there, and the site may be too small for it (unless its
// start or end point is as near the edge). Returns the alignment point's index, or null.
function edgeStation(topo, design, x, y) {
    const last = x.length - 1;
    let ixEdge = 0;
    const edgeDistance = (ix) => Math.min(x[ix], y[ix], topo.width - x[ix], topo.height - y[ix]);
    for (let ix = 1; ix <= last; ix++) {
        if (edgeDistance(ix) < edgeDistance(ixEdge)) {
            ixEdge = ix;
        }
    }
    return edgeDistance(ixEdge) < Math.min(design.minRadius, edgeDistance(0), edgeDistance(last)) ? ixEdge : null;
}


// Find the best of a route's roads (objects with a road's design "warnings" count and its cost "score"), in the
// order of their searches - the index of the road with the lowest cost score, as it's reported (to a tenth), of the
// roads with no more design warnings than the first road. It's the first of the roads with that score - so the best
// road is never worse than the first road, by its cost score or by its design warnings.
export function bestRoad(roads) {
    const reported = (road) => Math.round(road.score * 10);
    let ixBest = 0;
    for (let ix = 1; ix < roads.length; ix++) {
        if (roads[ix].warnings <= roads[0].warnings && reported(roads[ix]) < reported(roads[ixBest])) {
            ixBest = ix;
        }
    }
    return ixBest;
}


// Design a route's alignment and its profile - the least-cost alignment of a route lattice ("routeNodes") from the
// plan's start point, through the via points, to its end point. If the profile can't meet the grade limits
// (gradeFailure), the route is searched again with stricter grade penalties (a line of "lines" reports each). Returns
// the alignment's "x" and "y" coordinates and "stations", its "profile", "ground", and "sideSlope" (designProfile), its
// "existingRoads" ([station, end station] ranges), its "notes" (the report's lines for the via points it turns back
// at), and its "failure" (the last search's gradeFailure) - or null if there's no route. "pathDesigns" are the designs
// of the paths that were searched before (a map) - the searches with other grade penalty weights often find the same
// path, and a path's design is the same.
function routeAlignment(plan, topo, design, roads, routeNodes, commandArgs, lines, pathDesigns) {
    // The existing roads are the argument's ranges, or the plan's existing roads that the route follows
    const followsRoads = !commandArgs.allNew && commandArgs.existingRoads === null;
    let existingRoads = commandArgs.existingRoads ?? [];

    // Search for the horizontal alignment through the via points - each leg starts with the previous leg's heading.
    // The legs, and the searches with stricter grades, search one lattice.
    const waypoints = [[plan.start.x, plan.start.y], ...commandArgs.via, [plan.end.x, plan.end.y]];
    const {lattice} = routeNodes;
    let alignment;
    let designed;
    let failure;
    for (const [ixSearch, [softBand, gradeMargin]] of routeSearches.entries()) {
        const path = [];
        const existing = [];
        let heading = null;
        for (let ixWaypoint = 1; ixWaypoint < waypoints.length; ixWaypoint++) {
            const leg = routeSearch(
                routeNodes, design, waypoints[ixWaypoint - 1], waypoints[ixWaypoint], commandArgs.gradeWeight, heading, softBand,
                gradeMargin
            );
            if (leg === null) {
                return null;
            }
            ({heading} = leg);
            path.push(...(path.length === 0 ? leg.path : leg.path.slice(1)));
            existing.push(...(existing.length === 0 ? leg.existing : leg.existing.slice(1)));
        }

        // The route's runs along existing roads are the roads' lines - the rest is smoothed to the minimum radius
        const pathKey = `${path.join(' ')}|${existing.join('')}`;
        let pathDesign = pathDesigns.get(pathKey);
        if (pathDesign === undefined) {
            const interval = Math.max(design.stationInterval, Math.min(lattice, topo.spacing) * 0.5);
            const followed = followRoads(path, existing, roads, lattice, 2 * design.minRadius, design.minRadius);
            const smooth = smoothCurves(followed.points, interval, design.minRadius, followed.ranges);
            const pathAlignment = resamplePolyline(smooth.x, smooth.y, interval);
            const pathRoads = followsRoads ? smooth.ranges : existingRoads;
            pathDesign = {
                'alignment': pathAlignment,
                'existingRoads': pathRoads,
                'designed': designProfile(
                    topo, design, pathAlignment.x, pathAlignment.y, pathAlignment.stations, existingMask(pathAlignment.stations, pathRoads)
                )
            };
            pathDesigns.set(pathKey, pathDesign);
        }
        ({alignment, existingRoads, designed} = pathDesign);
        failure = gradeFailure(design, alignment.stations, designed, plan.units);
        if (failure === null) {
            break;
        }
        if (ixSearch < routeSearches.length - 1) {
            lines.push(`The profile ${failure} - searching with stricter grades`);
        }
    }

    // A via point the road turns back at is off its corridor - the road goes out to it and returns
    const notes = viaTurnBacks(alignment.x, alignment.y, alignment.stations, commandArgs.via, 10 * design.minRadius).map(
        ({via, station}) => `NOTE: the road turns back at the via point ${commandArgs.via[via].join(',')} (station ` +
            `${pyFixed(station, 0)}) - if it isn't a switchback you meant, move the via point along the road's corridor, or drop it`
    );
    return {...alignment, ...designed, existingRoads, notes, failure};
}


// Get a designed profile's failure to meet the grade limits - the report's text of what the profile can't do within
// them: reach an existing road's ground, or end at the end point's - or null if it meets them
function gradeFailure(design, stations, {profile, ground, unreachable}, units) {
    if (unreachable !== null) {
        return `can't reach the existing road at station ${pyFixed(stations[unreachable], 0)}`;
    }
    const endDepth = ground.at(-1) - profile.at(-1);
    return Math.abs(endDepth) <= design.tieTolerance ? null :
        `ends ${pyFixed(Math.abs(endDepth), 1)} ${units} ${endDepth > 0 ? 'below' : 'above'} the end point`;
}


// Get an existing road structure's roads' names, and its grade as it's built (it isn't designed, so it may be over
// the maximum grade) - the average "grade" of its length, in percent (null if it has no length), and the grade of its
// "steepest" minimum radius' length. "roads" is the existing roads' index, and "x", "y", "z", and "stations" are the
// road's alignment.
export function existingRoadGrades(roads, minRadius, x, y, z, stations, structure) {
    const names = [];
    const ixRoad = [];
    for (let ix = 0; ix < x.length; ix++) {
        if (stations[ix] >= structure.station && stations[ix] <= structure.endStation) {
            ixRoad.push(ix);
            const name = nearestLine(roads, x[ix], y[ix], minRadius)?.name ?? null;
            if (name !== null && !names.includes(name)) {
                names.push(name);
            }
        }
    }
    if (ixRoad.length < 2) {
        return {names, 'grade': null, 'steepest': null};
    }
    const roadGrade = (ix1, ix2) => Math.abs(z[ix2] - z[ix1]) / (stations[ix2] - stations[ix1]) * 100;
    let steepest = 0;
    let ixAhead = 0;
    for (let ixBehind = 0; ixBehind < ixRoad.length; ixBehind++) {
        while (ixAhead < ixRoad.length - 1 && stations[ixRoad[ixAhead]] - stations[ixRoad[ixBehind]] < minRadius) {
            ixAhead += 1;
        }
        if (stations[ixRoad[ixAhead]] - stations[ixRoad[ixBehind]] >= minRadius) {
            steepest = Math.max(steepest, roadGrade(ixRoad[ixBehind], ixRoad[ixAhead]));
        }
    }
    return {names, 'grade': roadGrade(ixRoad[0], ixRoad.at(-1)), steepest};
}


// Create an option's report lines - its length, the new road's grades and depths, its existing roads (with the roads'
// names and grades), its structures' counts, its cost score and design warnings, and notes if the road is along the
// site's edge, or it crosses unmapped draws
function optionReport(plan, topo, design, roads, option, designed, existingRoads) {
    const {units} = plan;
    const {x, y, stations, profile, ground} = designed;
    const {structures} = option;
    const last = x.length - 1;
    const lines = [];
    const mask = existingMask(stations, existingRoads);
    let maxGrade = -Infinity;
    let maxDepth = -Infinity;
    let minDepth = Infinity;
    for (let ix = 0; ix <= last; ix++) {
        if (ix > 0) {
            const grade = mask[ix] && mask[ix - 1] ? 0 : Math.abs(profile[ix] - profile[ix - 1]) / (stations[ix] - stations[ix - 1]) * 100;
            maxGrade = Math.max(maxGrade, grade);
        }
        maxDepth = Math.max(maxDepth, ground[ix] - profile[ix]);
        minDepth = Math.min(minDepth, ground[ix] - profile[ix]);
    }
    lines.push(
        `Option "${option.name}": ${pyFixed(stations[last], 0)} ${units} long, ${x.length} alignment points, ` +
        `max grade ${pyFixed(maxGrade, 1)}%, max cut ${pyFixed(Math.max(0, maxDepth), 1)}, max fill ${pyFixed(Math.max(0, -minDepth), 1)}`
    );
    for (const structure of structures.filter(({type}) => type === 'existingRoad')) {
        const {names, grade, steepest} = existingRoadGrades(roads, design.minRadius, x, y, profile, stations, structure);
        const gradeText = grade === null ? '' : ` - its grade averages ${pyFixed(grade, 1)}%` +
            `${steepest > grade ? `, ${pyFixed(steepest, 1)}% over its steepest ${formatNumber(design.minRadius)} ${units}` : ''}`;
        lines.push(
            `Existing road: stations ${pyFixed(structure.station, 1)} to ${pyFixed(structure.endStation, 1)}` +
            `${names.length > 0 ? ` (${names.join(', ')})` : ''}${gradeText}`
        );
    }
    const counts = [];
    for (const [type, name] of Object.entries(structureNames)) {
        const count = structures.filter((structure) => structure.type === type).length;
        if (count > 0) {
            counts.push(`${count} ${name}${count === 1 ? '' : 's'}`);
        }
    }
    lines.push(`Structures: ${counts.join(', ') || 'none'}`);
    const analysis = analyzeOption(plan, plan.options.indexOf(option), topo);
    lines.push(`Cost score: ${formatNumber(analysis.score, 1)}, design warnings: ${analysis.warnings.length}`);

    // A road within its minimum radius of the site's edge has no room there - the site may be too small for it
    const ixEdge = edgeStation(topo, design, x, y);
    if (ixEdge !== null) {
        const distance = Math.min(x[ixEdge], y[ixEdge], topo.width - x[ixEdge], topo.height - y[ixEdge]);
        lines.push(
            `NOTE: the road is ${pyFixed(Math.max(0, distance), 0)} ${units} from the site's edge at station ` +
            `${pyFixed(stations[ixEdge], 0)} - the site may be too small for the best route (the site model's "margin")`
        );
    }

    // A draw that isn't a stream of the plan has no culvert where the road crosses it
    const crossings = drawCrossings(topo, units, x, y, stations, mask);
    if (crossings.length > 0) {
        const texts = crossings.map((crossing) => (
            `draw ${crossing.number} (${drawAreaText(units, crossing.area)}) at station ${pyFixed(crossing.station, 0)} ` +
            `(${pyFixed(crossing.x, 0)},${pyFixed(crossing.y, 0)})`
        ));
        lines.push(
            `NOTE: the road crosses ${crossings.length === 1 ? 'an unmapped draw' : `${crossings.length} unmapped draws`} - ` +
            `${texts.join(', ')} - a draw that carries water needs a culvert (a plan's run adds it as a stream, and engineers ` +
            'the road again)'
        );
    }
    return lines;
}


// The structure types' names, in the report's order
const structureNames = {
    'existingRoad': 'existing road', 'bridge': 'bridge', 'culvert': 'culvert', 'retainingWall': 'retaining wall', 'turnout': 'turnout'
};
