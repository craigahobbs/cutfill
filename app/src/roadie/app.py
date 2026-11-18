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


# Get the directory's roads - its road site models and its road plan models
action getRoads
    urls
        GET

    output
        # The directory's path
        string directory

        # The directory's roads, in name order
        Road[] roads


# A road - its road site model, its road plan model, or both
struct Road

    # The road's name - its files' name
    string name

    # The road site model's file ("<name>.site.json"), if the road has one
    optional string site

    # The road plan model's file ("<name>.json"), if the road has one
    optional string plan
''')


# The files' URLs - a file of the directory, or of a directory within it (a plan's work directory, say)
FILE_URLS = ('/files/{name1}', '/files/{name1}/{name2}', '/files/{name1}/{name2}/{name3}')


# The files that may be written - their extensions
WRITE_EXTENSIONS = ('.f32', '.json', '.md', '.png', '.txt')


# The text of a road plan model's file that a JSON file of a directory is a road plan model by - a plan's
# topography is its largest member, and it's within the start of the file
PLAN_TEXT = '"topography"'
PLAN_TEXT_LENGTH = 65536


# The Roadie back-end API WSGI application class - "root" is the directory of the roads, and "static_dir" is the
# front end's directory (the package's, by default)
class Roadie(chisel.Application):
    __slots__ = ('root',)


    def __init__(self, root, static_dir=None):
        super().__init__()
        self.root = os.path.realpath(root)

        # Back-end documentation
        self.add_requests(chisel.create_doc_requests())

        # Back-end APIs
        self.add_request(get_roads)
        self.add_request(chisel.Request(
            get_file, name='getFile', urls=[('GET', url) for url in FILE_URLS], doc_group='Roadie',
            doc='Get a file of the directory'
        ))
        self.add_request(chisel.Request(
            put_file, name='putFile', urls=[('PUT', url) for url in FILE_URLS], doc_group='Roadie',
            doc='Write a file of the directory - a road site model, a road plan model, or a file of a plan\'s work directory'
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


@chisel.action(name='getRoads', types=ROADIE_TYPES)
def get_roads(ctx, unused_req):
    root = ctx.app.root
    roads = {}
    for file_name in sorted(os.listdir(root)):
        path = os.path.join(root, file_name)
        if file_name.startswith('.') or not os.path.isfile(path):
            continue
        if file_name.endswith('.site.json'):
            roads.setdefault(file_name[:-len('.site.json')], {})['site'] = file_name
        elif file_name.endswith('.json'):
            with open(path, 'r', encoding='utf-8', errors='replace') as plan_file:
                if PLAN_TEXT in plan_file.read(PLAN_TEXT_LENGTH):
                    roads.setdefault(file_name[:-len('.json')], {})['plan'] = file_name
    return {
        'directory': root,
        'roads': [{'name': name, **roads[name]} for name in sorted(roads)]
    }


# Get a file request's path - None if it isn't a file's path within the directory
def _file_path(ctx):
    names = [ctx.url_args[key] for key in ('name1', 'name2', 'name3') if key in ctx.url_args]
    if any(name.startswith('.') or '/' in name or '\\' in name or '\0' in name for name in names):
        return None
    path = os.path.realpath(os.path.join(ctx.app.root, *names))
    if not path.startswith(ctx.app.root + os.sep):
        return None
    return path


def get_file(environ, unused_start_response):
    ctx = environ[chisel.Context.ENVIRON_CTX]
    path = _file_path(ctx)
    if path is None or not os.path.isfile(path):
        return ctx.response_text(HTTPStatus.NOT_FOUND)
    with open(path, 'rb') as file_:
        content = file_.read()

    # A directory's files change - they aren't cached
    content_type = chisel.StaticRequest.EXT_TO_CONTENT_TYPE.get(os.path.splitext(path)[1].lower(), 'application/octet-stream')
    return ctx.response(HTTPStatus.OK, content_type, [content], headers=[('Cache-Control', 'no-store')])


def put_file(environ, unused_start_response):
    ctx = environ[chisel.Context.ENVIRON_CTX]

    # A file is written only by the application's own page - not by another site's page
    origin = environ.get('HTTP_ORIGIN')
    if origin is not None and origin != f'{environ["wsgi.url_scheme"]}://{environ.get("HTTP_HOST")}':
        return ctx.response_text(HTTPStatus.FORBIDDEN)

    # The file's path
    path = _file_path(ctx)
    if path is None or os.path.splitext(path)[1].lower() not in WRITE_EXTENSIONS or os.path.isdir(path):
        return ctx.response_text(HTTPStatus.BAD_REQUEST)

    # Write the file - to another file first, so a failed write leaves the file as it was
    content = environ['wsgi.input'].read()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp_path = f'{path}.roadie-write'
    with open(temp_path, 'wb') as file_:
        file_.write(content)
    os.replace(temp_path, path)
    return ctx.response_text(HTTPStatus.OK)
