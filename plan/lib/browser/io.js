// io.js - the planning tools' input and output functions in a web browser, and a road's plan made with them (the
// "auto" command) - for the Roadie application's page. The tools' Node modules are the page's import map's
// ("util.js", "buffer.js", and "zlib.js").
//
// The tools read and write files as they go, so a browser's files are in memory - the plan config and the road plan
// are the page's, and the plan's map image is a data URL in the plan. The USGS's services and Ollama are fetched from
// the browser: they answer other sites' pages.

import {fetchBytes, fetchJson} from '../usgs.js';
import {Buffer} from 'node:buffer';
import {autoCommand} from '../auto.js';
import {elevationImage} from '../elevationImage.js';
import {ollamaAsk} from '../ollama.js';


// The steps of a plan - the page shows them as the plan is made - and a site's default margin and grid spacing (the
// page's plan config form shows them)
export {autoSteps} from '../auto.js';
export {siteDefaults} from '../terrain.js';


// The default Ollama host, and the GeoTIFF reader's script (it defines "GeoTIFF")
export const ollamaHostDefault = 'http://127.0.0.1:11434';
const geotiffUrl = 'geotiff.js';


// The paths of a plan's files in memory - its plan config, its plan, and its map image - and the paths of its work
// directory's files that are kept from one plan to the next (the terrain cache, and the model's saved answers)
const sitePath = 'site.json';
const planPath = 'plan.json';
const imagePath = 'plan.png';
const keptPrefixes = ['plan.work/terrain/', 'plan.work/decisions.json'];


// Create the tools' input and output functions - "window" is the browser's window, "ollamaHost" is the Ollama host's
// URL, "files" are the files in memory (a path's text or bytes), and "signal" is an abort signal (or null) - when it's
// aborted, the functions that fetch, wait, or read throw its reason, and the fetches in flight are aborted.
export function browserIo(window, ollamaHost = ollamaHostDefault, files = new Map(), signal = null) {
    const check = () => {
        signal?.throwIfAborted();
    };
    const fetchFn = (url, options) => {
        check();
        return window.fetch(url, signal !== null ? {...options, signal} : options);
    };
    const sleep = async (milliseconds) => {
        check();
        await new Promise((resolve) => {
            window.setTimeout(resolve, milliseconds);
        });
        check();
    };
    const write = (path, content) => {
        files.set(path, content);
    };
    return {
        files,
        'readFile': (path) => {
            const content = files.get(path);
            if (typeof content !== 'string') {
                throw new Error(`No such file "${path}"`);
            }
            return content;
        },
        'readBytes': (path) => {
            const content = files.get(path) ?? null;
            if (content === null) {
                throw new Error(`No such file "${path}"`);
            }
            return typeof content === 'string' ? new window.TextEncoder().encode(content) : content;
        },
        'writeFile': write,
        'writeBytes': write,
        'getJson': (url) => fetchJson(fetchFn, sleep, url),
        'getBytes': (url) => fetchBytes(fetchFn, sleep, url),
        sleep,
        'renderPng': (svg) => svgPng(window, svg),
        'openImage': async (url) => {
            check();
            const {fromUrl} = await geotiffReader(window);
            const image = elevationImage(await (await fromUrl(url)).getImage());
            return {...image, 'read': async (imageWindow) => {
                check();
                const elevations = await image.read(imageWindow);
                return elevations;
            }};
        },
        'ask': async (question) => {
            check();
            const answer = await ollamaAsk(fetchFn, ollamaHost, question);
            return answer;
        }
    };
}


// Render an SVG image's markup as a PNG image file's bytes - the browser draws it on a canvas
async function svgPng(window, svg) {
    const url = window.URL.createObjectURL(new window.Blob([svg], {'type': 'image/svg+xml'}));
    try {
        const image = new window.Image();
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('Could not draw a plot'));
            image.src = url;
        });
        const canvas = window.document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context.fillStyle = 'white';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        const blob = await new Promise((resolve) => {
            canvas.toBlob(resolve, 'image/png');
        });
        return new Uint8Array(await blob.arrayBuffer());
    } finally {
        window.URL.revokeObjectURL(url);
    }
}


// Get the GeoTIFF reader - its script is loaded when it's first needed
function geotiffReader(window) {
    window.roadieGeotiff ??= new Promise((resolve, reject) => {
        const script = window.document.createElement('script');
        script.onload = () => resolve(window.GeoTIFF);
        script.onerror = () => reject(new Error('Could not load the elevation models\' reader'));
        script.src = geotiffUrl;
        window.document.head.append(script);
    });
    return window.roadieGeotiff;
}


// Is a plan's site the plan config's - the same start and end points, in the same units? A plan is made again from
// its site - its other options and features are kept - only if it is.
function isPlanSite(plan, site) {
    const planSite = plan.site ?? null;
    const samePoint = (point1, point2) => point1.latitude === point2.latitude && point1.longitude === point2.longitude;
    return planSite !== null && planSite.units === site.units && samePoint(planSite.start, site.start) &&
        samePoint(planSite.end, site.end);
}


// Plan a road in the browser (the "auto" command) - "site" is the plan config (a road site model), and "plan" is the
// road plan made from it before, or null. A plan of the same site is made again - its other options and features are
// kept. "model" is the Ollama model to ask what the site's notes ask for (or null), "progress" is a function of the
// plan's report's lines as they're made, and "status" is a function of what the plan is doing (each may return a
// promise - the page's are drawn before the plan goes on). "files" are the files of the page's earlier plans - their
// terrain cache and the model's saved answers are kept, so a plan made again doesn't fetch its terrain or ask the
// model again. Returns the plan's exit code, its report's lines, and the road plan model - its map image is a data
// URL (null if the plan failed). "signal" is an abort signal that stops the plan (or null) - the plan stops when its
// current step's computation is done, its result is "stopped", and its work is thrown away: the files are the files
// before it.
export async function planRoad(window, {site, plan = null}, options = {}) {
    const {model = null, ollamaHost = ollamaHostDefault, progress = null, status = null, files = new Map(), signal = null} = options;

    // The plan's files - the plan config, the plan, and the files kept from the page's earlier plans
    for (const path of [...files.keys()]) {
        if (!keptPrefixes.some((prefix) => path.startsWith(prefix))) {
            files.delete(path);
        }
    }
    const keptFiles = new Map(files);
    files.set(sitePath, JSON.stringify(site));
    if (plan !== null && isPlanSite(plan, site)) {
        files.set(planPath, JSON.stringify(plan));
    }

    // Plan the road
    const io = {
        ...browserIo(window, ollamaHost, files, signal),
        progress,
        'status': (text, step) => {
            signal?.throwIfAborted();
            return status?.(text, step);
        }
    };
    let result;
    try {
        result = await autoCommand([sitePath, planPath, ...(model !== null ? ['--model', model] : [])], io);
    } catch ({message}) {
        result = {'code': 1, 'lines': [`error: ${message}`]};
    }
    if (signal?.aborted) {
        files.clear();
        for (const [path, content] of keptFiles) {
            files.set(path, content);
        }
        return {'code': 1, 'lines': ['The plan was stopped'], 'plan': null, 'stopped': true};
    } else if (result.code !== 0) {
        return {...result, 'plan': null};
    }

    // The plan - its map image is in it, a data URL
    const newPlan = JSON.parse(files.get(planPath));
    if (newPlan.image === imagePath && files.has(imagePath)) {
        newPlan.image = `data:image/png;base64,${Buffer.from(files.get(imagePath)).toString('base64')}`;
    }
    return {...result, 'plan': newPlan};
}
