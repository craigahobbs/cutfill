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


# Create the application of a directory of files - its road site model is the directory's "sites/hill-site.json", and its
# road plan model is "roads/hill.json"
def create_app(temp_dir):
    return Roadie(
        os.path.join(temp_dir, 'sites', 'hill-site.json'), os.path.join(temp_dir, 'roads', 'hill.json'), os.path.join(temp_dir, 'static')
    )


class TestApp(unittest.TestCase):

    def test_init(self):
        with create_test_files([*STATIC_FILES, (('roads', 'hill.json'), PLAN_TEXT)]) as temp_dir:
            app = create_app(temp_dir)
            self.assertEqual(app.site, os.path.join(temp_dir, 'sites', 'hill-site.json'))
            self.assertEqual(app.plan, os.path.join(temp_dir, 'roads', 'hill.json'))
            self.assertEqual(app.root, os.path.join(temp_dir, 'roads'))
            self.assertListEqual(
                sorted(request.name for request in app.requests.values() if request.doc_group == 'Roadie'),
                ['getFile', 'getRoad', 'getSite', 'putFile', 'putSite']
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
            app = Roadie(os.path.join(temp_dir, 'site.json'), os.path.join(temp_dir, 'roads', 'hill.json'))
            self.assertIn('getRoad', app.requests)
            statics = [request for request in app.requests.values() if request.doc_group == 'Statics']
            self.assertTrue(all(request.urls[0][1].startswith('/') for request in statics))


    def test_get_road(self):
        # The road's files' names - neither file need exist
        with create_test_files([(('other', 'notes.txt'), 'text')]) as temp_dir:
            app = create_app(temp_dir)
            status, headers, content = app.request('GET', '/getRoad')
            self.assertEqual(status, '200 OK')
            self.assertEqual(dict(headers)['Content-Type'], 'application/json')
            self.assertDictEqual(json.loads(content), {'site': 'hill-site.json', 'plan': 'hill.json', 'hasSite': False, 'hasPlan': False})
        with create_test_files([(('roads', 'hill.json'), PLAN_TEXT), (('sites', 'hill-site.json'), SITE_TEXT)]) as temp_dir:
            app = create_app(temp_dir)
            status, _, content = app.request('GET', '/getRoad')
            self.assertEqual(status, '200 OK')
            self.assertDictEqual(json.loads(content), {'site': 'hill-site.json', 'plan': 'hill.json', 'hasSite': True, 'hasPlan': True})


    def test_site(self):
        with create_test_files([(('roads', 'hill.json'), PLAN_TEXT)]) as temp_dir:
            app = create_app(temp_dir)

            # A new road's site model isn't there until it's written - its directory is made
            status, _, _ = app.request('GET', '/site')
            self.assertEqual(status, '404 Not Found')
            status, headers, response = app.request('PUT', '/site', wsgi_input=SITE_TEXT.encode('utf-8'))
            self.assertEqual(status, '200 OK')
            self.assertListEqual(headers, [('Content-Type', 'text/plain; charset=utf-8')])
            self.assertEqual(response, b'OK')
            self.assertListEqual(os.listdir(os.path.join(temp_dir, 'sites')), ['hill-site.json'])

            # The site model's file - it isn't cached
            status, headers, content = app.request('GET', '/site')
            self.assertEqual(status, '200 OK')
            self.assertListEqual(sorted(headers), [('Cache-Control', 'no-store'), ('Content-Type', 'application/json; charset=utf-8')])
            self.assertEqual(content, SITE_TEXT.encode('utf-8'))

            # The application's own page writes it - another site's page doesn't
            environ = {'HTTP_ORIGIN': 'http://127.0.0.1:8080', 'HTTP_HOST': '127.0.0.1:8080'}
            status, _, _ = app.request('PUT', '/site', wsgi_input=b'{}', environ=environ)
            self.assertEqual(status, '200 OK')
            environ = {'HTTP_ORIGIN': 'http://example.com', 'HTTP_HOST': '127.0.0.1:8080'}
            status, _, _ = app.request('PUT', '/site', wsgi_input=b'{"title": "Other"}', environ=environ)
            self.assertEqual(status, '403 Forbidden')
            with open(app.site, 'rb') as file_:
                self.assertEqual(file_.read(), b'{}')


    def test_site_directory(self):
        # A road site model's file that's a directory isn't written
        with create_test_files([(('sites', 'hill-site.json', 'file.txt'), 'text')]) as temp_dir:
            app = create_app(temp_dir)
            status, _, _ = app.request('GET', '/site')
            self.assertEqual(status, '404 Not Found')
            status, _, _ = app.request('PUT', '/site', wsgi_input=b'{}')
            self.assertEqual(status, '400 Bad Request')


    def test_get_file(self):
        test_files = [
            (('roads', 'hill.json'), PLAN_TEXT),
            (('roads', 'hill.png'), b'\x89PNG'),
            (('roads', 'Survey.PDF'), b'%PDF'),
            (('roads', 'hill.work', 'decisions.json'), '{}'),
            (('roads', 'hill.work', 'terrain', 'tile.f32'), b'\x00\x01'),
            (('roads', 'creek.json'), PLAN_TEXT),
            (('roads', 'creek.work', 'decisions.json'), '{}'),
            (('roads', 'notes.txt'), 'text'),
            (('roads', '.secret.png'), b'\x89PNG'),
            ('outside.png', b'\x89PNG')
        ]
        with create_test_files(test_files) as temp_dir:
            app = create_app(temp_dir)

            # The plan's files - its file, its directory's images, and its work directory's files. They aren't cached.
            for url, content_type, expected in (
                ('/files/hill.json', 'application/json; charset=utf-8', PLAN_TEXT.encode('utf-8')),
                ('/files/hill.png', 'image/png', b'\x89PNG'),
                ('/files/Survey.PDF', 'application/pdf', b'%PDF'),
                ('/files/hill.work/decisions.json', 'application/json; charset=utf-8', b'{}'),
                ('/files/hill.work/terrain/tile.f32', 'application/octet-stream', b'\x00\x01')
            ):
                status, headers, content = app.request('GET', url)
                self.assertEqual(status, '200 OK', url)
                self.assertListEqual(sorted(headers), [('Cache-Control', 'no-store'), ('Content-Type', content_type)])
                self.assertEqual(content, expected)

            # Another plan's files, another file, a file that isn't there, a directory, a hidden file, and a path that
            # isn't within the plan's directory
            for url in (
                '/files/creek.json', '/files/creek.work/decisions.json', '/files/notes.txt', '/files/ridge.png', '/files/hill.work',
                '/files/hill.work/missing.json', '/files/.secret.png', '/files/..', '/files/hill.work/../hill.json',
                '/files/%2E%2E/outside.png', '/files/hill.work/%2E%2E%2Foutside.png', '/files/a%5Cb.png'
            ):
                status, _, _ = app.request('GET', url)
                self.assertEqual(status, '404 Not Found', url)


    def test_get_file_link(self):
        # A link out of the plan's directory isn't a file of it
        with create_test_files([(('roads', 'hill.json'), PLAN_TEXT), ('outside.png', b'\x89PNG')]) as temp_dir:
            os.symlink(os.path.join(temp_dir, 'outside.png'), os.path.join(temp_dir, 'roads', 'link.png'))
            app = create_app(temp_dir)
            status, _, _ = app.request('GET', '/files/link.png')
            self.assertEqual(status, '404 Not Found')
            status, _, _ = app.request('GET', '/files/hill.json')
            self.assertEqual(status, '200 OK')


    def test_put_file(self):
        with create_test_files([(('roads', 'hill.json'), PLAN_TEXT)]) as temp_dir:
            app = create_app(temp_dir)
            roads = os.path.join(temp_dir, 'roads')

            # A file is written - the plan's file, its map image, and its work directory's files
            for url, content in (
                ('/files/hill.json', b'{"title": "Hill"}'),
                ('/files/hill.png', b'\x89PNG'),
                ('/files/hill.work/ask/barn.png', b'\x89PNG'),
                ('/files/hill.work/descriptions.md', b'# Plan\n'),
                ('/files/hill.work/commands.txt', b'')
            ):
                status, headers, response = app.request('PUT', url, wsgi_input=content)
                self.assertEqual(status, '200 OK', url)
                self.assertListEqual(headers, [('Content-Type', 'text/plain; charset=utf-8')])
                self.assertEqual(response, b'OK')
                with open(os.path.join(roads, *url.split('/')[2:]), 'rb') as file_:
                    self.assertEqual(file_.read(), content)
            self.assertListEqual(sorted(os.listdir(roads)), ['hill.json', 'hill.png', 'hill.work'])
            self.assertListEqual(sorted(os.listdir(os.path.join(roads, 'hill.work'))), ['ask', 'commands.txt', 'descriptions.md'])

            # The application's own page writes files - its origin is the application's
            environ = {'HTTP_ORIGIN': 'http://127.0.0.1:8080', 'HTTP_HOST': '127.0.0.1:8080'}
            status, _, _ = app.request('PUT', '/files/hill.json', wsgi_input=b'{}', environ=environ)
            self.assertEqual(status, '200 OK')


    def test_put_file_new(self):
        # A new road's plan - its directory is made
        with create_test_files([('notes.txt', 'text')]) as temp_dir:
            app = create_app(temp_dir)
            status, _, _ = app.request('PUT', '/files/hill.json', wsgi_input=PLAN_TEXT.encode('utf-8'))
            self.assertEqual(status, '200 OK')
            self.assertListEqual(os.listdir(os.path.join(temp_dir, 'roads')), ['hill.json'])


    def test_put_file_invalid(self):
        with create_test_files([(('roads', 'hill.json'), PLAN_TEXT), (('roads', 'hill.png', 'file.txt'), 'text')]) as temp_dir:
            app = create_app(temp_dir)
            roads = os.path.join(temp_dir, 'roads')

            # Another site's page doesn't write files
            environ = {'HTTP_ORIGIN': 'http://example.com', 'HTTP_HOST': '127.0.0.1:8080'}
            status, _, _ = app.request('PUT', '/files/hill.json', wsgi_input=b'{}', environ=environ)
            self.assertEqual(status, '403 Forbidden')

            # A file that isn't the plan's, a work directory's file that isn't a plan's kind, a hidden file, a directory,
            # and a path that isn't within the plan's directory
            for url in (
                '/files/creek.json', '/files/map.png', '/files/creek.work/decisions.json', '/files/hill.work', '/files/hill.work/script.js',
                '/files/hill.work/.hidden.json', '/files/hill.png', '/files/%2E%2E/outside.json',
                '/files/hill.work/%2E%2E%2F%2E%2E%2Foutside.json'
            ):
                status, _, _ = app.request('PUT', url, wsgi_input=b'{}')
                self.assertEqual(status, '400 Bad Request', url)
            with open(os.path.join(roads, 'hill.json'), 'r', encoding='utf-8') as file_:
                self.assertEqual(file_.read(), PLAN_TEXT)
            self.assertListEqual(sorted(os.listdir(roads)), ['hill.json', 'hill.png'])
            self.assertListEqual(os.listdir(temp_dir), ['roads'])
