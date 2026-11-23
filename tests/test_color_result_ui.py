"""결과 화면에서 우승자 없음과 미제출자를 표시하는지 확인한다."""
import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js가 없어 결과 화면 검사를 건너뜁니다.")
def test_color_result_ui():
    script = Path(__file__).resolve().parent / "test_color_result_ui.js"
    result = subprocess.run(
        [shutil.which("node"), str(script)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20,
    )
    assert result.returncode == 0, result.stdout + result.stderr
