from io import StringIO
import logging
import unittest
import unittest.mock

from roadie.__main__ import main as main_main
from roadie.main import main


class TestMain(unittest.TestCase):

    def test_main_submodule(self):
        self.assertIs(main_main, main)


    def test_main_help(self):
        with unittest.mock.patch('sys.stdout', StringIO()) as stdout, \
             unittest.mock.patch('sys.stderr', StringIO()) as stderr:
            with self.assertRaises(SystemExit) as cm_exc:
                main(['-h'])
            self.assertEqual(cm_exc.exception.code, 0)
            self.assertTrue(stdout.getvalue().startswith('usage: roadie [-h] [-p N] [-n] [-q]\n'))
            self.assertEqual(stderr.getvalue(), '')


    def test_main(self):
        with unittest.mock.patch('threading.Thread') as mock_thread, \
             unittest.mock.patch('webbrowser.open') as mock_open, \
             unittest.mock.patch('waitress.create_server') as mock_serve, \
             unittest.mock.patch('sys.stdout', StringIO()) as stdout, \
             unittest.mock.patch('sys.stderr', StringIO()) as stderr:
            main([])

            # The web browser is opened on a thread
            mock_thread.assert_called_once_with(target=mock_open, args=('http://127.0.0.1:8080/',))
            thread_instance = mock_thread.return_value
            self.assertTrue(thread_instance.daemon)
            thread_instance.start.assert_called_once_with()

            # The application is served to this computer only
            mock_serve.assert_called_once()
            mock_serve.return_value.run.assert_called_once_with()
            serve_args, serve_kwargs = mock_serve.call_args
            application_wrap = serve_args[0]
            self.assertDictEqual(serve_kwargs, {'host': '127.0.0.1', 'port': 8080})
            self.assertEqual(stdout.getvalue(), 'roadie: Serving at http://127.0.0.1:8080/ ...\n')
            self.assertEqual(logging.getLogger('waitress.queue').level, logging.ERROR)

            # A request that succeeds isn't logged
            statuses = []
            environ = {'REQUEST_METHOD': 'GET', 'PATH_INFO': '/doc/', 'QUERY_STRING': '', 'wsgi.url_scheme': 'http'}
            response = application_wrap(environ, lambda status, headers: statuses.append(status))
            self.assertListEqual(statuses, ['200 OK'])
            self.assertIn(b'<html', b''.join(response))
            self.assertEqual(stdout.getvalue(), 'roadie: Serving at http://127.0.0.1:8080/ ...\n')

            # A request that fails is logged
            environ = {'REQUEST_METHOD': 'GET', 'PATH_INFO': '/unknown', 'QUERY_STRING': 'a=1', 'wsgi.url_scheme': 'http'}
            application_wrap(environ, lambda status, headers: statuses.append(status))
            self.assertListEqual(statuses, ['200 OK', '404 Not Found'])
            self.assertEqual(stdout.getvalue(), 'roadie: Serving at http://127.0.0.1:8080/ ...\nroadie: 404 GET /unknown a=1\n')
            self.assertEqual(stderr.getvalue(), '')


    def test_main_options(self):
        # Another port, no web browser, and no logging
        with unittest.mock.patch('threading.Thread') as mock_thread, \
             unittest.mock.patch('waitress.create_server') as mock_serve, \
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


    def test_main_port_in_use(self):
        # The port is in use - it's an error, and the web browser isn't opened
        with unittest.mock.patch('threading.Thread') as mock_thread, \
             unittest.mock.patch('waitress.create_server', side_effect=OSError(48, 'Address already in use')), \
             unittest.mock.patch('sys.stdout', StringIO()) as stdout, \
             unittest.mock.patch('sys.stderr', StringIO()) as stderr:
            with self.assertRaises(SystemExit) as cm_exc:
                main(['-p', '9000'])
            self.assertEqual(cm_exc.exception.code, 1)
            mock_thread.assert_not_called()
            self.assertEqual(stdout.getvalue(), '')
            self.assertEqual(
                stderr.getvalue(),
                'roadie: Could not serve at http://127.0.0.1:9000/ - Address already in use (another port is the "-p" argument)\n'
            )
