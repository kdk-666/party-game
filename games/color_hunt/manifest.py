from games.color_hunt.game import ColorHunt

GAME_ID = "color_hunt"

GAME_INFO = {
    "name": "컬러헌트",
    "instructions": [
        "화면에 제시된 색과 가장 비슷한 물건을 찾아요.",
        "물건을 카메라 가운데에 크게 담아 사진을 찍고 보내세요.",
        "색이 비슷할수록 높은 점수! 모두 3번 도전해요.",
    ],
    "guide": {
        "rules": [
            {"icon": "🎨", "title": "색 찾기", "text": "화면에 제시된 색과 비슷한 물건을 찾아요."},
            {"icon": "📸", "title": "사진 찍기", "text": "물건을 카메라 가운데에 크게 담고 사진을 보내요."},
            {"icon": "✨", "title": "점수", "text": "색이 비슷할수록 높은 점수! 세 번 도전해요."},
        ],
        "tip": "카메라 권한 안내가 나오면 허용해 주세요. 주변에 다양한 색의 물건을 준비해요.",
    },
    "game_class": ColorHunt,
    "ui": {
        "host": {"script": "colorhunt.js", "setup": "setupColorHuntUI"},
        "player": {"script": "colorhunt.js", "setup": "setupColorHuntUI"},
        "styles": ["colorhunt.css", "result-style.css"],
    },
}