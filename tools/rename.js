#!/usr/bin/env node
/*
 * 파츠 이름(id = 파일 이름) 바꾸기. 예전 이름으로 된 조합 코드·자랑 게시판 글·저장해 둔 기록이 깨지지 않게 한 번에 맞춘다.
 *
 *   node tools/rename.js <항목> <예전id> <새id> [<항목> <예전id> <새id> ...]
 *   node tools/rename.js --map 이름표.json        ([["back","twinhigh","twin-high-m"], ...])
 *   --dry 를 붙이면 바꿀 것만 보여 준다.
 *
 * 하는 일
 *   1. parts/<항목>/<예전id>.svg → <새id>.svg (파일을 이미 직접 바꿔 놓았으면 그대로 둔다)
 *   2. parts/<항목>/_parts.json: 그 줄의 id 를 새 이름으로, "old" 목록에 예전 이름을 더한다.
 *      core.js 의 normalize 가 "old" 를 보고 예전 코드를 새 파츠로 읽는다(자랑 게시판 글도 페이지가 코드를 읽어 그리므로 그대로 된다).
 *   3. js/prompt.js: 그 항목의 영어 설명(EN)·태그(NAI) 키를 새 이름으로.
 *   4. 그 밖에 예전 이름이 따옴표로 적힌 곳(js/*.js, index.html, sheet.html)을 알려 준다(직접 확인).
 * 끝나면 node tools/build.js 로 빌드하고, 홈페이지에 올릴 때는 평소처럼 sync-character → 배포.
 * "old" 는 지우지 않는다. 지우면 그 이름으로 저장된 코드·게시판 글이 기본 파츠로 바뀐다.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PARTS = path.join(ROOT, 'parts');
const ID_RE = /^[A-Za-z0-9_-]+$/;

const args = process.argv.slice(2);
const dry = args.includes('--dry');
let pairs = [];
const mi = args.indexOf('--map');
if (mi >= 0) pairs = JSON.parse(fs.readFileSync(args[mi + 1], 'utf8'));
else {
  const rest = args.filter((a) => a !== '--dry');
  if (!rest.length || rest.length % 3) {
    console.error('사용법: node tools/rename.js <항목> <예전id> <새id> [...]  또는  --map 이름표.json');
    process.exit(1);
  }
  for (let i = 0; i < rest.length; i += 3) pairs.push(rest.slice(i, i + 3));
}

const readList = (cat) => JSON.parse(fs.readFileSync(path.join(PARTS, cat, '_parts.json'), 'utf8'));
const listText = (list) => '[\n' + list.map((e) => '  ' + JSON.stringify(e)).join(',\n') + '\n]\n';

// ---------- 1. 미리 검사 (하나라도 틀리면 아무것도 바꾸지 않는다) ----------
const lists = {};
const errors = [];
const renames = []; // [from, to]
for (const [cat, from, to] of pairs) {
  if (!ID_RE.test(cat) || !fs.existsSync(path.join(PARTS, cat, '_parts.json'))) { errors.push(cat + ': 항목 폴더가 없습니다'); continue; }
  if (!ID_RE.test(to)) { errors.push(cat + '/' + to + ': 새 이름은 영문, 숫자, -, _ 만'); continue; }
  const list = lists[cat] || (lists[cat] = readList(cat));
  const e = list.find((x) => x.id === from);
  if (!e) { errors.push(cat + '/' + from + ': _parts.json 에 없습니다'); continue; }
  if (from === to) continue;
  if (list.some((x) => x.id === to)) errors.push(cat + '/' + to + ': 이미 있는 이름입니다');
  const a = path.join(PARTS, cat, from + '.svg'), b = path.join(PARTS, cat, to + '.svg');
  if (fs.existsSync(a) && fs.existsSync(b)) errors.push(cat + '/' + to + '.svg 가 이미 있습니다');
  else if (fs.existsSync(a)) renames.push([a, b]);
  else if (!fs.existsSync(b) && !e.none && !e.empty) errors.push(cat + '/' + from + '.svg 도 ' + to + '.svg 도 없습니다');
  e.old = Array.from(new Set((e.old || []).concat(from).filter((x) => x !== to)));
  e.id = to;
}
// 한 항목 안에서 새 이름이 다른 파츠의 예전 이름과 겹치면 예전 코드가 엉뚱한 파츠로 읽힌다
for (const cat of Object.keys(lists)) {
  const ids = new Set(), olds = new Map();
  for (const e of lists[cat]) {
    if (ids.has(e.id)) errors.push(cat + '/' + e.id + ': 같은 이름이 둘');
    ids.add(e.id);
    for (const o of e.old || []) olds.set(o, e.id);
  }
  for (const [o, owner] of olds) if (ids.has(o) && o !== owner) errors.push(cat + '/' + o + ': 지금 이름이면서 ' + owner + ' 의 예전 이름이기도 합니다');
}
if (errors.length) { console.error('바꾸지 않았습니다:\n  ' + errors.join('\n  ')); process.exit(1); }

// ---------- 3. prompt.js 키 ----------
const promptFile = path.join(ROOT, 'js', 'prompt.js');
let prompt = fs.readFileSync(promptFile, 'utf8');
const keyOf = (id) => (/^[A-Za-z_$][\w$]*$/.test(id) ? id : "'" + id + "'");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
let promptHits = 0;
for (const [cat, from, to] of pairs) {
  if (from === to) continue;
  // 그 항목의 묶음 안에서만 바꾼다: EN·NAI 의 "    <항목>: {" 와, 뒤에 더한 add(EN, '<항목>', { ... })
  const head = new RegExp('\\n    ' + esc(cat) + ': \\{|add\\((?:EN|NAI), \'' + esc(cat) + '\', \\{', 'g');
  let m, out = '', last = 0;
  while ((m = head.exec(prompt))) {
    let i = m.index + m[0].length, depth = 1;
    while (depth && i < prompt.length) { const ch = prompt[i++]; if (ch === '{') depth++; else if (ch === '}') depth--; }
    const block = prompt.slice(m.index, i);
    const re = new RegExp("([\\s{,])(?:" + esc(from) + "|'" + esc(from) + "')(\\s*:)", 'g');
    const nb = block.replace(re, (_, a, b) => { promptHits++; return a + keyOf(to) + b; });
    out += prompt.slice(last, m.index) + nb;
    last = i;
  }
  prompt = out + prompt.slice(last);
}

// ---------- 4. 그 밖에 예전 이름이 적힌 곳 ----------
const others = [];
const scan = ['js/core.js', 'js/app.js', 'js/palettes.js', 'index.html', 'sheet.html'];
for (const f of scan) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  for (const [, from, to] of pairs) {
    if (from === to) continue;
    const re = new RegExp("['\"]" + esc(from) + "['\"]");
    lines.forEach((l, n) => { if (re.test(l)) others.push(f + ':' + (n + 1) + '  ' + from + ' → ' + to + '  ' + l.trim().slice(0, 120)); });
  }
}

console.log((dry ? '[미리보기] ' : '') + '이름 ' + pairs.filter((p) => p[1] !== p[2]).length + '개, 파일 ' + renames.length + '개, 프롬프트 키 ' + promptHits + '개');
if (others.length) console.log('직접 확인할 곳:\n  ' + others.join('\n  '));
if (dry) process.exit(0);

// 로컬 서버(start.bat)는 parts 폴더가 바뀌면 0.4초 뒤에 빌드한다. 파일과 목록을 한꺼번에 바꿔야 그 빌드가 목록 줄을 지우지 않는다
for (const [a, b] of renames) fs.renameSync(a, b);
for (const cat of Object.keys(lists)) fs.writeFileSync(path.join(PARTS, cat, '_parts.json'), listText(lists[cat]), 'utf8');
fs.writeFileSync(promptFile, prompt, 'utf8');
console.log('완료. node tools/build.js 로 빌드하세요.');
