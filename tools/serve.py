"""player/ を配るだけの小さなサーバー（書き出し・確認の道具が使う。手で開くときは `python tools/serve.py` → http://127.0.0.1:8765/）。
python tools/serve.py [--port 8765] [--dir player]
"""
import sys, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()


def start(directory, port=0):
    """バックグラウンドで配り始めて (server, url) を返す。port=0 で空いている番号を使う"""
    handler = functools.partial(Quiet, directory=str(directory))
    srv = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


if __name__ == "__main__":
    a = sys.argv[1:]
    port = int(a[a.index("--port") + 1]) if "--port" in a else 8765
    d = Path(a[a.index("--dir") + 1]) if "--dir" in a else ROOT / "player"
    srv, url = start(d, port)
    print(f"{url}/  （{d}）  Ctrl+C で止める")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        srv.shutdown()
