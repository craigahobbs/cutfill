// app.js - the Roadie viewer web application

import {AdaptiveSmoothing, reportBudget} from './smoothing.js';
import {argsLink, argsParse, argsURL, parseHash} from './args.js';
import {buildReport, planImageURL} from './report.js';
import {defaultRates, orderPlan, planCriteria, planText, roadieTypes, validatePlan, validateSite} from './model.js';
import {escapeHtml, number, round, unitLabel} from './format.js';
import {formHtml, formPastePoint, formPlaceholders, formValue} from './form.js';
import {hitTitle, opCell, paintOps} from './canvas.js';
import {Explorer} from './explore.js';
import {PlanData} from './planData.js';
import {buildDoc} from './doc.js';
import {exploreStyle} from './draw.js';
import {latLongText} from './geo.js';
import {planPad} from './planView.js';
import {smoothLimitsCanvas} from './view3d.js';


// The document font size, in pixels (12pt)
const fontSize = 16;


// The maximum report view width, in pixels
const maxWidth = 1200;


// The canvas 3D drawings' print resolution, as a multiple of the drawing's size in CSS pixels, and their background color
// (the SVG drawings' style background)
const printRatio = 2;
const canvasBackground = '#f4f1ea';


// Paint a canvas 3D drawing (a report view's or the explorer's) at a pixel ratio - the canvas bitmap is the drawing's
// size times the ratio. The canvas's CSS size is the drawing's - its width, and with "fixedHeight", its height
// (otherwise, its height follows its width).
function paintCanvas(canvas, drawing, ratio, fixedHeight) {
    const {width, height} = drawing;
    const bitmapWidth = Math.round(width * ratio);
    const bitmapHeight = Math.round(height * ratio);
    if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
        canvas.width = bitmapWidth;
        canvas.height = bitmapHeight;
        canvas.style.width = `${width}px`;
        if (fixedHeight) {
            canvas.style.height = `${height}px`;
        }
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(bitmapWidth / width, 0, 0, bitmapHeight / height, 0, 0);

    // The drawing's background is painted, not left to the canvas's style, so it prints (printing omits backgrounds)
    ctx.fillStyle = canvasBackground;
    ctx.fillRect(0, 0, width, height);
    paintOps(ctx, drawing.ops);
}


// Count a canvas 3D drawing's terrain cells
function countCells(drawing) {
    let cells = 0;
    for (const op of drawing.ops) {
        if (op.t === opCell) {
            cells += 1;
        }
    }
    return cells;
}


// Show the title (tooltip) of a canvas 3D drawing's shape under the mouse
function showCanvasTitle(canvas, drawing, event) {
    if (drawing !== null) {
        const rect = canvas.getBoundingClientRect();
        const scale = drawing.width / rect.width;
        const title = hitTitle(drawing.ops, (event.clientX - rect.left - 1) * scale, (event.clientY - rect.top - 1) * scale);
        if ((canvas.title || null) !== title) {
            canvas.title = title ?? '';
        }
    }
}


// The delay after the last key press before the 3D explorer draws its still view, in milliseconds
const refineDelay = 250;


// The local storage key of the 3D explorer's measured terrain cell drawing cost (smoothing.js)
const cellCostKey = 'roadieCellCost';


// The local file URL argument prefix - local files are opened from the user's computer and kept in IndexedDB
const localPrefix = 'local:';


// The Ollama host - its models answer the questions of a road's plan
const ollamaHost = 'http://127.0.0.1:11434';


// Compute the report view width for the window width, in pixels
function viewWidth(window) {
    return Math.max(400, Math.min(maxWidth, window.innerWidth - 3 * fontSize));
}


//
// Local files - kept in memory and in IndexedDB, so a local plan survives reloads
//


const dbName = 'roadie-viewer';
const dbStore = 'files';


function openDb(window) {
    return new Promise((resolve) => {
        try {
            const request = window.indexedDB.open(dbName, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(dbStore, {'keyPath': 'name'});
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}


function dbRequest(db, mode, fn) {
    return new Promise((resolve) => {
        if (db === null) {
            resolve(null);
            return;
        }
        try {
            const request = fn(db.transaction(dbStore, mode).objectStore(dbStore));
            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}


export class RoadieApp {
    constructor(window) {
        this.window = window;
        this.document = window.document;
        this.main = this.document.getElementById('roadie');
        this.plans = new Map();
        this.localFiles = new Map();
        this.dbPromise = null;
        this.adaptiveSmoothing = null;
        this.page = null;
        this.routeCount = 0;
        this.printing = false;
        this.debug = window.location.search.includes('debug');

        // Import the planning tools - they run a plan in the browser. The tools are the Roadie application's (the
        // project's web site doesn't have them), and its page's import map has their Node modules. The runs' files are
        // kept - the terrain cache, and the model's saved answers - so a plan run again doesn't fetch them again.
        this.importPlan = () => import('../../plan/lib/browser/io.js');
        this.runFiles = new Map();
        this.openError = null;
        this.loadedValue = undefined;
        this.fileHandle = null;
    }


    // Start the application
    start() {
        const {window} = this;
        window.addEventListener('hashchange', () => this.route());
        // A resize while printing is the print layout - the pages keep their screen layout, scaled to the paper
        window.addEventListener('resize', () => {
            if (!this.printing) {
                this.page?.resize?.();
            }
        });
        window.addEventListener('beforeprint', () => {
            this.printing = true;
            this.page?.print?.();
        });
        window.addEventListener('afterprint', () => {
            this.printing = false;
        });
        this.document.addEventListener('keydown', (event) => this.page?.keyDown?.(event));

        // Open dropped plan files anywhere
        this.document.addEventListener('dragover', (event) => {
            event.preventDefault();
            this.document.body.classList.add('roadie-drop');
        });
        this.document.addEventListener('dragleave', (event) => {
            if (event.relatedTarget === null) {
                this.document.body.classList.remove('roadie-drop');
            }
        });
        this.document.addEventListener('drop', (event) => {
            event.preventDefault();
            this.document.body.classList.remove('roadie-drop');
            if (this.confirmReplace()) {
                this.openFiles(event.dataTransfer.files);
            }
        });

        this.route();
    }


    db() {
        if (this.dbPromise === null) {
            this.dbPromise = openDb(this.window);
        }
        return this.dbPromise;
    }


    // The canvas 3D drawings' adaptive terrain - it starts from the cell cost measured the last time
    get smoothing() {
        this.adaptiveSmoothing ??= new AdaptiveSmoothing(this.storageGet(cellCostKey));
        return this.adaptiveSmoothing;
    }


    // Open local files - the first JSON file (a plan) is the loaded plan; other files (e.g. a plan's map image) are kept
    // for it, and the page is drawn again (a report shows its map image). "handles" are the files' handles, if they were
    // opened with the browser's open dialog - the loaded plan is saved to its file's.
    async openFiles(fileList, handles = null) {
        const files = [...fileList];
        let ixJson = -1;
        for (const [ixFile, file] of files.entries()) {
            await this.storeLocal(file.name, file);
            if (ixJson === -1 && file.name.toLowerCase().endsWith('.json')) {
                ixJson = ixFile;
            }
        }
        if (ixJson !== -1) {
            this.fileHandle = handles?.[ixJson] ?? null;
            await this.openLocal(files[ixJson].name);
        } else if (files.length > 0) {
            this.route();
        }
    }


    // Get a local file (a Blob), or null
    async localFile(name) {
        if (this.localFiles.has(name)) {
            return this.localFiles.get(name);
        }
        const record = await dbRequest(await this.db(), 'readonly', (store) => store.get(name));
        if (record !== null) {
            this.localFiles.set(name, record.blob);
            return record.blob;
        }
        return null;
    }


    // The local files kept in IndexedDB - [{name, time}]
    async localFileList() {
        const records = await dbRequest(await this.db(), 'readonly', (store) => store.getAll());
        return (records ?? []).map(({name, time}) => ({name, time})).sort((file1, file2) => file2.time - file1.time);
    }


    // Load a plan - returns a PlanData object, or an error object with a "message" and an optional "detail"
    loadPlan(file) {
        let promise = this.plans.get(file);
        if (promise === undefined) {
            promise = this.loadPlanHelper(file);
            this.plans.set(file, promise);
            promise.then((result) => {
                if ('message' in result) {
                    this.plans.delete(file);
                }
            });
        }
        return promise;
    }


    async loadPlanHelper(file) {
        const isLocal = file.startsWith(localPrefix);
        let text;
        try {
            if (isLocal) {
                const blob = await this.localFile(file.slice(localPrefix.length));
                text = blob !== null ? await blob.text() : null;
            } else {
                const response = await this.window.fetch(file);
                text = response.ok ? await response.text() : null;
            }
        } catch {
            text = null;
        }
        let planValue;
        try {
            planValue = text !== null ? JSON.parse(text) : null;
        } catch {
            planValue = null;
        }
        if (planValue === null) {
            return {'message': `Could not load the road plan "${file}"`};
        }
        const validated = validatePlan(planValue);
        if ('error' in validated) {
            return {'message': `The road plan "${file}" is invalid:`, 'detail': validated.error};
        }
        const data = new PlanData(validated.plan, file);

        // The source map image - a local plan's image is a local file of the same name, unless it's a data URL
        const {image} = validated.plan;
        if (image !== undefined) {
            if (isLocal && !/^data:/i.test(image)) {
                const imageBlob = await this.localFile(image.slice(image.lastIndexOf('/') + 1));
                if (imageBlob !== null) {
                    data.imageURL = this.window.URL.createObjectURL(imageBlob);
                } else {
                    data.imageMissing = image;
                }
            } else {
                data.imageURL = planImageURL(file, image);
            }
        }
        return data;
    }


    // Render the page for the current URL hash
    async route() {
        this.routeCount += 1;
        const {routeCount} = this;
        const {globals, headerId} = parseHash(this.window.location.hash);
        const args = argsParse(globals);
        this.setPage(null);

        // Model documentation?
        if (args.doc) {
            const doc = buildDoc(globals);
            this.render(doc.title, doc.html, headerId);
            return;
        }

        // The plan config editor?
        if ((args.edit ?? null) !== null) {
            this.setPage(new EditPage(this, globals, args.edit));
            return;
        }

        // No plan file? Show the home page.
        const file = args.file ?? null;
        if (file === null) {
            this.setPage(new HomePage(this, globals));
            return;
        }

        // Load the road plan
        const timeBegin = performance.now();
        if (!this.plans.has(file)) {
            this.render('Roadie', '<h1>Roadie</h1><p class="roadie-loading">Loading the road plan…</p>');
        }
        const data = await this.loadPlan(file);
        if (routeCount !== this.routeCount) {
            return;
        }
        if ('message' in data) {
            const detailHtml = 'detail' in data ? `<p>${escapeHtml(data.detail)}</p>` : '';
            this.render(
                'Roadie',
                `<h1>Roadie</h1><p><strong>Error:</strong> ${escapeHtml(data.message)}</p>${detailHtml}` +
                    '<p><a href="#var=">Open another road plan</a></p>'
            );
            return;
        }

        // Render the road plan report, or the 3D explorer
        if (args.explore) {
            this.setPage(new ExplorePage(this, data, globals, args));
        } else {
            this.setPage(new ReportPage(this, data, globals, args, headerId));
        }
        this.logTime('render', timeBegin);
    }


    setPage(page) {
        this.page?.close?.();
        this.page = page;
    }


    // Get a local storage JSON value - null if it's missing, invalid, or local storage is unavailable
    storageGet(key) {
        try {
            return JSON.parse(this.window.localStorage.getItem(key));
        } catch {
            return null;
        }
    }


    // Set a local storage JSON value, if local storage is available
    storageSet(key, value) {
        try {
            this.window.localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // Local storage is unavailable
        }
    }


    logTime(name, timeBegin) {
        if (this.debug) {
            this.window.console.log(`Roadie: ${name} in ${(performance.now() - timeBegin).toFixed(1)} ms`);
        }
    }


    // Render a page's HTML
    render(title, html, headerId = null) {
        this.document.title = title;
        this.document.body.classList.toggle('roadie-explore', false);
        this.main.innerHTML = html;
        if (headerId !== null) {
            this.document.getElementById(headerId)?.scrollIntoView();
        } else {
            this.window.scrollTo(0, 0);
        }
    }


    // Get Ollama's models' names - none, if Ollama doesn't answer
    async modelList() {
        try {
            const response = await this.window.fetch(`${ollamaHost}/api/tags`);
            const {models} = JSON.parse(await response.text());
            return models.map(({name}) => name).filter((name) => typeof name === 'string');
        } catch {
            return [];
        }
    }


    // The loaded plan, or null. Its "name" is its file's name (null for a new plan), "site" is its plan config (null
    // for a plan made before plans kept theirs), "file" is its road options' local file name - a road plan model (null
    // for a plan without road options), "changed" is true if its plan config was changed since its road options were
    // engineered, and "saved" is false if it has changes that aren't saved to its file.
    get loaded() {
        if (this.loadedValue === undefined) {
            const loaded = this.storageGet(loadedKey);
            this.loadedValue = loaded !== null && typeof loaded === 'object' && 'site' in loaded && 'file' in loaded ? loaded : null;
        }
        return this.loadedValue;
    }


    // Set the loaded plan
    setLoaded(loaded) {
        this.loadedValue = loaded;
        this.storageSet(loadedKey, loaded);
    }


    // Keep a local file - in memory and in IndexedDB. The cached local plans are reloaded - their own files, or their
    // map images, may be the file.
    async storeLocal(name, blob) {
        this.localFiles.set(name, blob);
        const record = {name, 'type': blob.type, blob, 'time': Date.now()};
        await dbRequest(await this.db(), 'readwrite', (store) => store.put(record));
        for (const file of [...this.plans.keys()].filter((planFile) => planFile.startsWith(localPrefix))) {
            this.plans.delete(file);
        }
    }


    // Load a local JSON file as the loaded plan - a plan with road options (a road plan model - it has topography), or
    // a plan config. Returns an error message, or null if it's loaded.
    async loadLocal(name) {
        let value;
        try {
            value = JSON.parse(await (await this.localFile(name)).text());
        } catch {
            return `Could not load "${name}" - it isn't a JSON file`;
        }
        if (value !== null && typeof value === 'object' && 'topography' in value) {
            const validated = validatePlan(value);
            if ('error' in validated) {
                return `The road plan "${name}" is invalid: ${validated.error}`;
            }
            this.setLoaded({name, 'file': name, 'site': validated.plan.site ?? null, 'changed': false, 'saved': true});
        } else {
            const validated = validateSite(value);
            if ('error' in validated) {
                return `The plan config "${name}" is invalid: ${validated.error}`;
            }
            this.setLoaded({name, 'file': null, 'site': validated.site, 'changed': false, 'saved': true});
        }
        return null;
    }


    // Open a local JSON file as the loaded plan, and go to the home page - it shows the loaded plan, or the file's error
    async openLocal(name, globals = {}) {
        const error = await this.loadLocal(name);
        this.openError = error;
        this.goHome(globals);
    }


    // Remove a local file - from memory and from IndexedDB
    async removeLocal(name) {
        this.localFiles.delete(name);
        this.plans.delete(`${localPrefix}${name}`);
        await dbRequest(await this.db(), 'readwrite', (store) => store.delete(name));
    }


    // Close the loaded plan
    closeLoaded() {
        this.setLoaded(null);
        this.fileHandle = null;
    }


    // Confirm that the loaded plan may be replaced (or closed) - if it has changes that aren't saved, the user is asked
    confirmReplace() {
        return this.loaded?.saved !== false || this.window.confirm('The plan has changes that aren\'t saved. Close it anyway?');
    }


    // Open files with the browser's open dialog, if it has one - its file handles are kept, so the plan is saved to its
    // file - or with the home page's file input
    async openPicker() {
        if (!this.confirmReplace()) {
            return;
        }
        const {window} = this;
        if (typeof window.showOpenFilePicker !== 'function') {
            this.document.getElementById('roadie-file').click();
            return;
        }
        let handles;
        try {
            handles = await window.showOpenFilePicker({'multiple': true, 'types': [{
                'description': 'Roadie plans and map images',
                'accept': {
                    'application/json': ['.json'], 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'], 'application/pdf': ['.pdf']
                }
            }]});
        } catch {
            return;
        }
        await this.openFiles(await Promise.all(handles.map((handle) => handle.getFile())), handles);
    }


    // Go to the home page - the loaded plan's
    goHome(globals = {}) {
        const hash = argsURL(globals);
        if (this.window.location.hash === hash) {
            this.route();
        } else {
            this.window.location.hash = hash;
        }
    }
}


// The local storage keys of the loaded plan, and of the last model chosen to run a plan
const loadedKey = 'roadieLoaded';
const modelKey = 'roadieModel';


// Create a file name from a title - without the characters a file's name can't have
export function titleFileName(title) {
    return `${title.replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 100)}.json`;
}


// The plan config's design criteria and cost rates members' labels
function memberText(members) {
    return Object.entries(members).map(([name, value]) => (
        `${name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)} ${value}`
    )).join(', ');
}


// Compute the distance between two latitudes and longitudes, in meters (the haversine formula)
function pointDistance(point1, point2) {
    const radians = Math.PI / 180;
    const dLatitude = (point2.latitude - point1.latitude) * radians;
    const dLongitude = (point2.longitude - point1.longitude) * radians;
    const sinLatitude = Math.sin(dLatitude / 2);
    const sinLongitude = Math.sin(dLongitude / 2);
    const chord = sinLatitude * sinLatitude +
        Math.cos(point1.latitude * radians) * Math.cos(point2.latitude * radians) * sinLongitude * sinLongitude;
    return 2 * 6371008.8 * Math.asin(Math.sqrt(chord));
}


// Create a plan config's summary HTML - its points, the distance between them, its notes, and its criteria
function siteSummaryHtml(site) {
    const pointHtml = (point, label) => `${escapeHtml(point.label ?? label)} (${latLongText([point.latitude, point.longitude])})`;
    const meters = pointDistance(site.start, site.end);
    const distance = site.units === 'feet' ? meters / 0.3048 : meters;
    const html = [
        `<p><strong>Site:</strong> ${pointHtml(site.start, 'Start')} to ${pointHtml(site.end, 'End')} - ` +
            `${number(distance, 0)} ${unitLabel(site.units, 'length')} apart.</p>`
    ];
    if ((site.notes ?? []).length > 0) {
        html.push('<p><strong>Notes:</strong></p>', `<ul>${site.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`);
    }
    const details = [];
    if ('criteria' in site) {
        details.push(`<strong>Design criteria:</strong> ${escapeHtml(memberText(site.criteria))}.`);
    }
    if ('costRates' in site) {
        details.push(`<strong>Cost rates:</strong> ${escapeHtml(memberText(site.costRates))}.`);
    }
    const exclusions = (site.exclusions ?? []).length;
    if (exclusions > 0) {
        details.push(`<strong>Exclusion areas:</strong> ${exclusions}.`);
    }
    if (details.length > 0) {
        html.push(`<p>${details.join(' ')}</p>`);
    }
    return html.join('\n');
}


// Format a duration in milliseconds as minutes and seconds ("1:05")
function durationText(milliseconds) {
    const seconds = Math.round(milliseconds / 1000);
    return `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, '0')}`;
}


// The home page - open a plan, or make a new one. A plan is its config - the road's start and end points, and its
// notes - and, once it's run, its road options. The loaded plan is shown: it's viewed (its road options' report),
// edited (its config), run (which engineers its road options), saved to a file, or closed.
class HomePage {
    constructor(app, globals) {
        this.app = app;
        this.globals = globals;
        this.closed = false;
        this.tools = null;
        this.runResult = null;
        const example = app.main.dataset.example ?? null;
        const html = [
            '<h1>Roadie</h1>',
            '<p>Roadie engineers low-volume roads on USGS lidar terrain. A plan is a road\'s start and end points, and its ' +
                'planning notes - running it engineers its road options on the site\'s terrain, and costs them. A plan\'s ' +
                'road options are viewed in a report, with 3D views.</p>',
            '<div class="roadie-open">',
            '<p class="roadie-actions"><button type="button" id="roadie-open" class="roadie-button">Open Plan</button>' +
                '<button type="button" id="roadie-new" class="roadie-button">New Plan</button>' +
                '<input type="file" id="roadie-file" multiple accept=".json,application/json,image/*,application/pdf" hidden></p>',
            '<p>Open or drop a plan\'s JSON file (and its source map image, to show it in the report). The files stay on your ' +
                'computer.</p>',
            `<p id="roadie-open-status" class="roadie-error">${escapeHtml(app.openError ?? '')}</p>`,
            '</div>',
            '<div id="roadie-loaded"></div>',
            '<div id="roadie-recent"></div>',
            ...(example !== null ? [`<p>${argsLink(globals, 'View the example road plan', {'file': example})}</p>`] : []),
            '<p>To view a road plan model URL, use the "file" argument: <code>#var.vFile=\'plan.json\'</code></p>',
            '<hr>',
            `<p>${argsLink(globals, 'Road plan model documentation', {'doc': true})}</p>`
        ];
        app.openError = null;
        app.render('Roadie', html.join('\n'));
        const {document} = app;
        document.getElementById('roadie-file').addEventListener('change', (event) => app.openFiles(event.target.files));
        document.getElementById('roadie-open').addEventListener('click', () => app.openPicker());
        document.getElementById('roadie-new').addEventListener('click', () => {
            if (app.confirmReplace()) {
                app.window.location.hash = argsURL(globals, {'edit': 'new'});
            }
        });
        this.renderLoaded();
        this.renderRecent();
    }


    close() {
        this.closed = true;
    }


    // The loaded plan's road options - its PlanData, or null
    async planData() {
        const {file} = this.app.loaded;
        if (file === null) {
            return null;
        }
        const data = await this.app.loadPlan(`${localPrefix}${file}`);
        return 'message' in data ? null : data;
    }


    // Render the loaded plan - its actions, its config, and its run
    async renderLoaded() {
        const {app, globals} = this;
        const {loaded} = app;
        const element = app.document.getElementById('roadie-loaded');
        if (loaded === null) {
            element.innerHTML = '';
            return;
        }
        const data = await this.planData();
        if (this.closed) {
            return;
        }
        const {site} = loaded;
        if (data === null && site === null) {
            app.setLoaded(null);
            element.innerHTML = '';
            return;
        }

        // The plan's title, its file, and its actions - its road options are viewed with "View Plan"
        const button = (id, text, isDisabled = false) => (
            `<button type="button" id="${id}" class="roadie-button"${isDisabled ? ' disabled' : ''}>${escapeHtml(text)}</button>`
        );
        const html = [
            `<h2 id="loaded">${escapeHtml(site?.title ?? data.plan.title)}</h2>`,
            `<p class="roadie-loaded-kind">${loaded.name !== null ? `<code>${escapeHtml(loaded.name)}</code>` : 'A new plan'}` +
                `${loaded.saved === false ? ' <span class="roadie-unsaved">Not saved</span>' : ''}</p>`,
            '<p class="roadie-actions">' +
                `${button('roadie-view', 'View Plan', data === null)}${button('roadie-edit', 'Edit Plan', site === null)}` +
                `${button('roadie-save', 'Save')}${button('roadie-save-as', 'Save As…')}${button('roadie-close', 'Close')}</p>`,
            '<p id="roadie-save-status"></p>'
        ];
        if (data === null) {
            html.push('<p>The plan has no road options yet - run the plan to engineer them.</p>');
        } else if (loaded.changed) {
            html.push('<p class="roadie-notice">The plan was edited since its road options were engineered - run the plan to ' +
                'engineer them again.</p>');
        }

        // The plan's config
        if (site !== null) {
            html.push(siteSummaryHtml(site));
        } else {
            html.push('<p>The plan has no config - it was made before plans kept theirs - so it can\'t be edited or run here.</p>');
        }

        // Run the plan - and the last run's result
        if (site !== null) {
            html.push(
                '<h3 id="loaded-run">Run Plan</h3>',
                '<p>A run builds the site from the USGS\'s lidar terrain, and engineers the plan\'s road options - it takes a ' +
                    'minute or two. A model is asked only what the notes ask for.</p>',
                '<p class="roadie-actions"><label>Model: <select id="roadie-run-model"><option value="">No model - the notes ' +
                    'aren\'t read</option></select></label>' +
                    `${button('roadie-run', 'Run Plan', true)}${data !== null ? button('roadie-clear', 'Clear Road Options') : ''}` +
                    '</p>',
                '<p id="roadie-run-message"></p>',
                `<div id="roadie-run-progress"${this.runResult === null ? ' hidden' : ''}>${this.runResultHtml()}</div>`
            );
        }
        element.innerHTML = `<div class="roadie-loaded">\n${html.join('\n')}\n</div>`;

        // The actions
        const {document, window} = app;
        const on = (id, listener) => document.getElementById(id)?.addEventListener('click', listener);
        on('roadie-view', () => {
            window.location.hash = argsURL(globals, {'file': `${localPrefix}${loaded.file}`});
        });
        on('roadie-edit', () => {
            window.location.hash = argsURL(globals, {'edit': 'loaded'});
        });
        on('roadie-save', () => this.save(false));
        on('roadie-save-as', () => this.save(true));
        on('roadie-close', () => {
            if (app.confirmReplace()) {
                app.closeLoaded();
                this.runResult = null;
                this.renderLoaded();
                this.renderRecent();
            }
        });
        on('roadie-clear', () => {
            app.setLoaded({...loaded, 'file': null, 'changed': false, 'saved': false});
            this.runResult = null;
            this.renderLoaded();
            this.renderRecent();
        });
        if (site !== null) {
            on('roadie-run', () => this.run());
            this.prepareRun();
        }
    }


    // Create the last run's result HTML - how it ended, and its report
    runResultHtml() {
        if (this.runResult === null) {
            return '';
        }
        const {code, lines, time, stopped = false} = this.runResult;
        let message;
        if (code === 0) {
            message = `The plan ran in ${time} - its road options are engineered.`;
        } else if (stopped) {
            message = `The plan was stopped, after ${time} - its work was thrown away.`;
        } else {
            message = `The plan failed, after ${time} - its report says why.`;
        }
        return [
            `<p class="roadie-running"><span class="roadie-run-icon roadie-run-${code === 0 ? 'done' : 'failed'}"></span>` +
                `<strong id="roadie-run-status">${escapeHtml(message)}</strong></p>`,
            ...(stopped ? [] : [`<details id="roadie-run-report"${code !== 0 ? ' open' : ''}><summary>The run's report</summary>` +
                `<pre id="roadie-run-log">${escapeHtml(lines.join('\n'))}</pre></details>`])
        ].join('\n');
    }


    // Prepare to run the plan - the planning tools, and Ollama's models
    async prepareRun() {
        const {app} = this;
        const {document} = app;
        try {
            this.tools ??= await app.importPlan();
        } catch {
            if (!this.closed) {
                document.getElementById('roadie-run-message').textContent = 'A plan is run by the Roadie application - this ' +
                    'page doesn\'t have its planning tools. Run the application with "make run".';
            }
            return;
        }
        const models = await app.modelList();
        const select = this.closed ? null : document.getElementById('roadie-run-model');
        if (select !== null) {
            // The model is the last model chosen, if Ollama has it
            const lastModel = app.storageGet(modelKey);
            select.insertAdjacentHTML('beforeend', models.map((model) => (
                `<option${model === lastModel ? ' selected' : ''}>${escapeHtml(model)}</option>`
            )).join(''));
            select.addEventListener('change', () => app.storageSet(modelKey, select.value !== '' ? select.value : null));
            document.getElementById('roadie-run').disabled = false;
        }
    }


    // Run the plan - its steps are shown as it goes, and its road options are the loaded plan's. It may be stopped.
    async run() {
        const {app, tools} = this;
        const {document, window} = app;
        const {loaded} = app;
        const select = document.getElementById('roadie-run-model');
        const model = select.value !== '' ? select.value : null;
        const controls = [select, ...document.querySelectorAll('#roadie-loaded button, #roadie-open, #roadie-new, #roadie-recent button')];
        for (const control of controls) {
            control.disabled = true;
        }

        // The run's button stops it
        const controller = new window.AbortController();
        const runButton = document.getElementById('roadie-run');
        const stopButton = document.createElement('button');
        stopButton.type = 'button';
        stopButton.id = 'roadie-stop';
        stopButton.className = 'roadie-button';
        stopButton.textContent = 'Stop';
        runButton.replaceWith(stopButton);

        // The run's steps - the notes are read only with a model
        const steps = tools.autoSteps.filter(({isModel}) => model !== null || !isModel);
        const progressElement = document.getElementById('roadie-run-progress');
        progressElement.hidden = false;
        progressElement.innerHTML = [
            '<p class="roadie-running"><span class="roadie-spinner"></span><strong id="roadie-run-status">Starting the run…' +
                '</strong><span id="roadie-run-time"></span></p>',
            `<ol id="roadie-run-steps" class="roadie-steps">${steps.map(({key, text}, ixStep) => (
                `<li data-step="${key}" class="roadie-step-pending"><span class="roadie-step-mark"></span>` +
                    `<span class="roadie-step-text">${ixStep + 1}. ${escapeHtml(text)}<span class="roadie-step-detail"></span></span></li>`
            )).join('')}</ol>`
        ].join('\n');
        const statusElement = document.getElementById('roadie-run-status');
        const stepsElement = document.getElementById('roadie-run-steps');
        stopButton.addEventListener('click', () => {
            controller.abort();
            stopButton.disabled = true;
            statusElement.textContent = 'Stopping - the run stops when its current step\'s work is done…';
        });

        // The run's time, every second
        const timeElement = document.getElementById('roadie-run-time');
        const timeBegin = Date.now();
        let isRunning = true;
        const tick = () => {
            if (isRunning && !this.closed) {
                timeElement.textContent = durationText(Date.now() - timeBegin);
                window.setTimeout(tick, 1000);
            }
        };
        tick();

        // The run's status - its step is the current step, and the steps before it are done. The status is drawn before
        // the run goes on.
        const status = (text, stepKey) => {
            if (this.closed) {
                return null;
            }
            const ixStep = steps.findIndex(({key}) => key === stepKey);
            statusElement.textContent = `Running - step ${ixStep + 1} of ${steps.length}`;
            for (const [ixItem, item] of [...stepsElement.children].entries()) {
                item.className = ixItem < ixStep ? 'roadie-step-done' : (ixItem === ixStep ? 'roadie-step-current' : 'roadie-step-pending');
                item.querySelector('.roadie-step-detail').textContent = ixItem === ixStep ? `${text}…` : '';
            }
            return new Promise((resolve) => {
                window.setTimeout(resolve, 0);
            });
        };
        const data = await this.planData();
        let result;
        try {
            result = await tools.planRoad(window, {'site': loaded.site, 'plan': data?.plan ?? null}, {
                model, ollamaHost, status, 'files': app.runFiles, 'signal': controller.signal
            });
        } catch ({message}) {
            result = {'code': 1, 'lines': [`error: ${message}`], 'plan': null};
        }
        isRunning = false;

        // The road options are the loaded plan's - unless another plan was loaded while it ran (the page was left)
        if (result.code === 0 && app.loaded === loaded) {
            const name = loaded.name ?? titleFileName(loaded.site.title);
            await app.storeLocal(name, new window.Blob([planText(result.plan)], {'type': 'application/json'}));
            app.setLoaded({...loaded, name, 'file': name, 'changed': false, 'saved': false});
        }
        if (this.closed) {
            return;
        }
        for (const control of controls) {
            control.disabled = false;
        }
        this.runResult = {...result, 'time': durationText(Date.now() - timeBegin)};
        await this.renderLoaded();
        await this.renderRecent();
    }


    // Save the loaded plan to a file - its file (the file it was opened from, or saved to), or another (save as). The
    // browser's save dialog chooses the file, or, if it has none, the plan is downloaded.
    async save(isSaveAs) {
        const {app} = this;
        const {document, window} = app;
        const {loaded} = app;
        const statusElement = document.getElementById('roadie-save-status');

        // The plan's file text - its road options' plan, with its plan config, or its plan config
        const data = await this.planData();
        let text;
        if (data !== null) {
            text = planText(loaded.site !== null ? orderPlan({...data.plan, 'site': loaded.site}) : data.plan);
        } else {
            text = `${JSON.stringify(loaded.site, null, 4)}\n`;
        }
        const blob = new window.Blob([text], {'type': 'application/json'});
        let name = loaded.name ?? titleFileName(loaded.site.title);
        try {
            let handle = isSaveAs ? null : app.fileHandle;
            if (handle === null && typeof window.showSaveFilePicker === 'function') {
                handle = await window.showSaveFilePicker({
                    'suggestedName': name, 'types': [{'description': 'Roadie plan', 'accept': {'application/json': ['.json']}}]
                });
            }
            if (handle !== null) {
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                app.fileHandle = handle;
                ({name} = handle);
            } else {
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = name;
                link.click();
                window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
            }
        } catch (error) {
            if (!this.closed && error.name !== 'AbortError') {
                statusElement.textContent = `Could not save the plan - ${error.message}`;
            }
            return;
        }

        // The saved plan is the loaded plan - its road options are kept by its new name
        let {file} = loaded;
        if (file !== null && name !== file) {
            await app.storeLocal(name, blob);
            file = name;
        }
        app.setLoaded({...loaded, name, file, 'saved': true});
        if (!this.closed) {
            await this.renderLoaded();
            document.getElementById('roadie-save-status').textContent = `Saved the plan, "${name}".`;
            await this.renderRecent();
        }
    }


    // Render the recent local files - a file is opened as the loaded plan, or removed (but for the loaded plan's road
    // options' file)
    async renderRecent() {
        const {app} = this;
        const recent = (await app.localFileList()).filter(({name}) => name.toLowerCase().endsWith('.json'));
        if (this.closed) {
            return;
        }
        const element = app.document.getElementById('roadie-recent');
        if (recent.length === 0) {
            element.innerHTML = '';
            return;
        }
        const loadedFile = app.loaded?.file ?? null;
        const items = recent.map(({name}) => {
            const nameHtml = escapeHtml(name);
            const removeHtml = name === loadedFile ? ' <span class="roadie-recent-loaded">(the loaded plan)</span>' :
                `<button type="button" class="roadie-remove" data-remove="${nameHtml}" title="Remove it from the recent files" ` +
                    `aria-label="Remove ${nameHtml}">✕</button>`;
            return `<li><p><button type="button" class="roadie-link" data-name="${nameHtml}">${nameHtml}</button>${removeHtml}</p></li>`;
        });
        element.innerHTML = `<h2 id="recent-files">Recent Files</h2><ul class="roadie-recent">${items.join('')}</ul>`;
        for (const button of element.querySelectorAll('button[data-name]')) {
            button.addEventListener('click', () => {
                if (app.confirmReplace()) {
                    app.fileHandle = null;
                    app.openLocal(button.dataset.name, this.globals);
                }
            });
        }
        for (const button of element.querySelectorAll('button[data-remove]')) {
            button.addEventListener('click', async () => {
                await app.removeLocal(button.dataset.remove);
                await this.renderRecent();
            });
        }
    }
}


// The plan config editor page - a new plan's, or the loaded plan's. When it's done, the plan config is the loaded
// plan's. The optional members' defaults are their controls' placeholders.
class EditPage {
    constructor(app, globals, mode) {
        this.app = app;
        this.globals = globals;
        this.isNew = mode === 'new';
        this.closed = false;
        this.siteDefaults = null;
        const {loaded} = app;
        const title = this.isNew ? 'New Plan' : 'Edit the Plan Config';
        if (!this.isNew && (loaded?.site ?? null) === null) {
            app.render(title, `<h1>${title}</h1>\n<p>There's no loaded plan config to edit.</p>\n` +
                `<p>${argsLink(globals, 'Back')}</p>`);
            return;
        }
        this.site = this.isNew ? {'units': 'feet'} : loaded.site;
        app.render(title, [
            `<h1>${title}</h1>`,
            '<p>A plan\'s config is the road\'s start and end points, and its planning notes - the road\'s purpose, constraints, ' +
                'and preferences. A member with a * is required, and an empty member is its default. To set a point, copy ' +
                'its latitude and longitude from a map and paste them into its latitude ("46.16755, -119.16811").</p>',
            `<form id="roadie-site" class="roadie-form">\n${formHtml(roadieTypes, 'RoadSite', this.site)}\n</form>`,
            '<p id="roadie-edit-status" class="roadie-error"></p>',
            '<p class="roadie-actions"><button type="button" id="roadie-edit-done" class="roadie-button">Done</button>' +
                `<a class="roadie-button" href="${escapeHtml(argsURL(globals))}">Cancel</a></p>`
        ].join('\n'));
        const form = app.document.getElementById('roadie-site');
        form.addEventListener('paste', (event) => {
            formPastePoint(form, event);
            this.updateDefaults();
        });
        form.addEventListener('submit', (event) => event.preventDefault());
        form.addEventListener('input', () => this.updateDefaults());
        form.addEventListener('change', () => this.updateDefaults());
        app.document.getElementById('roadie-edit-done').addEventListener('click', () => this.done());
        this.updateDefaults();

        // The site's default margin and grid spacing are the planning tools'
        app.importPlan().then((tools) => {
            this.siteDefaults = tools.siteDefaults;
            this.updateDefaults();
        }, () => null);
    }


    close() {
        this.closed = true;
    }


    // Show the optional members' defaults - the design criteria's (in the plan config's units), the cost rates', and
    // the site's margin and grid spacing (if the planning tools are loaded, and the points are set)
    updateDefaults() {
        if (this.closed) {
            return;
        }
        const form = this.app.document.getElementById('roadie-site');
        const site = formValue(roadieTypes, 'RoadSite', form, this.site);
        const placeholders = {};
        const criteria = planCriteria({'units': site.units});
        for (const [name, value] of Object.entries(criteria)) {
            placeholders[`criteria.${name}`] = `${value}`;
        }
        for (const [name, value] of Object.entries(defaultRates)) {
            placeholders[`costRates.${name}`] = `${value}`;
        }
        const isPoint = (point) => typeof point?.latitude === 'number' && typeof point?.longitude === 'number';
        const defaults = this.siteDefaults !== null && isPoint(site.start) && isPoint(site.end) ? this.siteDefaults(site) : null;
        placeholders.margin = defaults !== null ? `${defaults.margin}` : '';
        placeholders.spacing = defaults !== null ? `${defaults.spacing}` : '';
        formPlaceholders(form, placeholders);
    }


    // The plan config is done - it's the loaded plan's, if it's valid
    done() {
        const {app} = this;
        const site = formValue(roadieTypes, 'RoadSite', app.document.getElementById('roadie-site'), this.site);
        const validated = validateSite(site);
        if ('error' in validated) {
            app.document.getElementById('roadie-edit-status').textContent = validated.error;
            return;
        }
        if (this.isNew) {
            app.closeLoaded();
            app.setLoaded({'name': null, 'file': null, 'site': validated.site, 'changed': false, 'saved': false});
        } else {
            const {loaded} = app;
            app.setLoaded({...loaded, 'site': validated.site, 'changed': loaded.file !== null, 'saved': false});
        }
        app.goHome(this.globals);
    }
}


// The report page - the 3D views are drawn progressively after the page renders, nearest the viewport first
class ReportPage {
    constructor(app, data, globals, args, headerId) {
        this.app = app;
        this.data = data;
        this.globals = globals;
        this.args = args;
        this.closed = false;
        this.timeoutId = null;
        this.observer = null;
        this.width = viewWidth(app.window);
        this.renderReport(headerId);
    }


    renderReport(headerId = null) {
        const {app, data} = this;
        const {window} = app;
        const scrollY = headerId === null && this.report !== undefined ? window.scrollY : null;
        const report = buildReport(data, this.globals, this.args, this.width, true);
        this.report = report;
        app.render(report.title, report.html, headerId);
        if (scrollY !== null) {
            window.scrollTo(0, scrollY);
        }

        // The plan view click handler - open the 3D explorer centered on the clicked ground point, zoomed in 4x
        const planSvg = app.main.querySelector('svg.roadie-plan');
        planSvg?.addEventListener('click', (event) => {
            const rect = planSvg.getBoundingClientRect();
            const {topo} = data;
            const {scale, height, width} = report.plan;
            const pxValue = event.clientX - rect.left;
            const pyValue = event.clientY - rect.top;
            const x = Math.max(0, Math.min(topo.width, (pxValue * width / rect.width - planPad) / scale));
            const y = Math.max(0, Math.min(topo.height, topo.height - (pyValue * height / rect.height - planPad) / scale));
            window.location.hash = argsURL(this.globals, {'explore': true, 'x': round(x, 1), 'y': round(y, 1), 'z': null, 'zoom': 4});
        });

        // Draw the 3D views - the visible ones first, then the rest, one per task so the page stays responsive
        this.canvases = [...app.main.querySelectorAll('canvas[data-view]')];
        this.drawings = this.canvases.map(() => null);
        this.pending = new Set(this.canvases.keys());
        this.observer?.disconnect();
        this.observer = new window.IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    this.drawView(parseInt(entry.target.dataset.view, 10));
                }
            }
        }, {'rootMargin': '50% 0px'});
        for (const [ixView, canvas] of this.canvases.entries()) {
            this.observer.observe(canvas);
            canvas.addEventListener('mousemove', (event) => showCanvasTitle(canvas, this.drawings[ixView], event));
        }
        this.scheduleViews();
    }


    // Draw a 3D view as finely as fits its time budget
    drawView(ixView) {
        if (this.closed || !this.pending.has(ixView)) {
            return;
        }
        this.pending.delete(ixView);
        this.observer.unobserve(this.canvases[ixView]);
        const {app} = this;
        const {smoothing, window} = app;
        const timeBegin = performance.now();
        const points = smoothing.targetPoints(reportBudget);
        const drawing = this.report.views[ixView].render({...smoothLimitsCanvas, points});
        this.drawings[ixView] = drawing;
        paintCanvas(this.canvases[ixView], drawing, window.devicePixelRatio || 1, false);

        // Measure the drawing - through the next animation frame, so the canvas's rasterization counts
        const cells = countCells(drawing);
        window.requestAnimationFrame(() => {
            smoothing.recordCost(performance.now() - timeBegin, cells);
            app.storageSet(cellCostKey, smoothing.cellCost);
            app.logTime(`3D view ${ixView + 1} - ${drawing.ops.length} operations, ${cells} cells, step ${drawing.step}, ` +
                `smooth ${drawing.smooth}${drawing.pointLimited ? ` (${points} point limit)` : ''} - drawn`, timeBegin);
        });
    }


    scheduleViews() {
        this.app.window.clearTimeout(this.timeoutId);
        this.timeoutId = this.app.window.setTimeout(() => {
            const [ixView] = this.pending;
            if (ixView !== undefined) {
                this.drawView(ixView);
                this.scheduleViews();
            }
        }, 0);
    }


    resize() {
        const width = viewWidth(this.app.window);
        if (width !== this.width) {
            this.width = width;
            this.app.window.clearTimeout(this.resizeId);
            this.resizeId = this.app.window.setTimeout(() => this.renderReport(), 100);
        }
    }


    // Draw every 3D view before printing - at print resolution (at least twice the screen's, about 300 dots per inch for a
    // report-width view)
    print() {
        for (const ixView of [...this.pending]) {
            this.drawView(ixView);
        }
        const ratio = Math.max(printRatio, this.app.window.devicePixelRatio || 1);
        for (const [ixView, canvas] of this.canvases.entries()) {
            if (this.drawings[ixView] !== null) {
                paintCanvas(canvas, this.drawings[ixView], ratio, false);
            }
        }
    }


    close() {
        this.closed = true;
        this.app.window.clearTimeout(this.timeoutId);
        this.app.window.clearTimeout(this.resizeId);
        this.observer?.disconnect();
    }
}


// The 3D explorer page - drawn on a canvas, redrawn once per animation frame as the keys change the view. Smooth terrain
// is drawn as finely as fits the moving view's frame time budget, then, once the keys stop, as finely as fits the still
// view's budget (smoothing.js). The road segments' tooltips (the SVG drawing's titles) are found by hit-testing the
// drawing operations.
class ExplorePage {
    constructor(app, data, globals, args) {
        this.app = app;
        this.explorer = new Explorer(data, globals, args);
        this.frameId = null;
        this.refineId = null;
        this.drawing = null;
        app.document.title = `${data.plan.title} - 3D`;
        app.document.body.classList.toggle('roadie-explore', true);
        app.window.scrollTo(0, 0);
        app.main.innerHTML = '<div class="roadie-explorer"><canvas role="img"></canvas>' +
            `<a class="roadie-explorer-back" href="${escapeHtml(this.explorer.backURL())}">Back to the report</a></div>`;
        this.canvas = app.main.querySelector('canvas');
        this.canvas.setAttribute('style', exploreStyle);
        this.back = app.main.querySelector('a');
        this.canvas.addEventListener('mousemove', (event) => showCanvasTitle(this.canvas, this.drawing, event));
        this.draw(false);
    }


    size() {
        const {window} = this.app;
        return [Math.max(320, window.innerWidth - 3 * fontSize), Math.max(240, window.innerHeight - 3 * fontSize)];
    }


    // Draw the view - "still" draws the smooth terrain for the still view's frame time budget
    draw(still) {
        this.frameId = null;
        const {app, canvas} = this;
        const {smoothing, window} = app;
        const timeBegin = performance.now();
        const [width, height] = this.size();
        const points = smoothing.points(still);
        const drawing = this.explorer.render(width, height, {...smoothLimitsCanvas, points});
        this.drawing = drawing;
        const timeBuilt = performance.now();
        canvas.setAttribute('aria-label', drawing.label);
        paintCanvas(canvas, drawing, window.devicePixelRatio || 1, true);
        const timePainted = performance.now();
        this.back.href = this.explorer.backURL();
        canvas.dataset.frame = `${parseInt(canvas.dataset.frame ?? '0', 10) + 1}`;

        // Measure the frame - through the next animation frame, so the canvas's rasterization counts
        const cells = countCells(drawing);
        window.requestAnimationFrame(() => {
            const frameTime = performance.now() - timeBegin;
            smoothing.record(frameTime, cells, still);
            if (still) {
                app.storageSet(cellCostKey, smoothing.cellCost);
            }
            app.logTime(`3D explorer ${still ? 'still' : 'moving'} frame - ${drawing.ops.length} operations, ${cells} cells, ` +
                `step ${drawing.step}, smooth ${drawing.smooth}${drawing.pointLimited ? ` (${points} point limit)` : ''} - built in ` +
                `${(timeBuilt - timeBegin).toFixed(1)} ms, painted in ${(timePainted - timeBuilt).toFixed(1)} ms, frame`, timeBegin);
        });

        // Once the keys stop, draw the still view, if its larger budget draws the terrain more finely
        window.clearTimeout(this.refineId);
        this.refineId = null;
        if (!still && drawing.pointLimited) {
            this.refineId = window.setTimeout(() => {
                this.refineId = null;
                if (smoothing.points(true) > points) {
                    this.draw(true);
                }
            }, refineDelay);
        }
    }


    scheduleDraw() {
        this.app.window.clearTimeout(this.refineId);
        this.refineId = null;
        if (this.frameId === null) {
            this.frameId = this.app.window.requestAnimationFrame(() => this.draw(false));
        }
    }


    resize() {
        this.scheduleDraw();
    }


    keyDown(event) {
        // Leave the keys of focused inputs alone
        const {activeElement} = this.app.document;
        if (activeElement !== null && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' ||
            activeElement.tagName === 'SELECT' || activeElement.isContentEditable)) {
            return;
        }
        const [width, height] = this.size();
        const result = this.explorer.keyDown(event, width, height);
        if (result === 'back') {
            this.app.window.location.hash = this.explorer.backURL();
        } else if (result === 'render') {
            event.preventDefault();
            this.scheduleDraw();
        }
    }


    close() {
        if (this.frameId !== null) {
            this.app.window.cancelAnimationFrame(this.frameId);
        }
        this.app.window.clearTimeout(this.refineId);
        this.app.document.body.classList.toggle('roadie-explore', false);
        this.app.storageSet(cellCostKey, this.app.smoothing.cellCost);
    }
}
