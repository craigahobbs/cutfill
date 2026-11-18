# Roadie Application

The Roadie application - a Python package (`roadie`) built with
[python-build](https://github.com/craigahobbs/python-build#readme). Its command line serves the Roadie front end
(the [viewer](../viewer/README.md)'s application) and a back end for a directory's roads - its road site models
(`<name>.site.json`) and its road plan models (`<name>.json`). See the project's [README](../README.md).

```sh
make static              # stage the front end (the viewer's application) in the package (src/roadie/static/)
make run ARGS=<dir>      # serve a directory's roads - "roadie [-p PORT] [-n] [-q] [DIRECTORY]"
make commit              # the pre-commit gate: test, lint, and cover (100% required)
```

The back end (`src/roadie/app.py`) is a [chisel](https://github.com/craigahobbs/chisel#readme) application, served
by [waitress](https://github.com/Pylons/waitress#readme) to this computer only (`127.0.0.1`):

- `GET /getRoads` - the directory's roads: each road's name, and its site model's and plan model's files. A JSON
  file is a road plan model if its text has a `"topography"` member.
- `GET /files/<path>` - a file of the directory, or of a directory within it (a plan's work directory's, say). The
  viewer opens a road's plan, and its topographic map image, from here.
- `PUT /files/<path>` - write a file (`.json`, `.png`, `.md`, `.txt`, or `.f32`). Only the application's own page
  writes files: a request from another site's page is refused. A hidden file, a path out of the directory, and a
  link out of it aren't files of the directory.
- `/doc/` - the back end's API documentation (chisel's).

The front end is the package's `static` directory - `make static` copies the viewer's staged application there (it
isn't in the repository). The engineering isn't the back end's: it's the planning tools' JavaScript
(`../plan/lib/`), which runs in the browser.
