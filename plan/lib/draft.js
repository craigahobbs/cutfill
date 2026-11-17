// draft.js - the "draft" command - write a draft of a road plan model's descriptions: the facts of the plan and of
// each option that the tools know, for a planning session (or the plan's author) to add to

import {analyzeOption, culvertDiameter, planCriteria, planTopo} from '../../viewer/lib/model.js';
import {displayQuantity, fixedTrim, station as formatStation, number, unitLabel} from '../../viewer/lib/format.js';
import {existingRoadGrades} from './routeCli.js';
import {groundElevation} from './design.js';
import {lineIndex} from './roads.js';
import {polylineStations} from './route.js';
import {readPlan} from './planFile.js';


// The "draft" command's usage text lines
export const draftUsage = [
    'usage: plan draft <plan.json> <descriptions.md>',
    '',
    '  Write a draft of a road plan model\'s descriptions - a Markdown file of the plan\'s and each option\'s facts (its',
    '  site, design criteria, added features, and limitations - and each option\'s length, grades, existing roads,',
    '  structures, earthwork, cost, and design warnings). Add what the tools don\'t know - the road\'s purpose, its',
    '  corridors, and what to verify in the field - and set the descriptions with "plan describe".'
];


// The added features' types, and their names in the draft
const featureTypeNames = {
    'stream': 'Streams', 'road': 'Existing roads', 'trail': 'Trails', 'rock': 'Rock outcrops', 'exclusion': 'Exclusion areas'
};


// The structure types' names, in the draft's order (an existing road has its own lines)
const structureTypeNames = {'bridge': 'bridge', 'culvert': 'culvert', 'retainingWall': 'retaining wall', 'turnout': 'turnout'};


// The number of an option's largest cost items in the draft, and the most structures of a type that it lists
const costItemCount = 3;
const structureLimit = 6;


// The "draft" command - "io" is the tools' input and output functions. Returns the command's exit code and its
// output text lines, or null if its arguments are invalid.
export function draftCommand(args, io) {
    const [planPath, textPath] = args;
    if (args.length !== 2 || planPath.startsWith('-') || textPath.startsWith('-')) {
        return null;
    }

    // Read the road plan model
    const {plan, error} = readPlan(io, planPath);
    if (error !== undefined) {
        return {'code': 1, 'lines': error};
    }
    const lines = draftLines(plan);
    io.writeFile(textPath, `${lines.join('\n')}\n`);
    return {'code': 0, 'lines': [
        `Wrote ${textPath} - the plan's and ${plan.options.length} option${plan.options.length === 1 ? '\'s' : 's\''} facts. Add what ` +
            `the tools don't know, and set the descriptions with "plan describe ${planPath} ${textPath}"`
    ]};
}


// Create the draft's Markdown lines of a plan
export function draftLines(plan) {
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
        `**The site.** From ${pointText(plan.start, 'start')} to ${pointText(plan.end, 'end')}. The straight line between them ` +
            `${climb < 0 ? 'descends' : 'climbs'} ${lengthText(Math.abs(climb))} in ${lengthText(distance)} (${gradeText(straightGrade)})` +
            `${straightGrade > criteria.maxGrade ? ' - steeper than the maximum grade, so a road is longer than the straight line' : ''}.`,
        '',
        `**Design criteria.** Maximum grade ${gradeText(criteria.maxGrade)}, minimum curve radius ${lengthText(criteria.minRadius)}, ` +
            `maximum retaining wall height ${lengthText(criteria.maxWallHeight)}.`
    ];

    // The features that were added to the site
    const added = topo.features.filter((feature) => feature.added ?? false);
    if (added.length > 0) {
        lines.push('', '**Features added to the site.** They aren\'t the USGS\'s - verify them in the field:', '');
        for (const [type, typeName] of Object.entries(featureTypeNames)) {
            const features = added.filter((feature) => feature.type === type);
            if (features.length > 0) {
                const names = [...new Set(features.filter(({name = null}) => name !== null).map(({name}) => name))];
                const unnamed = features.filter(({name = null}) => name === null).length;
                lines.push(`- ${typeName}: ${[...names, ...(unnamed > 0 ? [`${unnamed} unnamed`] : [])].join(', ')}`);
            }
        }
    }
    lines.push(
        '',
        '**Limitations.** The terrain is the USGS 3D Elevation Program\'s lidar ground elevations, and the streams, roads, and trails ' +
            'are the USGS National Map\'s. What they lack - buildings, property lines, utilities, and unmapped roads and drainages - ' +
            'isn\'t in the plan unless it was added. Turnarounds aren\'t modeled. The cost scores compare the options - they aren\'t ' +
            'bid estimates.'
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
            `${costText} - its cost score is ${number(analysis.score, 1)}. It's ${lengthText(analysis.length)} long and ` +
                `${lengthText(section.width, section.width % 1 === 0 ? 0 : 1)} wide, ${section.surface ?? 'gravel'}, and ` +
                `${analysis.existingLength > 0 ? 'its new road\'s' : 'its'} maximum grade is ${gradeText(analysis.maxGrade)}.`,
            ''
        );

        // The existing roads it follows - their names, and their grades as they're built
        const alignmentX = option.alignment.map((point) => point.x);
        const alignmentY = option.alignment.map((point) => point.y);
        const alignmentZ = analysis.alignment.map((point) => point.z);
        const stations = polylineStations(alignmentX, alignmentY);
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
