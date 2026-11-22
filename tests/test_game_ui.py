import shutil

import pytest
import server.main as main


def test_registered_ui_assets_are_in_role_pages():
    host = main.host_page().body.decode("utf-8")
    player = main.player_page().body.decode("utf-8")
    assert '/game-assets/red_light/host.js' in host
    assert '/game-assets/red_light/player.js' in player
    assert '/game-assets/color_hunt/colorhunt.js' in host
    assert '/game-assets/color_hunt/colorhunt.js' in player
    assert '<!-- GAME_ASSETS -->' not in host
    assert '<!-- GAME_ASSETS -->' not in player


def test_new_registered_game_ui_is_added_without_html_edits(tmp_path, monkeypatch):
    games = tmp_path / 'games'
    shutil.copytree(main.GAMES, games)
    client = games / 'example' / 'client'
    client.mkdir(parents=True)
    (client / 'host.js').write_text('function setupExample() {}', encoding='utf-8')
    example = {'ui': {'host': {'script': 'host.js', 'setup': 'setupExample'}}}
    monkeypatch.setattr(main, 'GAMES', games)
    monkeypatch.setattr(main, 'GAME_REGISTRY', {**main.GAME_REGISTRY, 'example': example})
    html = main.host_page().body.decode('utf-8')
    assert '/game-assets/example/host.js' in html
    assert 'data-game-ui="example"' in html


def test_client_mount_does_not_expose_server_file():
    route = next(r for r in main.app.routes if r.path == '/game-assets/color_hunt')
    assert route.app.lookup_path('colorhunt.js')[0]
    assert route.app.lookup_path('../game.py')[0] == ''


def test_rejects_unsafe_game_id(monkeypatch):
    monkeypatch.setattr(main, 'GAME_REGISTRY', {'../bad': {}})
    with pytest.raises(ValueError):
        main.host_page()


def test_rejects_unsafe_client_script(monkeypatch):
    bad = {'ui': {'host': {'script': '../game.py', 'setup': 'setupBad'}}}
    monkeypatch.setattr(main, 'GAME_REGISTRY', {'bad': bad})
    with pytest.raises(ValueError):
        main.host_page()
