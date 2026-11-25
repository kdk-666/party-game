from games.monster_escape.game import MonsterEscape

GAME_ID = 'monster_escape'
GAME_INFO = {
    'name': '좀비 피하기',
    'instructions': ['조이스틱으로 움직여 좀비를 피하세요.', '좀비에게 닿으면 탈락해요.', '마지막까지 살아남으면 승리해요.'],
    'guide': {'rules': [
        {'icon': '🕹️', 'title': '이동', 'text': '휴대폰 조이스틱을 밀어 움직여요.'},
        {'icon': '🧟', 'title': '추격', 'text': '각자 좀비 2마리가 추격하고, 중앙의 3마리는 2초 뒤 움직여요.'},
        {'icon': '🔦', 'title': '정전', 'text': '시작 5초 뒤부터 계속 정전! 손전등으로 이동 방향을 비춰요.'},
        {'icon': '🏆', 'title': '승리', 'text': '끝까지 살아남거나 오래 버텨요.'},
    ], 'tip': '손을 떼면 멈추고 손전등은 마지막 이동 방향을 비춰요.'},
    'game_class': MonsterEscape,
    'ui': {'host': {'script': 'game.js', 'setup': 'setupMonsterEscape'},
           'player': {'script': 'game.js', 'setup': 'setupMonsterEscape'}, 'styles': ['game.css']},
}
