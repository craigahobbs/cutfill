# SageRoad Application

The SageRoad application - a Python package (`sageroad`) built with
[python-build](https://github.com/craigahobbs/python-build#readme). Its command line, `sageroad`, serves the SageRoad
front end - the [viewer](../viewer/README.md)'s application, and the planning tools - in your web browser. See the
project's [README](../README.md).

```sh
make static              # stage the front end (the viewer and the planning tools) in the package (src/sageroad/static/)
make run [ARGS=...]      # run the application - "sageroad [-p PORT] [-n] [-q]" (it logs the requests that fail)
make commit              # the pre-commit gate: test, lint, and cover (100% required)
```

The project's `make run` runs it.

The back end (`src/sageroad/app.py`) is a [chisel](https://github.com/craigahobbs/chisel#readme) application, served
by [waitress](https://github.com/Pylons/waitress#readme) to this computer only (`127.0.0.1`). For now, it's only the
front end's statics, the computer's system information (`getSystemInfo` - its memory, and whether it runs MLX models,
which a browser can't know), and chisel's API documentation (`/doc/`) - the front end does the rest in the browser.

The front end is the package's `static` directory - `make static` copies the viewer's staged application there, with
the planning tools' modules (`plan/lib/`). It's committed, so the package builds from the repository without Node.js.
The package's readme (its PyPI page) is the project's README, by a link (`PYPI.md`) - setuptools reads only the
package directory's files.
The package is installed from [PyPI](https://pypi.org/project/sageroad/):

```sh
python3 -m venv sageroad-venv
sageroad-venv/bin/pip install sageroad
```

The app adds the front end's files at creation (package resources), and the page loads nothing from the internet but
the USGS's site data and the list of Ollama's models to download (ollama-chat's) - the application runs offline
otherwise. The tests stage the front end first, so the pre-commit gate keeps the committed copy the sources', and they
check that the package has every module the page imports (and no others), and that the front end's only web addresses
are the USGS's, the model list's, Ollama's (on this computer), and text.

The page asks Ollama itself - the back end isn't a part of it. Its model pages (`#var.vModels=true`, and
`#var.vDownload=true`) list Ollama's models, delete them, and download them (a download is the page's request - it
stops if the page is closed or reloaded), and list the models to download - by default, as ollama-chat's do, the
models modified in the last 6 months that the computer runs (its system information's - a local model needs about a
byte of memory a parameter), the most recently modified first, and of them, the local models.

The application's home page opens a plan - with the browser's open dialog (its file handle is kept, so the plan is
saved to its file) or file input, or dropped on the page - or makes a new one (`#var.vEdit='new'`). The files stay on
the computer: they're kept in the browser's storage (IndexedDB), and the loaded plan is remembered (local storage). A
plan is its config - a road site model - and, once it's run, its road options: a road plan model, whose `site` member
is its config. A plan without road options is its config's file.

The plan config's form (`#var.vEdit='new'`, or `'loaded'` for the loaded plan's) is made from the road site model's
Schema Markdown types, so it has the model's members and their documentation, and a config is done only if the model
validates it. An optional member's default is its box's placeholder - the design criteria's (in the config's units)
and the cost rates' are the model's, and the site's margin and grid spacing are the planning tools' (`siteDefaults`).
The members the form doesn't edit - the marks: the exclusion areas, roads, and places to pass through - are kept as
they are (the map page edits them). A point that's copied from a map ("46.16755, -119.16811") is pasted into its
latitude.

The home page shows the loaded plan - its config - and its actions: view it (its road options' report), edit its
config, draw its config's marks on its site's map (`#var.vMap=true` - its contours, topographic map, or shaded relief,
once it's run), run it (its steps - the planning tools' `autoSteps` - and its time are shown as it goes, and its result and
report when it's done; it's stopped with an abort signal, when its current step's work is done, and its work is
thrown away; the last model chosen is remembered; a plan's site's data is kept, unless the site changed or it's
fetched again), clear its road options (its site's data is kept), save it (to its file, or another - the browser's
save dialog, or a download - "Download", in a browser without one), and close it (the user is asked first, if it has
changes that aren't saved). A plan with road options is one file: it keeps its config and its map image (a data URL). The recent files are listed - a file is
opened, or removed (but for the loaded plan's road options' file).

The engineering isn't the back end's: a plan is run in the browser, by the planning tools' procedure (`autoPlan`,
`../plan/lib/auto.js` - `planRoad`, `../plan/lib/browser/io.js`, runs it with a browser's input and output) - with one of Ollama's models, or none - and the run's report is shown when it's done.
The run's plan config is the loaded plan's: the places it found for the notes are its marks, and a too-small site's
margin is enlarged.
The plan is made in the browser's memory, and the tools' work files are there, too: the terrain cache and the model's
saved answers are kept from one run to the next, so a plan that's run again doesn't fetch its terrain or ask the model
again. The USGS's services and
Ollama answer other sites' pages, so the browser fetches them itself. The page's import map has the tools' Node
modules - `node:buffer` and `node:zlib` are `plan/lib/browser/`'s `buffer.js` and `zlib.js` - and maps the tools' imports of the viewer's modules (`viewer/lib/`) to the application's (`lib/`).
