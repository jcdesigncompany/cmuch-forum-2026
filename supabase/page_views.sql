-- =====================================================================
-- 網頁瀏覽次數（首頁頁尾顯示）
-- 於 Supabase → SQL Editor 貼上全部內容後按 Run；可重複執行，不會歸零。
-- 同一瀏覽器分頁工作階段只計一次（由網頁端控制）。
-- =====================================================================
create table if not exists public.page_views (
  id int primary key default 1 check (id = 1),
  total bigint not null default 0,
  since timestamptz not null default now()
);
insert into public.page_views (id) values (1) on conflict (id) do nothing;
alter table public.page_views enable row level security;
revoke all on public.page_views from anon, authenticated;

-- 瀏覽次數加一並回傳最新總數
create or replace function public.page_view_hit()
returns bigint language sql security definer set search_path = public as $$
  update public.page_views set total = total + 1 where id = 1 returning total
$$;

-- 只讀取總數（同一工作階段重新整理時使用）
create or replace function public.page_view_count()
returns bigint language sql stable security definer set search_path = public as $$
  select total from public.page_views where id = 1
$$;

revoke all on function public.page_view_hit() from public;
revoke all on function public.page_view_count() from public;
grant execute on function public.page_view_hit() to anon, authenticated;
grant execute on function public.page_view_count() to anon, authenticated;
