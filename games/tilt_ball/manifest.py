from games.tilt_ball.game import TiltBall

GAME_ID = "tilt_ball"

GAME_INFO = {
    "name": "기울여서 공 굴리기",
    "instructions": [
        "휴대폰을 기울여 공을 굴려서 미로를 지나 GOAL까지 가요.",
        "구멍에 빠지면 가장 가까운 체크포인트(깃발)에서 다시 시작해요.",
        "가장 먼저 도착하면 우승! 못 도착해도 가장 멀리 간 순서로 점수를 받아요.",
    ],
    "game_class": TiltBall,
    "ui": {
        "host": {"script": "tiltball.js", "setup": "setupTiltBall"},
        "player": {"script": "tiltball.js", "setup": "setupTiltBall"},
        "styles": ["tiltball.css"],
    },
}
