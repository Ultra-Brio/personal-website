"""本地预览服务器：python serve.py [端口]
- 修正 Windows Python 对 .svg 的 MIME 误判
- 动态提供 /essays-manifest.json（与线上部署时的生成结果一致）
日常本地预览：python serve.py 8737 → http://localhost:8737
"""
import http.server
import json
import mimetypes
import re
import sys
from pathlib import Path

mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("text/markdown", ".md")

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8737
ROOT = Path(__file__).parent


def build_manifest():
    essays = []
    essays_dir = ROOT / "content" / "essays"
    if essays_dir.exists():
        files = sorted((p for p in essays_dir.glob("*.md")), key=lambda p: p.name, reverse=True)
        for p in files:
            text = p.read_text(encoding="utf-8")
            meta = {}
            m = re.match(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n?", text)
            if m:
                for line in m.group(1).splitlines():
                    kv = re.match(r"^([A-Za-z_]+):\s?(.*)$", line)
                    if kv:
                        meta[kv.group(1)] = kv.group(2).strip().strip("\"'")
            essays.append({
                "slug": p.stem,
                "title": meta.get("title", p.stem),
                "date": meta.get("date", p.stem[:10]),
                "tag": meta.get("tag", "随笔"),
                "excerpt": meta.get("excerpt", ""),
            })
    return {"essays": essays}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".svg": "image/svg+xml", ".md": "text/markdown"}

    def do_GET(self):
        if self.path.split("?")[0] == "/essays-manifest.json":
            data = json.dumps(build_manifest(), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def log_message(self, *args):
        pass


with http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler) as httpd:
    print(f"serving at http://localhost:{port}")
    httpd.serve_forever()
