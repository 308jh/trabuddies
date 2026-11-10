drop table if exists splits, receipts, trip_members, trips, profiles cascade;

-- profiles: lets you find a friend by email (you can't search auth.users from the app)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text
);

create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into profiles (id, email, display_name)
  values (new.id, new.email, split_part(new.email, '@', 1));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- fill profiles for any test accounts you already created
insert into profiles (id, email, display_name)
select id, email, split_part(email, '@', 1) from auth.users
on conflict do nothing;

create table trips (
  id bigint generated always as identity primary key,
  name text not null,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

-- a "seat": user_id filled = real account, user_id empty = temporary guest
create table trip_members (
  id bigint generated always as identity primary key,
  trip_id bigint not null references trips(id) on delete cascade,
  user_id uuid references auth.users(id),
  display_name text not null,
  unique (trip_id, user_id)
);

create table receipts (
  id bigint generated always as identity primary key,
  trip_id bigint not null references trips(id) on delete cascade,
  paid_by bigint not null references trip_members(id),
  amount numeric(12,2) not null check (amount > 0),
  description text
);

create table splits (
  id bigint generated always as identity primary key,
  receipt_id bigint not null references receipts(id) on delete cascade,
  owed_by bigint not null references trip_members(id),
  amount numeric(12,2) not null check (amount >= 0)
);

alter table profiles enable row level security;
alter table trips enable row level security;
alter table trip_members enable row level security;
alter table receipts enable row level security;
alter table splits enable row level security;

-- guest-list checker
create function public.is_trip_member(t bigint)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from trip_members where trip_id = t and user_id = auth.uid());
$$;

-- creator automatically gets a seat
create function public.add_creator_as_member()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into trip_members (trip_id, user_id, display_name)
  values (new.id, new.created_by,
          coalesce((select display_name from profiles where id = new.created_by), 'Me'));
  return new;
end;
$$;

create trigger on_trip_created
after insert on trips
for each row execute function add_creator_as_member();

-- add a friend who HAS an account, by email
create function public.add_member_by_email(t bigint, friend_email text)
returns void language plpgsql security definer set search_path = public
as $$
declare p profiles;
begin
  if not exists (select 1 from trips where id = t and created_by = auth.uid()) then
    raise exception 'Only the trip creator can add members';
  end if;
  select * into p from profiles where lower(email) = lower(friend_email);
  if not found then
    raise exception 'No account with that email. Add them as a guest instead.';
  end if;
  insert into trip_members (trip_id, user_id, display_name)
  values (t, p.id, p.display_name);
end;
$$;

-- policies
create policy "see own profile" on profiles
  for select using (id = auth.uid());
create policy "edit own profile" on profiles
  for update using (id = auth.uid());

create policy "members or creator can view trips" on trips
  for select using (is_trip_member(id) or created_by = auth.uid());
create policy "logged-in users can create trips" on trips
  for insert with check (created_by = auth.uid());
create policy "creator can edit trip" on trips
  for update using (created_by = auth.uid());
create policy "creator can delete trip" on trips
  for delete using (created_by = auth.uid());

create policy "members can see the guest list" on trip_members
  for select using (is_trip_member(trip_id));
create policy "creator can add guests" on trip_members
  for insert with check (
    user_id is null
    and exists (select 1 from trips where id = trip_id and created_by = auth.uid())
  );
create policy "creator can remove members, or you can leave" on trip_members
  for delete using (
    user_id = auth.uid()
    or exists (select 1 from trips where id = trip_id and created_by = auth.uid())
  );

create policy "members can view receipts" on receipts
  for select using (is_trip_member(trip_id));
create policy "members can add receipts" on receipts
  for insert with check (is_trip_member(trip_id));
create policy "members can edit receipts" on receipts
  for update using (is_trip_member(trip_id));
create policy "members can delete receipts" on receipts
  for delete using (is_trip_member(trip_id));

create policy "members can manage splits" on splits
  for all
  using (exists (select 1 from receipts r where r.id = receipt_id and is_trip_member(r.trip_id)))
  with check (exists (select 1 from receipts r where r.id = receipt_id and is_trip_member(r.trip_id)));