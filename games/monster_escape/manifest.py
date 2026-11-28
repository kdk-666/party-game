from games.monster_escape.game import JUMP_LIMIT, JUMP_RECHARGE_SECONDS, TIME_LIMIT, MAPS, MonsterEscape, expand_map

GAME_ID = 'monster_escape'
GAME_INFO = {
    'name': '좀비 피하기',
    'instructions': ['조이스틱으로 움직여 좀비를 피하세요.', f'벽 넘기는 최대 {JUMP_LIMIT}회 보유하며, 사용 후 {int(JUMP_RECHARGE_SECONDS)}초마다 1회 충전돼요.', '좀비에게 닿으면 탈락해요.', '마지막까지 살아남으면 승리해요.'],
    'guide': {'rules': [
        {'icon': '🕹️', 'title': '이동', 'text': '조이스틱으로 움직여요.'},
        {'icon': '↗️', 'title': f'벽 넘기 · {JUMP_LIMIT}회', 'text': f'얇은 벽 앞에서 사용해요. {int(JUMP_RECHARGE_SECONDS)}초마다 1회 충전돼요.'},
        {'icon': '🧟', 'title': '생존', 'text': f'좀비를 피해 {int(TIME_LIMIT)}초 동안 살아남으세요!'},
    ]},
    'game_class': MonsterEscape,
    'test_maps': [name for name, _ in MAPS],
    'test_map_previews': lambda count: [{'name': name, 'rows': expand_map(rows, count)} for name, rows in MAPS],
    'ui': {'host': {'script': 'game.js', 'setup': 'setupMonsterEscape'},
           'player': {'script': 'game.js', 'setup': 'setupMonsterEscape'}, 'styles': ['game.css']},
}
