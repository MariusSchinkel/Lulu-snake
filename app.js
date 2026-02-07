import { createGameState, setDirection, stepGame } from "./game.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const rageIndicator = document.getElementById("rage-indicator");
const rageTimer = document.getElementById("rage-timer");
const overlay = document.getElementById("overlay");
const top5Title = document.getElementById("top5-title");
const menuTitle = document.getElementById("menu-title");
const menuText = document.getElementById("menu-text");
const difficultyCurrent = document.getElementById("difficulty-current");
const menuHighscoreList = document.getElementById("menu-highscore-list");
const nameEntry = document.getElementById("name-entry");
const nameEntryInput = document.getElementById("name-entry-input");
const saveScoreButton = document.getElementById("save-score");
const startGameButton = document.getElementById("start-game");
const ragePopup = document.getElementById("rage-popup");
const audioToggle = document.getElementById("audio-toggle");
const pauseButton = document.getElementById("pause");
const restartButton = document.getElementById("restart");
const shellEl = document.querySelector(".shell");
const topbarEl = document.querySelector(".topbar");
const controlsEl = document.querySelector(".controls");
const stageEl = document.querySelector(".stage");

const CELL_COUNT = 20;
const LAST_NAME_KEY = "lulu-snake-last-name";
const HIGHSCORE_CACHE_KEY = "lulu-snake-highscores-cache-v2";
const AUDIO_MUTED_KEY = "lulu-snake-audio-muted";
const SUPABASE_URL = "https://tctrtklwqmynkfssipgc.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjdHJ0a2x3cW15bmtmc3NpcGdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0NjU0MTAsImV4cCI6MjA4NjA0MTQxMH0.Hi640Ia4HN4Unjvay5hZ91yTrZUB9DVRLXushyMuh_w";
const SUPABASE_TABLE = "lulu_scores";
const MAX_HIGHSCORES = 5;
const RAGE_DURATION_MS = 15000;
const RAGE_POPUP_MS = 4200;
const RAGE_CHANCE_PCT = 7;
const FORCE_RAGE_AFTER_TREATS = 15;
const RAGE_SPEED_BONUS_MS = 18;
const BG_MUSIC_VOLUME = 0.35;
const BG_DUCKED_VOLUME = 0.12;
const RAGE_MUSIC_VOLUME = 0.9;
const BG_RESTORE_FADE_MS = 1500;
const RAGE_OUT_FADE_MS = 900;
const SWIPE_THRESHOLD_PX = 26;
const START_SPEEDS = {
  easy: 155,
  medium: 125,
  hard: 95,
};

let state = createGameState({ gridSize: CELL_COUNT, seed: 123456789 });
let paused = false;
let timerId = null;
let images = { head: null, body: null, treats: [] };
let lastFoodKey = null;
let currentTreatIndex = 0;
let gameStarted = false;
let pendingHighscore = null;
let highscores = [];
let rageTreatActive = false;
let rageRemainingMs = 0;
let rageLastUpdateTs = 0;
let ragePauseTimer = null;
let audioUnlocked = false;
let bgWasDucked = false;
let rageMusicActive = false;
let audioMuted = localStorage.getItem(AUDIO_MUTED_KEY) === "1";
let treatsSinceRage = 0;
let bgFadeRaf = null;
let rageFadeRaf = null;
let swipePointerId = null;
let swipeLastX = 0;
let swipeLastY = 0;

const bgMusic = new Audio("./assets/bg-music.mp3");
bgMusic.loop = true;
bgMusic.volume = BG_MUSIC_VOLUME;

const rageMusic = new Audio("./assets/lulu-rage.mp3");
rageMusic.loop = false;
rageMusic.volume = RAGE_MUSIC_VOLUME;
bgMusic.muted = audioMuted;
rageMusic.muted = audioMuted;

function updateAudioButton() {
  if (!audioToggle) return;
  audioToggle.textContent = audioMuted ? "Audio Off" : "Audio On";
  audioToggle.setAttribute("aria-pressed", String(!audioMuted));
}

function normalizeName(rawName) {
  const trimmed = String(rawName || "").trim();
  return trimmed || "Player 1";
}

function sortHighscores(entries) {
  return [...entries]
    .sort((a, b) => b.score - a.score || a.createdAt - b.createdAt)
    .slice(0, MAX_HIGHSCORES);
}

function readHighscoreCache() {
  try {
    const raw = localStorage.getItem(HIGHSCORE_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return sortHighscores(
      parsed.map((entry) => ({
        id: String(entry.id || ""),
        name: normalizeName(entry.name),
        score: Math.max(0, Number(entry.score) || 0),
        createdAt: Number(entry.createdAt) || Date.now(),
      }))
    );
  } catch {
    return [];
  }
}

function saveHighscoreCache(nextScores) {
  localStorage.setItem(HIGHSCORE_CACHE_KEY, JSON.stringify(sortHighscores(nextScores)));
}

function applyHighscores(nextScores) {
  highscores = sortHighscores(nextScores);
  saveHighscoreCache(highscores);
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    ...extra,
  };
}

function normalizeRemoteRow(row) {
  return {
    id: String(row.id),
    name: normalizeName(row.name),
    score: Math.max(0, Number(row.score) || 0),
    createdAt: Date.parse(row.created_at) || Date.now(),
  };
}

async function fetchTopHighscoresFromServer() {
  const params = new URLSearchParams();
  params.set("select", "id,name,score,created_at");
  params.set("order", "score.desc,created_at.asc");
  params.set("limit", String(MAX_HIGHSCORES));
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?${params.toString()}`, {
    headers: supabaseHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch highscores (${response.status})`);
  }
  const rows = await response.json();
  return sortHighscores(rows.map(normalizeRemoteRow));
}

async function insertHighscoreOnServer(name, score) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
    method: "POST",
    headers: supabaseHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify({
      name: normalizeName(name),
      score: Math.max(0, Math.floor(score)),
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to insert highscore (${response.status})`);
  }
  const rows = await response.json();
  return rows[0] ? normalizeRemoteRow(rows[0]) : null;
}

async function updateHighscoreNameOnServer(id, name) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: supabaseHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify({ name: normalizeName(name) }),
  });
  if (!response.ok) {
    throw new Error(`Failed to update highscore name (${response.status})`);
  }
}

async function refreshHighscoresFromServer() {
  try {
    const remoteScores = await fetchTopHighscoresFromServer();
    applyHighscores(remoteScores);
    renderHighscores();
  } catch (error) {
    console.warn("Unable to refresh highscores from Supabase.", error);
  }
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img);
    img.src = src;
  });
}

function unlockAudioIfNeeded() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (audioMuted) return;
  if (bgMusic.paused) {
    bgMusic.currentTime = 0;
    bgMusic.play().catch(() => {
      audioUnlocked = false;
    });
  }
}

function duckBackgroundMusic() {
  if (bgWasDucked) return;
  bgWasDucked = true;
  if (audioMuted) return;
  // Rage start should be an immediate handoff.
  if (bgFadeRaf) cancelAnimationFrame(bgFadeRaf);
  bgFadeRaf = null;
  bgMusic.volume = BG_DUCKED_VOLUME;
}

function restoreBackgroundMusic() {
  if (!bgWasDucked) return;
  bgWasDucked = false;
  if (audioMuted) return;
  fadeBgMusicTo(BG_MUSIC_VOLUME, BG_RESTORE_FADE_MS);
}

function setAudioMuted(nextMuted) {
  audioMuted = nextMuted;
  localStorage.setItem(AUDIO_MUTED_KEY, audioMuted ? "1" : "0");
  bgMusic.muted = audioMuted;
  rageMusic.muted = audioMuted;
  if (bgFadeRaf) cancelAnimationFrame(bgFadeRaf);
  bgFadeRaf = null;
  if (audioMuted) {
    bgMusic.pause();
    rageMusic.pause();
    rageMusicActive = false;
    if (rageFadeRaf) cancelAnimationFrame(rageFadeRaf);
    rageFadeRaf = null;
  } else if (audioUnlocked && bgMusic.paused) {
    bgMusic.volume = bgWasDucked ? BG_DUCKED_VOLUME : BG_MUSIC_VOLUME;
    bgMusic.play().catch(() => {});
  }
  updateAudioButton();
}

function fadeBgMusicTo(targetVolume, durationMs) {
  if (audioMuted) return;
  if (bgFadeRaf) cancelAnimationFrame(bgFadeRaf);
  const from = bgMusic.volume;
  const delta = targetVolume - from;
  if (Math.abs(delta) < 0.0001) {
    bgMusic.volume = targetVolume;
    return;
  }
  const startTs = performance.now();
  const step = (ts) => {
    const t = Math.min(1, (ts - startTs) / durationMs);
    bgMusic.volume = from + delta * t;
    if (t < 1) {
      bgFadeRaf = requestAnimationFrame(step);
    } else {
      bgFadeRaf = null;
      bgMusic.volume = targetVolume;
    }
  };
  bgFadeRaf = requestAnimationFrame(step);
}

function fadeOutRageAndStop(durationMs) {
  if (audioMuted || rageMusic.paused) {
    rageMusic.pause();
    rageMusic.currentTime = 0;
    rageMusic.volume = RAGE_MUSIC_VOLUME;
    return;
  }
  if (rageFadeRaf) cancelAnimationFrame(rageFadeRaf);
  const from = rageMusic.volume;
  const startTs = performance.now();
  const step = (ts) => {
    const t = Math.min(1, (ts - startTs) / durationMs);
    rageMusic.volume = from * (1 - t);
    if (t < 1) {
      rageFadeRaf = requestAnimationFrame(step);
    } else {
      rageFadeRaf = null;
      rageMusic.pause();
      rageMusic.currentTime = 0;
      rageMusic.volume = RAGE_MUSIC_VOLUME;
    }
  };
  rageFadeRaf = requestAnimationFrame(step);
}

async function loadAssets() {
  const [head, body, ...treats] = await Promise.all([
    loadImage("./assets/snake-head.png"),
    loadImage("./assets/snake-body.png"),
    loadImage("./assets/treat-1.png"),
    loadImage("./assets/treat-2.png"),
    loadImage("./assets/treat-3.png"),
    loadImage("./assets/treat-4.png"),
    loadImage("./assets/treat-5.png"),
  ]);
  images = { head, body, treats };
}

function drawGrid() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const size = canvas.width / state.gridSize;

  ctx.strokeStyle = "#5f7b4f";
  ctx.lineWidth = 1;

  for (let i = 0; i <= state.gridSize; i += 1) {
    const pos = i * size;
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, canvas.height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(canvas.width, pos);
    ctx.stroke();
  }

  const drawFallbackCell = (cell, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(cell.x * size + 1, cell.y * size + 1, size - 2, size - 2);
  };

  const foodKey = `${state.food.x},${state.food.y}`;
  if (foodKey !== lastFoodKey) {
    lastFoodKey = foodKey;
    if (images.treats.length > 0) {
      currentTreatIndex = state.rngSeed % images.treats.length;
    }
  }

  const treatImage = images.treats[currentTreatIndex];
  if (rageTreatActive) {
    const cx = state.food.x * size + size / 2;
    const cy = state.food.y * size + size / 2;
    const radius = size * 0.55;
    const gradient = ctx.createConicGradient(0, cx, cy);
    gradient.addColorStop(0, "#ff2d95");
    gradient.addColorStop(0.17, "#ff8a00");
    gradient.addColorStop(0.34, "#ffe600");
    gradient.addColorStop(0.51, "#20d97d");
    gradient.addColorStop(0.68, "#2f7cff");
    gradient.addColorStop(0.85, "#8f4dff");
    gradient.addColorStop(1, "#ff2d95");
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#fff7d6";
    ctx.stroke();
    ctx.restore();
  } else if (treatImage && treatImage.complete) {
    const treatSize = size * 1.4;
    const treatOffset = (treatSize - size) / 2;
    ctx.drawImage(
      treatImage,
      state.food.x * size - treatOffset,
      state.food.y * size - treatOffset,
      treatSize,
      treatSize
    );
  } else {
    drawFallbackCell(state.food, "#f97316");
  }

  const headSize = size * 1.32;
  const strokeWidth = headSize * 0.95;

  const collectBodyLines = () => {
    const lines = [];
    for (let i = 0; i < state.snake.length - 1; i += 1) {
      const a = state.snake[i];
      const b = state.snake[i + 1];
      const ax = a.x * size + size / 2;
      const ay = a.y * size + size / 2;
      const bx = b.x * size + size / 2;
      const by = b.y * size + size / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;

      if (!state.wallsEnabled && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
        if (Math.abs(dx) > 1) {
          const leftEdge = 0;
          const rightEdge = state.gridSize * size;
          if (dx > 1) {
            lines.push([ax, ay, leftEdge, ay]);
            lines.push([rightEdge, by, bx, by]);
          } else {
            lines.push([ax, ay, rightEdge, ay]);
            lines.push([leftEdge, by, bx, by]);
          }
        } else {
          const topEdge = 0;
          const bottomEdge = state.gridSize * size;
          if (dy > 1) {
            lines.push([ax, ay, ax, topEdge]);
            lines.push([bx, bottomEdge, bx, by]);
          } else {
            lines.push([ax, ay, ax, bottomEdge]);
            lines.push([bx, topEdge, bx, by]);
          }
        }
      } else {
        lines.push([ax, ay, bx, by]);
      }
    }
    return lines;
  };

  const bodyLines = collectBodyLines();

  const drawBodyPath = () => {
    ctx.beginPath();
    let penX = null;
    let penY = null;
    bodyLines.forEach(([x1, y1, x2, y2]) => {
      if (penX !== x1 || penY !== y1) {
        ctx.moveTo(x1, y1);
      }
      ctx.lineTo(x2, y2);
      penX = x2;
      penY = y2;
    });
  };

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = strokeWidth;
  if (images.body && images.body.complete) {
    // Solid underlay prevents pattern artifacts in some canvas implementations.
    ctx.strokeStyle = "#c9954a";
    drawBodyPath();
    ctx.stroke();

    const bodyPattern = ctx.createPattern(images.body, "repeat");
    if (bodyPattern) {
      ctx.strokeStyle = bodyPattern;
      drawBodyPath();
      ctx.stroke();
    } else {
      ctx.strokeStyle = "#c9954a";
      drawBodyPath();
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = "#c9954a";
    drawBodyPath();
    ctx.stroke();
  }
  ctx.restore();

  const headImg = images.head;
  if (headImg && headImg.complete) {
    const head = state.snake[0];
    const centerX = head.x * size + size / 2;
    const centerY = head.y * size + size / 2;
    let rotation = 0;
    if (state.dir.x === 1) rotation = 0;
    if (state.dir.x === -1) rotation = Math.PI;
    if (state.dir.y === -1) rotation = -Math.PI / 2;
    if (state.dir.y === 1) rotation = Math.PI / 2;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);
    ctx.drawImage(headImg, -headSize / 2, -headSize / 2, headSize, headSize);
    ctx.restore();
  }
}

function updateScore() {
  scoreEl.textContent = String(state.score);
}

function tick() {
  updateRageState();
  if (paused || !state.alive || !gameStarted) {
    drawGrid();
    return;
  }
  const wasAlive = state.alive;
  const prevScore = state.score;
  const ateRageTreat = rageTreatActive;
  state = stepGame(state);
  const gained = state.score - prevScore;
  if (gained > 0 && ateRageTreat && gained < 2) {
    state = { ...state, score: state.score + (2 - gained) };
  } else if (gained > 0 && isRageMode() && gained < 2) {
    state = { ...state, score: state.score + (2 - gained) };
  }
  updateScore();
  if (state.score !== prevScore) {
    if (ateRageTreat) {
      activateLuluRage();
    } else if (!isRageMode()) {
      treatsSinceRage += 1;
    }
    assignFoodStyle();
  }
  if (wasAlive && !state.alive) {
    handleGameOver(state.score);
    openMenu("gameover");
  }
  drawGrid();
}

function getTickMs() {
  const base = START_SPEEDS.easy;
  const growth = Math.max(0, state.snake.length - 3);
  let ramp = Math.max(95, base - growth * 1.4);
  if (isRageMode()) ramp -= RAGE_SPEED_BONUS_MS;
  return Math.max(55, Math.round(ramp));
}

function scheduleTick() {
  if (timerId) clearTimeout(timerId);
  timerId = setTimeout(() => {
    tick();
    scheduleTick();
  }, getTickMs());
}

function fitCanvasToViewport() {
  const shellStyle = getComputedStyle(shellEl);
  const shellPadX = parseFloat(shellStyle.paddingLeft) + parseFloat(shellStyle.paddingRight);
  const shellPadY = parseFloat(shellStyle.paddingTop) + parseFloat(shellStyle.paddingBottom);
  const shellGap = parseFloat(shellStyle.rowGap || shellStyle.gap || "20");
  const stageStyle = getComputedStyle(stageEl);
  const stagePadX = parseFloat(stageStyle.paddingLeft) + parseFloat(stageStyle.paddingRight);
  const stagePadY = parseFloat(stageStyle.paddingTop) + parseFloat(stageStyle.paddingBottom);
  const stageBorderX = parseFloat(stageStyle.borderLeftWidth) + parseFloat(stageStyle.borderRightWidth);
  const stageBorderY = parseFloat(stageStyle.borderTopWidth) + parseFloat(stageStyle.borderBottomWidth);
  const stageChromeX = stagePadX + stageBorderX + 2;
  const stageChromeY = stagePadY + stageBorderY + 2;
  const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const bodyStyle = getComputedStyle(document.body);
  const bodyPadY = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);

  const byShellHeight =
    shellEl.clientHeight - shellPadY - topbarEl.offsetHeight - controlsEl.offsetHeight - shellGap * 2 - stageChromeY;
  const byViewportHeight =
    viewportHeight - bodyPadY - shellPadY - topbarEl.offsetHeight - controlsEl.offsetHeight - shellGap * 2 - stageChromeY;
  const byWidth = shellEl.clientWidth - shellPadX - stageChromeX;
  const nextSize = Math.floor(Math.min(byShellHeight, byViewportHeight, byWidth));

  if (nextSize >= 140 && (canvas.width !== nextSize || canvas.height !== nextSize)) {
    canvas.width = nextSize;
    canvas.height = nextSize;
    canvas.style.width = `${nextSize}px`;
    canvas.style.height = `${nextSize}px`;
    drawGrid();
  }
}

function resetGame() {
  unlockAudioIfNeeded();
  state = createGameState({
    gridSize: CELL_COUNT,
    seed: Date.now(),
    wallsEnabled: false,
  });
  state = { ...state, pointsPerFood: 1 };
  treatsSinceRage = 0;
  rageRemainingMs = 0;
  rageLastUpdateTs = Date.now();
  clearTimeout(ragePauseTimer);
  rageMusic.pause();
  rageMusic.currentTime = 0;
  rageMusic.volume = RAGE_MUSIC_VOLUME;
  rageMusicActive = false;
  if (rageFadeRaf) cancelAnimationFrame(rageFadeRaf);
  rageFadeRaf = null;
  ragePopup.hidden = true;
  document.body.classList.remove("rage-mode");
  lastFoodKey = null;
  paused = false;
  gameStarted = true;
  pauseButton.textContent = "Pause";
  updateScore();
  assignFoodStyle();
  overlay.hidden = true;
  drawGrid();
}

function updateDifficultyButtons() {
  if (difficultyCurrent) {
    difficultyCurrent.textContent = "Global scoreboard";
    top5Title.textContent = "Top 5 Global";
  }
  renderHighscores();
}

function getStoredName() {
  const name = localStorage.getItem(LAST_NAME_KEY);
  return name && name.trim() ? name.trim() : "Player 1";
}

function saveLastName(rawName) {
  const name = normalizeName(rawName);
  localStorage.setItem(LAST_NAME_KEY, name);
  return name;
}

function updateHighscoreName(id, rawName) {
  const idx = highscores.findIndex((entry) => entry.id === id);
  if (idx < 0) return;
  const normalized = normalizeName(rawName);
  highscores[idx] = { ...highscores[idx], name: normalized };
  applyHighscores(highscores);
  saveLastName(normalized);
  if (!id.startsWith("local-")) {
    updateHighscoreNameOnServer(id, normalized).catch((error) => {
      console.warn("Unable to sync highscore name update.", error);
    });
  }
}

function renderHighscores() {
  const scores = highscores;
  menuHighscoreList.innerHTML = "";
  if (scores.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No scores yet";
    menuHighscoreList.appendChild(li);
    return;
  }

  scores.forEach((entry, index) => {
    const li = document.createElement("li");
    const isPending = pendingHighscore && pendingHighscore.id === entry.id;
    if (isPending) {
      li.classList.add("top5-new");
      const input = document.createElement("input");
      input.className = "score-name-input";
      input.value = entry.name || "Player 1";
      input.addEventListener("input", () => {
        updateHighscoreName(entry.id, input.value);
      });
      input.addEventListener("blur", () => {
        const normalized = normalizeName(input.value);
        input.value = normalized;
        updateHighscoreName(entry.id, normalized);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });
      const suffix = document.createElement("span");
      suffix.textContent = `: ${entry.score}`;
      li.appendChild(input);
      li.appendChild(suffix);
    } else {
      li.textContent = `${entry.name}: ${entry.score}`;
    }
    menuHighscoreList.appendChild(li);
  });
}

function isTopFiveScore(score) {
  if (score <= 0) return false;
  if (highscores.length < MAX_HIGHSCORES) return true;
  const cutoff = highscores[MAX_HIGHSCORES - 1].score;
  return score >= cutoff;
}

function recordHighscore(score, rawName) {
  if (score <= 0) return null;
  const name = saveLastName(rawName);
  const entry = {
    id: `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    score,
    createdAt: Date.now(),
  };
  const nextScores = sortHighscores([...highscores, entry]);
  const idx = nextScores.findIndex((item) => item.id === entry.id);
  if (idx < 0) return null;
  applyHighscores(nextScores);

  void (async () => {
    try {
      const currentEntry = highscores.find((item) => item.id === entry.id) || entry;
      const remoteEntry = await insertHighscoreOnServer(currentEntry.name, currentEntry.score);
      if (!remoteEntry) return;
      const latestLocalEntry = highscores.find((item) => item.id === entry.id) || currentEntry;
      const localName = normalizeName(latestLocalEntry.name);
      const merged = highscores.filter((item) => item.id !== entry.id);
      merged.push({ ...remoteEntry, name: localName });
      applyHighscores(merged);
      if (pendingHighscore?.id === entry.id) {
        pendingHighscore = { id: remoteEntry.id };
      }
      renderHighscores();
      if (localName !== remoteEntry.name) {
        await updateHighscoreNameOnServer(remoteEntry.id, localName);
      }
      await refreshHighscoresFromServer();
    } catch (error) {
      console.warn("Unable to sync highscore with Supabase.", error);
    }
  })();

  return { id: entry.id };
}

function handleGameOver(score) {
  if (isTopFiveScore(score)) {
    pendingHighscore = recordHighscore(score, getStoredName());
    nameEntry.hidden = true;
  } else {
    pendingHighscore = null;
    nameEntry.hidden = true;
  }
  renderHighscores();
}

function initHighscores() {
  highscores = readHighscoreCache();
  renderHighscores();
  void refreshHighscoresFromServer();
}

function openMenu(mode) {
  gameStarted = false;
  paused = true;
  pauseButton.textContent = "Pause";
  overlay.hidden = false;
  renderHighscores();
  void refreshHighscoresFromServer();
  if (mode === "gameover") {
    menuTitle.textContent = "Game Over";
    menuText.textContent = `Score: ${state.score}. Press Play Again.`;
    startGameButton.textContent = "Play Again";
    if (!pendingHighscore) {
      nameEntry.hidden = true;
    } else {
      const inlineInput = menuHighscoreList.querySelector(".score-name-input");
      if (inlineInput) {
        inlineInput.focus();
        inlineInput.select();
      }
    }
  } else {
    pendingHighscore = null;
    nameEntry.hidden = true;
    menuTitle.textContent = "Lulu-Snake";
    menuText.textContent = "Press Start to begin.";
    startGameButton.textContent = "Start Game";
  }
}

function handleDirection(direction) {
  state = setDirection(state, direction);
}

function isSwipeInputTarget(target) {
  return target instanceof Element && target.closest("button, input, textarea, select, a, label");
}

function handleSwipeDirection(dx, dy) {
  if (!gameStarted || !state.alive) return false;
  if (Math.abs(dx) < SWIPE_THRESHOLD_PX && Math.abs(dy) < SWIPE_THRESHOLD_PX) return false;
  if (Math.abs(dx) > Math.abs(dy)) {
    handleDirection(dx > 0 ? "right" : "left");
  } else {
    handleDirection(dy > 0 ? "down" : "up");
  }
  return true;
}

function handleKey(event) {
  const key = event.key.toLowerCase();
  const target = event.target;
  const isTypingTarget =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable;
  if (isTypingTarget) return;

  const handledKeys = [
    "arrowup",
    "arrowdown",
    "arrowleft",
    "arrowright",
    "w",
    "a",
    "s",
    "d",
    " ",
    "r",
  ];
  if (handledKeys.includes(key)) {
    event.preventDefault();
  }

  if (key === "arrowup" || key === "w") handleDirection("up");
  if (key === "arrowdown" || key === "s") handleDirection("down");
  if (key === "arrowleft" || key === "a") handleDirection("left");
  if (key === "arrowright" || key === "d") handleDirection("right");

  if (key === " " && gameStarted && state.alive) {
    paused = !paused;
    pauseButton.textContent = paused ? "Resume" : "Pause";
  }

  if (key === "r") {
    openMenu("start");
  }
}

pauseButton.addEventListener("click", () => {
  if (!gameStarted || !state.alive) return;
  paused = !paused;
  pauseButton.textContent = paused ? "Resume" : "Pause";
});

restartButton.addEventListener("click", () => {
  openMenu("start");
});

startGameButton.addEventListener("click", () => {
  resetGame();
});

saveScoreButton.addEventListener("click", () => {
  nameEntry.hidden = true;
});

nameEntryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    nameEntry.hidden = true;
  }
});

document.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse") return;
  if (isSwipeInputTarget(event.target)) return;
  swipePointerId = event.pointerId;
  swipeLastX = event.clientX;
  swipeLastY = event.clientY;
});

document.addEventListener("pointermove", (event) => {
  if (event.pointerId !== swipePointerId) return;
  const dx = event.clientX - swipeLastX;
  const dy = event.clientY - swipeLastY;
  if (!handleSwipeDirection(dx, dy)) return;
  swipeLastX = event.clientX;
  swipeLastY = event.clientY;
});

function endSwipe(event) {
  if (event.pointerId !== swipePointerId) return;
  swipePointerId = null;
}

document.addEventListener("pointerup", endSwipe);
document.addEventListener("pointercancel", endSwipe);

document.addEventListener("keydown", handleKey);

updateScore();
updateAudioButton();
updateDifficultyButtons();
initHighscores();
fitCanvasToViewport();
drawGrid();
openMenu("start");

loadAssets().then(() => {
  fitCanvasToViewport();
  drawGrid();
  scheduleTick();
});

window.addEventListener("resize", fitCanvasToViewport);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", fitCanvasToViewport);
  window.visualViewport.addEventListener("scroll", fitCanvasToViewport);
}

function assignFoodStyle() {
  if (images.treats.length > 0) {
    currentTreatIndex = state.rngSeed % images.treats.length;
  }
  if (isRageMode()) {
    rageTreatActive = false;
    return;
  }
  const forceRage = treatsSinceRage >= FORCE_RAGE_AFTER_TREATS;
  rageTreatActive = forceRage || state.rngSeed % 100 < RAGE_CHANCE_PCT;
}

function isRageMode() {
  return rageRemainingMs > 0;
}

function updateRageState() {
  if (rageRemainingMs > 0) {
    const now = Date.now();
    if (!paused && gameStarted) {
      const elapsed = Math.max(0, now - rageLastUpdateTs);
      rageRemainingMs = Math.max(0, rageRemainingMs - elapsed);
    }
    rageLastUpdateTs = now;
  }

  if (rageRemainingMs > 0) {
    rageIndicator.hidden = false;
    rageTimer.textContent = `${(rageRemainingMs / 1000).toFixed(1)}s`;
    if (state.pointsPerFood !== 2) {
      state = { ...state, pointsPerFood: 2 };
    }
    duckBackgroundMusic();
    document.body.classList.add("rage-mode");
    return;
  }

  if (rageMusicActive) {
    fadeOutRageAndStop(RAGE_OUT_FADE_MS);
    rageMusicActive = false;
  }
  rageIndicator.hidden = true;
  if (state.pointsPerFood !== 1) {
    state = { ...state, pointsPerFood: 1 };
  }
  restoreBackgroundMusic();
  document.body.classList.remove("rage-mode");
}

function activateLuluRage() {
  unlockAudioIfNeeded();
  treatsSinceRage = 0;
  rageRemainingMs = RAGE_DURATION_MS + RAGE_POPUP_MS;
  rageLastUpdateTs = Date.now();
  state = { ...state, pointsPerFood: 2 };
  document.body.classList.add("rage-mode");
  duckBackgroundMusic();
  rageMusic.pause();
  rageMusic.currentTime = 0;
  rageMusic.volume = RAGE_MUSIC_VOLUME;
  rageMusicActive = true;
  if (!audioMuted) rageMusic.play().catch(() => {});
  rageIndicator.hidden = false;
  rageTimer.textContent = `${((RAGE_DURATION_MS + RAGE_POPUP_MS) / 1000).toFixed(1)}s`;
  ragePopup.hidden = false;
  clearTimeout(ragePauseTimer);
  paused = true;
  ragePauseTimer = setTimeout(() => {
    ragePopup.hidden = true;
    if (gameStarted && state.alive) {
      paused = false;
    }
  }, RAGE_POPUP_MS);
}

document.addEventListener("pointerdown", unlockAudioIfNeeded, { once: true });
document.addEventListener("keydown", unlockAudioIfNeeded, { once: true });

audioToggle.addEventListener("click", () => {
  unlockAudioIfNeeded();
  setAudioMuted(!audioMuted);
});
