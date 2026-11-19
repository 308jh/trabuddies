-- 003: itemized receipts ("chicken chop 20.00 -> jinhao, fried rice 15.00 -> ali ...")
-- The per-person amounts still live in `splits`, so balances, the dashboard and
-- repayments keep working unchanged. These tables only remember WHAT was on the bill.

-- tax, service charge, rounding or discount on top of the items (can be negative)
alter table receipts add column extras numeric(12,2) not null default 0;

create table receipt_items (
  id bigint generated always as identity primary key,
  receipt_id bigint not null references receipts(id) on delete cascade,
  name text not null,
  amount numeric(12,2) not null check (amount <> 0)
);

-- who shared each item (one row per item per person)
create table item_shares (
  item_id bigint not null references receipt_items(id) on delete cascade,
  member_id bigint not null references trip_members(id) on delete cascade,
  primary key (item_id, member_id)
);

alter table receipt_items enable row level security;
alter table item_shares enable row level security;

-- trip members can read. There are NO insert/update/delete policies:
-- items are only created through add_itemized_receipt below (deleting a receipt removes its items).
create policy "members can view receipt items" on receipt_items
  for select using (
    exists (select 1 from receipts r where r.id = receipt_id and is_trip_member(r.trip_id))
  );

create policy "members can view item shares" on item_shares
  for select using (
    exists (
      select 1
      from receipt_items i
      join receipts r on r.id = i.receipt_id
      where i.id = item_id and is_trip_member(r.trip_id)
    )
  );

-- Saves a whole itemized receipt in ONE step (all or nothing).
--   items  = [{"name": "Chicken chop", "amount": 20, "member_ids": [1]}, ...]
--   shares = [{"member_id": 1, "amount": 23.32}, ...]   what each person owes in total
-- The app works out the shares; the database double-checks they add up exactly.
create function public.add_itemized_receipt(
  t bigint, paid bigint, descr text, extra numeric, items jsonb, shares jsonb
)
returns bigint language plpgsql security definer set search_path = public
as $$
declare
  rid bigint;
  iid bigint;
  it jsonb;
  sh jsonb;
  mid bigint;
  items_total numeric := 0;
  shares_total numeric := 0;
  total numeric;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not is_trip_member(t) then raise exception 'You are not in this trip'; end if;
  if not exists (select 1 from trip_members where id = paid and trip_id = t) then
    raise exception 'The person who paid must be in this trip';
  end if;
  if coalesce(jsonb_typeof(items), '') <> 'array' or jsonb_array_length(items) = 0 then
    raise exception 'Add at least one item';
  end if;
  if coalesce(jsonb_typeof(shares), '') <> 'array' or jsonb_array_length(shares) = 0 then
    raise exception 'Missing the amount each person owes';
  end if;
  extra := round(coalesce(extra, 0), 2);

  -- check every item
  for it in select * from jsonb_array_elements(items) loop
    if coalesce(trim(it->>'name'), '') = '' then raise exception 'Every item needs a name'; end if;
    if coalesce((it->>'amount')::numeric, 0) = 0 then raise exception 'Every item needs a price'; end if;
    if coalesce(jsonb_typeof(it->'member_ids'), '') <> 'array'
       or jsonb_array_length(it->'member_ids') = 0 then
      raise exception 'Every item must be shared by at least one person';
    end if;
    items_total := items_total + round((it->>'amount')::numeric, 2);
    for mid in select x::bigint from jsonb_array_elements_text(it->'member_ids') as x loop
      if not exists (select 1 from trip_members where id = mid and trip_id = t) then
        raise exception 'Someone on this receipt is not in the trip';
      end if;
    end loop;
  end loop;

  -- check every person's share, and that they add up to the exact bill
  for sh in select * from jsonb_array_elements(shares) loop
    if not exists (
      select 1 from trip_members where id = (sh->>'member_id')::bigint and trip_id = t
    ) then
      raise exception 'Someone on this receipt is not in the trip';
    end if;
    if (sh->>'amount')::numeric < 0 then raise exception 'An amount cannot be negative'; end if;
    shares_total := shares_total + round((sh->>'amount')::numeric, 2);
  end loop;

  total := items_total + extra;
  if total <= 0 then raise exception 'The total must be more than 0'; end if;
  if shares_total <> total then
    raise exception 'The amounts do not add up (items + charges = %, shares = %)', total, shares_total;
  end if;

  insert into receipts (trip_id, paid_by, amount, description, extras)
  values (t, paid, total, nullif(trim(descr), ''), extra)
  returning id into rid;

  for it in select * from jsonb_array_elements(items) loop
    insert into receipt_items (receipt_id, name, amount)
    values (rid, trim(it->>'name'), round((it->>'amount')::numeric, 2))
    returning id into iid;

    insert into item_shares (item_id, member_id)
    select iid, x::bigint from jsonb_array_elements_text(it->'member_ids') as x
    on conflict do nothing;
  end loop;

  insert into splits (receipt_id, owed_by, amount)
  select rid, (s->>'member_id')::bigint, round((s->>'amount')::numeric, 2)
  from jsonb_array_elements(shares) as s
  where round((s->>'amount')::numeric, 2) > 0;

  return rid;
end;
$$;

revoke execute on function public.add_itemized_receipt(bigint, bigint, text, numeric, jsonb, jsonb)
  from public, anon;
grant execute on function public.add_itemized_receipt(bigint, bigint, text, numeric, jsonb, jsonb)
  to authenticated;
