// draft.js - a draft of a road plan model's descriptions: the facts of the plan and of each option that the tools know,
// and what a plan's run adds to them

import {analyzeOption, culvertDiameter, planCriteria, planTopo} from '../../viewer/lib/model.js';
import {displayQuantity, fixedTrim, station as formatStation, number, unitLabel} from '../../viewer/lib/format.js';
import {existingRoadGrades} from './routeCli.js';
import {groundElevation} from './design.js';
import {lineIndex} from './roads.js';
import {polylineStations} from './route.js';


// The added features' types, and their names in the draft
const featureTypeNames = {
    'stream': 'Streams', 'road': 'Existing roads', 'trail': 'Trails', 'rock': 'Rock outcrops', 'exclusion': 'Exclusion areas'
};


// The structure types' names, in the draft's order (an existing road has its own lines)
const structureTypeNames = {'bridge': 'bridge', 'culvert': 'culvert', 'retainingWall': 'retaining wall', 'turnout': 'turnout'};


// The number of an option's largest cost items in the draft, the number of its cost items that are most of its cost's
// difference from the least-cost option's, and the most structures of a type that it lists
const costItemCount = 3;
const differenceItemCount = 2;
const structureLimit = 6;


// Describe the cost items that are an option's largest cost differences from the least-cost option ("analysis" and
// "least" are their analyzeOption analyses) - its items that cost the most more than the least-cost option's, in
// thousands (as the cost score is). An item is matched by its name without its count, and an item without a quantity
// (mobilization - a part of the others' cost) or that's less than a twentieth of the difference isn't one. Returns the
// text (it begins with a space), or "" if there are none.
function costDifference(analysis, least) {
    const itemName = (name) => name.replace(/ \(\d+\)$/, '');
    const leastCosts = new Map(least.costs.map(({name, cost}) => [itemName(name), cost]));
    const difference = (analysis.score - least.score) * 1000;
    const items = analysis.costs.filter(({quantity}) => quantity !== null).
        map(({name, cost}) => ({'name': itemName(name), 'more': cost - (leastCosts.get(itemName(name)) ?? 0)})).
        filter(({more}) => more > 0.05 * difference).sort((first, second) => second.more - first.more).slice(0, differenceItemCount);
    if (items.length === 0) {
        return '';
    }
    const texts = items.map(({name, more}) => `${name.toLowerCase()} ${number(more / 1000, 1)} more`);
    return ` Its largest cost difference${texts.length === 1 ? '' : 's'}: ${texts.join(', ')}.`;
}


// The compass directions' names, counterclockwise from east, and the most runs of a road's line
const directionNames = ['east', 'northeast', 'north', 'northwest', 'west', 'southwest', 'south', 'southeast'];
const lineRunCount = 5;
const lineSamples = 24;


// Describe a road's line - the compass directions it runs in, from its start to its end, and how far it runs in each.
// "x", "y", and "stations" are the road's alignment. The line is sampled in equal lengths, and its short runs are
// merged into their longer neighbors - so it's the road's general way, not its every curve. Returns the runs: each
// run's "direction" name and its "length".
export function lineRuns(x, y, stations) {
    const length = stations.at(-1);
    const pointAt = (stationValue) => {
        let ix = 1;
        while (ix < stations.length - 1 && stations[ix] < stationValue) {
            ix += 1;
        }
        const fraction = (stationValue - stations[ix - 1]) / Math.max(stations[ix] - stations[ix - 1], 1e-9);
        return [x[ix - 1] + (x[ix] - x[ix - 1]) * fraction, y[ix - 1] + (y[ix] - y[ix - 1]) * fraction];
    };

    // The samples' directions - consecutive samples of a direction are a run
    const runs = [];
    const addRun = (direction, runLength) => {
        if (runs.length > 0 && runs.at(-1).direction === direction) {
            runs.at(-1).length += runLength;
        } else {
            runs.push({direction, 'length': runLength});
        }
    };
    for (let ixSample = 0; ixSample < lineSamples; ixSample++) {
        const [x1, y1] = pointAt(length * ixSample / lineSamples);
        const [x2, y2] = pointAt(length * (ixSample + 1) / lineSamples);
        const direction = ((Math.round(Math.atan2(y2 - y1, x2 - x1) / (Math.PI / 4)) % 8) + 8) % 8;
        addRun(directionNames[direction], length / lineSamples);
    }

    // Merge the shortest run into its longer neighbor, while there are too many runs or it's a short one
    for (;;) {
        let ixShort = 0;
        for (let ix = 1; ix < runs.length; ix++) {
            if (runs[ix].length < runs[ixShort].length) {
                ixShort = ix;
            }
        }
        if (runs.length === 1 || (runs.length <= lineRunCount && runs[ixShort].length >= 0.1 * length)) {
            break;
        }
        const ixInto = ixShort === 0 || (ixShort < runs.length - 1 && runs[ixShort + 1].length > runs[ixShort - 1].length) ?
            ixShort + 1 : ixShort - 1;
        runs[ixInto].length += runs[ixShort].length;
        const merged = runs.splice(0, runs.length).filter((run, ix) => ix !== ixShort);
        for (const run of merged) {
            addRun(run.direction, run.length);
        }
    }
    return runs;
}


// Create the draft's Markdown lines of a plan. "additions" are what a planning process adds to the plan's facts: the
// road's "purpose" (a paragraph, or null), its "featureNotes" (a line for each feature it added), its "optionNotes"
// (sentences about its options), and its "limitations" (sentences).
export function draftLines(plan, {purpose = null, featureNotes = [], optionNotes = [], limitations = []} = {}) {
    const {units} = plan;
    const topo = planTopo(plan);
    const criteria = planCriteria(plan);
    const lengthText = (value, digits = 0) => `${number(value, digits)} ${units}`;
    const stationText = (value) => formatStation(value, units);
    const gradeText = (value) => `${fixedTrim(value, 1)}%`;

    // The site - the start and end points, and the straight line between them
    const pointText = ({x, y, label = null}, name) => (
        `${label !== null ? `"${label}"` : `the ${name} point`} (elevation ${lengthText(groundElevation(topo, x, y))})`
    );
    const climb = groundElevation(topo, plan.end.x, plan.end.y) - groundElevation(topo, plan.start.x, plan.start.y);
    const distance = Math.hypot(plan.end.x - plan.start.x, plan.end.y - plan.start.y);
    const straightGrade = Math.abs(climb) / Math.max(distance, 1e-9) * 100;
    const lines = [
        '# Plan',
        '',
        ...(purpose !== null ? [purpose, ''] : []),
        `**The site.** From ${pointText(plan.start, 'start')} to ${pointText(plan.end, 'end')}. The straight line between them ` +
            `${climb < 0 ? 'descends' : 'climbs'} ${lengthText(Math.abs(climb))} in ${lengthText(distance)} (${gradeText(straightGrade)})` +
            `${straightGrade > criteria.maxGrade ? ' - steeper than the maximum grade, so a road is longer than the straight line' : ''}.`,
        '',
        `**Design criteria.** Maximum grade ${gradeText(criteria.maxGrade)}, minimum curve radius ${lengthText(criteria.minRadius)}, ` +
            `maximum retaining wall height ${lengthText(criteria.maxWallHeight)}.`
    ];

    // The features that were added to the site, and its places to pass through
    const added = topo.features.filter((feature) => feature.added ?? false);
    const places = (plan.site?.passThrough ?? []).map(({name = null}, ixPlace) => name ?? `Place ${ixPlace + 1}`);
    if (added.length > 0 || places.length > 0) {
        lines.push('', '**Features added to the site.** They aren\'t the USGS\'s - verify them in the field:', '');
        for (const [type, typeName] of Object.entries(featureTypeNames)) {
            const features = added.filter((feature) => feature.type === type);
            if (features.length > 0) {
                const names = [...new Set(features.filter(({name = null}) => name !== null).map(({name}) => name))];
                const unnamed = features.filter(({name = null}) => name === null).length;
                lines.push(`- ${typeName}: ${[...names, ...(unnamed > 0 ? [`${unnamed} unnamed`] : [])].join(', ')}`);
            }
        }
        if (places.length > 0) {
            lines.push(`- Places to pass through: ${places.join(', ')}`);
        }
        if (featureNotes.length > 0) {
            lines.push('', ...featureNotes.map((note) => `- ${note}`));
        }
    }
    if (optionNotes.length > 0) {
        lines.push('', `**Options.** ${optionNotes.join(' ')}`);
    }
    lines.push(
        '',
        '**Limitations.** The terrain is the USGS 3D Elevation Program\'s lidar ground elevations, and the streams, roads, and trails ' +
            'are the USGS National Map\'s. What they lack - buildings, property lines, utilities, and unmapped roads and drainages - ' +
            'isn\'t in the plan unless it was added. Turnarounds aren\'t modeled. The cost scores compare the options - they aren\'t ' +
            `bid estimates.${limitations.map((limitation) => ` ${limitation}`).join('')}`
    );

    // The options
    const roads = lineIndex(topo.features, 'road', Math.max(topo.spacing, criteria.minRadius) * 2);
    const analyses = plan.options.map((option, ixOption) => analyzeOption(plan, ixOption, topo));
    const ixLeast = analyses.reduce((ixBest, analysis, ix) => (analysis.score < analyses[ixBest].score ? ix : ixBest), 0);
    plan.options.forEach((option, ixOption) => {
        const analysis = analyses[ixOption];
        const {section} = option;
        const structures = option.structures ?? [];
        const least = analyses[ixLeast];
        const more = number((analysis.score / least.score - 1) * 100, 0);
        const costText = ixOption === ixLeast ? 'The least-cost option' :
            `It costs ${more === '0' ? 'the same as' : `${more}% more than`} the least-cost option, "${least.name}"`;
        lines.push(
            '',
            `# Option: ${option.name}`,
            '',
            `${costText} - its cost score is ${number(analysis.score, 1)}.${ixOption === ixLeast ? '' : costDifference(analysis, least)} ` +
                `It's ${lengthText(analysis.length)} long and ` +
                `${lengthText(section.width, section.width % 1 === 0 ? 0 : 1)} wide, ${section.surface ?? 'gravel'}, and ` +
                `${analysis.existingLength > 0 ? 'its new road\'s' : 'its'} maximum grade is ${gradeText(analysis.maxGrade)}.`,
            ''
        );

        // The existing roads it follows - their names, and their grades as they're built
        const alignmentX = option.alignment.map((point) => point.x);
        const alignmentY = option.alignment.map((point) => point.y);
        const alignmentZ = analysis.alignment.map((point) => point.z);
        const stations = polylineStations(alignmentX, alignmentY);
        const runTexts = lineRuns(alignmentX, alignmentY, stations).map(({direction, length}) => (
            `${direction} for about ${lengthText(Math.round(length / 10) * 10)}`
        ));
        lines.push(
            `- **Line.** From the start, it runs ${runTexts.slice(0, -1).join(', ')}` +
            `${['', '', ' and ', ', and '][Math.min(runTexts.length, 3)]}${runTexts.at(-1)} to the end.`
        );
        const existingRoads = structures.filter(({type}) => type === 'existingRoad');
        for (const structure of existingRoads) {
            const {names, grade, steepest} = existingRoadGrades(
                roads, criteria.minRadius, alignmentX, alignmentY, alignmentZ, stations, structure
            );
            const over = grade !== null && Math.max(grade, steepest) > criteria.maxGrade;
            lines.push(
                `- **Existing road.** It follows ${names.length > 0 ? names.join(', ') : 'an existing road'} for ` +
                `${lengthText(structure.endStation - structure.station)} (stations ${stationText(structure.station)} to ` +
                `${stationText(structure.endStation)})${grade === null ? '' : ` - as built, its grade averages ${gradeText(grade)}` +
                    `${steepest > grade ? `, and ${gradeText(steepest)} over its steepest ${lengthText(criteria.minRadius)}` : ''}` +
                    `${over ? `, which is over the ${gradeText(criteria.maxGrade)} maximum grade` : ''}`}.`
            );
        }
        if (existingRoads.length > 0) {
            lines.push(
                '- **Existing road upgrade.** An existing road is costed as an upgrade, with no earthwork - verify its width, grade, ' +
                'and surface in the field.'
            );
        }

        // Its structures - the bridges, culverts, and walls with their stations
        const structureTexts = [];
        for (const [type, typeName] of Object.entries(structureTypeNames)) {
            const typeStructures = structures.filter((structure) => structure.type === type);
            if (typeStructures.length > 0) {
                const details = type === 'turnout' ? '' : ` (${typeStructures.slice(0, structureLimit).map((structure) => {
                    const name = structure.name ?? null;
                    const size = type === 'culvert' ?
                        `, ${Number(culvertDiameter(units, structure).toFixed(2))} ${unitLabel(units, 'length')}` : '';
                    const place = type === 'culvert' ? `station ${stationText(structure.station)}` :
                        `stations ${stationText(structure.station)} to ${stationText(structure.endStation)}`;
                    return `${name !== null ? `${name}, ` : ''}${place}${size}`;
                }).join('; ')}${typeStructures.length > structureLimit ? '; ...' : ''})`;
                structureTexts.push(`${typeStructures.length} ${typeName}${typeStructures.length === 1 ? '' : 's'}${details}`);
            }
        }
        lines.push(`- **Structures.** ${structureTexts.length > 0 ? structureTexts.join(', ') : 'None'}.`);

        // Its earthwork - the volumes, and the deepest cut and fill
        const volumeText = (value) => `${number(displayQuantity(units, 'volume', value), 0)} ${unitLabel(units, 'volume')}`;
        let deepCut = null;
        let deepFill = null;
        for (const sample of analysis.samples) {
            if (!sample.existing && !sample.bridge && !sample.outside) {
                const depth = sample.ground - sample.z;
                deepCut = depth > (deepCut?.depth ?? 0) ? {depth, 'station': sample.station} : deepCut;
                deepFill = -depth > (deepFill?.depth ?? 0) ? {'depth': -depth, 'station': sample.station} : deepFill;
            }
        }
        const depthText = (deep, name) => (
            deep === null ? `It has no ${name}.` :
                `Its deepest ${name} is ${lengthText(deep.depth, 1)} (station ${stationText(deep.station)}).`
        );
        const balanceText = analysis.borrow > 0 ? `, with ${volumeText(analysis.borrow)} of borrow (import)` :
            (analysis.waste > 0 ? `, with ${volumeText(analysis.waste)} of waste (export)` : '');
        lines.push(
            `- **Earthwork.** ${volumeText(analysis.cut)} of cut and ${volumeText(analysis.fill)} of fill${balanceText}. ` +
            `${depthText(deepCut, 'cut')} ${depthText(deepFill, 'fill')}`
        );

        // Its largest cost items, and its design warnings
        const costs = [...analysis.costs].sort((first, second) => second.cost - first.cost).slice(0, costItemCount);
        lines.push(
            `- **Cost.** Its largest items: ${costs.map(({name, cost}) => `${name.toLowerCase()} ${number(cost / 1000, 1)}`).join(', ')}.`,
            `- **Design warnings.** ${analysis.warnings.length === 0 ? 'None' : analysis.warnings.join('. ')}.`
        );
    });
    return lines;
}
