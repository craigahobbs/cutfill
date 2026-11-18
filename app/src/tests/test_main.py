from io import StringIO
import os
import unittest
import unittest.mock

from roadie.__main__ import main as main_main
from roadie.main import main

from .util import create_test_files


class TestMain(unittest.TestCase):

    def test_main_submodule(self):
        self.assertIs(main_main, main)


    def test_main_help(self):
        with unittest.mock.patch('sys.stdout', StringIO()) as stdout, \
             unittest.mock.patch('sys.stderr', StringIO()) as stderr:
            with self.assertRaises(SystemExit) as cm_exc:
                main(['-h'])
            self.assertEqual(cm_exc.exception.code, 0)
            self.assertTrue(stdout.getvalue().startswith('usage: roadie [-h] [-p N] [-n] [-q] [directory]'))
            self.assertEqual(stderr.getvalue(), '')


    def test_main(self):
        with create_test_files([('hill.json', '{"topography": {}}')]) as temp_dir, \
             unittest.mock.patch('threading.Thread') as mock_thread, \
             unittest.mock.patch('webbrowser.open') as mock_open, \
             unittest.mock.patch('waitress.serve') as mock_serve, \
             unittest.mock.patch('sys.stdout', StringIO()) as stdout, \
             unittest.mock.patch('sys.stderr', StringIO()) as stderr:
            main([temp_dir])

            # The web browser is opened on a thread
            mock_thread.assert_called_once_with(target=mock_open, args=('http://127.0.0.1:8080/',))
            thread_instance = mock_thread.return_value
            self.assertTrue(thread_instance.daemon)
            thread_instance.start.assert_called_once_with()

            # The application is served to this computer only
            mock_serve.assert_called_once()
            serve_args, serve_kwargs = mock_serve.call_args
            application_wrap = serve_args[0]
            self.assertDictEqual(serve_kwargs, {'host': '127.0.0.1', 'port': 8080})
            self.assertEqual(stdout.getvalue(), f'roadie: Serving "{temp_dir}" at http://127.0.0.1:8080/ ...\n')

            # A request is logged
            statuses = []
            environ = {'REQUEST_METHOD': 'GET', 'PATH_INFO': '/getRoads', 'QUERY_STRING': '', 'wsgi.url_scheme': 'http'}
            response = application_wrap(environ, lambda status, headers: statuses.append(status))
            self.assertListEqual(statuses, ['200 OK'])
            self.assertIn(b'"hill.json"', b''.join(response))
            self.assertTrue(stdout.getvalue().endswith('roadie: 200 GET /getRoads \n'))
            self.assertEqual(stderr.getvalue(), '')


    def test_main_options(self):
        # Another port, no web browser, and no logging - the directory is the current directory
        with unittest.mock.patch('threading.Thread') as mock_thread, \
             unittest.mock.patch('waitress.serve') as mock_serve, \
             unittest.mock.patch('sys.stdout', StringIO()) as stdout, \
             unittest.mock.patch('sys.stderr', StringIO()) as stderr:
            main(['-p', '9000', '-n', '-q'])
            mock_thread.assert_not_called()
            serve_args, serve_kwargs = mock_serve.call_args
            self.assertDictEqual(serve_kwargs, {'host': '127.0.0.1', 'port': 9000})

            # A request isn't logged
            environ = {'REQUEST_METHOD': 'GET', 'PATH_INFO': '/unknown', 'QUERY_STRING': '', 'wsgi.url_scheme': 'http'}
            statuses = []
            serve_args[0](environ, lambda status, headers: statuses.append(status))
            self.assertListEqual(statuses, ['404 Not Found'])
            self.assertEqual(stdout.getvalue(), '')
            self.assertEqual(stderr.getvalue(), '')


    def test_main_directory_missing(self):
        with create_test_files([('hill.json', '{}')]) as temp_dir, \
             unittest.mock.patch('waitress.serve') as mock_serve, \
             unittest.mock.patch('sys.stdout', StringIO()) as stdout, \
             unittest.mock.patch('sys.stderr', StringIO()) as stderr:
            missing = os.path.join(temp_dir, 'missing')
            with self.assertRaises(SystemExit) as cm_exc:
                main([missing])
            self.assertEqual(cm_exc.exception.code, 2)
            mock_serve.assert_not_called()
            self.assertEqual(stdout.getvalue(), '')
            self.assertTrue(stderr.getvalue().endswith(f'roadie: error: "{missing}" is not a directory\n'))
