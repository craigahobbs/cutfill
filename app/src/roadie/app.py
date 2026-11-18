"""
The Roadie back-end application
"""

import importlib.resources
import pathlib

import chisel


# The Roadie back-end WSGI application class - it serves the front end: "static_dir" is its directory (the
# package's, by default). The front end does the rest in the browser - it opens and saves the user's files, and plans
# a road with the planning tools.
class Roadie(chisel.Application):
    __slots__ = ()


    def __init__(self, static_dir=None):
        super().__init__()

        # Back-end documentation
        self.add_requests(chisel.create_doc_requests())

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
