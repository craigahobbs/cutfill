// elevationImage.js - a USGS elevation model image - a GeoTIFF file of elevations, in a UTM zone
//
// The USGS's 1 meter elevation models are of one form: a little-endian TIFF file (not a BigTIFF file) of one sample of
// 32-bit floating point elevations, in tiles that are LZW-compressed - with no predictor, the horizontal predictor,
// or the floating point predictor. This is that form's reader, and no other's. A model's file is remote, and large -
// only the parts of it that are read are fetched.


// The TIFF tags that are read - an image's other tags aren't
const tagImageWidth = 256;
const tagImageLength = 257;
const tagBitsPerSample = 258;
const tagCompression = 259;
const tagSamplesPerPixel = 277;
const tagPredictor = 317;
const tagTileWidth = 322;
const tagTileLength = 323;
const tagTileOffsets = 324;
const tagTileByteCounts = 325;
const tagSampleFormat = 339;
const tagModelPixelScale = 33550;
const tagModelTiepoint = 33922;
const tagGeoKeyDirectory = 34735;
const tagNoData = 42113;
const imageTags = new Set([
    tagImageWidth, tagImageLength, tagBitsPerSample, tagCompression, tagSamplesPerPixel, tagPredictor, tagTileWidth, tagTileLength,
    tagTileOffsets, tagTileByteCounts, tagSampleFormat, tagModelPixelScale, tagModelTiepoint, tagGeoKeyDirectory, tagNoData
]);


// The TIFF tag value types that are read - each type's value's bytes, and its data view function. An ASCII
// value's are its characters' codes.
const tagTypes = {
    // ASCII
    '2': [1, 'getUint8'],
    // SHORT
    '3': [2, 'getUint16'],
    // LONG
    '4': [4, 'getUint32'],
    // DOUBLE
    '12': [8, 'getFloat64']
};


// The projected coordinate system's GeoTIFF key
const keyProjectedType = 3072;


// The bytes of a file that are fetched at once - a file's header, and the tags' values that aren't in it
const chunkBytes = 65536;


// The most bytes between two tiles of a file that are fetched with one request
const tileGap = 4096;


// Open a remote elevation model image - "fetchFn" is the fetch function, and "url" is the image file's URL. Returns the
// elevation image object - its "georeference" (its UTM "zone", its northwest corner's UTM "east" and "north", its pixel
// "resolution" in meters, its "width" and "height" in pixels, and its "noData" elevation), and its "read" function,
// which reads a window of its elevations ([x1, y1, x2, y2] - the pixel columns x1 up to x2 and rows y1 up to y2) as a
// Float32Array of the window's rows. "chunkLength" is the number of the file's bytes that are fetched at once.
export async function openElevationImage(fetchFn, url, chunkLength = chunkBytes) {
    // Fetch a range of the file's bytes
    const fetchRange = async (start, end) => {
        const response = await fetchFn(url, {'headers': {'Range': `bytes=${start}-${end - 1}`}});
        if (response.status !== 206) {
            throw new Error(`Could not fetch "${url}" (status ${response.status})`);
        }
        return new Uint8Array(await response.arrayBuffer());
    };

    // Get a data view of the file's header's and tags' bytes - they're fetched in chunks, and the chunks are kept
    const chunks = [];
    const fileView = async (offset, length) => {
        let chunk = chunks.find(({start, bytes}) => start <= offset && offset + length <= start + bytes.length) ?? null;
        if (chunk === null) {
            chunk = {'start': offset, 'bytes': await fetchRange(offset, offset + Math.max(length, chunkLength))};
            if (chunk.bytes.length < length) {
                throw new Error(`The elevation model "${url}" isn't a whole file`);
            }
            chunks.push(chunk);
        }
        return new DataView(chunk.bytes.buffer, chunk.bytes.byteOffset + offset - chunk.start, length);
    };

    // The file's header, and its first image's tags - each tag's values
    const header = await fileView(0, 8);
    if (header.getUint16(0, true) !== 0x4949 || header.getUint16(2, true) !== 42) {
        throw new Error(`The elevation model "${url}" isn't a TIFF file (a little-endian file, that isn't a BigTIFF file)`);
    }
    const directoryOffset = header.getUint32(4, true);
    const entryCount = (await fileView(directoryOffset, 2)).getUint16(0, true);
    const entries = await fileView(directoryOffset + 2, entryCount * 12);
    const tags = {};
    for (let ixEntry = 0; ixEntry < entryCount; ixEntry++) {
        const entryOffset = ixEntry * 12;
        const tag = entries.getUint16(entryOffset, true);
        const [valueBytes, viewFn] = tagTypes[entries.getUint16(entryOffset + 2, true)] ?? [0, null];
        const count = entries.getUint32(entryOffset + 4, true);
        if (imageTags.has(tag) && viewFn !== null) {
            // A tag's values are the entry's, if they fit - or they're elsewhere in the file
            const view = valueBytes * count <= 4 ? new DataView(entries.buffer, entries.byteOffset + entryOffset + 8, 4) :
                await fileView(entries.getUint32(entryOffset + 8, true), valueBytes * count);
            tags[tag] = Array.from({'length': count}, (unused, ix) => view[viewFn](ix * valueBytes, true));
        }
    }

    // The image is of the elevation models' form?
    const tagValue = (tag, defaultValue = null) => (tags[tag] ?? [defaultValue])[0];
    const width = tagValue(tagImageWidth);
    const height = tagValue(tagImageLength);
    const tileWidth = tagValue(tagTileWidth);
    const tileHeight = tagValue(tagTileLength);
    const predictor = tagValue(tagPredictor, 1);
    const {[tagTileOffsets]: tileOffsets = null, [tagTileByteCounts]: tileByteCounts = null} = tags;
    const {[tagModelPixelScale]: scale = null, [tagModelTiepoint]: tiepoint = null} = tags;
    const {[tagGeoKeyDirectory]: geoKeys = null} = tags;
    const isElevations = width !== null && height !== null && tagValue(tagSamplesPerPixel, 1) === 1 &&
        tagValue(tagBitsPerSample) === 32 && tagValue(tagSampleFormat) === 3 && tagValue(tagCompression) === 5 &&
        predictor >= 1 && predictor <= 3 && tileWidth !== null && tileHeight !== null && tileOffsets !== null &&
        tileByteCounts !== null;
    if (!isElevations) {
        throw new Error(
            `The elevation model "${url}" isn't of the form that's read - 32-bit floating point elevations, in LZW-compressed tiles`
        );
    }
    if (scale === null || tiepoint === null || geoKeys === null) {
        throw new Error(`The elevation model "${url}" has no georeference`);
    }

    // The georeference - the pixels are square, north up
    const [resolution, resolutionY] = scale;
    if (!(resolution > 0) || Math.abs(resolution - resolutionY) > 1e-9 * resolution) {
        throw new Error(`The elevation model's pixels are ${resolution} x ${resolutionY} - they aren't square, north up`);
    }
    const [pixelX, pixelY,, tieEast, tieNorth] = tiepoint;
    const noDataText = String.fromCharCode(...(tags[tagNoData] ?? [])).replace(/\0+$/, '');
    const noData = noDataText !== '' ? Number(noDataText) : null;
    const georeference = {
        'zone': imageZone(geoKeys),
        'east': tieEast - pixelX * resolution,
        'north': tieNorth + pixelY * resolution,
        resolution,
        width,
        height,
        noData
    };

    // Read a window of the image's elevations, a row of its tiles at a time. The tiles of the last window that was
    // read are kept - the window below it has their lower rows.
    const tilesAcross = Math.ceil(width / tileWidth);
    let windowTiles = new Map();
    const read = async ([x1, y1, x2, y2]) => {
        const data = new Float32Array((x2 - x1) * (y2 - y1));
        const keptTiles = windowTiles;
        const readTiles = new Map();
        for (let tileRow = Math.floor(y1 / tileHeight); tileRow * tileHeight < y2; tileRow++) {
            // The row's tiles that aren't read yet are fetched - the tiles that are together in the file, together
            const rowTiles = [];
            for (let tileCol = Math.floor(x1 / tileWidth); tileCol * tileWidth < x2; tileCol++) {
                const ixTile = tileRow * tilesAcross + tileCol;
                const start = tileOffsets[ixTile];
                rowTiles.push({ixTile, tileCol, start, 'end': start + tileByteCounts[ixTile]});
            }
            const fetchTiles = rowTiles.filter(({ixTile, start, end}) => !keptTiles.has(ixTile) && end > start);
            for (let ixFirst = 0, ixEnd = 1; ixFirst < fetchTiles.length; ixFirst = ixEnd, ixEnd += 1) {
                while (ixEnd < fetchTiles.length && fetchTiles[ixEnd].start >= fetchTiles[ixEnd - 1].end &&
                    fetchTiles[ixEnd].start - fetchTiles[ixEnd - 1].end <= tileGap) {
                    ixEnd += 1;
                }
                const {start} = fetchTiles[ixFirst];
                const {end} = fetchTiles[ixEnd - 1];
                const bytes = await fetchRange(start, end);
                if (bytes.length !== end - start) {
                    throw new Error(`The elevation model "${url}" isn't a whole file`);
                }
                for (const tile of fetchTiles.slice(ixFirst, ixEnd)) {
                    tile.bytes = bytes.subarray(tile.start - start, tile.end - start);
                }
            }

            // The row's tiles' elevations - a tile that the file doesn't have is a tile of no elevations
            for (const {ixTile, tileCol, bytes = null} of rowTiles) {
                let elevations = keptTiles.get(ixTile) ?? null;
                if (elevations === null) {
                    elevations = bytes !== null ? tileElevations(bytes, tileWidth, tileHeight, predictor, url) :
                        new Float32Array(tileWidth * tileHeight).fill(noData ?? 0);
                }
                readTiles.set(ixTile, elevations);

                // The tile's part of the window
                const tileX = tileCol * tileWidth;
                const tileY = tileRow * tileHeight;
                const colFirst = Math.max(x1, tileX);
                const colEnd = Math.min(x2, tileX + tileWidth);
                for (let row = Math.max(y1, tileY), rowEnd = Math.min(y2, tileY + tileHeight); row < rowEnd; row++) {
                    const tileOffset = (row - tileY) * tileWidth - tileX;
                    data.set(elevations.subarray(tileOffset + colFirst, tileOffset + colEnd), (row - y1) * (x2 - x1) + colFirst - x1);
                }
            }
        }
        windowTiles = readTiles;
        return data;
    };
    return {georeference, read};
}


// The UTM coordinate systems' EPSG codes - [first zone's code - 1, zone count]
const utmCodes = [
    // NAD83
    [26900, 23],
    // NAD83(2011)
    [6329, 19],
    // WGS 84
    [32600, 60]
];


// Get an elevation model image's UTM zone (north) from its GeoTIFF keys' directory (four numbers a key, after the
// directory's four) - its projected coordinate system's code
function imageZone(geoKeys) {
    let code = 0;
    for (let ixKey = 4; ixKey < geoKeys.length; ixKey += 4) {
        if (geoKeys[ixKey] === keyProjectedType) {
            code = geoKeys[ixKey + 3];
        }
    }
    for (const [base, count] of utmCodes) {
        if (code > base && code <= base + count) {
            return code - base;
        }
    }
    throw new Error(`The elevation model's coordinate system (${code}) isn't a UTM zone`);
}


// Get a tile's elevations (a Float32Array of its rows) from its bytes in the file
function tileElevations(bytes, tileWidth, tileHeight, predictor, url) {
    const rowBytes = tileWidth * 4;
    const tileBytes = new Uint8Array(rowBytes * tileHeight);
    if (lzwDecode(bytes, tileBytes) !== tileBytes.length) {
        throw new Error(`The elevation model "${url}" has a damaged tile`);
    }
    const elevations = new Float32Array(tileBytes.buffer);

    // The horizontal predictor - a row's sample is its difference from the sample before it (the samples as 32-bit
    // numbers - the file's bytes are in this computer's order, as every computer's that the tools run on are)
    if (predictor === 2) {
        const samples = new Uint32Array(tileBytes.buffer);
        for (let ix = 0; ix < samples.length; ix++) {
            if (ix % tileWidth !== 0) {
                samples[ix] += samples[ix - 1];
            }
        }

    // The floating point predictor - a row's bytes are its samples' first bytes, then their second bytes, and so on
    // (their most significant bytes first), and a byte is its difference from the byte before it
    } else if (predictor === 3) {
        for (let rowStart = 0; rowStart < tileBytes.length; rowStart += rowBytes) {
            for (let ix = rowStart + 1; ix < rowStart + rowBytes; ix++) {
                tileBytes[ix] += tileBytes[ix - 1];
            }
            const row = tileBytes.slice(rowStart, rowStart + rowBytes);
            for (let col = 0; col < tileWidth; col++) {
                const sample = rowStart + col * 4;
                tileBytes[sample] = row[3 * tileWidth + col];
                tileBytes[sample + 1] = row[2 * tileWidth + col];
                tileBytes[sample + 2] = row[tileWidth + col];
                tileBytes[sample + 3] = row[col];
            }
        }
    }
    return elevations;
}


// The LZW codes - the code that clears the table, the code that ends the data, the first code of the table's
// strings of more than one byte, and the most codes
const lzwClear = 256;
const lzwEnd = 257;
const lzwFirst = 258;
const lzwCodes = 4096;


// Decompress a TIFF file's LZW-compressed bytes ("input") to the "output" bytes - returns the number of bytes that
// were decompressed: the output's length, unless the input is damaged, or isn't all of the output's. The codes are 9
// to 12 bits, their most significant bits first, and a code is one bit longer a code earlier than the table needs it
// to be. A table's string is a string before it (its "prefix") and a byte (its "suffix").
export function lzwDecode(input, output) {
    const prefixes = new Uint16Array(lzwCodes);
    const suffixes = new Uint8Array(lzwCodes);
    const lengths = new Uint16Array(lzwCodes);
    for (let code = 0; code < lzwClear; code++) {
        suffixes[code] = code;
        lengths[code] = 1;
    }
    let codeNext = lzwFirst;
    let codeBits = 9;
    let codeBefore = null;
    let bits = 0;
    let bitCount = 0;
    let ixInput = 0;
    let ixOutput = 0;
    while (ixOutput < output.length) {
        // The next code
        while (bitCount < codeBits && ixInput < input.length) {
            bits = (bits << 8) | input[ixInput];
            bitCount += 8;
            ixInput += 1;
        }
        if (bitCount < codeBits) {
            break;
        }
        bitCount -= codeBits;
        const code = bits >>> bitCount;
        bits &= (1 << bitCount) - 1;
        if (code === lzwEnd) {
            break;
        }

        // Clear the table? The code after it is a byte.
        if (code === lzwClear) {
            codeNext = lzwFirst;
            codeBits = 9;
            codeBefore = null;
        } else if (codeBefore === null) {
            if (code > lzwClear) {
                break;
            }
            output[ixOutput] = code;
            ixOutput += 1;
            codeBefore = code;
        } else {
            // The code's string - the table's, or the string of the code before it and that string's first byte (it's
            // the string that the table gets next)
            const isNext = code === codeNext;
            const length = isNext ? lengths[codeBefore] + 1 : lengths[code];
            if (code > codeNext || codeNext === lzwCodes || ixOutput + length > output.length) {
                break;
            }
            let stringCode = isNext ? codeBefore : code;
            for (let ix = ixOutput + length - (isNext ? 2 : 1); ix >= ixOutput; ix--) {
                output[ix] = suffixes[stringCode];
                stringCode = prefixes[stringCode];
            }
            if (isNext) {
                output[ixOutput + length - 1] = output[ixOutput];
            }

            // The table's next string is the string of the code before, and this string's first byte
            prefixes[codeNext] = codeBefore;
            suffixes[codeNext] = output[ixOutput];
            lengths[codeNext] = lengths[codeBefore] + 1;
            codeNext += 1;
            if (codeNext === (1 << codeBits) - 1 && codeBits < 12) {
                codeBits += 1;
            }
            ixOutput += length;
            codeBefore = code;
        }
    }
    return ixOutput;
}
