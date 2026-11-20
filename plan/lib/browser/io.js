// io.js - the planning tools' input and output functions in a web browser, and a road's plan made with them
// (autoPlan) - for the SageRoad application's page. The tools' Node modules are the page's import map's ("buffer.js" and
// "zlib.js") - a worker has no import map, so the application's staged modules import them by their paths.
//
// A plan is made in memory - the plan config and the road plan are the page's - and the files of its work directory
// (its terrain cache, the model's saved answers) and its map image are in memory, too: the map image is a data URL in
// the plan. The USGS's services, its elevation models, and Ollama are fetched from the browser: they answer other
// sites' pages. A plan is made in a worker (worker.js), so the page goes on while it's made - its route searches and
// profile designs are minutes of computation on a large site.

import {fetchBytes, fetchJson} from '../usgs.js';
import {isLayoutPlan, siteLayout} from '../terrain.js';
import {ollamaAsk, ollamaHostDefault} from '../ollama.js';
import {Buffer} from 'node:buffer';
import {autoPlan} from '../auto.js';
import {openElevationImage} from '../elevationImage.js';
import {validateSite} from '../../../viewer/lib/model.js';


// The steps of a plan - the page shows them as the plan is made - and a site's default margin and grid spacing (the
// page's plan config form shows them)
export {autoSteps} from '../auto.js';
export {siteDefaults} from '../terrain.js';


// The default Ollama host - the page asks it for its models
export {ollamaHostDefault} from '../ollama.js';


// The paths of a plan's files in memory - its plan (its work directory's files, and its map image, are named for it)
// and its map image - and the paths of its work directory's files that are kept from one plan to the next (the terrain
// cache, and the model's saved answers)
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
        'openImage': (url) => openElevationImage(fetchFn, url),
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


// Plan a road in the browser (autoPlan) - "site" is the plan config (a road site model), and "plan" is the
// road plan made from it before, or null. A plan of the same site is made again - its site's data, and the features
// that were added to it, are kept (its options are the run's) - unless "fetch" is true: the USGS's services are asked
// for its site's data again. "model" is the Ollama model to ask what the site's notes ask for (or null), and "status"
// is a function of what the plan is doing - its text, and its step's key. "files" are the files of the page's earlier
// plans - their terrain cache and the model's saved answers are kept, so a plan made again doesn't fetch its terrain or
// ask the model again. "signal" is an abort signal that stops the plan (or null) - its result is "stopped", and its work
// is thrown away: the files are the files before it. Returns the plan's exit code, its report's lines, and the road
// plan model - its map image is a data URL (null if the plan failed). The page's plan isn't changed - the run's plan is
// made from a copy of it.
//
// The plan is made in a worker (worker.js), so the page goes on while it's made, and a stopped plan stops at once - the
// worker is ended. A window without workers makes the plan itself: its status is drawn before the plan goes on (the
// status function may return a promise), and a stopped plan stops when its current step's computation is done.
export function planRoad(window, road, options = {}) {
    return typeof window.Worker === 'function' ? planRoadWorker(window, road, options) : makePlan(window, road, options);
}


// The result of a plan that's stopped
const stoppedResult = () => ({'code': 1, 'lines': ['The plan was stopped'], 'plan': null, 'stopped': true});


// Remove the files that aren't kept from one plan to the next
function keepFiles(files) {
    for (const path of [...files.keys()]) {
        if (!keptPrefixes.some((prefix) => path.startsWith(prefix))) {
            files.delete(path);
        }
    }
}


// Make a road's plan in a worker (planRoad) - the worker's messages are the plan's statuses, its plots to draw (a
// worker can't draw an SVG image - the page draws it), and its result, with its files
function planRoadWorker(window, {site, plan = null}, options) {
    const {model = null, ollamaHost = ollamaHostDefault, status = null, files = new Map(), signal = null, fetch = false} = options;
    keepFiles(files);
    if (signal?.aborted) {
        return Promise.resolve(stoppedResult());
    }
    return new Promise((resolve) => {
        const worker = new window.Worker(new URL('worker.js', import.meta.url), {'type': 'module'});
        let isDone = false;
        const finish = (result) => {
            if (!isDone) {
                isDone = true;
                worker.terminate();
                signal?.removeEventListener('abort', stop);
                resolve(result);
            }
        };
        const stop = () => finish(stoppedResult());
        signal?.addEventListener('abort', stop);
        worker.onmessage = async ({data}) => {
            if (data.type === 'status') {
                status?.(data.text, data.step);
            } else if (data.type === 'png') {
                try {
                    worker.postMessage({'type': 'png', 'id': data.id, 'bytes': await svgPng(window, data.svg)});
                } catch ({message}) {
                    worker.postMessage({'type': 'png', 'id': data.id, 'error': message});
                }
            } else if (!isDone) {
                // The plan's files are the worker's
                files.clear();
                for (const [path, content] of data.files) {
                    files.set(path, content);
                }
                finish(data.result);
            }
        };
        worker.onerror = (event) => {
            finish({'code': 1, 'lines': [`error: The plan's worker failed${event.message ? ` - ${event.message}` : ''}`], 'plan': null});
        };
        worker.postMessage({'type': 'run', 'road': {site, plan}, model, ollamaHost, fetch, 'files': new Map(files)});
    });
}


// The worker's plot requests that the page hasn't drawn yet, by the worker's scope - a map of request ID to the
// request's promise's resolve and reject functions
const workerPlots = new WeakMap();


// Handle a message to the plan's worker (worker.js) - "scope" is the worker's global scope. A "run" message makes the
// plan (makePlan) - its statuses and its plots to draw are posted to the page, and then its result and its files. A
// "png" message is a plot the page drew - its PNG image file's bytes, or the error that it couldn't be drawn.
export async function workerMessage(scope, message) {
    if (message.type === 'png') {
        const plots = workerPlots.get(scope);
        const {resolve, reject} = plots.get(message.id);
        plots.delete(message.id);
        if ('error' in message) {
            reject(new Error(message.error));
        } else {
            resolve(message.bytes);
        }
        return;
    }

    // The plan - its plots are drawn by the page
    const plots = new Map();
    workerPlots.set(scope, plots);
    let plotCount = 0;
    const renderPng = (svg) => new Promise((resolve, reject) => {
        plotCount += 1;
        plots.set(plotCount, {resolve, reject});
        scope.postMessage({'type': 'png', 'id': plotCount, svg});
    });
    const {road, model, ollamaHost, fetch, files} = message;
    const status = (text, step) => {
        scope.postMessage({'type': 'status', text, step});
    };
    let result;
    try {
        result = await makePlan(scope, road, {model, ollamaHost, fetch, files, status}, renderPng);
    } catch ({message: errorMessage}) {
        result = {'code': 1, 'lines': [`error: ${errorMessage}`], 'plan': null};
    }
    scope.postMessage({'type': 'done', result, files});
}


// Make a road's plan (planRoad) - "window" is the browser's window, or a worker's global scope, and "renderPng" is the
// function that draws a plot (the window's, by default)
async function makePlan(window, {site, plan = null}, options, renderPng = null) {
    const {model = null, ollamaHost = ollamaHostDefault, status = null, files = new Map(), signal = null, fetch = false} = options;

    // The plan's files - the files kept from the page's earlier plans
    keepFiles(files);
    const keptFiles = new Map(files);
    const validated = validateSite(site);
    if ('error' in validated) {
        return {'code': 1, 'lines': ['error: The plan config is invalid:', '', validated.error], 'plan': null};
    }

    // Plan the road
    const io = {
        ...browserIo(window, ollamaHost, files, signal),
        ...(renderPng !== null ? {renderPng} : {}),
        'status': (text, step) => {
            signal?.throwIfAborted();
            return status?.(text, step);
        }
    };
    let result;
    try {
        // A plan is made again from its site only if it's a plan of the plan config's site - the same projection center
        // and units. It's a new plan, otherwise.
        const isSitePlan = plan !== null && isLayoutPlan(siteLayout(validated.site), plan);
        const planValue = isSitePlan ? JSON.parse(JSON.stringify(plan)) : {};
        result = await autoPlan(io, planPath, validated.site, planValue, {model, 'isFetch': fetch});
    } catch ({message}) {
        result = {'code': 1, 'lines': [`error: ${message}`]};
    }
    if (signal?.aborted) {
        files.clear();
        for (const [path, content] of keptFiles) {
            files.set(path, content);
        }
        return stoppedResult();
    } else if (result.code !== 0) {
        return {'code': result.code, 'lines': result.lines, 'plan': null};
    }

    // The plan - its map image is in it, a data URL
    const newPlan = {...result.plan};
    if (newPlan.image === imagePath && files.has(imagePath)) {
        newPlan.image = `data:image/png;base64,${Buffer.from(files.get(imagePath)).toString('base64')}`;
    }
    return {'code': 0, 'lines': result.lines, 'plan': newPlan};
}
