// 최종 화면에서는 자동 복귀를 기다리고, 기존 참가자와 대기실을 다시 표시한다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'host-lobby.js'), 'utf8');
const ids = ['host-waiting', 'host-game', 'lobby-players', 'lobby-count', 'start', 'host-back', 'host-connection', 'bg', 'test-mode', 'test-game'];
const elements = {};
function element() { return {hidden: false, disabled: false, textContent: '', className: '', classList: {add() {}}, style: {}, children: [],
  replaceChildren() { this.children = []; }, append(child) { this.children.push(child); },
  addEventListener(type, fn) { this['on' + type] = fn; }}; }
for (const id of ids) elements[id] = element();
const select = elements['test-game'];
select.value = ''; select.options = [];
select.replaceChildren = function(option) { this.options = [option]; this.value = option.value; };
select.add = function(option) { this.options.push(option); };
const listeners = {};
const ws = {readyState: 1, send(message) { this.lastMessage = JSON.parse(message); }, addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); }};
const document = {getElementById: id => elements[id], createElement: () => element()};
const context = {document, WebSocket: {OPEN: 1}, Option: function(text, value) { this.text = text; this.value = value; }, JSON}; vm.createContext(context); vm.runInContext(source, context);
context.setupHostLobby(ws);
function event(type, data = {}) { for (const fn of listeners.message || []) fn({data: JSON.stringify({type, data})}); }
event('lobby', {players: ['민지', '서연']});
event('countdown');
assert(elements['host-waiting'].hidden && !elements['host-game'].hidden);
event('match_over');
assert(elements['host-back'].hidden, '정상 종료는 자동 복귀를 기다려야 합니다');
event('return_lobby');
assert(!elements['host-waiting'].hidden && elements['host-game'].hidden);
assert.strictEqual(elements['lobby-count'].textContent, '2 / 4명 참가 중');
assert(!elements.start.disabled);
assert(elements['test-mode'].hidden, '테스트 모드는 기본적으로 숨겨야 합니다');
event('lobby', {players: ['민지'], test_mode: true, test_games: [{id: 'monster_escape', name: '좀비 피하기'}]});
select.value = 'monster_escape';
event('lobby', {players: ['민지', '서연'], test_mode: true, test_games: [{id: 'monster_escape', name: '좀비 피하기'}]});
assert.strictEqual(select.value, 'monster_escape', '참가자가 바뀌어도 선택을 유지합니다');
elements.start.onclick();
assert.strictEqual(ws.lastMessage.data.game_id, 'monster_escape');
event('lobby', {players: ['민지'], test_mode: false});
elements.start.onclick();
assert(!('game_id' in ws.lastMessage.data), '일반 모드는 게임 선택을 보내지 않습니다');
event('match_cancelled');
assert(!elements['host-back'].hidden, '취소 시 기존 수동 복귀는 유지합니다');
console.log('scoreboard lobby OK');
