"""Node.js가 있으면 점수 화면의 애니메이션과 상태 전환도 검사한다."""
import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js가 없어 화면 테스트를 건너뜁니다.")
@pytest.mark.parametrize("filename", ["test_scoreboard_ui.js", "test_scoreboard_lobby.js"])
def test_scoreboard_ui(filename):
    script = Path(__file__).resolve().parent / filename
    result = subprocess.run([shutil.which("node"), str(script)], capture_output=True,
                            text=True, encoding="utf-8", errors="replace", timeout=20)
    assert result.returncode == 0, result.stdout + result.stderr
