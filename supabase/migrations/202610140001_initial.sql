-- Termio / Grupo 6. Aplicar con Supabase CLI. No contiene credenciales.
begin;

create table public.workspace_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create function public.is_workspace_member() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.workspace_members where user_id = (select auth.uid())); $$;
revoke all on function public.is_workspace_member() from public;
grant execute on function public.is_workspace_member() to authenticated;

create table public.nodes (
  node_id text primary key check (node_id ~ '^[a-z][a-z0-9_]{2,63}$'),
  group_number smallint not null check (group_number between 1 and 6),
  subsystem text not null,
  expected_interval_seconds integer not null default 10 check (expected_interval_seconds between 1 and 86400),
  enabled boolean not null default true,
  -- Catálogo de unidades. Nuevas variables numéricas requieren acuerdo y alta aquí.
  variable_units jsonb not null default '{}'::jsonb check (jsonb_typeof(variable_units) = 'object'),
  created_at timestamptz not null default now()
);

create table public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  group_number smallint not null check (group_number between 1 and 6),
  key_hash text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),
  label text not null,
  allowed_environments text[] not null default array['test']::text[]
    check (cardinality(allowed_environments) > 0 and allowed_environments <@ array['test','operational']::text[]),
  revoked_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

create table public.records (
  ingest_sequence bigint generated always as identity unique,
  record_id uuid primary key,
  schema_version text not null check (schema_version = '1.0.0'),
  record_type text not null check (record_type in ('reading','state','event','alert','confirmation')),
  node_id text not null references public.nodes(node_id),
  group_number smallint not null check (group_number between 1 and 6),
  subsystem text not null,
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  status text not null check (status in ('active','offline','error')),
  alert_level text not null check (alert_level in ('normal','low','medium','high','critical')),
  environment text not null check (environment in ('test','operational')),
  source_type text not null check (source_type in ('real','simulated','mixed')),
  clock_synced boolean not null,
  alert_evaluated boolean not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  metadata jsonb not null check (jsonb_typeof(metadata) = 'object'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object')
);
create index records_node_time on public.records(environment, node_id, observed_at desc);
create index records_environment_sequence on public.records(environment, ingest_sequence desc);
create index records_alert_time on public.records(environment, observed_at desc) where record_type = 'alert';

alter table public.workspace_members enable row level security;
alter table public.nodes enable row level security;
alter table public.records enable row level security;
alter table public.integration_credentials enable row level security;

revoke all on public.workspace_members, public.nodes, public.records, public.integration_credentials from anon, authenticated;
grant select on public.workspace_members, public.nodes, public.records to authenticated;
create policy own_membership on public.workspace_members for select to authenticated using (user_id = (select auth.uid()));
create policy members_read_nodes on public.nodes for select to authenticated using ((select public.is_workspace_member()));
create policy members_read_records on public.records for select to authenticated using ((select public.is_workspace_member()));
-- No hay políticas INSERT/UPDATE/DELETE para clientes. Credenciales sin acceso de cliente.

-- Solo service_role puede invocar esta transacción; la Edge Function autentica y valida antes.
create function public.ingest_record(p_payload jsonb, p_key_hash text) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  credential public.integration_credentials%rowtype;
  node public.nodes%rowtype;
  existing_payload jsonb;
  created_id uuid;
  item record;
begin
  select * into credential from public.integration_credentials
    where key_hash = p_key_hash and revoked_at is null and expires_at > now();
  if not found then raise exception 'INVALID_CREDENTIAL'; end if;
  if (p_payload->>'group')::integer <> credential.group_number
    or not ((p_payload->'metadata'->>'environment') = any(credential.allowed_environments)) then
    raise exception 'FORBIDDEN_PRODUCER';
  end if;
  select * into node from public.nodes where node_id = p_payload->>'node_id' and enabled;
  if not found then raise exception 'UNKNOWN_NODE'; end if;
  if node.group_number <> credential.group_number or node.subsystem <> p_payload->>'subsystem' then
    raise exception 'NODE_MISMATCH';
  end if;
  if (p_payload->>'timestamp')::timestamptz > now() + interval '5 minutes' then
    raise exception 'FUTURE_TIMESTAMP';
  end if;
  for item in select key, value from jsonb_each(p_payload->'data') loop
    if jsonb_typeof(item.value) = 'number' then
      if not (node.variable_units ? item.key)
        or (p_payload->'metadata'->'units'->>item.key) is distinct from (node.variable_units->>item.key) then
        raise exception 'UNIT_MISMATCH:%', item.key;
      end if;
    end if;
  end loop;
  if (p_payload->>'record_type') in ('alert','confirmation') and credential.group_number <> 5 then
    raise exception 'ALERT_PRODUCER_REQUIRED';
  end if;

  insert into public.records (
    record_id, schema_version, record_type, node_id, group_number, subsystem,
    observed_at, status, alert_level, environment, source_type, clock_synced,
    alert_evaluated, data, metadata, payload
  ) values (
    (p_payload->>'record_id')::uuid, p_payload->>'schema_version', p_payload->>'record_type',
    node.node_id, credential.group_number, node.subsystem,
    (p_payload->>'timestamp')::timestamptz, p_payload->>'status', p_payload->>'alert_level',
    p_payload->'metadata'->>'environment', p_payload->'metadata'->>'source_type',
    (p_payload->'metadata'->>'clock_synced')::boolean,
    (p_payload->'metadata'->>'alert_evaluated')::boolean,
    p_payload->'data', p_payload->'metadata', p_payload
  ) on conflict (record_id) do nothing returning record_id into created_id;

  if created_id is null then
    select payload into existing_payload from public.records where record_id = (p_payload->>'record_id')::uuid;
    if existing_payload is distinct from p_payload then raise exception 'RECORD_CONFLICT'; end if;
    return jsonb_build_object('record_id', p_payload->>'record_id', 'duplicate', true);
  end if;
  return jsonb_build_object('record_id', created_id, 'duplicate', false);
end;
$$;
revoke all on function public.ingest_record(jsonb,text) from public, anon, authenticated;
grant execute on function public.ingest_record(jsonb,text) to service_role;
grant all on public.nodes, public.records, public.workspace_members, public.integration_credentials to service_role;
grant usage, select on sequence public.records_ingest_sequence_seq to service_role;

insert into public.nodes (node_id, group_number, subsystem, variable_units) values
('fire_node_01',1,'Monitoreo de incendios forestales','{"temperature":"degC","humidity":"%","wind_speed":"m/s","smoke_level":"adc_count"}'),
('volcanic_node_01',2,'Nodo volcánico y calidad ambiental','{"temperature":"degC","humidity":"%","pm2_5":"ug/m3","pm10":"ug/m3","so2_concentration":"ppm","co2_concentration":"ppm"}'),
('energy_node_01',3,'Sistema energético autónomo','{"voltage":"V","current":"A","generation_power":"W","consumption_power":"W","stored_energy":"Wh","battery_level":"%"}'),
('water_node_01',4,'Administración inteligente de agua','{"water_level":"%","water_volume":"L","flow_rate":"L/min","water_temperature":"degC"}'),
('alert_node_01',5,'Comunicaciones y alertas de emergencia','{}'),
('monitoring_center',6,'Centro de monitoreo e integración','{"connected_nodes":"count","total_nodes":"count"}');

commit;
