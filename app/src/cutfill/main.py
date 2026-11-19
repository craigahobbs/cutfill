"""
The cutfill command-line script main module
"""

import argparse
import logging
import sys
import threading
import webbrowser

import waitress

from .app import Cutfill


def main(argv=None):
    """
    The cutfill command-line script main entry point
    """

    # Command line arguments
    argument_parser_args = {'prog': 'cutfill'}
    if sys.version_info >= (3, 14): # pragma: no cover
        argument_parser_args['color'] = False
    parser = argparse.ArgumentParser(**argument_parser_args)
    parser.add_argument('-p', metavar='N', dest='port', type=int, default=8080,
                        help='the application port (default is 8080)')
    parser.add_argument('-n', dest='browser', action='store_false', default=True,
                        help="don't open a web browser")
    parser.add_argument('-q', dest='quiet', action='store_true',
                        help="don't display messages - the requests that fail, say")
    args = parser.parse_args(args=argv)

    # Create the back-end application
    application = Cutfill()

    # Wrap the back end to log the requests that fail - an error status
    def application_wrap(environ, start_response):
        def log_start_response(status, response_headers):
            if not args.quiet and int(status[0:3]) >= 400:
                print(f'cutfill: {status[0:3]} {environ["REQUEST_METHOD"]} {environ["PATH_INFO"]} {environ["QUERY_STRING"]}')
            return start_response(status, response_headers)
        return application(environ, log_start_response)

    # Create the server - to this computer only. It binds its port, so a port that's in use is an error before the web
    # browser is opened. The server's queue warnings aren't shown - the application's page loads its modules at once,
    # so its requests wait for the server's threads.
    host = '127.0.0.1'
    url = f'http://{host}:{args.port}/'
    logging.getLogger('waitress.queue').setLevel(logging.ERROR)
    try:
        server = waitress.create_server(application_wrap, host=host, port=args.port)
    except OSError as exc:
        parser.exit(1, f'cutfill: Could not serve at {url} - {exc.strerror} (another port is the "-p" argument)\n')

    # Launch the web browser on a thread (it may block)
    if args.browser:
        webbrowser_thread = threading.Thread(target=webbrowser.open, args=(url,))
        webbrowser_thread.daemon = True
        webbrowser_thread.start()

    # Serve the application
    if not args.quiet:
        print(f'cutfill: Serving at {url} ...')
    server.run()
