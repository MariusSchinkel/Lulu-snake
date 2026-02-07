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
const SWIPE_THRESHOLD_MOBILE_PX = 18;
const BASE_START_TICK_MS = 230;

let state = createGameState({ gridSize: CELL_COUNT, seed: 123456789 });
let paused = false;
let timerId = null;
let images = { head: null, bodyFrames: [], bodyPlain: null, tail: null, treats: [], ragePee: null, rageDog: null };
let lastFoodKey = null;
let currentTreatIndex = 0;
let bodyFrameIndex = 0;
let gameStarted = false;
let pendingHighscore = null;
let highscores = [];
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
let treatsSinceRage = 0;
let bgFadeRaf = null;
let rageFadeRaf = null;
let swipePointerId = null;
let swipeLastX = 0;
let swipeLastY = 0;
const HIDDEN_FOOD = { x: -9999, y: -9999 };

const bgMusic = new Audio("./assets/bg-music.mp3");
bgMusic.loop = true;
bgMusic.volume = BG_MUSIC_VOLUME;
bgMusic.playsInline = true;

const rageMusic = new Audio("./assets/lulu-rage.mp3");
rageMusic.loop = false;
rageMusic.volume = RAGE_MUSIC_VOLUME;
rageMusic.playsInline = true;
bgMusic.muted = audioMuted;
rageMusic.muted = audioMuted;

function playRageTrack() {
  if (audioMuted) return;
  rageMusic.play().then(() => {
    ragePlayPending = false;
  }).catch(() => {
    ragePlayPending = true;
  });
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
  primeRageTrackIfNeeded();
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
  if (bgFadeRaf) cancelAnimationFrame(bgFadeRaf);
  bgFadeRaf = null;
  if (audioMuted) {
    bgMusic.pause();
    rageMusic.pause();
    rageMusicActive = false;
    if (rageFadeRaf) cancelAnimationFrame(rageFadeRaf);
    rageFadeRaf = null;
  } else if (audioUnlocked && bgMusic.paused && !isRageMode()) {
    bgMusic.volume = bgWasDucked ? BG_DUCKED_VOLUME : BG_MUSIC_VOLUME;
    bgMusic.play().catch(() => {});
    primeRageTrackIfNeeded();
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
  const [head, walk1, walk2, walk3, walk4, bodyFallback, tail, ragePee, rageDog, ...treats] = await Promise.all([
    loadImage("./assets/snake-head.png"),
    loadImage("./assets/snake-body-walk-1.png"),
    loadImage("./assets/snake-body-walk-2.png"),
    loadImage("./assets/snake-body-walk-3.png"),
    loadImage("./assets/snake-body-walk-4.png"),
    loadImage("./assets/snake-body.png"),
    loadImage("./assets/snake-tail.png"),
    loadImage("./assets/rage-pee.png"),
    loadImage("./assets/rage-dog.png"),
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
}

function updateScore() {
  scoreEl.textContent = String(state.score);
}

function advanceBodyWalkFrame() {
  if (images.bodyFrames.length <= 1) return;
  bodyFrameIndex = (bodyFrameIndex + 1) % images.bodyFrames.length;
}

function tick() {
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

function resetGame() {
  unlockAudioIfNeeded();
  state = createGameState({
    gridSize: CELL_COUNT,
    seed: Date.now(),
    wallsEnabled: false,
  });
  state = { ...state, pointsPerFood: 1 };
  treatsSinceRage = 0;
  rageTreatActive = false;
  rageTreatReady = false;
  rageRunner = null;
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
  bodyFrameIndex = 0;
  paused = false;
  gameStarted = true;
  pauseButton.textContent = "Pause";
  updateScore();
  assignFoodStyle();
  overlay.hidden = true;
  drawGrid();
}

function updateMenuLabels() {
  top5Title.textContent = "Top 5 Global";
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

document.addEventListener("pointerdown", unlockAudioIfNeeded, { once: true });
document.addEventListener("keydown", unlockAudioIfNeeded, { once: true });
document.addEventListener("pointerdown", () => {
  if (!ragePlayPending || !isRageMode() || audioMuted) return;
  primeRageTrackIfNeeded();
  playRageTrack();
});
document.addEventListener("keydown", () => {
  if (!ragePlayPending || !isRageMode() || audioMuted) return;
  primeRageTrackIfNeeded();
  playRageTrack();
});

audioToggle.addEventListener("click", () => {
  unlockAudioIfNeeded();
  setAudioMuted(!audioMuted);
});
