import asyncio

import pytest
from fastapi import HTTPException

from server.main import PublicStaticFiles


def test_public_file_is_available(tmp_path):
    (tmp_path / "game.js").write_text("console.log('ok');", encoding="utf-8")
    files = PublicStaticFiles(directory=tmp_path)
    response = asyncio.run(files.get_response("game.js", {"method": "GET", "headers": []}))
    assert response.status_code == 200


@pytest.mark.parametrize("path", [
    ".idea/workspace.xml",
    "nested/.idea/workspace.xml",
    ".env",
    "nested\\.idea\\workspace.xml",
])
def test_hidden_paths_are_blocked(tmp_path, path):
    hidden_file = tmp_path / path.replace("\\", "/")
    hidden_file.parent.mkdir(parents=True, exist_ok=True)
    hidden_file.write_text("private test data", encoding="utf-8")
    files = PublicStaticFiles(directory=tmp_path)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(files.get_response(path, {"method": "GET", "headers": []}))
    assert exc.value.status_code == 404
