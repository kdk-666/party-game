const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'games/red_light/client/arena.js'), 'utf8');
function element() {
  const classes = new Set();
  return {hidden: false, textContent: '', innerHTML: '', className: '', dataset: {}, style: {}, children: [],
    classList: {add(n) { classes.add(n); }, remove(n) { classes.delete(n); }, toggle(n,v) { if (v) classes.add(n); else classes.delete(n); }, contains(n) { return classes.has(n); }},
    setAttribute() {}, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }};
}
function harness(role = 'player', height = 380) {
  const listeners = {}, drawn = [], nodes = {}, callbacks = new Map(); let now = 1000, next = 0, root;
  const ctx = new Proxy({}, {get(target, key) { if (key === 'fillText') return (...args) => drawn.push(args); return target[key] || (() => {}); }, set(target, key, value) { target[key] = value; return true; }});
  const canvas = element(); canvas.getContext = () => ctx; canvas.getBoundingClientRect = () => ({width: 390, height});
  const keys = ['signal', 'signal-title', 'signal-hint', 'time', 'my-card', 'my-distance', 'my-status', 'player-count', 'players', 'overlay-message'];
  keys.forEach(key => { nodes[key] = element(); });
  const document = {createElement() { const e = element(); if (!root) { root = e; root.querySelector = s => s === 'canvas' ? canvas : nodes[s.match(/data-k="([^"]+)"/)[1]]; } return e; }, body: {appendChild() {}}};
  const ws = {addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }};
  const context = {document, window: {devicePixelRatio: 1}, performance: {now: () => now},
    requestAnimationFrame(fn) { const id = ++next; callbacks.set(id, fn); return id; }, cancelAnimationFrame(id) { callbacks.delete(id); },
    Math, Number, String, Object, Array, JSON, Set};
  vm.createContext(context); vm.runInContext(source, context);
  context.setupRedLightArena(ws, role, () => role === 'player' ? '민지' : null);
  const event = (type, data = {}) => (listeners.message || []).forEach(fn => fn({data: JSON.stringify({type, data})}));
  const tick = () => { const pending = [...callbacks]; callbacks.clear(); pending.forEach(([, fn]) => fn(now)); };
  return {nodes, get root() { return root; }, event, tick, drawn, setTime(t) { now = t; }, close() { (listeners.close || []).forEach(fn => fn()); }, callbacks};
}
const h = harness();
h.event('round_start', {game_id: 'red_light', players: ['민지', '서연']});
assert(h.root.hidden && h.root.className.includes('is-player'));
h.event('countdown'); assert(!h.root.hidden);
h.event('state', {state: 'green', dist: {'민지': 7.3, '서연': 3.1}, alive: ['민지','서연'], connected: ['민지','서연'], eliminated: [], arrived: [], start_distance: 10, remaining: 47.2});
assert.strictEqual(h.nodes['time'].textContent, '00:48');
assert.strictEqual(h.nodes['my-distance'].textContent, '7.3 m');
assert(h.nodes['signal-title'].textContent.includes('초록불'));
assert(h.root.dataset.state === 'green' && h.nodes['overlay-message'].hidden);
assert.strictEqual(h.nodes['players'].children.length, 2);
assert(h.nodes['players'].children[0].children[1].textContent.includes('(나)'));
assert.strictEqual(h.nodes['players'].children[1].children[2].textContent, '3.1m');
h.tick();
const mine = h.drawn.find(call => call[0] === '민지 · 나'), other = h.drawn.find(call => call[0] === '서연');
assert(mine && other && other[2] < mine[2], '가까운 참가자가 술래 쪽 위에 그려진다');
h.setTime(2200); h.tick(); assert.strictEqual(h.nodes['time'].textContent, '00:46');
h.event('eliminated', {name: '민지', alive: ['서연']});
h.event('state', {state: 'red', dist: {'민지': 7.3, '서연': 3.1}, alive: ['서연'], connected: ['민지','서연'], eliminated: ['민지'], arrived: [], remaining: 45});
assert.strictEqual(h.nodes['signal-title'].textContent, '탈락했어요');
assert(!h.nodes['overlay-message'].hidden && h.nodes['overlay-message'].textContent.includes('탈락'));
assert.strictEqual(h.root.dataset.state, 'red');
h.event('state', {state: 'green', alive: ['서연'], eliminated: ['민지']});
assert.strictEqual(h.nodes['signal-title'].textContent, '탈락했어요', '신호가 바뀌어도 탈락 상태 유지');
h.event('player_left', {name: '서연'});
assert.strictEqual(h.nodes['players'].children[1].children[2].textContent, '나감');
h.event('game_over'); assert(h.root.hidden && h.callbacks.size === 0);
h.event('round_start', {game_id: 'red_light', players: ['민지']}); h.event('countdown'); h.event('state', {state:'green', connected:['민지'], dist:{'민지':9}, remaining:50});
h.setTime(3200); h.close(); assert(h.nodes['signal-title'].textContent.includes('연결이 끊겼어요') && h.callbacks.size === 0);
const frozen = h.nodes['time'].textContent; h.setTime(9000); h.tick(); assert.strictEqual(h.nodes['time'].textContent, frozen);
const host = harness('host'); host.event('round_start', {players:['민지']}); host.event('countdown'); host.event('state', {state:'red', dist:{'민지':4}, connected:['민지'], remaining:9});
assert(host.root.className.includes('is-host') && host.nodes['my-card'].hidden && host.nodes['signal-title'].textContent.includes('빨간불'));
assert(host.nodes['time'].classList.contains('low'));
const tall = harness('player', 780); tall.event('round_start', {players:['민지', '서연']}); tall.event('countdown');
tall.event('state', {state:'green', dist:{'민지':10, '서연':2}, connected:['민지','서연'], remaining:20}); tall.tick();
const tallMine = tall.drawn.find(call => call[0] === '민지 · 나'), tallOther = tall.drawn.find(call => call[0] === '서연');
assert(tallMine && tallOther && tallMine[2] > 1000 && tallMine[2] > tallOther[2], '긴 휴대폰에서도 위치가 경기장 전체에 비례한다');
const odd = harness('host'); odd.event('round_start', {players:['__proto__', '<img src=x>']}); odd.event('countdown');
odd.event('dist', JSON.parse('{"dist":{"__proto__":4,"<img src=x>":2},"connected":["__proto__","<img src=x>"],"remaining":30}'));
assert.strictEqual(odd.nodes['players'].children[0].children[2].textContent, '4.0m');
assert.strictEqual(odd.nodes['players'].children[1].children[1].textContent, '<img src=x>', '닉네임은 HTML이 아닌 텍스트');
console.log('red light arena UI OK');
