"""등록된 게임의 공개 화면 파일을 PC·휴대폰 페이지에 연결한다."""
import html
import re
from urllib.parse import quote

from fastapi.responses import HTMLResponse


def render_game_page(role, registry, games_dir, web_dir):
    if role not in ("host", "player"):
        raise ValueError(f"잘못된 화면 종류: {role}")
    assets = []
    for game_id, info in registry.items():
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", game_id):
            raise ValueError(f"잘못된 게임 ID: {game_id}")
        ui = info.get("ui", {})
        client_dir = games_dir / game_id / "client"
        base = "/game-assets/" + quote(game_id, safe="") + "/"

        def asset_url(filename, extension):
            if not isinstance(filename, str) or not re.fullmatch(r"[a-zA-Z0-9_.-]+", filename) or not filename.endswith(extension):
                raise ValueError(f"잘못된 게임 화면 파일: {game_id}/{filename}")
            if not (client_dir / filename).is_file():
                raise FileNotFoundError(f"게임 화면 파일 없음: {game_id}/{filename}")
            return html.escape(base + quote(filename, safe=""), quote=True)

        for filename in ui.get("styles", []):
            href = asset_url(filename, ".css")
            assets.append(f'<link rel="stylesheet" href="{href}">')
        entry = ui.get(role)
        if entry is not None:
            # 한 게임에서 PC와 휴대폰이 함께 쓰는 보조 스크립트는 설정에 명시한다.
            for filename in ui.get("scripts", []):
                src = asset_url(filename, ".js")
                assets.append(f'<script src="{src}"></script>')
            setup = entry.get("setup", "")
            if not isinstance(setup, str) or not re.fullmatch(r"[a-zA-Z_$][a-zA-Z0-9_$]*", setup):
                raise ValueError(f"잘못된 게임 화면 함수: {game_id}")
            src = asset_url(entry.get("script"), ".js")
            assets.append(f'<script src="{src}" data-game-ui="{html.escape(game_id, quote=True)}" data-game-setup="{html.escape(setup, quote=True)}"></script>')
    source = (web_dir / role / "index.html").read_text(encoding="utf-8-sig")
    if source.count("<!-- GAME_ASSETS -->") != 1:
        raise ValueError(f"게임 화면 위치 표시가 잘못되었습니다: {role}")
    return HTMLResponse(source.replace("<!-- GAME_ASSETS -->", "\n".join(assets)))
