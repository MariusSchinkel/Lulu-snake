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
- Askaban now prioritizes direct head pursuit (distance-first chase steps), so it tracks the snake head more consistently.
- Askaban chase speed is tuned faster overall, with extra catch-up when farther from the snake.
- After each Askaban event ends, at least `12` treats must be eaten before another chase can trigger.
- Once that 12-treat recovery is complete, Askaban can reappear much sooner than before.
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

Create table/functions/policies in Supabase SQL Editor:

```sql
create extension if not exists pgcrypto;

create table if not exists public.lulu_scores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 24),
  score integer not null check (score >= 0 and score <= 100000),
  edit_token_hash text,
  created_at timestamptz not null default now()
);

alter table public.lulu_scores
  add column if not exists edit_token_hash text;

update public.lulu_scores
set edit_token_hash = encode(digest(gen_random_uuid()::text, 'sha256'), 'hex')
where edit_token_hash is null;

alter table public.lulu_scores
  alter column edit_token_hash set not null;

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
set search_path = public
as $$
declare
  v_name text := left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 24);
  v_score integer := greatest(0, least(coalesce(p_score, 0), 100000));
  v_token text := coalesce(p_edit_token, '');
  v_hash text;
begin
  if char_length(v_name) = 0 then
    v_name := 'Player 1';
  end if;
  if char_length(v_token) < 24 then
    raise exception 'invalid edit token';
  end if;
  v_hash := encode(digest(v_token, 'sha256'), 'hex');

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
set search_path = public
as $$
declare
  v_name text := left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 24);
  v_hash text := encode(digest(coalesce(p_edit_token, ''), 'sha256'), 'hex');
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

Client config is set in `app.js`. The client now writes via RPC (`create_highscore`, `rename_highscore`) instead of direct table insert/update.

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
