"""Local development server. Games themselves remain static and buildless."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class Server(ThreadingHTTPServer):
    # Browsers preload many classic scripts; avoid the default short accept queue.
    request_queue_size = 128

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    with Server(('127.0.0.1', args.port), partial(SimpleHTTPRequestHandler, directory=str(root))) as server:
        print(f'Games: http://127.0.0.1:{server.server_port}/', flush=True)
        try: server.serve_forever()
        except KeyboardInterrupt: pass
