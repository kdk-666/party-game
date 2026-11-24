// 무궁화 결과 화면은 서버 결과를 그대로 표시하고 집계가 시작되면 닫힌다.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'games', 'red_light', 'client', 'result.js'), 'utf8');
function run(role, me) {
  const listeners = {}, roots = [];
  const document = {createElement: () => ({className: '', hidden: false, innerHTML: '', setAttribute() {}}),
    body: {appendChild(node) { roots.push(node); }}};
  const ws = {addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); }};
  const context = {document, Set, Number, JSON}; vm.createContext(context); vm.runInContext(source, context);
  context.setupRedLightResult(ws, role, () => me);
  return {root: roots[0], event(type, data = {}) { (listeners.message || []).forEach(fn => fn({data: JSON.stringify({type, data})})); }};
}
const data = {winner: '민지', ranking: ['민지', '서연'], eliminated: ['서연'], arrived: ['민지'],
  scores: {'민지': 1000, '서연': 100}, dist: {'민지': 0, '서연': 2.5}};
for (const role of ['host', 'player']) {
  const h = run(role, '민지');
  h.event('game_over', data);
  assert(!h.root.hidden);
  assert(h.root.innerHTML.includes('무궁화 게임 결과'));
  assert(h.root.innerHTML.includes('결승선에 가장 먼저 도착했어요'));
  assert(h.root.innerHTML.includes('1,000점') && h.root.innerHTML.includes('100점'));
  assert(h.root.innerHTML.includes('탈락'));
  h.event('round_result');
  assert(h.root.hidden, '대회 점수 집계가 나타나면 게임 결과를 닫아야 합니다');
}
const h = run('player', '민지');
h.event('game_over', {winner: null, ranking: ['민지'], eliminated: ['민지'], arrived: [], scores: {'민지': 100}, dist: {'민지': 3}});
assert(h.root.innerHTML.includes('우승자 없음'));
assert(!h.root.innerHTML.includes('1위'));
h.event('round_start'); assert(h.root.hidden);
// 닉네임은 HTML로 실행되지 않게 이스케이프한다.
h.event('game_over', {winner: '<img src=x>', ranking: ['<img src=x>'], eliminated: [], arrived: [], scores: {'<img src=x>': 700}, dist: {'<img src=x>': 2}});
assert(h.root.innerHTML.includes('&lt;img src=x&gt;'));
assert(!h.root.innerHTML.includes('<img src=x>'));
console.log('red game result UI OK');
