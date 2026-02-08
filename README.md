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
- Askaban movement now uses a stronger predictive pursuit with less random drifting for tighter, more natural chasing.
- Askaban chase speed is slightly faster and adaptive (faster catch-up when far away, steadier when close).
- After each Askaban event ends, at least `12` treats must be eaten before another chase can trigger.
- The in-world `ASKABAN` text above the chasing sprite has been removed for cleaner visuals.
- Optional dedicated hunter asset: `assets/chaser-askaban.png`.
- Chase music now uses `assets/askaban-song.mp3` during active Askaban events.
- The `OH NO WINDHUND LADY LOST CONTROL` alert now stays longer on screen and uses a stronger pop/pulse animation for higher visibility.

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

- Top 5 scores are synced via Supabase (`public.lulu_scores`).
- The game keeps a local cache as fallback if network requests fail.
- Name defaults to `Player 1` if empty.

## Supabase Setup

Create table/policies in Supabase SQL Editor:

```sql
create table if not exists public.lulu_scores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 24),
  score integer not null check (score >= 0),
  created_at timestamptz not null default now()
);

create index if not exists lulu_scores_rank_idx
on public.lulu_scores (score desc, created_at asc);

alter table public.lulu_scores enable row level security;

grant select, insert, update on table public.lulu_scores to anon;

drop policy if exists "Public can read scores" on public.lulu_scores;
create policy "Public can read scores"
on public.lulu_scores for select to anon using (true);

drop policy if exists "Public can insert scores" on public.lulu_scores;
create policy "Public can insert scores"
on public.lulu_scores for insert to anon with check (true);

drop policy if exists "Public can update score names" on public.lulu_scores;
create policy "Public can update score names"
on public.lulu_scores
for update to anon
using (true)
with check (char_length(name) between 1 and 24);
```

Supabase config is currently set directly in `app.js`.

## Deploy (Netlify)

1. Push this repository to GitHub.
2. In Netlify, import the GitHub repo.
3. Use these settings in Netlify:
   - Base directory: empty
   - Publish directory: `.`
   - Build command: empty
4. Deploy.

Every new commit pushed to `main` triggers an automatic redeploy.
