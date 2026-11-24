// 센서 권한·영점·재시도·시간 초과와 오래된 비동기 응답을 검사한다.
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'games/tilt_ball/client/tiltball.js'), 'utf8');
function el() {
  const classes = new Set(), children = {};
  return {hidden: false, disabled: false, textContent: '', innerHTML: '', style: {}, clientWidth: 320, clientHeight: 600,
    classList: {add(v) { classes.add(v); }, remove(v) { classes.delete(v); }, toggle(v,on) { if (on) classes.add(v); else classes.delete(v); }},
    getContext() { return {}; }, querySelector(k) { return children[k] || (children[k] = el()); }};
}
function harness(permission = () => Promise.resolve('granted')) {
  const root = el(); root.hidden = true;
  const nodes = Object.fromEntries(['canvas', '.tb-hud', '.tb-toast', '.tb-banner', '.tb-count', '[data-k="card"]', '.tb-recal', '.tb-sensor'].map(s => [s, el()]));
  root.querySelector = s => nodes[s];
  const windowListeners = {}, wsListeners = {}, sent = [], intervals = new Map(); let id = 0, hook;
  const win = {devicePixelRatio: 1, DeviceOrientationEvent: {requestPermission: permission},
    addEventListener(type, fn) { (windowListeners[type] ||= new Set()).add(fn); },
    removeEventListener(type, fn) { if (windowListeners[type]) windowListeners[type].delete(fn); }};
  const ws = {readyState: 1, send(s) { sent.push(JSON.parse(s)); }, addEventListener(t, fn) { (wsListeners[t] ||= []).push(fn); }};
  const document = {getElementById() { return root; }, addEventListener() {}, visibilityState: 'visible'};
  const context = {document, window: win, localStorage: {getItem() { return null; }}, navigator: {}, screen: {orientation: {angle: 0}},
    performance: {now: () => Date.now()}, requestAnimationFrame() {}, WebSocket: {OPEN: 1},
    setInterval(fn) { const n = ++id; intervals.set(n, fn); return n; }, clearInterval(n) { intervals.delete(n); },
    setTimeout(fn) { return setTimeout(fn, 1); }, clearTimeout, Math, Number, Date, JSON, Promise};
  vm.createContext(context); vm.runInContext(source, context);
  context.setupTiltBall(ws, 'player', () => '민지', {register(game, fn) { assert.strictEqual(game, 'tilt_ball'); hook = fn; }});
  const event = (type, data = {}) => (wsListeners.message || []).forEach(fn => fn({data: JSON.stringify({type, data})}));
  const orient = (beta, gamma) => (windowListeners.deviceorientation || []).forEach(fn => fn({beta, gamma}));
  const intro = () => event('tb_intro', {maze: {name: '테스트', level: 1, rows: ['###', '#S#', '#G#']}, names: ['민지'], time_limit: 90, unified_preparation: true});
  return {hook: () => hook(), event, orient, intro, nodes, sent, intervals, windowListeners, close: () => (wsListeners.close || []).forEach(fn => fn())};
}
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
(async () => {
  let permission = 'denied', calls = 0;
  const h = harness(() => { calls++; return Promise.resolve(permission); });
  h.event('round_start', {game_id: 'tilt_ball'});
  const denied = h.hook();
  assert.strictEqual(calls, 1, '권한 요청은 클릭 직후 동기적으로 시작해야 함');
  assert.strictEqual((await denied).ok, false);
  permission = 'granted'; const success = h.hook(); await pause(); h.orient(15, 5);
  assert.strictEqual((await success).ok, true);
  h.intro(); assert(h.nodes['[data-k="card"]'].hidden, '두 번째 준비 화면 없음');
  assert(h.nodes['.tb-sensor'].hidden, '준비한 폰은 센서 켜기 버튼이 불필요');
  h.event('tb_count', {n: 3}); h.event('tb_state', {left: 90, players: {}});
  assert(!h.nodes['.tb-recal'].hidden);
  h.orient(15, 25); [...h.intervals.values()].forEach(fn => fn());
  const tilt = h.sent.find(m => m.type === 'tilt');
  assert(tilt && tilt.data.x > 0.5 && tilt.data.y === 0, '기준 자세에서의 상대 기울기 사용');
  h.close(); assert.strictEqual((h.windowListeners.deviceorientation || new Set()).size, 0);

  const late = harness(); late.event('round_start', {game_id: 'tilt_ball'});
  const noSample = late.hook(); await pause(); late.intro(); late.event('tb_count', {n: 3});
  assert(late.nodes['.tb-sensor'].disabled, '센서 확인 중 중복 요청 방지');
  assert.strictEqual((await noSample).ok, false);
  assert(!late.nodes['.tb-sensor'].hidden && !late.nodes['.tb-sensor'].disabled, '시간 초과 후에도 게임 중 재시도 가능');
  const retry = late.nodes['.tb-sensor'].onclick(); await pause(); late.orient(20, 10); await retry;
  assert(late.nodes['.tb-sensor'].hidden, '재시도 성공 시 버튼 숨김');

  let resolvePermission; const stale = harness(() => new Promise(resolve => { resolvePermission = resolve; }));
  stale.event('round_start', {game_id: 'tilt_ball'}); const pending = stale.hook();
  stale.event('round_start', {game_id: 'red_light'}); resolvePermission('granted');
  assert.strictEqual((await pending).ok, false);
  assert.strictEqual((stale.windowListeners.deviceorientation || new Set()).size, 0, '다른 게임으로 넘어간 후 센서 리스너 금지');
  console.log('tilt unified preparation UI OK');
})().catch(e => { console.error(e); process.exitCode = 1; });
