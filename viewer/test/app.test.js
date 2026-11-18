import {FakeIndexedDB, fakeBrowser, fire, flush, startApp} from './appHelpers.js';
import {siteTypes, validateSite} from '../../plan/lib/site.js';
import {RoadieApp} from '../lib/app.js';
import assert from 'node:assert/strict';
import {fixturePlan} from './fixture.js';
import test from 'node:test';


// The fixture plan's JSON text, and the files of a server with it
const fixtureText = JSON.stringify(fixturePlan());
const fixtureFiles = {'plans/fixture.json': fixtureText};


// A measured terrain cell cost, in local storage, that keeps the 3D drawings small
const storage = {'roadieCellCost': '1'};


// The home page's HTML, with its recent plans' HTML, and its documentation link's URL
function homeHtml(recentHtml = '', docURL = '#var.vDoc=true') {
    return [
        '<h1>Roadie</h1>',
        '<p>Roadie is a 3D viewer for road grading plan models. A road grading plan model contains the site topography, ' +
            'the road start and end points, and one or more road plan options.</p>',
        '<div class="roadie-open">',
        '<p><label class="roadie-button">Open a road plan<input type="file" id="roadie-file" multiple="" ' +
            'accept=".json,application/json,image/*,application/pdf" hidden=""></label></p>',
        '<p>Select or drop a road plan model JSON file - and its source map image, to show it in the report. ' +
            'The files stay on your computer.</p>',
        '</div>',
        `<div id="roadie-recent">${recentHtml}</div>`,
        '<p>To view a road plan model URL, use the "file" argument: <code>#var.vFile=\'plan.json\'</code></p>',
        '<hr>',
        `<p><a href="${docURL}">Road plan model documentation</a></p>`
    ].join('\n');
}


// An error page's HTML
function errorHtml(messageHtml) {
    return `<h1>Roadie</h1><p>${messageHtml}</p><p><a href="#var=">Open another road plan</a></p>`;
}


// The loading page's HTML
const loadingHtml = '<h1>Roadie</h1><p class="roadie-loading">Loading the road plan…</p>';


// Create a local file
function localFile(browser, name, text, type = 'application/json') {
    return new browser.window.File([text], name, {type});
}


// Select files with the home page's file input
async function selectFiles(browser, files) {
    const input = browser.document.getElementById('roadie-file');
    Object.defineProperty(input, 'files', {'value': files, 'configurable': true});
    fire(browser, input, 'change');
    await flush();
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
    assert.equal(document.title, 'Roadie');
    assert.equal(main.innerHTML, homeHtml());
    assert.deepEqual(browser.scrolls, [['scrollTo', 0, 0]]);
    assert.equal(app.page, null);

    // The local files database is created, and its files are listed - there are none
    assert.equal(indexedDB.name, 'roadie-viewer');
    assert.equal(indexedDB.version, 1);
    assert.deepEqual([...indexedDB.stores], [['files', {'keyPath': 'name', 'records': new Map()}]]);
    assert.deepEqual(indexedDB.requests, [['files', 'readonly', 'getAll', null]]);

    // Nothing is fetched, logged, or drawn
    assert.deepEqual(browser.fetches, ['getRoad']);
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
    assert.deepEqual(browser.fetches, ['getRoad']);

    // The link opens the example's report
    browser.window.location.hash = main.querySelector('a[href*="vFile"]').getAttribute('href');
    await flush();
    assert.deepEqual(browser.fetches, ['getRoad', 'plans/fixture.json']);
    assert.equal(browser.document.title, 'Fixture Plan');
});


// Ollama's models' URL, and its response
const modelsURL = 'http://127.0.0.1:11434/api/tags';
const modelsText = JSON.stringify({'models': [{'name': 'qwen:27b'}, {'name': 5}, {'name': 'a<b'}]});


// The back end's road, and its road site model
const roadText = JSON.stringify({'site': 'hill & dale.json', 'plan': 'hill & dale plan.json', 'hasSite': true, 'hasPlan': false});
const planHref = '#var.vFile=\'files%2Fhill%2520%2526%2520dale%2520plan.json\'&amp;var.vOption=1';
const siteModel = {
    'title': 'Hill Road',
    'units': 'meters',
    'start': {'latitude': 46.1, 'longitude': -119.2, 'label': 'Road end'},
    'end': {'latitude': 46.2, 'longitude': -119.1},
    'notes': ['Stay off the barn.', 'A gravel road.'],
    'exclusions': [{'points': [
        {'latitude': 46.1, 'longitude': -119.1}, {'latitude': 46.2, 'longitude': -119.1}, {'latitude': 46.2, 'longitude': -119.2}
    ]}],
    'criteria': {'maxGrade': 10}
};


// Start the application with the planning tools - the road site's model, and "planRoad", a function that plans a road
async function startRoadApp(browser, planRoad = null) {
    const app = new RoadieApp(browser.window);
    app.importPlan = () => Promise.resolve({planRoad, siteTypes, validateSite});
    app.start();
    await flush();
    return app;
}


// Run the application's timeouts - a plan's status is drawn before the plan goes on
async function runPlan(browser) {
    await flush();
    while (browser.clock.timeouts.size > 0) {
        browser.clock.runTimeout();
        await flush();
    }
}


// Set the value of a road site form's member
function setMember(browser, member, value) {
    browser.document.querySelector(`[data-member="${member}"]`).value = value;
}


test('the road page', async (context) => {
    // The Roadie application's page is its back end's road's - the road site model is a form
    const files = {'getRoad': roadText, 'site': JSON.stringify(siteModel), [modelsURL]: modelsText};
    const browser = fakeBrowser(context, {files, 'hash': '#var.vOption=1'});
    await startRoadApp(browser);
    const {document} = browser;
    assert.equal(document.title, 'Roadie: hill & dale.json');
    assert.deepEqual(browser.fetches, ['getRoad', 'site', modelsURL]);
    assert.equal(document.querySelector('h1').textContent, 'Roadie');
    assert.equal(document.querySelector('p').innerHTML, 'The road site model, <code>hill &amp; dale.json</code>, is the road\'s ' +
        'start and end points, and its planning instructions.');
    const members = [...document.querySelectorAll('#roadie-site [data-member]')].map((control) => [control.dataset.member, control.value]);
    assert.deepEqual(members.filter(([member]) => !member.startsWith('costRates.')), [
        ['title', 'Hill Road'], ['units', 'meters'],
        ['start.latitude', '46.1'], ['start.longitude', '-119.2'], ['start.label', 'Road end'], ['start.description', ''],
        ['end.latitude', '46.2'], ['end.longitude', '-119.1'], ['end.label', ''], ['end.description', ''],
        ['notes', 'Stay off the barn.\nA gravel road.'],
        ['criteria.maxGrade', '10'], ['criteria.minRadius', ''], ['criteria.rockCutSlope', ''], ['criteria.maxWallHeight', ''],
        ['margin', ''], ['spacing', '']
    ]);
    assert.equal(members.length, 17 + siteTypes.CostRates.struct.members.length);
    assert.deepEqual([...document.querySelectorAll('#roadie-site details')].map((details) => details.open), [true, false]);
    assert.equal(document.querySelector('#roadie-site em').parentElement.textContent, 'Exclusions The areas the road must avoid ' +
        '(buildings, wetlands, a neighbor\'s land, etc.) It isn\'t edited here - it\'s kept as it is.');
    const select = document.getElementById('roadie-plan-model');
    assert.deepEqual([...select.options].map(({value, textContent}) => [value, textContent]), [
        ['', 'No model - the site\'s notes aren\'t read'], ['qwen:27b', 'qwen:27b'], ['a<b', 'a<b']
    ]);
    assert.equal(document.querySelector('#plan + p code').textContent, 'hill & dale plan.json');
    assert.equal(document.getElementById('roadie-plan-view').innerHTML, 'The road isn\'t planned yet.');
    assert.equal(
        browser.main.lastElementChild.innerHTML, '<a href="#var.vDoc=true&amp;var.vOption=1">Road plan model documentation</a>'
    );

    // Edit the road site, and save it - a map's point is pasted into a latitude, and the form isn't submitted
    const form = document.getElementById('roadie-site');
    const siteStatus = document.getElementById('roadie-site-status');
    setMember(browser, 'title', ' Hill & Dale Road ');
    setMember(browser, 'start.label', '');
    setMember(browser, 'notes', 'A paved road.\n\n  Stay off the barn.  \n');
    setMember(browser, 'margin', '300');
    const paste = fire(browser, document.querySelector('[data-member="end.latitude"]'), 'paste', {
        'clipboardData': {'getData': (format) => (format === 'text' ? ' (46.25, -119.15) ' : null)}
    });
    assert.equal(paste.defaultPrevented, true);
    assert.equal(fire(browser, form, 'submit').defaultPrevented, true);
    fire(browser, document.getElementById('roadie-site-save'), 'click');
    await flush();
    assert.equal(siteStatus.innerHTML, 'The road site is saved.');
    const saved = {
        'title': 'Hill & Dale Road',
        'units': 'meters',
        'start': {'latitude': 46.1, 'longitude': -119.2},
        'end': {'latitude': 46.25, 'longitude': -119.15},
        'notes': ['A paved road.', 'Stay off the barn.'],
        'exclusions': siteModel.exclusions,
        'criteria': {'maxGrade': 10},
        'margin': 300
    };
    assert.deepEqual(browser.puts, [['site', `${JSON.stringify(saved, null, 4)}\n`]]);

    // A road site that isn't valid isn't saved
    setMember(browser, 'start.latitude', 'abc');
    fire(browser, document.getElementById('roadie-site-save'), 'click');
    await flush();
    assert.equal(
        siteStatus.innerHTML,
        '<strong>Error:</strong> Invalid value "abc" (type "string") for member "start.latitude", expected type "float"'
    );
    assert.equal(browser.puts.length, 1);

    // The page is the road's again, when a plan's page is left
    browser.window.location.hash = '#var.vDoc=true';
    await flush();
    assert.equal(document.title, 'Roadie Road Plan Model');
    browser.window.location.hash = '#var=';
    await flush();
    assert.equal(document.title, 'Roadie: hill & dale.json');
    assert.equal(document.querySelector('[data-member="title"]').value, 'Hill Road');
});


test('the road page, a road is planned', async (context) => {
    // A road is planned by the planning tools, from its saved road site - with one of Ollama's models, or none
    const calls = [];
    const planRoad = async (window, road, {model, ollamaHost, progress, status}) => {
        calls.push([window === browser.window, road, model, ollamaHost, browser.puts.length]);
        await status('Creating the site');
        progress(['Grid: 10 x 10', 'Features: none']);
        await status('Engineering <the> options');
        progress(['Option "New Road"']);
        return {'code': 0, 'lines': ['Grid: 10 x 10', 'Features: none', 'Option "New Road"', 'Wrote hill & dale plan.json']};
    };
    const files = {'getRoad': roadText, 'site': JSON.stringify(siteModel), [modelsURL]: modelsText};
    const browser = fakeBrowser(context, {files, 'hash': '#var.vOption=1'});
    await startRoadApp(browser, planRoad);
    const {document} = browser;

    // Plan the road, with a model - the road site is saved, and the plan's status and its report are shown as it's made
    const controls = ['roadie-plan-start', 'roadie-plan-model', 'roadie-site-save'].map((id) => document.getElementById(id));
    const [start, select] = controls;
    const status = document.getElementById('roadie-plan-status');
    const log = document.getElementById('roadie-plan-log');
    const view = document.getElementById('roadie-plan-view');
    select.value = 'qwen:27b';
    setMember(browser, 'title', 'Dale Road');
    fire(browser, start, 'click');
    assert.deepEqual(controls.map((control) => control.disabled), [true, true, true]);
    await flush();
    assert.deepEqual([status.innerHTML, log.textContent], ['Creating the site…', '']);
    assert.equal(JSON.parse(browser.puts[0][1]).title, 'Dale Road');
    browser.clock.runTimeout();
    await flush();
    assert.deepEqual([status.innerHTML, log.textContent], ['Engineering &lt;the&gt; options…', 'Grid: 10 x 10\nFeatures: none\n']);
    assert.equal(view.innerHTML, 'The road isn\'t planned yet.');
    await runPlan(browser);
    const road = {'site': 'hill & dale.json', 'plan': 'hill & dale plan.json'};
    assert.deepEqual(calls, [[true, road, 'qwen:27b', 'http://127.0.0.1:11434', 1]]);
    assert.equal(log.textContent, 'Grid: 10 x 10\nFeatures: none\nOption "New Road"\nWrote hill & dale plan.json\n');
    assert.equal(status.innerHTML, 'The road is planned.');
    assert.equal(view.innerHTML, `<a href="${planHref}">View the road plan</a>`);
    assert.deepEqual(controls.map((control) => control.disabled), [false, false, false]);

    // Again, without a model
    select.value = '';
    fire(browser, start, 'click');
    assert.deepEqual([status.innerHTML, log.textContent], ['', '']);
    await runPlan(browser);
    assert.deepEqual(calls[1], [true, road, null, 'http://127.0.0.1:11434', 2]);
    assert.equal(log.textContent, 'Grid: 10 x 10\nFeatures: none\nOption "New Road"\nWrote hill & dale plan.json\n');
});


test('the road page, a road that\'s planned', async (context) => {
    // The road's plan is the back end's file
    const files = {
        'getRoad': JSON.stringify({'site': 'site.json', 'plan': 'ridge.json', 'hasSite': true, 'hasPlan': true}),
        'site': JSON.stringify(siteModel),
        'files/ridge.json': fixtureText
    };
    const browser = fakeBrowser(context, {files, storage});
    await startRoadApp(browser);
    const view = browser.document.getElementById('roadie-plan-view');
    assert.equal(view.innerHTML, '<a href="#var.vFile=\'files%2Fridge.json\'">View the road plan</a>');
    browser.window.location.hash = view.querySelector('a').getAttribute('href');
    await flush();
    assert.equal(browser.document.title, 'Fixture Plan');
    assert.deepEqual(browser.fetches, ['getRoad', 'site', modelsURL, 'files/ridge.json']);
});


test('the road page, a new road', async (context) => {
    // A road without a road site model is new. Ollama doesn't answer, so there are no models.
    const results = [
        () => Promise.resolve({'code': 1, 'lines': ['error: no road within the 11% grade limit']}),
        () => Promise.reject(new Error('Failed to fetch'))
    ];
    const files = {'getRoad': JSON.stringify({'site': 'site.json', 'plan': 'hill.json', 'hasSite': false, 'hasPlan': false})};
    const browser = fakeBrowser(context, {files});
    await startRoadApp(browser, () => results.shift()());
    const {document} = browser;
    assert.deepEqual(browser.fetches, ['getRoad', 'site', modelsURL]);
    assert.equal(document.querySelector('p').innerHTML, 'The road site model, <code>site.json</code>, is the road\'s ' +
        'start and end points, and its planning instructions. This road is new - it has no road site model yet.');
    const members = [...document.querySelectorAll('#roadie-site [data-member]')].map((control) => [control.dataset.member, control.value]);
    assert.deepEqual(members.filter(([, value]) => value !== ''), [['units', 'feet']]);
    assert.equal(document.querySelector('#roadie-site em'), null);
    assert.deepEqual([...document.querySelectorAll('#roadie-site details')].map((details) => details.open), [false, false]);
    assert.equal(document.getElementById('roadie-plan-model').options.length, 1);

    // The road isn't planned until its road site is saved
    const start = document.getElementById('roadie-plan-start');
    const siteStatus = document.getElementById('roadie-site-status');
    const planStatus = document.getElementById('roadie-plan-status');
    const log = document.getElementById('roadie-plan-log');
    fire(browser, start, 'click');
    await runPlan(browser);
    assert.equal(siteStatus.innerHTML, '<strong>Error:</strong> Required member "title" missing');
    assert.deepEqual([log.textContent, planStatus.innerHTML], ['error: The road site isn\'t saved\n', 'The road isn\'t planned.']);
    assert.deepEqual(browser.puts, []);

    // The back end doesn't save the road site
    const values = [['title', 'Hill'], ['start.latitude', '46.1'], ['start.longitude', '-119.2'], ['end.latitude', '46.1']];
    for (const [member, value] of values) {
        setMember(browser, member, value);
    }
    const longitude = document.querySelector('[data-member="end.longitude"]');
    fire(browser, longitude, 'paste', {'clipboardData': {'getData': () => '46.2, -119.1'}});
    fire(browser, start, 'paste', {'clipboardData': {'getData': () => '46.2, -119.1'}});
    fire(browser, document.querySelector('[data-member="end.latitude"]'), 'paste', {'clipboardData': {'getData': () => '-119.1'}});
    assert.equal(longitude.value, '');
    longitude.value = '-119.1';
    for (const [response, message] of [[403, 'Could not save the road site (status 403)'], [null, 'Could not save the road site']]) {
        browser.files['PUT site'] = response;
        fire(browser, start, 'click');
        await runPlan(browser);
        assert.equal(siteStatus.innerHTML, `<strong>Error:</strong> ${message}`);
        assert.equal(log.textContent, 'error: The road site isn\'t saved\n');
    }
    delete browser.files['PUT site'];

    // The road site is saved, and the plan fails - its report is its error
    for (const logText of ['error: no road within the 11% grade limit\n', 'error: Failed to fetch\n']) {
        fire(browser, start, 'click');
        await runPlan(browser);
        assert.equal(siteStatus.innerHTML, 'The road site is saved.');
        assert.deepEqual([log.textContent, planStatus.innerHTML], [logText, 'The road isn\'t planned.']);
        assert.equal(start.disabled, false);
    }
    assert.equal(document.getElementById('roadie-plan-view').innerHTML, 'The road isn\'t planned yet.');
    assert.deepEqual(JSON.parse(browser.puts[2][1]), {
        'title': 'Hill', 'units': 'feet', 'start': {'latitude': 46.1, 'longitude': -119.2}, 'end': {'latitude': 46.1, 'longitude': -119.1}
    });
});


test('the road page, a file that isn\'t a road site model', async (context) => {
    // The road's file isn't a JSON object - the road site is new, and saving it replaces the file
    for (const text of ['<html>', 'null', '[1]', '"hill"']) {
        const browser = fakeBrowser(context, {'files': {'getRoad': roadText, 'site': text}});
        await startRoadApp(browser);
        assert.equal(browser.document.querySelector('p strong').textContent, 'The file isn\'t a road site model - saving the road ' +
            'site replaces it.');
        assert.equal(browser.document.querySelector('[data-member="units"]').value, 'feet');
    }
});


test('the road page, a road that can\'t be loaded', async (context) => {
    // The application's planning tools, or its back end, don't answer
    for (const [siteText, importPlan] of [
        ['{}', () => Promise.reject(new Error('Failed to fetch dynamically imported module'))],
        [null, () => Promise.resolve({siteTypes, validateSite})]
    ]) {
        const browser = fakeBrowser(context, {'files': {'getRoad': roadText, 'site': siteText}});
        const app = new RoadieApp(browser.window);
        app.importPlan = importPlan;
        app.start();
        await flush();
        assert.equal(browser.main.innerHTML, '<h1>Roadie</h1>\n' +
            '<p><strong>Error:</strong> The road can\'t be loaded - the Roadie application\'s planning tools, or its back end, ' +
            'didn\'t answer.</p>');
    }
});


test('the road page, left while its road is loaded', async (context) => {
    // The page is left before the back end or Ollama answers, or before the road's site model is read - the page isn't drawn
    for (const pending of ['getRoad', modelsURL, 'site']) {
        let answer;
        const files = {...fixtureFiles, 'getRoad': roadText, 'site': '{}', [pending]: new Promise((resolve) => {
            answer = resolve;
        })};
        const browser = fakeBrowser(context, {files, storage});
        await startRoadApp(browser);
        assert.equal(browser.main.innerHTML, pending === 'getRoad' ? '' : '<h1>Roadie</h1><p class="roadie-loading">Loading the road…</p>');
        browser.window.location.hash = '#var.vFile=\'plans%2Ffixture.json\'';
        await flush();
        assert.equal(browser.document.title, 'Fixture Plan');
        answer(pending === 'getRoad' ? roadText : '{}');
        await flush();
        assert.equal(browser.document.title, 'Fixture Plan');
        assert.equal(browser.document.getElementById('roadie-site'), null);
    }
});


test('the road page, left while its road is saved or planned', async (context) => {
    // The page is left while its road site is saved, or while its road is planned - the plan goes on, but the page doesn't
    const hooks = {};
    const pending = () => new Promise((resolve) => {
        hooks.finish = resolve;
    });
    const planRoad = (window, road, {progress, status}) => {
        Object.assign(hooks, {progress, status});
        return pending();
    };
    for (const isSave of [true, false]) {
        const files = {...fixtureFiles, 'getRoad': roadText, 'site': JSON.stringify(siteModel)};
        if (isSave) {
            files['PUT site'] = pending();
        }
        const browser = fakeBrowser(context, {files, storage});
        await startRoadApp(browser, planRoad);
        fire(browser, browser.document.getElementById(isSave ? 'roadie-site-save' : 'roadie-plan-start'), 'click');
        await runPlan(browser);
        browser.window.location.hash = '#var.vFile=\'plans%2Ffixture.json\'';
        await flush();
        assert.equal(browser.document.title, 'Fixture Plan');
        const html = browser.main.innerHTML;
        if (isSave) {
            hooks.finish(200);
        } else {
            assert.equal(hooks.status('Engineering the options'), null);
            hooks.progress(['Option "New Road"']);
            hooks.finish({'code': 0, 'lines': ['Wrote hill.json']});
        }
        await flush();
        assert.equal(browser.main.innerHTML, html);
        assert.equal(browser.document.getElementById('roadie-plan-log'), null);
    }
});


test('the planning tools', async (context) => {
    // The application's planning tools are the project's - the road site's model, and a road's plan in a browser
    const browser = fakeBrowser(context);
    const tools = await new RoadieApp(browser.window).importPlan();
    assert.equal(typeof tools.planRoad, 'function');
    assert.equal(tools.siteTypes, siteTypes);
    assert.equal(tools.validateSite, validateSite);
});


test('the home page without a back end', async (context) => {
    // The back end doesn't answer with a road, or there's no back end - the page is the home page
    for (const response of ['{"site": "site.json"}', '{"site": "site.json", "plan": 5}', 'null', '<html>', null, undefined]) {
        const browser = fakeBrowser(context, {'files': {'getRoad': response}});
        await startApp(browser);
        assert.deepEqual(browser.fetches, ['getRoad']);
        assert.equal(browser.main.innerHTML, homeHtml());
    }
});


test('the home page lists the recent local plans', async (context) => {
    // Open local plans, a second apart - the last with its map image
    const indexedDB = new FakeIndexedDB();
    let browser = fakeBrowser(context, {indexedDB, storage});
    await startApp(browser);
    browser.clock.time = 1000;
    await selectFiles(browser, [localFile(browser, 'older.json', fixtureText)]);
    browser.clock.time = 2000;
    await dropFiles(browser, [localFile(browser, 'topo.png', 'PNG', 'image/png'), localFile(browser, 'Newer.JSON', fixtureText)]);
    assert.deepEqual(
        indexedDB.records('files').map(({name, type, time}) => [name, type, time]),
        [['older.json', 'application/json', 1000], ['topo.png', 'image/png', 2000], ['Newer.JSON', 'application/json', 2000]]
    );

    // The home page, later - the plans are listed, newest first, with the page's other arguments
    browser = fakeBrowser(context, {indexedDB, 'hash': '#var.vOption=1'});
    await startApp(browser);
    assert.equal(browser.document.title, 'Roadie');
    assert.equal(
        browser.main.innerHTML,
        homeHtml(
            '<h2 id="recent-plans">Recent Plans</h2><ul>' +
                '<li><p><a href="#var.vFile=\'local%3ANewer.JSON\'&amp;var.vOption=1">Newer.JSON</a></p></li>' +
                '<li><p><a href="#var.vFile=\'local%3Aolder.json\'&amp;var.vOption=1">older.json</a></p></li>' +
                '</ul>',
            '#var.vDoc=true&amp;var.vOption=1'
        )
    );

    // A recent plan's link opens it from the database
    browser.window.location.hash = browser.main.querySelector('#roadie-recent a').getAttribute('href');
    await flush();
    assert.equal(browser.document.title, 'Fixture Plan');
    assert.equal(browser.main.querySelector('h2:nth-of-type(2)').textContent, 'Bridge - East');
    assert.deepEqual(indexedDB.requests.slice(-2), [['files', 'readonly', 'getAll', null], ['files', 'readonly', 'get', 'Newer.JSON']]);
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
    assert.equal(document.title, 'Roadie Road Plan Model');
    assert.equal(document.getElementById('recent-plans'), null);
    assert.equal(main.querySelector('h1').textContent, 'struct RoadPlan');
});


test('the model documentation page', async (context) => {
    const browser = fakeBrowser(context, {'hash': '#var.vDoc=true'});
    const {document, main, window} = browser;
    const app = await startApp(browser);
    assert.equal(document.title, 'Roadie Road Plan Model');
    assert.ok(main.innerHTML.startsWith('<p><a href="#var=">Back</a></p>\n<h1 id="struct-roadplan">struct RoadPlan</h1>'));
    assert.equal(document.getElementById('enum-units').textContent, 'enum Units');
    assert.deepEqual(browser.scrolls, [['scrollTo', 0, 0]]);
    assert.equal(app.page, null);
    assert.deepEqual(browser.fetches, []);
    assert.deepEqual(browser.indexedDB.requests, []);

    // A header link scrolls to its header
    window.location.hash = '#var.vDoc=true&enum-units';
    await flush();
    assert.equal(document.title, 'Roadie Road Plan Model');
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
    assert.equal(document.title, 'Roadie');
    assert.equal(main.innerHTML, homeHtml());
    assert.deepEqual(browser.scrolls, [['scrollTo', 0, 0], ['scrollIntoView', 'enum-units'], ['scrollTo', 0, 0]]);
});


test('a plan URL', async (context) => {
    const browser = fakeBrowser(context, {'hash': '#url=plans/fixture.json', 'files': fixtureFiles, storage});
    const {document, main, window} = browser;

    // The plan is loading
    const started = startApp(browser);
    assert.equal(document.title, 'Roadie');
    assert.equal(main.innerHTML, loadingHtml);
    assert.deepEqual(browser.fetches, ['plans/fixture.json']);

    // The plan's report
    const app = await started;
    assert.equal(document.title, 'Fixture Plan');
    assert.deepEqual(headings(browser), directHeadings);
    assert.equal(app.page.data.file, 'plans/fixture.json');
    assert.equal(app.page.data.plan.title, 'Fixture Plan');
    assert.equal(document.body.classList.contains('roadie-explore'), false);
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
    assert.equal(document.title, 'Roadie');
    assert.equal(main.innerHTML, errorHtml('<strong>Error:</strong> Could not load the road plan "missing.json"'));
    assert.equal(app.page, null);

    // A network error, a plan that isn't JSON, and a null plan
    for (const file of ['network.json', 'text.json', 'null.json']) {
        window.location.hash = `#var.vFile='${file}'`;
        await flush();
        assert.equal(document.title, 'Roadie');
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
    assert.equal(document.title, 'Roadie');
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
    assert.equal(document.title, 'Roadie');
    assert.equal(main.innerHTML, homeHtml());

    // The plan loads - its report isn't rendered
    planText.resolve(fixtureText);
    await flush();
    assert.equal(document.title, 'Roadie');
    assert.equal(main.innerHTML, homeHtml());
    assert.equal(app.page, null);
    assert.equal(browser.clock.timeouts.size, 0);
    assert.equal(browser.observers.length, 0);

    // The loaded plan is kept, though - its report doesn't load it again
    window.location.hash = "#var.vFile='plans/fixture.json'";
    await flush();
    assert.equal(document.title, 'Fixture Plan');
    assert.deepEqual(headings(browser), directHeadings);
    assert.deepEqual(browser.fetches, ['plans/fixture.json', 'getRoad']);
});


test('the render time is logged with "?debug"', async (context) => {
    const browser = fakeBrowser(context, {'search': '?debug', 'hash': "#var.vFile='plans/fixture.json'", 'files': fixtureFiles, storage});
    await startApp(browser);
    assert.deepEqual(browser.logs, ['Roadie: render in 0.0 ms']);

    // The plan's pages only
    browser.window.location.hash = '#var.vDoc=true';
    await flush();
    browser.window.location.hash = '#var=';
    await flush();
    assert.deepEqual(browser.logs, ['Roadie: render in 0.0 ms']);
});


test('opening a local plan', async (context) => {
    const browser = fakeBrowser(context, {storage});
    const {document, indexedDB, main, window} = browser;
    const app = await startApp(browser);

    // Select the plan with the home page's file input - the plan's report is its "local:" URL
    const planFile = localFile(browser, 'plan.json', fixtureText);
    browser.clock.time = 1500;
    await selectFiles(browser, [planFile]);
    assert.equal(window.location.hash, "#var.vFile='local%3Aplan.json'");
    assert.equal(document.title, 'Fixture Plan');
    assert.deepEqual(headings(browser), directHeadings);
    assert.equal(app.page.data.file, 'local:plan.json');

    // The file is kept in the database
    assert.deepEqual(indexedDB.records('files'), [{'name': 'plan.json', 'type': 'application/json', 'blob': planFile, 'time': 1500}]);
    assert.equal(indexedDB.records('files')[0].blob, planFile);
    assert.deepEqual(indexedDB.requests, [['files', 'readonly', 'getAll', null], ['files', 'readwrite', 'put', 'plan.json']]);
    assert.deepEqual(browser.fetches, ['getRoad']);

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
    assert.deepEqual(browser.fetches, ['getRoad', 'plans/fixture.json']);
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
    assert.equal(document.title, 'Roadie');
    assert.equal(main.innerHTML, homeHtml());
    assert.deepEqual(indexedDB.records('files').map(({name}) => name), ['topo.png']);

    // No files at all
    const scrollCount = browser.scrolls.length;
    await selectFiles(browser, []);
    assert.equal(window.location.hash, '');
    assert.equal(main.innerHTML, homeHtml());
    assert.equal(browser.scrolls.length, scrollCount);

    // The plan - the first JSON file is the plan that's viewed
    plan.title = 'First Plan';
    const firstFile = localFile(browser, 'first.json', JSON.stringify(plan));
    plan.title = 'Second Plan';
    const secondFile = localFile(browser, 'second.json', JSON.stringify(plan));
    await selectFiles(browser, [firstFile, secondFile]);
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
    assert.equal(window.location.hash, "#var.vFile='local%3Aplan.json'");
    assert.equal(document.title, 'Fixture Plan');

    // Drop the revised plan on its report
    const plan = fixturePlan();
    plan.title = 'Revised Plan';
    const revisedFile = localFile(browser, 'plan.json', JSON.stringify(plan));
    browser.clock.time = 500;
    await dropFiles(browser, [revisedFile]);
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
    assert.equal(body.className, 'roadie-drop');

    // Dragging from one of the page's elements to another, then out of the page
    event = fire(browser, body, 'dragleave', {'relatedTarget': browser.main});
    assert.equal(event.defaultPrevented, false);
    assert.equal(body.className, 'roadie-drop');
    fire(browser, body, 'dragleave', {'relatedTarget': null});
    assert.equal(body.className, '');

    // Dropping opens the files, not the browser's view of them
    fire(browser, browser.main, 'dragover');
    assert.equal(body.className, 'roadie-drop');
    event = await dropFiles(browser, [localFile(browser, 'plan.json', fixtureText)]);
    assert.equal(event.defaultPrevented, true);
    assert.equal(body.className, '');
    assert.equal(window.location.hash, "#var.vFile='local%3Aplan.json'");
    assert.equal(document.title, 'Fixture Plan');
});


test('a local plan that is not in the database', async (context) => {
    const browser = fakeBrowser(context, {'hash': "#var.vFile='local%3Agone.json'"});
    await startApp(browser);
    assert.equal(browser.document.title, 'Roadie');
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
        ['request', [['files', 'readonly', 'getAll', null], ['files', 'readwrite', 'put', 'plan.json']]]
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
        assert.equal(browser.window.location.hash, "#var.vFile='local%3Aplan.json'");
        assert.equal(browser.document.title, 'Fixture Plan');
        assert.deepEqual(headings(browser), directHeadings);
        assert.deepEqual(indexedDB?.requests ?? [], expectedRequests);

        // The home page still has no recent plans
        browser.window.location.hash = '#var=';
        await flush();
        assert.equal(browser.main.innerHTML, homeHtml());

        // After a reload, the plan is gone
        browser = fakeBrowser(context, {indexedDB, storage, 'hash': "#var.vFile='local%3Aplan.json'"});
        await startApp(browser);
        assert.equal(browser.main.innerHTML, errorHtml('<strong>Error:</strong> Could not load the road plan "local:plan.json"'));
    }
});
