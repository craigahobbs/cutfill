# Roadie Viewer

The Roadie road plan viewer - a JavaScript web application (ES modules in `lib/`, served as is - no bundler) built with
[javascript-build](https://github.com/craigahobbs/javascript-build#readme). It also holds the road plan model and a
command line (a plan's analysis, and the model documentation). See [README.md](README.md).

## Commands

```sh
make commit                  # the pre-commit gate: test, lint, doc, and cover (100% required)
make test [TEST=name]        # unit tests (node --test)
make lint                    # ESLint (bin/, lib/, test/, tools/)
make cover                   # unit tests with 100% line, branch, and function coverage required
make app                     # stage the application (build/app/)
make run FILE=<plan.json>    # view a plan in the browser
```

## Conventions

- The road plan model is defined, validated, and documented with Schema Markdown: its schema text is in `model.js`
  (`roadieTypes`), plans are validated with the `schema-markdown` package (`validatePlan` - the application validates
  every plan it loads), and the documentation page and `bin/roadie.js doc` are generated from the type model
  (`schemaDoc.js`). Don't hand-write schema parsing, validation, or documentation.
- `bin/roadie.js` (`lib/cli.js`) is the viewer's command line - a plan's analysis and cost (`evaluate`), and the model
  documentation (`doc`). The viewer's performance work compares its output against a baseline, so keep it stable
  (`test/expected/` has its expected output for the example plan). `lib/cli.js` isn't part of the web application.
- New code needs tests (`test/*.test.js`) that assert behavior - exact output, not just coverage. The application's
  tests run in jsdom with the fakes in `test/appHelpers.js`. Coverage ignores and large HTML/SVG snapshots aren't
  used - assert on specific elements and counts, and keep `test/expected/` files small.
- A 3D drawing is an array of drawing operations (`view3DParts`, `canvas.js`) - the browser paints them on a canvas
  (the explorer and the report's 3D views), and the command line's SVG 3D views are the same operations converted to
  markup (`opsToSvg`), so there's one drawing code path. The canvas drawings' terrain point limit adapts to a time
  budget (`smoothing.js`) from the `smoothLimitsCanvas` limits; the SVG drawings use the fixed `smoothLimits`. Add
  `?debug` to the page URL to log each 3D drawing's operations, grid step, smoothing, and timing.
- Number formatting is `toFixed`'s (`fixed`/`fixedTrim`/`px` in `format.js`), and `round` is
  `Math.round(x * 10 ** d) / 10 ** d` - the drawings and the command line's output depend on them.
- `index.html` preloads every application module (a unit test checks the list) - add a `modulepreload` link with a new
  module. Its import map resolves the `schema-markdown` package, which `make app` stages next to `lib/` - and, for the
  Roadie application (`../app/`), the planning tools' Node modules and their imports of the viewer's modules. The home
  page (`homePage.js`) opens a plan or makes a new one (`EditPage` - the plan config's form), and shows the loaded
  plan (`RoadieApp.loaded` - its config, and its road options): it runs the plan with the planning tools, which it
  imports (`importPlan` - the project's web site doesn't have them), clears its road options, and saves it to a file
  or closes it. The plan config's form is made from the road site model's types (`form.js`), so don't hand-write a
  member's control. The loaded plan's map (`mapPage.js`, `#var.vMap=true`) draws its config's marks - in latitudes
  and longitudes (`geo.js`'s `planPoint` and `planLatLong`), and a mark that's edited isn't found (its `found` member
  is dropped). The report and the 3D explorer are `viewPages.js`'s. The home page links to an example plan if the
  page's `roadie` element has a `data-example` attribute (the plan's URL) - the project's web site adds it (the
  top-level makefile's `site`).
- ESLint's `id-length` rule allows the coordinate names `x`, `y`, and `z` (`ESLINT_ARGS` in the makefile) - other names
  are two characters or longer.
- Optimizations must leave the output byte-identical - compare `tools/render.js` output (the report and `--explore`)
  and `bin/roadie.js evaluate --detail` against a baseline (with the example plan and the real plans, which are kept
  outside the repository - ask where, if you don't know), then time the change against the baseline in the same
  session: in Node with `tools/render.js --time`, and in Chrome with `tools/bench.js` (serve `build/app` and a plan
  directory). Add `?debug` to the page URL for render timing in the console.
- Plans and map images are user data - never commit them here (the repository and its Pages site may be public).
