import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js가 없어 화면 테스트를 건너뜁니다.")
def test_game_guide_ui():
    script = Path(__file__).with_suffix('.js')
    result = subprocess.run([shutil.which('node'), str(script)], capture_output=True,
                            text=True, encoding='utf-8', errors='replace', timeout=20)
    assert result.returncode == 0, result.stdout + result.stderr
