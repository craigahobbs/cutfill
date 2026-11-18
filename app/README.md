# Roadie Application

The Roadie application - a Python package (`roadie`) built with
[python-build](https://github.com/craigahobbs/python-build#readme). Its command line, `roadie`, serves the Roadie
front end - the [viewer](../viewer/README.md)'s application, and the planning tools - in your web browser. See the
project's [README](../README.md).

```sh
make static              # stage the front end (the viewer and the planning tools) in the package (src/roadie/static/)
make run [ARGS=...]      # run the application - "roadie [-p PORT] [-n] [-q]"
make commit              # the pre-commit gate: test, lint, and cover (100% required)
```

The project's `make run` runs it.

The back end (`src/roadie/app.py`) is a [chisel](https://github.com/craigahobbs/chisel#readme) application, served
by [waitress](https://github.com/Pylons/waitress#readme) to this computer only (`127.0.0.1`). For now, it's only the
front end's statics (and chisel's API documentation, `/doc/`) - the front end does the rest in the browser.

The front end is the package's `static` directory (it isn't in the repository) - `make static` copies the viewer's
staged application there, with the planning tools' modules (`plan/lib/`) and the GeoTIFF reader's script.

The application's home page opens a plan - with the browser's open dialog (its file handle is kept, so the plan is
saved to its file) or file input, or dropped on the page - or makes a new one (`#var.vEdit='new'`). The files stay on
the computer: they're kept in the browser's storage (IndexedDB), and the loaded plan is remembered (local storage). A
plan is its config - a road site model - and, once it's run, its road options: a road plan model, whose `site` member
is its config. A plan without road options is its config's file.

The plan config's form (`#var.vEdit='new'`, or `'loaded'` for the loaded plan's) is made from the road site model's
Schema Markdown types, so it has the model's members and their documentation, and a config is done only if the model
validates it. An optional member's default is its box's placeholder - the design criteria's (in the config's units)
and the cost rates' are the model's, and the site's margin and grid spacing are the planning tools' (`siteDefaults`).
The members the form doesn't edit - the exclusion areas - are kept as they are. A point that's copied from a map
("46.16755, -119.16811") is pasted into its latitude.

The home page shows the loaded plan - its config - and its actions: view it (its road options' report), edit its
config, run it (its steps - the planning tools' `autoSteps` - and its time are shown as it goes, and its result and
report when it's done; it's stopped with an abort signal, when its current step's work is done, and its work is thrown away; the last
model chosen is remembered), clear its road
options, save it (to its file, or another - the browser's save dialog, or a download), and close it (the user is
asked first, if it has changes that aren't saved). A plan with road options is one file: it keeps its config and its
map image (a data URL). The recent files are listed - a file is opened, or removed (but for the loaded plan's road
options' file).

The engineering isn't the back end's: a plan is run in the browser, by the planning tools' `auto` command
(`../plan/lib/browser/io.js`) - with one of Ollama's models, or none - and the run's report is shown as it's made.
The tools' files are in the browser's memory. The terrain cache and the model's saved answers are kept from one run
to the next, so a plan that's run again doesn't fetch its terrain or ask the model again. The USGS's services and
Ollama answer other sites' pages, so the browser fetches them itself. The page's import map has the tools' Node
modules - `node:util`, `node:buffer`, and `node:zlib` are `plan/lib/browser/`'s `util.js`, `buffer.js`, and `zlib.js`
- and maps the tools' imports of the viewer's modules (`viewer/lib/`) to the application's (`lib/`).
