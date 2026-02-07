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
const difficultyButtons = document.querySelectorAll("[data-difficulty]");
const ragePopup = document.getElementById("rage-popup");
const audioToggle = document.getElementById("audio-toggle");
const pauseButton = document.getElementById("pause");
const restartButton = document.getElementById("restart");
const controlButtons = document.querySelectorAll("[data-dir]");
const shellEl = document.querySelector(".shell");
const topbarEl = document.querySelector(".topbar");
const controlsEl = document.querySelector(".controls");
const stageEl = document.querySelector(".stage");

const CELL_COUNT = 20;
const LAST_NAME_KEY = "lulu-snake-last-name";
const HIGHSCORE_KEY = "lulu-snake-highscores-by-difficulty";
const AUDIO_MUTED_KEY = "lulu-snake-audio-muted";
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
const selectedDifficulty = "easy";
let gameStarted = false;
let pendingHighscore = null;
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
    handleGameOver(state.score, selectedDifficulty);
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
  const stagePad = 28; // stage padding + border safety

  const byHeight =
    shellEl.clientHeight - shellPadY - topbarEl.offsetHeight - controlsEl.offsetHeight - shellGap * 2 - stagePad;
  const byWidth = shellEl.clientWidth - shellPadX - stagePad;
  const nextSize = Math.max(260, Math.floor(Math.min(byHeight, byWidth)));

  if (nextSize > 0 && (canvas.width !== nextSize || canvas.height !== nextSize)) {
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
    difficultyCurrent.textContent = "Selected: Easy";
    top5Title.textContent = "Top 5";
  }
  renderHighscores();
}

function getStoredName() {
  const name = localStorage.getItem(LAST_NAME_KEY);
  return name && name.trim() ? name.trim() : "Player 1";
}

function saveLastName(rawName) {
  const raw = rawName.trim();
  const name = raw || "Player 1";
  localStorage.setItem(LAST_NAME_KEY, name);
  return name;
}

function loadHighscores() {
  try {
    const raw = localStorage.getItem(HIGHSCORE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      easy: Array.isArray(parsed.easy) ? parsed.easy : [],
      medium: Array.isArray(parsed.medium) ? parsed.medium : [],
      hard: Array.isArray(parsed.hard) ? parsed.hard : [],
    };
  } catch {
    return { easy: [], medium: [], hard: [] };
  }
}

function saveHighscores(scoresByDifficulty) {
  localStorage.setItem(HIGHSCORE_KEY, JSON.stringify(scoresByDifficulty));
}

function updateHighscoreName(difficulty, id, rawName) {
  const scoresByDifficulty = loadHighscores();
  const scores = scoresByDifficulty[difficulty] || [];
  const idx = scores.findIndex((entry) => entry.id === id);
  if (idx < 0) return;
  const normalized = (rawName || "").trim() || "Player 1";
  scores[idx].name = normalized;
  scoresByDifficulty[difficulty] = scores;
  saveHighscores(scoresByDifficulty);
  saveLastName(normalized);
}

function renderHighscores() {
  const scoresByDifficulty = loadHighscores();
  const scores = scoresByDifficulty[selectedDifficulty] || [];
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
        updateHighscoreName(selectedDifficulty, entry.id, input.value);
      });
      input.addEventListener("blur", () => {
        const normalized = (input.value || "").trim() || "Player 1";
        input.value = normalized;
        updateHighscoreName(selectedDifficulty, entry.id, normalized);
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

function isTopFiveScore(score, difficulty) {
  if (score <= 0) return false;
  const scoresByDifficulty = loadHighscores();
  const scores = scoresByDifficulty[difficulty] || [];
  if (scores.length < 5) return true;
  const cutoff = scores[4].score;
  return score >= cutoff;
}

function recordHighscore(score, rawName, difficulty) {
  if (score <= 0) return null;
  const name = saveLastName(rawName);
  const scoresByDifficulty = loadHighscores();
  const scores = scoresByDifficulty[difficulty] || [];
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    score,
    createdAt: Date.now(),
  };
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score || a.createdAt - b.createdAt);
  scoresByDifficulty[difficulty] = scores.slice(0, 5);
  saveHighscores(scoresByDifficulty);
  const idx = scoresByDifficulty[difficulty].findIndex((item) => item.id === entry.id);
  return idx >= 0 ? { id: entry.id, difficulty } : null;
}

function handleGameOver(score, difficulty) {
  if (isTopFiveScore(score, difficulty)) {
    pendingHighscore = recordHighscore(score, getStoredName(), difficulty);
    nameEntry.hidden = true;
  } else {
    pendingHighscore = null;
    nameEntry.hidden = true;
  }
  renderHighscores();
}

function openMenu(mode) {
  gameStarted = false;
  paused = true;
  pauseButton.textContent = "Pause";
  overlay.hidden = false;
  renderHighscores();
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

controlButtons.forEach((button) => {
  button.addEventListener("click", () => {
    handleDirection(button.dataset.dir);
  });
});

document.addEventListener("keydown", handleKey);

updateScore();
updateAudioButton();
updateDifficultyButtons();
renderHighscores();
fitCanvasToViewport();
drawGrid();
openMenu("start");

loadAssets().then(() => {
  fitCanvasToViewport();
  drawGrid();
  scheduleTick();
});

window.addEventListener("resize", fitCanvasToViewport);

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
