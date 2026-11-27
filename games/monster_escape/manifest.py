from games.monster_escape.game import BLACKOUT_ENABLED, JUMP_LIMIT, MAPS, MonsterEscape, expand_map

GAME_ID = 'monster_escape'
GAME_INFO = {
    'name': '좀비 피하기',
    'instructions': ['조이스틱으로 움직여 좀비를 피하세요.', f'얇은 벽 앞에서 벽 넘기를 한 판에 {JUMP_LIMIT}번 쓸 수 있어요.', '좀비에게 닿으면 탈락해요.', '마지막까지 살아남으면 승리해요.'],
    'guide': {'rules': [
        {'icon': '🕹️', 'title': '이동', 'text': '휴대폰 조이스틱을 밀어 움직여요.'},
        {'icon': '↗️', 'title': f'벽 넘기 · {JUMP_LIMIT}회', 'text': '얇은 벽을 바라보고 버튼을 눌러요. 점프 중엔 안전하지만 착지 뒤엔 좀비를 조심해요. 실패하면 횟수는 그대로예요.'},
        {'icon': '🧟', 'title': '추격', 'text': '각자 좀비 2마리가 추격하고, 중앙의 3마리는 2초 뒤 움직여요. 일부는 앞을 막으려 해요.'},
        {'icon': '🔦', 'title': '시야', 'text': '벽 뒤는 보이지 않아요. 5초 뒤 정전되면 손전등으로 이동 방향을 비춰요.' if BLACKOUT_ENABLED else '벽 뒤는 보이지 않아요. 추격 테스트 중 정전은 꺼져 있어요.'},
        {'icon': '🏆', 'title': '승리', 'text': '끝까지 살아남거나 오래 버텨요.'},
    ], 'tip': '손을 떼면 멈추고 손전등은 마지막 이동 방향을 비춰요.' if BLACKOUT_ENABLED else '손을 떼면 캐릭터가 멈춰요.'},
    'game_class': MonsterEscape,
    'test_maps': [name for name, _ in MAPS],
    'test_map_previews': lambda count: [{'name': name, 'rows': expand_map(rows, count)} for name, rows in MAPS],
    'ui': {'host': {'script': 'game.js', 'setup': 'setupMonsterEscape'},
           'player': {'script': 'game.js', 'setup': 'setupMonsterEscape'}, 'styles': ['game.css']},
}
