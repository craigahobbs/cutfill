import {readFileSync, readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import test from 'node:test';


test('index.html preloads every application module', () => {
    const viewerDir = fileURLToPath(new URL('..', import.meta.url));
    const html = readFileSync(`${viewerDir}index.html`, 'utf-8');
    const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((match) => match[1]);

    // The application's modules - all but the command line - and the schema-markdown modules they import
    const modules = readdirSync(`${viewerDir}lib`).filter((name) => name.endsWith('.js') && name !== 'cli.js').
        map((name) => `lib/${name}`).sort();
    const packageModules = ['parser.js', 'schema.js', 'schemaUtil.js', 'typeModel.js'].map((name) => `schema-markdown/lib/${name}`);
    assert.deepEqual(preloads, [...modules, ...packageModules]);

    // The import map resolves the schema-markdown package - and, in the Roadie application, the planning tools' Node
    // modules and their imports of the viewer's modules ("../../viewer/lib/")
    const [, importMap] = html.match(/<script type="importmap">([^<]*)<\/script>/);
    assert.deepEqual(JSON.parse(importMap), {'imports': {
        'schema-markdown/': './schema-markdown/',
        'node:buffer': './plan/lib/browser/buffer.js',
        'node:util': './plan/lib/browser/util.js',
        'node:zlib': './plan/lib/browser/zlib.js',
        './viewer/lib/': './lib/'
    }});
});
