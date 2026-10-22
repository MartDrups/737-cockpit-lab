"""Run browser checks against the exact gzip delivery under the Pages subpath."""
import argparse
import atexit
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import tempfile
import threading


def configure():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', choices=['chromium','webkit'], default='chromium')
    parser.add_argument('--url', help='Optional deployed app URL; otherwise serve public/ locally.')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    out = args.output or Path(tempfile.mkdtemp(prefix='737-system-reading-'))
    out.mkdir(parents=True, exist_ok=True)
    if args.url:
        url = args.url.rstrip('/')+'/'
    else:
        public = Path(__file__).resolve().parents[1]/'public'
        class Handler(SimpleHTTPRequestHandler):
            def __init__(self, *a, **kw):
                super().__init__(*a, directory=str(public), **kw)
            def do_GET(self):
                if not self.path.startswith('/737-cockpit-lab/'):
                    self.send_error(404)
                    return
                self.path = self.path.removeprefix('/737-cockpit-lab')
                super().do_GET()
            def log_message(self, *a):
                pass
        server = ThreadingHTTPServer(('127.0.0.1',0),Handler)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        atexit.register(server.server_close)
        atexit.register(server.shutdown)
        url=f'http://127.0.0.1:{server.server_port}/737-cockpit-lab/'
    return args, url, out


def launch(playwright, browser, remote=False):
    options = {}
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
    if remote and proxy:
        options['proxy'] = {'server':proxy,'bypass':'127.0.0.1,localhost'}
    if browser == 'webkit':
        return playwright.webkit.launch(headless=True, **options)
    return playwright.chromium.launch(executable_path=shutil.which('chromium') or None,
                                      args=['--no-sandbox'], **options)
