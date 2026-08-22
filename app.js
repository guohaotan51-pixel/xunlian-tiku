/* 询练 — 电子商务师题库 PWA
 * Long-form offline question-bank practice app.
 * Vanilla JS, no dependencies. Data lives in window.QUESTION_BANK.
 */
(function () {
  'use strict';

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

  /* ---------------- App state ---------------- */
  const state = {
    view: 'home',
    subject: 'dianzi',
    mode: 'paper',
    paperSize: 20,
    specialType: 'single',
    specialCount: 10,
    mix: true,
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

  /* ---------------- Weighted selection ---------------- */
  function questionWeight(item, mix) {
    const st = progress.q[item.id];
    if (mix !== false) {
      if (!st || !st.seen) return 1.0;                 // unseen -> normal
      if (st.wrong > 0 && st.streak < 3) {             // active error book
        let w = 3.0;
        if (st.streak === 0) w += 2.0;                 // just answered wrong -> highest
        else if (st.wrong >= 2) w += 1.5;              // frequently wrong -> drill
        else w += 0.6;                                 // returning correctly 1-2x -> keep reviewing
        return w;
      }
      if (st.firstTryCorrect && st.correct > 0) return 0.25; // correct on first try -> lower priority
      return 1.0;
    }
    return 1.0; // uniform when mix disabled
  }

  function sampleWeighted(pool, n, mix) {
    const copy = pool.slice();
    const out = [];
    while (out.length < n && copy.length) {
      let total = 0;
      const weights = copy.map((it) => { const w = questionWeight(it, mix); total += w; return w; });
      let r = Math.random() * total;
      let idx = copy.length - 1;
      for (let k = 0; k < copy.length; k++) { r -= weights[k]; if (r <= 0) { idx = k; break; } }
      out.push(copy[idx]);
      copy.splice(idx, 1);
    }
    return out;
  }

  function mixCounts(total, bank) {
    const s = bank.single.length, m = bank.multi.length, j = bank.judgment.length;
    // base ratio single/multi/judgment
    let ns = Math.max(1, Math.min(s, Math.round(total * 0.5)));
    let nm = Math.max(1, Math.min(m, Math.round(total * 0.3)));
    let nj = Math.max(1, Math.min(j, Math.round(total * 0.2)));
    const avail = s + m + j;
    total = Math.min(total, avail);
    // fix up to exactly total
    let guard = 0;
    while ((ns + nm + nj) !== total && guard++ < 40) {
      const cur = ns + nm + nj;
      const types = [
        ['single', () => ns, (v) => { ns = v; }],
        ['multi', () => nm, (v) => { nm = v; }],
        ['judgment', () => nj, (v) => { nj = v; }],
      ];
      if (cur < total) {
        // add to the type with the most remaining headroom
        const head = types.map((t) => ({ k: t[0], v: t[1](), cap: t[0] === 'single' ? s : t[0] === 'multi' ? m : j }));
        head.sort((a, b) => (b.cap - b.v) - (a.cap - a.v));
        const hh = head[0];
        hh.v === 'single' ? (ns++) : hh.v === 'multi' ? (nm++) : (nj++);
      } else {
        // remove from the type still above minimum
        const canRemove = types.filter((t) => t[1]() > 1);
        if (!canRemove.length) break;
        const rr = canRemove[canRemove.length - 1][0];
        rr === 'single' ? (ns--) : rr === 'multi' ? (nm--) : (nj--);
      }
    }
    return { single: ns, multi: nm, judgment: nj };
  }

  function buildPaperQueue(subject, config) {
    const bank = QUESTION_BANK.subjects[subject].sections;
    const total = config.size;
    const c = mixCounts(total, bank);
    let qs = [];
    qs = qs.concat(sampleWeighted(bank.single, c.single, config.mix));
    qs = qs.concat(sampleWeighted(bank.multi, c.multi, config.mix));
    qs = qs.concat(sampleWeighted(bank.judgment, c.judgment, config.mix));
    shuffle(qs);
    return qs;
  }
  function buildSpecialQueue(subject, config) {
    const bank = QUESTION_BANK.subjects[subject].sections[config.type];
    return sampleWeighted(bank, Math.min(config.count, bank.length), config.mix);
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
    let questions;
    if (mode === 'paper') questions = buildPaperQueue(subject, { size: state.paperSize, mix: state.mix });
    else questions = buildSpecialQueue(subject, { type: state.specialType, count: state.specialCount, mix: state.mix });

    if (!questions.length) { alert('该科目/题型暂无题目'); return; }
    state.session = {
      subject, mode, questions,
      index: 0, results: [],
      correct: 0, wrong: 0,
    };
    $('#session-title').textContent = `${SUB[subject].name} · ${mode === 'paper' ? '自动组卷' : TYPE[state.specialType].name + '专项'}`;
    $('#session-progress').textContent = `1 / ${questions.length}`;
    $('.session-foot').classList.add('hidden');
    showView('session');
    renderQuestion();
  }

  let multiSel = []; // for multi-select
  function renderQuestion() {
    const s = state.session;
    const q = s.questions[s.index];
    multiSel = [];
    const body = $('#session-body');
    const typeLabel = TYPE[q.type];
    body.innerHTML = `
      <div class="q-type ${typeLabel.clazz}">${typeLabel.name}</div>
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
    // single: tap = immediate evaluate; multi: toggle; judgment: tap judge
    if (q.type === 'single') {
      $$('.opt', body).forEach((el) => el.addEventListener('click', () => evaluateSingle(q, el)));
    } else if (q.type === 'multi') {
      $$('.opt', body).forEach((el) => el.addEventListener('click', () => toggleMulti(el)));
      $('#multi-confirm').addEventListener('click', () => evaluateMulti(q));
    } else {
      $$('.judge-btn', body).forEach((el) => el.addEventListener('click', () => evaluate(q, el.dataset.judge === 'true')));
    }
  }

  function finished(s) {
    s.finished = true;
    $('#session-progress').textContent = `完成 · ${s.results.length} 题`;
    const foot = $('.session-foot');
    foot.innerHTML = '<button class="btn-primary wide" id="go-result">查看结果</button>';
    $('#go-result').addEventListener('click', () => showResult());
    $('.session-foot').classList.remove('hidden');
  }

  function advance() {
    const s = state.session;
    s.index++;
    if (s.index >= s.questions.length) { finished(s); return; }
    $('#session-progress').textContent = `${s.index + 1} / ${s.questions.length}`;
    renderQuestion();
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
    const btn = $$('.judge-btn').find((b) => (b.dataset.judge === 'true') === picked);
    btn.classList.add(picked === q.answer ? 'correct' : 'wrong');
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
      const icon = el.classList.contains('correct') ? '' : el.classList.contains('wrong') ? '' : '';
    });
  }

  function finishAnswer(q, picked, correct) {
    const s = state.session;
    recordAnswer(q, correct);
    s.results.push({ item: q, picked, correct });
    correct ? s.correct++ : s.wrong++;
    const foot = $('.session-foot');
    foot.classList.remove('hidden');
    const isLast = s.index + 1 >= s.questions.length;
    if (isLast) {
      s.finished = true;
      $('#session-progress').textContent = `完成 · ${s.results.length} 题`;
      foot.innerHTML = `<button class="btn-primary wide" id="go-result">查看结果</button>`;
      $('#go-result').addEventListener('click', () => showResult());
    } else {
      foot.innerHTML = `<button class="btn-primary wide" id="next-btn">下一题 ›</button>`;
      $('#next-btn').addEventListener('click', () => advance());
    }
    // explanation
    const expl = $('#expl-slot');
    expl.innerHTML = `<div class="expl"><b>${correct ? '回答正确' : '回答错误'}</b><div class="en">${escapeHtml(q.explanation || '')}</div></div>`;
    $('#session-body').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- Result ---------------- */
  function showResult() {
    const s = state.session;
    const total = s.results.length;
    const correct = s.correct;
    const pct = total ? Math.round((correct / total) * 100) : 0;
    progress.papers = (progress.papers || 0) + 1;
    saveProgress();
    const byType = {};
    s.results.forEach((r) => { byType[r.item.type] = byType[r.item.type] || { c: 0, n: 0 }; byType[r.item.type].n++; if (r.correct) byType[r.item.type].c++; });
    const typeStats = Object.keys(byType).map((t) => `
      <div class="stat-box"><div class="n">${byType[t].c}/${byType[t].n}</div><div class="l">${TYPE[t].name}</div></div>`).join('');
    $('#result-body').innerHTML = `
      <div class="score-big">${pct}%</div>
      <div class="score-sub">完成 ${total} 题 · 答对 ${correct} · 答错 ${total - correct}</div>
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
    state.session = { subject: state.subject, mode: 'error', questions: qs, index: 0, results: [], correct: 0, wrong: 0 };
    $('#session-title').textContent = '错题复习';
    $('#session-progress').textContent = `1 / ${qs.length}`;
    $('.session-foot').classList.add('hidden');
    showView('session');
    renderQuestion();
  }

  function openQuestionById(id) {
    const it = findQuestion(id); if (!it) return;
    state.session = { subject: it.subject, mode: 'singleview', questions: [it], index: 0, results: [], correct: 0, wrong: 0 };
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
  let photoImg = null;
  const OCR_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  let ocrLoaded = false, ocrWorker = null;

  function renderPhoto() {
    const body = $('#photo-body');
    body.innerHTML = `
      <input type="file" id="photo-input" accept="image/*" capture="environment" style="display:none">
      <button class="btn-primary" id="photo-take">📷 拍照 / 选择图片</button>
      <div class="shot" id="photo-preview">拍照后在此预览</div>
      <div class="btn-row">
        <button class="btn-ghost" id="photo-ocr">🔤 文字识别 (可选)</button>
        <button class="btn-ghost" id="photo-clear" style="border-color:var(--line);color:var(--ink-soft)">清除</button>
      </div>
      <label class="label" style="margin-top:4px">若识别失败，输入题干关键词进行比对</label>
      <input class="search-in" id="photo-q" placeholder="例如：CPM 千次展示成本">
      <button class="btn-primary" id="photo-search" style="margin-top:8px">比对题库</button>
      <div id="photo-results"></div>
    `;
    $('#photo-take').addEventListener('click', () => $('#photo-input').click());
    $('#photo-input').addEventListener('change', (e) => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { photoImg = rd.result; $('#photo-preview').innerHTML = `<img src="${photoImg}" alt="photo">`; }; rd.readAsDataURL(f); });
    $('#photo-clear').addEventListener('click', () => { photoImg = null; $('#photo-preview').innerHTML = '拍照后在此预览'; $('#photo-results').innerHTML = ''; });
    $('#photo-ocr').addEventListener('click', () => runOcr());
    $('#photo-search').addEventListener('click', onPhotoSearch);
    $('#photo-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') onPhotoSearch(); });
  }

  async function runOcr() {
    const pres = $('#photo-preview');
    if (!photoImg) { alert('请先拍照或选择图片'); return; }
    const btn = $('#photo-ocr');
    btn.disabled = true; btn.textContent = '识别中…';
    try {
      await ensureOcr();
      btn.textContent = '识别中…';
      const { data } = await ocrWorker.recognize(photoImg);
      const text = (data.text || '').trim();
      if (text) { $('#photo-q').value = text.replace(/\s+/g, ' ').slice(0, 120); onPhotoSearch(); }
      else { $('#photo-q').placeholder = '未识别到文字，请手动输入关键词'; }
    } catch (err) {
      btn.textContent = '文字识别失败，请手动输入';
    } finally { btn.disabled = false; }
  }

  function ensureOcr() {
    if (ocrWorker) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (ocrLoaded) { resolve(); return; }
      const s = document.createElement('script');
      s.src = OCR_URL; s.async = true;
      s.onload = () => {
        ocrLoaded = true;
        try {
          // eslint-disable-next-line no-undef
          ocrWorker = Tesseract.createWorker('chi_sim+eng', 1, { logger: () => {} });
          ocrWorker.then((w) => { ocrWorker = w; resolve(); }).catch(reject);
        } catch (e) { reject(e); }
      };
      s.onerror = () => reject(new Error('load fail'));
      document.head.appendChild(s);
    });
  }

  function normText(s) { return (s || '').toLowerCase().replace(/[\s，。；、：（）()〔〕【】""''"“”‘’·.—\-_/\\,.!?！？:;]/g, ''); }

  function onPhotoSearch() {
    const qraw = $('#photo-q').value;
    if (!qraw.trim()) { alert('请输入或识别题干关键词'); return; }
    const nq = normText(qraw);
    const results = [];
    for (const sub of Object.keys(QUESTION_BANK.subjects)) {
      for (const t of Object.keys(QUESTION_BANK.subjects[sub].sections)) {
        for (const it of QUESTION_BANK.subjects[sub].sections[t]) {
          const hay = normText(it.stem + ' ' + it.options.map((o) => o.text).join(' '));
          let score = 0;
          for (let i = 0; i < nq.length; i++) if (hay.includes(nq[i])) score++;
          if (score > 0) results.push({ it, score: score / nq.length, sub });
        }
      }
    }
    results.sort((a, b) => b.score - a.score || (a.it.stem.length > b.it.stem.length ? -1 : 1));
    const top = results.slice(0, 8);
    $('#photo-results').innerHTML = top.length
      ? top.map((r) => `<div class="match-item" data-id="${r.it.id}"><span class="pill">${SUB[r.sub].name}·${TYPE[r.it.type].name}</span><div class="st">${escapeHtml(r.it.stem)}</div></div>`).join('')
      : '<div class="empty">未找到匹配题目，请换关键词</div>';
    $$('#photo-results .match-item').forEach((el) => el.addEventListener('click', () => openQuestionById(el.dataset.id)));
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
      bySub[sub] = bySub[sub] || { c: 0, n: 0 };
      if (st.correct) bySub[sub].c += st.correct;
      if (st.wrong) bySub[sub].n += st.wrong;
    }
    const ans = c + n ? Math.round((c / (c + n)) * 100) : 0;
    const list = Object.keys(bySub).map((s) => {
      const ss = bySub[s]; const p = ss.c + ss.n ? Math.round((ss.c / (ss.c + ss.n)) * 100) : 0;
      return `<div class="stat-card"><h3>${SUB[s].name} · 原题 ${QUESTION_BANK.subjects[s].sections.single.length + QUESTION_BANK.subjects[s].sections.multi.length + QUESTION_BANK.subjects[s].sections.judgment.length} 题</h3>
        <p style="margin:0;color:var(--ink-soft);font-size:13px">作答 ${ss.c + ss.n} 次 · 正确 ${ss.c} · 错误 ${ss.n}</p>
        <div class="bar"><span style="width:${p}%"></span></div></div>`;
    }).join('');
    body.innerHTML = `
      <div class="stat-card"><h3>总正确率</h3>
        <div class="score-big" style="font-size:40px">${ans}%</div>
        <p style="margin:0;color:var(--ink-soft);font-size:13px">累计作答 ${c + n} 次 · 正确 ${c} · 错误 ${n}</p>
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
    $('#mix-check').addEventListener('change', (e) => { state.mix = e.target.checked; });

    $('#start-btn').addEventListener('click', () => startSession(state.mode));
    $$('#view-setup .btn-back').forEach((b) => b.addEventListener('click', () => showView('home')));
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

    // service worker
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
