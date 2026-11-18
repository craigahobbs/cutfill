# Roadie

Roadie engineers low-volume roads on USGS lidar terrain and views the resulting road plan models in
a printable report with 3D views. See [README.md](README.md) for the user-facing overview.

The project is three subprojects, and the top-level makefile delegates to them:

- **The viewer** (`viewer/`, JavaScript, [javascript-build](https://github.com/craigahobbs/javascript-build#readme)) -
  the web application (report, plan and profile views, 3D views, and 3D explorer), the road plan model (its Schema
  Markdown schema, validation, earthwork, and cost analysis), and the command line behind `make evaluate` and
  `make doc`. See [viewer/CLAUDE.md](viewer/CLAUDE.md).
- **The planning tools** (`plan/`, JavaScript, [javascript-build](https://github.com/craigahobbs/javascript-build#readme)) -
  `plan/bin/plan.js` (`plan/lib/`) and the planning instructions, [plan/PLAN.md](plan/PLAN.md). A road is planned
  from a road site model (a JSON file - the road's start and end points, as latitudes and longitudes, and its
  planning notes): the tools build the site from the USGS 3D Elevation Program's 1 meter lidar terrain, and engineer
  its road options. **Planning a road** (`make plan`, `make update`) follows PLAN.md - when asked to plan or update
  a road, follow PLAN.md exactly. The planning session runs in `plan/`. See [plan/README.md](plan/README.md).

- **The application** (`app/`, Python, [python-build](https://github.com/craigahobbs/python-build#readme)) - the
  `roadie` package: its command line (`roadie`, `make run`) serves the front end - the viewer's application and the
  planning tools, which `make -C app static` stages in the package - with a
  [chisel](https://github.com/craigahobbs/chisel#readme) back end (`app/src/roadie/app.py`) that's only the front
  end's statics, for now. The front end does the work in the browser: its home page opens a plan (file dialog) or
  makes a new one (a config form made from the model's types - `viewer/lib/form.js`), shows the loaded plan - its
  config, and its road options - runs it with `plan/lib/browser/io.js` (`planRoad` - the `auto` command, with a
  browser's input and output functions), and saves it to a file. A plan is its config (a road site model) and, once
  it's run, its road options (a road plan model with the config as its `site` member) - a plan without road options
  is its config's file. The tools' modules stay importable in a browser: a Node module they import needs a stand-in in
  `plan/lib/browser/` and the page's import map (`viewer/index.html`). See [app/README.md](app/README.md).

`example/` is the example - a road site model (`site.json`) and the plan a planning session made from it
(`example.json`, and its USGS topographic map image). `index.html` renders this project's README on its web site.

## Commands

```sh
make commit                       # the pre-commit gate: the subprojects' tests and lint (at 100% coverage)
make test [TEST=name]             # the viewer's unit tests (TEST runs one) and the planning tools' unit tests
make lint                         # ESLint (the viewer and the planning tools)
make plan FILE=<site.json> OUTPUT=<plan.json>   # plan a road (a Claude Code session)
make auto FILE=<site.json> OUTPUT=<plan.json> [OLLAMA_MODEL=<model>]   # plan a road by procedure - the tools, and a model's answers
make evaluate FILE=<plan.json> [DETAIL=1]   # a plan's analysis and cost from the command line
make doc                          # the road plan model documentation
make run                          # run the application, in the browser - open, make, run, update, view, and save plans
make site                         # stage the web site (build/gh-pages/): README, example, and viewer/
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
  (`node plan/bin/plan.js site <site.json> <plan.json>`, then `route` and `plot`).
- The planning tools, not the planning session's model, do the plan's engineering and write the plan file
  (`options` engineers the standard options, `route` follows existing roads, `draws` finds the terrain's draws,
  `draft` writes the descriptions' facts, and `feature`, `keep`, and `describe` edit the plan) - so that sessions on
  different models get the same roads, with fewer tokens. When a session writes code for something every plan needs,
  make it a tool, and keep the tools' reports short (they're a session's context). Keep PLAN.md and the session's
  allowed commands (`plan/Makefile`) in step with the tools.
- `auto` (`plan/lib/auto.js`) plans a road by procedure: its code runs the plan's steps, and a model (Ollama's -
  `plan/lib/ollama.js`) is asked only small questions with checked JSON answers - it doesn't run the plan. A model's
  question is asked without thinking, with a limited answer. Keep `auto`'s steps and PLAN.md's in step.
- PLAN.md's steps are **actions** for the planning session's model - each says what to look at, what to decide (with
  a default), and the command to run - so that a smaller model can follow them. A step that needs no judgment is a
  tool's, not an action.
- The road site model (a plan config) is defined and validated with Schema Markdown, with the road plan model
  (`viewer/lib/model.js`) - a road plan keeps the road site model it was made from (its `site` member), so it can be
  updated. A plan made by the application keeps its map image, too (a data URL), so it's one file.
- Keep the README's viewer section and key table in sync with the viewer's controls.
- A road site model and a road plan model are each a JSON file of any name - there's no file naming convention
  (no `.site.json`), so the commands that plan a road name both: `FILE` is the road site model, and `OUTPUT` is the
  road plan model to write.
- `FILE` and `OUTPUT` paths are relative to the directory `make` runs in - the top-level makefile makes them absolute
  before delegating.
- The application's front end (`app/src/roadie/static/`) is generated (`make -C app static`) and committed, so the
  package installs from the repository without Node.js - commit it with the viewer and planning tool changes that
  regenerate it (`make commit` does), and don't edit it by hand. The front end loads nothing from the internet but
  the USGS's services (an app test checks).
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
  compare their written plans and images against a baseline, then time the change against the baseline in the same
  session.
