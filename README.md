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

- Top 5 scores are synced via Supabase (`public.lulu_scores`).
- Score submissions are capped at `20000`.
- The game keeps a local cache as fallback if network requests fail.
- Name defaults to `Player 1` if empty.
- When you reach Top 5, you edit your name inline in the highlighted score row and get two actions: `Save Score` and `Save Score & Play Again`.

## Supabase Setup

Create table/functions/policies in Supabase SQL Editor:

```sql
create extension if not exists pgcrypto;

create table if not exists public.lulu_scores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 24),
  score integer not null check (score >= 0 and score <= 20000),
  edit_token_hash text,
  created_at timestamptz not null default now()
);

alter table public.lulu_scores
  add column if not exists edit_token_hash text;

update public.lulu_scores
set edit_token_hash = encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex')
where edit_token_hash is null;

alter table public.lulu_scores
  alter column edit_token_hash set not null;

alter table public.lulu_scores
  drop constraint if exists lulu_scores_score_check;

alter table public.lulu_scores
  add constraint lulu_scores_score_check check (score >= 0 and score <= 20000);

create index if not exists lulu_scores_rank_idx
on public.lulu_scores (score desc, created_at asc);

alter table public.lulu_scores enable row level security;

revoke insert, update, delete on table public.lulu_scores from anon;
grant select on table public.lulu_scores to anon;

drop policy if exists "Public can read scores" on public.lulu_scores;
create policy "Public can read scores"
on public.lulu_scores for select to anon using (true);

drop policy if exists "Public can insert scores" on public.lulu_scores;
drop policy if exists "Public can update score names" on public.lulu_scores;

drop function if exists public.create_highscore(text, integer, text);
create or replace function public.create_highscore(
  p_name text,
  p_score integer,
  p_edit_token text
)
returns setof public.lulu_scores
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 24);
  v_score integer := greatest(0, least(coalesce(p_score, 0), 20000));
  v_token text := coalesce(p_edit_token, '');
  v_hash text;
begin
  if char_length(v_name) = 0 then
    v_name := 'Player 1';
  end if;
  if v_token !~ '^[0-9a-f]{48}$' then
    raise exception 'invalid edit token';
  end if;
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  return query
  insert into public.lulu_scores (name, score, edit_token_hash)
  values (v_name, v_score, v_hash)
  returning *;
end;
$$;

drop function if exists public.rename_highscore(uuid, text, text);
create or replace function public.rename_highscore(
  p_id uuid,
  p_name text,
  p_edit_token text
)
returns setof public.lulu_scores
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 24);
  v_hash text := encode(extensions.digest(coalesce(p_edit_token, ''), 'sha256'), 'hex');
begin
  if char_length(v_name) = 0 then
    v_name := 'Player 1';
  end if;

  return query
  update public.lulu_scores
  set name = v_name
  where id = p_id
    and edit_token_hash = v_hash
  returning *;
end;
$$;

revoke all on function public.create_highscore(text, integer, text) from public;
revoke all on function public.rename_highscore(uuid, text, text) from public;
grant execute on function public.create_highscore(text, integer, text) to anon;
grant execute on function public.rename_highscore(uuid, text, text) to anon;
```

### Security Cleanup (If You Already Saw Fake Scores)

Run this once in Supabase SQL editor to remove suspicious rows and keep only sane scores:

```sql
delete from public.lulu_scores
where score > 20000
   or name ilike '%hacked%';
```

Client config is set in `app.js`. The client now writes via RPC (`create_highscore`, `rename_highscore`) instead of direct table insert/update.
Legacy direct table-write fallback has been removed (fail-closed). If RPC migration is missing or misconfigured, score writes are rejected until the SQL setup above is correctly applied.

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
