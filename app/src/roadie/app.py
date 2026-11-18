"""
The Roadie back-end application
"""

from http import HTTPStatus
import importlib.resources
import os
import pathlib

import chisel
import schema_markdown


# The back-end APIs' type model
ROADIE_TYPES = schema_markdown.parse_schema_markdown('''\
group "Roadie"


# Get the application's road - its road site model's file and its road plan model's file
action getRoad
    urls
        GET

    output
        # The road site model's file name
        string site

        # The road plan model's file name
        string plan

        # True if the road site model's file exists - a new road's doesn't, until it's saved
        bool hasSite

        # True if the road plan model's file exists - the road is planned
        bool hasPlan
''')


# The road site model's file's URL
SITE_URL = '/site'


# The plan's files' URLs - a file of the plan's directory, or of the plan's work directory
FILE_URLS = ('/files/{name1}', '/files/{name1}/{name2}', '/files/{name1}/{name2}/{name3}')


# The plan's work directory's files that may be written - their extensions
WRITE_EXTENSIONS = ('.json', '.md', '.png', '.txt')


# The files of the plan's directory that may be read - a plan's map image is one - by their extensions
IMAGE_EXTENSIONS = ('.gif', '.jpeg', '.jpg', '.pdf', '.png', '.svg', '.webp')


# The Roadie back-end API WSGI application class - "site" is the road site model's file, "plan" is the road plan
# model's file (neither need exist), and "static_dir" is the front end's directory (the package's, by default)
class Roadie(chisel.Application):
    __slots__ = ('site', 'plan', 'root')


    def __init__(self, site, plan, static_dir=None):
        super().__init__()
        self.site = os.path.realpath(site)
        self.plan = os.path.realpath(plan)
        self.root = os.path.dirname(self.plan)

        # Back-end documentation
        self.add_requests(chisel.create_doc_requests())

        # Back-end APIs
        self.add_request(get_road)
        self.add_request(chisel.Request(
            get_site, name='getSite', urls=[('GET', SITE_URL)], doc_group='Roadie', doc='Get the road site model\'s file'
        ))
        self.add_request(chisel.Request(
            put_site, name='putSite', urls=[('PUT', SITE_URL)], doc_group='Roadie', doc='Write the road site model\'s file'
        ))
        self.add_request(chisel.Request(
            get_file, name='getFile', urls=[('GET', url) for url in FILE_URLS], doc_group='Roadie',
            doc='Get a file of the plan - the road plan model\'s file, an image of its directory, or a file of its work directory'
        ))
        self.add_request(chisel.Request(
            put_file, name='putFile', urls=[('PUT', url) for url in FILE_URLS], doc_group='Roadie',
            doc='Write a file of the plan - the road plan model\'s file, its map image, or a file of its work directory'
        ))

        # Front-end statics - the application's page is the root URL's
        static = importlib.resources.files('roadie').joinpath('static') if static_dir is None else pathlib.Path(static_dir)
        for name, content in sorted(_static_files(static, '')):
            urls = [('GET', f'/{name}')]
            if name == 'index.html':
                urls.append(('GET', '/'))
            self.add_request(chisel.StaticRequest(name, content, urls=urls))


# Get a directory's files - their names (with their directories', from the directory) and their contents
def _static_files(directory, prefix):
    if directory.is_dir():
        for entry in directory.iterdir():
            if entry.is_dir():
                yield from _static_files(entry, f'{prefix}{entry.name}/')
            else:
                yield f'{prefix}{entry.name}', entry.read_bytes()


@chisel.action(name='getRoad', types=ROADIE_TYPES)
def get_road(ctx, unused_req):
    app = ctx.app
    return {
        'site': os.path.basename(app.site),
        'plan': os.path.basename(app.plan),
        'hasSite': os.path.isfile(app.site),
        'hasPlan': os.path.isfile(app.plan)
    }


# Get a plan's file request's path - None if it isn't a path of the plan's files. They're the road plan model's file,
# its work directory's files ("<plan>.work/"), and - to read - its directory's images, or - to write - its map image
# ("<plan>.png").
def _file_path(ctx, write):
    names = [ctx.url_args[key] for key in ('name1', 'name2', 'name3') if key in ctx.url_args]
    if any(name.startswith('.') or '/' in name or '\\' in name or '\0' in name for name in names):
        return None
    plan_name = os.path.basename(ctx.app.plan)
    plan_base, _ = os.path.splitext(plan_name)
    extension = os.path.splitext(names[-1])[1].lower()
    if len(names) > 1:
        is_file = names[0] == f'{plan_base}.work' and (not write or extension in WRITE_EXTENSIONS)
    elif write:
        is_file = names[0] in (plan_name, f'{plan_base}.png')
    else:
        is_file = names[0] == plan_name or extension in IMAGE_EXTENSIONS
    path = os.path.realpath(os.path.join(ctx.app.root, *names))
    if not is_file or not path.startswith(ctx.app.root + os.sep):
        return None
    return path


# Respond with a file's content - the files change, so they aren't cached
def _read_file(ctx, path):
    if path is None or not os.path.isfile(path):
        return ctx.response_text(HTTPStatus.NOT_FOUND)
    with open(path, 'rb') as file_:
        content = file_.read()
    content_type = chisel.StaticRequest.EXT_TO_CONTENT_TYPE.get(os.path.splitext(path)[1].lower(), 'application/octet-stream')
    return ctx.response(HTTPStatus.OK, content_type, [content], headers=[('Cache-Control', 'no-store')])


# Write a request's content to a file
def _write_file(ctx, environ, path):

    # A file is written only by the application's own page - not by another site's page
    origin = environ.get('HTTP_ORIGIN')
    if origin is not None and origin != f'{environ["wsgi.url_scheme"]}://{environ.get("HTTP_HOST")}':
        return ctx.response_text(HTTPStatus.FORBIDDEN)
    if path is None or os.path.isdir(path):
        return ctx.response_text(HTTPStatus.BAD_REQUEST)

    # Write the file - to another file first, so a failed write leaves the file as it was
    content = environ['wsgi.input'].read()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp_path = f'{path}.roadie-write'
    with open(temp_path, 'wb') as file_:
        file_.write(content)
    os.replace(temp_path, path)
    return ctx.response_text(HTTPStatus.OK)


def get_site(environ, unused_start_response):
    ctx = environ[chisel.Context.ENVIRON_CTX]
    return _read_file(ctx, ctx.app.site)


def put_site(environ, unused_start_response):
    ctx = environ[chisel.Context.ENVIRON_CTX]
    return _write_file(ctx, environ, ctx.app.site)


def get_file(environ, unused_start_response):
    ctx = environ[chisel.Context.ENVIRON_CTX]
    return _read_file(ctx, _file_path(ctx, False))


def put_file(environ, unused_start_response):
    ctx = environ[chisel.Context.ENVIRON_CTX]
    return _write_file(ctx, environ, _file_path(ctx, True))
