// 브라우저 DOM을 흉내 내어 컬러헌트 최종 결과 표시를 확인한다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'games', 'color_hunt', 'client', 'colorhunt.js'), 'utf8');

function render(data, role = 'host', name = '가', closeEarly = false) {
  let nodes = {};
  const listeners = {};
  function element(id) {
    let html = '';
    return {
      id, hidden: false, style: {}, onclick: null,
      set innerHTML(value) {
        html = value;
        if (id === 'ch-screen') {
          nodes = { 'ch-screen': this };
          for (const match of value.matchAll(/id="([^"]+)"/g)) nodes[match[1]] = element(match[1]);
        }
      },
      get innerHTML() { return html; },
      querySelectorAll() { return []; },
    };
  }
  const root = element('ch-screen');
  nodes['ch-screen'] = root;
  const document = {
    querySelector() { return {}; }, documentElement: { style: {} },
    head: { appendChild() {} }, body: { appendChild() {} },
    getElementById(id) { return nodes[id] || null; },
    addEventListener() {}, createElement() { return element('created'); },
  };
  const ws = {
    readyState: 1, send() {},
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
  };
  const context = { document, console, Date, Math, JSON, Promise,
    WebSocket: { OPEN: 1 }, setInterval() { return 1; }, clearInterval() {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'colorhunt.js' });
  context.setupColorHunt(ws, role, () => name);
  for (const listener of listeners.message || []) {
    listener({ data: JSON.stringify({ type: 'ch_over', data }) });
  }
  if (closeEarly) {
    nodes['ch-close'].onclick();
    assert(!root.hidden, '결과를 닫아도 이전 게임 화면이 드러나면 안 됩니다');
    assert(root.innerHTML.includes('점수 집계를 기다리고 있어요'));
    for (const listener of listeners.message || []) {
      listener({ data: JSON.stringify({ type: 'round_result', data: {} }) });
    }
    assert(root.hidden, '서버의 점수 집계 신호를 받으면 대기 화면을 닫아야 합니다');
  }
  return root.innerHTML;
}

const allMissing = {
  winner: null, ranking: ['가', '나'], not_submitted: ['가', '나'],
  totals: { '가': 0, '나': 0 }, scores: { '가': 0, '나': 0 },
};
for (const role of ['host', 'player']) {
  const html = render(allMissing, role);
  assert(html.includes('우승자 없음'), role + ': 우승자 없음이 표시되어야 합니다');
  assert.strictEqual((html.match(/미제출/g) || []).length >= 2, true);
  assert(!html.includes('1등'), role + ': 전원 미제출 시 등수를 표시하지 않아야 합니다');
  assert(html.includes('대회 0점'), role + ': 대회 0점을 표시해야 합니다');
}

const mixed = {
  winner: '제출', ranking: ['제출', '미제출'], not_submitted: ['미제출'],
  totals: { '제출': 0, '미제출': 0 }, scores: { '제출': 1000, '미제출': 0 },
};
const html = render(mixed, 'player', '제출');
assert(html.includes('우승!'));
assert(html.includes('1등'));
assert(html.includes('<strong>미제출</strong>'));
assert(html.includes('사진 미제출'));
assert(html.includes('대회 1000점'));
assert(html.includes('대회 0점'));
render(mixed, 'player', '제출', true);
console.log('color result UI OK');
