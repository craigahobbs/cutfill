# Roadie Application

The Roadie application - a Python package (`roadie`) built with
[python-build](https://github.com/craigahobbs/python-build#readme). Its command line, `roadie SITE PLAN`, serves the
Roadie front end (the [viewer](../viewer/README.md)'s application) and a back end for one road: its road site model
(`SITE`, a JSON file - a new road's is made when it's saved) and its road plan model (`PLAN`, another JSON file - the
road's plan is written to it). See the project's [README](../README.md).

```sh
make static              # stage the front end (the viewer and the planning tools) in the package (src/roadie/static/)
make run ARGS=<files>    # serve a road - "roadie [-p PORT] [-n] [-q] SITE PLAN"
make commit              # the pre-commit gate: test, lint, and cover (100% required)
```

The project's `make app FILE=<site.json> OUTPUT=<plan.json>` runs it.

The back end (`src/roadie/app.py`) is a [chisel](https://github.com/craigahobbs/chisel#readme) application, served
by [waitress](https://github.com/Pylons/waitress#readme) to this computer only (`127.0.0.1`):

- `GET /getRoad` - the road: its road site model's file name, its road plan model's, and whether each exists.
- `GET /site` and `PUT /site` - the road site model's file.
- `GET /files/<path>` - a file of the plan: the road plan model's file, an image of its directory (the plan's
  topographic map image), or a file of its work directory (`<plan>.work/`). The viewer opens the road's plan from here.
- `PUT /files/<path>` - write a file of the plan: the road plan model's file, its map image (`<plan>.png`), or a file
  of its work directory (`.json`, `.png`, `.md`, or `.txt`).
- `/doc/` - the back end's API documentation (chisel's).

Only the application's own page writes files: a request from another site's page is refused. The back end reads and
writes the road's files only - not the other files of their directories, a hidden file, a path out of the plan's
directory, or a link out of it.

The front end is the package's `static` directory (it isn't in the repository) - `make static` copies the viewer's
staged application there, with the planning tools' modules (`plan/lib/`) and the GeoTIFF reader's script.

The application's home page is the road's page: it edits the road site model, plans the road, and links to the
road's plan in the viewer. The road site's form is made from the road site model's Schema Markdown types, so it has
the model's members and their documentation, and a road site is saved only if the model validates it. The members
the form doesn't edit - the exclusion areas - are kept as they are. A point that's copied from a map
("46.16755, -119.16811") is pasted into its latitude.

The engineering isn't the back end's: a road is planned in the browser, by the planning tools' `auto` command
(`../plan/lib/browser/io.js`). The road's page saves its road site, plans the road from it - with one of Ollama's
models, or none - and shows the plan's report as it's made. The tools' files are in the browser's memory: the road's site
model (`/site`), plan, and saved answers are loaded from the back end, and the files the tools write are written to it (but
for the terrain cache's). The USGS's services and Ollama answer other sites' pages, so the browser fetches them
itself. The page's import map has the tools' Node modules - `node:util`, `node:buffer`, and `node:zlib` are
`plan/lib/browser/`'s `util.js`, `buffer.js`, and `zlib.js` - and maps the tools' imports of the viewer's modules
(`viewer/lib/`) to the application's (`lib/`).
