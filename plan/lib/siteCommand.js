// siteCommand.js - the "site" command - create a road plan's site from a road site model: its topography, from the
// USGS 3D Elevation Program's 1 meter elevation models, its georeference, its start and end points, its features
// (the USGS National Map's streams, roads, and trails, and the site's exclusion areas), and its topographic map image

import {elevationModels, roadLines, streamLines, topoMapImageUrl, trailLines} from './usgs.js';
import {exclusionFeatures, lineFeatures, snapDistance, snapStreams} from './features.js';
import {layoutBox, layoutGeoreference, layoutLatLong, layoutSize, readTile, siteLayout, siteTerrain} from './terrain.js';
import {orderPlan, planText} from './planFile.js';
import {elevation as planElevation, planTopo} from '../../viewer/lib/model.js';
import {latLongText} from '../../viewer/lib/geo.js';
import {nearestText} from './roads.js';
import {round} from '../../viewer/lib/format.js';
import {validateSite} from './site.js';


// The "site" command's usage text lines
export const siteUsage = [
    'usage: plan site <site.json> <plan.json> [--fetch]',
    '',
    '  Create a road plan model\'s site from a road site model - its topography, from the USGS 3D Elevation Program\'s',
    '  1 meter elevation models, its georeference, its start and end points, its streams, roads, and exclusion areas,',
    '  and its topographic map image ("<plan>.png"). An existing plan\'s options are kept, and the features that were',
    '  added to it (the "feature" and "draws" commands\'). If the existing plan\'s site is the site - the same points,',
    '  units, margin, and spacing - its site\'s data (its terrain, streams, roads, trails, and map) is kept, and the',
    '  USGS\'s services aren\'t asked for it again, unless "--fetch" is given.'
];


// The topographic map image's longer side, in pixels
const imageSize = 2000;


// The elevations' decimal places - a hundredth of a meter, or a tenth of a foot
const elevationDigits = {'feet': 1, 'meters': 2};


// The "site" command - "io" is the tools' input and output functions. Returns the command's exit code and its
// output text lines, or null if its arguments are invalid.
export async function siteCommand(args, io) {
    const isFetch = args.includes('--fetch');
    const positionals = args.filter((arg) => arg !== '--fetch');
    if (positionals.length !== 2 || positionals.some((arg) => arg.startsWith('-'))) {
        return null;
    }
    const [sitePath, planPath] = positionals;
    const error = (lines) => ({'code': 1, 'lines': lines});

    // Load and validate the road site model
    let siteValue;
    try {
        siteValue = JSON.parse(io.readFile(sitePath));
    } catch {
        return error([`error: Could not load the road site "${sitePath}"`]);
    }
    const validated = validateSite(siteValue);
    if ('error' in validated) {
        return error([`error: The road site "${sitePath}" is invalid:`, '', validated.error]);
    }
    const {site} = validated;
    const {units} = site;

    // The existing plan, if any
    let plan = {};
    let planFile = null;
    try {
        planFile = io.readFile(planPath);
    } catch {
        // There is no plan yet
    }
    if (planFile !== null) {
        try {
            plan = JSON.parse(planFile);
        } catch {
            return error([`error: Could not load the road plan "${planPath}"`]);
        }
    }

    // The plan's site data is kept, if its site is the site - unless it's fetched again
    const layout = siteLayout(site);
    if (!isFetch && isPlanSite(plan, site)) {
        return keepSite(io, planPath, plan, site, layout);
    }

    // The topography - the site's elevation model tiles are cached in the plan's work directory - and the streams
    const planBase = planPath.replace(/\.json$/i, '');
    const directory = `${planBase}.work/terrain`;
    const box = layoutBox(layout);
    let terrain;
    let streams;
    try {
        const models = await elevationModels(io.getJson, box);
        terrain = await siteTerrain(layout, models, (model, region) => readTile(io, directory, model, layout, region));
        streams = lineFeatures(layout, 'stream', await streamLines(io.getJson, box));
    } catch ({message}) {
        return error([`error: ${message}`]);
    }

    // The roads and trails, and the topographic map image - the plan is made without them. The roads are existing
    // roads that a road option may follow, and the trails are for reference.
    const warnings = [];
    let roads = [];
    let trails = [];
    try {
        roads = lineFeatures(layout, 'road', await roadLines(io.getJson, box));
        trails = lineFeatures(layout, 'trail', await trailLines(io.getJson, box));
    } catch ({message}) {
        warnings.push(`warning: The site has no roads or trails - ${message}`);
    }
    const {nCols, nRows, spacing} = layout;
    const imagePath = `${planBase}.png`;
    let image = null;
    try {
        const [south, west] = layoutLatLong(layout, 0, 0);
        const [north, east] = layoutLatLong(layout, ...layoutSize(layout));
        const aspect = (nRows - 1) / (nCols - 1);
        const imageUrl = topoMapImageUrl(
            [west, south, east, north].map((degrees) => round(degrees, 6)),
            Math.round(imageSize * Math.min(1, 1 / aspect)),
            Math.round(imageSize * Math.min(1, aspect))
        );
        io.writeBytes(imagePath, await io.getBytes(imageUrl));
        image = imagePath.slice(imagePath.lastIndexOf('/') + 1);
    } catch ({message}) {
        warnings.push(`warning: The site has no topographic map image - ${message}`);
    }

    // The elevation rows, in plan units
    const digits = elevationDigits[units];
    const elevations = [];
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let row = 0; row < nRows; row++) {
        const values = [];
        for (let col = 0; col < nCols; col++) {
            const elevation = round(terrain.elevations[row * nCols + col] / layout.scale, digits);
            minZ = Math.min(minZ, elevation);
            maxZ = Math.max(maxZ, elevation);
            values.push(elevation);
        }
        elevations.push(values);
    }

    // An existing plan's options and features are in its coordinates - they're moved to the new grid's
    const georeference = layoutGeoreference(layout);
    const {'plan': shifted, moved} = shiftPlan(plan, georeference);
    if (shifted === null) {
        return error([
            `error: The road plan "${planPath}" isn't a plan of this site - its georeference's center isn't the site's. ` +
                'Plan the site again (remove the plan), or restore its start and end points.'
        ]);
    }

    // The streams are moved to the bottoms of the terrain's valleys
    const streamTopo = planTopo({'topography': {spacing, elevations}});
    const snapped = snapStreams(layout, streams, (x, y) => planElevation(streamTopo, x, y));
    ({streams} = snapped);

    // The features - the site's streams, roads, trails, and exclusion areas, and the plan's other features: its rock
    // outcrops, its exclusion areas that aren't the site's, and the streams, roads, and trails that were added to it
    const exclusions = exclusionFeatures(layout, site);
    const exclusionNames = new Set(exclusions.map(({name}) => name));
    const kept = (shifted.topography?.features ?? []).filter(({type, name, added = false}) => (
        type === 'rock' || (type === 'exclusion' ? !exclusionNames.has(name) : added)
    ));
    const features = [...streams, ...roads, ...trails, ...exclusions, ...kept];

    // Update the plan
    const {start, end} = layout;
    const topography = {
        ...shifted.topography,
        spacing,
        elevations,
        'contourInterval': rangeContourInterval(maxZ - minZ, units),
        'sources': terrain.surveys.map(({name, date, url}) => ({
            'name': `USGS 3D Elevation Program 1 meter elevation model ${name}`, ...(date !== '' ? {date} : {}), url
        })),
        features
    };
    plan = orderPlan({
        ...shifted,
        'title': site.title,
        ...(image !== null ? {image} : {}),
        units,
        georeference,
        topography,
        start,
        end,
        ...('criteria' in site ? {'criteria': site.criteria} : {}),
        ...('costRates' in site ? {'costRates': site.costRates} : {}),
        'options': shifted.options ?? [],
        site
    });
    io.writeFile(planPath, planText(plan));

    // Report
    const lines = [
        `Grid: ${nCols} x ${nRows} at ${spacing} ${units} spacing ` +
            `(${layoutSize(layout).map(Math.round).join(' x ')} ${units})`,
        `Elevations: ${minZ.toFixed(1)} to ${maxZ.toFixed(1)} ${units}, contours every ${topography.contourInterval} ${units}`
    ];
    for (const {name, date} of terrain.surveys) {
        lines.push(`Elevation model: ${name}${date !== '' ? ` (${date})` : ''}`);
    }
    if (terrain.filled > 0) {
        lines.push(`Grid points without an elevation, filled from the points around them: ${terrain.filled}`);
    }
    lines.push(
        `Features: ${featureCount(streams, 'stream')}, ${featureCount(roads, 'road')}, ${featureCount(trails, 'trail')}, ` +
            `${featureCount(exclusions, 'exclusion area')}`
    );
    if (streams.length > 0) {
        lines.push(`Streams: moved to the lowest ground within ${Math.round(snapDistance / layout.scale)} ${units} across them - ` +
            `a median of ${snapped.median.toFixed(1)} ${units}`);
    }
    if (kept.length > 0) {
        const counts = Object.entries(featureNames).map(([type, name]) => [kept.filter((feature) => feature.type === type), name]);
        lines.push(
            'Kept the plan\'s other features: ' +
            `${counts.filter(([typeFeatures]) => typeFeatures.length > 0).map((count) => featureCount(...count)).join(', ')}`
        );
    }
    if (moved.some((distance) => distance !== 0)) {
        lines.push(`The plan's coordinates moved ${moved.join(', ')} ${units} - its options and other features moved with them`);
    }
    if (image !== null) {
        lines.push(`Topographic map image: ${imagePath}`);
    }
    lines.push(...warnings, ...pointLines(plan, layout), `Wrote ${planPath}`);
    return {'code': 0, lines};
}


// Report a plan's start and end points - their latitudes and longitudes, their ground elevations, and the features
// nearest them
function pointLines(plan, layout) {
    const topo = planTopo(plan);
    return [['start', plan.start], ['end', plan.end]].map(([name, point]) => {
        const ground = planElevation(topo, point.x, point.y);
        return `${name}: "${point.label}" (${point.x}, ${point.y}) at ${latLongText(layoutLatLong(layout, point.x, point.y))}, ` +
            `ground ${ground.toFixed(1)}${nearestText(plan.topography.features, plan.units, point.x, point.y)}`;
    });
}


// Is a plan's site the site - the same points, units, margin, and spacing? Its site's data is the site's, then.
function isPlanSite(plan, site) {
    const planSite = plan.site ?? null;
    const isSamePoint = (point1, point2) => point1.latitude === point2.latitude && point1.longitude === point2.longitude;
    return planSite !== null && 'topography' in plan && 'georeference' in plan && planSite.units === site.units &&
        isSamePoint(planSite.start, site.start) && isSamePoint(planSite.end, site.end) && planSite.margin === site.margin &&
        planSite.spacing === site.spacing;
}


// Keep a plan's site data - its terrain, streams, roads, trails, and map - for the site: its title, points' labels,
// exclusion areas, criteria, and cost rates are the site's. Returns the command's result.
function keepSite(io, planPath, plan, site, layout) {
    // The site's exclusion areas replace the plan's site's
    const exclusions = exclusionFeatures(layout, site);
    const exclusionNames = new Set([...exclusionFeatures(layout, plan.site), ...exclusions].map(({name}) => name));
    const features = (plan.topography.features ?? []).filter(({type, name}) => type !== 'exclusion' || !exclusionNames.has(name));
    const keptPlan = orderPlan({
        ...plan,
        'title': site.title,
        'topography': {...plan.topography, 'features': [...features, ...exclusions]},
        'start': layout.start,
        'end': layout.end,
        ...('criteria' in site ? {'criteria': site.criteria} : {}),
        ...('costRates' in site ? {'costRates': site.costRates} : {}),
        'options': plan.options ?? [],
        site
    });
    io.writeFile(planPath, planText(keptPlan));
    return {'code': 0, 'lines': [
        'Site: the plan\'s site data is kept - its terrain, streams, roads, trails, and map (its site has the same points, ' +
            'units, margin, and spacing - fetch them again with --fetch)',
        `Features: ${featureCount(exclusions, 'exclusion area')} from the site`,
        ...pointLines(keptPlan, layout),
        `Wrote ${planPath}`
    ]};
}


// The feature types' names, in the report's order
const featureNames = {'stream': 'stream', 'road': 'road', 'trail': 'trail', 'rock': 'rock outcrop', 'exclusion': 'exclusion area'};


// Describe a count of features
function featureCount(features, name) {
    return `${features.length} ${name}${features.length === 1 ? '' : 's'}`;
}


// The contour intervals, in feet and meters
const contourIntervals = {'feet': [1, 2, 5, 10, 20, 40, 100, 200], 'meters': [0.5, 1, 2, 5, 10, 20, 50, 100]};


// Choose a topography's contour interval for its elevation range - about 40 contours, at most
export function rangeContourInterval(range, units) {
    const intervals = contourIntervals[units];
    return intervals.find((interval) => range / interval <= 40) ?? intervals.at(-1);
}


// Move an existing plan to a new grid's coordinates - its features' and options' points are shifted by the grids'
// origins' difference. Returns the plan ("plan" - null if its georeference's center isn't the new georeference's) and
// the distances its coordinates moved ("moved").
function shiftPlan(plan, georeference) {
    const planGeoreference = plan.georeference ?? null;
    if (planGeoreference === null) {
        return {'plan': 'topography' in plan ? null : plan, 'moved': [0, 0]};
    }
    if (planGeoreference.latitude !== georeference.latitude || planGeoreference.longitude !== georeference.longitude) {
        return {'plan': null, 'moved': [0, 0]};
    }
    const dx = georeference.x - planGeoreference.x;
    const dy = georeference.y - planGeoreference.y;
    const shift = (point) => ({...point, 'x': round(point.x + dx, 2), 'y': round(point.y + dy, 2)});
    const shifted = {...plan};
    if ('features' in plan.topography) {
        shifted.topography = {
            ...plan.topography,
            'features': plan.topography.features.map((feature) => ({...feature, 'points': feature.points.map(shift)}))
        };
    }
    if ('options' in plan) {
        shifted.options = plan.options.map((option) => ({...option, 'alignment': option.alignment.map(shift)}));
    }
    return {'plan': shifted, 'moved': [round(dx, 2), round(dy, 2)]};
}
