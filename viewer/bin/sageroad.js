#!/usr/bin/env node
// sageroad.js - the SageRoad command line (see lib/cli.js)
//
// usage: node bin/sageroad.js evaluate <plan.json> [--detail]
//        node bin/sageroad.js doc

import {cliMain} from '../lib/cli.js';
import process from 'node:process';
import {readFileSync} from 'node:fs';


process.exitCode = cliMain(process.argv.slice(2), {
    'readFile': (path) => readFileSync(path, 'utf-8'),
    'write': (text) => process.stdout.write(text)
});
