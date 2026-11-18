import os
import re
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
        # The package's front end is its "static" directory's files - the page, and every file it loads
        app = Roadie()
        urls = {url for request in app.requests.values() if request.doc_group == 'Statics' for _, url in request.urls}
        status, headers, content = app.request('GET', '/')
        self.assertEqual(status, '200 OK')
        self.assertEqual(dict(headers)['Content-Type'], 'text/html; charset=utf-8')
        page = content.decode('utf-8')
        loads = re.findall(r'(?:href|src)="([^"]+)"', page)
        imports = re.findall(r'"(\./[^"]+\.js)"', page)
        self.assertIn('lib/app.js', loads)
        self.assertIn('./plan/lib/browser/util.js', imports)
        loaded = [url for url in loads + imports if not url.startswith('data:')]
        self.assertListEqual([url for url in loaded if f'/{url.removeprefix("./")}' not in urls], [])

        # The planning tools, the schema-markdown package, and the GeoTIFF reader (and its license)
        for url in ('/plan/lib/browser/io.js', '/plan/lib/auto.js', '/schema-markdown/lib/schema.js', '/geotiff.js',
                    '/geotiff.LICENSE.txt'):
            self.assertIn(url, urls)


    def test_statics_offline(self):
        # The front end loads nothing from the internet but the USGS's services (a site's data) - its other web addresses
        # are Ollama's (on this computer), and text: XML namespaces, and license and documentation links
        allowed = (
            'https://tnmaccess.nationalmap.gov/', 'https://hydro.nationalmap.gov/', 'https://carto.nationalmap.gov/',
            'https://basemap.nationalmap.gov/', 'http://127.0.0.1:11434', 'http://${', 'http://www.w3.org/2000/svg',
            'https://github.com/craigahobbs/', 'https://craigahobbs.github.io/', 'https://github.com/geotiffjs/',
            'https://github.com/nodeca/pako', 'http://www.apache.org/licenses/'
        )
        app = Roadie()
        found = set()
        for request in app.requests.values():
            if request.doc_group == 'Statics' and request.urls[0][1].endswith(('.html', '.css', '.js')):
                _, _, content = app.request('GET', request.urls[0][1])
                found.update(re.findall(r'https?://[^\s\'"`)<>]*', content.decode('utf-8')))
        self.assertGreater(len(found), 10)
        self.assertListEqual(sorted(url for url in found if not url.startswith(allowed)), [])


    def test_statics_missing(self):
        # A front end directory that isn't there has no files
        with create_test_files([(('static', 'index.html'), b'<!DOCTYPE html>')]) as temp_dir:
            app = Roadie(os.path.join(temp_dir, 'missing'))
            self.assertListEqual([request.name for request in app.requests.values() if request.doc_group == 'Statics'], [])
