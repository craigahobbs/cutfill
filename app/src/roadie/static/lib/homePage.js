// homePage.js - the Roadie application's home page - open a plan, or make a new one, and the loaded plan: view it,
// edit its config, run it, save it, and close it - and its plan config editor page

import {argsLink, argsURL, localPrefix} from './args.js';
import {defaultRates, orderPlan, planCriteria, planText, roadieTypes, unitScale, validateSite} from './model.js';
import {escapeHtml, number, unitLabel} from './format.js';
import {formHtml, formPastePoint, formPlaceholders, formValue, memberWords} from './form.js';
import {latLongDistance, latLongText} from './geo.js';


// The local storage key of the last model chosen to run a plan
const modelKey = 'roadieModel';


// Create a file name from a title - without the characters a file's name can't have
export function titleFileName(title) {
    return `${title.replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 100)}.json`;
}


// The plan config's design criteria's and cost rates' text - each member's words, and its value
function memberText(members) {
    return Object.entries(members).map(([name, value]) => `${memberWords(name)} ${value}`).join(', ');
}


// Create a plan config's summary HTML - its points, the distance between them, its notes, its criteria and cost rates,
// and its marks' counts
function siteSummaryHtml(site) {
    const pointHtml = (point, label) => `${escapeHtml(point.label ?? label)} (${latLongText([point.latitude, point.longitude])})`;
    const distance = latLongDistance(site.start, site.end) / unitScale(site);
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
    const marks = [['exclusions', 'Exclusion areas'], ['roads', 'Existing roads'], ['passThrough', 'Places to pass through']];
    for (const [member, name] of marks) {
        const count = (site[member] ?? []).length;
        if (count > 0) {
            details.push(`<strong>${name}:</strong> ${count}.`);
        }
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
export class HomePage {
    constructor(app, globals) {
        this.app = app;
        this.globals = globals;
        this.closed = false;
        this.tools = null;
        this.models = null;
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

    // Render the loaded plan - its actions, its config, and its run
    async renderLoaded() {
        const {app, globals} = this;
        const {loaded} = app;
        const element = app.document.getElementById('roadie-loaded');
        if (loaded === null) {
            element.innerHTML = '';
            return;
        }
        const value = await app.loadedPlan();
        const hasOptions = (value?.options.length ?? 0) > 0;
        if (this.closed) {
            return;
        }
        const {site} = loaded;
        if (value === null && site === null) {
            app.setLoaded(null);
            element.innerHTML = '';
            return;
        }

        // The plan's title, its file, and its actions - its road options are viewed with "View Plan", in a new tab
        const button = (id, text, isDisabled = false) => (
            `<button type="button" id="${id}" class="roadie-button"${isDisabled ? ' disabled' : ''}>${escapeHtml(text)}</button>`
        );
        const viewURL = argsURL(globals, {'file': `${localPrefix}${loaded.file}`});
        const viewHtml = hasOptions ?
            `<a id="roadie-view" class="roadie-button" href="${escapeHtml(viewURL)}" target="_blank" rel="noopener">View Plan</a>` :
            button('roadie-view', 'View Plan', true);
        const html = [
            `<h2 id="loaded">${escapeHtml(site?.title ?? value.title)}</h2>`,
            `<p class="roadie-loaded-kind">${loaded.name !== null ? `<code>${escapeHtml(loaded.name)}</code>` : 'A new plan'}` +
                `${loaded.saved === false ? ' <span class="roadie-unsaved">Not saved</span>' : ''}</p>`,
            '<p class="roadie-actions">' +
                `${viewHtml}${button('roadie-edit', 'Edit Plan', site === null)}` +
                `${button('roadie-map', 'Edit Map', site === null || !('georeference' in (value ?? {})))}` +
                `${button('roadie-save', 'Save')}${button('roadie-save-as', 'Save As…')}${button('roadie-close', 'Close')}</p>`,
            '<p id="roadie-save-status"></p>'
        ];
        if (value === null) {
            html.push('<p>The plan has no road options yet - run the plan to engineer them.</p>');
        } else if (!hasOptions) {
            html.push('<p>The plan has no road options - run the plan to engineer them. Its site\'s data (its terrain, streams, ' +
                'roads, and map) is kept, so a run doesn\'t fetch it from the USGS again.</p>');
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
                    `${button('roadie-run', 'Run Plan', true)}${hasOptions ? button('roadie-clear', 'Clear Road Options') : ''}` +
                    '</p>',
                ...(value !== null ? ['<p><label><input type="checkbox" id="roadie-run-fetch"> Fetch the site\'s data from the USGS ' +
                    'again - its terrain, streams, roads, and map (a site with other points, units, margin, or spacing is fetched ' +
                    'anyway)</label></p>'] : []),
                '<p id="roadie-run-message"></p>',
                `<div id="roadie-run-progress"${this.runResult === null ? ' hidden' : ''}>${this.runResultHtml()}</div>`
            );
        }
        element.innerHTML = `<div class="roadie-loaded">\n${html.join('\n')}\n</div>`;

        // The actions
        const {document, window} = app;
        const on = (id, listener) => document.getElementById(id)?.addEventListener('click', listener);
        on('roadie-edit', () => {
            window.location.hash = argsURL(globals, {'edit': 'loaded'});
        });
        on('roadie-map', () => {
            window.location.hash = argsURL(globals, {'map': true});
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
        on('roadie-clear', async () => {
            // The plan's road options and their description are cleared - its site's data is kept
            const cleared = Object.fromEntries(Object.entries(value).filter(([member]) => member !== 'description'));
            await app.storeLocal(loaded.file, new window.Blob([planText({...cleared, 'options': []})], {'type': 'application/json'}));
            app.setLoaded({...loaded, 'changed': false, 'saved': false});
            this.runResult = null;
            await this.renderLoaded();
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
        this.models ??= await app.modelList(this.tools.ollamaHostDefault);
        const {models} = this;
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
        const fetchElement = document.getElementById('roadie-run-fetch');
        const fetch = fetchElement?.checked ?? false;
        const controls = [select, ...document.querySelectorAll(
            '#roadie-loaded button, #roadie-run-fetch, #roadie-open, #roadie-new, #roadie-recent button'
        )];
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
                    `<span>${ixStep + 1}. ${escapeHtml(text)}<span class="roadie-step-detail"></span></span></li>`
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
        const plan = await app.loadedPlan();
        let result;
        try {
            result = await tools.planRoad(window, {'site': loaded.site, plan}, {
                model, status, 'files': app.runFiles, 'signal': controller.signal, fetch
            });
        } catch ({message}) {
            result = {'code': 1, 'lines': [`error: ${message}`], 'plan': null};
        }
        isRunning = false;

        // The road options are the loaded plan's - unless another plan was loaded while it ran (the page was left) - and
        // its config is the run's: the places its notes name that the run found are its marks, and its margin may be larger
        if (result.code === 0 && app.loaded === loaded) {
            const name = loaded.name ?? titleFileName(loaded.site.title);
            await app.storeLocal(name, new window.Blob([planText(result.plan)], {'type': 'application/json'}));
            app.setLoaded({...loaded, name, 'file': name, 'site': result.plan.site, 'changed': false, 'saved': false});
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

        // The plan's file text - its road plan model (its site's data, and its road options), with its config, or its
        // config
        const value = await app.loadedPlan();
        let text;
        if (value !== null) {
            text = planText(loaded.site !== null ? orderPlan({...value, 'site': loaded.site}) : value);
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
export class EditPage {
    constructor(app, globals, mode) {
        this.app = app;
        this.globals = globals;
        this.isNew = mode === 'new';
        this.closed = false;
        this.siteDefaults = null;
        const {loaded} = app;
        const title = this.isNew ? 'New Plan' : 'Edit Plan';
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
