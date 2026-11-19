// tiffHelpers.js - the tests' elevation model image files - a GeoTIFF file of the USGS's elevation models' form, and
// a fetch function of files' byte ranges


// Get the LZW codes of bytes, as a TIFF file's writer does - the table is cleared first, and when it has 4094 codes
export function lzwCodes(bytes) {
    const codes = [256];
    let table = new Map();
    let codeNext = 258;
    let [prefix] = bytes;
    for (const byte of bytes.subarray(1)) {
        const key = prefix * 256 + byte;
        if (table.has(key)) {
            prefix = table.get(key);
        } else {
            codes.push(prefix);
            table.set(key, codeNext);
            codeNext += 1;
            if (codeNext === 4094) {
                codes.push(256);
                table = new Map();
                codeNext = 258;
            }
            prefix = byte;
        }
    }
    codes.push(prefix, 257);
    return codes;
}


// Pack LZW codes as a TIFF file's bytes - the codes are 9 to 12 bits, their most significant bits first. A code's
// bits are those that a reader reads it with: a reader's table gets a string with each code after a cleared table's
// first, and its codes are a bit longer when its table's next code is a bit's last.
export function lzwPack(codes) {
    const bytes = [];
    let codeNext = 258;
    let codeBits = 9;
    let isFirst = true;
    let bits = 0;
    let bitCount = 0;
    for (const code of codes) {
        bits = (bits << codeBits) | code;
        bitCount += codeBits;
        while (bitCount >= 8) {
            bitCount -= 8;
            bytes.push(bits >>> bitCount);
            bits &= (1 << bitCount) - 1;
        }
        if (code === 256) {
            codeNext = 258;
            codeBits = 9;
            isFirst = true;
        } else if (isFirst) {
            isFirst = false;
        } else {
            codeNext += 1;
            if (codeNext === (1 << codeBits) - 1 && codeBits < 12) {
                codeBits += 1;
            }
        }
    }
    if (bitCount > 0) {
        bytes.push(bits << (8 - bitCount));
    }
    return Uint8Array.from(bytes);
}


// Create an elevation model image file's bytes - a little-endian TIFF file of 32-bit floating point elevations, in
// LZW-compressed tiles. "elevation" is a function of a pixel's column and row, "code" is the projected coordinate
// system's EPSG code, and "noData" is the no-data elevation's text (or null). "tags" are other tags, and the tags that
// replace the file's - a tag number's [type, values], or null for a tag that the file doesn't have. If "directoryLast"
// is true, the image's directory and its tags' values are after the tiles. "tileGap" is the number of bytes between
// the tiles, "tilesReversed" is true if the file's tiles are last to first, and "sparse" is the indexes of the tiles
// that the file doesn't have.
export function testTiff({
    width = 40, height = 24, tileWidth = 16, tileHeight = 16, predictor = 3, elevation = (col, row) => 100 + col + 0.25 * row,
    east = 476000, north = 4427000, resolution = 1, code = 26913, noData = '-999999', tags = {}, directoryLast = false, tileGap = 0,
    tilesReversed = false, sparse = []
} = {}) {
    // The tiles' bytes
    const tilesAcross = Math.ceil(width / tileWidth);
    const tilesDown = Math.ceil(height / tileHeight);
    const rowBytes = tileWidth * 4;
    const tiles = [];
    for (let ixTile = 0; ixTile < tilesAcross * tilesDown; ixTile++) {
        const tileX = (ixTile % tilesAcross) * tileWidth;
        const tileY = Math.floor(ixTile / tilesAcross) * tileHeight;
        const values = new Float32Array(tileWidth * tileHeight);
        for (let ix = 0; ix < values.length; ix++) {
            const col = tileX + (ix % tileWidth);
            const row = tileY + Math.floor(ix / tileWidth);
            values[ix] = col < width && row < height ? elevation(col, row) : 0;
        }
        const bytes = new Uint8Array(values.buffer);
        if (predictor === 2) {
            const samples = new Uint32Array(values.buffer);
            for (let ix = samples.length - 1; ix >= 0; ix--) {
                if (ix % tileWidth !== 0) {
                    samples[ix] -= samples[ix - 1];
                }
            }
        } else if (predictor === 3) {
            for (let rowStart = 0; rowStart < bytes.length; rowStart += rowBytes) {
                const row = bytes.slice(rowStart, rowStart + rowBytes);
                for (let col = 0; col < tileWidth; col++) {
                    for (let ixByte = 0; ixByte < 4; ixByte++) {
                        bytes[rowStart + ixByte * tileWidth + col] = row[col * 4 + 3 - ixByte];
                    }
                }
                for (let ix = rowStart + rowBytes - 1; ix > rowStart; ix--) {
                    bytes[ix] -= bytes[ix - 1];
                }
            }
        }
        tiles.push(sparse.includes(ixTile) ? new Uint8Array(0) : lzwPack(lzwCodes(bytes)));
    }

    // The image's tags - a tag's [type, values]. The types are ASCII (2), SHORT (3), LONG (4), and DOUBLE (12).
    const ascii = (text) => [2, [...`${text}\0`].map((character) => character.charCodeAt(0))];
    const imageTags = {
        '256': [3, [width]],
        '257': [3, [height]],
        '258': [3, [32]],
        '259': [3, [5]],
        '277': [3, [1]],
        '305': ascii('Cutfill tests'),
        '317': [3, [predictor]],
        '322': [3, [tileWidth]],
        '323': [3, [tileHeight]],
        '324': [4, tiles.map(() => 0)],
        '325': [4, tiles.map((tile) => tile.length)],
        '339': [3, [3]],
        '33550': [12, [resolution, resolution, 0]],
        '33922': [12, [0, 0, 0, east, north, 0]],
        '34735': [3, [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, code]],
        ...(noData !== null ? {'42113': ascii(noData)} : {}),
        ...tags
    };
    const entries = Object.entries(imageTags).filter(([, entry]) => entry !== null).map(([tag, [type, values]]) => (
        {'tag': Number(tag), type, values, 'size': {'1': 1, '2': 1, '3': 2, '4': 4, '12': 8}[type] * values.length}
    )).sort((entry1, entry2) => entry1.tag - entry2.tag);

    // The file's parts - its header, its directory, the tags' values that aren't the directory's, and its tiles
    const directoryBytes = 2 + entries.length * 12 + 4;
    const valuesBytes = entries.reduce((total, {size}) => total + (size > 4 ? size : 0), 0);
    const tilesBytes = tiles.reduce((total, tile) => total + tile.length + tileGap, 0);
    const directoryOffset = directoryLast ? 8 + tilesBytes : 8;
    const file = new Uint8Array(8 + directoryBytes + valuesBytes + tilesBytes);
    const view = new DataView(file.buffer);
    view.setUint16(0, 0x4949, true);
    view.setUint16(2, 42, true);
    view.setUint32(4, directoryOffset, true);

    // The tiles
    const tileOffsets = [];
    let tileOffset = directoryLast ? 8 : 8 + directoryBytes + valuesBytes;
    for (const ixTile of (tilesReversed ? tiles.map((tile, ix) => tiles.length - 1 - ix) : tiles.keys())) {
        tileOffsets[ixTile] = tileOffset;
        file.set(tiles[ixTile], tileOffset);
        tileOffset += tiles[ixTile].length + tileGap;
    }
    entries.find(({tag, values}) => tag === 324 && values.length === tiles.length)?.values.splice(0, tiles.length, ...tileOffsets);

    // The directory, and its tags' values
    const setFns = {'1': 'setUint8', '2': 'setUint8', '3': 'setUint16', '4': 'setUint32', '12': 'setFloat64'};
    view.setUint16(directoryOffset, entries.length, true);
    let valuesOffset = directoryOffset + directoryBytes;
    for (const [ixEntry, {tag, type, values, size}] of entries.entries()) {
        const entryOffset = directoryOffset + 2 + ixEntry * 12;
        view.setUint16(entryOffset, tag, true);
        view.setUint16(entryOffset + 2, type, true);
        view.setUint32(entryOffset + 4, values.length, true);
        const valueOffset = size > 4 ? valuesOffset : entryOffset + 8;
        if (size > 4) {
            view.setUint32(entryOffset + 8, valuesOffset, true);
            valuesOffset += size;
        }
        for (const [ixValue, value] of values.entries()) {
            view[setFns[type]](valueOffset + ixValue * (size / values.length), value, true);
        }
    }
    return file;
}


// Create a fetch function of files' byte ranges - "files" is an object of the files' bytes, by URL. The function
// records the "requests" - each one's URL's file name and its range. A file that isn't one of the files isn't found,
// and a request without a range is the whole file.
export function testFetch(files) {
    const fetchFn = (url, options = {}) => {
        const range = options.headers?.Range ?? null;
        fetchFn.requests.push([url.slice(url.lastIndexOf('/') + 1), range]);
        if (!(url in files)) {
            return Promise.resolve({'ok': false, 'status': 404});
        }
        const [start, last] = range !== null ? range.slice('bytes='.length).split('-').map(Number) : [0, files[url].length - 1];
        return Promise.resolve({
            'ok': true,
            'status': range !== null ? 206 : 200,
            'arrayBuffer': () => Promise.resolve(files[url].slice(start, last + 1).buffer)
        });
    };
    fetchFn.requests = [];
    return fetchFn;
}
