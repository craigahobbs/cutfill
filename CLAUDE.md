# SageRoad

SageRoad engineers low-volume roads on USGS lidar terrain and views the resulting road plan models in
a printable report with 3D views. See [README.md](README.md) for the user-facing overview.

The project is three subprojects, and the top-level makefile delegates to them:

- **The viewer** (`viewer/`, JavaScript, [javascript-build](https://github.com/craigahobbs/javascript-build#readme)) -
  the web application (report, plan and profile views, 3D views, and 3D explorer), the road plan model (its Schema
  Markdown schema, validation, earthwork, and cost analysis), and a command line (`viewer/bin/sageroad.js` - a plan's
  analysis, and the model documentation). See [viewer/CLAUDE.md](viewer/CLAUDE.md).
- **The planning tools** (`plan/`, JavaScript, [javascript-build](https://github.com/craigahobbs/javascript-build#readme)) -
  `plan/lib/`. A road is planned from a road site model (a plan config - the road's start and end points, as
  latitudes and longitudes, its planning notes, and its marks): the tools build the site from the USGS 3D Elevation
  Program's 1 meter lidar terrain, and engineer its road options. The application runs them in the browser (`auto`,
  `plan/lib/auto.js`). `plan/bin/plan.js` is their command line, for development only - `site`, `options`, `route`,
  and `auto` (without a model). See [plan/README.md](plan/README.md).

- **The application** (`app/`, Python, [python-build](https://github.com/craigahobbs/python-build#readme)) - the
  `sageroad` package: its command line (`sageroad`, `make run`) serves the front end - the viewer's application and the
  planning tools, which `make -C app static` stages in the package - with a
  [chisel](https://github.com/craigahobbs/chisel#readme) back end (`app/src/sageroad/app.py`) that's only the front
  end's statics, for now. The front end does the work in the browser: its home page opens a plan (file dialog) or
  makes a new one (a config form made from the model's types - `viewer/lib/form.js`), shows the loaded plan - its
  config, and its road options - runs it with `plan/lib/browser/io.js` (`planRoad` - the run's procedure, `autoPlan`,
  with a browser's input and output functions), and saves it to a file. A plan is its config (a road site model) and, once
  it's run, its road options (a road plan model with the config as its `site` member) - a plan without road options
  is its config's file. The tools' modules stay importable in a browser: a Node module they import needs a stand-in in
  `plan/lib/browser/` and the page's import map (`viewer/index.html`). See [app/README.md](app/README.md).

`example/` is the example - a plan config (`site.json`, with its marks) and the plan the application made from it
(`example.json` - one file, with its USGS topographic map image), and the README's screenshot of its report's 3D
views. `index.html` renders this project's README on its web site.

## Commands

```sh
make commit                       # the pre-commit gate: the subprojects' tests and lint (at 100% coverage)
make test [TEST=name]             # the subprojects' unit tests (TEST runs the viewer's and planning tools' of a name)
make lint                         # ESLint (the viewer and the planning tools) and pylint (the application)
make run                          # run the application, in the browser - open, make, run, view, and save plans
make site                         # stage the web site (build/gh-pages/): README, example, and viewer/
make changelog                    # update the changelog (CHANGELOG.md) with the commits since its last
```

Run `make` in `viewer/` or `plan/` for a subproject's own targets (e.g.
`make -C viewer test TEST=name`, `make -C plan lint`).

## Conventions

- Run `make commit` before committing; it must pass - the viewer, the planning tools (`plan/`), and the application
  (`app/`) with 100% coverage and every lint clean.
- Commit directly on `main`. Commit messages: a short imperative subject, then a body of bullets
  (or a paragraph) explaining what changed and why.
- The road plan model stays defined, validated, and documented with Schema Markdown (see viewer/CLAUDE.md), and the
  viewer validates every plan it loads.
- The planning tools use the viewer's model (`plan/lib/` imports `viewer/lib/` - its schema, cost rates, topography,
  and drawing code). Their route search and profile design have their own cross sections (`plan/lib/design.js`, a
  retaining wall where a slope doesn't daylight) - keep them consistent with `viewer/lib/model.js`'s.
- The planning tools' tests never use the network - the USGS services and elevation models are faked
  (`plan/test/terrainHelpers.js`). To check the tools against the real services, plan a site in the scratchpad
  (`node plan/bin/plan.js auto <site.json> <plan.json>`, or `site`, then `options` and `route`).
- The planning tools read the USGS's elevation models themselves (`plan/lib/elevationImage.js` - a GeoTIFF file's
  header, tags, and LZW-compressed tiles, by HTTP range requests), in Node and in a browser. The reader is of the one
  form the 1 meter models have, not a general TIFF reader - a model of another form is an error that says so. Its
  tests' files are made by `plan/test/tiffHelpers.js`.
- All of SageRoad's functionality is the application's - there are no command line planning flows. Judgment that a
  procedure can do is the tools' (`auto` - the other corridor, enlarging a site that's too small, the unmapped draws a
  road crosses), what only a person knows is the plan config's (its notes and marks), and a model is asked only small
  questions (Ollama's - `plan/lib/ollama.js`) with checked JSON answers: what the notes ask for, and where their places
  are on the site's map. A model doesn't run the plan, and its question is asked without thinking, with a limited
  answer.
- A run makes its plan in memory (`plan/lib/auto.js`'s `autoPlan`): the tools' functions take a plan and change it or
  return one, and only the command line's commands (`plan/lib/cli.js` - the one module that parses arguments, which
  isn't the browser's) and the application's page read and write a plan. What the tools add to a plan is made in the
  model's order (a test checks a run's plan), so a plan's file is the same whether it's made or made again.
- A plan that's made again is made the same: `auto` doesn't change what a later run reads but the plan config's marks
  and margin (the roads its notes rule out stay the plan's roads - `--rule-out`), the places the notes name are the
  plan config's marks once they're found (with how they were found - `SiteFound`), and `site` keeps a plan's site data
  when its grid is the site's, so a run doesn't ask the USGS for it again. A run's plan config is the loaded plan's.
- The road site model (a plan config) is defined and validated with Schema Markdown, with the road plan model
  (`viewer/lib/model.js`) - a road plan keeps the road site model it was made from (its `site` member), so it can be
  run again. A plan made by the application keeps its map image, too (a data URL), so it's one file.
- Keep the README's viewer section and key table in sync with the viewer's controls.
- A road site model and a road plan model are each a JSON file of any name - there's no file naming convention
  (no `.site.json`).
- The application's front end (`app/src/sageroad/static/`) is generated (`make -C app static`) and committed, so the
  package builds from the repository without Node.js - commit it with the viewer and planning tool changes that
  regenerate it (`make commit` does), and don't edit it by hand. The front end loads nothing from the internet but
  the USGS's services (an app test checks). The package's readme (its PyPI page) is the README, by a link
  (`app/PYPI.md` - setuptools reads only the package directory's files), so the README's links are all absolute.
- Road plan files and their work directories (`*.work/`, git-ignored) usually live outside the repo - they're user
  data, so don't add them to the repo or the web site.

## Checking the viewer visually

Stage and serve the application with a plan (its directory is served as `plan/`), and screenshot it with headless
Chrome:

```sh
make -C viewer app
node viewer/tools/serve.js viewer/build/app 8931 --plan example/example.json &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
    --virtual-time-budget=15000 --screenshot=viewer/build/report.png --window-size=1100,3000 \
    "http://127.0.0.1:8931/#var.vFile='plan%2Fexample.json'"
```

Add `&var.vExplore=true` to the URL for the 3D explorer, or use `#var.vDoc=true` for the model documentation. To
render a page without a browser, `node viewer/tools/render.js <plan.json> [--explore | --doc]` writes its HTML (with
SVG 3D views).

## Performance work

- Optimizations must leave the output byte-identical - for the viewer, see viewer/CLAUDE.md; for the planning tools,
  compare their written plans (`node plan/bin/plan.js options` on copies of the example and the real plans) against
  a baseline, then time the change against the baseline in the same session.
