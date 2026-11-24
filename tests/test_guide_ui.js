const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'web/guide.js'), 'utf8');
function el() {
  return {hidden: false, disabled: false, textContent: '', className: '', dataset: {}, style: {}, children: [], listeners: {}, attrs: {},
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, fn) { this.listeners[k] = fn; },
    click() { return this.listeners.click(); }};
}
const ids = ['game-guide', 'guide-round', 'guide-title', 'guide-time', 'guide-rules', 'guide-extra', 'guide-summary', 'guide-players', 'guide-ready', 'guide-hint'];
const nodes = Object.fromEntries(ids.map(id => [id, el()])), listeners = {}, sent = [];
const ws = {readyState: 1, send(value) { sent.push(JSON.parse(value)); }, addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }};
const context = {document: {getElementById(id) { return nodes[id] || null; }, createElement() { return el(); }},
  performance: {now: () => 1000}, WebSocket: {OPEN: 1}, setInterval() { return 1; }, clearInterval() {}, Map, Array, Math, Number, String, JSON, Promise};
vm.createContext(context); vm.runInContext(source, context);
const guide = context.setupGameGuide(ws, () => '민지');
const event = (type, data = {}) => (listeners.message || []).forEach(fn => fn({data: JSON.stringify({type, data})}));
const start = {token: 'first', game_id: 'tilt_ball', game_name: '공굴리기', round: 1, total_rounds: 3, remaining: 60,
  players: ['민지', '서연'], ready: [], guide: {requires_hook: true, rules: [{icon: '🕳', title: '구멍', text: '돌아가요'}], tip: '세로로 잡아요'},
  game_data: {maze: {name: '테스트', level: 1, rows: ['###', '#SO', '#CG']}}};
(async () => {
  event('round_start', start);
  assert(!nodes['game-guide'].hidden && nodes['game-guide'].dataset.game === 'tilt_ball');
  const mapArea = nodes['guide-extra'].children.find(e => e.className === 'guide-map-area');
  const map = mapArea && mapArea.children.find(e => e.className === 'guide-map');
  assert(map && map.children.length === 9 && map.children.some(e => e.className === 'guide-map-cell hole'), '실제 O 타일이 구멍으로 그려짐');
  assert.strictEqual(nodes['guide-rules'].children.length, 1);
  await nodes['guide-ready'].click();
  assert(nodes['guide-hint'].textContent.includes('불러오지 못했어요') && sent.length === 0, '필수 훅이 없을 때 준비 금지');
  let attempt = 0, resolve;
  guide.register('tilt_ball', () => { attempt++; return attempt === 1 ? Promise.resolve({ok: false, message: '센서 오류, 다시 시도해 주세요.'}) : new Promise(r => { resolve = r; }); });
  await nodes['guide-ready'].click();
  assert(nodes['guide-hint'].textContent.includes('센서 오류') && sent.length === 0);
  event('preparation_update', {token: 'first', players: ['민지', '서연'], ready: ['서연'], remaining: 40});
  assert(nodes['guide-hint'].textContent.includes('센서 오류'), '다른 참가자 상태가 바뀌어도 오류 안내 유지');
  const pending = nodes['guide-ready'].click();
  assert(nodes['guide-ready'].disabled);
  event('countdown'); resolve({ok: true}); await pending;
  assert(sent.length === 0 && nodes['game-guide'].hidden, '만료 후 늦은 권한 응답으로 준비 메시지를 보내지 않음');
  event('round_start', {...start, token: 'second', game_id: 'red_light', game_name: '무궁화', guide: {rules: []}, game_data: {}});
  await nodes['guide-ready'].click();
  assert.deepStrictEqual(sent, [{type: 'ready', data: {token: 'second'}}], '일반 게임은 센서 훅 없이 준비');
  event('preparation_update', {token: 'second', players: ['민지', '서연'], ready: ['민지'], remaining: 30});
  assert(nodes['guide-ready'].disabled && nodes['guide-ready'].textContent.includes('준비 완료'));
  console.log('game guide UI OK');
})().catch(e => { console.error(e); process.exitCode = 1; });
