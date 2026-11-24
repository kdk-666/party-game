const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'scoreboard.js'), 'utf8');

function harness() {
  let now = 1000, nextId = 1;
  const frames = new Map(), intervals = new Map(), listeners = {}, roots = [];
  class Element {
    constructor(tag) { this.tag = tag; this.className = ''; this.textContent = ''; this.children = []; this.hidden = false; }
    setAttribute() {}
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { for (const child of children) this.appendChild(child); }
    replaceChildren(...children) { this.children = [...children]; }
    set innerHTML(value) {
      this.children = [];
      for (const match of value.matchAll(/class="([^"]+)"/g)) {
        const child = new Element('div'); child.className = match[1]; this.children.push(child);
      }
    }
    querySelector(selector) {
      const name = selector.slice(1);
      return this.all().find(el => el.className.split(' ').includes(name)) || null;
    }
    all() { return [this, ...this.children.flatMap(child => child.all())]; }
  }
  const document = { createElement: tag => new Element(tag), body: { appendChild: root => roots.push(root) } };
  const ws = { addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); } };
  const context = {
    document, window: { matchMedia: () => ({matches: false}) }, performance: { now: () => now },
    setInterval(fn) { const id = nextId++; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    requestAnimationFrame(fn) { const id = nextId++; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }, Math, Number, Array, JSON,
  };
  vm.createContext(context); vm.runInContext(source, context);
  context.setupScoreboard(ws, 'player', () => '민지');
  const root = roots[0];
  function event(type, data = {}) { for (const fn of listeners.message || []) fn({data: JSON.stringify({type, data})}); }
  function advance(ms) {
    now += ms;
    const old = [...frames.values()]; frames.clear();
    for (const fn of old) fn(now);
    for (const fn of [...intervals.values()]) fn();
  }
  function all(className) { return root.all().filter(el => el.className.split(' ').includes(className)); }
  return {root, event, advance, all, close: () => (listeners.close || []).forEach(fn => fn())};
}

const h = harness();
assert(h.root.hidden);
const initial = [
  {name: '민지', score: 1200, rank: 1, connected: true},
  {name: '서연', score: 800, rank: 2, connected: true},
];
h.event('round_result', {round: 1, total_rounds: 2, game_name: '컬러헌트', seconds: 7,
  standings: initial, scores: {'민지': 1000, '서연': 300}});
assert(!h.root.hidden);
assert.strictEqual(h.all('scoreboard-title')[0].textContent, '이번 게임 점수 집계');
assert.strictEqual(h.all('scoreboard-total')[0].textContent, '200점');
assert.strictEqual(h.all('scoreboard-gain')[0].textContent, '+0');
assert.strictEqual(h.all('scoreboard-rank')[0].textContent, '…');
assert.strictEqual(h.all('scoreboard-state')[0].textContent, '점수 합산 중');
assert.strictEqual(h.all('scoreboard-me').length, 1);
h.advance(900);
assert.strictEqual(h.all('scoreboard-total')[0].textContent, '1,075점');
assert.strictEqual(h.all('scoreboard-gain')[0].textContent, '+875');
h.advance(1000);
assert.strictEqual(h.all('scoreboard-total')[0].textContent, '1,200점');
assert.strictEqual(h.all('scoreboard-gain')[0].textContent, '+1,000');
assert.strictEqual(h.all('scoreboard-rank')[0].textContent, '1위');

// 집계 도중 나간 사람은 점수를 보존하면서 순위에서 제외된다.
h.event('match_standings_update', {winners: ['서연'], standings: [
  {name: '서연', score: 800, rank: 1, connected: true},
  {name: '민지', score: 1200, rank: null, connected: false},
]});
assert.strictEqual(h.all('scoreboard-rank')[1].textContent, '이탈');
assert.strictEqual(h.all('scoreboard-total')[1].textContent, '1,200점');
assert.strictEqual(h.all('scoreboard-state')[1].textContent, '순위 제외 · 점수 보존');
h.event('round_start');
assert(h.root.hidden);

// 공동 우승 및 최종 화면의 실시간 이탈 반영.
h.event('match_over', {seconds: 10, standings: initial, winners: ['민지', '서연']});
assert.strictEqual(h.all('scoreboard-winner-label')[0].textContent, '공동 우승');
assert.strictEqual(h.all('scoreboard-winner-names')[0].textContent, '민지 · 서연');
h.event('match_standings_update', {winners: ['서연'], standings: [
  {name: '서연', score: 800, rank: 1, connected: true},
  {name: '민지', score: 1200, rank: null, connected: false},
]});
assert.strictEqual(h.all('scoreboard-winner-label')[0].textContent, '최종 우승');
assert.strictEqual(h.all('scoreboard-winner-names')[0].textContent, '서연');
h.event('return_lobby');
assert(h.root.hidden);

// 모두 이탈하면 우승자가 없고, 연결 장애는 자동 성공처럼 보이지 않는다.
h.event('match_over', {seconds: 10, standings: [], winners: []});
assert.strictEqual(h.all('scoreboard-winner-label')[0].textContent, '우승자 없음');
h.close();
assert(h.all('scoreboard-footer')[0].textContent.includes('연결이 끊겼어요'));
console.log('scoreboard UI OK');
