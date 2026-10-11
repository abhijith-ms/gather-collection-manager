create sequence public.contributor_code_seq;
create sequence public.receipt_ref_seq;

create table public.organization_settings (
  id boolean primary key default true check (id),
  name text not null default 'Community Collective',
  contact text not null default '',
  logo_path text
);
insert into public.organization_settings(id) values (true);

create table public.profiles (
  id uuid primary key references auth.users(id),
  username text not null unique check (username ~ '^[a-z0-9-]{3,40}$'),
  full_name text not null check (length(full_name) between 1 and 120),
  role text not null check (role in ('admin','collector')),
  active boolean not null default true,
  must_change_password boolean not null default true,
  session_valid_after timestamptz not null default '1970-01-01T00:00:00Z',
  created_at timestamptz not null default now()
);
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  description text not null default '' check (length(description) <= 500),
  default_target_paise bigint not null check (default_target_paise between 1 and 1000000000000),
  status text not null default 'active' check (status in ('draft','active','closed')),
  deadline date,
  created_at timestamptz not null default now()
);
create table public.campaign_collectors (
  campaign_id uuid references public.campaigns(id),
  collector_id uuid references public.profiles(id),
  primary key(campaign_id, collector_id)
);
create table public.contributors (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  code text not null default ('P-' || lpad(nextval('public.contributor_code_seq')::text,5,'0')),
  name text not null check (length(name) between 1 and 120),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  target_paise bigint not null check (target_paise between 1 and 1000000000000),
  collector_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(campaign_id, code)
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  contributor_id uuid not null references public.contributors(id),
  collector_id uuid not null references public.profiles(id),
  recorded_by uuid not null references public.profiles(id),
  amount_paise bigint not null check (amount_paise between 1 and 1000000000000),
  method text not null check (method in ('cash','upi')),
  upi_reference text not null default '' check (length(upi_reference) <= 100),
  note text not null default '' check (length(note) <= 500),
  paid_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  receipt_ref text not null unique,
  receipt jsonb not null,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text,
  replacement_of uuid unique references public.payments(id)
);
create index on public.contributors(campaign_id, collector_id);
create index on public.payments(contributor_id);
create index on public.payments(campaign_id, collector_id);
create table public.handovers (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  collector_id uuid not null references public.profiles(id),
  amount_paise bigint not null check (amount_paise between 1 and 1000000000000),
  method text not null check (method in ('cash','upi')),
  reference text not null default '' check (length(reference) <= 100),
  note text not null default '' check (length(note) <= 500),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected','cancelled','void')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reason text
);
create index on public.handovers(campaign_id, collector_id);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  campaign_id uuid references public.campaigns(id),
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table public.command_requests (
  actor_id uuid references public.profiles(id),
  key uuid,
  action text not null,
  payload jsonb not null,
  result jsonb not null,
  primary key(actor_id,key)
);

create function public.app_ready() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p join auth.sessions s on s.user_id=p.id
    where p.id=auth.uid() and p.active and not p.must_change_password
    and s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.created_at>p.session_valid_after)
$$;
create function public.app_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select public.app_ready() and exists(select 1 from public.profiles where id=auth.uid() and role='admin')
$$;
create function public.app_profile() returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(p) from public.profiles p where id=auth.uid()
$$;
create function public.app_can_see_campaign(cid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.app_ready() and (public.app_is_admin()
    or exists(select 1 from public.campaign_collectors where campaign_id=cid and collector_id=auth.uid())
    or exists(select 1 from public.payments where campaign_id=cid and collector_id=auth.uid()))
$$;
create function public.app_can_see_contributor(pid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.app_ready() and (public.app_is_admin()
    or exists(select 1 from public.contributors where id=pid and collector_id=auth.uid()))
$$;

alter table public.organization_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_collectors enable row level security;
alter table public.contributors enable row level security;
alter table public.payments enable row level security;
alter table public.handovers enable row level security;
alter table public.audit_events enable row level security;
alter table public.command_requests enable row level security;
create policy read_settings on public.organization_settings for select to authenticated using (public.app_ready());
create policy read_profiles on public.profiles for select to authenticated using (id=auth.uid() or public.app_is_admin());
create policy read_campaigns on public.campaigns for select to authenticated using (public.app_can_see_campaign(id));
create policy read_assignments on public.campaign_collectors for select to authenticated using (public.app_ready() and (public.app_is_admin() or collector_id=auth.uid()));
create policy read_contributors on public.contributors for select to authenticated using (public.app_can_see_contributor(id));
create policy read_payments on public.payments for select to authenticated using (public.app_ready() and (public.app_is_admin() or collector_id=auth.uid() or public.app_can_see_contributor(contributor_id)));
create policy read_handovers on public.handovers for select to authenticated using (public.app_ready() and (public.app_is_admin() or collector_id=auth.uid()));
create policy read_audit on public.audit_events for select to authenticated using (public.app_is_admin());

create function public.internal_audit(actor uuid, cid uuid, entity uuid, event text, data jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_events(actor_id,campaign_id,entity_id,action,details) values(actor,cid,entity,event,data)
$$;

create function public.internal_save_contributor(q jsonb, actor uuid, admin boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.campaigns; old public.contributors; saved public.contributors;
  holder uuid; nm text; ph text; target bigint;
begin
  select * into c from public.campaigns where id=(q->>'campaign_id')::uuid;
  if c.id is null or c.status='closed' then raise exception 'Select an open campaign'; end if;
  if q->>'id' is not null then
    select * into old from public.contributors where id=(q->>'id')::uuid and campaign_id=c.id;
    if old.id is null then raise exception 'Contributor not found in this campaign'; end if;
  elsif nullif(q->>'code','') is not null then
    select * into old from public.contributors where code=q->>'code' and campaign_id=c.id;
    if old.id is null then raise exception 'Unknown contributor code: %',q->>'code'; end if;
  end if;
  if not admin and old.id is not null and old.collector_id<>actor then raise exception 'Contributor is not assigned to you'; end if;
  holder := case when admin then coalesce(nullif(q->>'collector_id','')::uuid,old.collector_id) else actor end;
  if not exists(select 1 from public.campaign_collectors cc join public.profiles p on p.id=cc.collector_id
    where cc.campaign_id=c.id and cc.collector_id=holder and p.role='collector' and p.active)
    then raise exception 'Choose an active collector assigned to this campaign'; end if;
  if not admin and nullif(q->>'collector_id','') is not null and (q->>'collector_id')::uuid<>actor
    then raise exception 'You can only import your own list'; end if;
  nm := btrim(q->>'name');
  ph := regexp_replace(coalesce(q->>'phone',''),'[\s()-]','','g');
  if ph ~ '^[0-9]{10}$' then ph := '+91'||ph; end if;
  target := coalesce(nullif(q->>'target_paise','')::bigint, c.default_target_paise);
  if nm is null or length(nm) not between 1 and 120 then raise exception 'Name must contain 1–120 characters'; end if;
  if ph !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Enter a valid phone number with country code'; end if;
  if target not between 1 and 1000000000000 then raise exception 'Target must be a positive amount'; end if;
  if exists(select 1 from public.contributors where campaign_id=c.id and lower(name)=lower(nm) and phone=ph and id<>coalesce(old.id,'00000000-0000-0000-0000-000000000000'::uuid))
    then raise exception 'Duplicate name and phone; use the existing contributor code'; end if;
  if old.id is null then
    insert into public.contributors(campaign_id,name,phone,target_paise,collector_id) values(c.id,nm,ph,target,holder) returning * into saved;
  else
    update public.contributors set name=nm,phone=ph,target_paise=target,collector_id=holder where id=old.id returning * into saved;
  end if;
  perform public.internal_audit(actor,c.id,saved.id,case when old.id is null then 'contributor.created' else 'contributor.updated' end,
    jsonb_build_object('before',case when old.id is null then null else to_jsonb(old) end,'after',to_jsonb(saved)));
  return to_jsonb(saved);
end $$;

create function public.internal_record_payment(q jsonb, holder uuid, actor uuid, replacing uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  person public.contributors; campaign public.campaigns; org public.organization_settings; owner public.profiles;
  saved public.payments; amount bigint; total bigint; ref text; moment timestamptz; snap jsonb;
begin
  select * into person from public.contributors where id=(q->>'contributor_id')::uuid;
  select * into campaign from public.campaigns where id=person.campaign_id;
  if person.id is null then raise exception 'Contributor not found'; end if;
  if campaign.status<>'active' and replacing is null then raise exception 'Payments require an active campaign'; end if;
  amount := (q->>'amount_paise')::bigint;
  if amount is null or amount not between 1 and 1000000000000 then raise exception 'Enter a positive payment amount'; end if;
  if coalesce(q->>'method','') not in ('cash','upi') then raise exception 'Choose cash or UPI'; end if;
  moment := coalesce(nullif(q->>'paid_at','')::timestamptz, now());
  if moment>now()+interval '5 minutes' then raise exception 'Payment date cannot be in the future'; end if;
  select * into org from public.organization_settings;
  select * into owner from public.profiles where id=holder;
  select coalesce(sum(amount_paise),0)+amount into total from public.payments where contributor_id=person.id and voided_at is null;
  ref := 'RCPT-'||lpad(nextval('public.receipt_ref_seq')::text,6,'0');
  snap := jsonb_build_object('template_version',1,'organization',org.name,'contact',org.contact,'logo_path',org.logo_path,
    'campaign',campaign.name,'contributor',person.name,'phone',person.phone,'contributor_code',person.code,'collector',owner.full_name,
    'receipt_ref',ref,'paid_at',moment,'method',q->>'method','upi_reference',coalesce(q->>'upi_reference',''),
    'amount_paise',amount,'total_paise',total,'target_paise',person.target_paise,
    'remaining_paise',greatest(person.target_paise-total,0),'extra_paise',greatest(total-person.target_paise,0));
  insert into public.payments(campaign_id,contributor_id,collector_id,recorded_by,amount_paise,method,upi_reference,note,paid_at,receipt_ref,receipt,replacement_of)
    values(person.campaign_id,person.id,holder,actor,amount,q->>'method',coalesce(q->>'upi_reference',''),coalesce(q->>'note',''),moment,ref,snap,replacing) returning * into saved;
  perform public.internal_audit(actor,person.campaign_id,saved.id,'payment.recorded',jsonb_build_object('reference',ref,'amount_paise',amount,'collector_id',holder));
  return to_jsonb(saved);
end $$;

create function public.app_command(action text, payload jsonb, key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles; cached public.command_requests; cid uuid; result jsonb; row jsonb;
  admin boolean; person public.contributors; pay public.payments; hand public.handovers; camp public.campaigns;
  amount bigint; available bigint; v_reason text; newstatus text;
begin
  select * into actor from public.profiles where id=auth.uid();
  if actor.id is null or not actor.active then raise exception 'Account is disabled or unavailable'; end if;
  if actor.must_change_password then raise exception 'Change your temporary password first'; end if;
  if not public.app_ready() then raise exception 'Please sign in again'; end if;
  if key is null or payload is null then raise exception 'A request key and payload are required'; end if;
  admin := actor.role='admin';
  perform pg_advisory_xact_lock(hashtext(actor.id::text||key::text));
  select * into cached from public.command_requests r where r.actor_id=actor.id and r.key=app_command.key;
  if cached.key is not null then
    if cached.action<>action or cached.payload<>payload then raise exception 'Request key already used for a different action'; end if;
    return cached.result;
  end if;
  cid := nullif(payload->>'campaign_id','')::uuid;
  if action like 'payment.%' then
    if action='payment.record' then select campaign_id into cid from public.contributors where id=(payload->>'contributor_id')::uuid;
    else select campaign_id into cid from public.payments where id=(payload->>'id')::uuid; end if;
  elsif action='handover.review' then select campaign_id into cid from public.handovers where id=(payload->>'id')::uuid;
  elsif action='campaign.save' then cid := nullif(payload->>'id','')::uuid;
  end if;
  -- Serialize each campaign's ledger and list changes so balances and import previews cannot race commits.
  if cid is not null then perform pg_advisory_xact_lock(hashtext('campaign:'||cid::text)); end if;
  case action
  when 'collector.status' then
    if not admin then raise exception 'Admin access required'; end if;
    if not exists(select 1 from public.profiles where id=(payload->>'id')::uuid and role='collector') then raise exception 'Collector not found'; end if;
    update public.profiles set active=(payload->>'active')::boolean,
      session_valid_after=case when (payload->>'active')::boolean then session_valid_after else now() end
      where id=(payload->>'id')::uuid;
    result := jsonb_build_object('saved',true);
    perform public.internal_audit(actor.id,null,(payload->>'id')::uuid,action,payload);
  when 'collector.password_reset' then
    if not admin then raise exception 'Admin access required'; end if;
    if not exists(select 1 from public.profiles where id=(payload->>'id')::uuid and role='collector') then raise exception 'Collector not found'; end if;
    update public.profiles set must_change_password=true,session_valid_after=now() where id=(payload->>'id')::uuid;
    result := jsonb_build_object('saved',true);
    perform public.internal_audit(actor.id,null,(payload->>'id')::uuid,action,jsonb_build_object('username',(select username from public.profiles where id=(payload->>'id')::uuid)));
  when 'settings.save' then
    if not admin then raise exception 'Admin access required'; end if;
    if length(btrim(coalesce(payload->>'name',''))) not between 1 and 120 or length(coalesce(payload->>'contact',''))>200 then raise exception 'Check organization name and contact'; end if;
    update public.organization_settings set name=btrim(payload->>'name'),contact=coalesce(payload->>'contact',''),logo_path=coalesce(nullif(payload->>'logo_path',''),logo_path);
    result := jsonb_build_object('saved',true);
    perform public.internal_audit(actor.id,null,null,action,payload);
  when 'campaign.save' then
    if not admin then raise exception 'Admin access required'; end if;
    if cid is null then
      insert into public.campaigns(name,description,default_target_paise,status,deadline)
        values(btrim(payload->>'name'),coalesce(payload->>'description',''),(payload->>'default_target_paise')::bigint,coalesce(payload->>'status','active'),nullif(payload->>'deadline','')::date) returning * into camp;
    else
      update public.campaigns set name=btrim(payload->>'name'),description=coalesce(payload->>'description',''),default_target_paise=(payload->>'default_target_paise')::bigint,status=payload->>'status',deadline=nullif(payload->>'deadline','')::date where id=cid returning * into camp;
      if camp.id is null then raise exception 'Campaign not found'; end if;
    end if;
    if payload ? 'collector_ids' then
      for row in select value from jsonb_array_elements(payload->'collector_ids') loop
        if not exists(select 1 from public.profiles where id=(row#>>'{}')::uuid and role='collector' and active) then raise exception 'Invalid collector'; end if;
        insert into public.campaign_collectors values(camp.id,(row#>>'{}')::uuid) on conflict do nothing;
      end loop;
    end if;
    result := to_jsonb(camp);
    perform public.internal_audit(actor.id,camp.id,camp.id,action,payload);
  when 'contributor.save' then
    result := public.internal_save_contributor(payload,actor.id,admin);
  when 'contributors.import' then
    if jsonb_typeof(payload->'rows')<>'array' or jsonb_array_length(payload->'rows') not between 1 and 1000 then raise exception 'Import 1–1,000 rows at a time'; end if;
    for row in select value from jsonb_array_elements(payload->'rows') loop
      perform public.internal_save_contributor(row||jsonb_build_object('campaign_id',cid),actor.id,admin);
    end loop;
    result := jsonb_build_object('count',jsonb_array_length(payload->'rows'));
  when 'payment.record' then
    select * into person from public.contributors where id=(payload->>'contributor_id')::uuid;
    if person.id is null or (not admin and person.collector_id<>actor.id) then raise exception 'Contributor is not assigned to you'; end if;
    if not exists(select 1 from public.profiles where id=person.collector_id and active) then raise exception 'Assigned collector is disabled'; end if;
    result := public.internal_record_payment(payload,person.collector_id,actor.id);
  when 'payment.correct' then
    if not admin then raise exception 'Only admin can correct saved payments'; end if;
    v_reason := btrim(payload->>'reason');
    if v_reason is null or length(v_reason) not between 3 and 500 then raise exception 'Enter a correction reason (3–500 characters)'; end if;
    select * into pay from public.payments where id=(payload->>'id')::uuid;
    if pay.id is null or pay.voided_at is not null then raise exception 'Payment not found or already void'; end if;
    update public.payments set voided_at=now(),voided_by=actor.id,void_reason=v_reason where id=pay.id;
    perform public.internal_audit(actor.id,pay.campaign_id,pay.id,'payment.voided',jsonb_build_object('reason',v_reason,'reference',pay.receipt_ref));
    if jsonb_typeof(payload->'replacement')='object' then
      result := public.internal_record_payment(payload->'replacement'||jsonb_build_object('contributor_id',pay.contributor_id),pay.collector_id,actor.id,pay.id);
    else result := jsonb_build_object('voided',pay.id); end if;
  when 'handover.submit' then
    if actor.role<>'collector' or not exists(select 1 from public.campaign_collectors where campaign_id=cid and collector_id=actor.id) then raise exception 'Collector assignment required'; end if;
    amount := (payload->>'amount_paise')::bigint;
    select coalesce(sum(amount_paise),0) into available from public.payments where campaign_id=cid and collector_id=actor.id and voided_at is null;
    select available-coalesce(sum(amount_paise),0) into available from public.handovers where campaign_id=cid and collector_id=actor.id and status in ('pending','confirmed');
    if amount is null or amount<=0 or amount>available then raise exception 'Handover exceeds available balance'; end if;
    insert into public.handovers(campaign_id,collector_id,amount_paise,method,reference,note)
      values(cid,actor.id,amount,payload->>'method',coalesce(payload->>'reference',''),coalesce(payload->>'note','')) returning * into hand;
    result := to_jsonb(hand);
    perform public.internal_audit(actor.id,cid,hand.id,action,result);
  when 'handover.review' then
    select * into hand from public.handovers where id=(payload->>'id')::uuid;
    newstatus := payload->>'status'; v_reason := btrim(coalesce(payload->>'reason',''));
    if hand.id is null then raise exception 'Handover not found'; end if;
    if newstatus='cancelled' then
      if hand.collector_id<>actor.id or hand.status<>'pending' then raise exception 'Only your pending handover can be cancelled'; end if;
    else
      if not admin then raise exception 'Admin access required'; end if;
      if (newstatus in ('confirmed','rejected') and hand.status<>'pending') or (newstatus='void' and hand.status<>'confirmed') or newstatus not in ('confirmed','rejected','void') then raise exception 'Invalid handover transition'; end if;
      if newstatus in ('rejected','void') and length(v_reason) not between 3 and 500 then raise exception 'Enter a review reason (3–500 characters)'; end if;
    end if;
    update public.handovers set status=newstatus,reason=v_reason,reviewed_at=now(),reviewed_by=actor.id where id=hand.id returning * into hand;
    result := to_jsonb(hand);
    perform public.internal_audit(actor.id,cid,hand.id,'handover.'||newstatus,result);
  else raise exception 'Unknown action';
  end case;
  insert into public.command_requests values(actor.id,key,action,payload,result);
  return result;
end $$;

create function public.app_workspace() returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'profile',public.app_profile(),
    'settings',(select to_jsonb(s) from public.organization_settings s),
    'profiles',coalesce((select jsonb_agg(p order by p.full_name) from public.profiles p),'[]'),
    'campaigns',coalesce((select jsonb_agg(c order by c.created_at desc) from public.campaigns c),'[]'),
    'assignments',coalesce((select jsonb_agg(a) from public.campaign_collectors a),'[]'),
    'contributors',coalesce((select jsonb_agg(c order by c.name) from public.contributors c),'[]'),
    'payments',coalesce((select jsonb_agg(p order by p.recorded_at desc) from public.payments p),'[]'),
    'handovers',coalesce((select jsonb_agg(h order by h.created_at desc) from public.handovers h),'[]'),
    'audit',coalesce((select jsonb_agg(a order by a.created_at desc) from public.audit_events a),'[]')
  ) where public.app_ready()
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.organization_settings,public.profiles,public.campaigns,public.campaign_collectors,public.contributors,public.payments,public.handovers,public.audit_events to authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.app_ready(),public.app_is_admin(),public.app_profile(),public.app_can_see_campaign(uuid),public.app_can_see_contributor(uuid),public.app_command(text,jsonb,uuid),public.app_workspace() to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
