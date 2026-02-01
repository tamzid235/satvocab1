// SAT Vocab Trainer (PWA)
// Simple spaced repetition (SM-2-ish) + quiz + search.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const STORAGE_KEY = "satVocabTrainer:v1";
const TODAY_KEY = "satVocabTrainer:today";

const now = () => Date.now();
const startOfToday = () => {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.getTime();
};

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { sched: {}, favs: {} };
  } catch {
    return { sched: {}, favs: {} };
  }
}
function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadToday() {
  try {
    const t = JSON.parse(localStorage.getItem(TODAY_KEY)) || { date: startOfToday(), studied: 0, goal: 30 };
    if (t.date !== startOfToday()) return { date: startOfToday(), studied: 0, goal: t.goal ?? 30 };
    return t;
  } catch {
    return { date: startOfToday(), studied: 0, goal: 30 };
  }
}
function saveToday(t) {
  localStorage.setItem(TODAY_KEY, JSON.stringify(t));
}

function cardId(c) { return `${c.word}::${c.sense}::${c.pos}::${c.definition}`; }

function getItem(state, id) {
  // SM2-lite fields: due (ms), interval (days), ease, reps
  return state.sched[id] || { due: 0, interval: 0, ease: 2.4, reps: 0 };
}

function gradeItem(item, grade) {
  // grade: 0 Again, 2 Hard, 3 Good, 4 Easy
  // Very small + predictable implementation.
  const day = 24 * 60 * 60 * 1000;

  if (grade === 0) {
    item.reps = 0;
    item.interval = 0;
    item.ease = Math.max(1.3, item.ease - 0.2);
    item.due = now() + 10 * 60 * 1000; // 10 min
    return item;
  }

  // adjust ease
  if (grade === 2) item.ease = Math.max(1.3, item.ease - 0.05);
  if (grade === 3) item.ease = Math.min(3.0, item.ease + 0.0);
  if (grade === 4) item.ease = Math.min(3.0, item.ease + 0.08);

  item.reps = (item.reps || 0) + 1;

  if (item.reps === 1) item.interval = 1;
  else if (item.reps === 2) item.interval = 3;
  else item.interval = Math.round(item.interval * item.ease);

  const mult = grade === 2 ? 0.7 : grade === 4 ? 1.2 : 1.0;
  item.due = now() + Math.max(1, Math.round(item.interval * mult)) * day;

  return item;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

let CARDS = [];
let STATE = loadState();
let TODAY = loadToday();

let current = null;
let revealed = false;

function setFav(id, on) {
  if (on) STATE.favs[id] = 1;
  else delete STATE.favs[id];
  saveState(STATE);
}

function isFav(id) {
  return !!STATE.favs[id];
}

function dueCards() {
  const t = now();
  return CARDS.filter(c => getItem(STATE, cardId(c)).due <= t);
}

function pickNext(deckMode) {
  let pool = [];
  if (deckMode === "due") pool = dueCards();
  else if (deckMode === "favs") pool = CARDS.filter(c => isFav(cardId(c)));
  else pool = CARDS.slice();

  if (!pool.length) return null;

  // Prefer least-seen items in due mode
  if (deckMode === "due") {
    pool.sort((a,b) => (getItem(STATE, cardId(a)).reps||0) - (getItem(STATE, cardId(b)).reps||0));
    pool = pool.slice(0, Math.min(pool.length, 60));
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

function renderStudy() {
  const deckMode = $("#deck-filter").value;
  current = pickNext(deckMode);

  if (!current) {
    $("#study-word").textContent = "All caught up 🎉";
    $("#study-meta").textContent = deckMode === "favs" ? "No favorites yet." : "Nothing due right now.";
    $("#study-definition").hidden = true;
    $("#study-example").hidden = true;
    $("#btn-show").disabled = true;
    $("#rate-buttons").hidden = true;
    $("#btn-fav").disabled = true;
    return;
  }

  revealed = false;
  $("#btn-show").disabled = false;
  $("#rate-buttons").hidden = true;

  $("#study-word").textContent = current.word;
  $("#study-meta").textContent = `${current.pos}${current.sense > 1 ? ` • sense ${current.sense}` : ""}`;
  $("#study-definition").textContent = current.definition || "—";
  $("#study-example").textContent = current.example ? `“${current.example}”` : "";
  $("#study-definition").hidden = true;
  $("#study-example").hidden = true;

  const id = cardId(current);
  $("#btn-fav").textContent = isFav(id) ? "★" : "☆";
  $("#btn-fav").title = isFav(id) ? "Unfavorite" : "Favorite";
  $("#btn-fav").disabled = false;

  updateCounts();
}

function showAnswer() {
  if (!current || revealed) return;
  revealed = true;
  $("#study-definition").hidden = false;
  $("#study-example").hidden = !($("#study-example").textContent.trim());
  $("#rate-buttons").hidden = false;
  $("#btn-show").disabled = true;
}

function rate(grade) {
  if (!current) return;
  const id = cardId(current);
  const item = getItem(STATE, id);
  STATE.sched[id] = gradeItem(item, grade);
  saveState(STATE);

  TODAY.studied += 1;
  saveToday(TODAY);

  renderStudy();
  updateStats();
}

function updateCounts() {
  const due = dueCards().length;
  $("#due-count").textContent = `${due} due`;
  $("#today-count").textContent = `${TODAY.studied}/${TODAY.goal} today`;
  $("#subtitle").textContent = `${due} due • ${TODAY.studied}/${TODAY.goal} today`;
}

function setView(view) {
  $$(".view").forEach(v => v.classList.remove("active"));
  $(`#view-${view}`).classList.add("active");
  $$(".tab").forEach(t => {
    const active = t.dataset.view === view;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function renderResults() {
  const q = ($("#search").value || "").trim().toLowerCase();
  const filter = $("#list-filter").value;

  let pool = CARDS;
  if (filter === "favs") pool = pool.filter(c => isFav(cardId(c)));
  if (filter === "due") pool = dueCards();

  if (q) {
    pool = pool.filter(c =>
      c.word.toLowerCase().includes(q) ||
      (c.definition || "").toLowerCase().includes(q) ||
      (c.example || "").toLowerCase().includes(q)
    );
  }

  pool = pool.slice(0, 250);

  const wrap = $("#results");
  wrap.innerHTML = "";
  if (!pool.length) {
    wrap.innerHTML = `<div class="tiny">No results.</div>`;
    return;
  }

  for (const c of pool) {
    const id = cardId(c);
    const el = document.createElement("div");
    el.className = "result";
    el.innerHTML = `
      <div class="r-top">
        <div class="r-word">${escapeHtml(c.word)}</div>
        <div class="meta">${escapeHtml(c.pos)}${c.sense>1 ? ` • sense ${c.sense}` : ""} • ${isFav(id) ? "★" : ""}</div>
      </div>
      <div class="r-def">${escapeHtml(c.definition || "—")}</div>
      ${c.example ? `<div class="r-ex">“${escapeHtml(c.example)}”</div>` : ``}
      <div class="row" style="margin-top:10px">
        <button class="btn small" data-action="study">Study this</button>
        <button class="btn small ghost" data-action="fav">${isFav(id) ? "Unfavorite" : "Favorite"}</button>
      </div>
    `;
    el.querySelector('[data-action="study"]').addEventListener("click", () => {
      current = c;
      revealed = false;
      $("#deck-filter").value = "all";
      setView("study");
      renderStudyWithCurrent();
    });
    el.querySelector('[data-action="fav"]').addEventListener("click", (e) => {
      setFav(id, !isFav(id));
      renderResults();
      updateStats();
      updateCounts();
    });
    wrap.appendChild(el);
  }
}

function renderStudyWithCurrent() {
  if (!current) return renderStudy();
  revealed = false;
  $("#btn-show").disabled = false;
  $("#rate-buttons").hidden = true;

  $("#study-word").textContent = current.word;
  $("#study-meta").textContent = `${current.pos}${current.sense > 1 ? ` • sense ${current.sense}` : ""}`;
  $("#study-definition").textContent = current.definition || "—";
  $("#study-example").textContent = current.example ? `“${current.example}”` : "";
  $("#study-definition").hidden = true;
  $("#study-example").hidden = true;

  const id = cardId(current);
  $("#btn-fav").textContent = isFav(id) ? "★" : "☆";
  updateCounts();
}

function escapeHtml(s) {
  return (s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

// QUIZ
let quizCurrent = null;

function pickQuizCard() {
  const preferDue = dueCards();
  const pool = preferDue.length ? preferDue : CARDS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function renderQuiz() {
  quizCurrent = pickQuizCard();
  const id = cardId(quizCurrent);
  $("#quiz-word").textContent = quizCurrent.word;
  $("#quiz-meta").textContent = `${quizCurrent.pos}${quizCurrent.sense > 1 ? ` • sense ${quizCurrent.sense}` : ""}`;
  $("#btn-quiz-fav").textContent = isFav(id) ? "★" : "☆";

  const type = $("#quiz-type").value;
  const body = $("#quiz-body");
  body.innerHTML = "";

  if (type === "mc") {
    const correct = quizCurrent.definition || "—";
    const options = new Set([correct]);
    while (options.size < 4) {
      const c = CARDS[Math.floor(Math.random() * CARDS.length)];
      if (c.definition) options.add(c.definition);
    }
    const opts = shuffle(Array.from(options));
    const ul = document.createElement("div");
    ul.className = "rate";
    opts.forEach((def) => {
      const b = document.createElement("button");
      b.className = "btn";
      b.textContent = def;
      b.addEventListener("click", () => {
        const ok = def === correct;
        b.classList.add(ok ? "good" : "danger");
        body.querySelectorAll("button").forEach(x => x.disabled = true);
        const msg = document.createElement("div");
        msg.className = "tiny";
        msg.style.marginTop = "10px";
        msg.textContent = ok ? "Correct ✅" : `Wrong ❌  Correct: ${correct}`;
        body.appendChild(msg);
      });
      ul.appendChild(b);
    });
    body.appendChild(document.createElement("div")).textContent = "Pick the best definition:";
    body.appendChild(document.createElement("div")).className = "divider";
    body.appendChild(ul);
    if (quizCurrent.example) {
      const ex = document.createElement("div");
      ex.className = "example";
      ex.textContent = `Example: “${quizCurrent.example}”`;
      body.appendChild(ex);
    }
  } else {
    const p = document.createElement("div");
    p.textContent = "Type the definition (doesn’t need to be perfect—aim for the idea).";
    body.appendChild(p);
    const input = document.createElement("input");
    input.placeholder = "Your definition…";
    input.style.width = "100%";
    input.style.marginTop = "10px";
    body.appendChild(input);

    const check = document.createElement("button");
    check.className = "btn";
    check.textContent = "Check";
    check.style.marginTop = "10px";
    body.appendChild(check);

    const ans = document.createElement("div");
    ans.className = "definition";
    ans.style.marginTop = "10px";
    ans.hidden = true;
    ans.textContent = quizCurrent.definition || "—";
    body.appendChild(ans);

    const ex = document.createElement("div");
    ex.className = "example";
    ex.hidden = !quizCurrent.example;
    ex.textContent = quizCurrent.example ? `Example: “${quizCurrent.example}”` : "";
    body.appendChild(ex);

    check.addEventListener("click", () => {
      ans.hidden = false;
      const guess = (input.value || "").toLowerCase();
      const truth = (quizCurrent.definition || "").toLowerCase();
      const score = quickSimilarity(guess, truth);
      const msg = document.createElement("div");
      msg.className = "tiny";
      msg.style.marginTop = "8px";
      msg.textContent = score > 0.45 ? "Nice — close enough ✅" : "Compare yours to the official definition 👇";
      body.appendChild(msg);
      check.disabled = true;
      input.disabled = true;
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") check.click();
    });
  }
}

function quickSimilarity(a,b){
  // Jaccard similarity over word tokens
  const ta = new Set(a.split(/\W+/).filter(Boolean));
  const tb = new Set(b.split(/\W+/).filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter++;
  const union = ta.size + tb.size - inter;
  return inter / union;
}

function updateStats() {
  $("#stat-total").textContent = `${CARDS.length}`;
  $("#stat-favs").textContent = `${Object.keys(STATE.favs).length}`;
  $("#stat-due").textContent = `${dueCards().length}`;
  $("#stat-studied").textContent = `${TODAY.studied}`;
}

// Events
function wireUI() {
  $$(".tab").forEach(btn => btn.addEventListener("click", () => {
    setView(btn.dataset.view);
    if (btn.dataset.view === "list") renderResults();
    if (btn.dataset.view === "stats") updateStats();
  }));

  $("#btn-show").addEventListener("click", showAnswer);
  $("#rate-buttons").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    rate(Number(b.dataset.grade));
  });

  $("#btn-fav").addEventListener("click", () => {
    if (!current) return;
    const id = cardId(current);
    setFav(id, !isFav(id));
    $("#btn-fav").textContent = isFav(id) ? "★" : "☆";
    updateStats(); updateCounts();
  });

  $("#deck-filter").addEventListener("change", () => renderStudy());
  $("#daily-goal").addEventListener("change", () => {
    const v = Math.max(5, Math.min(200, Number($("#daily-goal").value || 30)));
    TODAY.goal = v;
    $("#daily-goal").value = v;
    saveToday(TODAY);
    updateCounts();
  });
  $("#btn-reset-today").addEventListener("click", () => {
    TODAY = { date: startOfToday(), studied: 0, goal: TODAY.goal ?? 30 };
    saveToday(TODAY);
    updateCounts(); updateStats();
  });

  $("#search").addEventListener("input", () => renderResults());
  $("#list-filter").addEventListener("change", () => renderResults());
  $("#btn-clear").addEventListener("click", () => { $("#search").value=""; renderResults(); });

  $("#btn-reset-all").addEventListener("click", () => {
    if (!confirm("Reset all progress and favorites?")) return;
    STATE = { sched: {}, favs: {} };
    saveState(STATE);
    TODAY = { date: startOfToday(), studied: 0, goal: TODAY.goal ?? 30 };
    saveToday(TODAY);
    renderStudy();
    renderResults();
    updateStats();
    updateCounts();
  });

  $("#quiz-type").addEventListener("change", renderQuiz);
  $("#btn-new-question").addEventListener("click", renderQuiz);
  $("#btn-quiz-fav").addEventListener("click", () => {
    if (!quizCurrent) return;
    const id = cardId(quizCurrent);
    setFav(id, !isFav(id));
    $("#btn-quiz-fav").textContent = isFav(id) ? "★" : "☆";
    updateStats(); updateCounts();
  });

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (e.key === " " && $("#view-study").classList.contains("active")) {
      e.preventDefault();
      if (!revealed) showAnswer();
    }
    if ($("#view-study").classList.contains("active") && revealed) {
      if (e.key === "1") rate(0);
      if (e.key === "2") rate(2);
      if (e.key === "3") rate(3);
      if (e.key === "4") rate(4);
    }
  });
}

// Service worker
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch {}
}

async function init() {
  const resp = await fetch("./vocab.json");
  const data = await resp.json();
  CARDS = data.cards || [];
  $("#subtitle").textContent = `${CARDS.length} cards loaded`;
  $("#daily-goal").value = TODAY.goal ?? 30;

  wireUI();
  renderStudy();
  renderQuiz();
  updateStats();
  updateCounts();
  registerSW();
}

init();
