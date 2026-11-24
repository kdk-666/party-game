from games.red_light.game import RedLight

GAME_ID = "red_light"

GAME_INFO = {
    "name": "무궁화 꽃이 피었습니다",
    "instructions": [
        "초록불에는 휴대폰을 흔들어 앞으로 움직이세요.",
        "빨간불에는 움직이지 마세요. 움직이면 탈락이에요.",
        "먼저 도착하거나 60초 뒤 가장 가까운 생존자가 이겨요.",
    ],
    "game_class": RedLight,

    "ui": {
        "host": {"script": "host.js", "setup": "setupRedLightHostUI"},
        "player": {"script": "player.js", "setup": "setupRedLightPlayerUI"},
        "styles": ["result.css"],
        "scripts": ["result.js"],
    },
}