// io.js - the planning tools' input and output functions in a web browser, and a road's plan made with them (the
// "auto" command) - for the Roadie application's page. The tools' Node modules are the page's import map's
// ("util.js", "buffer.js", and "zlib.js").
//
// The tools read and write files as they go, so a browser's files are in memory: a road's files are loaded from the
// application's back end before its plan is made, and the files the tools write are written to the back end, too -
// but for the terrain cache's, which the browser doesn't keep. The back end's files are the road's: its road site
// model's file ("site" - in memory, its path is "site/<its name>"), and its plan's files ("files/<path>" - the road
// plan model's file, its map image, and its work directory's files). The USGS's services and Ollama are fetched from the
// browser: they answer other sites' pages.

import {fetchBytes, fetchJson} from '../usgs.js';
import {autoCommand} from '../auto.js';
import {elevationImage} from '../elevationImage.js';
import {ollamaAsk} from '../ollama.js';


// The road site model's types and its validation - the application's road site editor's
export {siteTypes, validateSite} from '../site.js';


// The default Ollama host, the back end's URLs of the plan's files and the road site model's file (and its path's
// directory in memory), and the GeoTIFF reader's script (it defines "GeoTIFF")
export const ollamaHostDefault = 'http://127.0.0.1:11434';
const filesUrl = 'files/';
const siteUrl = 'site';
const siteDirectory = 'site/';
const geotiffUrl = 'geotiff.js';


// Create the tools' input and output functions - "window" is the browser's window, and "ollamaHost" is the Ollama
// host's URL. Its "files" are the files in memory (a path's text or bytes), its "load" function loads a file from the
// back end (if the back end has it), and its "flush" function waits for the files that were written to be the back
// end's - it throws if one isn't.
export function browserIo(window, ollamaHost = ollamaHostDefault) {
    const files = new Map();
    const writes = [];
    const fetchFn = (...args) => window.fetch(...args);
    const fileUrl = (path) => (
        path.startsWith(siteDirectory) ? siteUrl : `${filesUrl}${path.split('/').map((name) => window.encodeURIComponent(name)).join('/')}`
    );
    const sleep = (milliseconds) => new Promise((resolve) => {
        window.setTimeout(resolve, milliseconds);
    });

    // Write a file - the back end's, too, unless it's the terrain cache's
    const write = (path, content) => {
        files.set(path, content);
        if (!path.includes('.work/terrain/')) {
            writes.push(fetchFn(fileUrl(path), {'method': 'PUT', 'body': content}).then((response) => {
                if (!response.ok) {
                    throw new Error(`Could not write "${path}" (status ${response.status})`);
                }
            }));
        }
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
            const {fromUrl} = await geotiffReader(window);
            return elevationImage(await (await fromUrl(url)).getImage());
        },
        'ask': (question) => ollamaAsk(fetchFn, ollamaHost, question),

        // Load a file from the back end - its text, or its bytes
        'load': async (path, isText = true) => {
            const response = await fetchFn(fileUrl(path));
            if (response.ok) {
                files.set(path, isText ? await response.text() : new Uint8Array(await response.arrayBuffer()));
            }
            return response.ok;
        },

        // Wait for the back end's files
        'flush': async () => {
            await Promise.all(writes.splice(0));
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


// Plan a road in the browser (the "auto" command) - "site" is the back end's road site model's file name, and "plan"
// is its road plan model's file name. "model" is the Ollama model to ask what the site's notes ask for (or null),
// "progress" is a function of the plan's report's lines as they're made, and "status" is a function of what the plan
// is doing (each may return a promise - the page's are drawn before the plan goes on). Returns the plan's exit code
// and its report's lines.
export async function planRoad(
    window, {site, plan}, {model = null, ollamaHost = ollamaHostDefault, progress = null, status = null} = {}
) {
    const io = {...browserIo(window, ollamaHost), progress, status};
    const sitePath = `${siteDirectory}${site}`;

    // The road's files - its site model, its plan (if it has one), and the model's saved answers
    if (!await io.load(sitePath)) {
        return {'code': 1, 'lines': [`error: Could not load the road site "${site}"`]};
    }
    await io.load(plan);
    await io.load(`${plan.replace(/\.json$/i, '')}.work/decisions.json`);

    // Plan the road, and wait for its files
    let result;
    try {
        result = await autoCommand([sitePath, plan, ...(model !== null ? ['--model', model] : [])], io);
        await io.flush();
    } catch ({message}) {
        result = {'code': 1, 'lines': [`error: ${message}`]};
    }
    return result;
}
