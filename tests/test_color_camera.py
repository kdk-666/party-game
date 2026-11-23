"""브라우저의 카메라 권한 지연과 정리 흐름을 Node.js로 검사한다."""
import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js가 없어 카메라 흐름 검사를 건너뜁니다.")
def test_color_camera_lifecycle():
    script = Path(__file__).resolve().parent / "test_camera_flow.js"
    result = subprocess.run(
        [shutil.which("node"), str(script)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20,
    )
    assert result.returncode == 0, result.stdout + result.stderr
