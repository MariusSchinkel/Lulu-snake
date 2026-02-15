import { createGameState, setDirection, stepGame } from "./game.js";
import { createSupabaseRealtimeClient } from "./supabase-realtime-client.js";

function enforceNoFrameEmbedding() {
  const antiClickjackStyle = document.getElementById("anti-clickjack");
  if (window.top === window.self) {
    if (antiClickjackStyle) antiClickjackStyle.remove();
    return;
  }
  // Keep the page hidden when embedded; header CSP should still enforce framing in production.
  try {
    window.top.location = window.self.location.href;
  } catch {
    // Cross-origin frame access may throw.
  }
  throw new Error("Framed rendering is blocked.");
}

enforceNoFrameEmbedding();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const opponentScoreboardEl = document.getElementById("opponent-scoreboard");
const opponentScoreEl = document.getElementById("opponent-score");
const rageIndicator = document.getElementById("rage-indicator");
const rageTimer = document.getElementById("rage-timer");
const overlay = document.getElementById("overlay");
const top5Title = document.getElementById("top5-title");
const menuTitle = document.getElementById("menu-title");
const menuText = document.getElementById("menu-text");
const menuHighscoreList = document.getElementById("menu-highscore-list");
const nameEntry = document.getElementById("name-entry");
const nameEntryInput = document.getElementById("name-entry-input");
const saveScoreButton = document.getElementById("save-score");
const startGameButton = document.getElementById("start-game");
const modeSingleButton = document.getElementById("mode-single");
const modeDuelButton = document.getElementById("mode-duel");
const duelPanel = document.getElementById("duel-panel");
const duelRoomInput = document.getElementById("duel-room-input");
const duelCreateButton = document.getElementById("duel-create");
const duelJoinButton = document.getElementById("duel-join");
const duelStatusEl = document.getElementById("duel-status");
const ragePopup = document.getElementById("rage-popup");
const chaserAlert = document.getElementById("chaser-alert");
const chaserNameEl = document.getElementById("chaser-name");
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
const SUPABASE_SCORE_GATEWAY_FUNCTION = "submit-score";
const TURNSTILE_SITE_KEY = "0x4AAAAAACcl18ZU5k1Cjvaj";
const TURNSTILE_WAIT_MS = 8000;
const MAX_PLAYER_NAME_LENGTH = 24;
const MAX_SUBMIT_SCORE = 20000;
const HIGHSCORE_EDIT_TOKEN_KEY_PREFIX = "lulu-snake-edit-token-";
const HIGHSCORE_EDIT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EDIT_TOKEN_REGEX = /^[a-f0-9]{48}$/;
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
const SWIPE_THRESHOLD_MOBILE_PX = 18;
const BASE_START_TICK_MS = 230;
const CHASER_DURATION_MS = 45000;
const CHASER_SPEED_FACTOR = 1.12;
const CHASER_STEP_EXTRA_MS = 10;
const CHASER_CHANCE_PCT = 24;
const CHASER_FORCE_AFTER_TREATS = 12;
const CHASER_RECOVERY_TREATS = 12;
const CHASER_ALERT_MS = 4200;
const CHASER_MUSIC_VOLUME = 0.82;
const CHASER_OPTIONS = [
  { name: "Askaban" },
];
const DUEL_ROOM_CODE_KEY = "lulu-snake-duel-room";
const DUEL_SYNC_INTERVAL_MS = 180;
const DUEL_MAX_STALE_MS = 3600;
const DUEL_START_DELAY_MS = 1500;
const DUEL_TARGET_SCORE = 20;
const DUEL_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DUEL_CODE_LEN = 6;
const DUEL_SNAPSHOT_VERSION = 1;
const DUEL_FOOD_CLAIM_WINDOW_MS = 90;

let state = createGameState({ gridSize: CELL_COUNT, seed: 123456789 });
let paused = false;
let timerId = null;
let selectedMode = "single";
let images = {
  head: null,
  bodyFrames: [],
  bodyPlain: null,
  tail: null,
  treats: [],
  ragePee: null,
  rageDog: null,
  chaserAskaban: null,
};
let lastFoodKey = null;
let currentTreatIndex = 0;
let bodyFrameIndex = 0;
let gameStarted = false;
let pendingHighscore = null;
let pendingHighscoreName = "";
let highscores = [];
let turnstileWidgetId = null;
let turnstileContainer = null;
let turnstileRequestResolver = null;
let turnstileRequestRejector = null;
let turnstileRequestTimer = null;
let turnstileInFlightPromise = null;
let rageTreatActive = false;
let rageTreatReady = false;
let rageRunner = null;
let rageRemainingMs = 0;
let rageLastUpdateTs = 0;
let ragePauseTimer = null;
let audioUnlocked = false;
let bgWasDucked = false;
let rageMusicActive = false;
let audioMuted = localStorage.getItem(AUDIO_MUTED_KEY) === "1";
let rageAudioPrimed = false;
let ragePlayPending = false;
let chaserAudioPrimed = false;
let chaserPlayPending = false;
let chaserMusicActive = false;
let bgPausedForChaser = false;
let treatsSinceRage = 0;
let treatsSinceChaser = 0;
let chaserRecoveryTreatsRemaining = 0;
let activeChaser = null;
let chaserAlertTimer = null;
let bgFadeRaf = null;
let rageFadeRaf = null;
let swipePointerId = null;
let swipeLastX = 0;
let swipeLastY = 0;
const highscoreEditTokens = new Map();
const HIDDEN_FOOD = { x: -9999, y: -9999 };
let supabaseRealtimeClient = null;
let duelPlayerId = createEditToken();
let duelPendingStartTimer = null;
let duelLastBroadcastTs = 0;
let duel = {
  roomCode: "",
  connected: false,
  channel: null,
  hostId: "",
  players: [],
  localReady: false,
  remoteReady: false,
  activeRound: false,
  sharedSeed: 0,
  sharedFood: null,
  foodVersion: 0,
  scores: {},
  pendingClaims: [],
  claimTimer: null,
  lastClaimedVersion: 0,
  pendingGrowthVersion: 0,
  localStartAt: 0,
  resultLocked: false,
  resultText: "",
  remoteState: null,
};

const bgMusic = new Audio("./assets/bg-music.mp3");
bgMusic.loop = true;
bgMusic.volume = BG_MUSIC_VOLUME;
bgMusic.playsInline = true;

const rageMusic = new Audio("./assets/lulu-rage.mp3");
rageMusic.loop = false;
rageMusic.volume = RAGE_MUSIC_VOLUME;
rageMusic.playsInline = true;

const chaserMusic = new Audio("./assets/askaban-song.mp3");
chaserMusic.loop = true;
chaserMusic.volume = CHASER_MUSIC_VOLUME;
chaserMusic.playsInline = true;
bgMusic.muted = audioMuted;
rageMusic.muted = audioMuted;
chaserMusic.muted = audioMuted;

function playRageTrack() {
  if (audioMuted) return;
  rageMusic.play().then(() => {
    ragePlayPending = false;
  }).catch(() => {
    ragePlayPending = true;
  });
}

function playChaserTrack() {
  if (audioMuted || isRageMode()) return;
  chaserMusic.play().then(() => {
    chaserMusicActive = true;
    chaserPlayPending = false;
  }).catch(() => {
    chaserMusicActive = false;
    chaserPlayPending = true;
  });
}

function startChaserMusic() {
  if (audioMuted || isRageMode()) return;
  if (!bgMusic.paused) {
    bgMusic.pause();
    bgPausedForChaser = true;
  }
  chaserMusic.pause();
  chaserMusic.currentTime = 0;
  chaserMusic.volume = CHASER_MUSIC_VOLUME;
  chaserPlayPending = true;
  playChaserTrack();
}

function stopChaserMusic() {
  if (!chaserMusic.paused || chaserMusicActive) {
    chaserMusic.pause();
    chaserMusic.currentTime = 0;
  }
  chaserMusicActive = false;
  chaserPlayPending = false;
  if (bgPausedForChaser) {
    bgPausedForChaser = false;
    if (!audioMuted && !isRageMode()) {
      bgMusic.volume = bgWasDucked ? BG_DUCKED_VOLUME : BG_MUSIC_VOLUME;
      bgMusic.play().catch(() => {});
    }
  }
}

function primeRageTrackIfNeeded() {
  if (audioMuted || rageAudioPrimed) return;
  const wasMuted = rageMusic.muted;
  const previousVolume = rageMusic.volume;
  rageMusic.pause();
  rageMusic.currentTime = 0;
  rageMusic.muted = true;
  rageMusic.volume = 0;
  rageMusic.play().then(() => {
    rageMusic.pause();
    rageMusic.currentTime = 0;
    rageMusic.muted = wasMuted;
    rageMusic.volume = previousVolume;
    rageAudioPrimed = true;
    if (ragePlayPending && isRageMode() && !audioMuted) {
      playRageTrack();
    }
  }).catch(() => {
    rageMusic.muted = wasMuted;
    rageMusic.volume = previousVolume;
  });
}

function primeChaserTrackIfNeeded() {
  if (audioMuted || chaserAudioPrimed) return;
  const wasMuted = chaserMusic.muted;
  const previousVolume = chaserMusic.volume;
  chaserMusic.pause();
  chaserMusic.currentTime = 0;
  chaserMusic.muted = true;
  chaserMusic.volume = 0;
  chaserMusic.play().then(() => {
    chaserMusic.pause();
    chaserMusic.currentTime = 0;
    chaserMusic.muted = wasMuted;
    chaserMusic.volume = previousVolume;
    chaserAudioPrimed = true;
    if (chaserPlayPending && activeChaser && !isRageMode() && !audioMuted) {
      playChaserTrack();
    }
  }).catch(() => {
    chaserMusic.muted = wasMuted;
    chaserMusic.volume = previousVolume;
  });
}

function updateAudioButton() {
  if (!audioToggle) return;
  audioToggle.textContent = audioMuted ? "🔇" : "🔊";
  audioToggle.setAttribute("aria-label", audioMuted ? "Audio Off" : "Audio On");
  audioToggle.setAttribute("title", audioMuted ? "Audio Off" : "Audio On");
  audioToggle.setAttribute("aria-pressed", String(!audioMuted));
  audioToggle.classList.toggle("muted", audioMuted);
}

function isDuelSelected() {
  return selectedMode === "duel";
}

function isDuelRoundActive() {
  return duel.activeRound;
}

function updateOpponentScore(nextScore = 0) {
  if (!opponentScoreEl || !opponentScoreboardEl) return;
  opponentScoreEl.textContent = String(Math.max(0, Math.floor(Number(nextScore) || 0)));
  opponentScoreboardEl.hidden = !isDuelRoundActive();
}

function setDuelStatus(message) {
  if (duelStatusEl) duelStatusEl.textContent = message;
}

function normalizeDuelRoomCode(raw) {
  const safe = String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  return safe;
}

function createRoomCode(length = DUEL_CODE_LEN) {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += DUEL_CODE_CHARS[Math.floor(Math.random() * DUEL_CODE_CHARS.length)];
  }
  return code;
}

function isDuelReadyToStart() {
  return duel.connected && duel.players.length === 2;
}

function updateModeButtons() {
  if (modeSingleButton) modeSingleButton.classList.toggle("active", selectedMode === "single");
  if (modeDuelButton) modeDuelButton.classList.toggle("active", selectedMode === "duel");
  if (duelPanel) duelPanel.hidden = selectedMode !== "duel";
  if (nameEntry && selectedMode === "duel") nameEntry.hidden = true;
  const canStartSingle = selectedMode === "single";
  startGameButton.disabled = selectedMode === "duel" && !isDuelReadyToStart();
  if (selectedMode === "single") {
    top5Title.textContent = "Top 5 Global";
    if (menuHighscoreList?.parentElement) menuHighscoreList.parentElement.hidden = false;
  } else {
    startGameButton.textContent = isDuelReadyToStart() ? "Start 1v1" : "Waiting for Opponent";
    top5Title.textContent = "Top 5 Global";
    if (menuHighscoreList?.parentElement) menuHighscoreList.parentElement.hidden = true;
  }
  if (!canStartSingle) {
    pendingHighscore = null;
    pendingHighscoreName = "";
    hidePendingNameEntry();
  }
}

function applySelectedMode(mode) {
  const next = mode === "duel" ? "duel" : "single";
  if (selectedMode === next) {
    updateModeButtons();
    return;
  }
  selectedMode = next;
  if (selectedMode === "single") {
    stopDuelSession({ keepMode: true });
  }
  updateModeButtons();
}

function sortedPlayerIds() {
  return [...duel.players].sort();
}

function recomputeDuelHost() {
  const ids = sortedPlayerIds();
  duel.hostId = ids[0] || "";
}

function isDuelHost() {
  return duel.connected && duel.hostId === duelPlayerId;
}

function normalizeName(rawName) {
  const sanitized = String(rawName || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PLAYER_NAME_LENGTH);
  return sanitized || "Player 1";
}

function normalizeScore(rawScore) {
  return Math.max(0, Math.min(MAX_SUBMIT_SCORE, Math.floor(Number(rawScore) || 0)));
}

function isScoreInAllowedRange(rawScore) {
  const score = Number(rawScore);
  return Number.isFinite(score) && Math.floor(score) >= 0 && Math.floor(score) <= MAX_SUBMIT_SCORE;
}

function isValidEditToken(rawToken) {
  return EDIT_TOKEN_REGEX.test(String(rawToken || "").trim().toLowerCase());
}

function editTokenStorageKey(id) {
  return `${HIGHSCORE_EDIT_TOKEN_KEY_PREFIX}${id}`;
}

function parseStoredEditTokenRecord(rawValue) {
  const raw = String(rawValue || "");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const token = String(parsed?.token || "").trim().toLowerCase();
    const expiresAt = Number(parsed?.expiresAt);
    if (!isValidEditToken(token)) return null;
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) return null;
    return { token, expiresAt, needsRewrite: false };
  } catch {
    const legacyToken = raw.trim().toLowerCase();
    if (!isValidEditToken(legacyToken)) return null;
    return { token: legacyToken, expiresAt: Date.now() + HIGHSCORE_EDIT_TOKEN_TTL_MS, needsRewrite: true };
  }
}

function purgeExpiredStoredEditTokens() {
  try {
    const now = Date.now();
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(HIGHSCORE_EDIT_TOKEN_KEY_PREFIX)) continue;
      const record = parseStoredEditTokenRecord(localStorage.getItem(key));
      if (!record || record.expiresAt <= now) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage access issues.
  }
}

function createEditToken() {
  try {
    if (window.crypto?.getRandomValues) {
      const bytes = new Uint8Array(24);
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // Ignore and fail closed below.
  }
  return "";
}

function storeHighscoreEditToken(id, token) {
  if (!id || !isValidEditToken(token)) return;
  const normalized = String(token || "").trim().toLowerCase();
  const expiresAt = Date.now() + HIGHSCORE_EDIT_TOKEN_TTL_MS;
  highscoreEditTokens.set(id, { token: normalized, expiresAt });
  try {
    localStorage.setItem(editTokenStorageKey(id), JSON.stringify({ token: normalized, expiresAt }));
  } catch {
    // Ignore storage errors (private mode / quota).
  }
}

function readHighscoreEditToken(id) {
  if (!id) return "";
  const now = Date.now();
  const inMemory = highscoreEditTokens.get(id);
  if (inMemory && isValidEditToken(inMemory.token) && inMemory.expiresAt > now) return inMemory.token;
  if (inMemory && inMemory.expiresAt <= now) {
    highscoreEditTokens.delete(id);
  }
  try {
    const rawStored = localStorage.getItem(editTokenStorageKey(id));
    const stored = parseStoredEditTokenRecord(rawStored);
    if (!stored || stored.expiresAt <= now) {
      localStorage.removeItem(editTokenStorageKey(id));
      return "";
    }
    highscoreEditTokens.set(id, { token: stored.token, expiresAt: stored.expiresAt });
    if (stored.needsRewrite) {
      localStorage.setItem(editTokenStorageKey(id), JSON.stringify({
        token: stored.token,
        expiresAt: stored.expiresAt,
      }));
    }
    return stored.token;
  } catch {
    return "";
  }
}

function clearHighscoreEditToken(id) {
  if (!id) return;
  highscoreEditTokens.delete(id);
  try {
    localStorage.removeItem(editTokenStorageKey(id));
  } catch {
    // Ignore storage errors.
  }
}

function moveHighscoreEditToken(fromId, toId) {
  const token = readHighscoreEditToken(fromId);
  if (!token || !toId) return;
  storeHighscoreEditToken(toId, token);
  clearHighscoreEditToken(fromId);
}

function sameCell(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y;
}

function wrappedAxisDelta(from, to, size) {
  let delta = to - from;
  const half = size / 2;
  if (delta > half) delta -= size;
  if (delta < -half) delta += size;
  return delta;
}

function wrappedDistance(a, b, size) {
  return Math.abs(wrappedAxisDelta(a.x, b.x, size)) + Math.abs(wrappedAxisDelta(a.y, b.y, size));
}

function wrapCoord(value, size) {
  return (value + size) % size;
}

function isSnakeCell(cell) {
  return state.snake.some((segment) => segment.x === cell.x && segment.y === cell.y);
}

function chooseChaserSpawnCell() {
  const size = state.gridSize;
  const head = state.snake[0];
  const minDistance = Math.floor(size * 0.45);

  for (let attempt = 0; attempt < 90; attempt += 1) {
    const candidate = {
      x: Math.floor(Math.random() * size),
      y: Math.floor(Math.random() * size),
    };
    if (sameCell(candidate, state.food) || isSnakeCell(candidate)) continue;
    if (wrappedDistance(candidate, head, size) < minDistance) continue;
    return candidate;
  }

  return {
    x: wrapCoord(head.x + Math.floor(size / 2), size),
    y: wrapCoord(head.y + Math.floor(size / 2), size),
  };
}

function hideChaserAlert() {
  if (chaserAlertTimer) clearTimeout(chaserAlertTimer);
  chaserAlertTimer = null;
  if (!chaserAlert) return;
  chaserAlert.hidden = true;
  chaserAlert.classList.remove("pop");
}

function getDirectionToward(from, to, size) {
  const dx = wrappedAxisDelta(from.x, to.x, size);
  const dy = wrappedAxisDelta(from.y, to.y, size);
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
    return { dx: Math.sign(dx), dy: 0 };
  }
  if (dy !== 0) {
    return { dx: 0, dy: Math.sign(dy) };
  }
  return { dx: 1, dy: 0 };
}

function showChaserAlert(name) {
  if (!chaserAlert || !chaserNameEl) return;
  hideChaserAlert();
  chaserNameEl.textContent = name.toUpperCase();
  chaserAlert.hidden = false;
  chaserAlert.classList.remove("pop");
  void chaserAlert.offsetWidth;
  chaserAlert.classList.add("pop");
  chaserAlertTimer = setTimeout(() => {
    if (!chaserAlert) return;
    chaserAlert.hidden = true;
    chaserAlert.classList.remove("pop");
  }, CHASER_ALERT_MS);
}

function clearActiveChaser() {
  const hadActiveChaser = !!activeChaser;
  activeChaser = null;
  stopChaserMusic();
  if (hadActiveChaser) {
    treatsSinceChaser = 0;
    chaserRecoveryTreatsRemaining = CHASER_RECOVERY_TREATS;
  }
}

function getChaserStepMs() {
  // Askaban must stay slightly slower than snake while still being threatening.
  let factor = CHASER_SPEED_FACTOR;
  if (activeChaser && state.snake[0]) {
    const distance = wrappedDistance(activeChaser.pos, state.snake[0], state.gridSize);
    if (distance > 6) factor -= 0.04;
    if (distance > 10) factor -= 0.03;
    if (distance < 3) factor += 0.05;
  }
  // Keep a hard lower bound above snake tick so Askaban never outruns the snake.
  const effectiveFactor = Math.max(1.03, factor);
  return Math.max(92, Math.round(getTickMs() * effectiveFactor + CHASER_STEP_EXTRA_MS));
}

function spawnChaser() {
  if (activeChaser || !gameStarted || !state.alive) return false;
  if (isRageMode() || rageTreatActive) return false;
  const pick = CHASER_OPTIONS[state.rngSeed % CHASER_OPTIONS.length];
  const spawn = chooseChaserSpawnCell();
  const initialDir = getDirectionToward(spawn, state.snake[0], state.gridSize);
  const now = performance.now();
  activeChaser = {
    name: pick.name,
    pos: spawn,
    dir: initialDir,
    remainingMs: CHASER_DURATION_MS,
    lastUpdateTs: now,
    nextMoveTs: now + getChaserStepMs(),
  };
  showChaserAlert(pick.name);
  startChaserMusic();
  return true;
}

function maybeSpawnChaser() {
  if (activeChaser || !gameStarted || !state.alive) return;
  if (isRageMode() || rageTreatActive) return;
  if (chaserRecoveryTreatsRemaining > 0) return;
  const force = treatsSinceChaser >= CHASER_FORCE_AFTER_TREATS;
  if (force || state.rngSeed % 100 < CHASER_CHANCE_PCT) {
    spawnChaser();
  }
}

function getChaserStepToward(head, pos, size) {
  const directions = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  const currentHeadDist = wrappedDistance(pos, head, size);
  const dxToHead = wrappedAxisDelta(pos.x, head.x, size);
  const dyToHead = wrappedAxisDelta(pos.y, head.y, size);
  const preferX = Math.abs(dxToHead) >= Math.abs(dyToHead);
  const preferredDx = dxToHead === 0 ? 0 : Math.sign(dxToHead);
  const preferredDy = dyToHead === 0 ? 0 : Math.sign(dyToHead);
  let best = null;

  for (const step of directions) {
    const next = {
      x: wrapCoord(pos.x + step.dx, size),
      y: wrapCoord(pos.y + step.dy, size),
    };
    const nextHeadDist = wrappedDistance(next, head, size);
    const forward = step.dx === activeChaser.dir.dx && step.dy === activeChaser.dir.dy;
    const reverse = step.dx === -activeChaser.dir.dx && step.dy === -activeChaser.dir.dy;
    const hitsBody = state.snake.slice(1).some((segment) => sameCell(segment, next));

    // Prioritize distance reduction to snake head with minimal inertia bias.
    let score = (currentHeadDist - nextHeadDist) * 10.5;
    if (nextHeadDist < currentHeadDist) score += 1.0;
    if (nextHeadDist === 0) score += 220;
    score += forward ? 0.08 : 0;
    score -= reverse ? 0.25 : 0;
    if (preferX && step.dx === preferredDx && preferredDx !== 0) score += 0.45;
    if (!preferX && step.dy === preferredDy && preferredDy !== 0) score += 0.45;
    if (hitsBody && !sameCell(next, head)) score -= 1.1;
    score += Math.random() * 0.004;

    if (!best || score > best.score) {
      best = { step, score };
    }
  }

  return best ? { dx: best.step.dx, dy: best.step.dy } : { dx: 0, dy: 0 };
}

function updateChaserState() {
  if (!activeChaser || !gameStarted || !state.alive || paused) return;
  const head = state.snake[0];
  if (sameCell(activeChaser.pos, head)) {
    state = { ...state, alive: false };
    return;
  }

  const now = performance.now();
  const elapsed = Math.max(0, now - activeChaser.lastUpdateTs);
  activeChaser.remainingMs -= elapsed;
  activeChaser.lastUpdateTs = now;

  if (activeChaser.remainingMs <= 0) {
    clearActiveChaser();
    return;
  }

  if (now < activeChaser.nextMoveTs) return;
  const step = getChaserStepToward(head, activeChaser.pos, state.gridSize);
  if (step.dx !== 0 || step.dy !== 0) {
    activeChaser.dir = step;
    activeChaser.pos = {
      x: wrapCoord(activeChaser.pos.x + step.dx, state.gridSize),
      y: wrapCoord(activeChaser.pos.y + step.dy, state.gridSize),
    };
  }
  activeChaser.nextMoveTs = now + getChaserStepMs();
  if (sameCell(activeChaser.pos, state.snake[0])) {
    state = { ...state, alive: false };
  }
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
        score: isScoreInAllowedRange(entry.score) ? Math.floor(Number(entry.score)) : null,
        createdAt: Number(entry.createdAt) || Date.now(),
      })).filter((entry) => entry.score !== null)
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

function isTurnstileConfigured() {
  return Boolean(
    TURNSTILE_SITE_KEY
    && TURNSTILE_SITE_KEY !== "REPLACE_WITH_TURNSTILE_SITE_KEY"
    && TURNSTILE_SITE_KEY !== "YOUR_TURNSTILE_SITE_KEY"
  );
}

function waitForTurnstileApi() {
  return new Promise((resolve, reject) => {
    const start = performance.now();

    function poll() {
      if (window.turnstile?.render && window.turnstile?.execute) {
        resolve(window.turnstile);
        return;
      }
      if (performance.now() - start > TURNSTILE_WAIT_MS) {
        reject(new Error("Turnstile API unavailable"));
        return;
      }
      setTimeout(poll, 60);
    }

    poll();
  });
}

function cleanupTurnstilePending() {
  if (turnstileRequestTimer) {
    clearTimeout(turnstileRequestTimer);
    turnstileRequestTimer = null;
  }
  turnstileRequestResolver = null;
  turnstileRequestRejector = null;
}

async function ensureTurnstileWidget() {
  if (!isTurnstileConfigured()) {
    throw new Error("Turnstile site key is not configured in app.js");
  }
  await waitForTurnstileApi();
  if (turnstileWidgetId !== null) return turnstileWidgetId;

  turnstileContainer = document.createElement("div");
  turnstileContainer.style.position = "fixed";
  turnstileContainer.style.left = "-9999px";
  turnstileContainer.style.top = "-9999px";
  turnstileContainer.style.opacity = "0";
  turnstileContainer.style.pointerEvents = "none";
  document.body.appendChild(turnstileContainer);

  turnstileWidgetId = window.turnstile.render(turnstileContainer, {
    sitekey: TURNSTILE_SITE_KEY,
    size: "invisible",
    callback: (token) => {
      const resolve = turnstileRequestResolver;
      cleanupTurnstilePending();
      if (resolve) resolve(String(token || ""));
    },
    "error-callback": () => {
      const reject = turnstileRequestRejector;
      cleanupTurnstilePending();
      if (reject) reject(new Error("Turnstile verification failed"));
    },
    "expired-callback": () => {
      const reject = turnstileRequestRejector;
      cleanupTurnstilePending();
      if (reject) reject(new Error("Turnstile token expired"));
    },
  });

  return turnstileWidgetId;
}

async function requestTurnstileToken(action) {
  if (turnstileInFlightPromise) return turnstileInFlightPromise;
  turnstileInFlightPromise = (async () => {
    const widgetId = await ensureTurnstileWidget();
    const token = await new Promise((resolve, reject) => {
      turnstileRequestResolver = resolve;
      turnstileRequestRejector = reject;
      turnstileRequestTimer = setTimeout(() => {
        cleanupTurnstilePending();
        reject(new Error("Turnstile timeout"));
      }, TURNSTILE_WAIT_MS);
      window.turnstile.reset(widgetId);
      window.turnstile.execute(widgetId, { action });
    });
    if (!token) {
      throw new Error("Turnstile returned empty token");
    }
    return token;
  })().finally(() => {
    turnstileInFlightPromise = null;
  });
  return turnstileInFlightPromise;
}

async function ensureSupabaseRealtimeClient() {
  if (supabaseRealtimeClient) return supabaseRealtimeClient;
  supabaseRealtimeClient = createSupabaseRealtimeClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabaseRealtimeClient;
}

function duelChannelName(roomCode) {
  return `lulu-duel-${normalizeDuelRoomCode(roomCode).toLowerCase()}`;
}

function updateDuelPresencePlayers(channel) {
  const presence = channel?.presenceState?.() || {};
  duel.players = Object.keys(presence);
  recomputeDuelHost();
  if (duel.connected && duel.players.length <= 1 && !duel.activeRound) {
    setDuelStatus(`Room ${duel.roomCode}: waiting for opponent...`);
  } else if (duel.connected && duel.players.length >= 2 && !duel.activeRound) {
    if (isDuelHost()) {
      setDuelStatus(`Room ${duel.roomCode}: opponent joined. Press Start 1v1.`);
    } else {
      setDuelStatus(`Room ${duel.roomCode}: waiting for host to start.`);
    }
  }
  if (duel.players.length > 2 && !duel.activeRound) {
    setDuelStatus(`Room ${duel.roomCode} is full. Use another code.`);
  }
  updateModeButtons();
}

function sanitizeSnakePayload(rawSnake) {
  if (!Array.isArray(rawSnake)) return null;
  const out = [];
  for (const segment of rawSnake.slice(0, CELL_COUNT * CELL_COUNT)) {
    const x = Number(segment?.x);
    const y = Number(segment?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ x: ((Math.floor(x) % CELL_COUNT) + CELL_COUNT) % CELL_COUNT, y: ((Math.floor(y) % CELL_COUNT) + CELL_COUNT) % CELL_COUNT });
  }
  return out.length > 0 ? out : null;
}

function sanitizeFoodCell(rawCell) {
  if (!rawCell) return null;
  const x = Number(rawCell.x);
  const y = Number(rawCell.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: ((Math.floor(x) % CELL_COUNT) + CELL_COUNT) % CELL_COUNT,
    y: ((Math.floor(y) % CELL_COUNT) + CELL_COUNT) % CELL_COUNT,
  };
}

function handleDuelSnapshot(payload) {
  if (!payload || payload.playerId === duelPlayerId) return;
  if (Number(payload.v || 0) !== DUEL_SNAPSHOT_VERSION) return;
  const payloadFoodVersion = Math.floor(Number(payload.foodVersion) || 0);
  if (
    !isDuelHost()
    && payload.playerId === duel.hostId
    && payloadFoodVersion > duel.foodVersion
    && sanitizeFoodCell(payload.food)
  ) {
    applyDuelFoodUpdate({
      food: payload.food,
      foodVersion: payloadFoodVersion,
      scores: payload.scores,
    });
  }
  const snake = sanitizeSnakePayload(payload.snake);
  if (!snake) return;
  const score = normalizeScore(payload.score);
  const dir = payload.dir && Number.isFinite(payload.dir.x) && Number.isFinite(payload.dir.y)
    ? { x: Math.sign(payload.dir.x), y: Math.sign(payload.dir.y) }
    : { x: 1, y: 0 };
  duel.remoteState = {
    playerId: String(payload.playerId),
    snake,
    dir,
    score,
    alive: !!payload.alive,
    ts: Date.now(),
  };
  updateOpponentScore(score);
}

function getFreshRemoteSnake() {
  if (!duel.remoteState || !Array.isArray(duel.remoteState.snake)) return null;
  if (Date.now() - duel.remoteState.ts > DUEL_MAX_STALE_MS) return null;
  return duel.remoteState.snake;
}

function isLocalHeadTouchingRemoteSnake() {
  if (!isDuelRoundActive() || !state?.snake?.[0]) return false;
  const remoteSnake = getFreshRemoteSnake();
  if (!remoteSnake) return false;
  const head = state.snake[0];
  return remoteSnake.some((segment) => segment.x === head.x && segment.y === head.y);
}

function nextDuelSeed(seed) {
  return (seed * 1664525 + 1013904223) >>> 0;
}

function createDuelSpawn(gridSize, asHost) {
  const y = Math.floor(gridSize / 2);
  const hostHeadX = Math.max(3, Math.floor(gridSize * 0.24));
  const guestHeadX = Math.min(gridSize - 4, Math.floor(gridSize * 0.76));
  if (asHost) {
    return {
      dir: { x: 1, y: 0 },
      snake: [
        { x: hostHeadX, y },
        { x: hostHeadX - 1, y },
        { x: hostHeadX - 2, y },
      ],
    };
  }
  return {
    dir: { x: -1, y: 0 },
    snake: [
      { x: guestHeadX, y },
      { x: guestHeadX + 1, y },
      { x: guestHeadX + 2, y },
    ],
  };
}

function pickDuelFoodCell(gridSize, occupiedSegments, seed) {
  let nextSeed = seed >>> 0;
  const occupied = new Set((occupiedSegments || []).map((segment) => `${segment.x},${segment.y}`));

  for (let attempt = 0; attempt < gridSize * gridSize * 2; attempt += 1) {
    nextSeed = nextDuelSeed(nextSeed);
    const x = nextSeed % gridSize;
    nextSeed = nextDuelSeed(nextSeed);
    const y = nextSeed % gridSize;
    const key = `${x},${y}`;
    if (!occupied.has(key)) {
      return { food: { x, y }, seed: nextSeed };
    }
  }

  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      const key = `${x},${y}`;
      if (!occupied.has(key)) {
        return { food: { x, y }, seed: nextSeed };
      }
    }
  }

  return { food: { x: 0, y: 0 }, seed: nextSeed };
}

function getDuelOpponentId() {
  const fromPresence = duel.players.find((id) => id !== duelPlayerId);
  if (fromPresence) return fromPresence;
  const fromSnapshot = duel.remoteState?.playerId;
  return fromSnapshot && fromSnapshot !== duelPlayerId ? fromSnapshot : "";
}

function isHostPayload(payload) {
  const sender = String(payload?.playerId || "");
  return !!sender && !!duel.hostId && sender === duel.hostId;
}

function isOpponentPayload(payload) {
  const sender = String(payload?.playerId || "");
  const opponentId = getDuelOpponentId();
  return !!sender && !!opponentId && sender === opponentId;
}

function getDuelScoreFor(playerId) {
  if (!playerId) return 0;
  return normalizeScore(duel.scores[playerId] || 0);
}

function applyDuelFoodUpdate(payload) {
  const food = sanitizeFoodCell(payload?.food);
  if (!food) return;
  const incomingVersion = Math.max(1, Math.floor(Number(payload?.foodVersion) || 0));
  if (incomingVersion < duel.foodVersion) return;
  const consumedVersion = incomingVersion - 1;
  const eaterId = String(payload?.eaterId || "");

  if (
    isDuelRoundActive()
    && eaterId
    && duel.pendingGrowthVersion === consumedVersion
    && eaterId !== duelPlayerId
    && Array.isArray(state.snake)
    && state.snake.length > 3
  ) {
    state = { ...state, snake: state.snake.slice(0, -1) };
  }
  if (duel.pendingGrowthVersion > 0 && duel.pendingGrowthVersion <= consumedVersion) {
    duel.pendingGrowthVersion = 0;
  }

  duel.sharedFood = food;
  duel.foodVersion = incomingVersion;
  duel.lastClaimedVersion = Math.min(duel.lastClaimedVersion, incomingVersion - 1);
  if (Number.isFinite(payload?.foodSeed)) {
    duel.sharedSeed = (Number(payload.foodSeed) >>> 0);
  }

  if (payload?.scores && typeof payload.scores === "object") {
    const normalizedScores = {};
    for (const [id, raw] of Object.entries(payload.scores)) {
      normalizedScores[String(id)] = normalizeScore(raw);
    }
    duel.scores = { ...duel.scores, ...normalizedScores };
  }

  if (isDuelRoundActive()) {
    const localScore = getDuelScoreFor(duelPlayerId);
    state = { ...state, score: localScore, food };
    updateScore();
  }

  const opponentId = getDuelOpponentId();
  const opponentScore = getDuelScoreFor(opponentId);
  updateOpponentScore(opponentScore);
  if (duel.remoteState && opponentId && duel.remoteState.playerId === opponentId) {
    duel.remoteState = { ...duel.remoteState, score: opponentScore };
  }

  const winnerId = String(payload?.winnerId || "");
  if (winnerId && isDuelRoundActive()) {
    if (winnerId === duelPlayerId) {
      finishDuelRound("You won the 1v1 race.", null);
      return;
    }
    finishDuelRound(`You lost the race. Opponent reached ${DUEL_TARGET_SCORE} treats.`, null);
  }
}

function queueDuelFoodClaim(playerId, version, sentAt = Date.now()) {
  if (!isDuelHost() || !isDuelRoundActive()) return;
  if (!playerId || version !== duel.foodVersion || version <= 0) return;
  if (duel.pendingClaims.some((claim) => claim.version === version && claim.playerId === playerId)) {
    return;
  }
  duel.pendingClaims.push({
    playerId,
    version,
    sentAt: Number(sentAt) || Date.now(),
  });
  if (duel.claimTimer) return;
  duel.claimTimer = setTimeout(() => {
    duel.claimTimer = null;
    resolveDuelFoodClaims(version);
  }, DUEL_FOOD_CLAIM_WINDOW_MS);
}

function resolveDuelFoodClaims(version) {
  if (!isDuelHost() || !isDuelRoundActive()) return;
  if (version !== duel.foodVersion || version <= 0) return;

  const claims = duel.pendingClaims.filter((claim) => claim.version === version);
  duel.pendingClaims = duel.pendingClaims.filter((claim) => claim.version > version);
  if (claims.length === 0) return;

  claims.sort((a, b) => a.sentAt - b.sentAt || a.playerId.localeCompare(b.playerId));
  const winnerId = claims[0].playerId;

  const opponentId = getDuelOpponentId();
  const nextScores = {
    ...duel.scores,
    [duelPlayerId]: getDuelScoreFor(duelPlayerId),
  };
  if (opponentId) {
    nextScores[opponentId] = getDuelScoreFor(opponentId);
  }
  nextScores[winnerId] = normalizeScore((nextScores[winnerId] || 0) + 1);

  const occupied = [...state.snake];
  const remoteSnake = getFreshRemoteSnake();
  if (remoteSnake) occupied.push(...remoteSnake);
  const pick = pickDuelFoodCell(CELL_COUNT, occupied, duel.sharedSeed || Date.now());
  const winnerReached = (nextScores[winnerId] || 0) >= DUEL_TARGET_SCORE;
  const nextPayload = {
    food: pick.food,
    foodVersion: duel.foodVersion + 1,
    foodSeed: pick.seed,
    scores: nextScores,
    eaterId: winnerId,
    winnerId: winnerReached ? winnerId : "",
  };

  applyDuelFoodUpdate(nextPayload);
  sendDuelBroadcast("duel-food-update", nextPayload);
}

function handleLocalDuelFoodClaim() {
  if (!isDuelRoundActive() || !duel.sharedFood) return;
  const version = duel.foodVersion;
  if (version <= 0 || duel.lastClaimedVersion === version) return;
  duel.pendingGrowthVersion = version;
  duel.lastClaimedVersion = version;
  const sentAt = Date.now();
  if (isDuelHost()) {
    queueDuelFoodClaim(duelPlayerId, version, sentAt);
  }
  sendDuelBroadcast("duel-food-claim", {
    foodVersion: version,
    head: state.snake[0],
    sentAt,
  });
}

function handleRemoteDuelFoodClaim(payload) {
  if (!isDuelHost() || !isDuelRoundActive()) return;
  if (!payload || payload.playerId === duelPlayerId) return;
  if (!isOpponentPayload(payload)) return;
  const version = Math.floor(Number(payload.foodVersion) || 0);
  if (version <= 0) return;
  queueDuelFoodClaim(String(payload.playerId), version, Number(payload.sentAt) || Date.now());
}

function clearDuelRuntimeState() {
  clearTimeout(duelPendingStartTimer);
  duelPendingStartTimer = null;
  clearTimeout(duel.claimTimer);
  duel.claimTimer = null;
  duel.localReady = false;
  duel.remoteReady = false;
  duel.activeRound = false;
  duel.sharedSeed = 0;
  duel.sharedFood = null;
  duel.foodVersion = 0;
  duel.scores = {};
  duel.pendingClaims = [];
  duel.lastClaimedVersion = 0;
  duel.pendingGrowthVersion = 0;
  duel.resultLocked = false;
  duel.resultText = "";
  duel.remoteState = null;
  duelLastBroadcastTs = 0;
  updateOpponentScore(0);
}

function sendDuelBroadcast(event, payload = {}) {
  if (!duel.channel || !duel.connected) return;
  void duel.channel.send({
    type: "broadcast",
    event,
    payload: {
      ...payload,
      playerId: duelPlayerId,
      room: duel.roomCode,
      sentAt: Date.now(),
    },
  });
}

function maybeBroadcastDuelSnapshot(force = false) {
  if (!isDuelRoundActive() || !duel.connected || !duel.channel) return;
  const now = performance.now();
  if (!force && now - duelLastBroadcastTs < DUEL_SYNC_INTERVAL_MS) return;
  duelLastBroadcastTs = now;
  sendDuelBroadcast("duel-state", {
    v: DUEL_SNAPSHOT_VERSION,
    score: state.score,
    alive: state.alive,
    dir: { x: state.dir.x, y: state.dir.y },
    snake: state.snake.map((segment) => ({ x: segment.x, y: segment.y })),
    foodVersion: duel.foodVersion,
    food: duel.sharedFood,
    scores: isDuelHost() ? duel.scores : undefined,
  });
}

function beginDuelRound({
  seed,
  startAt = Date.now(),
  food = null,
  foodVersion = 1,
  foodSeed = 0,
  scores = null,
}) {
  if (!duel.connected) return;
  clearTimeout(duelPendingStartTimer);
  duelPendingStartTimer = null;
  clearTimeout(duel.claimTimer);
  duel.claimTimer = null;
  duel.sharedSeed = (Number(foodSeed) || seed || Date.now()) >>> 0;
  duel.localStartAt = Number(startAt) || Date.now();
  duel.activeRound = true;
  duel.pendingClaims = [];
  duel.lastClaimedVersion = 0;
  duel.pendingGrowthVersion = 0;
  duel.resultLocked = false;
  duel.resultText = "";
  duel.remoteState = null;
  duel.foodVersion = Math.max(1, Math.floor(Number(foodVersion) || 1));

  const normalizedFood = sanitizeFoodCell(food);
  if (normalizedFood) {
    duel.sharedFood = normalizedFood;
  } else {
    const hostSpawn = createDuelSpawn(CELL_COUNT, true);
    const guestSpawn = createDuelSpawn(CELL_COUNT, false);
    const fallbackPick = pickDuelFoodCell(CELL_COUNT, [...hostSpawn.snake, ...guestSpawn.snake], duel.sharedSeed || seed || Date.now());
    duel.sharedFood = fallbackPick.food;
    duel.sharedSeed = fallbackPick.seed;
  }

  const opponentId = getDuelOpponentId();
  const nextScores = {};
  nextScores[duelPlayerId] = normalizeScore(scores?.[duelPlayerId] || 0);
  if (opponentId) nextScores[opponentId] = normalizeScore(scores?.[opponentId] || 0);
  duel.scores = nextScores;

  updateOpponentScore(0);
  pendingHighscore = null;
  pendingHighscoreName = "";
  hidePendingNameEntry();
  resetGame({ seed: duel.sharedSeed, duelMode: true, duelSharedFood: duel.sharedFood });
  const localScore = getDuelScoreFor(duelPlayerId);
  state = { ...state, score: localScore, food: duel.sharedFood };
  updateScore();
  updateOpponentScore(getDuelScoreFor(opponentId));
  maybeBroadcastDuelSnapshot(true);
  setDuelStatus(`Room ${duel.roomCode}: live`);
}

function scheduleDuelRoundStart(payload) {
  if (!duel.connected) return;
  const seed = Number(payload?.seed || Date.now()) >>> 0;
  const startAt = Math.max(Date.now() + 120, Number(payload?.startAt || Date.now() + DUEL_START_DELAY_MS));
  const food = sanitizeFoodCell(payload?.food);
  const foodVersion = Math.max(1, Math.floor(Number(payload?.foodVersion) || 1));
  const foodSeed = (Number(payload?.foodSeed) || seed) >>> 0;
  const scores = payload?.scores && typeof payload.scores === "object" ? payload.scores : null;
  duel.sharedSeed = foodSeed;
  if (food) duel.sharedFood = food;
  duel.foodVersion = foodVersion;
  if (scores) {
    duel.scores = Object.fromEntries(
      Object.entries(scores).map(([id, value]) => [String(id), normalizeScore(value)])
    );
  }
  duel.localStartAt = startAt;
  clearTimeout(duelPendingStartTimer);
  const delay = Math.max(0, startAt - Date.now());
  setDuelStatus(`Room ${duel.roomCode}: starting in ${(delay / 1000).toFixed(1)}s`);
  duelPendingStartTimer = setTimeout(() => {
    beginDuelRound({ seed, startAt, food, foodVersion, foodSeed, scores });
  }, delay);
}

function finishDuelRound(message, localResult) {
  if (!isDuelRoundActive() || duel.resultLocked) return;
  duel.resultLocked = true;
  duel.resultText = message;
  duel.activeRound = false;
  updateOpponentScore(duel.remoteState?.score || 0);
  gameStarted = false;
  paused = true;
  clearActiveChaser();
  hideChaserAlert();
  if (localResult) {
    sendDuelBroadcast("duel-result", {
      result: localResult,
      score: state.score,
      alive: state.alive,
    });
  }
  openMenu("duel-over");
}

async function leaveDuelChannel() {
  if (!duel.channel) return;
  try {
    await duel.channel.untrack();
  } catch {
    // Ignore cleanup errors.
  }
  try {
    await duel.channel.unsubscribe();
  } catch {
    // Ignore cleanup errors.
  }
  duel.channel = null;
}

function stopDuelSession(options = {}) {
  const { keepMode = false } = options;
  clearDuelRuntimeState();
  void leaveDuelChannel();
  duel.connected = false;
  duel.roomCode = "";
  duel.players = [];
  duel.hostId = "";
  localStorage.removeItem(DUEL_ROOM_CODE_KEY);
  if (!keepMode) selectedMode = "single";
  updateModeButtons();
}

async function joinDuelRoom(rawCode) {
  const code = normalizeDuelRoomCode(rawCode);
  if (code.length < 4) {
    setDuelStatus("Enter a room code with at least 4 letters/numbers.");
    return;
  }
  if (duelCreateButton) duelCreateButton.disabled = true;
  if (duelJoinButton) duelJoinButton.disabled = true;
  setDuelStatus(`Connecting to ${code}...`);
  clearDuelRuntimeState();
  await leaveDuelChannel();

  try {
    const client = await ensureSupabaseRealtimeClient();
    const channel = client.channel(duelChannelName(code), {
      config: {
        broadcast: { self: false },
        presence: { key: duelPlayerId },
      },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        updateDuelPresencePlayers(channel);
      })
      .on("broadcast", { event: "duel-hello" }, ({ payload }) => {
        if (!payload || payload.playerId === duelPlayerId) return;
        if (!duel.activeRound) {
          setDuelStatus(`Room ${duel.roomCode}: opponent joined.`);
          updateModeButtons();
        }
      })
      .on("broadcast", { event: "duel-start" }, ({ payload }) => {
        if (!isHostPayload(payload)) return;
        scheduleDuelRoundStart(payload);
      })
      .on("broadcast", { event: "duel-state" }, ({ payload }) => {
        handleDuelSnapshot(payload);
      })
      .on("broadcast", { event: "duel-food-claim" }, ({ payload }) => {
        handleRemoteDuelFoodClaim(payload);
      })
      .on("broadcast", { event: "duel-food-update" }, ({ payload }) => {
        if (!isHostPayload(payload)) return;
        applyDuelFoodUpdate(payload);
      })
      .on("broadcast", { event: "duel-result" }, ({ payload }) => {
        if (!payload || payload.playerId === duelPlayerId || !isDuelRoundActive()) return;
        if (!isOpponentPayload(payload)) return;
        const remoteResult = String(payload.result || "");
        if (remoteResult === "lose-crash") {
          finishDuelRound("Askaban-friendly win. Opponent crashed.", null);
          return;
        }
        if (remoteResult === "lose-touch") {
          finishDuelRound("You win. Opponent touched your snake.", null);
          return;
        }
        if (remoteResult === "win-target") {
          finishDuelRound(`You lost the race. Opponent reached ${DUEL_TARGET_SCORE} treats.`, null);
        }
      });

    const subscribeStatus = await new Promise((resolve) => {
      channel.subscribe((status) => resolve(status));
    });

    if (subscribeStatus !== "SUBSCRIBED") {
      throw new Error(`Realtime subscribe failed: ${subscribeStatus}`);
    }

    duel.channel = channel;
    duel.connected = true;
    duel.roomCode = code;
    localStorage.setItem(DUEL_ROOM_CODE_KEY, code);
    await channel.track({ joinedAt: Date.now(), name: getStoredName() });
    updateDuelPresencePlayers(channel);
    sendDuelBroadcast("duel-hello", { name: getStoredName() });
    setDuelStatus(`Room ${duel.roomCode}: waiting for opponent...`);
    updateModeButtons();
  } catch (error) {
    console.error("Unable to connect duel room.", error);
    stopDuelSession({ keepMode: true });
    setDuelStatus("Realtime unavailable. Check network and try again.");
  } finally {
    if (duelCreateButton) duelCreateButton.disabled = false;
    if (duelJoinButton) duelJoinButton.disabled = false;
  }
}

async function createDuelRoom() {
  const candidate = createRoomCode();
  if (duelRoomInput) duelRoomInput.value = candidate;
  await joinDuelRoom(candidate);
}

function startDuelRoundAsHost() {
  if (!duel.connected || !isDuelReadyToStart()) {
    setDuelStatus("Waiting for opponent...");
    return;
  }
  if (!isDuelHost()) {
    setDuelStatus("Waiting for host to start.");
    return;
  }
  const startSeed = Date.now() >>> 0;
  const hostSpawn = createDuelSpawn(CELL_COUNT, true);
  const guestSpawn = createDuelSpawn(CELL_COUNT, false);
  const initialPick = pickDuelFoodCell(CELL_COUNT, [...hostSpawn.snake, ...guestSpawn.snake], startSeed);
  const opponentId = getDuelOpponentId();
  const startScores = { [duelPlayerId]: 0 };
  if (opponentId) startScores[opponentId] = 0;

  const payload = {
    seed: startSeed,
    startAt: Date.now() + DUEL_START_DELAY_MS,
    food: initialPick.food,
    foodVersion: 1,
    foodSeed: initialPick.seed,
    scores: startScores,
  };
  sendDuelBroadcast("duel-start", payload);
  scheduleDuelRoundStart(payload);
}

function normalizeRemoteRow(row) {
  if (!row || !isScoreInAllowedRange(row.score)) return null;
  return {
    id: String(row.id),
    name: normalizeName(row.name),
    score: Math.floor(Number(row.score)),
    createdAt: Date.parse(row.created_at) || Date.now(),
  };
}

async function fetchTopHighscoresFromServer() {
  const params = new URLSearchParams();
  params.set("select", "id,name,score,created_at");
  params.set("order", "score.desc,created_at.asc");
  params.set("score", `lte.${MAX_SUBMIT_SCORE}`);
  params.set("limit", String(MAX_HIGHSCORES));
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?${params.toString()}`, {
    headers: supabaseHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch highscores (${response.status})`);
  }
  const rows = await response.json();
  return sortHighscores(rows.map(normalizeRemoteRow).filter((row) => row));
}

function createSupabaseHttpError(scope, response, payload) {
  const detail = payload && typeof payload === "object"
    ? String(payload.message || payload.details || payload.hint || "")
    : "";
  const err = new Error(detail ? `${scope} (${response.status}): ${detail}` : `${scope} (${response.status})`);
  err.status = response.status;
  if (payload && typeof payload === "object") {
    err.code = String(payload.code || "");
    err.details = String(payload.details || payload.hint || "");
  }
  return err;
}

async function callScoreGateway(action, payload) {
  const captchaToken = await requestTurnstileToken(action === "rename" ? "score_rename" : "score_create");
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${SUPABASE_SCORE_GATEWAY_FUNCTION}`, {
    method: "POST",
    headers: supabaseHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      action,
      captchaToken,
      ...payload,
    }),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw createSupabaseHttpError("Score gateway failed", response, data);
  }
  return data || null;
}

async function insertHighscoreOnServer(name, score, editToken) {
  const token = String(editToken || "").trim().toLowerCase();
  if (!isValidEditToken(token)) {
    throw new Error("Invalid edit token");
  }
  const raw = await callScoreGateway("create", {
    name: normalizeName(name),
    score: normalizeScore(score),
    editToken: token,
  });
  return raw ? normalizeRemoteRow(raw) : null;
}

async function updateHighscoreNameOnServer(id, name, editToken) {
  const token = String(editToken || "").trim().toLowerCase();
  if (!isValidEditToken(token)) {
    return null;
  }
  const raw = await callScoreGateway("rename", {
    id: String(id),
    name: normalizeName(name),
    editToken: token,
  });
  return raw ? normalizeRemoteRow(raw) : null;
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
  primeRageTrackIfNeeded();
  primeChaserTrackIfNeeded();
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
  // Rage start should be an immediate handoff with no overlapping tracks.
  if (bgFadeRaf) cancelAnimationFrame(bgFadeRaf);
  bgFadeRaf = null;
  bgMusic.volume = BG_DUCKED_VOLUME;
  bgMusic.pause();
}

function restoreBackgroundMusic() {
  if (!bgWasDucked) return;
  bgWasDucked = false;
  if (audioMuted) return;
  const resumeAndFade = () => fadeBgMusicTo(BG_MUSIC_VOLUME, BG_RESTORE_FADE_MS);
  if (bgMusic.paused) {
    bgMusic.volume = BG_DUCKED_VOLUME;
    bgMusic.play().then(resumeAndFade).catch(() => {});
    return;
  }
  resumeAndFade();
}

function setAudioMuted(nextMuted) {
  audioMuted = nextMuted;
  localStorage.setItem(AUDIO_MUTED_KEY, audioMuted ? "1" : "0");
  bgMusic.muted = audioMuted;
  rageMusic.muted = audioMuted;
  chaserMusic.muted = audioMuted;
  if (bgFadeRaf) cancelAnimationFrame(bgFadeRaf);
  bgFadeRaf = null;
  if (audioMuted) {
    bgMusic.pause();
    rageMusic.pause();
    chaserMusic.pause();
    rageMusicActive = false;
    chaserMusicActive = false;
    ragePlayPending = false;
    chaserPlayPending = false;
    bgPausedForChaser = false;
    if (rageFadeRaf) cancelAnimationFrame(rageFadeRaf);
    rageFadeRaf = null;
  } else if (audioUnlocked) {
    if (activeChaser && !isRageMode()) {
      startChaserMusic();
    } else if (bgMusic.paused && !isRageMode()) {
      bgMusic.volume = bgWasDucked ? BG_DUCKED_VOLUME : BG_MUSIC_VOLUME;
      bgMusic.play().catch(() => {});
    }
    primeRageTrackIfNeeded();
    primeChaserTrackIfNeeded();
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
  const [
    head,
    walk1,
    walk2,
    walk3,
    walk4,
    bodyFallback,
    tail,
    ragePee,
    rageDog,
    chaserAskaban,
    ...treats
  ] = await Promise.all([
    loadImage("./assets/snake-head.png"),
    loadImage("./assets/snake-body-walk-1.png"),
    loadImage("./assets/snake-body-walk-2.png"),
    loadImage("./assets/snake-body-walk-3.png"),
    loadImage("./assets/snake-body-walk-4.png"),
    loadImage("./assets/snake-body.png"),
    loadImage("./assets/snake-tail.png"),
    loadImage("./assets/rage-pee.png"),
    loadImage("./assets/rage-dog.png"),
    loadImage("./assets/chaser-askaban.png"),
    loadImage("./assets/treat-1.png"),
    loadImage("./assets/treat-2.png"),
    loadImage("./assets/treat-3.png"),
    loadImage("./assets/treat-4.png"),
    loadImage("./assets/treat-5.png"),
  ]);
  const preparedWalkFrames = [walk1, walk2, walk3, walk4]
    .filter((frame) => isRenderableImage(frame))
    .map((frame) => prepareBodyFrame(frame));
  const walkFrames = normalizeBodyFrames(preparedWalkFrames);
  const fallbackFrame = createTrimmedBodyTexture(prepareBodyFrame(bodyFallback));
  const bodyFrames = walkFrames.length > 0 ? walkFrames : [fallbackFrame];
  images = {
    head,
    bodyFrames,
    bodyPlain: fallbackFrame,
    tail: createTrimmedBodyTexture(prepareBodyFrame(tail)),
    ragePee: createTrimmedBodyTexture(prepareBodyFrame(ragePee)),
    rageDog: createTrimmedBodyTexture(prepareBodyFrame(rageDog)),
    chaserAskaban: createTrimmedBodyTexture(prepareBodyFrame(chaserAskaban)),
    treats,
  };
}

function isRenderableImage(source) {
  if (!source) return false;
  const width = source.naturalWidth || source.width || 0;
  const height = source.naturalHeight || source.height || 0;
  return width > 0 && height > 0;
}

function prepareBodyFrame(source) {
  if (!isRenderableImage(source)) return source;
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx2d = canvas.getContext("2d");
  if (!ctx2d) return source;
  ctx2d.drawImage(source, 0, 0, width, height);

  const imageData = ctx2d.getImageData(0, 0, width, height);
  const data = imageData.data;
  let hasTransparency = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) {
      hasTransparency = true;
      break;
    }
  }

  if (!hasTransparency) {
    clearEdgeConnectedBackground(imageData, width, height);
    ctx2d.putImageData(imageData, 0, 0);
  }

  return canvas;
}

function clearEdgeConnectedBackground(imageData, width, height) {
  const data = imageData.data;
  const pixelOffset = (x, y) => (y * width + x) * 4;
  const cornerColors = [
    [
      data[pixelOffset(0, 0)],
      data[pixelOffset(0, 0) + 1],
      data[pixelOffset(0, 0) + 2],
    ],
    [
      data[pixelOffset(width - 1, 0)],
      data[pixelOffset(width - 1, 0) + 1],
      data[pixelOffset(width - 1, 0) + 2],
    ],
    [
      data[pixelOffset(0, height - 1)],
      data[pixelOffset(0, height - 1) + 1],
      data[pixelOffset(0, height - 1) + 2],
    ],
    [
      data[pixelOffset(width - 1, height - 1)],
      data[pixelOffset(width - 1, height - 1) + 1],
      data[pixelOffset(width - 1, height - 1) + 2],
    ],
  ];
  const thresholdSq = 34 * 34;

  const matchesBackground = (offset) => {
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    return cornerColors.some(([cr, cg, cb]) => {
      const dr = r - cr;
      const dg = g - cg;
      const db = b - cb;
      return dr * dr + dg * dg + db * db <= thresholdSq;
    });
  };

  const visited = new Uint8Array(width * height);
  const queue = [];

  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const flat = y * width + x;
    if (visited[flat]) return;
    visited[flat] = 1;
    const offset = flat * 4;
    if (!matchesBackground(offset)) return;
    data[offset + 3] = 0;
    queue.push([x, y]);
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (queue.length > 0) {
    const [x, y] = queue.pop();
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }
}

function getOpaqueBounds(source) {
  if (!isRenderableImage(source)) return null;
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;

  const scanCanvas = document.createElement("canvas");
  scanCanvas.width = width;
  scanCanvas.height = height;
  const scanCtx = scanCanvas.getContext("2d");
  if (!scanCtx) return null;
  scanCtx.drawImage(source, 0, 0, width, height);

  const { data } = scanCtx.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha < 12) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { minX, minY, maxX, maxY };
}

function createTrimmedBodyTexture(source, bounds = null) {
  if (!isRenderableImage(source)) return source;
  const finalBounds = bounds || getOpaqueBounds(source);
  if (!finalBounds) return source;
  const outWidth = finalBounds.maxX - finalBounds.minX + 1;
  const outHeight = finalBounds.maxY - finalBounds.minY + 1;
  const trimmed = document.createElement("canvas");
  trimmed.width = outWidth;
  trimmed.height = outHeight;
  const trimmedCtx = trimmed.getContext("2d");
  if (!trimmedCtx) return source;
  trimmedCtx.drawImage(
    source,
    finalBounds.minX,
    finalBounds.minY,
    outWidth,
    outHeight,
    0,
    0,
    outWidth,
    outHeight
  );
  return trimmed;
}

function normalizeBodyFrames(frames) {
  if (frames.length === 0) return [];
  const frameBounds = frames.map((frame) => getOpaqueBounds(frame)).filter((bounds) => bounds);
  if (frameBounds.length === 0) return frames;
  const sharedBounds = frameBounds.reduce(
    (acc, bounds) => ({
      minX: Math.min(acc.minX, bounds.minX),
      minY: Math.min(acc.minY, bounds.minY),
      maxX: Math.max(acc.maxX, bounds.maxX),
      maxY: Math.max(acc.maxY, bounds.maxY),
    }),
    { ...frameBounds[0] }
  );
  return frames.map((frame) => createTrimmedBodyTexture(frame, sharedBounds));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createRageRunner(targetCell, gridSize) {
  const fromLeft = (Date.now() & 1) === 0;
  const offsetY = ((Date.now() >>> 2) % 5) - 2;
  const startY = clamp(targetCell.y + offsetY, 1, gridSize - 2);
  const startX = fromLeft ? -1.4 : gridSize + 1.4;
  const endX = targetCell.x + (fromLeft ? -0.55 : 0.55);
  const endY = targetCell.y + 0.08;
  return {
    fromLeft,
    startX,
    startY,
    endX,
    endY,
    startTs: performance.now(),
    durationMs: 1850,
  };
}

function startRageTreatSequence() {
  rageTreatActive = true;
  rageTreatReady = false;
  rageRunner = createRageRunner(state.food, state.gridSize);
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

  const drawRemoteSnake = () => {
    if (!isDuelRoundActive()) return;
    const remoteSnake = getFreshRemoteSnake();
    if (!remoteSnake) {
      if (duel.remoteState) {
        duel.remoteState = null;
        updateOpponentScore(0);
      }
      return;
    }
    if (!Array.isArray(remoteSnake) || remoteSnake.length === 0) return;
    const base = "#325da0";
    const glow = "#e9f5ff";
    ctx.save();
    ctx.globalAlpha = 0.82;
    for (let i = remoteSnake.length - 1; i >= 0; i -= 1) {
      const seg = remoteSnake[i];
      const cx = seg.x * size + size / 2;
      const cy = seg.y * size + size / 2;
      const w = size * (i === 0 ? 1.08 : 0.94);
      const h = size * (i === 0 ? 1.08 : 0.84);
      const r = Math.min(w, h) * 0.35;
      ctx.beginPath();
      ctx.moveTo(cx - w / 2 + r, cy - h / 2);
      ctx.lineTo(cx + w / 2 - r, cy - h / 2);
      ctx.quadraticCurveTo(cx + w / 2, cy - h / 2, cx + w / 2, cy - h / 2 + r);
      ctx.lineTo(cx + w / 2, cy + h / 2 - r);
      ctx.quadraticCurveTo(cx + w / 2, cy + h / 2, cx + w / 2 - r, cy + h / 2);
      ctx.lineTo(cx - w / 2 + r, cy + h / 2);
      ctx.quadraticCurveTo(cx - w / 2, cy + h / 2, cx - w / 2, cy + h / 2 - r);
      ctx.lineTo(cx - w / 2, cy - h / 2 + r);
      ctx.quadraticCurveTo(cx - w / 2, cy - h / 2, cx - w / 2 + r, cy - h / 2);
      ctx.closePath();
      ctx.fillStyle = i === 0 ? "#3c3329" : base;
      ctx.fill();
      if (i === 0) {
        ctx.strokeStyle = glow;
        ctx.lineWidth = Math.max(1.5, size * 0.07);
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  const drawPeeTreatAt = (cell, boosted = false) => {
    const cx = cell.x * size + size / 2;
    const cy = cell.y * size + size / 2;
    const r = size * (boosted ? 0.56 : 0.5);
    const peeImg = images.ragePee;
    if (isRenderableImage(peeImg)) {
      const assetSize = size * (boosted ? 1.38 : 1.24);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((cell.x * 13 + cell.y * 7) * 0.05);
      ctx.drawImage(peeImg, -assetSize / 2, -assetSize / 2, assetSize, assetSize);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((cell.x * 13 + cell.y * 7) * 0.07);
    const gradient = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.08, 0, 0, r);
    gradient.addColorStop(0, boosted ? "#fff8a6" : "#ffe682");
    gradient.addColorStop(0.55, boosted ? "#ffd947" : "#f4ca3e");
    gradient.addColorStop(1, boosted ? "#d49f11" : "#bb840a");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.08, r * 0.7, 0, 0, Math.PI * 2);
    ctx.ellipse(r * 0.35, -r * 0.08, r * 0.45, r * 0.32, 0, 0, Math.PI * 2);
    ctx.ellipse(-r * 0.3, r * 0.12, r * 0.36, r * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(120, 82, 10, 0.45)";
    ctx.stroke();
    ctx.restore();
  };

  const foodKey = `${state.food.x},${state.food.y}`;
  if (foodKey !== lastFoodKey) {
    lastFoodKey = foodKey;
    if (images.treats.length > 0) {
      currentTreatIndex = state.rngSeed % images.treats.length;
    }
  }

  const treatImage = images.treats[currentTreatIndex];
  const rageStyleTreat = isRageMode() || (rageTreatActive && rageTreatReady);
  if (rageStyleTreat) {
    drawPeeTreatAt(state.food, true);
  } else if (rageTreatActive && !rageTreatReady) {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 240, 165, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(state.food.x * size + size / 2, state.food.y * size + size / 2, size * 0.38, 0, Math.PI * 2);
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

  if (rageTreatActive && !rageTreatReady && rageRunner) {
    const elapsed = performance.now() - rageRunner.startTs;
    const t = Math.min(1, elapsed / rageRunner.durationMs);
    const x = rageRunner.startX + (rageRunner.endX - rageRunner.startX) * t;
    const y = rageRunner.startY + (rageRunner.endY - rageRunner.startY) * t;
    const runnerSize = size * 1.34;

    const rageDogImg = images.rageDog && (images.rageDog instanceof HTMLCanvasElement || images.rageDog.complete === true)
      ? images.rageDog
      : images.head;
    if (isRenderableImage(rageDogImg)) {
      ctx.save();
      ctx.translate(x * size + size / 2, y * size + size / 2);
      if (!rageRunner.fromLeft) ctx.scale(-1, 1);
      ctx.drawImage(rageDogImg, -runnerSize / 2, -runnerSize / 2, runnerSize, runnerSize);
      ctx.restore();
    } else {
      drawFallbackCell({ x: Math.floor(x), y: Math.floor(y) }, "#f5d07f");
    }

    if (t > 0.8) {
      const peeT = (t - 0.8) / 0.2;
      const sx = x * size + size / 2;
      const sy = y * size + size * 0.2;
      const tx = state.food.x * size + size / 2;
      const ty = state.food.y * size + size / 2;
      ctx.save();
      ctx.strokeStyle = `rgba(248, 214, 72, ${0.55 * peeT})`;
      ctx.lineWidth = Math.max(2, size * 0.1);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.restore();
    }

    if (t >= 1) {
      rageTreatReady = true;
      rageRunner = null;
    }
  }

  const headSize = size * 1.32;
  const bodyLength = size * 1.36;
  const bodyThickness = size * 1.02;
  const tailLength = size * 1.16;
  const tailThickness = size * 0.84;
  const activeBodyTexture =
    images.bodyFrames.length > 0 ? images.bodyFrames[bodyFrameIndex % images.bodyFrames.length] : null;
  const plainBodyTexture =
    images.bodyPlain && (images.bodyPlain instanceof HTMLCanvasElement || images.bodyPlain.complete === true)
      ? images.bodyPlain
      : activeBodyTexture;
  const bodyTextureReady =
    activeBodyTexture &&
    (activeBodyTexture instanceof HTMLCanvasElement || activeBodyTexture.complete === true);
  const tailTextureReady =
    images.tail && (images.tail instanceof HTMLCanvasElement || images.tail.complete === true);

  const getWrappedUnitDelta = (from, to) => {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    if (!state.wallsEnabled) {
      const half = state.gridSize / 2;
      if (dx > half) dx -= state.gridSize;
      if (dx < -half) dx += state.gridSize;
      if (dy > half) dy -= state.gridSize;
      if (dy < -half) dy += state.gridSize;
    }
    if (dx !== 0) dx = dx > 0 ? 1 : -1;
    if (dy !== 0) dy = dy > 0 ? 1 : -1;
    return { dx, dy };
  };

  const getSegmentDirection = (index) => {
    const current = state.snake[index];
    const prev = state.snake[index - 1];
    let { dx, dy } = getWrappedUnitDelta(current, prev);

    if (dx === 0 && dy === 0 && index + 1 < state.snake.length) {
      ({ dx, dy } = getWrappedUnitDelta(current, state.snake[index + 1]));
      dx *= -1;
      dy *= -1;
    }

    return { dx, dy };
  };

  const applyDirectionalTransform = ({ dx, dy }) => {
    let rotation = 0;
    let scaleX = 1;
    if (Math.abs(dy) > Math.abs(dx)) {
      rotation = dy >= 0 ? Math.PI / 2 : -Math.PI / 2;
    } else if (dx < 0) {
      // Mirror for leftward movement to keep sprites upright instead of upside down.
      scaleX = -1;
    }
    ctx.rotate(rotation);
    if (scaleX < 0) ctx.scale(scaleX, 1);
  };

  const drawFallbackBodySegment = () => {
    const halfLen = bodyLength / 2;
    const halfThick = bodyThickness / 2;
    const r = halfThick;
    ctx.beginPath();
    ctx.moveTo(-halfLen + r, -halfThick);
    ctx.lineTo(halfLen - r, -halfThick);
    ctx.arc(halfLen - r, 0, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(-halfLen + r, halfThick);
    ctx.arc(-halfLen + r, 0, r, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = "#d9ab63";
    ctx.fill();
  };

  const drawBodySegmentAt = (cell, direction, texture) => {
    const cx = cell.x * size + size / 2;
    const cy = cell.y * size + size / 2;
    ctx.save();
    ctx.translate(cx, cy);
    applyDirectionalTransform(direction);
    if (texture) {
      ctx.drawImage(texture, -bodyLength / 2, -bodyThickness / 2, bodyLength, bodyThickness);
    } else {
      drawFallbackBodySegment();
    }
    ctx.restore();
  };

  const drawTailAt = (cell, direction) => {
    const cx = cell.x * size + size / 2;
    const cy = cell.y * size + size / 2;
    ctx.save();
    ctx.translate(cx, cy);
    applyDirectionalTransform(direction);
    if (tailTextureReady) {
      ctx.drawImage(images.tail, -tailLength / 2, -tailThickness / 2, tailLength, tailThickness);
    } else {
      drawFallbackBodySegment();
    }
    ctx.restore();
  };

  const segmentBodyTexture = bodyTextureReady ? activeBodyTexture : plainBodyTexture;
  for (let i = state.snake.length - 1; i >= 1; i -= 1) {
    if (i === state.snake.length - 1) {
      drawTailAt(state.snake[i], getSegmentDirection(i));
      continue;
    }
    drawBodySegmentAt(state.snake[i], getSegmentDirection(i), segmentBodyTexture);
  }

  const headImg = images.head;
  if (headImg && headImg.complete) {
    const head = state.snake[0];
    const centerX = head.x * size + size / 2;
    const centerY = head.y * size + size / 2;
    ctx.save();
    ctx.translate(centerX, centerY);
    applyDirectionalTransform(state.dir);
    ctx.drawImage(headImg, -headSize / 2, -headSize / 2, headSize, headSize);
    ctx.restore();
  }

  drawRemoteSnake();

  if (activeChaser) {
    const chaserSize = size * 1.44;
    const dir = activeChaser.dir && (activeChaser.dir.dx !== 0 || activeChaser.dir.dy !== 0)
      ? activeChaser.dir
      : { dx: -1, dy: 0 };
    const askabanImg = isRenderableImage(images.chaserAskaban) ? images.chaserAskaban : null;
    let chaserImg = null;
    if (askabanImg) {
      chaserImg = askabanImg;
    } else if (isRenderableImage(images.rageDog)) {
      chaserImg = images.rageDog;
    } else if (isRenderableImage(images.head)) {
      chaserImg = images.head;
    }

    const centerX = activeChaser.pos.x * size + size / 2;
    const centerY = activeChaser.pos.y * size + size / 2;
    ctx.save();
    ctx.translate(centerX, centerY);
    applyDirectionalTransform(dir);
    if (chaserImg) {
      ctx.filter = "brightness(0.32) contrast(1.35) saturate(0.55)";
      ctx.drawImage(chaserImg, -chaserSize / 2, -chaserSize / 2, chaserSize, chaserSize);
      ctx.filter = "none";
    } else {
      ctx.fillStyle = "#1d1d1f";
      ctx.beginPath();
      ctx.arc(0, 0, chaserSize * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#e8e6e0";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }
}

function updateScore() {
  scoreEl.textContent = String(state.score);
}

function advanceBodyWalkFrame() {
  if (images.bodyFrames.length <= 1) return;
  bodyFrameIndex = (bodyFrameIndex + 1) % images.bodyFrames.length;
}

function tick() {
  if (isDuelRoundActive()) {
    if (paused || !state.alive || !gameStarted) {
      drawGrid();
      return;
    }
    if (duel.sharedFood) {
      state = { ...state, food: duel.sharedFood };
    }
    const wasAlive = state.alive;
    state = stepGame(state);
    advanceBodyWalkFrame();
    const localScore = getDuelScoreFor(duelPlayerId);
    const sharedFood = duel.sharedFood || state.food;
    const ateSharedFood =
      !!sharedFood &&
      !!state.snake[0] &&
      state.snake[0].x === sharedFood.x &&
      state.snake[0].y === sharedFood.y;
    state = {
      ...state,
      score: localScore,
      food: sharedFood,
    };
    updateScore();

    if (isLocalHeadTouchingRemoteSnake()) {
      maybeBroadcastDuelSnapshot(true);
      finishDuelRound("You touched the opponent snake. You lose this round.", "lose-touch");
      drawGrid();
      return;
    }
    if (wasAlive && !state.alive) {
      maybeBroadcastDuelSnapshot(true);
      finishDuelRound("You crashed. Opponent wins this round.", "lose-crash");
      drawGrid();
      return;
    }
    if (ateSharedFood) {
      handleLocalDuelFoodClaim();
    }
    maybeBroadcastDuelSnapshot();
    drawGrid();
    return;
  }

  updateRageState();
  if (paused || !state.alive || !gameStarted) {
    drawGrid();
    return;
  }
  const wasAlive = state.alive;
  const prevScore = state.score;
  const ateRageTreat = rageTreatActive && rageTreatReady;
  if (rageTreatActive && !rageTreatReady) {
    const visibleFood = state.food;
    const visibleSeed = state.rngSeed;
    const stepped = stepGame({ ...state, food: HIDDEN_FOOD });
    state = { ...stepped, food: visibleFood, rngSeed: visibleSeed };
  } else {
    state = stepGame(state);
  }
  advanceBodyWalkFrame();
  const gained = state.score - prevScore;
  if (gained > 0 && ateRageTreat && gained < 2) {
    state = { ...state, score: state.score + (2 - gained) };
  } else if (gained > 0 && isRageMode() && gained < 2) {
    state = { ...state, score: state.score + (2 - gained) };
  }
  updateScore();
  if (state.score !== prevScore) {
    if (!ateRageTreat && !activeChaser) {
      treatsSinceChaser += 1;
      if (chaserRecoveryTreatsRemaining > 0) {
        chaserRecoveryTreatsRemaining = Math.max(0, chaserRecoveryTreatsRemaining - 1);
      }
    }
    if (ateRageTreat) {
      activateLuluRage();
    } else if (!isRageMode()) {
      treatsSinceRage += 1;
    }
    assignFoodStyle();
    maybeSpawnChaser();
  }
  updateChaserState();
  if (wasAlive && !state.alive) {
    clearActiveChaser();
    hideChaserAlert();
    handleGameOver(state.score);
    openMenu("gameover");
  }
  drawGrid();
}

function getTickMs() {
  const base = BASE_START_TICK_MS;
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
  const rawSize = Math.floor(Math.min(byShellHeight, byViewportHeight, byWidth));
  // Snap the canvas to a grid multiple so each cell stays pixel-consistent while moving.
  const nextSize = Math.floor(rawSize / state.gridSize) * state.gridSize;

  if (nextSize >= 120 && (canvas.width !== nextSize || canvas.height !== nextSize)) {
    canvas.width = nextSize;
    canvas.height = nextSize;
    canvas.style.width = `${nextSize}px`;
    canvas.style.height = `${nextSize}px`;
    drawGrid();
  }
}

function resetGame(options = {}) {
  const {
    seed = Date.now(),
    duelMode = false,
    duelSharedFood = null,
  } = options;
  unlockAudioIfNeeded();
  state = createGameState({
    gridSize: CELL_COUNT,
    seed,
    wallsEnabled: false,
  });
  if (duelMode) {
    const spawn = createDuelSpawn(CELL_COUNT, isDuelHost());
    const hostSpawn = createDuelSpawn(CELL_COUNT, true);
    const guestSpawn = createDuelSpawn(CELL_COUNT, false);
    const foodPick = pickDuelFoodCell(CELL_COUNT, [...hostSpawn.snake, ...guestSpawn.snake], state.rngSeed);
    const nextFood = sanitizeFoodCell(duelSharedFood) || sanitizeFoodCell(duel.sharedFood) || foodPick.food;
    const nextSeed = Number.isFinite(duel.sharedSeed) && duel.sharedSeed > 0 ? duel.sharedSeed : foodPick.seed;
    duel.sharedFood = nextFood;
    duel.sharedSeed = nextSeed;
    state = {
      ...state,
      snake: spawn.snake,
      dir: { ...spawn.dir },
      nextDir: { ...spawn.dir },
      food: nextFood,
      rngSeed: nextSeed,
      score: getDuelScoreFor(duelPlayerId),
    };
  }
  state = { ...state, pointsPerFood: duelMode ? 0 : 1 };
  treatsSinceRage = 0;
  treatsSinceChaser = 0;
  chaserRecoveryTreatsRemaining = 0;
  rageTreatActive = false;
  rageTreatReady = false;
  rageRunner = null;
  clearActiveChaser();
  hideChaserAlert();
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
  rageIndicator.hidden = true;
  document.body.classList.remove("rage-mode");
  lastFoodKey = null;
  bodyFrameIndex = 0;
  paused = false;
  gameStarted = true;
  pauseButton.textContent = "Pause";
  updateScore();
  if (!duelMode) {
    assignFoodStyle();
  }
  overlay.hidden = true;
  if (!duelMode) {
    updateOpponentScore(0);
  }
  drawGrid();
}

function updateMenuLabels() {
  top5Title.textContent = "Top 5 Global";
  renderHighscores();
  updateModeButtons();
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

function showPendingNameEntry() {
  if (!nameEntry || !nameEntryInput) return;
  nameEntry.hidden = false;
  const label = nameEntry.querySelector("label");
  if (label) label.hidden = true;
  nameEntryInput.hidden = true;
}

function hidePendingNameEntry() {
  if (!nameEntry) return;
  const label = nameEntry.querySelector("label");
  if (label) label.hidden = true;
  if (nameEntryInput) nameEntryInput.hidden = false;
  nameEntry.hidden = true;
}

function submitPendingHighscoreName() {
  const inlineInput = menuHighscoreList?.querySelector(".score-name-input");
  const typed = normalizeName(
    inlineInput?.value
    || nameEntryInput?.value
    || pendingHighscoreName
    || getStoredName()
  );
  pendingHighscoreName = typed;
  saveLastName(typed);
  if (inlineInput) inlineInput.value = typed;

  if (!pendingHighscore?.id) {
    hidePendingNameEntry();
    return;
  }

  const pendingId = pendingHighscore.id;
  const hasPendingRow = highscores.some((entry) => entry.id === pendingId);
  if (hasPendingRow) {
    updateHighscoreName(pendingId, typed);
  }
}

function updateHighscoreName(id, rawName, options = {}) {
  const { syncRemote = true } = options;
  const idx = highscores.findIndex((entry) => entry.id === id);
  if (idx < 0) return;
  const normalized = normalizeName(rawName);
  highscores[idx] = { ...highscores[idx], name: normalized };
  applyHighscores(highscores);
  saveLastName(normalized);
  if (syncRemote && !id.startsWith("local-")) {
    const token = readHighscoreEditToken(id);
    updateHighscoreNameOnServer(id, normalized, token).then((updated) => {
      if (!updated) return;
      const currentIdx = highscores.findIndex((entry) => entry.id === id);
      if (currentIdx < 0) return;
      highscores[currentIdx] = { ...highscores[currentIdx], name: updated.name };
      applyHighscores(highscores);
      renderHighscores();
    }).catch((error) => {
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
      input.maxLength = MAX_PLAYER_NAME_LENGTH;
      input.value = pendingHighscoreName || entry.name || "Player 1";
      input.addEventListener("input", () => {
        pendingHighscoreName = input.value;
        updateHighscoreName(entry.id, input.value, { syncRemote: false });
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submitPendingHighscoreName();
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
  const normalizedScore = normalizeScore(score);
  if (normalizedScore <= 0) return null;
  const name = saveLastName(rawName);
  pendingHighscoreName = name;
  const entry = {
    id: `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    score: normalizedScore,
    createdAt: Date.now(),
  };
  const editToken = createEditToken();
  storeHighscoreEditToken(entry.id, editToken);
  const nextScores = sortHighscores([...highscores, entry]);
  const idx = nextScores.findIndex((item) => item.id === entry.id);
  if (idx < 0) return null;
  applyHighscores(nextScores);

  void (async () => {
    try {
      const currentEntry = highscores.find((item) => item.id === entry.id) || entry;
      const remoteEntry = await insertHighscoreOnServer(currentEntry.name, currentEntry.score, editToken);
      if (!remoteEntry) return;
      moveHighscoreEditToken(entry.id, remoteEntry.id);
      const latestLocalEntry = highscores.find((item) => item.id === entry.id) || currentEntry;
      const localName = normalizeName(pendingHighscoreName || latestLocalEntry.name);
      const merged = highscores.filter((item) => item.id !== entry.id);
      merged.push({ ...remoteEntry, name: localName });
      applyHighscores(merged);
      if (pendingHighscore?.id === entry.id) {
        pendingHighscore = { id: remoteEntry.id };
      }
      renderHighscores();
      if (localName !== remoteEntry.name) {
        const token = readHighscoreEditToken(remoteEntry.id);
        await updateHighscoreNameOnServer(remoteEntry.id, localName, token);
      }
      await refreshHighscoresFromServer();
    } catch (error) {
      console.warn("Unable to sync highscore with Supabase.", error);
    }
  })();

  return { id: entry.id };
}

function handleGameOver(score) {
  if (isDuelSelected()) {
    pendingHighscore = null;
    pendingHighscoreName = "";
    hidePendingNameEntry();
    renderHighscores();
    return;
  }
  if (isTopFiveScore(score)) {
    pendingHighscore = recordHighscore(score, getStoredName());
    showPendingNameEntry();
  } else {
    pendingHighscore = null;
    pendingHighscoreName = "";
    hidePendingNameEntry();
  }
  renderHighscores();
}

function initHighscores() {
  purgeExpiredStoredEditTokens();
  highscores = readHighscoreCache();
  renderHighscores();
  void refreshHighscoresFromServer();
}

function openMenu(mode) {
  gameStarted = false;
  paused = true;
  clearTimeout(duelPendingStartTimer);
  duelPendingStartTimer = null;
  clearActiveChaser();
  hideChaserAlert();
  pauseButton.textContent = "Pause";
  overlay.hidden = false;

  if (selectedMode === "duel" || mode === "duel-over") {
    hidePendingNameEntry();
    pendingHighscore = null;
    pendingHighscoreName = "";
    menuTitle.textContent = "Lulu-Snake 1v1";
    if (mode === "duel-over") {
      menuText.textContent = duel.resultText || "Round finished.";
    } else if (duel.connected) {
      menuText.textContent = isDuelReadyToStart()
        ? `Room ready. Press Start 1v1. Shared treat race to ${DUEL_TARGET_SCORE}, no touching.`
        : `Create or join a room, then wait for your opponent. Shared treat race to ${DUEL_TARGET_SCORE}, no touching.`;
    } else {
      menuText.textContent = `Create or join a room to play realtime 1v1. Shared treat race to ${DUEL_TARGET_SCORE}, no touching.`;
    }
    updateModeButtons();
    return;
  }

  renderHighscores();
  if (!(mode === "gameover" && pendingHighscore)) {
    void refreshHighscoresFromServer();
  }
  if (mode === "gameover") {
    menuTitle.textContent = "Game Over";
    if (!pendingHighscore) {
      menuText.textContent = `Score: ${state.score}. Press Play Again.`;
      startGameButton.textContent = "Play Again";
      pendingHighscoreName = "";
      hidePendingNameEntry();
    } else {
      menuText.textContent = `Score: ${state.score}.`;
      startGameButton.textContent = "Save Score & Play Again";
      showPendingNameEntry();
      const inlineInput = menuHighscoreList.querySelector(".score-name-input");
      if (inlineInput) {
        inlineInput.focus();
        inlineInput.select();
      }
    }
  } else {
    pendingHighscore = null;
    pendingHighscoreName = "";
    hidePendingNameEntry();
    menuTitle.textContent = "Lulu-Snake";
    menuText.textContent = "Press Start to begin.";
    startGameButton.textContent = "Start Game";
  }
  updateModeButtons();
}

function handleDirection(direction) {
  state = setDirection(state, direction);
  if (isDuelRoundActive()) maybeBroadcastDuelSnapshot(true);
}

function isSwipeInputTarget(target) {
  return target instanceof Element && target.closest("button, input, textarea, select, a, label");
}

function handleSwipeDirection(dx, dy) {
  if (!gameStarted || !state.alive) return false;
  const threshold = window.innerWidth <= 640 ? SWIPE_THRESHOLD_MOBILE_PX : SWIPE_THRESHOLD_PX;
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return false;
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
    if (isDuelRoundActive()) {
      finishDuelRound("Round stopped. Opponent wins.", "lose-crash");
      return;
    }
    openMenu("start");
  }
}

pauseButton.addEventListener("click", () => {
  if (!gameStarted || !state.alive) return;
  paused = !paused;
  pauseButton.textContent = paused ? "Resume" : "Pause";
});

restartButton.addEventListener("click", () => {
  if (isDuelRoundActive()) {
    finishDuelRound("Round stopped. Opponent wins.", "lose-crash");
    return;
  }
  openMenu("start");
});

startGameButton.addEventListener("click", () => {
  if (isDuelSelected()) {
    startDuelRoundAsHost();
    return;
  }
  if (pendingHighscore?.id) {
    submitPendingHighscoreName();
  }
  resetGame();
});

saveScoreButton.addEventListener("click", () => {
  submitPendingHighscoreName();
});

nameEntryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitPendingHighscoreName();
  }
});

if (modeSingleButton) {
  modeSingleButton.addEventListener("click", () => {
    applySelectedMode("single");
    openMenu("start");
  });
}

if (modeDuelButton) {
  modeDuelButton.addEventListener("click", () => {
    applySelectedMode("duel");
    openMenu("start");
  });
}

if (duelRoomInput) {
  const storedCode = normalizeDuelRoomCode(localStorage.getItem(DUEL_ROOM_CODE_KEY) || "");
  if (storedCode) duelRoomInput.value = storedCode;
  duelRoomInput.addEventListener("input", () => {
    duelRoomInput.value = normalizeDuelRoomCode(duelRoomInput.value);
  });
  duelRoomInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void joinDuelRoom(duelRoomInput.value);
    }
  });
}

if (duelCreateButton) {
  duelCreateButton.addEventListener("click", () => {
    void createDuelRoom();
  });
}

if (duelJoinButton) {
  duelJoinButton.addEventListener("click", () => {
    const code = duelRoomInput ? duelRoomInput.value : "";
    void joinDuelRoom(code);
  });
}

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
updateMenuLabels();
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
window.addEventListener("beforeunload", () => {
  void leaveDuelChannel();
});

function assignFoodStyle() {
  if (images.treats.length > 0) {
    currentTreatIndex = state.rngSeed % images.treats.length;
  }
  if (isRageMode()) {
    rageTreatActive = false;
    rageTreatReady = false;
    rageRunner = null;
    return;
  }
  const forceRage = treatsSinceRage >= FORCE_RAGE_AFTER_TREATS;
  if (forceRage || state.rngSeed % 100 < RAGE_CHANCE_PCT) {
    startRageTreatSequence();
  } else {
    rageTreatActive = false;
    rageTreatReady = false;
    rageRunner = null;
  }
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
  clearActiveChaser();
  hideChaserAlert();
  rageRemainingMs = RAGE_DURATION_MS + RAGE_POPUP_MS;
  rageLastUpdateTs = Date.now();
  state = { ...state, pointsPerFood: 2 };
  document.body.classList.add("rage-mode");
  duckBackgroundMusic();
  rageMusic.pause();
  rageMusic.currentTime = 0;
  rageMusic.volume = RAGE_MUSIC_VOLUME;
  rageMusicActive = true;
  ragePlayPending = true;
  if (!audioMuted) playRageTrack();
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

function retryPendingMusicPlayback() {
  if (audioMuted) return;
  if (ragePlayPending && isRageMode()) {
    primeRageTrackIfNeeded();
    playRageTrack();
    return;
  }
  if (chaserPlayPending && activeChaser && !isRageMode()) {
    primeChaserTrackIfNeeded();
    playChaserTrack();
  }
}

document.addEventListener("pointerdown", unlockAudioIfNeeded, { once: true });
document.addEventListener("keydown", unlockAudioIfNeeded, { once: true });
document.addEventListener("touchstart", unlockAudioIfNeeded, { once: true, passive: true });
document.addEventListener("click", unlockAudioIfNeeded, { once: true });

document.addEventListener("pointerdown", retryPendingMusicPlayback);
document.addEventListener("keydown", retryPendingMusicPlayback);
document.addEventListener("touchstart", retryPendingMusicPlayback, { passive: true });
document.addEventListener("click", retryPendingMusicPlayback);

audioToggle.addEventListener("click", () => {
  unlockAudioIfNeeded();
  setAudioMuted(!audioMuted);
});
