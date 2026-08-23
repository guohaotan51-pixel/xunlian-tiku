/* 询练 — 电子商务师题库 PWA
 * Long-form offline question-bank practice app.
 * Vanilla JS, no dependencies. Data lives in window.QUESTION_BANK.
 */
(function () {
  'use strict';
  const APP_VERSION = 'v3.0';

  /* ---------------- Storage ---------------- */
  const STORE_KEY = 'xunlian_progress_v1';
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { q: {}, papers: 0, sessions: [] };
  }
  function saveProgress() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) {}
  }
  let progress = loadProgress();

  function getState(qid, create) {
    let st = progress.q[qid];
    if (!st && create !== false) {
      st = progress.q[qid] = { wrong: 0, correct: 0, streak: 0, seen: false, firstTryCorrect: false, note: '' };
    }
    return st;
  }

  /* ---------------- Question status tags (未练习 > 错题 > 已练习) ---------------- */
  const STATUS = {
    unseen:   { key: 'unseen',   label: '未练习',   pill: 'st-unseen' },
    wrong:    { key: 'wrong',    label: '错题',     pill: 'st-wrong' },
    correct:  { key: 'correct',  label: '已练习',   pill: 'st-correct' },
    correct2: { key: 'correct2', label: '连续正确', pill: 'st-correct2' },
    mastered: { key: 'mastered', label: '已掌握',   pill: 'st-mastered' },
  };
  function statusOf(id) {
    const st = progress.q[id];
    if (!st || !st.seen) return STATUS.unseen;
    if (st.wrong > 0 && st.streak < 3) return STATUS.wrong;
    if (st.streak >= 3) return STATUS.mastered;   // 连续正确>=3，不再推送
    if (st.streak >= 2) return STATUS.correct2;
    return STATUS.correct;
  }
  function isPushable(id) { return statusOf(id).key !== 'mastered'; }

  /* ---------------- App state ---------------- */
  const state = {
    view: 'home',
    subject: 'dianzi',
    mode: 'paper',
    paperSize: 20,
    specialType: 'single',
    specialCount: 10,
    order: 'ordered',    // 'ordered' 顺序(按题号) / 'shuffle' 乱序
    mix: true,           // 侧重未练/错题优先推送
    session: null,       // active practice session
    errorsFilter: 'all',
    lastResult: null,
  };

  const SUB = {
    dianzi: { name: '电子', full: '电子商务师（电子）' },
    zhubo:  { name: '主播', full: '网络直播（主播）' },
  };
  const TYPE = {
    single:   { name: '单选', clazz: 'qt-single' },
    multi:    { name: '多选', clazz: 'qt-multi' },
    judgment: { name: '判断', clazz: 'qt-judgment' },
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ---------------- View switching ---------------- */
  const VIEWS = ['home', 'setup', 'session', 'result', 'errors', 'photo', 'stats', 'about'];
  function showView(name) {
    state.view = name;
    VIEWS.forEach((v) => {
      const el = $('#view-' + v);
      if (el) el.classList.toggle('active', v === name);
    });
    const nav = $('#bottom-nav');
    const navMap = { home: 'home', errors: 'errors', photo: 'photo', stats: 'stats', about: 'about' };
    $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === (navMap[name] || 'home')));
    window.scrollTo(0, 0);
  }

  /* ---------------- Recommendation & selection (未练习>错题>已练习, 掌握≥3不推送) ---------------- */
  function questionWeight(item) {
    const s = statusOf(item.id).key;
    if (s === 'mastered') return 0;        // 连续正确≥3：不再推送
    if (s === 'unseen') return 4;          // 优先未练习
    if (s === 'wrong') return 3;           // 其次错题
    if (s === 'correct2') return 1.2;      // 已连续正确
    return 1;                              // 已练习正确（最低优先）
  }

  function sampleWeighted(pool, n) {
    const copy = pool.slice();
    const out = [];
    while (out.length < n && copy.length) {
      const weights = copy.map((it) => questionWeight(it));
      const total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total;
      let idx = copy.length - 1;
      for (let k = 0; k < copy.length; k++) { r -= weights[k]; if (r <= 0) { idx = k; break; } }
      out.push(copy[idx]);
      copy.splice(idx, 1);
    }
    return out;
  }

  // 顺序模式：按题号从小到大推送未练习，自动跳过已练习，偶尔穿插错题；未练+错题不足时再补已练习。
  function orderedSelect(pool, count, emphasize) {
    const unseen = pool.filter((q) => statusOf(q.id).key === 'unseen').sort((a, b) => a.num - b.num);
    const wrongs = pool.filter((q) => statusOf(q.id).key === 'wrong');
    const rest = pool.filter((q) => { const k = statusOf(q.id).key; return k === 'correct' || k === 'correct2'; }).sort((a, b) => a.num - b.num);
    const seq = [];
    let ui = 0, wi = 0, ri = 0, spot = 0;
    while (seq.length < count && (ui < unseen.length || wi < wrongs.length || ri < rest.length)) {
      const sprinkle = emphasize && wi < wrongs.length && seq.length > 0 && (spot % 3 === 2);
      if (sprinkle) {
        seq.push(wrongs[wi++]);
      } else if (ui < unseen.length) {
        seq.push(unseen[ui++]);
      } else if (wi < wrongs.length) {
        seq.push(wrongs[wi++]);
      } else if (ri < rest.length) {
        seq.push(rest[ri++]);
      } else {
        break;
      }
      spot++;
    }
    return seq;
  }

  function selectFromPool(pool, count, mode, emphasize) {
    if (mode === 'ordered') return orderedSelect(pool, count, emphasize);
    // 乱序：优先未练/错题（emphasize），但始终排除“已掌握(≥3连续正确)”
    const pushable = pool.filter((q) => isPushable(q.id));
    if (!emphasize || !pushable.length) { shuffle(pushable); return pushable.slice(0, count); }
    return sampleWeighted(pushable, Math.min(count, pushable.length));
  }

  function mixCounts(total, bank) {
    const s = bank.single.length, m = bank.multi.length, j = bank.judgment.length;
    let ns = Math.max(1, Math.min(s, Math.round(total * 0.5)));
    let nm = Math.max(1, Math.min(m, Math.round(total * 0.3)));
    let nj = Math.max(1, Math.min(j, Math.round(total * 0.2)));
    const avail = s + m + j;
    total = Math.min(total, avail);
    let guard = 0;
    while ((ns + nm + nj) !== total && guard++ < 40) {
      const cur = ns + nm + nj;
      const types = [
        ['single', () => ns, (v) => { ns = v; }, s],
        ['multi', () => nm, (v) => { nm = v; }, m],
        ['judgment', () => nj, (v) => { nj = v; }, j],
      ];
      if (cur < total) {
        const head = types.map((t) => ({ k: t[0], v: t[1](), cap: t[3] }));
        head.sort((a, b) => (b.cap - b.v) - (a.cap - a.v));
        const hh = head[0];
        if (hh.k === 'single') ns++; else if (hh.k === 'multi') nm++; else nj++;
      } else {
        const canRemove = types.filter((t) => t[1]() > 1);
        if (!canRemove.length) break;
        const rr = canRemove[canRemove.length - 1][0];
        if (rr === 'single') ns--; else if (rr === 'multi') nm--; else nj--;
      }
    }
    return { single: ns, multi: nm, judgment: nj };
  }

  function buildPaperQueue(subject, config) {
    const bank = QUESTION_BANK.subjects[subject].sections;
    const c = mixCounts(config.size, bank);
    let qs = [];
    qs = qs.concat(selectFromPool(bank.single, c.single, config.order, config.mix));
    qs = qs.concat(selectFromPool(bank.multi, c.multi, config.order, config.mix));
    qs = qs.concat(selectFromPool(bank.judgment, c.judgment, config.order, config.mix));
    if (config.order === 'shuffle') shuffle(qs);
    return qs;
  }
  function buildSpecialQueue(subject, config) {
    const bank = QUESTION_BANK.subjects[subject].sections[config.type];
    return selectFromPool(bank, Math.min(config.count, bank.length), config.order, config.mix);
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  /* ---------------- Correctness / progress ---------------- */
  function isCorrect(item, picked) {
    if (item.type === 'judgment') return picked === item.answer;
    const k = Array.isArray(picked) ? picked : [picked];
    const a = item.answer.slice().sort();
    return k.length === a.length && k.slice().sort().join('') === a.join('');
  }
  function recordAnswer(item, correct) {
    const st = getState(item.id, false) || getState(item.id, true);
    const wasSeen = st.seen;
    st.seen = true;
    if (correct) {
      st.correct = (st.correct || 0) + 1;
      st.streak = (st.streak || 0) + 1;
      if (!wasSeen) st.firstTryCorrect = true; // answered correctly on very first encounter
    } else {
      st.wrong = (st.wrong || 0) + 1;
      st.streak = 0;
      st.firstTryCorrect = false;
    }
    saveProgress();
  }
  function isInErrorBook(st) { return st && st.wrong > 0 && st.streak < 3; }

  /* ---------------- Session ---------------- */
  function startSession(mode) {
    const subject = state.subject;
    const cfg = { order: state.order, mix: state.mix };
    let questions;
    if (mode === 'paper') questions = buildPaperQueue(subject, Object.assign({ size: state.paperSize }, cfg));
    else questions = buildSpecialQueue(subject, Object.assign({ type: state.specialType, count: state.specialCount }, cfg));

    if (!questions.length) { alert('该科目/题型暂无题目'); return; }
    state.session = {
      subject, mode, questions,
      index: 0,
      answers: new Array(questions.length).fill(null), // {picked, correct}
    };
    $('#session-title').textContent = `${SUB[subject].name} · ${mode === 'paper' ? '自动组卷' : TYPE[state.specialType].name + '专项'}${state.order === 'ordered' ? '（顺序）' : '（乱序）'}`;
    updateProgress();
    $('.session-foot').classList.add('hidden');
    showView('session');
    renderQuestion();
  }

  let multiSel = []; // for multi-select

  function statusPillHtml(id) {
    const st = statusOf(id);
    return `<span class="pill q-status ${st.pill}">${st.label}</span>`;
  }

  function renderQuestion() {
    const s = state.session;
    const q = s.questions[s.index];
    const ans = s.answers[s.index];
    multiSel = [];
    const body = $('#session-body');
    const typeLabel = TYPE[q.type];
    body.innerHTML = `
      <div class="q-head">
        <span class="q-type ${typeLabel.clazz}">${typeLabel.name}</span>
        ${statusPillHtml(q.id)}
        ${ans ? `<span class="pill q-ans ${ans.correct ? 'st-correct' : 'st-wrong'}">${ans.correct ? '✓ 已答对' : '✗ 已答错'}</span>` : ''}
      </div>
      <div class="q-stem"><span class="q-num">${q.num}.</span>${escapeHtml(q.stem)}</div>
      ${q.type === 'judgment'
        ? `<div class="judge-btns">
             <button class="judge-btn" data-judge="true">√ 正确</button>
             <button class="judge-btn" data-judge="false">× 错误</button>
           </div>`
        : `<div class="opts">${q.options.map((o) =>
             `<button class="opt" data-key="${o.key}"><span class="key">${o.key}</span><span class="txt">${escapeHtml(o.text)}</span></button>`
           ).join('')}</div>
           ${q.type === 'multi' ? '<button class="btn-primary" id="multi-confirm" disabled>确认答案</button>' : ''}`}
      <div id="expl-slot"></div>
    `;

    if (ans) {
      // already answered -> show feedback (review mode)
      if (q.type === 'judgment') markJudge(q, ans.picked);
      else markOptions(q, ans.picked);
      showExplanation(ans.correct, q);
    } else {
      if (q.type === 'single') $$('#session-body .opt').forEach((el) => el.addEventListener('click', () => evaluateSingle(q, el)));
      else if (q.type === 'multi') { $$('#session-body .opt').forEach((el) => el.addEventListener('click', () => toggleMulti(el))); $('#multi-confirm').addEventListener('click', () => evaluateMulti(q)); }
      else $$('#session-body .judge-btn').forEach((el) => el.addEventListener('click', () => evaluate(q, el.dataset.judge === 'true')));
    }
    renderFooter();
  }

  function renderFooter() {
    const s = state.session;
    const n = s.questions.length;
    const done = s.answers.filter(Boolean).length;
    const allDone = done === n;
    const cur = s.answers[s.index];
    const foot = $('.session-foot');
    if (!cur) { foot.classList.add('hidden'); foot.innerHTML = ''; return; }
    foot.classList.remove('hidden');
    let html = '';
    if (s.index > 0) html += '<button class="btn-ghost nav-prev" id="prev-btn">‹ 上一题</button>';
    if (!allDone) html += '<button class="btn-primary nav-next" id="next-btn">下一题 ›</button>';
    else html += '<button class="btn-primary wide" id="go-result">查看结果</button>';
    foot.innerHTML = html;
    const pb = $('#prev-btn'); if (pb) pb.addEventListener('click', () => goIndex(s.index - 1));
    const nb = $('#next-btn'); if (nb) nb.addEventListener('click', () => goIndex(s.index + 1));
    const gr = $('#go-result'); if (gr) gr.addEventListener('click', () => showResult());
  }

  function goIndex(i) {
    const s = state.session;
    if (i < 0) i = 0;
    if (i >= s.questions.length) { showResult(); return; }
    s.index = i;
    updateProgress();
    renderQuestion();
    window.scrollTo(0, 0);
  }

  function updateProgress() {
    const s = state.session;
    $('#session-progress').textContent = `${s.index + 1} / ${s.questions.length}`;
  }

  function evaluateSingle(q, el) {
    const key = el.dataset.key;
    markOptions(q, [key]);
    const correct = q.answer[0] === key;
    finishAnswer(q, [key], correct);
  }
  function toggleMulti(el) {
    const key = el.dataset.key;
    if (!multiSel.includes(key)) multiSel.push(key); else multiSel = multiSel.filter((k) => k !== key);
    el.classList.toggle('sel', multiSel.includes(key));
    $('#multi-confirm').disabled = multiSel.length === 0;
  }
  function evaluateMulti(q) {
    markOptions(q, multiSel);
    const correct = isCorrect(q, multiSel);
    finishAnswer(q, multiSel.slice(), correct);
  }
  function evaluate(q, picked) {
    markJudge(q, picked);
    const correct = isCorrect(q, picked);
    finishAnswer(q, picked, correct);
  }

  function markOptions(q, picked) {
    $$('#session-body .opt').forEach((el) => {
      const k = el.dataset.key;
      const isCorrectKey = q.answer.includes(k);
      const isPicked = picked.includes(k);
      el.disabled = true;
      if (isPicked && isCorrectKey) el.classList.add('correct');
      else if (isPicked && !isCorrectKey) el.classList.add('wrong');
      else if (!isPicked && isCorrectKey) el.classList.add('correct', 'dim');
      else el.classList.add('dim');
    });
  }

  function markJudge(q, picked) {
    $$('#session-body .judge-btn').forEach((b) => {
      const isPicked = (b.dataset.judge === 'true') === picked;
      b.disabled = true;
      if (isPicked) b.classList.add(picked === q.answer ? 'correct' : 'wrong');
    });
  }

  function showExplanation(correct, q) {
    const expl = $('#expl-slot');
    expl.innerHTML = `<div class="expl"><b>${correct ? '回答正确' : '回答错误'}</b><div class="en">${escapeHtml(q.explanation || '')}</div></div>`;
  }

  function finishAnswer(q, picked, correct) {
    const s = state.session;
    s.answers[s.index] = { picked, correct };
    recordAnswer(q, correct);
    showExplanation(correct, q);
    renderFooter();
    $('#session-body').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- Result ---------------- */
  function starEval(pct) {
    if (pct >= 100) return { stars: 5, msg: '满分！你是最棒的！！', emoji: '🏆', sub: '全部答对，无可挑剔！' };
    if (pct >= 95) return { stars: 5, msg: '接近满分，你是最棒的！！', emoji: '🤩', sub: '只差一点点，继续保持！' };
    if (pct >= 90) return { stars: 4, msg: '你是最棒的！！', emoji: '😄', sub: '正确率超九成，非常优秀！' };
    if (pct >= 80) return { stars: 4, msg: '很棒，继续加油！', emoji: '😊', sub: '已经相当出色了！' };
    if (pct >= 70) return { stars: 3, msg: '不错哦，再接再厉！', emoji: '🙂', sub: '多练几套会更稳！' };
    if (pct >= 60) return { stars: 2, msg: '有进步！多练练会更好～', emoji: '😐', sub: '把错题再过一遍吧。' };
    return { stars: 1, msg: '别灰心，去错题集再练一遍吧！', emoji: '😅', sub: '坚持就是胜利。' };
  }
  function starHtml(stars) {
    let h = '';
    for (let i = 1; i <= 5; i++) h += `<span class="star ${i <= stars ? 'on' : ''}">★</span>`;
    return h;
  }

  function showResult() {
    const s = state.session;
    const results = s.answers.filter(Boolean);
    const total = results.length;
    const correct = results.filter((r) => r.correct).length;
    const wrong = total - correct;
    const pct = total ? Math.round((correct / total) * 100) : 0;
    progress.papers = (progress.papers || 0) + 1;
    saveProgress();
    const se = starEval(pct);
    const byType = {};
    results.forEach((r, i) => {
      const t = s.questions[i].type;
      byType[t] = byType[t] || { c: 0, n: 0 };
      byType[t].n++; if (r.correct) byType[t].c++;
    });
    const typeStats = Object.keys(byType).map((t) => `
      <div class="stat-box"><div class="n">${byType[t].c}/${byType[t].n}</div><div class="l">${TYPE[t].name}</div></div>`).join('');
    $('#result-body').innerHTML = `
      <div class="result-hero">
        <div class="result-emoji">${se.emoji}</div>
        <div class="stars">${starHtml(se.stars)}</div>
        <div class="result-msg">${se.msg}</div>
        <div class="result-sub">${se.sub}</div>
      </div>
      <div class="score-big">${pct}%</div>
      <div class="score-sub">完成 ${total} 题 · 答对 ${correct} · 答错 ${wrong}</div>
      <div class="stat-grid">${typeStats}</div>
      <div class="stat-grid">
        <div class="stat-box"><div class="n">${progress.papers}</div><div class="l">累计试卷</div></div>
        <div class="stat-box"><div class="n">${errorCount()}</div><div class="l">当前错题</div></div>
        <div class="stat-box"><div class="n">${accuracyAll()}</div><div class="l">总正确率</div></div>
      </div>
      <button class="btn-primary" id="retry-btn">再练一遍</button>
      <button class="btn-primary" id="back-home" style="background:#d9d5c9;color:var(--ink);box-shadow:none">返回首页</button>
    `;
    $('#retry-btn').addEventListener('click', () => startSession(s.mode));
    $('#back-home').addEventListener('click', () => showView('home'));
    refreshHomeBadge();
    showView('result');
  }

  /* ---------------- Error book ---------------- */
  function errorQuestionIds(subjectFilter, typeFilter) {
    const ids = [];
    for (const id in progress.q) {
      const st = progress.q[id];
      if (!isInErrorBook(st)) continue;
      const item = findQuestion(id);
      if (!item) continue;
      if (subjectFilter && item.subject !== subjectFilter) continue;
      if (typeFilter && typeFilter !== 'all' && item.type !== typeFilter) continue;
      ids.push(id);
    }
    return ids;
  }
  function errorCount(subjectFilter) {
    let n = 0;
    for (const id in progress.q) { const st = progress.q[id]; if (isInErrorBook(st)) n++; }
    return n;
  }
  function findQuestion(id) {
    for (const sub of Object.keys(QUESTION_BANK.subjects)) {
      for (const t of ['single', 'multi', 'judgment']) {
        const it = QUESTION_BANK.subjects[sub].sections[t].find((q) => q.id === id);
        if (it) return Object.assign({ subject: sub }, it);
      }
    }
    return null;
  }

  function renderErrors() {
    const filter = state.errorsFilter;
    const ids = errorQuestionIds(null, filter);
    const body = $('#errors-body');
    const counts = { all: 0, single: 0, multi: 0, judgment: 0 };
    errorQuestionIds(null, 'all').forEach((id) => { const it = findQuestion(id); if (it) counts[it.type]++; });
    counts.all = counts.single + counts.multi + counts.judgment;
    body.innerHTML = `
      <div class="filter-seg">
        <button data-f="all" class="${filter === 'all' ? 'active' : ''}">全部 ${counts.all}</button>
        <button data-f="single" class="${filter === 'single' ? 'active' : ''}">单选 ${counts.single}</button>
        <button data-f="multi" class="${filter === 'multi' ? 'active' : ''}">多选 ${counts.multi}</button>
        <button data-f="judgment" class="${filter === 'judgment' ? 'active' : ''}">判断 ${counts.judgment}</button>
      </div>
      ${ids.length === 0
        ? '<div class="empty">🎉 暂无错题，继续保持！</div>'
        : `<button class="btn-primary" id="review-errors">开始复习 (${ids.length} 题)</button>
           <div style="height:12px"></div>
           ${ids.map((id) => errorItemHtml(id)).join('')}`}
    `;
    $$('.filter-seg button').forEach((b) => b.addEventListener('click', () => { state.errorsFilter = b.dataset.f; renderErrors(); }));
    const rv = $('#review-errors');
    if (rv) rv.addEventListener('click', () => startErrorSession(ids));
    $$('.err-item .review').forEach((b) => b.addEventListener('click', () => startErrorSession([b.dataset.id])));
    $$('.err-item .remove').forEach((b) => b.addEventListener('click', () => { forgetError(b.dataset.id); renderErrors(); refreshHomeBadge(); }));
    $$('.err-item').forEach((el) => el.addEventListener('click', (e) => { if (e.target.closest('button')) return; openQuestionById(el.dataset.id, el); }));
  }

  function errorItemHtml(id) {
    const it = findQuestion(id); if (!it) return '';
    const st = progress.q[id];
    const wrong = st.wrong || 0;
    const typeLabel = TYPE[it.type];
    return `
      <div class="err-item" data-id="${id}">
        <div class="st"><span class="q-num">${it.num}.</span>${escapeHtml(it.stem)}</div>
        <div class="meta">
          <span class="pill ${typeLabel.clazz === 'qt-multi' ? '' : ''}">${typeLabel.name}</span>
          <span class="pill">错 ${wrong} 次</span>
          <span class="pill">连续对 ${st.streak || 0}/3</span>
          ${wrong >= 2 ? '<span class="pill hot">易错</span>' : ''}
          <button class="pill review" data-id="${id}" style="background:var(--accent-soft);color:var(--accent-dark)">复习</button>
          <button class="pill remove" data-id="${id}" style="background:var(--bg);color:var(--ink-soft)">移除</button>
        </div>
      </div>`;
  }

  function forgetError(id) { const st = progress.q[id]; if (st) { st.wrong = Math.max(0, (st.wrong || 0) - 1); if (st.wrong === 0) { st.streak = 0; } } saveProgress(); }

  function startErrorSession(ids) {
    const qs = ids.map((id) => findQuestion(id)).filter(Boolean);
    if (!qs.length) return;
    state.subject = qs[0].subject;
    state.session = { subject: state.subject, mode: 'error', questions: qs, index: 0, answers: new Array(qs.length).fill(null) };
    $('#session-title').textContent = '错题复习';
    $('#session-progress').textContent = `1 / ${qs.length}`;
    $('.session-foot').classList.add('hidden');
    showView('session');
    renderQuestion();
  }

  function openQuestionById(id) {
    const it = findQuestion(id); if (!it) return;
    state.session = { subject: it.subject, mode: 'singleview', questions: [it], index: 0, answers: [null] };
    $('#session-title').textContent = '查看题目';
    $('#session-progress').textContent = '1 / 1';
    $('.session-foot').classList.add('hidden');
    showView('session');
    renderQuestion();
  }

  /* ---------------- Home badge ---------------- */
  function refreshHomeBadge() {
    const n = errorCount();
    $('#error-badge').textContent = `当前 ${n} 题`;
  }

  /* ---------------- Photo recognition ---------------- */
  let photoImg = null;      // 原始选中的图 (dataURL)
  let photoData = null;     // 实际用于识别的图（裁剪后或整图）
  let cropRect = null;      // {x,y,w,h} 原图坐标（＝参考框当前覆盖区域）
  let edImg = null, natW = 0, natH = 0, tx = 0, ty = 0, scale = 1, minScale = 1;
  let pointers = new Map(), panning = null, pinch = null;
  const VIEW_H = 300;       // 裁剪视口高度
  const OCR_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  let ocrLoaded = false, ocrWorker = null;

  function renderPhoto() {
    const body = $('#photo-body');
    photoImg = null; photoData = null; cropRect = null; edImg = null;
    body.innerHTML = `
      <input type="file" id="photo-input" accept="image/*" capture="environment" style="display:none">
      <button class="btn-primary" id="photo-take">📷 拍照 / 选择图片</button>
      <p class="hint" style="margin:6px 0">按住拖动图片、用 +/− 或双指缩放，把题目对准中间的<b>参考框</b>，再用「✂️ 裁剪选中」</p>
      <div class="shoteditor" id="shoteditor"><span class="hint">选择图片后拖动对准</span></div>
      <div class="btn-row">
        <button class="btn-ghost zoombtn" id="photo-zoomout" disabled>−</button>
        <button class="btn-ghost zoombtn" id="photo-zoomin" disabled>＋</button>
        <button class="btn-ghost" id="photo-crop" disabled>✂️ 裁剪选中</button>
        <button class="btn-ghost" id="photo-reset" disabled>重置</button>
      </div>
      <div class="cropInfo" id="cropInfo">选择区域：宽 0 × 高 0 px</div>
      <label class="label" style="margin-top:4px">裁剪预览（用于识别）</label>
      <div class="shot" id="photo-preview">尚未裁剪</div>
      <div class="btn-row">
        <button class="btn-ghost" id="photo-ocr" disabled>🔤 识别</button>
        <button class="btn-ghost" id="photo-clear" style="border-color:var(--line);color:var(--ink-soft)">清除</button>
      </div>
      <label class="label" style="margin-top:4px">识别失败可手动输入题干关键词</label>
      <input class="search-in" id="photo-q" placeholder="例如：CPM 千次展示成本">
      <button class="btn-primary" id="photo-search" style="margin-top:8px">比对题库（直接给出答案）</button>
      <div id="photo-results"></div>
    `;
    $('#photo-take').addEventListener('click', () => $('#photo-input').click());
    $('#photo-input').addEventListener('change', onPhotoPick);
    $('#photo-zoomin').addEventListener('click', () => zoomAt(scale * 1.25));
    $('#photo-zoomout').addEventListener('click', () => zoomAt(scale / 1.25));
    $('#photo-crop').addEventListener('click', doCrop);
    $('#photo-reset').addEventListener('click', resetCrop);
    $('#photo-ocr').addEventListener('click', () => runOcr());
    $('#photo-clear').addEventListener('click', clearPhoto);
    $('#photo-search').addEventListener('click', onPhotoSearch);
    $('#photo-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') onPhotoSearch(); });

    // 拖动/双指缩放：pointerdown 在编辑区，move/up 挂 document（全局只挂一次）
    $('#shoteditor').addEventListener('pointerdown', onPanStart);
    if (!renderPhoto._panBound) {
      document.addEventListener('pointermove', onPanMove);
      document.addEventListener('pointerup', onPanEnd);
      document.addEventListener('pointercancel', onPanEnd);
      renderPhoto._panBound = true;
    }
  }

  function onPhotoPick(e) {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { photoImg = rd.result; photoData = photoImg; cropRect = null; renderShotEditor(); };
    rd.readAsDataURL(f);
  }

  function renderShotEditor() {
    const ed = $('#shoteditor');
    ed.innerHTML = '';
    ed.style.height = VIEW_H + 'px';
    const img = document.createElement('img');
    img.className = 'cropimg';
    img.src = photoImg;
    img.onload = () => {
      edImg = img;
      natW = img.naturalWidth; natH = img.naturalHeight;
      const vw = ed.clientWidth || natW;
      minScale = vw / natW; scale = minScale; tx = 0; ty = 0;
      ed.appendChild(img);
      // 固定参考框（拍题软件风格）
      const sf = document.createElement('div'); sf.className = 'scanframe'; sf.id = 'scanframe';
      sf.innerHTML = `<span class="sfcorner tl"></span><span class="sfcorner tr"></span><span class="sfcorner bl"></span><span class="sfcorner br"></span><span class="sftag">请将题目对准此框</span>`;
      ed.appendChild(sf);
      applyTransform(); updateCropRange();
    };
  }

  function applyTransform() {
    if (edImg) edImg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  function frameRect() {
    const vw = $('#shoteditor').clientWidth || natW || 1;
    const fw = vw * 0.86, fh = VIEW_H * 0.52;
    return { fx: (vw - fw) / 2, fy: (VIEW_H - fh) / 2, fw, fh };
  }

  function updateCropRange() {
    if (!edImg) return;
    const f = frameRect();
    let nx = (f.fx - tx) / scale, ny = (f.fy - ty) / scale, nw = f.fw / scale, nh = f.fh / scale;
    nx = clamp(nx, 0, natW); ny = clamp(ny, 0, natH); nw = clamp(nw, 0, natW - nx); nh = clamp(nh, 0, natH - ny);
    cropRect = { x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) };
    const info = $('#cropInfo');
    if (info) info.textContent = `选择区域：宽 ${cropRect.w} × 高 ${cropRect.h} px（约占图 ${Math.round(cropRect.w / natW * 100)}% × ${Math.round(cropRect.h / natH * 100)}%）`;
    updateEditorBtns();
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function bminX() { const vw = $('#shoteditor').clientWidth || natW || 1; return Math.min(0, vw - natW * scale); }
  function bmaxX() { return 0; }
  function bminY() { return Math.min(0, VIEW_H - natH * scale); }
  function bmaxY() { return 0; }

  function onPanStart(ev) {
    if (!edImg) return;
    ev.preventDefault();
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 1) panning = { x: ev.clientX, y: ev.clientY, tx, ty };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(b.x - a.x, b.y - a.y), scale };
    }
  }
  function onPanMove(ev) {
    if (!edImg || !pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 1 && panning) {
      tx = clamp(panning.tx + (ev.clientX - panning.x), bminX(), bmaxX());
      ty = clamp(panning.ty + (ev.clientY - panning.y), bminY(), bmaxY());
      applyTransform(); updateCropRange();
    } else if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const target = pinch.scale * (d / pinch.dist);
      zoomAt(target, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      pinch.dist = d;
    }
  }
  function onPanEnd(ev) {
    pointers.delete(ev.pointerId);
    if (pointers.size < 1) panning = null;
    if (pointers.size < 2) pinch = null;
  }

  function zoomAt(newScale, anchor) {
    if (!edImg) return;
    const vw = $('#shoteditor').clientWidth;
    newScale = clamp(newScale, minScale, minScale * 6);
    const ax = anchor ? anchor.x : vw / 2;
    const ay = anchor ? anchor.y : VIEW_H / 2;
    const cx = (ax - tx) / scale, cy = (ay - ty) / scale;
    tx = ax - cx * newScale; ty = ay - cy * newScale;
    scale = newScale;
    tx = clamp(tx, bminX(), bmaxX()); ty = clamp(ty, bminY(), bmaxY());
    applyTransform(); updateCropRange();
  }

  function updateEditorBtns() {
    const has = !!photoImg;
    $('#photo-crop').disabled = !has || !(cropRect && cropRect.w > 12 && cropRect.h > 12);
    $('#photo-reset').disabled = !has;
    $('#photo-zoomin').disabled = !has;
    $('#photo-zoomout').disabled = !has;
    $('#photo-ocr').disabled = !has;
  }

  function doCrop() {
    if (!cropRect || cropRect.w < 12 || cropRect.h < 12) { alert('请先把题目对准参考框并裁剪'); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = cropRect.w; c.height = cropRect.h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h);
      photoData = c.toDataURL('image/png');
      $('#photo-preview').innerHTML = `<img src="${photoData}" alt="crop">`;
      $('#photo-ocr').textContent = '🔤 识别（已裁剪）';
    };
    img.src = photoImg;
  }

  function resetCrop() {
    if (!edImg) return;
    scale = minScale; tx = 0; ty = 0;
    photoData = photoImg;
    $('#photo-preview').innerHTML = `<img src="${photoImg}" alt="full">`;
    $('#photo-ocr').textContent = '🔤 识别';
    applyTransform(); updateCropRange();
  }

  function clearPhoto() {
    photoImg = null; photoData = null; cropRect = null; edImg = null;
    $('#shoteditor').style.height = '';
    $('#shoteditor').innerHTML = '<span class="hint">选择图片后拖动对准</span>';
    $('#photo-preview').innerHTML = '尚未裁剪';
    $('#photo-q').value = '';
    $('#photo-results').innerHTML = '';
    $('#photo-ocr').textContent = '🔤 识别';
    updateEditorBtns();
  }

  // 识别前预处理：缩小到合理尺寸 + 灰度 + 提对比度，大幅提速并减少乱码
  function preprocess(src, maxDim) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        const sc = Math.min(1, maxDim / Math.max(w, h));
        const cw = Math.max(2, Math.round(w * sc)), ch = Math.max(2, Math.round(h * sc));
        const c = document.createElement('canvas'); c.width = cw; c.height = ch;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        const d = ctx.getImageData(0, 0, cw, ch);
        const px = d.data;
        for (let i = 0; i < px.length; i += 4) {
          const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          const v = (g - 128) * 1.35 + 128; // 提高对比度，压低噪点
          const cl = v < 0 ? 0 : (v > 255 ? 255 : v);
          px[i] = px[i + 1] = px[i + 2] = cl;
        }
        ctx.putImageData(d, 0, 0);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });
  }

  async function runOcr() {
    if (!photoData) { alert('请先拍照/选择图片'); return; }
    const btn = $('#photo-ocr');
    btn.disabled = true; btn.textContent = '识别中…（首次需联网下载模型）';
    try {
      await ensureOcr(btn);
      btn.textContent = '识别中…';
      const prep = await preprocess(photoData, 1100);
      const { data } = await ocrWorker.recognize(prep);
      const text = (data.text || '').replace(/\s+/g, ' ').trim();
      if (text) { $('#photo-q').value = text; onPhotoSearch(); }
      else { $('#photo-q').placeholder = '未识别到文字，请手动输入关键词'; alert('未识别到文字，可手动输入'); }
    } catch (err) {
      btn.textContent = '识别失败，请手动输入';
    } finally { btn.disabled = false; updateEditorBtns(); }
  }

  function ensureOcr(btn) {
    if (ocrWorker) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const logger = (m) => {
        if (!btn) return;
        const p = m && m.progress ? ' ' + Math.round(m.progress * 100) + '%' : '';
        if (m && m.status) btn.textContent = '识别中…' + p;
      };
      if (ocrLoaded) { resolve(); return; }
      const s = document.createElement('script');
      s.src = OCR_URL; s.async = true;
      s.onload = () => {
        ocrLoaded = true;
        try {
          // eslint-disable-next-line no-undef
          const w = Tesseract.createWorker('chi_sim+eng', 1, { logger });
          w.then(async (worker) => {
            // PSM 6：把画面当作“单个文字块”，适合识别单道题，减少乱码
            try { await worker.setParameters({ tessedit_pageseg_mode: '6' }); } catch (e) {}
            ocrWorker = worker; resolve();
          }).catch(reject);
        } catch (e) { reject(e); }
      };
      s.onerror = () => reject(new Error('load fail'));
      document.head.appendChild(s);
    });
  }

  function normText(s) { return (s || '').toLowerCase().replace(/[\s，。；、：（）()〔〕【】""''"“”‘’·.—\-_/\\,.!?！？:;]/g, ''); }

  function answerText(q) {
    if (q.type === 'judgment') return q.answer === true ? '正确（√）' : '错误（×）';
    if (q.type === 'single') return q.answer[0];
    return q.answer.join('、');
  }

  // 从一段文字（OCR结果或关键词）里找出多道匹配题目，并直接给出答案
  function matchQuestionsInText(raw) {
    const nText = normText(raw);
    if (nText.length < 2) return [];
    const res = [];
    for (const sub of Object.keys(QUESTION_BANK.subjects)) {
      for (const t of Object.keys(QUESTION_BANK.subjects[sub].sections)) {
        for (const q of QUESTION_BANK.subjects[sub].sections[t]) {
          const nStem = normText(q.stem);
          const hay = normText(q.stem + ' ' + q.options.map((o) => o.text).join(' '));
          // 方向A：关键词出现在题干/选项中（用户输入短词）
          let a = 0; for (const ch of nText) if (hay.includes(ch)) a++;
          const aF = nText.length ? a / nText.length : 0;
          // 方向B：题干字符按序出现在整段文字中（OCR 较长文本，可同时命中多题）
          let b = 0, idx = 0;
          for (const ch of nStem) { const j = nText.indexOf(ch, idx); if (j >= 0) { b++; idx = j + 1; } }
          const bF = nStem.length ? b / nStem.length : 0;
          const sc = Math.max(aF, bF);
          if ((aF >= 0.6 && nText.length >= 2) || (bF >= 0.6 && nStem.length >= 8)) {
            res.push({ q, sub, score: sc, bF });
          }
        }
      }
    }
    res.sort((a, b) => (b.score - a.score) || (b.bF - a.bF));
    return res.slice(0, 6);
  }

  function renderMatches(results) {
    const box = $('#photo-results');
    if (!results.length) { box.innerHTML = '<div class="empty">未找到匹配题目，请换关键词或调整裁剪区域</div>'; return; }
    box.innerHTML = results.map((r) => `
      <div class="match-item" data-id="${r.q.id}">
        <div class="st"><span class="pill">${SUB[r.sub].name}·${TYPE[r.q.type].name}</span>${escapeHtml(r.q.stem)}</div>
        <div class="manswer">本题答案：<b>${answerText(r.q)}</b></div>
        <div class="menex">${escapeHtml(r.q.explanation || '')}</div>
      </div>`).join('');
    $$('#photo-results .match-item').forEach((el) => el.addEventListener('click', () => openQuestionById(el.dataset.id)));
  }

  function onPhotoSearch() {
    const raw = $('#photo-q').value;
    if (!raw.trim()) { alert('请先截取/识别，或输入题干关键词'); return; }
    renderMatches(matchQuestionsInText(raw));
  }

  /* ---------------- Stats ---------------- */
  function accuracyAll() {
    let c = 0, n = 0;
    for (const id in progress.q) { const st = progress.q[id]; if (st.correct) c += st.correct; if (st.wrong) n += st.wrong; }
    return (c + n) ? Math.round((c / (c + n)) * 100) : 0;
  }

  function renderStats() {
    const body = $('#stats-body');
    let c = 0, n = 0;
    const bySub = {};
    for (const id in progress.q) {
      const st = progress.q[id];
      if (st.correct) c += st.correct;
      if (st.wrong) n += st.wrong;
      const it = findQuestion(id); const sub = it ? it.subject : 'dianzi';
      bySub[sub] = bySub[sub] || { c: 0, n: 0, comp: 0 };
      if (st.correct) bySub[sub].c += st.correct;
      if (st.wrong) bySub[sub].n += st.wrong;
      if (st.seen) bySub[sub].comp++;
    }
    const ans = c + n ? Math.round((c / (c + n)) * 100) : 0;

    let totalAll = 0, compAll = 0;
    const list = Object.keys(QUESTION_BANK.subjects).map((s) => {
      const sec = QUESTION_BANK.subjects[s].sections;
      const total = sec.single.length + sec.multi.length + sec.judgment.length;
      totalAll += total;
      const ss = bySub[s] || { c: 0, n: 0, comp: 0 };
      compAll += ss.comp;
      const undone = total - ss.comp;
      const p = ss.c + ss.n ? Math.round((ss.c / (ss.c + ss.n)) * 100) : 0;
      return `<div class="stat-card"><h3>${SUB[s].name} · 共 ${total} 题</h3>
        <p style="margin:0;color:var(--ink-soft);font-size:13px">已练习 <b style="color:var(--accent-dark)">${ss.comp}</b> 题 · 未练习 <b style="color:#c98b2f">${undone}</b> 题 · 作答 ${ss.c + ss.n} 次</p>
        <div class="bar"><span style="width:${p}%"></span></div>
        <p style="margin:6px 0 0;color:var(--ink-soft);font-size:12.5px">正确 ${ss.c} · 错误 ${ss.n}（正确率 ${p}%）</p></div>`;
    }).join('');

    const undoneAll = totalAll - compAll;
    body.innerHTML = `
      <div class="stat-card"><h3>总览</h3>
        <div class="score-big" style="font-size:40px">${ans}%</div>
        <p style="margin:0;color:var(--ink-soft);font-size:13px">累计作答 ${c + n} 次 · 正确 ${c} · 错误 ${n}</p>
        <p style="margin:6px 0 0;font-size:13px">题库共 <b>${totalAll}</b> 题 · 已练习 <b style="color:var(--accent-dark)">${compAll}</b> · 未完成 <b style="color:#c98b2f">${undoneAll}</b></p>
        <div class="bar"><span style="width:${ans}%"></span></div></div>
      ${list}
      <div class="stat-card"><h3>当前错题 ${errorCount()} 题</h3>
        <p style="margin:0;color:var(--ink-soft);font-size:13px">错题作对 3 次后自动回归普通题库</p></div>
      <button class="btn-ghost" id="reset-stats" style="border-color:var(--line);color:var(--red)">清空学习记录</button>
    `;
    $('#reset-stats').addEventListener('click', () => {
      if (confirm('确定清空所有学习记录与错题集？此操作不可恢复。')) { progress = { q: {}, papers: 0, sessions: [] }; saveProgress(); renderStats(); refreshHomeBadge(); }
    });
  }

  /* ---------------- About ---------------- */
  function renderAbout() {
    $('#about-body').innerHTML = `
      <h3>如何安装到手机桌面</h3>
      <ol>
        <li>用手机浏览器打开本应用地址（<code>http://电脑IP:端口</code>）。</li>
        <li>安卓：浏览器菜单 →「添加到主屏幕」；iPhone：分享 →「添加到主屏幕」。</li>
        <li>添加后即可像普通 App 一样离线使用。</li>
      </ol>
      <h3>功能说明</h3>
      <ul>
        <li><b>题库</b>：内含“电子（1000 题）”与“主播（999 题）”两大科目的单选/多选/判断。</li>
        <li><b>刷题</b>：自动组卷（含三类）或专项练习；答后红标错、绿标对，并显示解析。</li>
        <li><b>错题集</b>：自动收录错题，作对 3 次回归普通题库；组卷时自动侧重错题。</li>
        <li><b>拍照识别</b>：拍下题目后可调用文字识别或输入关键词，从题库中比对定位。</li>
      </ul>
      <h3>离线说明</h3>
      <p>题库与练习逻辑全部在本地，初次打开后即可离线使用。仅“拍照文字识别”首次需要联网下载识别模型。</p>
    `;
  }

  /* ---------------- Utility ---------------- */
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* ---------------- Setup interactions ---------------- */
  function setupSeg(el, onPick) {
    $$(el + ' .seg-btn').forEach((b) => b.addEventListener('click', () => {
      $$(el + ' .seg-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      onPick(b);
    }));
  }

  function bindSetup() {
    setupSeg('#subject-seg', (b) => { state.subject = b.dataset.subject; });
    setupSeg('#mode-seg', (b) => {
      state.mode = b.dataset.mode;
      $('#paper-config').classList.toggle('hidden', b.dataset.mode !== 'paper');
      $('#special-config').classList.toggle('hidden', b.dataset.mode !== 'special');
    });
    setupSeg('#paper-size', (b) => { state.paperSize = +b.dataset.size; });
    setupSeg('#special-type', (b) => { state.specialType = b.dataset.type; });
    setupSeg('#special-count', (b) => { state.specialCount = +b.dataset.count; });
    setupSeg('#order-seg', (b) => { state.order = b.dataset.order; });
    $('#mix-check').addEventListener('change', (e) => { state.mix = e.target.checked; });

    $('#start-btn').addEventListener('click', () => startSession(state.mode));
  }

  /* ---------------- Boot ---------------- */
  function bindGlobalNav() {
    $$('[data-action]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.action;
      if (a === 'practice') showView('setup');
      else if (a === 'errors') { state.errorsFilter = 'all'; renderErrors(); showView('errors'); }
      else if (a === 'photo') { renderPhoto(); showView('photo'); }
      else if (a === 'stats') { renderStats(); showView('stats'); }
    }));
    $$('.nav-btn').forEach((b) => b.addEventListener('click', () => {
      const n = b.dataset.nav;
      if (n === 'errors') { state.errorsFilter = 'all'; renderErrors(); }
      if (n === 'photo') renderPhoto();
      if (n === 'stats') renderStats();
      if (n === 'about') renderAbout();
      showView(n);
    }));
  }

  function init() {
    if (!window.QUESTION_BANK) { alert('题库数据加载失败'); return; }
    bindGlobalNav();
    bindSetup();
    renderAbout();
    refreshHomeBadge();

    // 全局“返回”按钮（顶栏左上角）：所有 data-back 都能返回首页；session 需确认
    document.addEventListener('click', (e) => {
      const b = e.target.closest('.btn-back');
      if (!b) return;
      if (b.dataset.confirm && !confirm('确定退出本次刷题吗？本次作答记录会保留。')) return;
      showView('home');
    });

    // service worker：network-first，且新版本接管时自动刷新，解决“手机不更新”问题
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', () => {
        const hadController = !!navigator.serviceWorker.controller;
        navigator.serviceWorker.register('sw.js').then((reg) => { if (reg.update) reg.update(); }).catch(() => {});
        if (hadController) {
          let reloaded = false;
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloaded) return;
            reloaded = true;
            setTimeout(() => window.location.reload(), 400);
          });
        }
      });
    }

    // 首页副标题显示版本号，方便确认是否已是最新
    const sub = document.querySelector('.sub');
    if (sub) sub.textContent = `电子商务师题库刷题 · 离线可用 · ${APP_VERSION}`;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
