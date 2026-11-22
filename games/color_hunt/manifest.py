from games.color_hunt.game import ColorHunt

GAME_ID = "color_hunt"

GAME_INFO = {
    "name": "컬러헌트",
    "instructions": [
        "화면에 제시된 색과 가장 비슷한 물건을 찾아요.",
        "물건을 카메라 가운데에 크게 담아 사진을 찍고 보내세요.",
        "색이 비슷할수록 높은 점수! 모두 3번 도전해요.",
    ],
    "game_class": ColorHunt,
    "ui": {
        "host": {"script": "colorhunt.js", "setup": "setupColorHuntUI"},
        "player": {"script": "colorhunt.js", "setup": "setupColorHuntUI"},
        "styles": ["colorhunt.css"],
    },
}