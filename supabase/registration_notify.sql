-- =====================================================================
-- 報名成功通知信（含報到 QR code）
-- 於 Supabase → SQL Editor 貼上全部內容後按 Run，執行一次即可。
-- 寄信由 Google 試算表的 Apps Script 負責；本檔新增寄出紀錄欄位與兩個函式。
-- =====================================================================
alter table public.registrations add column if not exists notified_at timestamptz;

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
      'created_at', created_at, 'consent_at', consent_at, 'checked_in_at', checked_in_at, 'notified_at', notified_at
    ) order by created_at)
    from public.registrations), '[]'::jsonb);
end $$;

-- 報名成功通知信：待寄清單與寄出回報（Apps Script 以同步金鑰呼叫）
create or replace function public.pending_notifications(p_secret text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.sync_secret_ok(p_secret) then raise exception 'BAD_SYNC_SECRET'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', code, 'token', token, 'name', name, 'org', org, 'email', email) order by created_at)
    from (select * from public.registrations
           where source = 'online' and notified_at is null and coalesce(email, '') <> ''
           order by created_at limit 50) x), '[]'::jsonb);
end $$;

create or replace function public.mark_notified(p_secret text, p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sync_secret_ok(p_secret) then raise exception 'BAD_SYNC_SECRET'; end if;
  update public.registrations set notified_at = now() where code = upper(trim(p_code)) and notified_at is null;
end $$;

revoke all on function public.pending_notifications(text) from public;
revoke all on function public.mark_notified(text,text) from public;
grant execute on function public.pending_notifications(text) to anon, authenticated;
grant execute on function public.mark_notified(text,text) to anon, authenticated;
