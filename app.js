// ---------- Campus Cipher (Public-friendly v2: locked + solved overlay) ----------
// Öffentliche Version des Spiels: Stages bleiben visuell gesperrt, gelöste Stages werden aber als ✅ Solved markiert.

// Kurzhelfer: wählt ein einzelnes Element aus dem DOM
const $ = (s) => document.querySelector(s);

// Kurzhelfer: wählt mehrere Elemente aus dem DOM
const $$ = (s) => document.querySelectorAll(s);

// Status-/Feedback-Element (z.B. "Correct!", "Wrong!")
const msg = $("#msg");

// localStorage-Key, unter dem der Spielzustand gespeichert wird
const KEY = "campus-cipher-public-v2";

// ---------------- State ----------------
// Zentraler Spielzustand (alles, was wir persistent speichern wollen)
let state = {
  isRunning: false, // Spiel läuft (Start gedrückt)?
  done: false,      // Spiel komplett fertig?

  stage: 1,         // aktuelle Stage (1..4)
  startAt: null,    // Startzeitpunkt (Timestamp)

  score: 100,       // Startscore
  sound: true,      // Sound an/aus

  // Pro Stage: wurde Hint benutzt?
  hintsUsed: { 1: false, 2: false, 3: false, 4: false },

  // Antworten pro Stage (damit man nach Reload weiter machen kann)
  answers: { 1: "", 2: "", 3: "", 4: "" },
};

// Speichert den aktuellen Zustand in localStorage
function save(){ localStorage.setItem(KEY, JSON.stringify(state)); }

// Lädt (falls vorhanden) gespeicherten Zustand aus localStorage
function load(){
  try{
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...state, ...JSON.parse(raw) };
  }catch{}
}

// Formatiert Millisekunden als "mm:ss"
function fmt(ms){
  const sec = Math.floor(ms / 1000);
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// Normalisiert Texteingaben: trim, Großbuchstaben, Whitespace entfernen
function norm(s){
  return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
}

// Setzt eine Statusmeldung + CSS-Klasse (ok/bad)
function setMsg(text, ok=true){
  if (!msg) return;
  msg.textContent = text;
  msg.className = "msg " + (ok ? "ok" : "bad");
}

// ---------------- UI ----------------
// Aktualisiert Score/Stage/Progressbar/Buttons oben im UI
function updateTop(){
  $("#score").textContent = String(state.score);
  $("#stage").textContent = String(state.stage);

  // Fortschritt in Prozent (hier simpel: stage/4)
  const pct = state.isRunning ? Math.round((state.stage / 4) * 100) : 0;
  $("#progressText").textContent = `${pct}%`;
  $("#progressBar").style.width = `${pct}%`;

  // Sound-Button Text
  $("#mute").textContent = "Sound: " + (state.sound ? "ON" : "OFF");

  // Start-Button während des Spiels deaktivieren
  $("#start").disabled = state.isRunning;
  $("#start").textContent = state.isRunning ? "Running..." : "Start Game";
}

/**
 * Gewünschtes Verhalten:
 * - Vergangene Stages: LOCKED, aber ✅ Solved (nicht editierbar)
 * - Aktuelle Stage: ACTIVE (unlocked, editierbar)
 * - Zukünftige Stages: LOCKED mit Hinweis "Solve Stage X"
 */
function lockStages(current){
  $$(".stage").forEach(sec => {
    const n = Number(sec.dataset.stage);
    const overlaySpan = sec.querySelector(".lockOverlay span");

    // Basis: aktive/done Klassen entfernen und dann neu setzen
    sec.classList.remove("active", "done");

    // Future: gesperrt
    if (n > current){
      sec.classList.add("locked");
      if (overlaySpan) overlaySpan.textContent = `🔒 Locked — Solve Stage ${current}`;
      return;
    }

    // Current: aktiv
    if (n === current){
      sec.classList.remove("locked");
      sec.classList.add("active");
      if (overlaySpan) overlaySpan.textContent = "";
      return;
    }

    // Past: gelöst, aber weiterhin gesperrt (nur Statusanzeige)
    sec.classList.add("locked");
    sec.classList.add("done");
    if (overlaySpan) overlaySpan.textContent = "✅ Solved";
  });

  // Auto-Scroll zur aktuellen Stage (nur während Spiel läuft)
  const currentEl = document.querySelector(`.stage[data-stage="${current}"]`);
  if (currentEl && state.isRunning) currentEl.scrollIntoView({ behavior:"smooth", block:"start" });
}

// Deaktiviert alle Inputs/Buttons in den Stages bis "Start" gedrückt wird
function setInputsEnabled(enabled){
  $$(".stage input, .stage button").forEach(el => {
    // Start/Reset/Mute sind außerhalb der Stages, aber zur Sicherheit nicht anfassen
    if (el.id === "start" || el.id === "reset" || el.id === "mute") return;
    el.disabled = !enabled;
  });
}

// Timer-Handle
let timerId = null;

// Startet/aktualisiert den Spiel-Timer
function startTimer(){
  clearInterval(timerId);

  // Wenn Spiel nicht läuft, Zeit zurücksetzen
  if (!state.isRunning || !state.startAt){
    $("#time").textContent = "00:00";
    return;
  }

  // Alle 250ms: vergangene Zeit anzeigen, solange nicht "done"
  timerId = setInterval(() => {
    if (state.isRunning && !state.done){
      $("#time").textContent = fmt(Date.now() - state.startAt);
    }
  }, 250);
}

// Kleiner Signalton ohne Audiodateien
function beep(ok=true){
  if (!state.sound) return;
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.06;
    o.connect(g); g.connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, ok ? 90 : 140);
  }catch{}
  if (navigator.vibrate) navigator.vibrate(ok ? 40 : 90);
}

// ---------------- Puzzles ----------------
// Korrekte Lösungen pro Stage
const STAGE1 = "ORION";
const STAGE2 = "CAMPUS";
const STAGE3 = "C"; // Water is wet

// Baut den finalen Schlüssel aus den ersten drei Antworten
function finalKey(){
  return `${state.answers[1]}-${state.answers[2]}-${state.answers[3]}`;
}

// Generiert einen "Joker Code" (Hash-artig) basierend auf Key, Zeit und Score
function makeJokerCode(key, timeMs, score){
  const base = `${key}|${Math.floor(timeMs/1000)}|${score}|CC`;
  let h = 2166136261;
  for (let i=0;i<base.length;i++){
    h ^= base.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h = (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
  return `WIAI-${h.slice(0,4)}-${h.slice(4,8)}`;
}

// ---------------- Hints ----------------
// Hinweistexte (Deutsch)
const hints = {
  1: "Nimm die ersten Buchstaben jedes Wortes im Satz (O R I O N).",
  2: "A=1, B=2, C=3 … also 3=C, 1=A, 13=M …",
  3: "Nur eine Aussage ist realistisch wahr: 'Water is wet'.",
  4: "Format: ORION-CAMPUS-C (mit Bindestrichen).",
};

// Benutzt einen Hint: kostet Score, nur im passenden Stage erlaubt
function useHint(n){
  if (!state.isRunning){
    setMsg("Press Start Game first!", false);
    beep(false);
    return;
  }
  if (state.hintsUsed[n]) return;
  if (state.stage !== n) return;

  state.hintsUsed[n] = true;
  state.score = Math.max(0, state.score - 10);
  $(`#hint${n}`).textContent = "💡 " + hints[n];

  updateTop();
  save();
}

// ---------------- Checks ----------------
// Prüft die Lösung der aktuellen Stage und schaltet ggf. weiter
function check(stage){
  if (!state.isRunning){
    setMsg("Press Start Game first!", false);
    beep(false);
    return;
  }
  if (state.done) return;
  if (state.stage !== stage) return;

  // Stage 1 prüfen
  if (stage === 1){
    const v = norm($("#a1").value);
    if (v === STAGE1){
      state.answers[1] = v;
      state.stage = 2;
      save();
      setMsg("✅ Correct! Stage 2 unlocked.", true);
      beep(true);
      updateTop();
      lockStages(2);
    } else {
      setMsg("❌ Not correct. Try again.", false);
      beep(false);
    }
  }

  // Stage 2 prüfen
  if (stage === 2){
    const v = norm($("#a2").value);
    if (v === STAGE2){
      state.answers[2] = v;
      state.stage = 3;
      save();
      setMsg("✅ Nice! Stage 3 unlocked.", true);
      beep(true);
      updateTop();
      lockStages(3);
    } else {
      setMsg("❌ Wrong. Try again.", false);
      beep(false);
    }
  }

  // Stage 3 prüfen (Radio oder Textfeld)
  if (stage === 3){
    const radio = document.querySelector('input[name="logic"]:checked');
    const typed = norm($("#a3").value);
    const chosen = radio ? norm(radio.value) : "";
    const v = typed || chosen;

    if (v === STAGE3){
      state.answers[3] = v;
      state.stage = 4;
      save();
      setMsg("✅ Correct! Final Vault unlocked.", true);
      beep(true);
      updateTop();
      lockStages(4);
    } else {
      setMsg("❌ Not correct. Exactly ONE statement is true.", false);
      beep(false);
    }
  }

  // Stage 4 prüfen (Final-Key)
  if (stage === 4){
    const v = norm($("#a4").value);
    const expected = norm(finalKey());

    if (v === expected){
      state.answers[4] = v;
      state.done = true;

      const timeMs = Date.now() - state.startAt;
      const joker = makeJokerCode(expected, timeMs, state.score);

      $("#joker").textContent = joker;
      $("#finalTime").textContent = fmt(timeMs);
      $("#finalScore").textContent = String(state.score);

      $("#final").classList.remove("hidden");
      setMsg("🏁 Completed! Enjoy your Joker-Code.", true);
      beep(true);

      save();
      updateTop();
      lockStages(4);
    } else {
      setMsg("❌ Final-Key does not match. Combine your results exactly.", false);
      beep(false);
    }
  }
}

// ---------------- Wire up ----------------
// Bindet Enter-Taste: Enter im Input -> check(stage)
function bindEnter(inputId, stage){
  const el = $(inputId);
  if (!el) return;
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") check(stage);
  });
}

// Reset-Button: localStorage löschen und Seite neu laden
$("#reset").addEventListener("click", () => {
  localStorage.removeItem(KEY);
  location.reload();
});

// Mute-Button: Sound toggeln
$("#mute").addEventListener("click", () => {
  state.sound = !state.sound;
  updateTop();
  save();
});

// Start-Button: initialisiert ein neues Spiel
$("#start").addEventListener("click", () => {
  if (state.isRunning) return;

  state.isRunning = true;
  state.done = false;
  state.stage = 1;
  state.startAt = Date.now();
  state.score = 100;
  state.hintsUsed = { 1:false, 2:false, 3:false, 4:false };
  state.answers = { 1:"", 2:"", 3:"", 4:"" };

  // Hint-Texte leeren
  for (let i=1;i<=4;i++){
    const h = $(`#hint${i}`);
    if (h) h.textContent = "";
  }

  // Inputs leeren
  $("#a1").value = ""; $("#a2").value = ""; $("#a3").value = ""; $("#a4").value = "";

  // Final-Panel verstecken
  $("#final").classList.add("hidden");

  save();
  setMsg("Game started! Solve Stage 1.", true);
  updateTop();
  lockStages(1);
  setInputsEnabled(true);
  startTimer();
});

// Buttons für "Check" klicken -> check(stage)
$$("[data-check]").forEach(btn => {
  btn.addEventListener("click", () => check(Number(btn.dataset.check)));
});

// Buttons für "Hint" klicken -> useHint(stage)
$$("[data-hint]").forEach(btn => {
  btn.addEventListener("click", () => useHint(Number(btn.dataset.hint)));
});

// In Stage 3: Radio-Auswahl schreibt automatisch ins Textfeld (#a3)
$$('input[name="logic"]').forEach(r => {
  r.addEventListener("change", () => { $("#a3").value = r.value; });
});

// Enter-Handling für alle Input-Felder
bindEnter("#a1", 1);
bindEnter("#a2", 2);
bindEnter("#a3", 3);
bindEnter("#a4", 4);

// ---------------- Init ----------------
// Stellt Zustand nach Reload wieder her (Progress, Inputs, Timer, Final-Panel, etc.)
function init(){
  load();

  // Hint-Texte wiederherstellen, falls benutzt
  for (let i=1;i<=4;i++){
    if (state.hintsUsed[i]) $(`#hint${i}`).textContent = "💡 " + hints[i];
  }

  // Eingaben wiederherstellen
  if (state.answers[1]) $("#a1").value = state.answers[1];
  if (state.answers[2]) $("#a2").value = state.answers[2];
  if (state.answers[3]) $("#a3").value = state.answers[3];
  if (state.answers[4]) $("#a4").value = state.answers[4];

  // Final-Panel anzeigen, wenn Spiel fertig
  if (state.done){
    $("#final").classList.remove("hidden");
    $("#finalScore").textContent = String(state.score);
    if (state.startAt) $("#finalTime").textContent = fmt(Date.now() - state.startAt);
  }

  updateTop();

  // Wenn noch nicht gestartet: Stage 1 anzeigen, aber Inputs deaktivieren
  if (!state.isRunning){
    lockStages(1);
    setInputsEnabled(false);
    $("#time").textContent = "00:00";
    setMsg("Press “Start Game” to begin.", true);

    // Overlays korrekt setzen: Stage 1 aktiv, Stage 2..4 gesperrt (Solve Stage 1)
    $$(".stage").forEach(sec => {
      const n = Number(sec.dataset.stage);
      const overlaySpan = sec.querySelector(".lockOverlay span");
      if (n === 1){
        sec.classList.add("active");
        sec.classList.remove("locked","done");
        if (overlaySpan) overlaySpan.textContent = "";
      } else {
        sec.classList.add("locked");
        sec.classList.remove("active","done");
        if (overlaySpan) overlaySpan.textContent = "🔒 Locked — Solve Stage 1";
      }
    });
  } else {
    // Wenn Spiel schon läuft: Stages entsprechend der gespeicherten Stage setzen
    lockStages(state.stage);
    setInputsEnabled(true);
    startTimer();
    if (!state.done && state.startAt) $("#time").textContent = fmt(Date.now() - state.startAt);
  }
}

// Init beim Laden ausführen
init();
