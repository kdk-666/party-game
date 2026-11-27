from games.tilt_ball.game import TiltBall
from games.tilt_ball.maze import MAZES

GAME_ID = "tilt_ball"

GAME_INFO = {
    "name": "기울여서 공 굴리기",
    "instructions": [
        "휴대폰을 기울여 공을 굴려서 미로를 지나 GOAL까지 가요.",
        "구멍에 빠지면 가장 가까운 체크포인트(깃발)에서 다시 시작해요.",
        "가장 먼저 도착하면 우승! 못 도착해도 가장 멀리 간 순서로 점수를 받아요.",
    ],
    "guide": {
        "requires_hook": True,
        "rules": [
            {"icon": "📱", "title": "움직이기", "text": "휴대폰을 기울여 공을 굴려요."},
            {"icon": "🕳️", "title": "구멍", "text": "빠지면 저장된 깃발에서 다시 시작해요."},
            {"icon": "🚩", "title": "깃발", "text": "밟으면 노란색! 체크포인트가 저장돼요."},
            {"icon": "🏁", "title": "GOAL", "text": "가장 먼저 도착하면 우승! 완주하지 못해도 진행 거리에 따라 점수를 받아요."},
        ],
        "tip": "휴대폰을 세로로 편하게 잡고 준비 완료를 누르세요. 센서 권한을 허용하면 그 자세가 기준이 돼요.",
    },
    "game_class": TiltBall,
    "test_maps": [m["name"] for m in MAZES],
    "test_map_previews": lambda count: MAZES,
    "ui": {
        "host": {"script": "tiltball.js", "setup": "setupTiltBall"},
        "player": {"script": "tiltball.js", "setup": "setupTiltBall"},
        "styles": ["tiltball.css", "result-style.css"],
    },
}
