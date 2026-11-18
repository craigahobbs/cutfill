#!/usr/bin/env node
// plan.js - the Roadie planning tools' command line (see lib/cli.js) - its "-h" argument prints its usage

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fetchBytes, fetchJson} from '../lib/usgs.js';
import {ollamaAsk, ollamaHost} from '../lib/ollama.js';
import {Resvg} from '@resvg/resvg-js';
import {cliMain} from '../lib/cli.js';
import {dirname} from 'node:path';
import {openElevationImage} from '../lib/elevationImage.js';
import {plotFonts} from '../lib/plot.js';
import process from 'node:process';
import {setTimeout as sleep} from 'node:timers/promises';


// Write a file, creating its directory
function writeFile(path, data) {
    mkdirSync(dirname(path), {'recursive': true});
    writeFileSync(path, data);
}


// Render a plot's SVG markup as a PNG image file's bytes
function renderPng(svg) {
    return new Resvg(svg, {'background': 'white', 'font': plotFonts(process.platform, process.env, existsSync)}).render().asPng();
}


// The command line's input and output functions
process.exitCode = await cliMain(process.argv.slice(2), {
    'readFile': (path) => readFileSync(path, 'utf-8'),
    'readBytes': (path) => readFileSync(path),
    writeFile,
    'writeBytes': writeFile,
    'write': (text) => process.stdout.write(text),
    'getJson': (url) => fetchJson(fetch, sleep, url),
    'getBytes': (url) => fetchBytes(fetch, sleep, url),
    'ask': (question) => ollamaAsk(fetch, ollamaHost(process.env), question),
    sleep,
    renderPng,
    'openImage': (url) => openElevationImage(fetch, url)
});
