import {lzwCodes, lzwPack, testFetch, testTiff} from './tiffHelpers.js';
import {lzwDecode, openElevationImage} from '../lib/elevationImage.js';
import assert from 'node:assert/strict';
import test from 'node:test';


// The test image's URL, and its elevation at a pixel - 40 x 24 pixels, in tiles of 16 x 16
const url = 'https://example.com/model.tif';
const elevation = (col, row) => 100 + col + 0.25 * row;


// Get a window's expected elevations
function windowElevations([x1, y1, x2, y2], elevationFn = elevation) {
    const values = [];
    for (let row = y1; row < y2; row++) {
        for (let col = x1; col < x2; col++) {
            values.push(Math.fround(elevationFn(col, row)));
        }
    }
    return values;
}


// Create elevations that vary a lot - a function of a pixel
function noisyElevation() {
    let seed = 1;
    const values = Array.from({'length': 4096}, () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return 1000 + 500 * seed / 2147483648;
    });
    return (col, row) => values[(row * 64 + col) % values.length];
}


test('openElevationImage', async () => {
    // The image's file is read with each predictor - none, horizontal, and floating point
    for (const predictor of [1, 2, 3]) {
        const fetchFn = testFetch({[url]: testTiff({predictor})});
        const image = await openElevationImage(fetchFn, url);
        assert.deepEqual(image.georeference, {
            'zone': 13, 'east': 476000, 'north': 4427000, 'resolution': 1, 'width': 40, 'height': 24, 'noData': -999999
        });

        // The file's header and its tags are one request
        assert.deepEqual(fetchFn.requests, [['model.tif', 'bytes=0-65535']]);

        // Read a window of the image's elevations - the pixel columns 1 up to 4, and rows 1 up to 3
        const data = await image.read([1, 1, 4, 3]);
        assert.equal(data.constructor, Float32Array);
        assert.deepEqual([...data], [101.25, 102.25, 103.25, 101.5, 102.5, 103.5]);

        // Windows across the image's tiles, and to its last pixel (its last tiles are wider and taller than the image)
        for (const window of [[14, 14, 18, 18], [0, 0, 40, 24], [30, 20, 40, 24], [15, 0, 33, 1]]) {
            assert.deepEqual([...await image.read(window)], windowElevations(window), `${predictor} ${window}`);
        }
    }
});


test('openElevationImage, the requests', async () => {
    // A window's tiles are fetched a row of tiles at a time - a row's tiles are together in the file, so they're one request
    const file = testTiff();
    const fetchFn = testFetch({[url]: file});
    const image = await openElevationImage(fetchFn, url);
    const view = new DataView(file.buffer);
    const tags = {};
    for (let ixEntry = 0; ixEntry < view.getUint16(8, true); ixEntry++) {
        tags[view.getUint16(10 + ixEntry * 12, true)] = view.getUint32(18 + ixEntry * 12, true);
    }
    const offsets = Array.from({'length': 6}, (unused, ix) => view.getUint32(tags[324] + ix * 4, true));
    const counts = Array.from({'length': 6}, (unused, ix) => view.getUint32(tags[325] + ix * 4, true));
    const range = (first, last) => ['model.tif', `bytes=${offsets[first]}-${offsets[last] + counts[last] - 1}`];
    fetchFn.requests.length = 0;
    await image.read([0, 0, 40, 10]);
    assert.deepEqual(fetchFn.requests, [range(0, 2)]);

    // The window below has the last window's tiles - they aren't fetched again
    fetchFn.requests.length = 0;
    assert.deepEqual([...await image.read([0, 10, 40, 24])], windowElevations([0, 10, 40, 24]));
    assert.deepEqual(fetchFn.requests, [range(3, 5)]);
    fetchFn.requests.length = 0;
    assert.deepEqual([...await image.read([20, 20, 30, 24])], windowElevations([20, 20, 30, 24]));
    assert.deepEqual(fetchFn.requests, []);

    // The tiles of the window before the last aren't kept
    await image.read([0, 0, 10, 10]);
    assert.deepEqual(fetchFn.requests, [range(0, 0)]);

    // Tiles that are apart in the file, or aren't in the tiles' order, are fetched by themselves
    for (const options of [{'tileGap': 5000}, {'tilesReversed': true}]) {
        const apartFetch = testFetch({[url]: testTiff(options)});
        const apart = await openElevationImage(apartFetch, url);
        assert.deepEqual([...await apart.read([10, 0, 40, 24])], windowElevations([10, 0, 40, 24]));
        assert.equal(apartFetch.requests.length, 7);
    }
});


test('openElevationImage, the tags', async () => {
    // A file's directory and its tags' values may be anywhere in it - they're fetched in chunks
    const file = testTiff({'directoryLast': true});
    const fetchFn = testFetch({[url]: file});
    const image = await openElevationImage(fetchFn, url, 64);
    assert.equal(image.georeference.north, 4427000);
    assert.deepEqual([...await image.read([14, 14, 18, 18])], windowElevations([14, 14, 18, 18]));
    const directoryOffset = new DataView(file.buffer).getUint32(4, true);
    assert.deepEqual(fetchFn.requests.slice(0, 3), [
        ['model.tif', 'bytes=0-63'],
        ['model.tif', `bytes=${directoryOffset}-${directoryOffset + 63}`],
        ['model.tif', `bytes=${directoryOffset + 2}-${directoryOffset + 2 + 16 * 12 - 1}`]
    ]);

    // An image has one sample and no predictor, if it doesn't say - and it may have no no-data elevation. A tile that
    // the file doesn't have is a tile of no elevations. The image's other tags aren't read.
    const plainFile = testTiff({
        'predictor': 1, 'noData': null, 'sparse': [1],
        'tags': {'277': null, '317': null, '254': [1, [0]], '33922': [12, [2, 4, 0, 476002, 4426996, 0]]}
    });
    const plain = await openElevationImage(testFetch({[url]: plainFile}), url);
    assert.deepEqual(plain.georeference, {
        'zone': 13, 'east': 476000, 'north': 4427000, 'resolution': 1, 'width': 40, 'height': 24, 'noData': null
    });
    assert.deepEqual([...await plain.read([14, 0, 18, 2])], [114, 115, 0, 0, 114.25, 115.25, 0, 0]);
    const sparse = await openElevationImage(testFetch({[url]: testTiff({'sparse': [1]})}), url);
    assert.deepEqual([...await sparse.read([14, 0, 18, 1])], [114, 115, -999999, -999999]);

    // The UTM zones' coordinate systems
    for (const [code, zone] of [[26913, 13], [6339, 10], [32618, 18]]) {
        assert.equal((await openElevationImage(testFetch({[url]: testTiff({code})}), url)).georeference.zone, zone);
    }
});


test('openElevationImage, errors', async () => {
    const open = (file, chunkLength) => openElevationImage(testFetch({[url]: file}), url, chunkLength);

    // A file that isn't fetched - or isn't fetched by its ranges
    await assert.rejects(openElevationImage(testFetch({}), url), {'message': `Could not fetch "${url}" (status 404)`});
    const whole = testFetch({[url]: testTiff()});
    await assert.rejects(
        openElevationImage((fileUrl) => whole(fileUrl), url), {'message': `Could not fetch "${url}" (status 200)`}
    );

    // A file that isn't a TIFF file - a big-endian file, and a BigTIFF file
    const notTiff = {'message': `The elevation model "${url}" isn't a TIFF file (a little-endian file, that isn't a BigTIFF file)`};
    const bigEndian = testTiff();
    bigEndian.set([0x4d, 0x4d]);
    await assert.rejects(open(bigEndian), notTiff);
    const bigTiff = testTiff();
    bigTiff[2] = 43;
    await assert.rejects(open(bigTiff), notTiff);

    // A file that isn't whole - its tags' values, or its tiles
    const notWhole = {'message': `The elevation model "${url}" isn't a whole file`};
    const file = testTiff({'directoryLast': true});
    await assert.rejects(open(file.subarray(0, file.length - 100), 64), notWhole);
    const tilesFile = testTiff();
    const cut = await open(tilesFile.subarray(0, tilesFile.length - 10));
    await assert.rejects(cut.read([0, 0, 40, 24]), notWhole);

    // An image that isn't of the elevation models' form - it's compressed another way, its samples aren't 32-bit
    // floating point numbers (or aren't numbers of a type that's read), it has another predictor, or it isn't tiled
    const notForm = {
        'message': `The elevation model "${url}" isn't of the form that's read - 32-bit floating point elevations, in ` +
            'LZW-compressed tiles'
    };
    for (const tags of [
        {'259': [3, [8]]}, {'258': [3, [16]]}, {'258': [1, [32]]}, {'339': [3, [1]]}, {'277': [3, [3]]}, {'317': [3, [4]]},
        {'317': [3, [0]]}, {'256': null}, {'257': null}, {'322': null}, {'323': null}, {'324': null}, {'325': null}
    ]) {
        await assert.rejects(open(testTiff({tags})), notForm, JSON.stringify(tags));
    }

    // An image without a georeference, one whose pixels aren't square, and one that isn't in a UTM zone
    for (const tag of ['33550', '33922', '34735']) {
        await assert.rejects(open(testTiff({'tags': {[tag]: null}})), {'message': `The elevation model "${url}" has no georeference`});
    }
    for (const [scale, text] of [[[1, 2, 0], '1 x 2'], [[0, 0, 0], '0 x 0']]) {
        await assert.rejects(
            open(testTiff({'tags': {'33550': [12, scale]}})),
            {'message': `The elevation model's pixels are ${text} - they aren't square, north up`}
        );
    }
    await assert.rejects(open(testTiff({'code': 4326})), {'message': 'The elevation model\'s coordinate system (4326) isn\'t a UTM zone'});
    await assert.rejects(
        open(testTiff({'tags': {'34735': [3, [1, 1, 0, 1, 1024, 0, 1, 1]]}})),
        {'message': 'The elevation model\'s coordinate system (0) isn\'t a UTM zone'}
    );

    // A tile that's damaged
    const damagedFile = testTiff();
    damagedFile.fill(255, damagedFile.length - 40);
    const damaged = await open(damagedFile);
    await assert.rejects(damaged.read([0, 0, 40, 24]), {'message': `The elevation model "${url}" has a damaged tile`});
});


test('openElevationImage, elevations that vary', async () => {
    // A tile of elevations that vary a lot fills the LZW table, and it's cleared - with each predictor
    const elevationFn = noisyElevation();
    for (const predictor of [1, 2, 3]) {
        const file = testTiff({'width': 100, 'height': 70, 'tileWidth': 64, 'tileHeight': 64, predictor, 'elevation': elevationFn});
        const image = await openElevationImage(testFetch({[url]: file}), url);
        assert.deepEqual([...await image.read([0, 0, 100, 70])], windowElevations([0, 0, 100, 70], elevationFn));
    }
});


test('lzwDecode', () => {
    // The TIFF specification's example
    const bytes = Uint8Array.from([7, 7, 7, 8, 8, 7, 7, 6, 6]);
    const codes = [256, 7, 258, 8, 8, 258, 6, 6, 257];
    assert.deepEqual(lzwCodes(bytes), codes);
    const packed = lzwPack(codes);
    assert.deepEqual([...packed], [128, 1, 224, 64, 128, 68, 8, 12, 6, 128, 128]);
    const output = new Uint8Array(9);
    assert.equal(lzwDecode(packed, output), 9);
    assert.deepEqual(output, bytes);

    // Bytes that fill the table - its codes are 9 to 12 bits, and it's cleared
    let seed = 7;
    const noisy = Uint8Array.from({'length': 20000}, () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed >>> 20;
    });
    const noisyCodes = lzwCodes(noisy);
    assert.equal(noisyCodes.filter((code) => code === 256).length, 6);
    assert.ok(Math.max(...noisyCodes) > 2047);
    const noisyOutput = new Uint8Array(noisy.length);
    assert.equal(lzwDecode(lzwPack(noisyCodes), noisyOutput), noisy.length);
    assert.deepEqual(noisyOutput, noisy);

    // Bytes that repeat - a code's string is the string that the table gets next
    const repeated = new Uint8Array(1000).fill(5);
    const repeatedOutput = new Uint8Array(1000);
    assert.equal(lzwDecode(lzwPack(lzwCodes(repeated)), repeatedOutput), 1000);
    assert.deepEqual(repeatedOutput, repeated);

    // The output is all that's decompressed
    const part = new Uint8Array(4);
    assert.equal(lzwDecode(packed, part), 4);
    assert.deepEqual([...part], [7, 7, 7, 8]);

    // Input that isn't all of the output's - it ends, or it has the end code
    assert.equal(lzwDecode(packed.subarray(0, 5), new Uint8Array(9)), 4);
    assert.equal(lzwDecode(packed, new Uint8Array(20)), 9);
    assert.equal(lzwDecode(new Uint8Array(0), new Uint8Array(1)), 0);

    // Damaged input - a cleared table's first code isn't a byte, a code that isn't the table's, a string that's more
    // than the output, and a table that isn't cleared when it's full
    assert.equal(lzwDecode(lzwPack([256, 258]), new Uint8Array(9)), 0);
    assert.equal(lzwDecode(lzwPack([258]), new Uint8Array(9)), 0);
    assert.equal(lzwDecode(lzwPack([256, 7, 300]), new Uint8Array(9)), 1);
    assert.equal(lzwDecode(lzwPack([256, 7, 258, 259]), new Uint8Array(4)), 3);
    const full = [256, ...Array.from({'length': 4000}, (unused, ix) => ix % 256)];
    assert.equal(lzwDecode(lzwPack(full), new Uint8Array(4000)), 3839);
});
