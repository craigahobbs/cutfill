import json
import os
import unittest

from roadie.app import Roadie

from .util import create_test_files


# A road plan model's file text, and a road site model's
PLAN_TEXT = json.dumps({'title': 'Hill Road', 'units': 'feet', 'topography': {'spacing': 5, 'elevations': [[1, 2], [3, 4]]}})
SITE_TEXT = json.dumps({'title': 'Hill Road', 'units': 'feet'})


# The front end's files
STATIC_FILES = [
    (('static', 'index.html'), '<!DOCTYPE html>'),
    (('static', 'app.css'), 'body {}'),
    (('static', 'lib', 'app.js'), 'export const app = 1;'),
    (('static', 'schema-markdown', 'lib', 'parser.js'), 'export const parser = 1;')
]


# Create the application of a directory of files - its roads are the directory's "roads" directory's
def create_app(temp_dir):
    return Roadie(os.path.join(temp_dir, 'roads'), os.path.join(temp_dir, 'static'))


class TestApp(unittest.TestCase):

    def test_init(self):
        with create_test_files([*STATIC_FILES, (('roads', 'hill.json'), PLAN_TEXT)]) as temp_dir:
            app = create_app(temp_dir)
            self.assertEqual(app.root, os.path.join(temp_dir, 'roads'))
            self.assertListEqual(
                sorted(request.name for request in app.requests.values() if request.doc_group == 'Roadie'),
                ['getFile', 'getRoads', 'putFile']
            )
            self.assertListEqual(
                sorted(request.name for request in app.requests.values() if request.doc_group == 'Statics'),
                ['app.css', 'index.html', 'lib/app.js', 'schema-markdown/lib/parser.js']
            )


    def test_statics(self):
        with create_test_files([*STATIC_FILES, (('roads', 'hill.json'), PLAN_TEXT)]) as temp_dir:
            app = create_app(temp_dir)

            # The application's page is the root URL's
            for url in ('/', '/index.html'):
                status, headers, content = app.request('GET', url)
                self.assertEqual(status, '200 OK')
                self.assertEqual(dict(headers)['Content-Type'], 'text/html; charset=utf-8')
                self.assertEqual(content, b'<!DOCTYPE html>')

            # The front end's modules
            status, headers, content = app.request('GET', '/schema-markdown/lib/parser.js')
            self.assertEqual(status, '200 OK')
            self.assertEqual(dict(headers)['Content-Type'], 'text/javascript; charset=utf-8')
            self.assertEqual(content, b'export const parser = 1;')
            status, _, _ = app.request('GET', '/lib/other.js')
            self.assertEqual(status, '404 Not Found')


    def test_statics_package(self):
        # The package's front end is its "static" directory's files - it has none until the front end is staged there
        with create_test_files([(('roads', 'hill.json'), PLAN_TEXT)]) as temp_dir:
            app = Roadie(os.path.join(temp_dir, 'roads'))
            self.assertIn('getRoads', app.requests)
            statics = [request for request in app.requests.values() if request.doc_group == 'Statics']
            self.assertTrue(all(request.urls[0][1].startswith('/') for request in statics))


    def test_get_roads(self):
        test_files = [
            (('roads', 'hill.json'), PLAN_TEXT),
            (('roads', 'hill.site.json'), SITE_TEXT),
            (('roads', 'creek.site.json'), SITE_TEXT),
            (('roads', 'ridge.json'), PLAN_TEXT),

            # These aren't roads - JSON that isn't a plan, another file, a hidden file, and a directory's files
            (('roads', 'package.json'), '{"name": "package"}'),
            (('roads', 'hill.png'), b'\x89PNG'),
            (('roads', '.hidden.json'), PLAN_TEXT),
            (('roads', 'hill.work', 'decisions.json'), '{"topography": 1}'),
            (('roads', 'other.site.json', 'file.txt'), 'text')
        ]
        with create_test_files(test_files) as temp_dir:
            app = create_app(temp_dir)
            status, headers, content = app.request('GET', '/getRoads')
            self.assertEqual(status, '200 OK')
            self.assertEqual(dict(headers)['Content-Type'], 'application/json')
            self.assertDictEqual(json.loads(content), {
                'directory': os.path.join(temp_dir, 'roads'),
                'roads': [
                    {'name': 'creek', 'site': 'creek.site.json'},
                    {'name': 'hill', 'plan': 'hill.json', 'site': 'hill.site.json'},
                    {'name': 'ridge', 'plan': 'ridge.json'}
                ]
            })


    def test_get_roads_empty(self):
        with create_test_files([(('roads', 'notes.txt'), 'text')]) as temp_dir:
            app = create_app(temp_dir)
            status, _, content = app.request('GET', '/getRoads')
            self.assertEqual(status, '200 OK')
            self.assertDictEqual(json.loads(content), {'directory': os.path.join(temp_dir, 'roads'), 'roads': []})


    def test_get_file(self):
        test_files = [
            (('roads', 'hill.json'), PLAN_TEXT),
            (('roads', 'hill.png'), b'\x89PNG'),
            (('roads', 'hill.work', 'decisions.json'), '{}'),
            (('roads', 'hill.work', 'terrain', 'tile.f32'), b'\x00\x01'),
            (('roads', '.secret'), 'secret'),
            ('outside.json', '{}')
        ]
        with create_test_files(test_files) as temp_dir:
            app = create_app(temp_dir)

            # The directory's files, and its directories' - they aren't cached
            for url, content_type, expected in (
                ('/files/hill.json', 'application/json; charset=utf-8', PLAN_TEXT.encode('utf-8')),
                ('/files/hill.png', 'image/png', b'\x89PNG'),
                ('/files/hill.work/decisions.json', 'application/json; charset=utf-8', b'{}'),
                ('/files/hill.work/terrain/tile.f32', 'application/octet-stream', b'\x00\x01')
            ):
                status, headers, content = app.request('GET', url)
                self.assertEqual(status, '200 OK', url)
                self.assertListEqual(sorted(headers), [('Cache-Control', 'no-store'), ('Content-Type', content_type)])
                self.assertEqual(content, expected)

            # A file that isn't there, a directory, a hidden file, and a path that isn't within the directory
            for url in (
                '/files/creek.json', '/files/hill.work', '/files/.secret', '/files/..', '/files/hill.work/../hill.json',
                '/files/%2E%2E/outside.json', '/files/hill.work/%2E%2E%2Foutside.json', '/files/a%5Cb.json'
            ):
                status, _, _ = app.request('GET', url)
                self.assertEqual(status, '404 Not Found', url)


    def test_get_file_link(self):
        # A link out of the directory isn't a file of it
        with create_test_files([(('roads', 'hill.json'), PLAN_TEXT), ('outside.json', '{}')]) as temp_dir:
            os.symlink(os.path.join(temp_dir, 'outside.json'), os.path.join(temp_dir, 'roads', 'link.json'))
            app = create_app(temp_dir)
            status, _, _ = app.request('GET', '/files/link.json')
            self.assertEqual(status, '404 Not Found')
            status, _, _ = app.request('GET', '/files/hill.json')
            self.assertEqual(status, '200 OK')


    def test_put_file(self):
        with create_test_files([(('roads', 'hill.json'), PLAN_TEXT)]) as temp_dir:
            app = create_app(temp_dir)
            roads = os.path.join(temp_dir, 'roads')

            # A file is written - a new file, a file that replaces one, and a file of a new directory
            for url, content in (
                ('/files/creek.site.json', SITE_TEXT.encode('utf-8')),
                ('/files/hill.json', b'{"title": "Hill"}'),
                ('/files/hill.work/ask/barn.png', b'\x89PNG'),
                ('/files/hill.work/descriptions.md', b'# Plan\n'),
                ('/files/empty.txt', b'')
            ):
                status, headers, response = app.request('PUT', url, wsgi_input=content)
                self.assertEqual(status, '200 OK', url)
                self.assertListEqual(headers, [('Content-Type', 'text/plain; charset=utf-8')])
                self.assertEqual(response, b'OK')
                with open(os.path.join(roads, *url.split('/')[2:]), 'rb') as file_:
                    self.assertEqual(file_.read(), content)
            self.assertListEqual(sorted(os.listdir(roads)), ['creek.site.json', 'empty.txt', 'hill.json', 'hill.work'])
            self.assertListEqual(sorted(os.listdir(os.path.join(roads, 'hill.work'))), ['ask', 'descriptions.md'])

            # The application's own page writes files - its origin is the application's
            environ = {'HTTP_ORIGIN': 'http://127.0.0.1:8080', 'HTTP_HOST': '127.0.0.1:8080'}
            status, _, _ = app.request('PUT', '/files/ridge.site.json', wsgi_input=b'{}', environ=environ)
            self.assertEqual(status, '200 OK')


    def test_put_file_invalid(self):
        with create_test_files([(('roads', 'hill.json'), PLAN_TEXT), (('roads', 'dir.json', 'file.txt'), 'text')]) as temp_dir:
            app = create_app(temp_dir)
            roads = os.path.join(temp_dir, 'roads')

            # Another site's page doesn't write files
            environ = {'HTTP_ORIGIN': 'http://example.com', 'HTTP_HOST': '127.0.0.1:8080'}
            status, _, _ = app.request('PUT', '/files/hill.json', wsgi_input=b'{}', environ=environ)
            self.assertEqual(status, '403 Forbidden')

            # A file that isn't a road's kind, a hidden file, a directory, and a path that isn't within the directory
            for url in (
                '/files/script.js', '/files/hill', '/files/.hidden.json', '/files/dir.json', '/files/%2E%2E/outside.json',
                '/files/hill.work/%2E%2E%2F%2E%2E%2Foutside.json'
            ):
                status, _, _ = app.request('PUT', url, wsgi_input=b'{}')
                self.assertEqual(status, '400 Bad Request', url)
            with open(os.path.join(roads, 'hill.json'), 'r', encoding='utf-8') as file_:
                self.assertEqual(file_.read(), PLAN_TEXT)
            self.assertListEqual(sorted(os.listdir(temp_dir)), ['roads'])
            self.assertListEqual(sorted(os.listdir(roads)), ['dir.json', 'hill.json'])

            # A request of another method
            status, _, _ = app.request('POST', '/files/hill.json', wsgi_input=b'{}')
            self.assertEqual(status, '405 Method Not Allowed')
