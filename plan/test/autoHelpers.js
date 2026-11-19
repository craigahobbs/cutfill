// autoHelpers.js - the "auto" command's tests' site, and its runs

import {layoutLatLong, siteLayout} from '../lib/terrain.js';
import {siteEast, siteNorth, testImage, testIo, testItem, testLine, testPages, testSite} from './terrainHelpers.js';
import {cliMain} from '../lib/cli.js';


// The test site's elevation model - a gentle valley down to the south, east of the site's center
export const item = testItem('CO_New_2020', 'x47y443', '2022-02-10');
export const valley = (east, north) => 1700 + 0.03 * Math.abs(east - siteEast - 40) + 0.02 * (north - siteNorth);
export const pngBytes = Uint8Array.from([137, 80, 78, 71]);


// A test site - its grid is 61 x 54 points, 10 meters apart, and its start and end points are at 150, 150 and 449, 372
export function autoSite(members = {}) {
    return testSite({'margin': 150, 'spacing': 10, ...members});
}


// Get a test site's road - a GeoJSON line of the plan's points
export function siteRoad(site, name, points) {
    const layout = siteLayout(site);
    return testLine({name}, points.map(([x, y]) => {
        const [latitude, longitude] = layoutLatLong(layout, x, y);
        return [longitude, latitude];
    }));
}


// Get a test site's latitude and longitude of a plan point (rounded to ten-millionths of a degree, as the marks that a
// plan finds are)
export function siteLatLong(site, x, y) {
    const [latitude, longitude] = layoutLatLong(siteLayout(site), x, y);
    return {'latitude': Math.round(latitude * 1e7) / 1e7, 'longitude': Math.round(longitude * 1e7) / 1e7};
}


// The notes question's answer, with overrides
export function notesAnswer(members = {}) {
    return {
        'purpose': 'A road.', 'width': null, 'surface': null, 'maxGrade': null, 'minRadius': null, 'bridgeFill': null, 'ruleOutRoads': [],
        'avoid': [], 'passThrough': [], 'unhandled': [], ...members
    };
}


// Run the "auto" command for a site (its file, "site.json" - or, if "site" is null, the file as it is) - "answers" are
// the model's: its notes answer ("notes"), and each place's answers by its name (an area's answer and its closer
// answer, or a point's answer). Returns the tools' input and output functions object (testIo), with the command's exit
// "code", the model's "asks", the written "plan" (and its "descriptions" - the plan's description's lines, and each
// option's, under their headings), and the plan config file's "site".
export async function runAuto(
    site, {args = [], answers = {}, roads = [], elevation = valley, mapImage = pngBytes, io = null, status = false} = {}
) {
    const autoIo = io ?? testIo({
        'images': {[item.downloadURL]: testImage({elevation})},
        'pages': testPages({'items': [item], roads}),
        mapImage
    });
    if (site !== null) {
        autoIo.files['site.json'] = JSON.stringify(site);
    }
    autoIo.output.length = 0;
    autoIo.asks = [];
    autoIo.renderPng = () => pngBytes;

    // The plan's statuses - what it's doing, as it's made
    autoIo.statuses = [];
    if (status) {
        autoIo.status = (text, step) => Promise.resolve(autoIo.statuses.push(`${step}: ${text}`));
    }
    autoIo.ask = ({model, question, images, schema}) => {
        const place = question.match(/must (?:avoid|pass through): "([^"]*)"/)?.[1] ?? null;
        const key = place === null ? 'notes' : `${place}${question.includes('first estimate') ? ':closer' : ''}`;
        autoIo.asks.push({model, key, 'images': images.length, 'members': Object.keys(schema.properties).length});
        return key in answers ? Promise.resolve(answers[key]) : Promise.reject(new Error(`The model "${model}" failed (no ${key})`));
    };
    const code = await cliMain(['auto', 'site.json', 'plans/road.json', ...args], autoIo);
    const plan = code === 0 ? JSON.parse(autoIo.files['plans/road.json']) : null;
    const descriptions = plan === null ? null : [
        '# Plan', '', ...plan.description,
        ...plan.options.flatMap((option) => ['', `# Option: ${option.name}`, '', ...option.description])
    ];
    return Object.assign(autoIo, {code, plan, descriptions, 'site': JSON.parse(autoIo.files['site.json'])});
}


// The site command's report of the test site
export const siteLines = `\
Grid: 61 x 54 at 10 meters spacing (600 x 530 meters), a margin of 150 meters
Elevations: 1695.0 to 1715.7 meters, contours every 1 meters
Elevation model: CO_New_2020 (2022-02-10)
Features: 0 streams, 0 roads, 0 trails, 0 exclusion areas
Topographic map image: plans/road.png
start: "Start" (150, 150) at 40.00000, -105.28000, ground 1703.6
end: "End" (448.87, 372.07) at 40.00200, -105.27650, ground 1705.6
`;


// The standard options' report of the test site - the new road, and the other corridor
export const optionsLines = `\
Option "New Road": 377 meters long, 102 alignment points, max grade 3.6%, max cut 0.0, max fill 0.1
Structures: 1 culvert, 3 turnouts
Cost score: 72.5, design warnings: 0
Option "North Corridor": 464 meters long, 125 alignment points, max grade 2.0%, max cut 0.1, max fill 0.1
Structures: 1 culvert, 3 turnouts
Cost score: 85.1, design warnings: 0
Other corridor: "North Corridor" (through 262,352) - its middle is an average of 105 meters from the standard options
`;


// The command's last line
export const wroteLine = 'Wrote plans/road.json\n';
