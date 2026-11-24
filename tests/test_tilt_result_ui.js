// 실제 게임 메시지로 공굴리기 준비 -> 결과 -> 집계 화면 전환을 검사한다.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'games', 'tilt_ball', 'client', 'tiltball.js'), 'utf8');
function element() {
  const classes = new Set();
  return {hidden: false, innerHTML: '', textContent: '', style: {}, clientWidth: 320, clientHeight: 600,
    classList: {add(v) { classes.add(v); }, remove(v) { classes.delete(v); }, toggle(v, on) { if (on) classes.add(v); else classes.delete(v); }, contains(v) { return classes.has(v); }},
    getContext() { return {}; }, querySelector() { return element(); }};
}
const root = element(), canvas = element(), hud = element(), toast = element(), banner = element(), count = element(), card = element(), recal = element(), close = element();
card.querySelector = selector => selector === '[data-k="close"]' ? close : element();
const selectors = {'canvas': canvas, '.tb-hud': hud, '.tb-toast': toast, '.tb-banner': banner, '.tb-count': count, '[data-k="card"]': card, '.tb-recal': recal};
root.querySelector = selector => selectors[selector];
const listeners = {}, document = {getElementById: () => root, addEventListener() {}, visibilityState: 'visible'};
const ws = {readyState: 1, send() {}, addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); }};
const context = {document, window: {devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}},
  localStorage: {getItem() { return null; }}, navigator: {}, screen: {orientation: {angle: 0}},
  performance: {now: () => 1000}, requestAnimationFrame() {}, WebSocket: {OPEN: 1},
  setInterval() { return 1; }, clearInterval() {}, setTimeout() {}, clearTimeout() {}, Math, Number, Date, JSON, Promise};
vm.createContext(context); vm.runInContext(source, context);
context.setupTiltBall(ws, 'host', () => null);
function event(type, data = {}) { (listeners.message || []).forEach(fn => fn({data: JSON.stringify({type, data})})); }
const intro = {maze: {name: '연습', level: 1, rows: ['###', '#S#', '#G#']}, names: ['민지', '서연'], time_limit: 90};
event('tb_intro', intro);
event('tb_over', {winner: '민지', ranking: ['민지', '서연'], reason: 'last_one', scores: {'민지': 1000, '서연': 700},
  results: {'민지': {finish_time: 12.3, progress: 1, falls: 0}, '서연': {finish_time: null, progress: .7, falls: 2}}});
assert(card.classList.contains('tb-result-card') && !card.hidden);
assert(card.innerHTML.includes('공굴리기 결과') && card.innerHTML.includes('민지'));
assert(card.innerHTML.includes('완주 12.3초') && card.innerHTML.includes('진행 70%'));
assert(card.innerHTML.includes('구멍 2번') && card.innerHTML.includes('1,000점'));
close.onclick();
assert(!root.hidden && !card.hidden, '결과를 닫아도 이전 게임 화면이 드러나면 안 됩니다');
assert(card.innerHTML.includes('점수 집계를 기다리고 있어요'));
assert(card.classList.contains('tb-result-wait'));
event('round_result'); assert(root.hidden);
event('tb_intro', intro);
assert(!card.classList.contains('tb-result-card') && !card.classList.contains('tb-result-wait'));
console.log('tilt game result UI OK');
