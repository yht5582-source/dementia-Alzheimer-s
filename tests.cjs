// Rule tests for the engine (/*ENGINE-START*/) and teaching content (/*TEACH-START*/) embedded in index.html.
// Run: node tests.cjs
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
function block(a, b) {
  const m = { exports: {} };
  new Function('module', html.slice(html.indexOf(a), html.indexOf(b)))(m);
  return m.exports;
}
const DE = block('/*ENGINE-START*/', '/*ENGINE-END*/');
const { CASES, QUIZ, MAP } = block('/*TEACH-START*/', '/*TEACH-END*/');

let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL:', name); } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ids = (arr, lv) => arr.filter(x => x.lv === lv).map(x => x.k);
const dxS = l => ({ core: new Set(l.core), dom: new Set(l.dom), ad: new Set(l.ad), ex: new Set(l.ex), cert: new Set(l.cert), labs: new Set(l.labs), pres: l.pres });
const allOk = bad => Object.fromEntries(DE.ACUTE.map(a => [a[0], (bad || []).includes(a[0]) ? 'bad' : 'ok']));
const mkB = l => ({ start: '2026-01-01', age: l.age, type: l.type, mmse: l.mmse, risks: new Set(l.risks), sym: new Set(l.sym), sev: l.sev, ctx: l.ctx, danger: l.danger, distress: l.distress, emerg: l.emerg, acute: allOk(l.bad), np: l.np });
const B = o => mkB(Object.assign({ age: 80, type: 'ad', mmse: 15, risks: [], sym: ['agit'], sev: 3, ctx: 'none', danger: true, distress: true, emerg: false, bad: [], np: 'fail' }, o));

/* --- scales --- */
const mm = v => DE.scaleEval('mmse', v, 6);
t('MMSE sum', mm([3, 4, 3, 3, 0, 2, 1, 3, 1, 1, 1]).total === 22);
t('MMSE never adds education', DE.scaleEval('mmse', [3, 4, 3, 3, 0, 2, 1, 3, 1, 1, 1], 0).adj === 0);
t('MoCA +1 at <=12 y', DE.scaleEval('moca', [4, 3, 5, 2, 2, 2, 6], 12).total === 25);
t('MoCA no +1 at 13 y', DE.scaleEval('moca', [4, 3, 5, 2, 2, 2, 6], 13).total === 24);
t('MoCA max stays 30', DE.scaleEval('moca', [5, 3, 6, 3, 2, 5, 6], 6).total === 30);
const lvl = n => { const v = [5, 5, 3, 5, 3, 2, 1, 3, 1, 1, 1]; let d = 30 - n; for (let i = 0; i < v.length && d > 0; i++) { const c = Math.min(v[i], d); v[i] -= c; d -= c; } return DE.scaleEval('mmse', v, 12).lvl; };
[[27, '正常範圍'], [26, '輕度'], [21, '輕度'], [20, '中度'], [10, '中度'], [9, '重度']].forEach(([n, l]) => t('MMSE band ' + n, lvl(n) === l));

/* --- diagnosis --- */
const full = { core: [0, 1, 2, 3], dom: [0, 1], ad: [0, 1], ex: [], cert: [], labs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], pres: 'amn' };
t('probable AD', DE.dxEval(dxS(full)).v === '很可能阿茲海默症失智');
t('one domain is not dementia', DE.dxEval(dxS({ ...full, dom: [0] })).v === '尚未符合失智症');
t('sudden onset → possible', DE.dxEval(dxS({ ...full, ad: [1] })).v === '可能阿茲海默症失智');
t('other cause → possible', DE.dxEval(dxS({ ...full, ex: [0] })).v === '可能阿茲海默症失智');
t('function kept → MCI', DE.dxEval(dxS({ ...full, core: [1, 2, 3], dom: [0] })).v === '輕度認知障礙 (MCI) 範圍');
t('missing labs listed', DE.dxEval(dxS({ ...full, labs: [0] })).next.some(x => x.startsWith('尚未完成')));

/* --- BPSD gate --- */
t('gate open', DE.gate(B({})).drug === true);
t('acute cause blocks', DE.gate(B({ bad: ['pain'] })).drug === false);
t('delirium flagged', DE.gate(B({ bad: ['delir'] })).delir === true);
t('non-drug not tried blocks', DE.gate(B({ np: 'none' })).drug === false);
t('emergency passes gate', DE.gate(B({ bad: ['pain'], np: 'none', emerg: true })).drug === true);
t('mild without distress blocks', DE.gate(B({ sev: 1, danger: false, distress: false })).drug === false);

/* --- drug choice --- */
const ch = (s, o) => { const b = B(o); return DE.choose(s, b); };
t('severe agit: risperidone first', ids(ch('agit', {}), 'first')[0] === 'ris');
t('parkinsonism: quetiapine first', ids(ch('agit', { risks: ['park'] }), 'first')[0] === 'que');
t('QTc avoids citalopram', ids(ch('agit', { sev: 2, danger: false, risks: ['qtc'] }), 'avoid').includes('cit'));
t('DLB avoids haloperidol', ids(ch('psy', { type: 'dlb' }), 'avoid').includes('hal'));
t('DLB ChEI first', ids(ch('psy', { type: 'dlb' }), 'first')[0] === 'ache');
t('FTD avoids ChEI', ids(ch('agit', { type: 'ftd' }), 'avoid').includes('ache'));
t('valproate avoided', ids(ch('agit', {}), 'avoid').includes('vpa'));
t('harmless psychosis: no drug', ids(ch('psy', { sev: 1, danger: false, distress: false }), 'first')[0] === 'none');

/* --- schedule --- */
const days = o => DE.plan(B(o)).tl.map(x => x[0]);
t('antipsychotic schedule', eq(days({}), [0, 7, 28, 120]));
t('no-drug schedule', eq(days({ np: 'none' }), [0, 14, 28]));

/* --- cases: expected reads match the live engine --- */
t('6 cases', CASES.length === 6);
CASES.forEach((c, i) => {
  const n = '病例 ' + (i + 1) + ' ';
  t(n + 'fields', c.story && c.ask && c.points.length >= 3 && c.trap && c.src && c.load.length >= 1);
  c.load.forEach(l => {
    if (l.kind === 'scale') {
      const r = DE.scaleEval(l.type, l.vals, l.edu), e = c.expect.scale;
      t(n + 'vals length', l.vals.length === DE.SCALES[l.type].doms.length);
      t(n + 'vals in range', l.vals.every((v, k) => v >= 0 && v <= DE.SCALES[l.type].doms[k][1]));
      t(n + 'total', r.total === e.total);
      if (e.lvl) t(n + 'level', r.lvl === e.lvl);
      if (e.adj !== undefined) t(n + 'adj', r.adj === e.adj);
    } else if (l.kind === 'dx') {
      t(n + 'dx', DE.dxEval(dxS(l)).v === c.expect.dx.verdict);
    } else {
      const b = mkB(l), p = DE.plan(b), e = c.expect.bpsd, opts = l.sym.flatMap(s => DE.choose(s, b));
      t(n + 'gate', p.g.drug === e.drug);
      if (e.delir !== undefined) t(n + 'delirium', p.g.delir === e.delir);
      if (e.bad !== undefined) t(n + 'bad count', p.g.bad.length === e.bad);
      if (e.first) t(n + 'first', eq(p.first.map(x => x.k), e.first));
      (e.avoid || []).forEach(k => t(n + 'avoid ' + k, ids(opts, 'avoid').includes(k)));
      (e.alt || []).forEach(k => t(n + 'alt ' + k, ids(opts, 'alt').includes(k)));
      if (e.tl) t(n + 'timeline', eq(p.tl.map(x => x[0]), e.tl));
      l.bad.forEach(k => t(n + 'acute key ' + k, DE.ACUTE.some(a => a[0] === k)));
    }
  });
});

/* --- quiz structure --- */
t('20 questions', QUIZ.length === 20);
t('10 basic', QUIZ.filter(q => q.level === 'basic').length === 10);
t('10 adv', QUIZ.filter(q => q.level === 'adv').length === 10);
[0, 1, 2, 3].forEach(k => t('answer ' + 'ABCD'[k] + ' x5', QUIZ.filter(q => q.ans === k).length === 5));
QUIZ.forEach((q, i) => {
  t('Q' + (i + 1) + ' four options', q.opts.length === 4 && new Set(q.opts).size === 4);
  t('Q' + (i + 1) + ' why + src', q.why && q.src);
});
const longest = QUIZ.filter(q => q.opts[q.ans].length === Math.max(...q.opts.map(o => o.length))).length;
t('correct option not usually the longest (' + longest + '/20)', longest <= 8);

/* --- quiz answers cross-checked against the engine --- */
const qa = i => QUIZ[i].opts[QUIZ[i].ans];
t('Q1 MoCA 25', DE.scaleEval('moca', [4, 3, 5, 2, 2, 2, 6], 9).total === 25 && qa(0).includes('25'));
t('Q2 MMSE 15 moderate', qa(1) === '中度' && lvl(15) === '中度');
t('Q5 possible', qa(4).startsWith('可能') && DE.dxEval(dxS({ ...full, ad: [1] })).v.startsWith('可能'));
t('Q8 no drug', qa(7).startsWith('不需用藥'));
t('Q10 valproate', qa(9).includes('不建議'));
t('Q11 4 weeks in tool', DE.plan(B({})).tl.some(x => x[0] === 28 && x[2].includes('停藥')));
t('Q12 4 months in tool', DE.plan(B({})).tl.some(x => x[0] === 120));
t('Q7 NHI mild-moderate', qa(6).includes('galantamine') && QUIZ[6].src.includes('1.3.3'));
t('Q13 haloperidol', qa(12).includes('haloperidol'));
t('Q20 FTD', qa(19).startsWith('不建議'));

/* --- NHI card and sertraline evidence --- */
['第一節 1.3.3，115.8.21 版', 'MMSE 10–26 或 CDR 1–2', '10≦MMSE≦14 或 CDR 2', 'MMSE 5–9 且 CDR 3', '條文未列路易氏體失智症'].forEach(x => t('NHI card: ' + x, html.includes(x)));
t('sertraline note reaches tool', DE.DRUG.ser.k.includes('Finkel 2004'));
t('case 4 no longer says unverified', !CASES[3].points.join('').includes('未另外查證'));

/* --- clinical decisions, 2026-11-05 --- */
const depB = { sym: ['dep'], sev: 3, danger: false, distress: true };
t('agitation stays risperidone first', DE.plan(B({})).first[0].k === 'ris');
t('brexpiprazole stays an alternative', ids(ch('agit', {}), 'alt').includes('brex'));
t('antipsychotic timeline covers after stopping', DE.plan(B({})).tl.find(x => x[0] === 120)[2].includes('停藥後至少 4 個月'));
t('depression: no antidepressant first', ids(ch('dep', depB), 'first')[0] === 'none2' && DE.plan(B(depB)).first.length === 0);
t('depression: note cites HTA-SADD', ch('dep', depB)[0].why.includes('HTA-SADD'));
['ser', 'esc', 'mir'].forEach(k => t('depression: ' + k + ' alternative', ids(ch('dep', depB), 'alt').includes(k)));
t('depression: no SSRI schedule', DE.plan(B(depB)).useSSRI === false);

/* --- map --- */
t('map sides', MAP.dx.length >= 5 && MAP.tx.length >= 5);
[...MAP.dx, ...MAP.tx].forEach(b => t('branch ' + b.t, b.t && b.s && b.l.length >= 2 && b.l.every(x => x.length === 2)));

/* --- page wiring --- */
['tab-cases', 'tab-quiz', 'tab-map', 'id="cs-list"', 'id="qz-box"', 'id="mm-wrap"', 'id="bpsd-flow"'].forEach(s => t('html has ' + s, html.includes(s)));
t('only one id="map"', (html.match(/id="map"/g) || []).length === 1);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
