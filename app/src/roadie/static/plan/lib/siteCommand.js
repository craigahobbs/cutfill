// siteCommand.js - the "site" command - create a road plan's site from a road site model: its topography, from the
// USGS 3D Elevation Program's 1 meter elevation models, its georeference, its start and end points, its features
// (the USGS National Map's streams, roads, and trails, and the site's exclusion areas), and its topographic map image

import {elevationModels, roadLines, streamLines, topoMapImageUrl, trailLines} from './usgs.js';
import {exclusionFeatures, exclusionNames, lineFeatures, snapDistance, snapStreams} from './features.js';
import {
    isLayoutGrid, isLayoutPlan, layoutBox, layoutGeoreference, layoutLatLong, layoutSize, readTile, siteLayout, siteTerrain
} from './terrain.js';
import {elevation as planElevation, planTopo, validateSite} from '../../viewer/lib/model.js';
import {latLongText} from '../../viewer/lib/geo.js';
import {nearestText} from './roads.js';
import {round} from '../../viewer/lib/format.js';
import {writePlan} from './planFile.js';


// The "site" command's usage text lines
export const siteUsage = [
    'usage: plan site <site.json> <plan.json> [--fetch]',
    '',
    '  Create a road plan model\'s site from a road site model - its topography, from the USGS 3D Elevation Program\'s',
    '  1 meter elevation models, its georeference, its start and end points, its streams, roads, and exclusion areas,',
    '  and its topographic map image ("<plan>.png"). An existing plan\'s options are kept, and the features that were',
    '  added to it (the "feature" and "draws" commands\'). If the existing plan\'s grid is the site\'s - the same points,',
    '  units, margin, and spacing - its site\'s data (its terrain, streams, roads, trails, and map) is kept, and the',
    '  USGS\'s services aren\'t asked for it again, unless "--fetch" is given. A plan\'s design criteria and cost rates',
    '  are the site\'s. If there\'s no site file, it\'s written from the plan\'s own site model.'
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
    const readText = (path) => {
        try {
            return io.readFile(path);
        } catch {
            return null;
        }
    };

    // The existing plan, if any
    let plan = {};
    const planFile = readText(planPath);
    if (planFile !== null) {
        try {
            plan = JSON.parse(planFile);
        } catch {
            return error([`error: Could not load the road plan "${planPath}"`]);
        }
    }

    // Load and validate the road site model - if there's no file, it's written from the plan's own site model
    const siteLines = [];
    let siteFile = readText(sitePath);
    if (siteFile === null && (plan?.site ?? null) !== null) {
        siteFile = `${JSON.stringify(plan.site, null, 4)}\n`;
        io.writeFile(sitePath, siteFile);
        siteLines.push(`Wrote ${sitePath} - the plan's road site model`);
    }
    let siteValue = null;
    try {
        siteValue = JSON.parse(siteFile);
    } catch {
        // The file isn't JSON
    }
    if (siteFile === null || siteValue === null) {
        return error([`error: Could not load the road site "${sitePath}"`]);
    }
    const validated = validateSite(siteValue);
    if ('error' in validated) {
        return error([`error: The road site "${sitePath}" is invalid:`, '', validated.error]);
    }
    const {site} = validated;
    const {units} = site;

    // An existing plan is the site's - its projection center and its units are the site's
    const layout = siteLayout(site);
    const isSited = plan !== null && typeof plan === 'object' && 'topography' in plan;
    if (isSited && !isLayoutPlan(layout, plan)) {
        return error([
            `error: The road plan "${planPath}" isn't a plan of this site - its georeference's center, or its units, aren't the ` +
                'site\'s. Plan the site again (remove the plan), or restore its start and end points and its units.'
        ]);
    }

    // The plan's site data is kept, if its grid is the site's - unless it's fetched again
    if (!isFetch && isSited && isLayoutGrid(layout, plan)) {
        const kept = keepSite(io, planPath, plan, site, layout);
        return {...kept, 'lines': [...siteLines, ...kept.lines]};
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

    // The streams are moved to the bottoms of the terrain's valleys
    const streamTopo = planTopo({'topography': {spacing, elevations}});
    const snapped = snapStreams(layout, streams, (x, y) => planElevation(streamTopo, x, y));
    ({streams} = snapped);

    // The features - the site's streams, roads, trails, and exclusion areas, and the plan's other features: its rock
    // outcrops, its exclusion areas that aren't the site's, and the streams, roads, and trails that were added to it
    const exclusions = exclusionFeatures(layout, site);
    const siteNames = siteExclusionNames(plan, site);
    const kept = (shifted.topography?.features ?? []).filter(({type, name, added = false}) => (
        type === 'rock' || (type === 'exclusion' ? !siteNames.has(name) : added)
    ));
    const features = [...streams, ...roads, ...trails, ...exclusions, ...kept];

    // Update the plan
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
    plan = sitePlan(shifted, site, layout, {...(image !== null ? {image} : {}), units, georeference, topography});
    writePlan(io, planPath, plan);

    // Report
    const lines = [
        ...siteLines,
        `Grid: ${nCols} x ${nRows} at ${spacing} ${units} spacing ` +
            `(${layoutSize(layout).map(Math.round).join(' x ')} ${units}), a margin of ${Math.round(layout.margin)} ${units}`,
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


// Get the names of the exclusion areas that are a site's - the site's, and those of the site that the plan was made
// from. A plan's other exclusion areas are its own.
function siteExclusionNames(plan, site) {
    return new Set([...exclusionNames(plan.site ?? {}), ...exclusionNames(site)]);
}


// Set a plan's members that are its site's - its title, its points, its design criteria and cost rates (the site's,
// or none), and its site model - with the plan's other "members"
function sitePlan(plan, site, layout, members) {
    const sited = {
        ...plan, ...members, 'title': site.title, 'start': layout.start, 'end': layout.end, 'options': plan.options ?? [], site
    };
    for (const member of ['criteria', 'costRates']) {
        if (member in site) {
            sited[member] = site[member];
        } else {
            delete sited[member];
        }
    }
    return sited;
}


// Keep a plan's site data - its terrain, streams, roads, trails, and map - for the site: its title, points' labels,
// exclusion areas, criteria, and cost rates are the site's. Returns the command's result.
function keepSite(io, planPath, plan, site, layout) {
    const exclusions = exclusionFeatures(layout, site);
    const siteNames = siteExclusionNames(plan, site);
    const features = (plan.topography.features ?? []).filter(({type, name}) => type !== 'exclusion' || !siteNames.has(name));
    const keptPlan = sitePlan(plan, site, layout, {'topography': {...plan.topography, 'features': [...features, ...exclusions]}});
    writePlan(io, planPath, keptPlan);
    return {'code': 0, 'lines': [
        'Site: the plan\'s site data is kept - its terrain, streams, roads, trails, and map (its grid is the site\'s - fetch ' +
            'them again with --fetch)',
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


// Move an existing plan (a plan of the site) to a new grid's coordinates - its features' and options' points are
// shifted by the grids' origins' difference. Returns the plan ("plan") and the distances its coordinates moved
// ("moved"). A plan that isn't sited yet has no coordinates.
function shiftPlan(plan, georeference) {
    const planGeoreference = plan.georeference ?? null;
    if (planGeoreference === null) {
        return {plan, 'moved': [0, 0]};
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
