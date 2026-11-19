import json
import os
import posixpath
import re
import unittest
import unittest.mock

from sageroad.app import SageRoad

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
            app = SageRoad(os.path.join(temp_dir, 'static'))
            self.assertListEqual(
                sorted(request.name for request in app.requests.values() if request.doc_group == 'Statics'),
                ['app.css', 'index.html', 'lib/app.js', 'schema-markdown/lib/parser.js']
            )
            self.assertIn('/doc/', [url for request in app.requests.values() for _, url in request.urls])


    def test_statics(self):
        with create_test_files(STATIC_FILES) as temp_dir:
            app = SageRoad(os.path.join(temp_dir, 'static'))

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
        app = SageRoad()
        urls = {url for request in app.requests.values() if request.doc_group == 'Statics' for _, url in request.urls}
        status, headers, content = app.request('GET', '/')
        self.assertEqual(status, '200 OK')
        self.assertEqual(dict(headers)['Content-Type'], 'text/html; charset=utf-8')
        page = content.decode('utf-8')
        loads = re.findall(r'(?:href|src)="([^"]+)"', page)
        imports = re.findall(r'"(\./[^"]+\.js)"', page)
        self.assertIn('lib/app.js', loads)
        self.assertIn('./plan/lib/browser/buffer.js', imports)
        loaded = [url for url in loads + imports if not url.startswith('data:')]
        self.assertListEqual([url for url in loaded if f'/{url.removeprefix("./")}' not in urls], [])

        # The planning tools, and the schema-markdown package
        for url in ('/plan/lib/browser/io.js', '/plan/lib/auto.js', '/schema-markdown/lib/schema.js'):
            self.assertIn(url, urls)


    def test_statics_modules(self):
        # Every module the front end imports is the package's, and every module of the package is imported - from the
        # page's module, by its import map (the planning tools' Node modules, and their imports of the viewer's)
        app = SageRoad()
        urls = {url for request in app.requests.values() if request.doc_group == 'Statics' for _, url in request.urls}
        page = app.request('GET', '/')[2].decode('utf-8')
        import_map = json.loads(re.search(r'<script type="importmap">(.*?)</script>', page, re.DOTALL).group(1))['imports']
        url_map = {posixpath.normpath(posixpath.join('/', key)) + ('/' if key.endswith('/') else ''): value
                   for key, value in import_map.items() if key.startswith('.')}

        def resolve(base, specifier):
            for prefix, target in import_map.items():
                if not prefix.startswith('.') and (specifier == prefix or (prefix.endswith('/') and specifier.startswith(prefix))):
                    return posixpath.normpath(posixpath.join('/', target + specifier[len(prefix):]))
            url = posixpath.normpath(posixpath.join(posixpath.dirname(base), specifier))
            for prefix, target in url_map.items():
                if url.startswith(prefix):
                    return posixpath.normpath(posixpath.join('/', target + url[len(prefix):]))
            return url

        modules = set()
        missing = set()
        pending = [resolve('/index.html', specifier) for specifier in re.findall(r"from '([^']+)'", page)]
        self.assertListEqual(pending, ['/lib/app.js'])
        while pending:
            url = pending.pop()
            if url in urls and url not in modules:
                modules.add(url)
                text = app.request('GET', url)[2].decode('utf-8')
                pending.extend(resolve(url, specifier) for specifier in re.findall(r"(?:from |import\()'([^']+)'", text))
            missing.update({url} - urls)
        self.assertSetEqual(missing, set())
        self.assertIn('/plan/lib/browser/zlib.js', modules)

        # The package has no other scripts
        self.assertSetEqual({url for url in urls if url.endswith('.js')} - modules, set())


    def test_statics_offline(self):
        # The front end loads nothing from the internet but the USGS's services (a site's data) and the list of Ollama's
        # models to download (Ollama Chat's, on craigahobbs.github.io) - its other web addresses are Ollama's (on this
        # computer), and text: XML namespaces, and documentation and Ollama's library's links
        allowed = (
            'https://tnmaccess.nationalmap.gov/', 'https://hydro.nationalmap.gov/', 'https://carto.nationalmap.gov/',
            'https://basemap.nationalmap.gov/', 'http://127.0.0.1:11434', 'http://${', 'http://www.w3.org/2000/svg',
            'https://github.com/craigahobbs/', 'https://craigahobbs.github.io/', 'https://ollama.com/'
        )
        app = SageRoad()
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
            app = SageRoad(os.path.join(temp_dir, 'missing'))
            self.assertListEqual([request.name for request in app.requests.values() if request.doc_group == 'Statics'], [])


    def test_get_system_info(self):
        # This computer's memory, and whether it runs MLX models
        app = SageRoad()
        status, headers, content = app.request('GET', '/getSystemInfo')
        self.assertEqual(status, '200 OK')
        self.assertListEqual(headers, [('Content-Type', 'application/json')])
        response = json.loads(content.decode('utf-8'))
        self.assertListEqual(sorted(response), ['memory', 'mlx'])
        self.assertGreater(response['memory'], 0)
        self.assertIsInstance(response['mlx'], bool)


    def test_get_system_info_platforms(self):
        app = SageRoad()

        # A Mac with Apple silicon - its memory is its pages'
        with unittest.mock.patch('platform.system', return_value='Darwin'), \
                unittest.mock.patch('platform.machine', return_value='arm64'), \
                unittest.mock.patch('os.sysconf', return_value=65536, create=True):
            _, _, content = app.request('GET', '/getSystemInfo')
        self.assertDictEqual(json.loads(content.decode('utf-8')), {'memory': 65536 * 65536, 'mlx': True})

        # A Mac with an Intel processor, whose memory can't be determined
        with unittest.mock.patch('platform.system', return_value='Darwin'), \
                unittest.mock.patch('platform.machine', return_value='x86_64'), \
                unittest.mock.patch('os.sysconf', return_value=-1, create=True):
            _, _, content = app.request('GET', '/getSystemInfo')
        self.assertDictEqual(json.loads(content.decode('utf-8')), {'memory': -1, 'mlx': False})

        # Linux, with a page size that can't be determined
        with unittest.mock.patch('platform.system', return_value='Linux'), \
                unittest.mock.patch('os.sysconf', side_effect=lambda name: 1000 if name == 'SC_PHYS_PAGES' else -1, create=True):
            _, _, content = app.request('GET', '/getSystemInfo')
        self.assertDictEqual(json.loads(content.decode('utf-8')), {'memory': -1, 'mlx': False})

        # Windows - its memory is its memory status's
        def memory_status(status_ref):
            status_ref._obj.ullTotalPhys = 17179869184 # pylint: disable=protected-access
        windll = unittest.mock.Mock()
        windll.kernel32.GlobalMemoryStatusEx.side_effect = memory_status
        with unittest.mock.patch('platform.system', return_value='Windows'), \
                unittest.mock.patch('ctypes.windll', windll, create=True):
            _, _, content = app.request('GET', '/getSystemInfo')
        self.assertDictEqual(json.loads(content.decode('utf-8')), {'memory': 17179869184, 'mlx': False})
