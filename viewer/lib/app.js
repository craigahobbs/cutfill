// app.js - the SageRoad viewer web application - its pages' routing, its local files, and its loaded plan

import {EditPage, HomePage} from './homePage.js';
import {ExplorePage, ReportPage, cellCostKey} from './viewPages.js';
import {argsParse, argsURL, localPrefix, parseHash} from './args.js';
import {validatePlan, validateSite, validateSitePlan} from './model.js';
import {AdaptiveSmoothing} from './smoothing.js';
import {MapPage} from './mapPage.js';
import {PlanData} from './planData.js';
import {buildDoc} from './doc.js';
import {escapeHtml} from './format.js';
import {planImageURL} from './report.js';


// The local storage key of the loaded plan
const loadedKey = 'sageRoadLoaded';


//
// Local files - kept in memory and in IndexedDB, so a local plan survives reloads
//


const dbName = 'sageroad-viewer';
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


export class SageRoadApp {
    constructor(window) {
        this.window = window;
        this.document = window.document;
        this.main = this.document.getElementById('sageroad');
        this.plans = new Map();
        this.localFiles = new Map();
        this.dbPromise = null;
        this.adaptiveSmoothing = null;
        this.page = null;
        this.routeCount = 0;
        this.printing = false;
        this.debug = window.location.search.includes('debug');

        // Import the planning tools - they run a plan in the browser. The tools are the SageRoad application's (the
        // project's web site doesn't have them), and its page's import map has their Node modules. The runs' files are
        // kept - the terrain cache, and the model's saved answers - so a plan run again doesn't fetch them again.
        this.importPlan = () => import('../../plan/lib/browser/io.js');
        this.runFiles = new Map();
        this.planValues = new WeakMap();
        this.imageURLs = new WeakMap();
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
        this.document.addEventListener('keydown', (event) => {
            // The keys of a focused input are its own
            const {activeElement} = this.document;
            const isInput = activeElement !== null && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' ||
                activeElement.tagName === 'SELECT' || activeElement.isContentEditable);
            if (!isInput) {
                this.page?.keyDown?.(event);
            }
        });

        // Open dropped plan files anywhere
        this.document.addEventListener('dragover', (event) => {
            event.preventDefault();
            this.document.body.classList.add('sageroad-drop');
        });
        this.document.addEventListener('dragleave', (event) => {
            if (event.relatedTarget === null) {
                this.document.body.classList.remove('sageroad-drop');
            }
        });
        this.document.addEventListener('drop', (event) => {
            event.preventDefault();
            this.document.body.classList.remove('sageroad-drop');
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


    // The loaded plan's road plan model - its site's data, and its road options (an empty array if it has none) - or
    // null if it has neither. A file's plan is read once.
    async loadedPlan() {
        const {file} = this.loaded;
        const blob = file !== null ? await this.localFile(file) : null;
        if (blob === null) {
            return null;
        }
        if (!this.planValues.has(blob)) {
            let value = null;
            try {
                value = validateSitePlan(JSON.parse(await blob.text())).plan ?? null;
            } catch {
                // The file isn't a plan
            }
            this.planValues.set(blob, value);
        }
        return this.planValues.get(blob);
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

        // The source map image
        const {image} = validated.plan;
        if (image !== undefined) {
            const {url, missing} = await this.imageURL(isLocal ? null : file, image);
            if (missing) {
                data.imageMissing = image;
            } else {
                data.imageURL = url;
            }
        }
        return data;
    }


    // Get a plan's map image's URL - "file" is the plan's URL, or null for a local plan: its image is a local file of the
    // image's name (unless it's a data URL - the image itself), whose object URL is made once. Returns the "url" (null
    // if a local plan's image file is "missing").
    async imageURL(file, image) {
        if (file !== null || /^data:/i.test(image)) {
            return {'url': planImageURL(file ?? '', image), 'missing': false};
        }
        const blob = await this.localFile(image.slice(image.lastIndexOf('/') + 1));
        if (blob === null) {
            return {'url': null, 'missing': true};
        }
        if (!this.imageURLs.has(blob)) {
            this.imageURLs.set(blob, this.window.URL.createObjectURL(blob));
        }
        return {'url': this.imageURLs.get(blob), 'missing': false};
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

        // The plan config editor, or its marks' map?
        if ((args.edit ?? null) !== null) {
            this.setPage(new EditPage(this, globals, args.edit));
            return;
        } else if (args.map) {
            this.setPage(new MapPage(this, globals));
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
            this.render('SageRoad', '<h1>SageRoad</h1><p class="sageroad-loading">Loading the road plan…</p>');
        }
        const data = await this.loadPlan(file);
        if (routeCount !== this.routeCount) {
            return;
        }
        if ('message' in data) {
            const detailHtml = 'detail' in data ? `<p>${escapeHtml(data.detail)}</p>` : '';
            this.render(
                'SageRoad',
                `<h1>SageRoad</h1><p><strong>Error:</strong> ${escapeHtml(data.message)}</p>${detailHtml}` +
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
            this.window.console.log(`SageRoad: ${name} in ${(performance.now() - timeBegin).toFixed(1)} ms`);
        }
    }


    // Render a page's HTML
    render(title, html, headerId = null) {
        this.document.title = title;
        this.document.body.classList.toggle('sageroad-explore', false);
        this.main.innerHTML = html;
        if (headerId !== null) {
            this.document.getElementById(headerId)?.scrollIntoView();
        } else {
            this.window.scrollTo(0, 0);
        }
    }


    // Get the names of the models of an Ollama host (the planning tools' default) - none, if Ollama doesn't answer
    async modelList(ollamaHost) {
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
            const validated = validateSitePlan(value);
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
            this.document.getElementById('sageroad-file').click();
            return;
        }
        let handles;
        try {
            handles = await window.showOpenFilePicker({'multiple': true, 'types': [{
                'description': 'SageRoad plans and map images',
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
