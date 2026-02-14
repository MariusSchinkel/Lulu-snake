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

create table if not exists public.highscore_audit (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  ip inet,
  user_agent text,
  origin text,
  name text,
  score integer,
  accepted boolean not null,
  reason text not null
);

create index if not exists highscore_audit_created_idx on public.highscore_audit (created_at desc);
create index if not exists highscore_audit_ip_idx on public.highscore_audit (ip, created_at desc);

alter table public.lulu_scores
  drop constraint if exists lulu_scores_score_check;

-- Remove out-of-range rows before re-adding strict check.
delete from public.lulu_scores
where score < 0 or score > 20000;

alter table public.lulu_scores
  add constraint lulu_scores_score_check check (score >= 0 and score <= 20000);

create or replace function public.create_highscore_secure(
  p_name text,
  p_score integer,
  p_edit_token text,
  p_ip inet,
  p_user_agent text,
  p_origin text
)
returns setof public.lulu_scores
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 24);
  v_score integer := coalesce(p_score, 0);
  v_token text := coalesce(p_edit_token, '');
  v_hash text;
  v_recent_count integer := 0;
  v_inserted public.lulu_scores%rowtype;
begin
  if char_length(v_name) = 0 then
    v_name := 'Player 1';
  end if;

  if p_ip is not null then
    select count(*) into v_recent_count
    from public.highscore_audit
    where ip = p_ip
      and created_at > now() - interval '1 minute'
      and accepted;

    if v_recent_count >= 5 then
      insert into public.highscore_audit(ip, user_agent, origin, name, score, accepted, reason)
      values (p_ip, p_user_agent, p_origin, v_name, v_score, false, 'rate_limited_create');
      raise exception 'rate limited';
    end if;
  end if;

  if v_score < 0 or v_score > 20000 then
    insert into public.highscore_audit(ip, user_agent, origin, name, score, accepted, reason)
    values (p_ip, p_user_agent, p_origin, v_name, v_score, false, 'invalid_score');
    raise exception 'invalid score';
  end if;

  if v_token !~ '^[0-9a-f]{48}$' then
    insert into public.highscore_audit(ip, user_agent, origin, name, score, accepted, reason)
    values (p_ip, p_user_agent, p_origin, v_name, v_score, false, 'invalid_edit_token');
    raise exception 'invalid edit token';
  end if;

  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.lulu_scores (name, score, edit_token_hash)
  values (v_name, v_score, v_hash)
  returning * into v_inserted;

  insert into public.highscore_audit(ip, user_agent, origin, name, score, accepted, reason)
  values (p_ip, p_user_agent, p_origin, v_name, v_score, true, 'created');

  return next v_inserted;
  return;
end;
$$;

create or replace function public.rename_highscore_secure(
  p_id uuid,
  p_name text,
  p_edit_token text,
  p_ip inet,
  p_user_agent text,
  p_origin text
)
returns setof public.lulu_scores
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 24);
  v_token text := coalesce(p_edit_token, '');
  v_hash text;
  v_recent_count integer := 0;
  v_updated public.lulu_scores%rowtype;
begin
  if p_id is null then
    raise exception 'missing id';
  end if;

  if char_length(v_name) = 0 then
    v_name := 'Player 1';
  end if;

  if p_ip is not null then
    select count(*) into v_recent_count
    from public.highscore_audit
    where ip = p_ip
      and created_at > now() - interval '1 minute';

    if v_recent_count >= 30 then
      insert into public.highscore_audit(ip, user_agent, origin, name, score, accepted, reason)
      values (p_ip, p_user_agent, p_origin, v_name, null, false, 'rate_limited_rename');
      raise exception 'rate limited';
    end if;
  end if;

  if v_token !~ '^[0-9a-f]{48}$' then
    insert into public.highscore_audit(ip, user_agent, origin, name, score, accepted, reason)
    values (p_ip, p_user_agent, p_origin, v_name, null, false, 'invalid_edit_token');
    raise exception 'invalid edit token';
  end if;

  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  update public.lulu_scores
  set name = v_name
  where id = p_id
    and edit_token_hash = v_hash
  returning * into v_updated;

  if not found then
    insert into public.highscore_audit(ip, user_agent, origin, name, score, accepted, reason)
    values (p_ip, p_user_agent, p_origin, v_name, null, false, 'rename_token_mismatch_or_missing');
    return;
  end if;

  insert into public.highscore_audit(ip, user_agent, origin, name, score, accepted, reason)
  values (p_ip, p_user_agent, p_origin, v_name, v_updated.score, true, 'renamed');

  return next v_updated;
  return;
end;
$$;

-- Browser/anon writes must stay blocked.
revoke execute on function public.create_highscore(text, integer, text) from public, anon, authenticated;
revoke execute on function public.rename_highscore(uuid, text, text) from public, anon, authenticated;

-- Secure RPC endpoints callable only by service_role (via Edge Function).
revoke all on function public.create_highscore_secure(text, integer, text, inet, text, text) from public, anon, authenticated;
revoke all on function public.rename_highscore_secure(uuid, text, text, inet, text, text) from public, anon, authenticated;
grant execute on function public.create_highscore_secure(text, integer, text, inet, text, text) to service_role;
grant execute on function public.rename_highscore_secure(uuid, text, text, inet, text, text) to service_role;
