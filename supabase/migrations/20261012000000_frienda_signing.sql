create table if not exists public.signers (
  id text primary key check (id in ('dion', 'emily', 'ivan', 'amanda', 'juan', 'kathy')),
  name text not null,
  group_name text not null,
  signed_at timestamptz,
  method text check (method in ('email-link')),
  signature_points jsonb,
  last_invited_at timestamptz,
  constraint signers_signature_consistent check (
    (signed_at is null and method is null and signature_points is null)
    or (signed_at is not null and method = 'email-link' and jsonb_typeof(signature_points) = 'array')
  )
);

create table if not exists public.signing_invites (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  signer_id text not null references public.signers(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint signing_invites_expiry_after_creation check (expires_at > created_at)
);

alter table public.signers enable row level security;
alter table public.signing_invites enable row level security;
revoke all on table public.signers, public.signing_invites from public, anon, authenticated;
grant select on table public.signers to service_role;

insert into public.signers (id, name, group_name) values
  ('dion', 'Dion Almaer', 'Dion and Emily Almaer'),
  ('emily', 'Emily Almaer', 'Dion and Emily Almaer'),
  ('ivan', 'Ivan Dufresne Lee', 'Ivan and Amanda Dufresne Lee'),
  ('amanda', 'Amanda Dufresne Lee', 'Ivan and Amanda Dufresne Lee'),
  ('juan', 'Juan Batlle', 'Juan and Kathy Batlle'),
  ('kathy', 'Kathy Batlle', 'Juan and Kathy Batlle')
on conflict (id) do update set
  name = excluded.name,
  group_name = excluded.group_name;

create or replace function public.issue_signing_invite(
  p_signer_id text,
  p_token_hash text,
  p_expires_at timestamptz
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_signer_id text;
begin
  update public.signers
     set last_invited_at = pg_catalog.clock_timestamp()
   where id = p_signer_id
     and signed_at is null
     and (last_invited_at is null or last_invited_at <= pg_catalog.clock_timestamp() - interval '1 minute')
  returning id into v_signer_id;

  if v_signer_id is null then
    if exists (select 1 from public.signers where id = p_signer_id and signed_at is not null) then
      return 'signed';
    end if;
    return 'rate-limited';
  end if;

  update public.signing_invites
     set used_at = pg_catalog.clock_timestamp()
   where signer_id = v_signer_id and used_at is null;

  delete from public.signing_invites
   where signer_id = v_signer_id
     and used_at < pg_catalog.clock_timestamp() - interval '30 days';

  insert into public.signing_invites (token_hash, signer_id, expires_at)
  values (p_token_hash, v_signer_id, p_expires_at);
  return 'created';
end;
$$;

create or replace function public.confirm_email_signing(
  p_token_hash text,
  p_signature_points jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_signer_id text;
  v_signed_at timestamptz;
  v_claimed_signer_id text;
begin
  select signer_id into v_signer_id
    from public.signing_invites
   where token_hash = p_token_hash;

  if v_signer_id is null then
    return null;
  end if;

  select signed_at into v_signed_at
    from public.signers
   where id = v_signer_id
   for update;

  if v_signed_at is not null then
    return null;
  end if;

  update public.signing_invites
     set used_at = pg_catalog.clock_timestamp()
   where token_hash = p_token_hash
     and signer_id = v_signer_id
     and used_at is null
     and expires_at > pg_catalog.clock_timestamp()
  returning signer_id into v_claimed_signer_id;

  if v_claimed_signer_id is null then
    return null;
  end if;

  update public.signers
     set signed_at = pg_catalog.clock_timestamp(),
         method = 'email-link',
         signature_points = p_signature_points
   where id = v_signer_id;

  update public.signing_invites
     set used_at = pg_catalog.clock_timestamp()
   where signer_id = v_signer_id and used_at is null;

  return v_signer_id;
end;
$$;

revoke all on function public.issue_signing_invite(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.confirm_email_signing(text, jsonb) from public, anon, authenticated;
grant execute on function public.issue_signing_invite(text, text, timestamptz) to service_role;
grant execute on function public.confirm_email_signing(text, jsonb) to service_role;
