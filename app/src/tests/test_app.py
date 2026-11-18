import os
import unittest

from roadie.app import Roadie

from .util import create_test_files


# The front end's files
STATIC_FILES = [
    (('static', 'index.html'), '<!DOCTYPE html>'),
    (('static', 'app.css'), 'body {}'),
    (('static', 'lib', 'app.js'), 'export const app = 1;'),
    (('static', 'schema-markdown', 'lib', 'parser.js'), 'export const parser = 1;')
]


class TestApp(unittest.TestCase):

    def test_init(self):
        with create_test_files(STATIC_FILES) as temp_dir:
            app = Roadie(os.path.join(temp_dir, 'static'))
            self.assertListEqual(
                sorted(request.name for request in app.requests.values() if request.doc_group == 'Statics'),
                ['app.css', 'index.html', 'lib/app.js', 'schema-markdown/lib/parser.js']
            )
            self.assertIn('/doc/', [url for request in app.requests.values() for _, url in request.urls])


    def test_statics(self):
        with create_test_files(STATIC_FILES) as temp_dir:
            app = Roadie(os.path.join(temp_dir, 'static'))

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
        app = Roadie()
        statics = [request for request in app.requests.values() if request.doc_group == 'Statics']
        self.assertTrue(all(request.urls[0][1].startswith('/') for request in statics))


    def test_statics_missing(self):
        # A front end directory that isn't there has no files
        with create_test_files([(('static', 'index.html'), b'<!DOCTYPE html>')]) as temp_dir:
            app = Roadie(os.path.join(temp_dir, 'missing'))
            self.assertListEqual([request.name for request in app.requests.values() if request.doc_group == 'Statics'], [])
