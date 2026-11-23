from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.main import PublicStaticFiles


def make_client(tmp_path):
    (tmp_path / "a.js").write_text("console.log(1)")
    app = FastAPI()
    app.mount("/static", PublicStaticFiles(directory=tmp_path), name="static")
    return TestClient(app)


def test_static_files_are_always_revalidated(tmp_path):
    r = make_client(tmp_path).get("/static/a.js")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-cache"


def test_unchanged_file_is_answered_with_304(tmp_path):
    c = make_client(tmp_path)
    etag = c.get("/static/a.js").headers["etag"]
    r = c.get("/static/a.js", headers={"If-None-Match": etag})
    assert r.status_code == 304 and r.headers["cache-control"] == "no-cache"
