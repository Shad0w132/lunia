#!/usr/bin/env python3
"""Simple local HTTP server to preview Lunia iOS PWA on Windows or local Wi-Fi."""
import http.server
import socket
import socketserver

PORT = 8080

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".webmanifest": "application/manifest+json; charset=utf-8",
        ".svg": "image/svg+xml",
    }

def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

if __name__ == "__main__":
    with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
        ip = get_lan_ip()
        print(f"Lunia iOS PWA running at:")
        print(f"  Local PC: http://localhost:{PORT}")
        print(f"  iPhone (same Wi-Fi): http://{ip}:{PORT}")
        print("Press Ctrl+C to stop.")
        httpd.serve_forever()
