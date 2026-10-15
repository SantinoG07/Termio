begin;
-- security_invoker hace que las vistas respeten RLS del usuario que consulta.
create view public.node_latest_records with (security_invoker = true) as
  select distinct on (environment, node_id) * from public.records
  where record_type in ('reading','state') and clock_synced
  order by environment, node_id, observed_at desc, ingest_sequence desc;

create view public.latest_alert_records with (security_invoker = true) as
  select distinct on (environment, data->>'alert_id') * from public.records
  where record_type = 'alert' and clock_synced
  order by environment, data->>'alert_id', observed_at desc, ingest_sequence desc;

revoke all on public.node_latest_records, public.latest_alert_records from anon, authenticated;
grant select on public.node_latest_records, public.latest_alert_records to authenticated;
commit;
