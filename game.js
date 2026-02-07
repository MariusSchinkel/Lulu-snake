const DEFAULT_GRID = 20;

const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function nextSeed(seed) {
  return (seed * 1664525 + 1013904223) >>> 0;
}

function randomInt(seed, max) {
  const newSeed = nextSeed(seed);
  return { value: newSeed % max, seed: newSeed };
}

function positionsEqual(a, b) {
  return a.x === b.x && a.y === b.y;
}

function isOutOfBounds(pos, gridSize) {
  return pos.x < 0 || pos.y < 0 || pos.x >= gridSize || pos.y >= gridSize;
}

function isOnSnake(pos, snake) {
  return snake.some((segment) => positionsEqual(segment, pos));
}

function spawnFood(state) {
  let seed = state.rngSeed;
  let food = null;

  while (!food) {
    const randX = randomInt(seed, state.gridSize);
    seed = randX.seed;
    const randY = randomInt(seed, state.gridSize);
    seed = randY.seed;
    const candidate = { x: randX.value, y: randY.value };
    if (!isOnSnake(candidate, state.snake)) {
      food = candidate;
    }
  }

  return { food, seed };
}

function createInitialSnake(gridSize) {
  const mid = Math.floor(gridSize / 2);
  return [
    { x: mid, y: mid },
    { x: mid - 1, y: mid },
    { x: mid - 2, y: mid },
  ];
}

export function createGameState({ gridSize = DEFAULT_GRID, seed = Date.now(), wallsEnabled = true } = {}) {
  const snake = createInitialSnake(gridSize);
  const state = {
    gridSize,
    snake,
    dir: { ...DIRECTIONS.right },
    nextDir: { ...DIRECTIONS.right },
    food: null,
    score: 0,
    alive: true,
    rngSeed: seed >>> 0,
    wallsEnabled,
    pointsPerFood: 1,
  };
  const { food, seed: next } = spawnFood(state);
  state.food = food;
  state.rngSeed = next;
  return state;
}

export function setDirection(state, directionKey) {
  const desired = DIRECTIONS[directionKey];
  if (!desired) return state;
  const current = state.nextDir;
  if (current.x + desired.x === 0 && current.y + desired.y === 0) {
    return state;
  }
  return { ...state, nextDir: { ...desired } };
}

export function stepGame(state) {
  if (!state.alive) return state;

  const dir = state.nextDir;
  const head = state.snake[0];
  let nextHead = { x: head.x + dir.x, y: head.y + dir.y };

  if (state.wallsEnabled) {
    if (isOutOfBounds(nextHead, state.gridSize)) {
      return { ...state, alive: false, dir };
    }
  } else {
    const size = state.gridSize;
    nextHead = {
      x: (nextHead.x + size) % size,
      y: (nextHead.y + size) % size,
    };
  }

  const body = state.snake.slice(0, -1);
  if (isOnSnake(nextHead, body)) {
    return { ...state, alive: false, dir };
  }

  let snake = [nextHead, ...state.snake];
  let score = state.score;
  let food = state.food;
  let seed = state.rngSeed;

  if (positionsEqual(nextHead, state.food)) {
    score += state.pointsPerFood;
    const spawned = spawnFood({ ...state, snake, rngSeed: seed });
    food = spawned.food;
    seed = spawned.seed;
  } else {
    snake = snake.slice(0, -1);
  }

  return {
    ...state,
    snake,
    dir,
    nextDir: dir,
    food,
    score,
    rngSeed: seed,
  };
}

export function getDirectionKeys() {
  return Object.keys(DIRECTIONS);
}
