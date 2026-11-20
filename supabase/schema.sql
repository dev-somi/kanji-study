-- 상용한자 학습 앱 동기화 스키마
-- Supabase 대시보드 → SQL Editor 에 전체를 붙여넣고 Run.

create table if not exists public.sync_items (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text        not null check (kind in ('card', 'log', 'override', 'settings')),
  id         text        not null,
  data       jsonb       not null,
  updated_at bigint      not null,            -- 기기에서 바뀐 시각 (epoch ms) — 충돌 시 큰 쪽이 이김
  synced_at  timestamptz not null default clock_timestamp(), -- 서버에 들어온 시각 — pull 커서
  primary key (user_id, kind, id)
);

create index if not exists sync_items_pull_idx on public.sync_items (user_id, synced_at);

alter table public.sync_items enable row level security;

drop policy if exists "own rows select" on public.sync_items;
drop policy if exists "own rows insert" on public.sync_items;
drop policy if exists "own rows update" on public.sync_items;
create policy "own rows select" on public.sync_items for select using (auth.uid() = user_id);
create policy "own rows insert" on public.sync_items for insert with check (auth.uid() = user_id);
create policy "own rows update" on public.sync_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 여러 항목을 한 번에 올리기. 서버 쪽이 더 최신이면 덮어쓰지 않음.
create or replace function public.push_items(items jsonb)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.sync_items (user_id, kind, id, data, updated_at)
  select auth.uid(), x ->> 'kind', x ->> 'id', x -> 'data', (x ->> 'updated_at')::bigint
  from jsonb_array_elements(items) as x
  on conflict (user_id, kind, id) do update
    set data       = excluded.data,
        updated_at = excluded.updated_at,
        synced_at  = clock_timestamp()
    where public.sync_items.updated_at < excluded.updated_at;
$$;

grant execute on function public.push_items(jsonb) to authenticated;
