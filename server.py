"""
server.py

Servidor local minimo (solo libreria estandar de Python, sin dependencias
nuevas) que:
  1. Sirve los archivos estaticos de la carpeta web/ (index.html, app.js, data.js)
  2. Expone endpoints que ejecutan los scripts de scraping de verdad, para
     que los botones "Ejecutar ahora" de la pagina web funcionen (en vez de
     solo armar el comando para copiar a mano).

IMPORTANTE: para usar los botones "Ejecutar ahora" hay que abrir la pagina
como http://localhost:8000 (con este servidor corriendo), no abriendo
index.html directo con doble-click.

Uso:
    python server.py
    -> dejar la ventana abierta, abrir http://localhost:8000 en el navegador

Endpoints:
    POST /api/scrape-ids    {"ids": ["629168", "629167"]}
    POST /api/scrape-range  {"start": 696007, "end": 696100, "category": "..."}
    POST /api/check-range   {"prefix": "OP16", "start": 1, "end": 119}
"""

import json
import http.server
import socketserver
from pathlib import Path

# Si tu script principal se llama distinto a "details.py", cambia esta linea
import details as scraper
import tcgplayer_db as db

WEB_DIR = Path(__file__).parent / "web"
PORT = 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw or b"{}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        try:
            if self.path == "/api/scrape-ids":
                data = self._read_json()
                ids = [str(i).strip() for i in data.get("ids", []) if str(i).strip()]
                if not ids:
                    return self._send_json(400, {"error": "Sin ids"})
                print(f"\n[server] Scrapeando ids: {ids}")
                results = scraper.main(ids)
                return self._send_json(200, {"ok": True, "count": len(ids)})

            elif self.path == "/api/scrape-range":
                data = self._read_json()
                start = int(data["start"])
                end = int(data["end"])
                category = (data.get("category") or "").strip() or None
                print(f"\n[server] Escaneando rango {start}-{end} (categoria: {category})")
                scraper.scan_range(start, end, category)
                return self._send_json(200, {"ok": True})

            elif self.path == "/api/check-range":
                data = self._read_json()
                prefix = data["prefix"]
                start = int(data["start"])
                end = int(data["end"])
                conn = db.init_db()
                missing = db.check_range(conn, prefix, start, end)
                return self._send_json(200, {"ok": True, "missing": missing})

            else:
                self._send_json(404, {"error": "Endpoint no encontrado"})

        except Exception as e:
            print(f"[server] Error: {e}")
            self._send_json(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        print(f"[server] {self.address_string()} - {fmt % args}")


def main():
    with socketserver.ThreadingTCPServer(("", PORT), Handler) as httpd:
        print(f"Servidor corriendo en http://localhost:{PORT}")
        print("Abri esa direccion en el navegador (no el archivo .html directo).")
        print("Deja esta ventana abierta mientras usas la pagina. Ctrl+C para detener.\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor detenido.")


if __name__ == "__main__":
    main()