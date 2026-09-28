-- =====================================================================
-- 報名表新增「電子郵件」欄位（必填）
-- 於 Supabase → SQL Editor 貼上全部內容後按 Run，執行一次即可。
-- 資料表原本已有 email 欄位，本檔只更新報名函式。
-- =====================================================================
drop function if exists public.register(text,text,text,text,text,text,boolean,text,boolean);
create or replace function public.register(
  p_name text, p_org text, p_dept text, p_title text, p_phone text, p_email text,
  p_meal text, p_need_credit boolean, p_id_number text, p_consent boolean)
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
  r public.registrations;
begin
  if coalesce((cfg->>'open')::boolean, false) is not true then raise exception 'REG_CLOSED'; end if;
  if p_consent is not true then raise exception 'NO_CONSENT'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_org), '') = '' or v_phone = '' or v_email = '' or coalesce(p_meal, '') = '' then
    raise exception 'MISSING_FIELDS';
  end if;
  if p_meal not in ('meat','veg') then raise exception 'MISSING_FIELDS'; end if;
  if length(v_digits) < 8 or length(v_digits) > 15 or v_phone !~ '^[0-9+()# -]+$' then raise exception 'BAD_PHONE'; end if;
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
  insert into public.registrations (name, org, dept, title, phone, email, meal, need_credit, source, consent_at)
  values (trim(p_name), trim(p_org), nullif(trim(coalesce(p_dept, '')), ''), nullif(trim(coalesce(p_title, '')), ''),
          v_phone, v_email, p_meal, coalesce(p_need_credit, false), 'online', now())
  returning * into r;
  if p_need_credit is true then
    insert into public.registration_private (registration_id, id_number, id_hash) values (r.id, v_id, '');
  end if;
  return query select r.code, r.token;
end $$;

revoke all on function public.register(text,text,text,text,text,text,text,boolean,text,boolean) from public;
grant execute on function public.register(text,text,text,text,text,text,text,boolean,text,boolean) to anon, authenticated;
