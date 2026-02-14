# Lulu-Snake

Classic Snake with a dog-themed visual style, Lulu-Rage mode, music, and a global Top 5 highscore list.

## Run Locally

From this folder (`Lulu_Snake`), start a simple static server:

```bash
python3 -m http.server 8000
```

Then open:

`http://localhost:8000`

## Controls

- `Arrow keys` or `WASD`: move
- `Swipe anywhere on screen` (touch/pen): move
- `Space`: pause/resume
- `R`: restart
- `Speaker` button toggles music (`🔊` on, `🔇` muted)
- Menu mode switch: `Single Player` or `1v1 Online`

## Gameplay Notes

- Walls are wrap-around (no wall collisions).
- Single game mode: no difficulty selector.
- Start speed is noticeably slower, then increases gradually as snake length grows.
- Snake body uses the 4 `snake-body-walk-*` frames for the full body animation (when available).
- Body rendering now draws one oriented sprite per snake segment (instead of texture-stroked lines) for cleaner continuity in turns and wraps.
- A shared trim box is applied across walk frames to keep frame alignment stable.
- Tail segment uses `assets/snake-tail.png` with a smaller scale for a more natural dog-tail proportion.
- Leftward movement now uses sprite mirroring (instead of 180-degree rotation) so head/body stay upright.
- Corner sprite rendering has been removed; turns now use regular oriented body segments, with tail sprite retained.
- Opaque walk-frame backgrounds are auto-cleaned from image edges when possible.
- Swipe threshold is lower on mobile screens for quicker touch direction changes.
- Rage audio now primes `lulu-rage.mp3` on user gesture and retries during active rage if a mobile autoplay block occurs.
- Askaban audio now has dedicated mobile priming and retry-on-gesture handling to improve chase-track reliability.
- During Lulu-Rage, background music is paused and resumes after rage ends to avoid overlapping tracks.
- Rage trigger now uses a run-in dog event: a dog enters, pees on the board, and only then the special pee treat becomes edible.
- During Lulu-Rage, all food is rendered as dog-pee style treats.
- Rage run-in/pee timing is slower for clearer visual readability.
- Optional rage assets can be provided as `assets/rage-pee.png` (pee treat) and `assets/rage-dog.png` (running/peeing dog).
- Occasional chase events now spawn an Afghan hound hunter for about `45s`.
- Hunter is now `Askaban` only (black Afghan) with warning tag: `OH NO WINDHUND LADY LOST CONTROL`.
- Askaban now prioritizes direct head pursuit (distance-first chase steps), so it tracks the snake head more consistently.
- Askaban is now always tuned slightly slower than the snake, while still using stronger head-targeting pursuit.
- After each Askaban event ends, at least `12` treats must be eaten before another chase can trigger.
- Once that 12-treat recovery is complete, Askaban can reappear much sooner than before.
- The in-world `ASKABAN` text above the chasing sprite has been removed for cleaner visuals.
- Optional dedicated hunter asset: `assets/chaser-askaban.png`.
- Chase music now uses `assets/askaban-song.mp3` during active Askaban events.
- The `OH NO WINDHUND LADY LOST CONTROL` alert now stays longer on screen and uses a stronger pop/pulse animation for higher visibility.
- New `1v1 Online` mode uses Supabase Realtime room codes for live head-to-head races.
- In 1v1 mode, both players fight for the same shared treat (host-authoritative food sync).
- In 1v1 mode, first player to `20` treats wins.
- In 1v1 mode, touching the opponent snake causes an immediate loss.
- In 1v1 mode, players spawn on opposite sides of the board to avoid instant overlap at match start.
- During 1v1 mode, opponent movement is rendered as a live ghost snake and an opponent score counter.
- Direction input now blocks instant reverse-through-queue behavior, preventing false early crashes from very fast key/swipe combinations.
- Realtime duel now accepts authoritative food/start updates from the host only, reducing spoofed-event abuse.
- Rage/Askaban/highscore submission are intentionally disabled during active 1v1 rounds to keep the duel deterministic.

## 1v1 Online (Supabase Realtime)

1. Open menu and switch to `1v1 Online`.
2. Create a room (`Create`) or enter a code and press `Join`.
3. Share the room code with the second player.
4. When both players are connected, the host presses `Start 1v1`.
5. Both players race to the same shared treat; first to `20` treats wins, and touching the opponent snake loses instantly.

Notes:

- Requires internet access (Supabase Realtime).
- Uses your existing Supabase project URL + anon key from `app.js`; no extra table is required for room sync.
- Room sync is optimized for 2 players (`1v1`).

### Body Animation Assets

- `assets/snake-body-walk-1.png`
- `assets/snake-body-walk-2.png`
- `assets/snake-body-walk-3.png`
- `assets/snake-body-walk-4.png`
- Fallback if walk frames are missing: `assets/snake-body.png`

### Lulu-Rage

- Random rage-treat chance is `7%`.
- Guaranteed rage-treat if none appeared in `15` treats.
- Rage lasts `15s` plus popup intro time.
- Rage gives double points and a temporary speed boost.
- Rage visuals include a stronger screen pulse, higher contrast/saturation, scanline overlay, and intensified glow effects.

## Highscores (Cross-Device)

- Top 5 scores are synced via Supabase (`public.lulu_scores`) and read publicly.
- Score submissions are capped at `20000` and now go through a secured Edge Function (`submit-score`).
- The game keeps a local cache as fallback if network requests fail.
- Name defaults to `Player 1` if empty.
- When you reach Top 5, you edit your name inline in the highlighted score row and get two actions: `Save Score` and `Save Score & Play Again`.

## Supabase Setup

1. In Supabase SQL editor, run:

```sql
-- Paste and run the complete script from:
-- supabase/sql/highscore-security.sql
```

This script:

- Enforces `score <= 20000`.
- Creates/updates `highscore_audit`.
- Creates secure RPCs:
  - `create_highscore_secure(...)`
  - `rename_highscore_secure(...)`
- Revokes browser/anon execute on legacy RPCs.
- Grants execute on secure RPCs to `service_role` only.

2. Set Edge Function secrets (replace values):

```bash
supabase secrets set \
  SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
  TURNSTILE_SECRET_KEY="YOUR_TURNSTILE_SECRET_KEY" \
  ALLOWED_ORIGINS="https://lulu-snake.de,https://www.lulu-snake.de,http://localhost:8000"
```

3. Deploy the function:

```bash
supabase functions deploy submit-score
```

4. In `app.js`, set:

```js
const TURNSTILE_SITE_KEY = "YOUR_TURNSTILE_SITE_KEY";
```

5. Ensure Cloudflare Turnstile allows your domains (`lulu-snake.de`, `www.lulu-snake.de`, `localhost` for dev).

### Edge Function Files

- `supabase/functions/submit-score/index.ts`
- `supabase/sql/highscore-security.sql`

The browser now writes highscores only through `POST /functions/v1/submit-score` with:

- origin allowlist check,
- Turnstile verification,
- service-role RPC call,
- audit logging of accepted/rejected attempts.

### Security Cleanup (If You Already Saw Fake Scores)

Run this once in Supabase SQL editor to remove suspicious rows and keep only sane scores:

```sql
delete from public.lulu_scores
where score > 20000
   or name ilike '%hacked%';
```

To inspect attacks and blocks:

```sql
select created_at, ip, user_agent, origin, name, score, accepted, reason
from public.highscore_audit
order by created_at desc
limit 200;
```

Client config is set in `app.js`.
Legacy direct table-write fallback remains removed (fail-closed).

## Deploy (GitHub Pages)

1. Push this repository to GitHub.
2. Open GitHub repository settings: `Settings -> Pages`.
3. Under **Build and deployment**, set:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
4. Save.
5. (Optional/custom domain) Set your domain to `www.lulu-snake.de` and keep the root `CNAME` file in the repo.

Every new commit pushed to `main` triggers an automatic redeploy on GitHub Pages.
