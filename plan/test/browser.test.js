import {browserIo, ollamaHostDefault, planRoad} from '../lib/browser/io.js';
import {crc32, deflateSync} from '../lib/browser/zlib.js';
import {inflateSync, crc32 as nodeCrc32} from 'node:zlib';
import {siteEast, siteNorth, testItem, testPages, testSite} from './terrainHelpers.js';
import {Buffer} from '../lib/browser/buffer.js';
import {Buffer as NodeBuffer} from 'node:buffer';
import assert from 'node:assert/strict';
import {grayPng} from '../lib/png.js';
import {parseArgs as nodeParseArgs} from 'node:util';
import {parseArgs} from '../lib/browser/util.js';
import test from 'node:test';


// Parse arguments with the browser's parseArgs and Node's - returns each one's values and positionals, or its error
function parseBoth(config) {
    return [parseArgs, nodeParseArgs].map((parse) => {
        try {
            const {values, positionals} = parse(config);
            return {'values': {...values}, positionals};
        } catch {
            return 'error';
        }
    });
}


test('parseArgs', () => {
    // The browser's parseArgs parses the tools' commands' arguments as Node's does
    const options = {
        'name': {'type': 'string', 'short': 'n'},
        'via': {'type': 'string', 'short': 'v', 'multiple': true},
        'surface': {'type': 'string', 'short': 's', 'default': 'gravel'},
        'all-new': {'type': 'boolean', 'default': false},
        'fresh': {'type': 'boolean'}
    };
    for (const args of [
        [],
        ['plan.json'],
        ['plan.json', '-n', 'Road', '--via', '10,20', '-v', '30,40', '--all-new', 'extra'],
        ['--name=Hill Road', '--surface=asphalt', 'plan.json'],
        ['-nRoad', '--fresh', 'plan.json'],
        ['plan.json', '--', '-n', '--unknown'],
        ['--name', '-', 'plan.json'],
        ['-'],

        // Errors - an unknown option, a missing value, a boolean option's value, and a value that looks like an option
        ['--unknown'],
        ['-x'],
        ['--name'],
        ['-n'],
        ['--fresh=yes'],
        ['--name', '--fresh'],
        ['--name', '-5']
    ]) {
        const [browser, node] = parseBoth({args, options, 'allowPositionals': true});
        assert.deepEqual(browser, node, JSON.stringify(args));
    }
    assert.deepEqual(parseArgs({'args': ['a', '--fresh'], options, 'allowPositionals': true}), {
        'values': Object.assign(Object.create(null), {'fresh': true, 'surface': 'gravel', 'all-new': false}),
        'positionals': ['a']
    });
    assert.equal('toString' in parseArgs({'args': []}).values, false);

    // Positional arguments aren't allowed, unless they are
    for (const args of [[], ['plan.json'], ['--fresh', 'plan.json']]) {
        const [browser, node] = parseBoth({args, options});
        assert.deepEqual(browser, node, JSON.stringify(args));
    }
    assert.throws(() => parseArgs({'args': ['plan.json']}), {'name': 'TypeError', 'message': 'Unexpected argument \'plan.json\''});
    assert.throws(() => parseArgs({'args': ['--unknown'], options}), {'message': 'Unknown option \'--unknown\''});
    assert.throws(() => parseArgs({'args': ['--name'], options}), {'message': 'Option \'--name\' argument missing'});
    assert.throws(() => parseArgs({'args': ['--fresh=1'], options}), {'message': 'Option \'--fresh=1\' does not take an argument'});
});


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


// The test's road - its road site model's file name, and its road plan model's
const road = {'site': 'hill-site.json', 'plan': 'hill.json'};


// The model's answers to the test's questions
const notesAnswer = {
    'purpose': 'A road to the house.', 'width': null, 'surface': null, 'maxGrade': null, 'minRadius': null, 'ruleOutRoads': [],
    'avoid': [{'name': 'Barn', 'where': 'north'}], 'passThrough': [], 'unhandled': []
};
const barnAnswer = {'found': true, 'west': 300, 'south': 60, 'east': 380, 'north': 120, 'why': 'A block.'};


// Create a fake browser window - its fetch has the back end's "files" (a URL's text or bytes), the USGS's services
// (the test site's), and Ollama's model. The window records its fetches' URLs ("fetches"), the files that were
// written ("puts"), and its timeouts' delays.
function fakeWindow({files = {}, writeStatus = 200, mapType = 'image/png', imageLoads = true, scriptLoads = true} = {}) {
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

    // A GeoTIFF image of a gentle valley - the test site's elevation model
    const geotiffImage = {
        'getOrigin': () => [siteEast - 1000, siteNorth + 1000],
        'getResolution': () => [1, -1],
        'getGeoKeys': () => ({'ProjectedCSTypeGeoKey': 26913}),
        'getWidth': () => 2000,
        'getHeight': () => 2000,
        'getGDALNoData': () => -999999,
        'readRasters': ({'window': [x1, y1, x2, y2]}) => {
            const data = new Float32Array((x2 - x1) * (y2 - y1));
            for (let y = y1; y < y2; y++) {
                for (let x = x1; x < x2; x++) {
                    data[(y - y1) * (x2 - x1) + (x - x1)] = 1700 + 0.03 * Math.abs(x - 1040) + 0.02 * (1000 - y);
                }
            }
            return Promise.resolve([data]);
        }
    };

    const window = {
        'fetches': [],
        'puts': {},
        'timeouts': [],
        'blobs': [],
        'revoked': [],
        'scripts': [],
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
            },
            'head': {'append': (script) => {
                window.scripts.push(script.src);
                queueMicrotask(() => {
                    if (scriptLoads) {
                        window.GeoTIFF = {'fromUrl': (url) => {
                            window.fetches.push(url);
                            return Promise.resolve({'getImage': () => Promise.resolve(geotiffImage)});
                        }};
                        script.onload();
                    } else {
                        script.onerror();
                    }
                });
            }}
        },
        'fetch': (url, {method = 'GET', body = null} = {}) => {
            window.fetches.push(method === 'GET' ? url : `${method} ${url}`);
            if (url.startsWith('files/') || url === 'site') {
                if (method === 'PUT') {
                    window.puts[url] = body;
                    return Promise.resolve({'ok': writeStatus === 200, 'status': writeStatus});
                }
                return Promise.resolve(url in files ? response(files[url]) : {'ok': false, 'status': 404});
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


test('browserIo, files', async () => {
    const window = fakeWindow({
        'files': {'files/hill%20road.json': '{"title": "Hill"}', 'files/hill.png': Uint8Array.from([1, 2, 3])}
    });
    const io = browserIo(window);

    // A file is loaded from the back end - its text, or its bytes
    assert.equal(await io.load('hill road.json'), true);
    assert.equal(await io.load('hill.png', false), true);
    assert.equal(await io.load('hill.json'), false);
    assert.equal(io.readFile('hill road.json'), '{"title": "Hill"}');
    assert.deepEqual([...io.readBytes('hill.png')], [1, 2, 3]);
    assert.deepEqual([...io.readBytes('hill road.json')].slice(0, 3), [123, 34, 116]);
    assert.throws(() => io.readFile('hill.json'), {'message': 'No such file "hill.json"'});
    assert.throws(() => io.readFile('hill.png'), {'message': 'No such file "hill.png"'});
    assert.throws(() => io.readBytes('hill.json'), {'message': 'No such file "hill.json"'});
    assert.deepEqual(window.fetches, ['files/hill%20road.json', 'files/hill.png', 'files/hill.json']);

    // A file that's written is in memory, and it's written to the back end - but for the terrain cache's
    io.writeFile('hill.json', '{"title": "Hill Road"}');
    io.writeBytes('hill.work/ask/the barn.png', Uint8Array.from([4, 5]));
    io.writeFile('hill.work/terrain/tile.json', '{}');
    io.writeBytes('hill.work/terrain/tile.f32', Uint8Array.from([6]));
    assert.equal(io.readFile('hill.json'), '{"title": "Hill Road"}');
    assert.equal(io.readFile('hill.work/terrain/tile.json'), '{}');
    assert.deepEqual([...io.readBytes('hill.work/terrain/tile.f32')], [6]);
    await io.flush();
    assert.deepEqual(Object.keys(window.puts), ['files/hill.json', 'files/hill.work/ask/the%20barn.png']);
    assert.equal(window.puts['files/hill.json'], '{"title": "Hill Road"}');
    assert.deepEqual([...io.files.keys()], [
        'hill road.json', 'hill.png', 'hill.json', 'hill.work/ask/the barn.png', 'hill.work/terrain/tile.json',
        'hill.work/terrain/tile.f32'
    ]);

    // A file that the back end doesn't write is an error, when the files are waited for
    const failed = browserIo(fakeWindow({'writeStatus': 400}));
    failed.writeFile('script.js', 'text');
    await assert.rejects(failed.flush(), {'message': 'Could not write "script.js" (status 400)'});
    await failed.flush();
});


test('browserIo, the road site', async () => {
    // The road site model's file is the back end's "site" - in memory, it's in the "site/" directory
    const window = fakeWindow({'files': {'site': '{"title": "Hill"}'}});
    const io = browserIo(window);
    assert.equal(await io.load('site/hill.json'), true);
    assert.equal(io.readFile('site/hill.json'), '{"title": "Hill"}');
    io.writeFile('site/hill.json', '{"title": "Hill Road"}');
    io.writeFile('hill.json', '{"title": "Hill Road", "options": []}');
    await io.flush();
    assert.deepEqual(window.fetches, ['site', 'PUT site', 'PUT files/hill.json']);
    assert.deepEqual(window.puts, {'site': '{"title": "Hill Road"}', 'files/hill.json': '{"title": "Hill Road", "options": []}'});
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

    // An elevation model is read with the GeoTIFF reader - its script is loaded once
    const image = await io.openImage('https://example.com/model.tif');
    assert.deepEqual(image.georeference, {
        'zone': 13, 'east': siteEast - 1000, 'north': siteNorth + 1000, 'resolution': 1, 'width': 2000, 'height': 2000, 'noData': -999999
    });
    const elevations = await image.read([1039, 1000, 1042, 1001]);
    assert.deepEqual([...elevations].map((value) => Math.round(value * 100) / 100), [1700.03, 1700, 1700.03]);
    await io.openImage('https://example.com/other.tif');
    assert.deepEqual(window.scripts, ['geotiff.js']);
    assert.deepEqual(window.fetches, ['https://example.com/model.tif', 'https://example.com/other.tif']);

    // The reader's script doesn't load
    await assert.rejects(
        browserIo(fakeWindow({'scriptLoads': false})).openImage('https://example.com/model.tif'),
        {'message': 'Could not load the elevation models\' reader'}
    );
});


test('planRoad', async () => {
    // A road's plan is made in the browser - its site model is the back end's, and its files are written to the back end
    const site = testSite({'margin': 150, 'spacing': 10, 'notes': ['Stay off the barn.']});
    const window = fakeWindow({'files': {'site': JSON.stringify(site)}});
    const progressLines = [];
    const statuses = [];
    const result = await planRoad(window, road, {
        'model': 'test-model',
        'progress': (lines) => progressLines.push(...lines),
        'status': (text) => Promise.resolve(statuses.push(text))
    });
    assert.equal(result.code, 0);
    assert.deepEqual(result.lines.filter((line) => /^Notes|^Option \d|^Wrote/.test(line)), [
        'Notes: avoid "Barn" - an exclusion area from x 300 to 380, y 60 to 120',
        'Option 0: "New Road" - cost score 72.6, design warnings: 0',
        'Wrote hill.json - its descriptions are "hill.work/descriptions.md", and its plots are in "hill.work/"'
    ]);
    assert.deepEqual(progressLines, result.lines);
    assert.deepEqual([statuses[0], statuses.at(-1)], [
        'Creating the site - its terrain, streams, roads, and map are the USGS\'s', 'Writing the descriptions and the plots'
    ]);

    // The back end's files - the plan, its map image, and its work directory's (but for the terrain cache's)
    assert.deepEqual(Object.keys(window.puts).sort(), [
        'files/hill.json', 'files/hill.png', 'files/hill.work/ask/barn-box.png', 'files/hill.work/ask/barn.png',
        'files/hill.work/decisions.json', 'files/hill.work/descriptions.md', 'files/hill.work/map.png', 'files/hill.work/plan.png'
    ]);
    const plan = JSON.parse(window.puts['files/hill.json']);
    assert.deepEqual(plan.options.map(({name}) => name), ['New Road']);
    assert.equal(plan.description[0], 'A road to the house.');
    assert.deepEqual(Object.keys(JSON.parse(window.puts['files/hill.work/decisions.json']).answers), [
        'notes', 'avoid:Barn', 'avoid:Barn:closer'
    ]);
    assert.deepEqual(window.fetches.slice(0, 3), ['site', 'files/hill.json', 'files/hill.work/decisions.json']);
    assert.equal(window.fetches.filter((url) => url.endsWith('/api/chat')).length, 3);

    // Again, without a model - the road's plan and the model's saved answers are the back end's
    const files = Object.fromEntries(Object.entries(window.puts).map(([url, content]) => [url, content]));
    const again = fakeWindow({'files': {...files, 'site': JSON.stringify(site)}});
    const plain = await planRoad(again, road);
    assert.equal(plain.code, 0);
    assert.ok(plain.lines.includes('Notes: not read - there\'s no model (--model)'));
    assert.equal(again.fetches.filter((url) => url.endsWith('/api/chat')).length, 0);
});


test('planRoad, failures', async () => {
    // A road without a site model
    assert.deepEqual(await planRoad(fakeWindow(), road), {'code': 1, 'lines': ['error: Could not load the road site "hill-site.json"']});

    // A file that the back end doesn't write
    const site = testSite({'margin': 150, 'spacing': 10});
    const window = fakeWindow({'files': {'site': JSON.stringify(site)}, 'writeStatus': 500});
    const result = await planRoad(window, road);
    assert.equal(result.code, 1);
    assert.match(result.lines[0], /^error: Could not write "hill\.(png|json)" \(status 500\)$/);

    // A site model that isn't one
    const invalid = await planRoad(fakeWindow({'files': {'site': '{}'}}), road);
    assert.equal(invalid.code, 1);
    assert.equal(invalid.lines[0], 'error: The road site "site/hill-site.json" is invalid:');
});
