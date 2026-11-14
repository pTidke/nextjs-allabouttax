"""Loopback-only lab service. The app/production database is never used."""

import json
import sqlite3
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from .review_store import Conflict, ReviewStore

MAX_BODY = 5 * 1024**2


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, store, **kwargs):
        self.store = store
        super().__init__(*args, directory=str(store.root), **kwargs)

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *args):
        pass  # No request paths, document text or draft bodies in logs.

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def respond(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def allowed(self, write=False):
        expected = f"127.0.0.1:{self.server.server_port}"
        origin = self.headers.get("Origin")
        return (
            self.headers.get("Host") == expected
            and (origin is None or origin == f"http://{expected}")
            and self.headers.get("Sec-Fetch-Site", "same-origin") not in {"cross-site", "same-site"}
            and (
                not write
                or (origin == f"http://{expected}" and self.headers.get("X-Lab-Review") == "1")
            )
        )

    def do_GET(self):
        if not self.allowed():
            return self.respond(403, {"error": "LOCAL_ORIGIN_REQUIRED"})
        url = urlsplit(self.path)
        if url.path == "/api/reviews/capabilities":
            return self.respond(
                200,
                {
                    "api_version": 1,
                    "scope": "local_unaccepted_review",
                    "publication_eligible": False,
                },
            )
        if url.path == "/api/reviews":
            try:
                query = parse_qs(url.query, strict_parsing=True)
                history = self.store.history(query["key"][0])
                revision_id = query.get("revision", [None])[0]
                if revision_id:
                    revision = next(
                        (r for r in history["revisions"] if r["id"] == revision_id), None
                    )
                    if not revision:
                        return self.respond(404, {"error": "REVISION_NOT_FOUND"})
                    self.store.validate(revision["payload"])
                    return self.respond(
                        200,
                        {
                            "revision": revision,
                            "head_revision": history["head_revision"],
                            "publication_eligible": False,
                        },
                    )
                rows = [
                    {k: r[k] for k in ("id", "parent_id", "created_at", "strict_valid")}
                    | {
                        "state": r["payload"]["state"],
                        "reviewer_label": (r["payload"].get("draft") or r["payload"]).get(
                            "reviewer_name", ""
                        ),
                    }
                    for r in history["revisions"][:50]
                ]
                return self.respond(
                    200,
                    {
                        "head_revision": history["head_revision"],
                        "revisions": rows,
                        "total_revisions": len(history["revisions"]),
                        "publication_eligible": False,
                    },
                )
            except sqlite3.Error:
                return self.respond(503, {"error": "HISTORY_STORE_UNAVAILABLE"})
            except (ValueError, KeyError, OSError):
                return self.respond(400, {"error": "HISTORY_VALIDATION_FAILED"})
        if url.path.startswith("/api/"):
            return self.respond(404, {"error": "UNKNOWN_LAB_ROUTE"})
        path = Path(unquote(url.path).lstrip("/"))
        target = self.store.root / path
        served = target / "index.html" if target.is_dir() else target
        if (
            any(p.startswith(".") or p == ".." for p in path.parts)
            or not target.resolve().is_relative_to(self.store.root)
            or not served.resolve().is_relative_to(self.store.root)
            or (target.is_dir() and not (target / "index.html").is_file())
            or (
                target.is_file()
                and target.suffix not in {".html", ".css", ".js", ".mjs", ".json", ".png", ".pdf"}
            )
        ):
            return self.respond(404, {"error": "FILE_NOT_AVAILABLE"})
        super().do_GET()

    def do_HEAD(self):
        # Avoid bypassing origin/path guards through inherited static handling.
        self.respond(405, {"error": "METHOD_NOT_ALLOWED"})

    def do_POST(self):
        if not self.allowed(write=True):
            return self.respond(403, {"error": "LOCAL_ORIGIN_REQUIRED"})
        if (
            self.path != "/api/reviews"
            or self.headers.get("Content-Type", "").split(";")[0] != "application/json"
        ):
            return self.respond(400, {"error": "JSON_REVIEW_REQUIRED"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BODY or self.headers.get("Transfer-Encoding"):
                return self.respond(413, {"error": "REVIEW_BYTE_LIMIT"})
            data = self.rfile.read(size)
            if len(data) != size:
                raise ValueError("Incomplete body")
            body = json.loads(data)
            if not isinstance(body, dict) or set(body) != {"payload", "parent_id", "request_id"}:
                raise ValueError("Invalid save command")
            result = self.store.save(body["payload"], body["parent_id"], body["request_id"])
            return self.respond(201, result)
        except sqlite3.Error:
            return self.respond(503, {"error": "HISTORY_STORE_UNAVAILABLE"})
        except Conflict:
            return self.respond(
                409,
                {
                    "error": "REVIEW_CONFLICT",
                    "message": "A newer review or different retry exists. Load the latest saved review before saving.",
                },
            )
        except (ValueError, KeyError, OSError):
            return self.respond(400, {"error": "REVIEW_VALIDATION_FAILED"})


def make_server(root, store_file, port=8788):
    if not 0 <= port <= 65535:
        raise ValueError("Invalid local port")
    store = ReviewStore(store_file, root)
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, store=store))
    server.daemon_threads = True
    return server
