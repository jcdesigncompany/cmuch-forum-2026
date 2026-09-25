-- =====================================================================
-- 健康台灣深耕計畫兒童醫院永續發展論壇｜Supabase 資料庫結構
-- 使用方式：Supabase 專案 → SQL Editor → 貼上全部內容 → Run
-- 可重複執行（已存在的物件會略過或更新）
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0. 工作人員帳號網域限制
--    填入醫院電子郵件網域後，只有該網域可申請工作人員帳號。
--    例：array['example.org.tw']；留空陣列代表不限制（不建議正式使用）。
-- ---------------------------------------------------------------------
create or replace function public.staff_allowed_domains()
returns text[] language sql immutable as $$
  select array[]::text[]
$$;

-- ---------------------------------------------------------------------
-- 1. 資料表
-- ---------------------------------------------------------------------
create table if not exists public.site_content (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'pending'
    check (role in ('pending','viewer','checkin','admin')),
  created_at timestamptz not null default now()
);

create or replace function public.gen_code()
returns text language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := 'CM';
    for i in 1..5 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.registrations r where r.code = c);
  end loop;
  return c;
end $$;

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  token uuid not null unique default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  org text not null check (char_length(org) between 1 and 120),
  title text check (char_length(title) <= 60),
  email text check (char_length(email) <= 120),
  phone text check (char_length(phone) <= 30),
  category text not null default 'general'
    check (category in ('vip','speaker','general','staff')),
  note text check (char_length(note) <= 300),
  source text not null default 'online' check (source in ('online','import','walkin','manual')),
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  checked_in_at timestamptz,
  checked_in_by uuid
);
alter table public.registrations alter column code set default public.gen_code();
create unique index if not exists registrations_email_uq
  on public.registrations (lower(email)) where email is not null and email <> '';

-- ---------------------------------------------------------------------
-- 2. 角色判斷
-- ---------------------------------------------------------------------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.staff_roles where user_id = auth.uid()), 'none')
$$;

-- 新帳號建立時自動加入「待審核」
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  domains text[] := public.staff_allowed_domains();
begin
  if array_length(domains, 1) is not null
     and not (lower(split_part(new.email, '@', 2)) = any (domains)) then
    raise exception '此電子郵件網域未開放申請工作人員帳號';
  end if;
  insert into public.staff_roles (user_id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', ''))
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 3. 資料列安全性（RLS）
-- ---------------------------------------------------------------------
alter table public.site_content enable row level security;
alter table public.staff_roles enable row level security;
alter table public.registrations enable row level security;

-- 完整網站內容（含邀請中貴賓）僅工作人員可讀；對外一律透過 public_site_content()
drop policy if exists site_read on public.site_content;
create policy site_read on public.site_content for select
  using (public.my_role() in ('viewer','checkin','admin'));
drop policy if exists site_write on public.site_content;
create policy site_write on public.site_content for all
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

drop policy if exists roles_read on public.staff_roles;
create policy roles_read on public.staff_roles for select
  using (user_id = auth.uid() or public.my_role() = 'admin');
drop policy if exists roles_admin on public.staff_roles;
create policy roles_admin on public.staff_roles for update
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists roles_delete on public.staff_roles;
create policy roles_delete on public.staff_roles for delete
  using (public.my_role() = 'admin' and user_id <> auth.uid());

drop policy if exists reg_read on public.registrations;
create policy reg_read on public.registrations for select
  using (public.my_role() in ('viewer','checkin','admin'));
drop policy if exists reg_admin_ins on public.registrations;
create policy reg_admin_ins on public.registrations for insert
  with check (public.my_role() = 'admin');
drop policy if exists reg_admin_upd on public.registrations;
create policy reg_admin_upd on public.registrations for update
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists reg_admin_del on public.registrations;
create policy reg_admin_del on public.registrations for delete
  using (public.my_role() = 'admin');

-- 管理者不能把自己降級，避免系統失去管理者
create or replace function public.protect_self_role()
returns trigger language plpgsql as $$
begin
  if old.user_id = auth.uid() and new.role <> 'admin' and old.role = 'admin' then
    raise exception '無法變更自己的管理者權限，請由另一位管理者操作';
  end if;
  return new;
end $$;
drop trigger if exists protect_self_role on public.staff_roles;
create trigger protect_self_role before update on public.staff_roles
  for each row execute function public.protect_self_role();

-- ---------------------------------------------------------------------
-- 4. 公開功能（未登入者可呼叫）
-- ---------------------------------------------------------------------
-- 線上報名
create or replace function public.register(
  p_name text, p_org text, p_title text, p_email text, p_phone text, p_consent boolean)
returns table (code text, token uuid)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  cfg jsonb := (select data->'registration' from public.site_content where id = 1);
  cap int := nullif(cfg->>'capacity', '')::int;
  r public.registrations;
begin
  if coalesce((cfg->>'open')::boolean, false) is not true then
    raise exception 'REG_CLOSED';
  end if;
  if p_consent is not true then raise exception 'NO_CONSENT'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_org), '') = '' or coalesce(trim(p_email), '') = '' then
    raise exception 'MISSING_FIELDS';
  end if;
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'BAD_EMAIL'; end if;
  if cap is not null and (select count(*) from public.registrations where source in ('online','import','manual')) >= cap then
    raise exception 'REG_FULL';
  end if;
  if exists (select 1 from public.registrations where lower(email) = lower(trim(p_email))) then
    raise exception 'DUP_EMAIL';
  end if;
  insert into public.registrations (name, org, title, email, phone, source, consent_at)
  values (trim(p_name), trim(p_org), nullif(trim(p_title), ''), lower(trim(p_email)),
          nullif(trim(p_phone), ''), 'online', now())
  returning * into r;
  return query select r.code, r.token;
end $$;

-- 以電子郵件與姓名查詢報到證
create or replace function public.find_ticket(p_email text, p_name text)
returns uuid language sql security definer set search_path = public as $$
  select token from public.registrations
  where lower(email) = lower(trim(p_email)) and name = trim(p_name)
  limit 1
$$;

-- 顯示報到證（需持有個人專屬連結）
create or replace function public.get_ticket(p_token uuid)
returns table (code text, name text, org text, title text, category text, checked_in_at timestamptz)
language sql security definer set search_path = public as $$
  select code, name, org, title, category, checked_in_at
  from public.registrations where token = p_token
$$;

-- 對外網站內容：未勾選「對外顯示邀請中貴賓」時，移除邀請中貴賓的姓名、職稱、簡介與照片
create or replace function public.public_site_content()
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when coalesce((data->'info'->>'showInvited')::boolean, false) then data
    else jsonb_set(data, '{people}', coalesce((
      select jsonb_agg(case when p->>'status' = 'confirmed' then p
        else jsonb_build_object('id', p->'id', 'status', p->'status', 'name', '', 'title', '', 'org', '', 'bio', '', 'photo', '') end)
      from jsonb_array_elements(coalesce(data->'people', '[]'::jsonb)) p), '[]'::jsonb))
  end
  from public.site_content where id = 1
$$;

-- 報名人數（公開顯示用，只回傳數字）
create or replace function public.registration_count()
returns int language sql security definer set search_path = public as $$
  select count(*)::int from public.registrations where source in ('online','import','manual')
$$;

-- ---------------------------------------------------------------------
-- 5. 報到功能（報到人員與管理者）
-- ---------------------------------------------------------------------
create or replace function public.check_in(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.registrations;
begin
  if public.my_role() not in ('checkin','admin') then raise exception 'NO_PERMISSION'; end if;
  select * into r from public.registrations where code = upper(trim(p_code)) for update;
  if not found then
    return jsonb_build_object('status','notfound','code',upper(trim(p_code)));
  end if;
  if r.checked_in_at is not null then
    return jsonb_build_object('status','dup','name',r.name,'org',r.org,'title',r.title,
      'category',r.category,'code',r.code,'checked_in_at',r.checked_in_at);
  end if;
  update public.registrations set checked_in_at = now(), checked_in_by = auth.uid()
  where id = r.id returning * into r;
  return jsonb_build_object('status','ok','name',r.name,'org',r.org,'title',r.title,
    'category',r.category,'code',r.code,'checked_in_at',r.checked_in_at);
end $$;

create or replace function public.undo_check_in(p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() not in ('checkin','admin') then raise exception 'NO_PERMISSION'; end if;
  update public.registrations set checked_in_at = null, checked_in_by = null
  where code = upper(trim(p_code));
end $$;

create or replace function public.walk_in(p_name text, p_org text, p_title text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.registrations;
begin
  if public.my_role() not in ('checkin','admin') then raise exception 'NO_PERMISSION'; end if;
  insert into public.registrations (name, org, title, source, checked_in_at, checked_in_by)
  values (trim(p_name), trim(p_org), nullif(trim(p_title), ''), 'walkin', now(), auth.uid())
  returning * into r;
  return jsonb_build_object('status','ok','name',r.name,'org',r.org,'title',r.title,
    'category',r.category,'code',r.code,'checked_in_at',r.checked_in_at);
end $$;

-- ---------------------------------------------------------------------
-- 6. 執行權限
-- ---------------------------------------------------------------------
revoke all on function public.register(text,text,text,text,text,boolean) from public;
revoke all on function public.find_ticket(text,text) from public;
revoke all on function public.get_ticket(uuid) from public;
revoke all on function public.registration_count() from public;
revoke all on function public.public_site_content() from public;
revoke all on function public.check_in(text) from public;
revoke all on function public.undo_check_in(text) from public;
revoke all on function public.walk_in(text,text,text) from public;
revoke all on function public.gen_code() from public;

grant execute on function public.register(text,text,text,text,text,boolean) to anon, authenticated;
grant execute on function public.find_ticket(text,text) to anon, authenticated;
grant execute on function public.get_ticket(uuid) to anon, authenticated;
grant execute on function public.registration_count() to anon, authenticated;
grant execute on function public.public_site_content() to anon, authenticated;
grant execute on function public.check_in(text) to authenticated;
grant execute on function public.undo_check_in(text) to authenticated;
grant execute on function public.walk_in(text,text,text) to authenticated;
grant execute on function public.gen_code() to authenticated;
grant execute on function public.my_role() to authenticated;

-- ---------------------------------------------------------------------
-- 7. 即時更新（報到統計即時刷新）
-- ---------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.registrations;
exception when duplicate_object then null; when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------
-- 8. Google 試算表同步（Apps Script 使用）
--    同步程式以「同步金鑰」取得資料；金鑰只存雜湊值，由管理者在後台產生。
-- ---------------------------------------------------------------------
create table if not exists public.sync_status (
  id int primary key default 1 check (id = 1),
  secret_hash text,
  secret_created_at timestamptz,
  last_sync_at timestamptz,
  last_count int,
  sheet_url text
);
insert into public.sync_status (id) values (1) on conflict (id) do nothing;
alter table public.sync_status enable row level security;
drop policy if exists sync_read on public.sync_status;
create policy sync_read on public.sync_status for select
  using (public.my_role() in ('viewer','checkin','admin'));

-- 產生新的同步金鑰（僅管理者；舊金鑰立即失效；明碼只回傳這一次）
create or replace function public.rotate_sync_secret()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare s text;
begin
  if public.my_role() <> 'admin' then raise exception 'NO_PERMISSION'; end if;
  s := 'sync_' || encode(gen_random_bytes(24), 'hex');
  update public.sync_status
     set secret_hash = encode(digest(s, 'sha256'), 'hex'), secret_created_at = now()
   where id = 1;
  return s;
end $$;

create or replace function public.sync_secret_ok(p_secret text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce(p_secret, '') <> ''
     and exists (select 1 from public.sync_status
                 where id = 1 and secret_hash = encode(digest(p_secret, 'sha256'), 'hex'))
$$;

-- 匯出報名資料給 Google 試算表
create or replace function public.export_registrations(p_secret text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.sync_secret_ok(p_secret) then raise exception 'BAD_SYNC_SECRET'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', code, 'name', name, 'org', org, 'title', title, 'email', email, 'phone', phone,
      'category', category, 'source', source, 'note', note,
      'created_at', created_at, 'consent_at', consent_at, 'checked_in_at', checked_in_at
    ) order by created_at)
    from public.registrations), '[]'::jsonb);
end $$;

-- 同步完成後回報（後台顯示最後同步時間與試算表連結）
create or replace function public.report_sync(p_secret text, p_count int, p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sync_secret_ok(p_secret) then raise exception 'BAD_SYNC_SECRET'; end if;
  update public.sync_status
     set last_sync_at = now(), last_count = p_count,
         sheet_url = case when p_url ~ '^https://docs\.google\.com/' then p_url else sheet_url end
   where id = 1;
end $$;

revoke all on function public.rotate_sync_secret() from public;
revoke all on function public.sync_secret_ok(text) from public;
revoke all on function public.export_registrations(text) from public;
revoke all on function public.report_sync(text,int,text) from public;
grant execute on function public.rotate_sync_secret() to authenticated;
grant execute on function public.export_registrations(text) to anon, authenticated;
grant execute on function public.report_sync(text,int,text) to anon, authenticated;

-- =====================================================================
-- 首次設定：以自己的電子郵件在後台申請帳號後，執行下列指令成為管理者
--   update public.staff_roles set role = 'admin' where email = '您的電子郵件';
-- =====================================================================
