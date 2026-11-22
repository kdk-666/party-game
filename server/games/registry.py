from server.games.color_hunt import ColorHunt
from server.games.red_light import RedLight

GAME_REGISTRY = {
    "red_light": {
        "name": "무궁화 꽃이 피었습니다",
        "instructions": [
            "초록불에는 휴대폰을 흔들어 앞으로 움직이세요.",
            "빨간불에는 움직이지 마세요. 움직이면 탈락이에요.",
            "먼저 도착하거나 60초 뒤 가장 가까운 생존자가 이겨요.",
        ],
        "game_class": RedLight,
    },
    "color_hunt": {
        "name": "컬러헌트",
        "instructions": [
            "화면에 제시된 색과 가장 비슷한 물건을 찾아요.",
            "물건을 카메라 가운데에 크게 담아 사진을 찍고 보내세요.",
            "색이 비슷할수록 높은 점수! 모두 3번 도전해요.",
        ],
        "game_class": ColorHunt,
    },
}
