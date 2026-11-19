// zlib.js - a web browser's "node:zlib" - the planning tools make a plot's terrain image (a PNG file) with its crc32
// and deflateSync. The SageRoad application's page maps "node:zlib" to this module (its import map).


// The CRC-32 checksum's table
const crcTable = new Uint32Array(256);
for (let byte = 0; byte < 256; byte++) {
    let crc = byte;
    for (let bit = 0; bit < 8; bit++) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    crcTable[byte] = crc;
}


// Compute the CRC-32 checksum of bytes
export function crc32(bytes) {
    let crc = 0xffffffff;
    for (let ix = 0; ix < bytes.length; ix++) {
        crc = crcTable[(crc ^ bytes[ix]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}


// The most bytes of a stored block
const blockBytes = 65535;


// Create a zlib stream of bytes - they're stored, not compressed: a plot's terrain image is small, and its file isn't
// kept
export function deflateSync(bytes) {
    const blockCount = Math.max(1, Math.ceil(bytes.length / blockBytes));
    const stream = new Uint8Array(2 + bytes.length + 5 * blockCount + 4);
    const view = new DataView(stream.buffer);

    // The stream's header - deflate, with a 32K window
    stream[0] = 0x78;
    stream[1] = 0x01;

    // The stored blocks - each has its length, and the last is marked
    let offset = 2;
    for (let ixBlock = 0; ixBlock < blockCount; ixBlock++) {
        const block = bytes.subarray(ixBlock * blockBytes, (ixBlock + 1) * blockBytes);
        stream[offset] = ixBlock === blockCount - 1 ? 1 : 0;
        view.setUint16(offset + 1, block.length, true);
        view.setUint16(offset + 3, ~block.length & 0xffff, true);
        stream.set(block, offset + 5);
        offset += 5 + block.length;
    }

    // The bytes' Adler-32 checksum
    let sum1 = 1;
    let sum2 = 0;
    for (let ix = 0; ix < bytes.length; ix++) {
        sum1 = (sum1 + bytes[ix]) % 65521;
        sum2 = (sum2 + sum1) % 65521;
    }
    view.setUint32(offset, ((sum2 << 16) | sum1) >>> 0);
    return stream;
}
