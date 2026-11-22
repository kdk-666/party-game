"""브라우저 화면 코드의 기본 JavaScript 문법을 확인한다."""
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="Node.js가 없어 JavaScript 문법 검사를 건너뜁니다.")


def assert_valid_javascript(source, label):
    result = subprocess.run(
        [NODE, "--check", "-"], input=source, text=True,
        encoding="utf-8", errors="replace", capture_output=True, timeout=10,
    )
    assert result.returncode == 0, f"{label}:\n{result.stderr}"


@pytest.mark.parametrize("path", [
    "web/game-router.js",
    "games/red_light/client/host.js",
    "games/red_light/client/player.js",
    "games/color_hunt/client/colorhunt.js",
])
def test_game_script_syntax(path):
    source = (ROOT / path).read_text(encoding="utf-8-sig")
    assert_valid_javascript(source, path)


@pytest.mark.parametrize("role", ["host", "player"])
def test_inline_script_syntax(role):
    path = ROOT / "web" / role / "index.html"
    source = path.read_text(encoding="utf-8-sig")
    scripts = re.findall(r"<script\s*>(.*?)</script\s*>", source, flags=re.I | re.S)
    assert scripts, f"인라인 스크립트를 찾지 못했습니다: {path}"
    for number, script in enumerate(scripts, start=1):
        assert_valid_javascript(script, f"{role} 인라인 스크립트 {number}")
