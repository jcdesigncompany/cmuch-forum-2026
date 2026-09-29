-- =====================================================================
-- 報名表新增「交通需求調查」（自行開車／搭乘高鐵／其他）
-- 於 Supabase → SQL Editor 貼上全部內容後按 Run，執行一次即可（可重複執行）。
-- 執行前，網站仍可正常報名（不會存入交通資料）；執行後即開始記錄。
-- =====================================================================
alter table public.registrations add column if not exists notified_at timestamptz;
-- 交通需求（2026/09/30 新增）
alter table public.registrations add column if not exists transport text check (transport in ('car','hsr','other'));
alter table public.registrations add column if not exists car_plate text check (char_length(car_plate) <= 12);
alter table public.registrations add column if not exists hsr_from text check (char_length(hsr_from) <= 10);
alter table public.registrations add column if not exists hsr_arrive text check (hsr_arrive in ('before11','1100-1130','1130-1200','after12'));
alter table public.registrations add column if not exists shuttle_to boolean not null default false;
alter table public.registrations add column if not exists shuttle_back boolean not null default false;

drop function if exists public.register(text,text,text,text,text,text,text,boolean,text,boolean);
create or replace function public.register(
  p_name text, p_org text, p_dept text, p_title text, p_phone text, p_email text,
  p_meal text, p_need_credit boolean, p_id_number text, p_consent boolean,
  p_transport text default null, p_car_plate text default null, p_hsr_from text default null,
  p_hsr_arrive text default null, p_shuttle_to boolean default false, p_shuttle_back boolean default false)
returns table (code text, token uuid)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  cfg jsonb := (select data->'registration' from public.site_content where id = 1);
  cap int := nullif(cfg->>'capacity', '')::int;
  v_phone text := trim(coalesce(p_phone, ''));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_id text := upper(trim(coalesce(p_id_number, '')));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_plate text := upper(regexp_replace(coalesce(p_car_plate, ''), '\s', '', 'g'));
  v_to boolean := p_transport = 'hsr' and coalesce(p_shuttle_to, false);
  v_back boolean := p_transport = 'hsr' and coalesce(p_shuttle_back, false);
  r public.registrations;
begin
  if coalesce((cfg->>'open')::boolean, false) is not true then raise exception 'REG_CLOSED'; end if;
  if p_consent is not true then raise exception 'NO_CONSENT'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_org), '') = '' or v_phone = '' or v_email = '' or coalesce(p_meal, '') = '' then
    raise exception 'MISSING_FIELDS';
  end if;
  if p_meal not in ('meat','veg') then raise exception 'MISSING_FIELDS'; end if;
  if length(v_digits) < 8 or length(v_digits) > 15 or v_phone !~ '^[0-9+()# -]+$' then raise exception 'BAD_PHONE'; end if;
  if coalesce(p_transport, '') not in ('car','hsr','other') then raise exception 'MISSING_FIELDS'; end if;
  if p_transport = 'car' and v_plate !~ '^[A-Z0-9]{2,4}-?[A-Z0-9]{2,4}$' then raise exception 'BAD_PLATE'; end if;
  if p_transport = 'hsr' and coalesce(p_hsr_from, '') not in ('南港','台北','板橋','桃園','新竹','苗栗','彰化','雲林','嘉義','台南','左營') then raise exception 'MISSING_FIELDS'; end if;
  if v_to and coalesce(p_hsr_arrive, '') not in ('before11','1100-1130','1130-1200','after12') then raise exception 'MISSING_FIELDS'; end if;
  if length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'BAD_EMAIL'; end if;
  if p_need_credit is true and not public.valid_tw_id(v_id) then raise exception 'BAD_ID'; end if;
  if cap is not null and (select count(*) from public.registrations where source in ('online','import','manual')) >= cap then
    raise exception 'REG_FULL';
  end if;
  if p_need_credit is true and exists (select 1 from public.registration_private
       where id_hash = encode(digest(v_id, 'sha256'), 'hex')) then
    raise exception 'DUP_ID';
  end if;
  if exists (select 1 from public.registrations where lower(email) = v_email) then
    raise exception 'DUP_EMAIL';
  end if;
  if exists (select 1 from public.registrations
       where name = trim(p_name) and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_digits) then
    raise exception 'DUP_PHONE';
  end if;
  insert into public.registrations (name, org, dept, title, phone, email, meal, need_credit, source, consent_at,
                                    transport, car_plate, hsr_from, hsr_arrive, shuttle_to, shuttle_back)
  values (trim(p_name), trim(p_org), nullif(trim(coalesce(p_dept, '')), ''), nullif(trim(coalesce(p_title, '')), ''),
          v_phone, v_email, p_meal, coalesce(p_need_credit, false), 'online', now(),
          p_transport, case when p_transport = 'car' then v_plate end, case when p_transport = 'hsr' then p_hsr_from end,
          case when v_to then p_hsr_arrive end, v_to, v_back)
  returning * into r;
  if p_need_credit is true then
    insert into public.registration_private (registration_id, id_number, id_hash) values (r.id, v_id, '');
  end if;
  return query select r.code, r.token;
end $$;

revoke all on function public.register(text,text,text,text,text,text,text,boolean,text,boolean,text,text,text,text,boolean,boolean) from public;
grant execute on function public.register(text,text,text,text,text,text,text,boolean,text,boolean,text,text,text,text,boolean,boolean) to anon, authenticated;

-- 匯出報名資料給 Google 試算表
create or replace function public.export_registrations(p_secret text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.sync_secret_ok(p_secret) then raise exception 'BAD_SYNC_SECRET'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', code, 'name', name, 'org', org, 'dept', dept, 'title', title, 'email', email, 'phone', phone,
      'category', category, 'source', source, 'note', note, 'meal', meal,
      'need_credit', need_credit, 'id_masked', id_masked,
      'created_at', created_at, 'consent_at', consent_at, 'checked_in_at', checked_in_at, 'notified_at', notified_at,
      'transport', transport, 'car_plate', car_plate, 'hsr_from', hsr_from, 'hsr_arrive', hsr_arrive,
      'shuttle_to', shuttle_to, 'shuttle_back', shuttle_back
    ) order by created_at)
    from public.registrations), '[]'::jsonb);
end $$;

-- 報名成功通知信：待寄清單與寄出回報（Apps Script 以同步金鑰呼叫）
create or replace function public.pending_notifications(p_secret text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.sync_secret_ok(p_secret) then raise exception 'BAD_SYNC_SECRET'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', code, 'token', token, 'name', name, 'title', title, 'org', org, 'email', email,
      'transport', transport, 'car_plate', car_plate, 'hsr_from', hsr_from, 'hsr_arrive', hsr_arrive, 'shuttle_to', shuttle_to, 'shuttle_back', shuttle_back) order by created_at)
    from (select * from public.registrations
           where source = 'online' and notified_at is null and coalesce(email, '') <> ''
           order by created_at limit 50) x), '[]'::jsonb);
end $$;

revoke all on function public.pending_notifications(text) from public;
grant execute on function public.pending_notifications(text) to anon, authenticated;
