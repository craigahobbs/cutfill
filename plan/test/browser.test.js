import {autoSteps, browserIo, ollamaHostDefault, planRoad, siteDefaults, workerMessage} from '../lib/browser/io.js';
import {crc32, deflateSync} from '../lib/browser/zlib.js';
import {inflateSync, crc32 as nodeCrc32} from 'node:zlib';
import {siteEast, siteNorth, testItem, testPages, testSite} from './terrainHelpers.js';
import {testFetch, testTiff} from './tiffHelpers.js';
import {Buffer} from '../lib/browser/buffer.js';
import {Buffer as NodeBuffer} from 'node:buffer';
import assert from 'node:assert/strict';
import {grayPng} from '../lib/png.js';
import test from 'node:test';


test('Buffer', () => {
    // A buffer's base64 text is Node's
    for (const length of [0, 1, 2, 3, 4, 100, 24575, 24576, 24577, 70000]) {
        const bytes = Uint8Array.from({length}, (unused, ix) => (ix * 7 + 3) % 256);
        assert.equal(Buffer.from(bytes).toString('base64'), NodeBuffer.from(bytes).toString('base64'), `${length}`);
    }
    assert.equal(Buffer.from(Uint8Array.from([137, 80, 78, 71]).buffer).toString('base64'), 'iVBORw==');
});


test('crc32 and deflateSync', () => {
    // The checksum is Node's, and Node inflates the stream to its bytes
    for (const length of [0, 1, 10, 65534, 65535, 65536, 200000]) {
        const bytes = Uint8Array.from({length}, (unused, ix) => (ix * 13 + 5) % 256);
        assert.equal(crc32(bytes), nodeCrc32(bytes), `${length}`);
        const stream = deflateSync(bytes);
        assert.equal(stream.length, length + 6 + 5 * Math.max(1, Math.ceil(length / 65535)));
        assert.deepEqual(new Uint8Array(inflateSync(stream)), bytes);
    }

    // A PNG image file's checksums - its header's chunk is Node's
    const png = grayPng(2, 2, Uint8Array.from([0, 85, 170, 255]));
    assert.equal(crc32(png.subarray(12, 29)), new DataView(png.buffer).getUint32(29));
});


// The model's answers to the test's questions
const notesAnswer = {
    'purpose': 'A road to the house.', 'width': null, 'surface': null, 'maxGrade': null, 'minRadius': null, 'ruleOutRoads': [],
    'avoid': [{'name': 'Barn', 'where': 'north'}], 'passThrough': [], 'unhandled': []
};
const barnAnswer = {'found': true, 'west': 300, 'south': 60, 'east': 380, 'north': 120, 'why': 'A block.'};


// The test site's elevation model's file - a gentle valley
const modelUrl = 'https://example.com/model.tif';
const modelFetch = testFetch({[modelUrl]: testTiff({
    'width': 2000, 'height': 2000, 'tileWidth': 256, 'tileHeight': 256, 'east': siteEast - 1000, 'north': siteNorth + 1000,
    'elevation': (col, row) => 1700 + 0.03 * Math.abs(col - 1040) + 0.02 * (1000 - row)
})});


// Create a fake browser window - its fetch has the USGS's services (the test site's), its elevation model's file (any
// model's), and Ollama's model. The window records its fetches' URLs ("fetches") and its timeouts' delays.
function fakeWindow({mapType = 'image/png', imageLoads = true} = {}) {
    const item = testItem('CO_New_2020', 'x47y443', '2022-02-10');
    const pages = testPages({'items': [item]});
    const response = (value) => ({
        'ok': true,
        'status': 200,
        'headers': {'get': () => mapType},
        'json': () => Promise.resolve(value),
        'text': () => Promise.resolve(typeof value === 'string' ? value : new TextDecoder().decode(value)),
        'arrayBuffer': () => Promise.resolve(typeof value === 'string' ? new TextEncoder().encode(value).buffer : value.slice().buffer)
    });

    const window = {
        'fetches': [],
        'timeouts': [],
        'blobs': [],
        'revoked': [],
        'canvases': [],
        'TextEncoder': TextEncoder,
        'encodeURIComponent': encodeURIComponent,
        'setTimeout': (callback, delay) => {
            window.timeouts.push(delay);
            callback();
        },
        'URL': {
            'createObjectURL': (blob) => {
                window.blobs.push(blob);
                return `blob:${window.blobs.length}`;
            },
            'revokeObjectURL': (url) => window.revoked.push(url)
        },
        'Blob': class {
            constructor(parts, options) {
                Object.assign(this, {parts, options});
            }
        },
        'Image': class {
            constructor() {
                this.naturalWidth = 20;
                this.naturalHeight = 10;
            }

            get src() {
                return this.url;
            }

            set src(url) {
                this.url = url;
                queueMicrotask(() => (imageLoads ? this.onload() : this.onerror()));
            }
        },
        'document': {
            'createElement': (tag) => {
                if (tag === 'canvas') {
                    const canvas = {
                        'calls': [],
                        'getContext': () => ({
                            'fillRect': (...args) => canvas.calls.push(['fillRect', ...args]),
                            'drawImage': (image, ...args) => canvas.calls.push(['drawImage', image.src, ...args])
                        }),
                        'toBlob': (callback, type) => callback({
                            type, 'arrayBuffer': () => Promise.resolve(Uint8Array.from([137, 80, 78, 71]).buffer)
                        })
                    };
                    window.canvases.push(canvas);
                    return canvas;
                }
                return {};
            }
        },
        'fetch': (url, options = {}) => {
            const {method = 'GET', body = null} = options;
            window.fetches.push(method === 'GET' ? url : `${method} ${url}`);
            if (url.endsWith('.tif')) {
                return modelFetch(modelUrl, options);
            } else if (url.endsWith('/api/chat')) {
                const {messages: [{content}]} = JSON.parse(body);
                const answer = content.includes('Translate the notes') ? notesAnswer : barnAnswer;
                return Promise.resolve(response({'message': {'content': JSON.stringify(answer)}}));
            } else if (url.startsWith('https://basemap.nationalmap.gov/')) {
                return Promise.resolve(response(Uint8Array.from([137, 80, 78, 71])));
            }
            return Promise.resolve(response(pages(url)));
        }
    };
    return window;
}


test('browserIo, files', () => {
    // The files are in memory - a file's text, or its bytes
    const files = new Map([['plan.json', '{"title": "Hill"}']]);
    const io = browserIo(fakeWindow(), undefined, files);
    assert.equal(io.files, files);
    assert.equal(io.readFile('plan.json'), '{"title": "Hill"}');
    assert.deepEqual([...io.readBytes('plan.json')].slice(0, 3), [123, 34, 116]);
    io.writeFile('plan.work/notes.txt', '# Plan');
    io.writeBytes('plan.png', Uint8Array.from([1, 2, 3]));
    assert.equal(io.readFile('plan.work/notes.txt'), '# Plan');
    assert.deepEqual([...io.readBytes('plan.png')], [1, 2, 3]);
    assert.deepEqual([...files.keys()], ['plan.json', 'plan.work/notes.txt', 'plan.png']);
    assert.throws(() => io.readFile('other.json'), {'message': 'No such file "other.json"'});
    assert.throws(() => io.readFile('plan.png'), {'message': 'No such file "plan.png"'});
    assert.throws(() => io.readBytes('other.json'), {'message': 'No such file "other.json"'});

    // An input and output's files are its own, by default
    assert.deepEqual([...browserIo(fakeWindow()).files.keys()], []);
});


test('browserIo, the USGS\'s services and Ollama', async () => {
    const window = fakeWindow();
    const io = browserIo(window);

    // The services' JSON and bytes are fetched - a failed request is tried again, after a wait
    assert.deepEqual(await io.getJson('https://tnmaccess.nationalmap.gov/api/v1/products?max=1'), {
        'total': 1, 'items': [testItem('CO_New_2020', 'x47y443', '2022-02-10')]
    });
    assert.deepEqual([...await io.getBytes('https://basemap.nationalmap.gov/export')], [137, 80, 78, 71]);
    const notImage = browserIo(fakeWindow({'mapType': 'text/html'}));
    await assert.rejects(notImage.getBytes('https://basemap.nationalmap.gov/export'), /content type "text\/html"/);
    await io.sleep(250);
    assert.deepEqual(window.timeouts, [250]);

    // A model's question is Ollama's - the default host's, or another's
    assert.equal(ollamaHostDefault, 'http://127.0.0.1:11434');
    const schema = {'type': 'object', 'properties': {}, 'required': ['found']};
    assert.deepEqual(await io.ask({'model': 'test-model', 'question': 'Where is the barn?', schema}), barnAnswer);
    assert.equal(window.fetches.at(-1), 'POST http://127.0.0.1:11434/api/chat');
    const other = fakeWindow();
    await browserIo(other, 'http://ollama:1').ask({'model': 'test-model', 'question': 'Where is the barn?', schema});
    assert.equal(other.fetches.at(-1), 'POST http://ollama:1/api/chat');
});


test('browserIo, plots and elevation models', async () => {
    const window = fakeWindow();
    const io = browserIo(window);

    // A plot's SVG is drawn on a canvas - its PNG image file's bytes are the canvas's
    assert.deepEqual([...await io.renderPng('<svg/>')], [137, 80, 78, 71]);
    assert.deepEqual(window.blobs.map(({parts, options}) => [parts, options]), [[['<svg/>'], {'type': 'image/svg+xml'}]]);
    assert.deepEqual(window.canvases.map(({width, height, calls}) => [width, height, calls]), [
        [20, 10, [['fillRect', 0, 0, 20, 10], ['drawImage', 'blob:1', 0, 0]]]
    ]);
    assert.deepEqual(window.revoked, ['blob:1']);

    // A plot that can't be drawn
    const broken = fakeWindow({'imageLoads': false});
    await assert.rejects(browserIo(broken).renderPng('<svg'), {'message': 'Could not draw a plot'});
    assert.deepEqual(broken.revoked, ['blob:1']);

    // An elevation model's file is read - its header and tags, and a window's tiles
    const image = await io.openImage('https://example.com/model.tif');
    assert.deepEqual(image.georeference, {
        'zone': 13, 'east': siteEast - 1000, 'north': siteNorth + 1000, 'resolution': 1, 'width': 2000, 'height': 2000, 'noData': -999999
    });
    const elevations = await image.read([1039, 1000, 1042, 1001]);
    assert.deepEqual([...elevations].map((value) => Math.round(value * 100) / 100), [1700.03, 1700, 1700.03]);
    await io.openImage('https://example.com/other.tif');
    assert.deepEqual(window.fetches, ['https://example.com/model.tif', 'https://example.com/model.tif', 'https://example.com/other.tif']);
});


test('planRoad', async () => {
    // A road's plan is made in the browser, from its plan config - its files are in memory
    const site = testSite({'margin': 150, 'spacing': 10, 'notes': ['Stay off the barn.']});
    const window = fakeWindow();
    const files = new Map([['other.json', '{}'], ['plan.work/plan.png', Uint8Array.from([1])]]);
    const statuses = [];
    const result = await planRoad(window, {site}, {
        'model': 'test-model',
        'status': (text) => Promise.resolve(statuses.push(text)),
        files
    });
    assert.equal(result.code, 0);
    assert.deepEqual(result.lines.filter((line) => /^Notes|^Option \d|^Wrote/.test(line)), [
        'Notes: avoid "Barn" - an exclusion area from x 300 to 380, y 60 to 120',
        'Option 0: "New Road" - cost score 72.4, design warnings: 0',
        'Option 1: "North Corridor" - cost score 85.1, design warnings: 0'
    ]);
    assert.deepEqual(Object.keys(result), ['code', 'lines', 'plan']);
    assert.deepEqual([statuses[0], statuses.at(-1)], [
        'Creating the site - its terrain, streams, roads, and map are the USGS\'s', 'Writing the descriptions'
    ]);

    // The plan - its map image is a data URL, and its plan config is its site, with the barn the model found
    const {plan} = result;
    assert.deepEqual(siteDefaults(site), {'margin': 150, 'spacing': 1});
    assert.equal(autoSteps[0].key, 'site');
    assert.deepEqual(plan.options.map(({name}) => name), ['New Road', 'North Corridor']);
    assert.equal(plan.description[0], 'A road to the house.');
    assert.equal(plan.image, 'data:image/png;base64,iVBORw==');
    const {exclusions, ...config} = plan.site;
    assert.deepEqual(config, site);
    assert.deepEqual(exclusions.map(({name, found}) => [name, found]), [
        ['Barn', {'place': 'Barn', 'model': 'test-model', 'why': 'A block.'}]
    ]);
    assert.equal(files.has('other.json'), false);
    assert.deepEqual([...files.keys()].filter((path) => !path.startsWith('plan.work/')), ['plan.png']);
    assert.deepEqual(Object.keys(JSON.parse(files.get('plan.work/decisions.json')).answers), ['notes', 'avoid:Barn', 'avoid:Barn:closer']);
    assert.ok([...files.keys()].some((path) => path.startsWith('plan.work/terrain/')));
    assert.equal(window.fetches.filter((url) => url.endsWith('/api/chat')).length, 3);
    const elevationFetches = window.fetches.filter((url) => url.endsWith('.tif')).length;
    assert.ok(elevationFetches > 0);

    // The plan made again, from its plan config - its site's data is kept (the USGS isn't asked for it), its marks are the
    // plan config's, and the model's answers are the files'
    const fetchCount = window.fetches.length;
    const planBefore = JSON.stringify(plan);
    const again = await planRoad(window, {'site': plan.site, plan}, {'model': 'test-model', files});
    assert.equal(again.code, 0);
    assert.equal(JSON.stringify(plan), planBefore);

    // The plan is in memory - its files are its work directory's (its map image is the plan's data URL)
    assert.deepEqual([...files.keys()].filter((path) => !path.startsWith('plan.work/')), []);
    assert.ok(again.lines[0].startsWith('Site: the plan\'s site data is kept'));
    assert.deepEqual(window.fetches.slice(fetchCount), []);
    assert.equal(again.plan.image, plan.image);

    // The plan made again, with its site's data fetched again - the terrain is the files'
    const fetched = await planRoad(window, {'site': plan.site, plan}, {'model': 'test-model', files, 'fetch': true});
    assert.equal(fetched.code, 0);
    assert.equal(window.fetches.filter((url) => url.endsWith('/api/chat')).length, 3);
    assert.equal(window.fetches.filter((url) => url.endsWith('.tif')).length, elevationFetches);
    assert.ok(fetched.lines.includes('Kept the plan\'s other features: 1 stream'));
    assert.deepEqual(fetched.plan.site, plan.site);

    // A plan of another site isn't made again - it's a new plan
    const movedEnd = {...site, 'end': {...site.end, 'latitude': site.end.latitude + 0.0001}};
    const movedStart = {...site, 'start': {...site.start, 'longitude': site.start.longitude + 0.0001}};
    for (const other of [movedEnd, movedStart, {...site, 'units': 'feet'}]) {
        const otherResult = await planRoad(window, {'site': other, plan}, {files});
        assert.equal(otherResult.code, 0);
        assert.equal(otherResult.lines.some((line) => line.startsWith('Kept the plan')), false);
    }
    const noSite = await planRoad(window, {site, 'plan': {...plan, 'site': undefined}});
    assert.equal(noSite.lines.some((line) => line.startsWith('Kept the plan')), false);
});


test('planRoad, failures', async () => {
    // A plan config that isn't one
    const invalid = await planRoad(fakeWindow(), {'site': {}});
    assert.deepEqual([invalid.code, invalid.lines[0], invalid.plan], [1, 'error: The plan config is invalid:', null]);

    // A plan that fails - its question's plot can't be drawn
    const site = testSite({'margin': 150, 'spacing': 10});
    const notesSite = {...site, 'notes': ['Stay off the barn.']};
    const failed = await planRoad(fakeWindow({'imageLoads': false}), {'site': notesSite}, {'model': 'test-model'});
    assert.deepEqual([failed.code, failed.lines.at(-1), failed.plan], [1, 'error: Could not draw a plot', null]);

    // A plan config that isn't one, with a plan - the plan isn't the site's
    const {plan} = await planRoad(fakeWindow(), {site});
    const invalidSite = await planRoad(fakeWindow(), {'site': {}, plan});
    assert.deepEqual([invalidSite.code, invalidSite.lines[0]], [1, 'error: The plan config is invalid:']);

    // A plan without a map image keeps its image
    const noMap = await planRoad(fakeWindow({'mapType': 'text/html'}), {site});
    assert.equal(noMap.code, 0);
    assert.equal('image' in noMap.plan, false);
});


test('browserIo, stopped', async () => {
    // An aborted signal stops the functions that fetch, wait, or read - the fetches in flight are aborted, too
    const window = fakeWindow();
    const controller = new AbortController();
    const io = browserIo(window, undefined, undefined, controller.signal);
    const image = await io.openImage('https://example.com/model.tif');
    assert.equal(image.georeference.width, 2000);
    assert.equal((await image.read([0, 0, 1, 1])).length, 1);
    const fetches = [];
    const {fetch} = window;
    window.fetch = (url, options) => {
        fetches.push(options?.signal === controller.signal);
        return fetch(url, options);
    };
    await io.getJson('https://tnmaccess.nationalmap.gov/api/v1/products?max=1');
    assert.deepEqual(fetches, [true]);
    controller.abort();
    const stopped = {'name': 'AbortError'};
    await assert.rejects(io.getJson('https://tnmaccess.nationalmap.gov/api/v1/products?max=1'), stopped);
    await assert.rejects(io.sleep(250), stopped);
    await assert.rejects(io.openImage('https://example.com/model.tif'), stopped);
    await assert.rejects(image.read([0, 600, 1, 601]), stopped);
    await assert.rejects(io.ask({'model': 'test-model', 'question': 'Where?', 'schema': {}}), stopped);
    assert.deepEqual(fetches, [true]);

    // A wait that's stopped while it waits
    const waiting = new AbortController();
    const waitWindow = fakeWindow();
    waitWindow.setTimeout = (callback) => {
        waiting.abort();
        callback();
    };
    await assert.rejects(browserIo(waitWindow, undefined, undefined, waiting.signal).sleep(250), stopped);
});


test('planRoad, stopped', async () => {
    // The plan is stopped while it engineers its options, or while it fetches the site - its result is stopped
    const site = testSite({'margin': 150, 'spacing': 10});
    for (const stopStep of ['options', 'site']) {
        const files = new Map([['plan.work/terrain/tile.json', '{}'], ['plan.work/decisions.json', '{"answers": {}}'], ['old.json', '{}']]);
        const controller = new AbortController();
        const window = fakeWindow();
        const {fetch} = window;
        window.fetch = (url, options) => {
            if (stopStep === 'site' && url.startsWith('https://hydro')) {
                controller.abort();
            }
            return fetch(url, options);
        };
        const statuses = [];
        const result = await planRoad(window, {site}, {
            'signal': controller.signal,
            files,
            'status': (text, step) => {
                statuses.push(step);
                if (step === stopStep && stopStep === 'options') {
                    controller.abort();
                }
            }
        });
        assert.deepEqual(result, {'code': 1, 'lines': ['The plan was stopped'], 'plan': null, 'stopped': true});
        assert.deepEqual(statuses, stopStep === 'options' ? ['site', 'options'] : ['site']);

        // The plan's work is thrown away - the files are the files that were kept before it
        assert.deepEqual([...files], [['plan.work/terrain/tile.json', '{}'], ['plan.work/decisions.json', '{"answers": {}}']]);
    }
});


// Create a fake browser window with a fake worker - its worker's scope is a fake window, too, and its messages are
// copies, delivered later, as a worker's are. The window records its workers ("workers" - each one's URL, options, and
// whether it was terminated). A terminated worker's messages aren't delivered, unless "isDelivered" is true (a
// message the worker posted before it was terminated may be delivered).
function workerWindow({isDelivered = false, workerError = null, ...windowArgs} = {}) {
    const window = fakeWindow(windowArgs);
    window.workers = [];
    window.Worker = class {
        constructor(url, options) {
            this.record = {'url': url.href, options, 'terminated': false};
            window.workers.push(this.record);
            this.scope = fakeWindow();
            this.scope.postMessage = (data) => {
                const copy = structuredClone(data);
                setTimeout(() => {
                    if (isDelivered || !this.record.terminated) {
                        this.onmessage({'data': copy});
                    }
                });
            };
            if (workerError !== null) {
                setTimeout(() => this.onerror(workerError));
            }
        }

        postMessage(data) {
            const copy = structuredClone(data);
            setTimeout(() => {
                if (workerError === null) {
                    workerMessage(this.scope, copy);
                }
            });
        }

        terminate() {
            this.record.terminated = true;
        }
    };
    return window;
}


test('planRoad, in a worker', async () => {
    // The plan is made in a worker - it's the plan the page would make. Its plots are drawn by the page (a worker can't
    // draw an SVG image), and its statuses are the page's.
    const site = testSite({'margin': 150, 'spacing': 10, 'notes': ['Stay off the barn.']});
    const window = workerWindow();
    const files = new Map([['other.json', '{}'], ['plan.work/decisions.json', '{"answers": {}}']]);
    const statuses = [];
    const result = await planRoad(window, {site}, {'model': 'test-model', 'status': (text, step) => statuses.push(step), files});
    const pageFiles = new Map([['plan.work/decisions.json', '{"answers": {}}']]);
    const pageStatuses = [];
    const pageResult = await planRoad(fakeWindow(), {site}, {
        'model': 'test-model', 'status': (text, step) => pageStatuses.push(step), 'files': pageFiles
    });
    assert.equal(result.code, 0);
    assert.deepEqual(result, pageResult);
    assert.deepEqual(statuses, pageStatuses);
    assert.deepEqual(files, pageFiles);

    // The worker is the module's, and it's ended when the plan is made - the page drew the model's plots
    const workerUrl = new URL('../lib/browser/worker.js', import.meta.url).href;
    assert.deepEqual(window.workers, [{'url': workerUrl, 'options': {'type': 'module'}, 'terminated': true}]);
    assert.equal(window.canvases.length, 2);
    assert.deepEqual(window.fetches, []);

    // A plan without a status function, a signal, or files
    const again = await planRoad(workerWindow(), {site});
    assert.deepEqual([again.code, again.plan.options.length], [0, 2]);
});


test('planRoad, in a worker, failures', async () => {
    // A plot that the page can't draw - the plan fails
    const site = testSite({'margin': 150, 'spacing': 10, 'notes': ['Stay off the barn.']});
    const failed = await planRoad(workerWindow({'imageLoads': false}), {site}, {'model': 'test-model'});
    assert.deepEqual([failed.code, failed.lines.at(-1), failed.plan], [1, 'error: Could not draw a plot', null]);

    // The worker fails - its module can't be loaded, say (an error may have no message)
    const workerFailed = 'error: The plan\'s worker failed';
    for (const [message, line] of [['Not found', `${workerFailed} - Not found`], ['', workerFailed]]) {
        const window = workerWindow({'workerError': {message}});
        const files = new Map([['plan.work/decisions.json', '{}']]);
        assert.deepEqual(await planRoad(window, {site}, {files}), {'code': 1, 'lines': [line], 'plan': null});
        assert.deepEqual([window.workers[0].terminated, [...files.keys()]], [true, ['plan.work/decisions.json']]);
    }

    // A plan that throws is the worker's error result
    const posted = [];
    await workerMessage({'postMessage': (data) => posted.push(data)}, {'type': 'run', 'road': null, 'files': new Map()});
    assert.deepEqual(posted.map(({type, result}) => [type, result.code, result.lines[0].slice(0, 7), result.plan]), [
        ['done', 1, 'error: ', null]
    ]);
});


test('planRoad, in a worker, stopped', async () => {
    // The plan is stopped while it engineers its options - it stops at once, its worker is ended, and its work is thrown
    // away: the files are the files that were kept before it
    const site = testSite({'margin': 150, 'spacing': 10});
    for (const isDelivered of [false, true]) {
        const window = workerWindow({isDelivered});
        const files = new Map([['plan.work/decisions.json', '{"answers": {}}'], ['old.json', '{}']]);
        const controller = new AbortController();
        const statuses = [];
        const result = await planRoad(window, {site}, {
            'signal': controller.signal,
            files,
            'status': (text, step) => {
                statuses.push(step);
                if (step === 'options') {
                    controller.abort();
                }
            }
        });
        assert.deepEqual(result, {'code': 1, 'lines': ['The plan was stopped'], 'plan': null, 'stopped': true});
        assert.deepEqual([statuses, window.workers.map(({terminated}) => terminated)], [['site', 'options'], [true]]);
        assert.deepEqual([...files], [['plan.work/decisions.json', '{"answers": {}}']]);

        // The worker's messages after it's stopped (a browser may deliver those it posted before) are ignored
        await new Promise((resolve) => {
            setTimeout(resolve, 100);
        });
        assert.deepEqual([...files], [['plan.work/decisions.json', '{"answers": {}}']]);
    }

    // A plan that's stopped before it starts has no worker
    const window = workerWindow();
    const controller = new AbortController();
    controller.abort();
    assert.deepEqual(await planRoad(window, {site}, {'signal': controller.signal}), {
        'code': 1, 'lines': ['The plan was stopped'], 'plan': null, 'stopped': true
    });
    assert.deepEqual(window.workers, []);
});


test('worker.js', async () => {
    // The worker's messages are workerMessage's - its scope is the global scope
    const posted = [];
    globalThis.postMessage = (data) => posted.push(data);
    try {
        await import('../lib/browser/worker.js');
        await globalThis.onmessage({'data': {'type': 'run', 'road': {'site': {}}, 'files': new Map()}});
        assert.deepEqual(posted.map(({type, result}) => [type, result.lines[0]]), [['done', 'error: The plan config is invalid:']]);
    } finally {
        delete globalThis.postMessage;
        delete globalThis.onmessage;
    }
});
