#!/usr/bin/env node
// plan.js - the Roadie planning tools' command line (see lib/cli.js) - its "-h" argument prints its usage

import {fetchBytes, fetchJson} from '../lib/usgs.js';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {cliMain} from '../lib/cli.js';
import {dirname} from 'node:path';
import {openElevationImage} from '../lib/elevationImage.js';
import process from 'node:process';
import {setTimeout as sleep} from 'node:timers/promises';


// Write a file, creating its directory
function writeFile(path, data) {
    mkdirSync(dirname(path), {'recursive': true});
    writeFileSync(path, data);
}


// The command line's input and output functions - it doesn't ask a model (the Roadie application does)
process.exitCode = await cliMain(process.argv.slice(2), {
    'readFile': (path) => readFileSync(path, 'utf-8'),
    'readBytes': (path) => readFileSync(path),
    writeFile,
    'writeBytes': writeFile,
    'write': (text) => process.stdout.write(text),
    'getJson': (url) => fetchJson(fetch, sleep, url),
    'getBytes': (url) => fetchBytes(fetch, sleep, url),
    'ask': () => Promise.reject(new Error('The command line doesn\'t ask a model - run the plan in the Roadie application')),
    sleep,
    'openImage': (url) => openElevationImage(fetch, url)
});
