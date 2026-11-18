// buffer.js - a web browser's "node:buffer" - the planning tools make an image's base64 text with its Buffer. The
// Roadie application's page maps "node:buffer" to this module (its import map).


// The bytes of a part of the base64 text - a multiple of three, so the parts' texts join
const partBytes = 3 * 8192;


// A buffer of bytes - only its base64 text
export const Buffer = {
    'from': (bytes) => ({
        'toString': () => {
            const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            const parts = [];
            for (let offset = 0; offset < array.length; offset += partBytes) {
                parts.push(globalThis.btoa(String.fromCharCode(...array.subarray(offset, offset + partBytes))));
            }
            return parts.join('');
        }
    })
};
