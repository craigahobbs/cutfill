"""
The roadie command-line script main module
"""

import argparse
import os
import sys
import threading
import webbrowser

import waitress

from .app import Roadie


def main(argv=None):
    """
    The roadie command-line script main entry point
    """

    # Command line arguments
    argument_parser_args = {'prog': 'roadie'}
    if sys.version_info >= (3, 14): # pragma: no cover
        argument_parser_args['color'] = False
    parser = argparse.ArgumentParser(**argument_parser_args)
    parser.add_argument('directory', nargs='?', default='.',
                        help='the directory of the road site and road plan files (default is the current directory)')
    parser.add_argument('-p', metavar='N', dest='port', type=int, default=8080,
                        help='the application port (default is 8080)')
    parser.add_argument('-n', dest='browser', action='store_false', default=True,
                        help="don't open a web browser")
    parser.add_argument('-q', dest='quiet', action='store_true',
                        help="don't display access logging")
    args = parser.parse_args(args=argv)
    if not os.path.isdir(args.directory):
        parser.error(f'"{args.directory}" is not a directory')

    # Create the back-end application
    application = Roadie(args.directory)

    # Launch the web browser on a thread (it may block)
    host = '127.0.0.1'
    url = f'http://{host}:{args.port}/'
    if args.browser:
        webbrowser_thread = threading.Thread(target=webbrowser.open, args=(url,))
        webbrowser_thread.daemon = True
        webbrowser_thread.start()

    # Wrap the back end to log each request's status
    def application_wrap(environ, start_response):
        def log_start_response(status, response_headers):
            if not args.quiet:
                print(f'roadie: {status[0:3]} {environ["REQUEST_METHOD"]} {environ["PATH_INFO"]} {environ["QUERY_STRING"]}')
            return start_response(status, response_headers)
        return application(environ, log_start_response)

    # Serve the application - to this computer only: the back end writes the directory's files
    if not args.quiet:
        print(f'roadie: Serving "{application.root}" at {url} ...')
    waitress.serve(application_wrap, host=host, port=args.port)
