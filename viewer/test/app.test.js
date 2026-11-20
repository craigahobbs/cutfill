import {FakeIndexedDB, fakeBrowser, fire, flush, startApp} from './appHelpers.js';
import {SageRoadApp} from '../lib/app.js';
import assert from 'node:assert/strict';
import {fixturePlan} from './fixture.js';
import {ollamaMissingHtml} from '../lib/modelsPage.js';
import test from 'node:test';
import {titleFileName} from '../lib/homePage.js';


// The fixture plan's JSON text, and the files of a server with it
const fixtureText = JSON.stringify(fixturePlan());
const fixtureFiles = {'plans/fixture.json': fixtureText};


// A measured terrain cell cost, in local storage, that keeps the 3D drawings small
const storage = {'sageRoadCellCost': '1'};


// The home page's HTML, with its recent files' HTML, its documentation link's URL, its loaded plan's HTML, and its
// opened file's error message
function homeHtml(recentHtml = '', docURL = '#var.vDoc=true', loadedHtml = '', errorText = '') {
    return [
        '<h1>SageRoad</h1>',
        '<p>SageRoad engineers low-volume roads on USGS lidar terrain. A plan is a road\'s start and end points, and its planning ' +
            'notes - running it engineers its road options on the site\'s terrain, and costs them. A plan\'s road options are ' +
            'viewed in a report, with 3D views.</p>',
        '<div class="sageroad-open">',
        '<p class="sageroad-actions"><button type="button" id="sageroad-open" class="sageroad-button">Open Plan</button>' +
            '<button type="button" id="sageroad-new" class="sageroad-button">New Plan</button>' +
            '<input type="file" id="sageroad-file" multiple="" accept=".json,application/json,image/*,application/pdf" hidden=""></p>',
        '<p>Open or drop a plan\'s JSON file (and its source map image, to show it in the report). The files stay on your ' +
            'computer.</p>',
        `<p id="sageroad-open-status" class="sageroad-error">${errorText}</p>`,
        '</div>',
        `<div id="sageroad-loaded">${loadedHtml}</div>`,
        `<div id="sageroad-recent">${recentHtml}</div>`,
        '<p>To view a road plan model URL, use the "file" argument: <code>#var.vFile=\'plan.json\'</code></p>',
        '<hr>',
        `<p><a href="${docURL}">Road plan model documentation</a></p>`
    ].join('\n');
}


// An error page's HTML
function errorHtml(messageHtml) {
    return `<h1>SageRoad</h1><p>${messageHtml}</p><p><a href="#var=">Open another road plan</a></p>`;
}


// The loading page's HTML
const loadingHtml = '<h1>SageRoad</h1><p class="sageroad-loading">Loading the road plan…</p>';


// Create a local file
function localFile(browser, name, text, type = 'application/json') {
    return new browser.window.File([text], name, {type});
}


// Select files with the home page's file input
async function selectFiles(browser, files) {
    const input = browser.document.getElementById('sageroad-file');
    Object.defineProperty(input, 'files', {'value': files, 'configurable': true});
    fire(browser, input, 'change');
    await flush();
}


// Flush until a condition is true - the home page's loaded plan is rendered after its plan is analyzed
async function flushUntil(condition) {
    for (let count = 0; count < 20 && !condition(); count++) {
        await flush();
    }
    assert.ok(condition());
}


// View the loaded plan - its home page's "View Plan" link, which opens in a new tab (here, the same tab)
async function viewLoaded(browser) {
    await flushUntil(() => browser.document.querySelector('a#sageroad-view') !== null);
    const link = browser.document.getElementById('sageroad-view');
    assert.deepEqual([link.target, link.rel], ['_blank', 'noopener']);
    browser.window.location.hash = link.getAttribute('href');
    await flushUntil(() => browser.document.title !== 'SageRoad');
}


// Drop files on the page
async function dropFiles(browser, files) {
    const event = fire(browser, browser.document.body, 'drop', {'dataTransfer': {files}});
    await flush();
    return event;
}


// The report page's headings' text
function headings(browser) {
    return [...browser.main.querySelectorAll('h1, h2, h3')].map((heading) => heading.textContent);
}


// The report page's headings of the fixture plan's first option
const directHeadings = [
    'Fixture Plan', 'Plan Options', 'Direct', 'Plan View', 'Profile', '3D Views', 'Cost', 'Design Warnings', 'Structures'
];


test('the home page', async (context) => {
    const browser = fakeBrowser(context);
    const {document, indexedDB, main} = browser;
    const app = await startApp(browser);
    assert.equal(document.title, 'SageRoad');
    assert.equal(main.innerHTML, homeHtml());
    assert.deepEqual(browser.scrolls, [['scrollTo', 0, 0]]);
    assert.equal(app.page.constructor.name, 'HomePage');

    // The local files database is created, and its files are listed - there are none
    assert.equal(indexedDB.name, 'sageroad-viewer');
    assert.equal(indexedDB.version, 1);
    assert.deepEqual([...indexedDB.stores], [['files', {'keyPath': 'name', 'records': new Map()}]]);
    assert.deepEqual(indexedDB.requests, [['files', 'readonly', 'getAll', null]]);

    // Nothing is fetched, logged, or drawn
    assert.deepEqual(browser.fetches, []);
    assert.deepEqual(browser.logs, []);
    assert.equal(browser.clock.timeouts.size, 0);
    assert.equal(browser.clock.frames.size, 0);

    // The page has no keys, and nothing to draw when the window is resized or printed
    assert.equal(fire(browser, document, 'keydown', {'code': 'KeyQ', 'key': 'q'}).defaultPrevented, false);
    assert.equal(fire(browser, document, 'keydown', {'code': 'Escape', 'key': 'Escape'}).defaultPrevented, false);
    browser.window.innerWidth = 800;
    fire(browser, browser.window, 'resize');
    fire(browser, browser.window, 'beforeprint');
    fire(browser, browser.window, 'afterprint');
    assert.equal(browser.window.location.hash, '');
    assert.equal(main.innerHTML, homeHtml());
    assert.deepEqual(browser.scrolls, [['scrollTo', 0, 0]]);
    assert.equal(browser.clock.timeouts.size, 0);
    assert.equal(browser.clock.frames.size, 0);
});


test('the home page with an example road plan', async (context) => {
    // The page's element has the example plan's URL - the home page links to it
    const browser = fakeBrowser(context, {'files': fixtureFiles});
    const {main} = browser;
    main.dataset.example = 'plans/fixture.json';
    await startApp(browser);
    const exampleLink = '<p><a href="#var.vFile=\'plans%2Ffixture.json\'">View the example road plan</a></p>';
    assert.equal(main.innerHTML, homeHtml().replace('<p>To view a road plan', `${exampleLink}\n<p>To view a road plan`));
    assert.deepEqual(browser.fetches, []);

    // The link opens the example's report
    browser.window.location.hash = main.querySelector('a[href*="vFile"]').getAttribute('href');
    await flush();
    assert.deepEqual(browser.fetches, ['plans/fixture.json']);
    assert.equal(browser.document.title, 'Fixture Plan');
});


// Ollama's models' URL, and its response
const modelsURL = 'http://127.0.0.1:11434/api/tags';
const modelsText = JSON.stringify({'models': [{'name': 'qwen:27b'}, {'name': 5}, {'name': 'a<b'}]});
const showURL = 'http://127.0.0.1:11434/api/show';


// A plan config, and a loaded plan of it (in local storage) - opened from a file, without road options
const siteConfig = {
    'title': 'Hill Road',
    'units': 'meters',
    'start': {'latitude': 46.1, 'longitude': -119.2, 'label': 'Road end'},
    'end': {'latitude': 46.2, 'longitude': -119.1},
    'notes': ['Stay off the barn.', 'A <gravel> road.'],
    'exclusions': [{'points': [
        {'latitude': 46.1, 'longitude': -119.1}, {'latitude': 46.2, 'longitude': -119.1}, {'latitude': 46.2, 'longitude': -119.2}
    ]}],
    'criteria': {'maxGrade': 10, 'minRadius': 15},
    'costRates': {'gravel': 12}
};
const loadedConfig = {'name': 'hill.json', 'file': null, 'site': siteConfig, 'changed': false, 'saved': true};


// The fixture plan with road options, made from the plan config
const sitePlan = {...fixturePlan(), 'site': siteConfig};


// The planning tools' steps
const toolSteps = [
    {'key': 'site', 'text': 'Build the site', 'isModel': false},
    {'key': 'notes', 'text': 'Read the notes', 'isModel': true},
    {'key': 'options', 'text': 'Engineer the road options', 'isModel': false}
];


// Start the application with fake planning tools - "results" are their runs' results (a result, or a function that
// returns one). The tools record their runs' arguments ("calls").
async function startToolsApp(browser, results = []) {
    const app = new SageRoadApp(browser.window);
    const calls = [];
    app.importPlan = () => Promise.resolve({
        'autoSteps': toolSteps,
        'siteDefaults': (site) => ({'margin': Math.round(site.end.latitude * 1000), 'spacing': 5}),
        'ollamaHostDefault': 'http://127.0.0.1:11434',
        'planRoad': async (window, {site, plan}, {model, status, files, signal, fetch}) => {
            calls.push({
                'isWindow': window === browser.window, site, plan, model, 'isFiles': files === app.runFiles,
                'isSignal': signal instanceof browser.window.AbortSignal
            });
            Object.defineProperty(calls.at(-1), 'fetch', {'value': fetch});
            Object.defineProperty(calls.at(-1), 'signal', {'value': signal});
            await status('Creating the <site>', 'site');
            await status('Engineering the options', 'options');
            const result = results.shift();
            return typeof result === 'function' ? result() : result;
        }
    });
    app.start();
    await flush();
    return {app, calls};
}


// Run the application's timeouts until there are none - a run's status is drawn before the run goes on
async function runTimeouts(browser) {
    await flush();
    while (browser.clock.timeouts.size > 0) {
        browser.clock.runTimeout();
        await flush();
    }
}


// The loaded plan's element
function loadedElement(browser) {
    return browser.document.getElementById('sageroad-loaded');
}


// The loaded plan's actions' text - and whether they're disabled
function loadedActions(browser) {
    return [...loadedElement(browser).querySelectorAll('.sageroad-actions a, .sageroad-actions button')].
        filter((element) => !element.hidden).map((element) => `${element.textContent}${element.disabled ? ' (disabled)' : ''}`);
}


// Wait for the loaded plan's run to be done - its result is shown
async function runDone(browser) {
    await flushUntil(() => browser.document.querySelector('.sageroad-run-icon') !== null);
}


// Click a button of the page
function click(browser, id) {
    fire(browser, browser.document.getElementById(id), 'click');
}


// Start the application with a loaded plan in local storage
function loadedBrowser(context, loaded, options = {}) {
    return fakeBrowser(context, {...options, 'storage': {...storage, 'sageRoadLoaded': JSON.stringify(loaded)}});
}


test('titleFileName', () => {
    // A new plan's file name is its title's, without the characters a file's name can't have
    assert.equal(titleFileName(' Hill: Road / East? '), 'Hill- Road - East-.json');
    assert.equal(titleFileName('x'.repeat(120)), `${'x'.repeat(100)}.json`);
});


test('the loaded plan', async (context) => {
    // A loaded plan without road options - its config's site, notes, and criteria, and it's run to engineer them
    const browser = loadedBrowser(context, loadedConfig, {'files': {[modelsURL]: modelsText}});
    const {app} = await startToolsApp(browser);
    assert.deepEqual(app.loaded, loadedConfig);
    const element = loadedElement(browser);
    assert.deepEqual([...element.querySelectorAll('h2, h3')].map((heading) => heading.textContent), ['Hill Road', 'Run Plan']);
    assert.equal(element.querySelector('.sageroad-loaded-kind').innerHTML, '<code>hill.json</code>');
    assert.deepEqual([...element.querySelectorAll('p')].slice(2, 7).map((paragraph) => paragraph.innerHTML), [
        '',
        'The plan has no road options yet - run the plan to engineer them.',
        '<strong>Site:</strong> Road end (46.10000, -119.20000) to End (46.20000, -119.10000) - 13,527 m apart.',
        '<strong>Notes:</strong>',
        '<strong>Design criteria:</strong> max grade 10, min radius 15. <strong>Cost rates:</strong> gravel 12. ' +
            '<strong>Exclusion areas:</strong> 1.'
    ]);
    assert.deepEqual([...element.querySelectorAll('li')].map((item) => item.innerHTML), ['Stay off the barn.', 'A &lt;gravel&gt; road.']);
    assert.deepEqual(loadedActions(browser), [
        'View Plan (disabled)', 'Edit Plan', 'Edit Map (disabled)', 'Download', 'Close', 'Run Plan', 'Ollama Models'
    ]);
    const modelOptions = [...browser.document.getElementById('sageroad-run-model').options];
    assert.deepEqual(modelOptions.map(({value, textContent}) => [value, textContent]), [
        ['', 'No model - the notes aren\'t read'], ['a<b', 'a<b'], ['qwen:27b', 'qwen:27b']
    ]);
    assert.equal(browser.document.getElementById('sageroad-run-progress').hidden, true);
    assert.deepEqual(browser.fetches, [modelsURL, showURL, showURL]);

    // A new plan, without notes, criteria, or exclusions - in feet - that isn't saved
    const {notes, exclusions, criteria, costRates, ...plain} = siteConfig;
    assert.deepEqual([notes.length, exclusions.length, 'maxGrade' in criteria, 'gravel' in costRates], [2, 1, true, true]);
    const plainBrowser = loadedBrowser(context, {...loadedConfig, 'name': null, 'site': {...plain, 'units': 'feet'}, 'saved': false});
    await startToolsApp(plainBrowser);
    assert.equal(loadedElement(plainBrowser).querySelector('.sageroad-loaded-kind').innerHTML,
        'A new plan <span class="sageroad-unsaved">Not saved</span>');
    assert.ok(loadedElement(plainBrowser).innerHTML.includes(
        '<p><strong>Site:</strong> Road end (46.10000, -119.20000) to End (46.20000, -119.10000) - 44,380 ft apart.</p>'
    ));
});


test('running a plan', async (context) => {
    // Run the plan with a model - the run's steps, status, and time are shown as it goes
    const browser = loadedBrowser(context, loadedConfig, {'files': {[modelsURL]: modelsText}});
    const {document, indexedDB} = browser;
    const finish = Promise.withResolvers();
    const {app, calls} = await startToolsApp(browser, [() => finish.promise]);
    const select = document.getElementById('sageroad-run-model');
    select.value = 'qwen:27b';
    fire(browser, select, 'change');
    assert.equal(browser.window.localStorage.getItem('sageRoadModel'), '"qwen:27b"');
    click(browser, 'sageroad-run');
    assert.equal(document.getElementById('sageroad-run'), null);
    assert.equal(document.getElementById('sageroad-stop').disabled, false);
    assert.equal(select.disabled, true);
    assert.deepEqual(loadedActions(browser), [
        'View Plan (disabled)', 'Edit Plan (disabled)', 'Edit Map (disabled)', 'Download (disabled)',
        'Close (disabled)', 'Stop'
    ]);
    assert.deepEqual(['sageroad-open', 'sageroad-new'].map((id) => document.getElementById(id).disabled), [true, true]);
    assert.equal(document.getElementById('sageroad-run-progress').hidden, false);
    assert.equal(document.getElementById('sageroad-run-time').textContent, '0:00');
    const steps = () => [...document.querySelectorAll('#sageroad-run-steps li')].map((item) => [item.className, item.textContent]);
    await flush();
    assert.equal(document.getElementById('sageroad-run-status').textContent, 'Running - step 1 of 3');
    assert.deepEqual(steps(), [
        ['sageroad-step-current', '1. Build the siteCreating the <site>…'],
        ['sageroad-step-pending', '2. Read the notes'],
        ['sageroad-step-pending', '3. Engineer the road options']
    ]);

    // The run's next step, and a second passes
    browser.clock.runTimeout();
    await flush();
    assert.equal(document.getElementById('sageroad-run-status').textContent, 'Running - step 3 of 3');
    assert.deepEqual(steps(), [
        ['sageroad-step-done', '1. Build the site'],
        ['sageroad-step-done', '2. Read the notes'],
        ['sageroad-step-current', '3. Engineer the road optionsEngineering the options…']
    ]);
    browser.clock.runTimeout();
    await flush();
    browser.clock.runTimeout();
    assert.equal(document.getElementById('sageroad-run-time').textContent, '0:01');

    // The run is done, after a minute and 11 seconds - its result and its report stay
    browser.clock.time += 70000;
    const runSite = {...siteConfig, 'passThrough': [{'name': 'Barn', 'latitude': 46.15, 'longitude': -119.15, 'found': {'place': 'Barn'}}]};
    finish.resolve({'code': 0, 'lines': ['Grid: 10 x 10', 'Wrote plan.json'], 'plan': {...sitePlan, 'site': runSite}});
    await runDone(browser);
    browser.clock.runTimeout();
    assert.equal(browser.clock.timeouts.size, 0);
    assert.deepEqual(calls, [{
        'isWindow': true, 'site': siteConfig, 'plan': null, 'model': 'qwen:27b', 'isFiles': true, 'isSignal': true
    }]);
    assert.equal(document.getElementById('sageroad-run-status').textContent, 'The plan ran in 1:11 - its road options are engineered.');
    assert.equal(document.querySelector('.sageroad-run-icon').className, 'sageroad-run-icon sageroad-run-done');
    assert.equal(document.getElementById('sageroad-run-log').textContent, 'Grid: 10 x 10\nWrote plan.json');
    assert.equal(document.getElementById('sageroad-run-report').open, false);

    // The plan's road options are the loaded plan's - they're kept in the database - and the plan isn't saved. Its config
    // is the run's - the places it found are its marks.
    assert.deepEqual(app.loaded, {'name': 'hill.json', 'file': 'hill.json', 'site': runSite, 'changed': false, 'saved': false});
    assert.deepEqual(indexedDB.records('files').map(({name, type}) => [name, type]), [['hill.json', 'application/json']]);
    const element = loadedElement(browser);
    assert.ok(element.innerHTML.includes(
        '<strong>Exclusion areas:</strong> 1. <strong>Places to pass through:</strong> 1.'
    ));
    assert.equal(element.querySelector('h2').textContent, 'Hill Road');
    assert.equal(
        element.querySelector('.sageroad-loaded-kind').innerHTML, '<code>hill.json</code> <span class="sageroad-unsaved">Not saved</span>'
    );
    assert.deepEqual(loadedActions(browser), [
        'View Plan', 'Edit Plan', 'Edit Map (disabled)', 'Download', 'Close', 'Run Plan', 'Clear Road Options', 'Ollama Models'
    ]);

    // The last model chosen is the model - and no model, once it's chosen
    await flushUntil(() => document.getElementById('sageroad-run-model').options.length === 3);
    const runSelect = document.getElementById('sageroad-run-model');
    assert.equal(runSelect.value, 'qwen:27b');
    runSelect.value = '';
    fire(browser, runSelect, 'change');
    assert.equal(browser.window.localStorage.getItem('sageRoadModel'), 'null');
    assert.deepEqual(['sageroad-open', 'sageroad-new'].map((id) => document.getElementById(id).disabled), [false, false]);
    await flushUntil(() => document.querySelector('#sageroad-recent li') !== null);
    assert.equal(document.querySelector('#sageroad-recent li').textContent, 'hill.json (the loaded plan)');

    // View the plan
    await viewLoaded(browser);
    assert.equal(browser.window.location.hash, "#var.vFile='local%3Ahill.json'");
    assert.equal(document.title, 'Fixture Plan');
});


test('running a plan that fails', async (context) => {
    // The run fails, or its tools throw - the run's report is its error
    const browser = loadedBrowser(context, loadedConfig);
    const {document} = browser;
    const results = [
        {'code': 1, 'lines': ['error: no road within the 11% grade limit'], 'plan': null},
        () => Promise.reject(new Error('Failed to fetch'))
    ];
    const {app, calls} = await startToolsApp(browser, results);
    assert.equal(document.getElementById('sageroad-run-model').options.length, 1);
    for (const logText of ['error: no road within the 11% grade limit', 'error: Failed to fetch']) {
        click(browser, 'sageroad-run');
        assert.deepEqual([...document.querySelectorAll('#sageroad-run-steps li')].map((item) => item.textContent), [
            '1. Build the site', '2. Engineer the road options'
        ]);
        await runTimeouts(browser);
        await runDone(browser);
        assert.equal(document.getElementById('sageroad-run-log').textContent, logText);
        assert.equal(document.getElementById('sageroad-run-status').textContent, 'The plan failed, after 0:00 - its report says why.');
        assert.equal(document.querySelector('.sageroad-run-icon').className, 'sageroad-run-icon sageroad-run-failed');
        assert.equal(document.getElementById('sageroad-run-report').open, true);
        await flushUntil(() => !document.getElementById('sageroad-run').disabled);
    }
    assert.deepEqual(calls.map(({model}) => model), [null, null]);
    assert.deepEqual(app.loaded, loadedConfig);
});


test('stopping a plan\'s run', async (context) => {
    // Stop the run - it stops when its step's work is done, and the plan is as it was
    const browser = loadedBrowser(context, loadedConfig);
    const {document} = browser;
    const finish = Promise.withResolvers();
    const {app, calls} = await startToolsApp(browser, [() => finish.promise]);
    click(browser, 'sageroad-run');
    await flush();
    browser.clock.runTimeout();
    await flush();
    browser.clock.runTimeout();
    await flush();
    click(browser, 'sageroad-stop');
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(document.getElementById('sageroad-stop').disabled, true);
    assert.equal(
        document.getElementById('sageroad-run-status').textContent, 'Stopping - the run stops when its current step\'s work is done…'
    );
    finish.resolve({'code': 1, 'lines': ['The plan was stopped'], 'plan': null, 'stopped': true});
    await runDone(browser);
    assert.equal(
        document.getElementById('sageroad-run-status').textContent, 'The plan was stopped, after 0:00 - its work was thrown away.'
    );
    assert.equal(document.querySelector('.sageroad-run-icon').className, 'sageroad-run-icon sageroad-run-failed');
    assert.equal(document.getElementById('sageroad-run-report'), null);
    assert.deepEqual(app.loaded, loadedConfig);
});


test('running a plan without the planning tools', async (context) => {
    // The page isn't the SageRoad application's - it has no planning tools, so a plan isn't run, and Ollama isn't asked
    const browser = loadedBrowser(context, loadedConfig);
    const app = new SageRoadApp(browser.window);
    app.importPlan = () => Promise.reject(new Error('Failed to fetch dynamically imported module'));
    app.start();
    await flush();
    const {document} = browser;
    assert.equal(document.getElementById('sageroad-run-message').textContent, 'A plan is run by the SageRoad application - this page ' +
        'doesn\'t have its planning tools. Install it ("pip install sageroad"), and run "sageroad".');
    assert.equal(document.getElementById('sageroad-run').disabled, true);
    assert.deepEqual(browser.fetches, []);
});


test('the planning tools', async (context) => {
    // The application's planning tools are the project's - they run a plan in a browser
    const tools = await new SageRoadApp(fakeBrowser(context).window).importPlan();
    assert.deepEqual([typeof tools.planRoad, typeof tools.siteDefaults, tools.ollamaHostDefault], [
        'function', 'function', 'http://127.0.0.1:11434'
    ]);
    const stepTypes = tools.autoSteps.map(({key, text, isModel}) => [typeof key, typeof text, typeof isModel].join());
    assert.deepEqual([...new Set(stepTypes)], ['string,string,boolean']);
});


// Start the application with a plan run - its road options are the loaded plan's
async function startRunApp(context, {results = [], loaded = loadedConfig} = {}) {
    const browser = loadedBrowser(context, loaded);
    const started = await startToolsApp(browser, [{'code': 0, 'lines': ['Wrote plan.json'], 'plan': sitePlan}, ...results]);
    click(browser, 'sageroad-run');
    await runTimeouts(browser);
    await runDone(browser);
    return {browser, ...started};
}


// A fake file handle - its writes are recorded ("writes"), or it fails
function fakeHandle(name, writes, error = null) {
    return {
        name,
        'createWritable': () => (error !== null ? Promise.reject(error) : Promise.resolve({
            'write': (blob) => Promise.resolve(writes.push([name, blob])), 'close': () => Promise.resolve(writes.push([name, 'close']))
        }))
    };
}


test('saving a plan', async (context) => {
    // Save the plan - it's a new file, chosen with the browser's save dialog
    const {browser, app} = await startRunApp(context);
    const {document, window} = browser;
    const pickers = [];
    const writes = [];
    const picks = [
        () => Promise.resolve(fakeHandle('saved.json', writes)),
        () => Promise.reject(Object.assign(new Error('The user aborted a request.'), {'name': 'AbortError'})),
        () => Promise.resolve(fakeHandle('other.json', writes, new Error('The file is locked'))),
        () => Promise.resolve(fakeHandle('copy.json', writes))
    ];
    window.showSaveFilePicker = (options) => {
        pickers.push(options);
        return picks.shift()();
    };
    const saveStatus = () => document.getElementById('sageroad-save-status').textContent;
    click(browser, 'sageroad-save');
    await flushUntil(() => saveStatus() !== '');
    assert.deepEqual(pickers, [
        {'suggestedName': 'hill.json', 'types': [{'description': 'SageRoad plan', 'accept': {'application/json': ['.json']}}]}
    ]);
    assert.deepEqual(writes.map(([name, blob]) => [name, typeof blob === 'string' ? blob : 'blob']), [
        ['saved.json', 'blob'], ['saved.json', 'close']
    ]);
    const savedPlan = JSON.parse(await writes[0][1].text());
    assert.deepEqual([savedPlan.title, savedPlan.site, Object.keys(savedPlan).at(-1)], ['Fixture Plan', siteConfig, 'site']);
    assert.equal(saveStatus(), 'Saved the plan, "saved.json".');
    assert.deepEqual(app.loaded, {'name': 'saved.json', 'file': 'saved.json', 'site': siteConfig, 'changed': false, 'saved': true});
    assert.equal(loadedElement(browser).querySelector('.sageroad-loaded-kind').innerHTML, '<code>saved.json</code>');
    assert.deepEqual(loadedActions(browser).slice(3, 6), ['Save', 'Save As…', 'Close']);
    assert.ok(browser.indexedDB.records('files').some(({name}) => name === 'saved.json'));

    // Save it again - it's saved to its file, without the dialog
    click(browser, 'sageroad-save');
    await flushUntil(() => writes.length === 4);
    assert.equal(pickers.length, 1);
    assert.deepEqual(writes.slice(2).map(([name]) => name), ['saved.json', 'saved.json']);

    // Save it as another file - the dialog is cancelled (nothing is said), the file can't be written, and it's saved
    click(browser, 'sageroad-save-as');
    await flush();
    assert.equal(saveStatus(), 'Saved the plan, "saved.json".');
    click(browser, 'sageroad-save-as');
    await flushUntil(() => saveStatus() !== 'Saved the plan, "saved.json".');
    assert.equal(saveStatus(), 'Could not save the plan - The file is locked');
    click(browser, 'sageroad-save-as');
    await flushUntil(() => saveStatus() === 'Saved the plan, "copy.json".');
    assert.deepEqual(app.loaded, {'name': 'copy.json', 'file': 'copy.json', 'site': siteConfig, 'changed': false, 'saved': true});
    assert.equal(pickers.length, 4);
});


test('saving a plan without road options', async (context) => {
    // A plan without road options is saved as its plan config - with the browser's save dialog, its file is new
    const browser = loadedBrowser(context, {...loadedConfig, 'name': null, 'saved': false});
    const {document, window} = browser;
    const {app} = await startToolsApp(browser);
    const writes = [];
    const pickers = [];
    window.showSaveFilePicker = (options) => Promise.resolve(fakeHandle(pickers.push(options) && 'hill-site.json', writes));
    click(browser, 'sageroad-save');
    await flushUntil(() => document.getElementById('sageroad-save-status').textContent !== '');
    assert.equal(pickers[0].suggestedName, 'Hill Road.json');
    assert.equal(await writes[0][1].text(), `${JSON.stringify(siteConfig, null, 4)}\n`);
    assert.deepEqual(app.loaded, {...loadedConfig, 'name': 'hill-site.json'});
});


test('saving a plan without a save dialog', async (context) => {
    // The browser has no save dialog - the plan is downloaded ("Download" - there's no save as)
    const {browser, app} = await startRunApp(context, {'loaded': {...loadedConfig, 'name': null}});
    const {document} = browser;
    const clicks = [];
    const createElement = document.createElement.bind(document);
    context.mock.method(document, 'createElement', (tag) => {
        const element = createElement(tag);
        element.click = () => clicks.push([element.getAttribute('href'), element.download]);
        return element;
    });
    assert.deepEqual(loadedActions(browser).slice(3, 5), ['Download', 'Close']);
    assert.equal(document.getElementById('sageroad-save-as'), null);
    for (const ixSave of [0, 1]) {
        click(browser, 'sageroad-save');
        await flushUntil(() => clicks.length === ixSave + 1 && document.getElementById('sageroad-save-status').textContent !== '');
    }
    assert.deepEqual(clicks, [['blob:http://localhost/1', 'Hill Road.json'], ['blob:http://localhost/2', 'Hill Road.json']]);
    assert.equal(JSON.parse(await browser.objectURLs[0].text()).title, 'Fixture Plan');
    assert.equal(document.getElementById('sageroad-save-status').textContent, 'Downloaded the plan, "Hill Road.json".');
    assert.equal(app.loaded.saved, true);
    assert.deepEqual(browser.revokedURLs, []);
    browser.clock.runTimeout();
    assert.deepEqual(browser.revokedURLs, ['blob:http://localhost/1']);
});


test('editing a plan\'s config, and running it again', async (context) => {
    // Edit the plan's config - the plan's road options are from the config before. The run's plan's config is the edited
    // config.
    const updated = {...sitePlan, 'title': 'Updated Plan', 'site': {...siteConfig, 'notes': ['A paved road.']}};
    const {browser, app, calls} = await startRunApp(context, {'results': [{'code': 0, 'lines': ['Wrote plan.json'], 'plan': updated}]});
    const {document, window} = browser;
    click(browser, 'sageroad-edit');
    await flush();
    assert.equal(window.location.hash, "#var.vEdit='loaded'");
    assert.equal(document.title, 'Edit Plan');
    assert.equal(document.querySelector('[data-member="title"]').value, 'Hill Road');
    document.querySelector('[data-member="notes"]').value = 'A paved road.';
    click(browser, 'sageroad-edit-done');
    await flushUntil(() => document.getElementById('sageroad-run') !== null && !document.getElementById('sageroad-run').disabled);
    assert.equal(window.location.hash, '#var=');
    const site = {...siteConfig, 'notes': ['A paved road.']};
    assert.deepEqual(app.loaded, {'name': 'hill.json', 'file': 'hill.json', site, 'changed': true, 'saved': false});
    const element = loadedElement(browser);
    assert.equal(element.querySelector('.sageroad-notice').textContent, 'The plan was edited since its road options were ' +
        'engineered - run the plan to engineer them again.');
    assert.deepEqual([...element.querySelector('ul').children].map((item) => item.textContent), ['A paved road.']);

    // Run it again - its road options are engineered again
    click(browser, 'sageroad-run');
    await runTimeouts(browser);
    await runDone(browser);
    assert.deepEqual(calls[1].site, site);
    assert.equal(calls[1].plan.title, 'Fixture Plan');
    assert.deepEqual(app.loaded, {'name': 'hill.json', 'file': 'hill.json', site, 'changed': false, 'saved': false});
    assert.equal(loadedElement(browser).querySelector('.sageroad-notice'), null);
});


test('the run\'s model messages', async (context) => {
    // The run's model message - null if it's hidden
    const message = (browser) => {
        const element = browser.document.getElementById('sageroad-model-message');
        return element.hidden ? null : element.innerHTML;
    };

    // Ollama isn't running - the plan's notes can't be read
    const noOllama = loadedBrowser(context, loadedConfig, {'files': {[modelsURL]: null}});
    await startToolsApp(noOllama);
    assert.equal(message(noOllama), ollamaMissingHtml('a model can\'t read the plan\'s notes'));
    assert.equal(noOllama.document.getElementById('sageroad-run-model').options.length, 1);
    assert.equal(noOllama.document.getElementById('sageroad-models').getAttribute('href'), '#var.vModels=true');

    // Ollama has no models that answer questions - its speech model isn't one
    const speechText = JSON.stringify({'models': [{'name': 'phonon:latest', 'capabilities': ['speech']}]});
    const noModels = loadedBrowser(context, loadedConfig, {'files': {[modelsURL]: speechText}});
    await startToolsApp(noModels);
    assert.equal(message(noModels), 'Ollama has no models that answer questions, so the plan\'s notes can\'t be read - ' +
        '<a href="#var.vDownload=true">download a model</a> that reads images.');
    assert.equal(noModels.document.getElementById('sageroad-run-model').options.length, 1);

    // No model is chosen, and a model that doesn't read images is chosen - and one that does
    const files = {
        [modelsURL]: modelsText,
        [showURL]: ({body}) => JSON.stringify({
            'capabilities': JSON.parse(body).model === 'qwen:27b' ? ['completion', 'vision'] : ['completion']
        })
    };
    const browser = loadedBrowser(context, loadedConfig, {files});
    await startToolsApp(browser);
    assert.equal(message(browser), 'No model is chosen - the plan\'s notes won\'t be read.');
    const select = browser.document.getElementById('sageroad-run-model');
    select.value = 'a<b';
    fire(browser, select, 'change');
    assert.equal(message(browser), 'The model "a&lt;b" doesn\'t read images - it reads the notes, but it can\'t find their places ' +
        'on the site\'s map.');
    select.value = 'qwen:27b';
    fire(browser, select, 'change');
    assert.equal(message(browser), null);

    // A plan without notes doesn't need a model
    const {notes, ...noNotes} = siteConfig;
    assert.equal(notes.length, 2);
    const noNotesBrowser = loadedBrowser(context, {...loadedConfig, 'site': noNotes}, {files});
    await startToolsApp(noNotesBrowser);
    assert.equal(message(noNotesBrowser), null);
});


test('clearing a plan\'s road options, and closing it', async (context) => {
    // Clear the road options - the plan keeps its site's data, so a run doesn't fetch it again
    const {browser, app, calls} = await startRunApp(context, {'results': [{'code': 0, 'lines': ['Wrote plan.json'], 'plan': sitePlan}]});
    const {document, window} = browser;
    assert.equal(document.getElementById('sageroad-run-fetch').checked, false);
    click(browser, 'sageroad-clear');
    await flushUntil(() => document.getElementById('sageroad-clear') === null);
    assert.deepEqual(app.loaded, {...loadedConfig, 'file': 'hill.json', 'saved': false});
    assert.ok(loadedElement(browser).textContent.includes('The plan has no road options - run the plan to engineer them. Its ' +
        'site\'s data (its terrain, streams, roads, and map) is kept, so a run doesn\'t fetch it from the USGS again.'));
    assert.deepEqual(loadedActions(browser), [
        'View Plan (disabled)', 'Edit Plan', 'Edit Map (disabled)', 'Download', 'Close', 'Run Plan', 'Ollama Models'
    ]);
    assert.equal(document.getElementById('sageroad-run-progress').hidden, true);
    const cleared = JSON.parse(await browser.indexedDB.records('files').find(({name}) => name === 'hill.json').blob.text());
    assert.deepEqual([cleared.options, 'description' in cleared, cleared.topography.spacing], [[], false, sitePlan.topography.spacing]);

    // Save it - its file is its site's data, without road options
    const writes = [];
    window.showSaveFilePicker = () => Promise.resolve(fakeHandle('hill.json', writes));
    click(browser, 'sageroad-save');
    await flushUntil(() => writes.length === 2);
    const savedPlan = JSON.parse(await writes[0][1].text());
    assert.deepEqual([savedPlan.options, savedPlan.site, 'topography' in savedPlan], [[], siteConfig, true]);

    // Run it - its site's data is the run's, and it's fetched again only if it's asked to be
    await flushUntil(() => document.getElementById('sageroad-run')?.disabled === false);
    document.getElementById('sageroad-run-fetch').checked = true;
    click(browser, 'sageroad-run');
    assert.equal(document.getElementById('sageroad-run-fetch').disabled, true);
    await runTimeouts(browser);
    await runDone(browser);
    assert.deepEqual([calls[1].plan.options, calls[1].plan.topography.spacing, calls[1].fetch], [[], sitePlan.topography.spacing, true]);
    assert.equal(calls[0].fetch, false);

    // Close it - its changes aren't saved, so the user is asked first
    const confirms = [];
    const answers = [false, true];
    window.confirm = (message) => confirms.push(message) && answers.shift();
    click(browser, 'sageroad-close');
    assert.deepEqual(app.loaded, {...loadedConfig, 'file': 'hill.json', 'saved': false});
    click(browser, 'sageroad-close');
    await flush();
    assert.deepEqual(confirms, Array(2).fill('The plan has changes that aren\'t saved. Close it anyway?'));
    assert.equal(app.loaded, null);
    assert.equal(loadedElement(browser).innerHTML, '');
    assert.equal(window.localStorage.getItem('sageRoadLoaded'), 'null');

    // A saved plan is closed without asking
    const saved = loadedBrowser(context, loadedConfig);
    const {'app': savedApp} = await startToolsApp(saved);
    click(saved, 'sageroad-close');
    await flush();
    assert.equal(savedApp.loaded, null);
});


test('opening a plan with the browser\'s open dialog', async (context) => {
    // The plan is opened with the dialog - it's saved to its file
    const browser = fakeBrowser(context, {storage});
    const {document, window} = browser;
    const {app} = await startToolsApp(browser);
    const writes = [];
    const handles = [
        {'getFile': () => Promise.resolve(localFile(browser, 'topo.png', 'PNG', 'image/png'))},
        {...fakeHandle('hill.json', writes), 'getFile': () => Promise.resolve(localFile(browser, 'hill.json', JSON.stringify(siteConfig)))}
    ];
    const opens = [() => Promise.reject(new Error('The user aborted a request.')), () => Promise.resolve(handles)];
    const options = [];
    window.showOpenFilePicker = (pickerOptions) => {
        options.push(pickerOptions);
        return opens.shift()();
    };
    click(browser, 'sageroad-open');
    await flush();
    assert.equal(app.loaded, null);
    click(browser, 'sageroad-open');
    await flushUntil(() => loadedElement(browser).querySelector('h2') !== null);
    assert.deepEqual(options[0], {'multiple': true, 'types': [{
        'description': 'SageRoad plans and map images',
        'accept': {'application/json': ['.json'], 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'], 'application/pdf': ['.pdf']}
    }]});
    assert.deepEqual(app.loaded, loadedConfig);
    assert.equal(app.fileHandle, handles[1]);
    click(browser, 'sageroad-save');
    await flushUntil(() => document.getElementById('sageroad-save-status').textContent !== '');
    assert.deepEqual(writes.map(([name]) => name), ['hill.json', 'hill.json']);

    // Without the dialog, the file input is clicked
    delete window.showOpenFilePicker;
    const inputClicks = [];
    document.getElementById('sageroad-file').click = () => inputClicks.push(true);
    click(browser, 'sageroad-open');
    await flush();
    assert.deepEqual(inputClicks, [true]);
});


test('opening a plan, over a plan that isn\'t saved', async (context) => {
    // The user is asked before the loaded plan is replaced - by an opened plan, a dropped plan, a recent plan, or a
    // new plan
    const indexedDB = new FakeIndexedDB();
    const opener = fakeBrowser(context, {indexedDB, storage});
    await startToolsApp(opener);
    await selectFiles(opener, [localFile(opener, 'recent.json', JSON.stringify(siteConfig))]);
    const browser = loadedBrowser(context, {...loadedConfig, 'saved': false}, {indexedDB});
    const {document, window} = browser;
    const {app} = await startToolsApp(browser);
    const confirms = [];
    window.confirm = () => confirms.push(true) && false;
    window.showOpenFilePicker = () => Promise.reject(new Error('The picker opened'));
    click(browser, 'sageroad-open');
    await dropFiles(browser, [localFile(browser, 'dropped.json', JSON.stringify(siteConfig))]);
    await flushUntil(() => document.querySelector('#sageroad-recent button') !== null);
    fire(browser, document.querySelector('#sageroad-recent button'), 'click');
    click(browser, 'sageroad-new');
    await flush();
    assert.equal(confirms.length, 4);
    assert.deepEqual(app.loaded, {...loadedConfig, 'saved': false});
    assert.equal(window.location.hash, '');

    // The user closes it - a new plan
    window.confirm = () => true;
    click(browser, 'sageroad-new');
    await flush();
    assert.equal(window.location.hash, "#var.vEdit='new'");
});


test('a loaded plan without a plan config', async (context) => {
    // An opened plan that was made before plans kept their plan configs - its road options are viewed, but it isn't run
    const browser = fakeBrowser(context, {storage});
    const {app} = await startToolsApp(browser);
    await selectFiles(browser, [localFile(browser, 'old.json', fixtureText)]);
    await flushUntil(() => loadedElement(browser).querySelector('h2') !== null);
    assert.deepEqual(app.loaded, {'name': 'old.json', 'file': 'old.json', 'site': null, 'changed': false, 'saved': true});
    assert.equal(loadedElement(browser).querySelector('h2').textContent, 'Fixture Plan');
    assert.deepEqual(loadedActions(browser), ['View Plan', 'Edit Plan (disabled)', 'Edit Map (disabled)', 'Download', 'Close']);
    assert.ok(loadedElement(browser).textContent.includes('The plan has no config - it was made before plans kept theirs - ' +
        'so it can\'t be edited or run here.'));
    assert.equal(browser.document.getElementById('sageroad-run'), null);

    // It's saved as it is
    const writes = [];
    browser.window.showSaveFilePicker = () => Promise.resolve(fakeHandle('old.json', writes));
    click(browser, 'sageroad-save');
    await flushUntil(() => writes.length === 2);
    assert.equal(JSON.parse(await writes[0][1].text()).site, undefined);
});


test('opening a file that isn\'t a plan', async (context) => {
    // A file that isn't JSON, an invalid plan with road options, and an invalid plan config - the error is shown, and
    // the loaded plan is kept
    const browser = loadedBrowser(context, loadedConfig);
    const {app} = await startToolsApp(browser);
    const invalidPlan = JSON.stringify({...fixturePlan(), 'units': 'yards'});
    for (const [name, text, message] of [
        ['text.json', 'Not JSON', 'Could not load "text.json" - it isn\'t a JSON file'],
        ['plan.json', invalidPlan, 'The road plan "plan.json" is invalid: Invalid value "yards" (type "string") for member ' +
            '"units", expected type "Units"'],
        ['site.json', '{"title": "Hill"}', 'The plan config "site.json" is invalid: Required member "units" missing'],
        ['null.json', 'null', 'The plan config "null.json" is invalid: Invalid value null (type "object"), expected type "RoadSite"']
    ]) {
        await selectFiles(browser, [localFile(browser, name, text)]);
        assert.equal(browser.document.getElementById('sageroad-open-status').textContent, message);
        assert.deepEqual(app.loaded, loadedConfig);
    }

    // The error is shown once
    browser.window.location.hash = '#var.vOption=1';
    await flush();
    assert.equal(browser.document.getElementById('sageroad-open-status').textContent, '');

    // A plan config's file is the loaded plan
    await selectFiles(browser, [localFile(browser, 'dale-site.json', JSON.stringify({...siteConfig, 'title': 'Dale Road'}))]);
    assert.equal(browser.document.getElementById('sageroad-open-status').textContent, '');
    assert.deepEqual(app.loaded, {...loadedConfig, 'name': 'dale-site.json', 'site': {...siteConfig, 'title': 'Dale Road'}});
    assert.equal(loadedElement(browser).querySelector('h2').textContent, 'Dale Road');
});


test('the loaded plan, kept in local storage', async (context) => {
    // A loaded plan that isn't one - it isn't loaded
    for (const value of ['5', '{"site": null}', 'null', 'not JSON']) {
        const browser = fakeBrowser(context, {'storage': {...storage, 'sageRoadLoaded': value}});
        const {app} = await startToolsApp(browser);
        assert.equal(app.loaded, null, value);
        assert.equal(loadedElement(browser).innerHTML, '');
    }

    // A loaded plan whose file isn't a plan - it's its plan config
    const indexedDB = new FakeIndexedDB();
    const opener = fakeBrowser(context, {indexedDB, storage});
    await startToolsApp(opener);
    await selectFiles(opener, [localFile(opener, 'bad.json', JSON.stringify({...fixturePlan(), 'units': 'yards'}))]);
    await selectFiles(opener, [localFile(opener, 'text.json', 'Not JSON')]);
    for (const file of ['bad.json', 'text.json']) {
        const badBrowser = loadedBrowser(context, {...loadedConfig, file}, {indexedDB});
        await startToolsApp(badBrowser);
        assert.ok(loadedElement(badBrowser).textContent.includes('The plan has no road options yet - run the plan to engineer them.'));
    }

    // A loaded plan whose road options are gone from the database - it's its plan config, or there's none
    const loaded = {'name': 'gone.json', 'file': 'gone.json', 'site': siteConfig, 'changed': false, 'saved': true};
    let browser = loadedBrowser(context, loaded);
    await startToolsApp(browser);
    assert.ok(loadedElement(browser).textContent.includes('The plan has no road options yet - run the plan to engineer them.'));
    browser = loadedBrowser(context, {...loaded, 'site': null});
    const {app} = await startToolsApp(browser);
    assert.equal(loadedElement(browser).innerHTML, '');
    assert.equal(app.loaded, null);
    assert.equal(browser.window.localStorage.getItem('sageRoadLoaded'), 'null');
});


test('the home page, left while its loaded plan is drawn or run', async (context) => {
    // The page is left before the planning tools are imported, before Ollama answers, and while the plan runs - the
    // run goes on, but the page isn't drawn
    const tools = Promise.withResolvers();
    const models = Promise.withResolvers();
    const run = Promise.withResolvers();
    const hooks = {};
    const files = {...fixtureFiles, [modelsURL]: models.promise};
    for (const step of ['tools', 'models', 'run']) {
        const browser = loadedBrowser(context, loadedConfig, {files});
        const app = new SageRoadApp(browser.window);
        app.importPlan = () => (step === 'tools' ? tools.promise : Promise.resolve({
            'autoSteps': toolSteps,
            'ollamaHostDefault': 'http://127.0.0.1:11434',
            'planRoad': (window, road, {status}) => {
                Object.assign(hooks, {status});
                return run.promise;
            }
        }));
        app.start();
        await flush();
        if (step === 'run') {
            models.resolve(modelsText);
            await flush();
            click(browser, 'sageroad-run');
            await flush();
        }
        browser.window.location.hash = "#var.vFile='plans%2Ffixture.json'";
        await flush();
        assert.equal(browser.document.title, 'Fixture Plan');
        const html = browser.main.innerHTML;
        if (step === 'tools') {
            tools.reject(new Error('Failed to fetch dynamically imported module'));
        } else if (step === 'models') {
            models.resolve(modelsText);
        } else {
            assert.equal(hooks.status('Engineering the options', 'options'), null);
            await runTimeouts(browser);
            assert.equal(browser.clock.timeouts.size, 0);
            run.resolve({'code': 0, 'lines': ['Wrote plan.json'], 'plan': sitePlan});
        }
        await flush();
        await flush();
        assert.equal(browser.main.innerHTML, html);
        if (step === 'run') {
            assert.equal(app.loaded.file, 'hill.json');
        }
    }

    // The page is left while the plan runs, and another plan is loaded - the run's road options aren't the plan's
    const other = Promise.withResolvers();
    const browser = loadedBrowser(context, loadedConfig, {files});
    const app = new SageRoadApp(browser.window);
    app.importPlan = () => Promise.resolve({
        'autoSteps': toolSteps, 'ollamaHostDefault': 'http://127.0.0.1:11434', 'planRoad': () => other.promise
    });
    app.start();
    await flushUntil(() => browser.document.getElementById('sageroad-run')?.disabled === false);
    click(browser, 'sageroad-run');
    browser.window.location.hash = "#var.vFile='plans%2Ffixture.json'";
    await flush();
    const otherLoaded = {...loadedConfig, 'name': 'other.json'};
    app.setLoaded(otherLoaded);
    other.resolve({'code': 0, 'lines': ['Wrote plan.json'], 'plan': sitePlan});
    await flush();
    await flush();
    assert.equal(app.loaded, otherLoaded);
    assert.deepEqual(browser.indexedDB.records('files'), []);
});


test('the home page, left while its loaded plan is analyzed or saved', async (context) => {
    // The page is left before its loaded plan's road options are analyzed - the page isn't drawn
    const indexedDB = new FakeIndexedDB();
    const opener = fakeBrowser(context, {indexedDB, storage});
    await startToolsApp(opener);
    await selectFiles(opener, [localFile(opener, 'new.json', JSON.stringify(sitePlan))]);
    const loaded = opener.window.localStorage.getItem('sageRoadLoaded');
    const browser = fakeBrowser(context, {indexedDB, 'files': fixtureFiles, 'storage': {...storage, 'sageRoadLoaded': loaded}});
    const {document, window} = browser;
    new SageRoadApp(window).start();
    window.location.hash = "#var.vFile='plans%2Ffixture.json'";
    fire(browser, window, 'hashchange');
    await flushUntil(() => document.title === 'Fixture Plan');
    assert.equal(document.getElementById('sageroad-loaded'), null);

    // The page is left while the plan is saved - the save fails, or it's saved
    for (const isSaved of [false, true]) {
        const {'browser': runBrowser, app} = await startRunApp(context);
        const save = Promise.withResolvers();
        runBrowser.window.showSaveFilePicker = () => save.promise;
        click(runBrowser, 'sageroad-save');
        await flush();
        runBrowser.window.location.hash = "#var.vFile='plans%2Ffixture.json'";
        await flush();
        if (isSaved) {
            save.resolve(fakeHandle('saved.json', []));
        } else {
            save.reject(new Error('The file is locked'));
        }
        await flush();
        await flush();
        assert.equal(runBrowser.document.getElementById('sageroad-save-status'), null);
        assert.equal(app.loaded.saved, isSaved);
    }
});


test('the plan config editor', async (context) => {
    // A new plan - its form is the plan config's, and its defaults are its optional members' placeholders
    const browser = loadedBrowser(context, loadedConfig, {'hash': '#var.vOption=1'});
    const {document, window} = browser;
    const {app} = await startToolsApp(browser);
    click(browser, 'sageroad-new');
    await flush();
    assert.equal(window.location.hash, "#var.vEdit='new'&var.vOption=1");
    assert.equal(document.title, 'New Plan');
    assert.equal(document.querySelector('h1').textContent, 'New Plan');
    const members = [...document.querySelectorAll('#sageroad-site [data-member]')]
        .map((control) => [control.dataset.member, control.value]);
    assert.deepEqual(members.filter(([, value]) => value !== ''), [['units', 'feet']]);
    assert.equal(document.querySelector('.sageroad-actions a').getAttribute('href'), '#var.vOption=1');
    const placeholders = (...memberPaths) => memberPaths.map((memberPath) => (
        document.querySelector(`[data-member="${memberPath}"]`).placeholder
    ));
    await flush();
    assert.deepEqual(placeholders('criteria.maxGrade', 'criteria.minRadius', 'costRates.gravel', 'margin', 'spacing', 'title'), [
        'Default: 12', 'Default: 50', 'Default: 19', '', '', ''
    ]);

    const surface = document.querySelector('[data-member="criteria.surface"]');
    assert.deepEqual([surface.value, surface.options[0].textContent], ['', 'Default: gravel']);
    assert.deepEqual(placeholders('criteria.width'), ['Default: 14']);

    // The defaults follow the plan config - its units, and its points
    const form = document.getElementById('sageroad-site');
    document.querySelector('[data-member="units"]').value = 'meters';
    fire(browser, form, 'change');
    for (const [member, value] of [['title', 'Dale Road'], ['start.latitude', '46.1'], ['start.longitude', '-119.2']]) {
        document.querySelector(`[data-member="${member}"]`).value = value;
    }
    fire(browser, form, 'input');
    assert.deepEqual(placeholders('criteria.minRadius', 'margin', 'spacing'), ['Default: 15', '', '']);
    fire(browser, document.querySelector('[data-member="end.latitude"]'), 'paste', {'clipboardData': {'getData': () => '46.1, -119.2'}});
    assert.deepEqual(placeholders('margin', 'spacing'), ['Default: 46100', 'Default: 5']);

    // A plan config that isn't valid isn't done
    const status = document.getElementById('sageroad-edit-status');
    click(browser, 'sageroad-edit-done');
    assert.equal(status.textContent, 'The start and end points are the same point');
    assert.equal(fire(browser, form, 'submit').defaultPrevented, true);
    document.querySelector('[data-member="title"]').value = '';
    click(browser, 'sageroad-edit-done');
    assert.equal(status.textContent, 'Required member "title" missing');
    document.querySelector('[data-member="title"]').value = 'Dale Road';

    // The plan config is done - it's the loaded plan, a new plan
    fire(browser, document.querySelector('[data-member="end.latitude"]'), 'paste', {'clipboardData': {'getData': () => '46.2, -119.1'}});
    click(browser, 'sageroad-edit-done');
    await flush();
    assert.equal(window.location.hash, '#var.vOption=1');
    const site = {
        'title': 'Dale Road', 'units': 'meters',
        'start': {'latitude': 46.1, 'longitude': -119.2}, 'end': {'latitude': 46.2, 'longitude': -119.1}
    };
    assert.deepEqual(app.loaded, {'name': null, 'file': null, site, 'changed': false, 'saved': false});
    assert.equal(loadedElement(browser).querySelector('h2').textContent, 'Dale Road');

    // Edit it - a plan without road options isn't changed
    click(browser, 'sageroad-edit');
    await flush();
    assert.deepEqual(placeholders('margin'), ['Default: 46200']);
    click(browser, 'sageroad-edit-done');
    await flush();
    assert.deepEqual(app.loaded, {'name': null, 'file': null, site, 'changed': false, 'saved': false});

    // There's no loaded plan config to edit
    const empty = fakeBrowser(context, {storage, 'hash': "#var.vEdit='loaded'"});
    await startToolsApp(empty);
    assert.equal(empty.document.title, 'Edit Plan');
    assert.equal(empty.main.innerHTML, '<h1>Edit Plan</h1>\n<p>There\'s no loaded plan config to edit.</p>\n' +
        '<p><a href="#var=">Back</a></p>');
});


test('the plan config editor, without the planning tools', async (context) => {
    // The site's defaults are the planning tools' - without them, they aren't shown. The editor is left before the
    // tools aren't loaded.
    const tools = Promise.withResolvers();
    const browser = loadedBrowser(context, loadedConfig, {'hash': "#var.vEdit='loaded'"});
    const app = new SageRoadApp(browser.window);
    app.importPlan = () => tools.promise;
    app.start();
    await flush();
    const {document} = browser;
    assert.equal(document.querySelector('[data-member="margin"]').placeholder, '');
    assert.equal(document.querySelector('[data-member="criteria.maxGrade"]').placeholder, 'Default: 12');
    browser.window.location.hash = '#var=';
    await flush();
    tools.resolve({'siteDefaults': () => ({'margin': 1, 'spacing': 1})});
    await flush();
    assert.equal(document.getElementById('sageroad-site'), null);
    const failed = loadedBrowser(context, loadedConfig, {'hash': "#var.vEdit='loaded'"});
    const failedApp = new SageRoadApp(failed.window);
    failedApp.importPlan = () => Promise.reject(new Error('Failed to fetch dynamically imported module'));
    failedApp.start();
    await flush();
    assert.equal(failed.document.querySelector('[data-member="margin"]').placeholder, '');
});


test('the home page lists the recent local plans', async (context) => {
    // Open local plans, a second apart - the last with its map image
    const indexedDB = new FakeIndexedDB();
    const browser = fakeBrowser(context, {indexedDB, storage});
    await startApp(browser);
    browser.clock.time = 1000;
    await selectFiles(browser, [localFile(browser, 'older.json', fixtureText)]);
    browser.clock.time = 2000;
    await dropFiles(browser, [localFile(browser, 'topo.png', 'PNG', 'image/png'), localFile(browser, 'Newer.JSON', fixtureText)]);
    assert.deepEqual(
        indexedDB.records('files').map(({name, type, time}) => [name, type, time]),
        [['older.json', 'application/json', 1000], ['topo.png', 'image/png', 2000], ['Newer.JSON', 'application/json', 2000]]
    );

    // The home page, later - the files are listed, newest first
    const later = fakeBrowser(context, {indexedDB, storage, 'hash': '#var.vOption=1'});
    await startApp(later);
    assert.equal(later.document.title, 'SageRoad');
    assert.equal(
        later.main.innerHTML,
        homeHtml(
            '<h2 id="recent-files">Recent Files</h2><ul class="sageroad-recent">' +
                '<li><p><button type="button" class="sageroad-link" data-name="Newer.JSON">Newer.JSON</button>' +
                '<button type="button" class="sageroad-remove" data-remove="Newer.JSON" title="Remove it from the recent files" ' +
                'aria-label="Remove Newer.JSON">✕</button></p></li>' +
                '<li><p><button type="button" class="sageroad-link" data-name="older.json">older.json</button>' +
                '<button type="button" class="sageroad-remove" data-remove="older.json" title="Remove it from the recent files" ' +
                'aria-label="Remove older.json">✕</button></p></li>' +
                '</ul>',
            '#var.vDoc=true&amp;var.vOption=1'
        )
    );

    // A recent file is removed - from the database, too
    fire(later, later.main.querySelector('#sageroad-recent button[data-remove="older.json"]'), 'click');
    await flushUntil(() => later.main.querySelectorAll('#sageroad-recent li').length === 1);
    assert.deepEqual(indexedDB.records('files').map(({name}) => name), ['topo.png', 'Newer.JSON']);
    assert.ok(indexedDB.requests.some(([, mode, method, key]) => mode === 'readwrite' && method === 'delete' && key === 'older.json'));

    // A recent file is loaded from the database - it's the loaded plan, so it isn't removed
    fire(later, later.main.querySelector('#sageroad-recent button'), 'click');
    await flushUntil(() => later.main.querySelector('#sageroad-loaded h2') !== null);
    assert.equal(later.window.location.hash, '#var.vOption=1');
    assert.equal(later.main.querySelector('#sageroad-loaded h2').textContent, 'Fixture Plan');
    assert.ok(indexedDB.requests.some(([, , method, key]) => method === 'get' && key === 'Newer.JSON'));
    await flushUntil(() => later.main.querySelector('#sageroad-recent .sageroad-recent-loaded') !== null);
    assert.equal(later.main.querySelector('#sageroad-recent li').innerHTML, '<p><button type="button" class="sageroad-link" ' +
        'data-name="Newer.JSON">Newer.JSON</button> <span class="sageroad-recent-loaded">(the loaded plan)</span></p>');
    await viewLoaded(later);
    assert.equal(later.document.title, 'Fixture Plan');
    assert.equal(later.main.querySelector('h2:nth-of-type(2)').textContent, 'Bridge - East');

    // The last recent file is removed - there are none
    later.window.location.hash = '#var=';
    await flush();
    fire(later, later.main.querySelector('#sageroad-close'), 'click');
    await flushUntil(() => later.main.querySelector('#sageroad-recent button[data-remove]') !== null);
    fire(later, later.main.querySelector('#sageroad-recent button[data-remove]'), 'click');
    await flushUntil(() => later.document.getElementById('sageroad-recent').innerHTML === '');
});


test('the home page without recent local plans', async (context) => {
    // Only a map image has been opened
    const indexedDB = new FakeIndexedDB();
    let browser = fakeBrowser(context, {indexedDB});
    await startApp(browser);
    await selectFiles(browser, [localFile(browser, 'topo.png', 'PNG', 'image/png')]);
    assert.deepEqual(indexedDB.records('files').map(({name}) => name), ['topo.png']);

    browser = fakeBrowser(context, {indexedDB});
    await startApp(browser);
    assert.equal(browser.main.innerHTML, homeHtml());
});


test('the home page, left before its recent local plans are listed', async (context) => {
    const indexedDB = new FakeIndexedDB();
    let browser = fakeBrowser(context, {indexedDB, storage});
    await startApp(browser);
    await selectFiles(browser, [localFile(browser, 'plan.json', fixtureText)]);

    // Navigate from the home page to the documentation before the database answers - the home page is drawn when the
    // page's back end doesn't answer with a road
    browser = fakeBrowser(context, {indexedDB});
    const {document, main, window} = browser;
    const started = startApp(browser);
    while (main.innerHTML === '') {
        await Promise.resolve();
    }
    assert.equal(main.innerHTML, homeHtml());
    window.location.hash = '#var.vDoc=true';
    fire(browser, window, 'hashchange');
    await started;
    assert.equal(document.title, 'SageRoad Road Plan Model');
    assert.equal(document.getElementById('recent-plans'), null);
    assert.equal(main.querySelector('h1').textContent, 'struct RoadPlan');
});


test('the model documentation page', async (context) => {
    const browser = fakeBrowser(context, {'hash': '#var.vDoc=true'});
    const {document, main, window} = browser;
    const app = await startApp(browser);
    assert.equal(document.title, 'SageRoad Road Plan Model');
    assert.ok(main.innerHTML.startsWith('<p><a href="#var=">Back</a></p>\n<h1 id="struct-roadplan">struct RoadPlan</h1>'));
    assert.equal(document.getElementById('enum-units').textContent, 'enum Units');
    assert.deepEqual(browser.scrolls, [['scrollTo', 0, 0]]);
    assert.equal(app.page, null);
    assert.deepEqual(browser.fetches, []);
    assert.deepEqual(browser.indexedDB.requests, []);

    // A header link scrolls to its header
    window.location.hash = '#var.vDoc=true&enum-units';
    await flush();
    assert.equal(document.title, 'SageRoad Road Plan Model');
    assert.deepEqual(browser.scrolls, [['scrollTo', 0, 0], ['scrollIntoView', 'enum-units']]);

    // An unknown header doesn't scroll
    window.location.hash = '#var.vDoc=true&unknown-header';
    await flush();
    assert.equal(main.querySelector('h1').textContent, 'struct RoadPlan');
    assert.deepEqual(browser.scrolls, [['scrollTo', 0, 0], ['scrollIntoView', 'enum-units']]);

    // The back link is the home page
    window.location.hash = main.querySelector('a').getAttribute('href');
    await flush();
    assert.equal(window.location.hash, '#var=');
    assert.equal(document.title, 'SageRoad');
    assert.equal(main.innerHTML, homeHtml());
    assert.deepEqual(browser.scrolls, [['scrollTo', 0, 0], ['scrollIntoView', 'enum-units'], ['scrollTo', 0, 0]]);
});


test('a plan URL', async (context) => {
    const browser = fakeBrowser(context, {'hash': '#url=plans/fixture.json', 'files': fixtureFiles, storage});
    const {document, main, window} = browser;

    // The plan is loading
    const started = startApp(browser);
    assert.equal(document.title, 'SageRoad');
    assert.equal(main.innerHTML, loadingHtml);
    assert.deepEqual(browser.fetches, ['plans/fixture.json']);

    // The plan's report
    const app = await started;
    assert.equal(document.title, 'Fixture Plan');
    assert.deepEqual(headings(browser), directHeadings);
    assert.equal(app.page.data.file, 'plans/fixture.json');
    assert.equal(app.page.data.plan.title, 'Fixture Plan');
    assert.equal(document.body.classList.contains('sageroad-explore'), false);
    assert.deepEqual(browser.scrolls, [['scrollTo', 0, 0], ['scrollTo', 0, 0]]);
    assert.deepEqual(browser.logs, []);

    // The plan has no map image
    assert.equal(main.querySelector('img'), null);
    assert.equal(document.getElementById('source-map'), null);

    // The loaded plan is kept - another of its pages doesn't load it again, or show that it's loading
    window.location.hash = "#var.vFile='plans%2Ffixture.json'&var.vOption=1";
    fire(browser, window, 'hashchange');
    assert.equal(document.title, 'Fixture Plan');
    assert.deepEqual(headings(browser), directHeadings);
    await flush();
    assert.deepEqual(
        headings(browser),
        ['Fixture Plan', 'Plan Options', 'Bridge - East', 'Plan View', 'Profile', '3D Views', 'Cost', 'Design Warnings', 'Structures']
    );
    assert.deepEqual(browser.fetches, ['plans/fixture.json']);

    // A header link scrolls to the report's header
    window.location.hash = "#var.vFile='plans%2Ffixture.json'&cost";
    await flush();
    assert.deepEqual(headings(browser), directHeadings);
    assert.deepEqual(browser.scrolls.at(-1), ['scrollIntoView', 'cost']);
});


test('a plan URL with a source map image', async (context) => {
    const plan = fixturePlan();
    plan.image = 'maps/topo map.png';
    const files = {'plans/site.json': JSON.stringify(plan)};
    const browser = fakeBrowser(context, {'hash': "#var.vFile='plans/site.json'", files, storage});
    await startApp(browser);

    // The image is relative to the plan
    assert.deepEqual(headings(browser), [...directHeadings, 'Source Map']);
    assert.equal(
        browser.document.getElementById('source-map').nextElementSibling.outerHTML,
        '<p><img src="plans/maps/topo%20map.png" alt="The source topographic map" style="max-width: 100%; height: auto;"></p>'
    );
    assert.deepEqual(browser.objectURLs, []);
});


test('a plan that cannot be loaded', async (context) => {
    const browser = fakeBrowser(context, {
        'hash': "#var.vFile='missing.json'",
        'files': {'network.json': null, 'text.json': 'Not JSON', 'null.json': 'null'}
    });
    const {document, main, window} = browser;

    // A plan that isn't found
    const started = startApp(browser);
    assert.equal(main.innerHTML, loadingHtml);
    const app = await started;
    assert.equal(document.title, 'SageRoad');
    assert.equal(main.innerHTML, errorHtml('<strong>Error:</strong> Could not load the road plan "missing.json"'));
    assert.equal(app.page, null);

    // A network error, a plan that isn't JSON, and a null plan
    for (const file of ['network.json', 'text.json', 'null.json']) {
        window.location.hash = `#var.vFile='${file}'`;
        await flush();
        assert.equal(document.title, 'SageRoad');
        assert.equal(main.innerHTML, errorHtml(`<strong>Error:</strong> Could not load the road plan "${file}"`));
    }
    assert.deepEqual(browser.fetches, ['missing.json', 'network.json', 'text.json', 'null.json']);

    // The plan's URL is text, not HTML
    window.location.hash = `#var.vFile='${encodeURIComponent('<b>&.json')}'`;
    await flush();
    assert.equal(main.innerHTML, errorHtml('<strong>Error:</strong> Could not load the road plan "&lt;b&gt;&amp;.json"'));
    window.location.hash = `#var.vFile='${encodeURIComponent('line1\\n<b>line2</b>\\n\\n.json')}'`;
    await flush();
    assert.deepEqual(browser.fetches.at(-1), 'line1\n<b>line2</b>\n\n.json');
    assert.equal(
        main.innerHTML,
        errorHtml('<strong>Error:</strong> Could not load the road plan "line1\n&lt;b&gt;line2&lt;/b&gt;\n\n.json"')
    );

    // The error page's link is the home page
    window.location.hash = main.querySelector('a').getAttribute('href');
    await flush();
    assert.equal(main.innerHTML, homeHtml());
});


test('an invalid plan', async (context) => {
    const untitled = fixturePlan();
    delete untitled.title;
    const browser = fakeBrowser(context, {
        'hash': "#var.vFile='plans/untitled.json'",
        'files': {
            'plans/untitled.json': JSON.stringify(untitled),
            'plans/empty.json': JSON.stringify(fixturePlan([])),
            'plans/member.json': JSON.stringify({...fixturePlan(), 'one\n\ntwo': 1})
        }
    });
    const {document, main, window} = browser;
    const app = await startApp(browser);
    assert.equal(document.title, 'SageRoad');
    assert.equal(
        main.innerHTML,
        errorHtml('<strong>Error:</strong> The road plan "plans/untitled.json" is invalid:</p><p>Required member "title" missing')
    );
    assert.equal(app.page, null);

    // The validation error is text, not HTML
    window.location.hash = "#var.vFile='plans/empty.json'";
    await flush();
    assert.equal(
        main.innerHTML,
        errorHtml(
            '<strong>Error:</strong> The road plan "plans/empty.json" is invalid:</p>' +
                '<p>Invalid value [] (type "object") for member "options", expected type "array" [len &gt; 0]'
        )
    );

    // All of the validation error is shown
    window.location.hash = "#var.vFile='plans/member.json'";
    await flush();
    assert.equal(
        main.innerHTML,
        errorHtml('<strong>Error:</strong> The road plan "plans/member.json" is invalid:</p><p>Unknown member "one\n\ntwo"')
    );
});


test('a plan that failed to load is loaded again', async (context) => {
    const files = {};
    const browser = fakeBrowser(context, {'hash': "#var.vFile='plans/fixture.json'", files, storage});
    const {document, main, window} = browser;
    await startApp(browser);
    assert.equal(main.innerHTML, errorHtml('<strong>Error:</strong> Could not load the road plan "plans/fixture.json"'));

    // The plan is there now
    files['plans/fixture.json'] = fixtureText;
    window.location.hash = "#var.vFile='plans/fixture.json'&var.vOption=0";
    fire(browser, window, 'hashchange');
    assert.equal(main.innerHTML, loadingHtml);
    await flush();
    assert.equal(document.title, 'Fixture Plan');
    assert.deepEqual(headings(browser), directHeadings);
    assert.deepEqual(browser.fetches, ['plans/fixture.json', 'plans/fixture.json']);
});


test('a page left while its plan loads', async (context) => {
    // The plan's text arrives when the test resolves it
    const planText = Promise.withResolvers();
    const files = {'plans/fixture.json': planText.promise};
    const browser = fakeBrowser(context, {'hash': "#var.vFile='plans/fixture.json'", files, storage});
    const {document, main, window} = browser;
    const app = await startApp(browser);
    assert.equal(main.innerHTML, loadingHtml);

    // Navigate to the home page before the plan loads
    window.location.hash = '#var=';
    await flush();
    assert.equal(document.title, 'SageRoad');
    assert.equal(main.innerHTML, homeHtml());

    // The plan loads - its report isn't rendered
    planText.resolve(fixtureText);
    await flush();
    assert.equal(document.title, 'SageRoad');
    assert.equal(main.innerHTML, homeHtml());
    assert.equal(app.page.constructor.name, 'HomePage');
    assert.equal(browser.clock.timeouts.size, 0);
    assert.equal(browser.observers.length, 0);

    // The loaded plan is kept, though - its report doesn't load it again
    window.location.hash = "#var.vFile='plans/fixture.json'";
    await flush();
    assert.equal(document.title, 'Fixture Plan');
    assert.deepEqual(headings(browser), directHeadings);
    assert.deepEqual(browser.fetches, ['plans/fixture.json']);
});


test('the render time is logged with "?debug"', async (context) => {
    const browser = fakeBrowser(context, {'search': '?debug', 'hash': "#var.vFile='plans/fixture.json'", 'files': fixtureFiles, storage});
    await startApp(browser);
    assert.deepEqual(browser.logs, ['SageRoad: render in 0.0 ms']);

    // The plan's pages only
    browser.window.location.hash = '#var.vDoc=true';
    await flush();
    browser.window.location.hash = '#var=';
    await flush();
    assert.deepEqual(browser.logs, ['SageRoad: render in 0.0 ms']);
});


test('opening a local plan', async (context) => {
    const browser = fakeBrowser(context, {storage});
    const {document, indexedDB, main, window} = browser;
    const app = await startApp(browser);

    // Select the plan with the home page's file input - it's the loaded plan, and its report is its "local:" URL
    const planFile = localFile(browser, 'plan.json', fixtureText);
    browser.clock.time = 1500;
    await selectFiles(browser, [planFile]);
    assert.equal(window.location.hash, '#var=');
    assert.equal(document.title, 'SageRoad');
    assert.deepEqual(app.loaded, {'name': 'plan.json', 'file': 'plan.json', 'site': null, 'changed': false, 'saved': true});
    await viewLoaded(browser);
    assert.equal(window.location.hash, "#var.vFile='local%3Aplan.json'");
    assert.equal(document.title, 'Fixture Plan');
    assert.deepEqual(headings(browser), directHeadings);
    assert.equal(app.page.data.file, 'local:plan.json');

    // The file is kept in the database
    assert.deepEqual(indexedDB.records('files'), [{'name': 'plan.json', 'type': 'application/json', 'blob': planFile, 'time': 1500}]);
    assert.equal(indexedDB.records('files')[0].blob, planFile);
    assert.deepEqual(indexedDB.requests, [
        ['files', 'readonly', 'getAll', null], ['files', 'readwrite', 'put', 'plan.json'], ['files', 'readonly', 'getAll', null]
    ]);
    assert.deepEqual(browser.fetches, []);

    // The report's links are the local plan's
    assert.equal(main.querySelector('table a').getAttribute('href'), "#var.vFile='local%3Aplan.json'&var.vOption=1");
});


test('opening a local plan and its source map image', async (context) => {
    const plan = fixturePlan();
    plan.image = 'maps/topo.png';
    const planText = JSON.stringify(plan);

    // The plan without its map image - the report says to open it
    const indexedDB = new FakeIndexedDB();
    let browser = fakeBrowser(context, {indexedDB, storage});
    await startApp(browser);
    await selectFiles(browser, [localFile(browser, 'plan.json', planText)]);
    await viewLoaded(browser);
    assert.equal(browser.document.title, 'Fixture Plan');
    assert.deepEqual(headings(browser), [...directHeadings, 'Source Map']);
    assert.equal(
        browser.document.getElementById('source-map').nextElementSibling.outerHTML,
        '<p>Open the map image ("maps/topo.png") with the road plan to show it here.</p>'
    );
    assert.equal(browser.main.querySelector('img'), null);
    assert.deepEqual(browser.objectURLs, []);
    assert.deepEqual(indexedDB.requests.slice(-1), [['files', 'readonly', 'get', 'topo.png']]);

    // The plan with its map image (the image's file name is the plan's image's) - the report shows it
    const imageFile = localFile(browser, 'topo.png', 'PNG', 'image/png');
    await dropFiles(browser, [imageFile, localFile(browser, 'plan.json', planText)]);
    await viewLoaded(browser);
    assert.equal(browser.window.location.hash, "#var.vFile='local%3Aplan.json'");
    assert.deepEqual(headings(browser), [...directHeadings, 'Source Map']);
    assert.equal(
        browser.document.getElementById('source-map').nextElementSibling.outerHTML,
        '<p><img src="blob:http://localhost/1" alt="The source topographic map" style="max-width: 100%; height: auto;"></p>'
    );
    assert.deepEqual(browser.objectURLs, [imageFile]);
    assert.deepEqual(indexedDB.records('files').map(({name, type}) => [name, type]), [
        ['plan.json', 'application/json'], ['topo.png', 'image/png']
    ]);

    // After a reload, the plan and its image are the database's
    browser = fakeBrowser(context, {indexedDB, storage, 'hash': "#var.vFile='local%3Aplan.json'"});
    await startApp(browser);
    assert.equal(browser.document.title, 'Fixture Plan');
    assert.equal(
        browser.document.getElementById('source-map').nextElementSibling.outerHTML,
        '<p><img src="blob:http://localhost/1" alt="The source topographic map" style="max-width: 100%; height: auto;"></p>'
    );
    assert.deepEqual(browser.objectURLs, [imageFile]);
    assert.deepEqual(indexedDB.requests.slice(-2), [['files', 'readonly', 'get', 'plan.json'], ['files', 'readonly', 'get', 'topo.png']]);
    assert.deepEqual(browser.fetches, []);
});


test('opening a local plan, then its source map image', async (context) => {
    const plan = fixturePlan();
    plan.image = 'topo.png';
    const browser = fakeBrowser(context, {storage, 'files': fixtureFiles});
    const {document, indexedDB, main, window} = browser;
    const app = await startApp(browser);

    // The plan without its map image
    await selectFiles(browser, [localFile(browser, 'plan.json', JSON.stringify(plan))]);
    await viewLoaded(browser);
    assert.equal(document.getElementById('source-map').nextElementSibling.textContent,
        'Open the map image ("topo.png") with the road plan to show it here.');
    const {data} = app.page;

    // Drop the map image on the plan's report - the report shows it
    const imageFile = localFile(browser, 'topo.png', 'PNG', 'image/png');
    await dropFiles(browser, [imageFile]);
    assert.equal(window.location.hash, "#var.vFile='local%3Aplan.json'");
    assert.equal(document.title, 'Fixture Plan');
    assert.deepEqual(headings(browser), [...directHeadings, 'Source Map']);
    assert.equal(
        document.getElementById('source-map').nextElementSibling.outerHTML,
        '<p><img src="blob:http://localhost/1" alt="The source topographic map" style="max-width: 100%; height: auto;"></p>'
    );
    assert.deepEqual(browser.objectURLs, [imageFile]);
    assert.notEqual(app.page.data, data);
    assert.deepEqual(indexedDB.records('files').map(({name}) => name), ['plan.json', 'topo.png']);

    // A revised map image replaces it
    const revisedFile = localFile(browser, 'topo.png', 'PNG2', 'image/png');
    await dropFiles(browser, [revisedFile]);
    assert.equal(main.querySelector('img').getAttribute('src'), 'blob:http://localhost/2');
    assert.deepEqual(browser.objectURLs, [imageFile, revisedFile]);

    // A plan from a URL is still cached
    window.location.hash = "#var.vFile='plans%2Ffixture.json'";
    await flush();
    await dropFiles(browser, [localFile(browser, 'other.png', 'PNG', 'image/png')]);
    assert.equal(document.title, 'Fixture Plan');
    assert.deepEqual(browser.fetches, ['plans/fixture.json']);
});


test('opening a source map image, then its local plan', async (context) => {
    const plan = fixturePlan();
    plan.image = 'topo.png';
    const browser = fakeBrowser(context, {storage});
    const {document, indexedDB, main, window} = browser;
    await startApp(browser);

    // The image alone - the home page stays
    const imageFile = localFile(browser, 'topo.png', 'PNG', 'image/png');
    await selectFiles(browser, [imageFile]);
    assert.equal(window.location.hash, '');
    assert.equal(document.title, 'SageRoad');
    assert.equal(main.innerHTML, homeHtml());
    assert.deepEqual(indexedDB.records('files').map(({name}) => name), ['topo.png']);

    // No files at all
    const scrollCount = browser.scrolls.length;
    await selectFiles(browser, []);
    assert.equal(window.location.hash, '');
    assert.equal(main.innerHTML, homeHtml());
    assert.equal(browser.scrolls.length, scrollCount);

    // The plan - the first JSON file is the loaded plan
    plan.title = 'First Plan';
    const firstFile = localFile(browser, 'first.json', JSON.stringify(plan));
    plan.title = 'Second Plan';
    const secondFile = localFile(browser, 'second.json', JSON.stringify(plan));
    await selectFiles(browser, [firstFile, secondFile]);
    await viewLoaded(browser);
    assert.equal(window.location.hash, "#var.vFile='local%3Afirst.json'");
    assert.equal(document.title, 'First Plan');
    assert.equal(main.querySelector('img').getAttribute('src'), 'blob:http://localhost/1');
    assert.deepEqual(browser.objectURLs, [imageFile]);
    assert.deepEqual(indexedDB.records('files').map(({name}) => name), ['topo.png', 'first.json', 'second.json']);
});


test('opening a local plan again replaces it', async (context) => {
    const browser = fakeBrowser(context, {storage});
    const {document, indexedDB, window} = browser;
    await startApp(browser);
    await selectFiles(browser, [localFile(browser, 'plan.json', fixtureText)]);
    await viewLoaded(browser);
    assert.equal(window.location.hash, "#var.vFile='local%3Aplan.json'");
    assert.equal(document.title, 'Fixture Plan');

    // Drop the revised plan on its report - it's the loaded plan
    const plan = fixturePlan();
    plan.title = 'Revised Plan';
    const revisedFile = localFile(browser, 'plan.json', JSON.stringify(plan));
    browser.clock.time = 500;
    await dropFiles(browser, [revisedFile]);
    await viewLoaded(browser);
    assert.equal(window.location.hash, "#var.vFile='local%3Aplan.json'");
    assert.equal(document.title, 'Revised Plan');
    assert.equal(browser.main.querySelector('h1').textContent, 'Revised Plan');
    assert.deepEqual(indexedDB.records('files'), [{'name': 'plan.json', 'type': 'application/json', 'blob': revisedFile, 'time': 500}]);
});


test('dragging and dropping files', async (context) => {
    const browser = fakeBrowser(context, {storage});
    const {document, window} = browser;
    const {body} = document;
    await startApp(browser);

    // Dragging over the page marks it as the drop target
    let event = fire(browser, body, 'dragover');
    assert.equal(event.defaultPrevented, true);
    assert.equal(body.className, 'sageroad-drop');

    // Dragging from one of the page's elements to another, then out of the page
    event = fire(browser, body, 'dragleave', {'relatedTarget': browser.main});
    assert.equal(event.defaultPrevented, false);
    assert.equal(body.className, 'sageroad-drop');
    fire(browser, body, 'dragleave', {'relatedTarget': null});
    assert.equal(body.className, '');

    // Dropping opens the files, not the browser's view of them
    fire(browser, browser.main, 'dragover');
    assert.equal(body.className, 'sageroad-drop');
    event = await dropFiles(browser, [localFile(browser, 'plan.json', fixtureText)]);
    assert.equal(event.defaultPrevented, true);
    assert.equal(body.className, '');
    await viewLoaded(browser);
    assert.equal(window.location.hash, "#var.vFile='local%3Aplan.json'");
    assert.equal(document.title, 'Fixture Plan');
});


test('a local plan that is not in the database', async (context) => {
    const browser = fakeBrowser(context, {'hash': "#var.vFile='local%3Agone.json'"});
    await startApp(browser);
    assert.equal(browser.document.title, 'SageRoad');
    assert.equal(browser.main.innerHTML, errorHtml('<strong>Error:</strong> Could not load the road plan "local:gone.json"'));
    assert.deepEqual(browser.indexedDB.requests, [['files', 'readonly', 'get', 'gone.json']]);
    assert.deepEqual(browser.fetches, []);
});


test('local plans without a working database', async (context) => {
    // No IndexedDB at all, a database that can't be opened, transactions that fail, and requests that fail
    const failures = [
        [null, []],
        ['open', []],
        ['transaction', []],
        ['request', [
            ['files', 'readonly', 'getAll', null], ['files', 'readwrite', 'put', 'plan.json'], ['files', 'readonly', 'getAll', null]
        ]]
    ];
    for (const [failure, expectedRequests] of failures) {
        const indexedDB = failure !== null ? new FakeIndexedDB() : null;
        if (indexedDB !== null) {
            indexedDB.failure = failure;
        }

        // The home page has no recent plans
        let browser = fakeBrowser(context, {indexedDB, storage});
        await startApp(browser);
        assert.equal(browser.main.innerHTML, homeHtml());

        // A local plan is viewed from memory
        await selectFiles(browser, [localFile(browser, 'plan.json', fixtureText)]);
        await viewLoaded(browser);
        assert.equal(browser.window.location.hash, "#var.vFile='local%3Aplan.json'");
        assert.equal(browser.document.title, 'Fixture Plan');
        assert.deepEqual(headings(browser), directHeadings);
        assert.deepEqual(indexedDB?.requests ?? [], expectedRequests);

        // The home page still has no recent plans - the plan is still loaded, though
        browser.window.location.hash = '#var=';
        await flushUntil(() => browser.main.querySelector('#sageroad-loaded h2') !== null);
        assert.equal(browser.document.getElementById('sageroad-recent').innerHTML, '');

        // After a reload, the plan is gone
        browser = fakeBrowser(context, {indexedDB, storage, 'hash': "#var.vFile='local%3Aplan.json'"});
        await startApp(browser);
        assert.equal(browser.main.innerHTML, errorHtml('<strong>Error:</strong> Could not load the road plan "local:plan.json"'));
    }
});
