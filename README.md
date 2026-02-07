# Lulu-Snake

## Run

1. From the repo root, start a simple server:

```bash
python3 -m http.server 8000
```

2. Open `http://localhost:8000` in your browser.

## Controls

- Arrow keys or WASD to move
- `Space` to pause/resume
- `R` to restart
- Select `Easy`, `Medium`, or `Hard` from the in-game start window
- On-screen buttons are available for touch

## Notes

- The game logic is deterministic and separated in `game.js`.
- The UI is intentionally minimal and self-contained.
