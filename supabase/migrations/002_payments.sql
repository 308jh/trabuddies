-- 002: repayments ("Ali paid jinhao 30.00") that the person who got paid must approve.
-- Receipts are never touched: balances = receipts minus confirmed repayments.

create table payments (
  id bigint generated always as identity primary key,
  trip_id bigint not null references trips(id) on delete cascade,
  from_member bigint not null references trip_members(id) on delete cascade,
  to_member bigint not null references trip_members(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (from_member <> to_member)
);

alter table payments enable row level security;

-- trip members can read payments. There are NO insert/update/delete policies,
-- so the only way to change a payment is through the three functions below.
create policy "members can view payments" on payments
  for select using (is_trip_member(trip_id));

-- who may approve a payment to this person?
-- the person being paid, or (if that person is a guest without an account) the trip creator
create function public.can_approve_payment(t bigint, to_m bigint)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from trip_members m
    where m.id = to_m and m.trip_id = t
      and (
        m.user_id = auth.uid()
        or (m.user_id is null
            and exists (select 1 from trips where id = t and created_by = auth.uid()))
      )
  );
$$;

-- "I paid" (waits for approval) or "I received it" (counts straight away)
create function public.record_payment(t bigint, from_m bigint, to_m bigint, amt numeric)
returns bigint language plpgsql security definer set search_path = public
as $$
declare
  new_id bigint;
  new_status text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not is_trip_member(t) then raise exception 'You are not in this trip'; end if;
  if amt is null or amt <= 0 then raise exception 'Amount must be more than 0'; end if;
  if from_m = to_m then raise exception 'Choose two different people'; end if;
  if (select count(*) from trip_members where trip_id = t and id in (from_m, to_m)) <> 2 then
    raise exception 'Both people must be in this trip';
  end if;

  if can_approve_payment(t, to_m) then
    new_status := 'confirmed';   -- the person who got paid is recording it themselves
  elsif exists (select 1 from trip_members where id = from_m and user_id = auth.uid()) then
    new_status := 'pending';     -- the payer says they paid; the receiver must approve
  else
    raise exception 'Only the person who paid, or the person who got paid, can record this';
  end if;

  insert into payments (trip_id, from_member, to_member, amount, status, created_by, decided_at)
  values (t, from_m, to_m, round(amt, 2), new_status, auth.uid(),
          case when new_status = 'confirmed' then now() end)
  returning id into new_id;

  return new_id;
end;
$$;

-- approve or reject a pending payment
create function public.decide_payment(p bigint, approve boolean)
returns void language plpgsql security definer set search_path = public
as $$
declare pay payments;
begin
  select * into pay from payments where id = p;
  if not found then raise exception 'Payment not found'; end if;
  if pay.status <> 'pending' then raise exception 'This payment was already decided'; end if;
  if not can_approve_payment(pay.trip_id, pay.to_member) then
    raise exception 'Only the person who got paid can approve this';
  end if;

  update payments
  set status = case when approve then 'confirmed' else 'rejected' end,
      decided_at = now()
  where id = p;
end;
$$;

-- cancel your own pending claim, or undo a payment you approved
create function public.remove_payment(p bigint)
returns void language plpgsql security definer set search_path = public
as $$
declare pay payments;
begin
  select * into pay from payments where id = p;
  if not found then raise exception 'Payment not found'; end if;

  if pay.status = 'pending' and pay.created_by = auth.uid() then
    delete from payments where id = p;
  elsif can_approve_payment(pay.trip_id, pay.to_member) then
    delete from payments where id = p;
  else
    raise exception 'You are not allowed to remove this payment';
  end if;
end;
$$;

-- only logged-in users may call them
revoke execute on function public.can_approve_payment(bigint, bigint) from public, anon;
revoke execute on function public.record_payment(bigint, bigint, bigint, numeric) from public, anon;
revoke execute on function public.decide_payment(bigint, boolean) from public, anon;
revoke execute on function public.remove_payment(bigint) from public, anon;
grant execute on function public.can_approve_payment(bigint, bigint) to authenticated;
grant execute on function public.record_payment(bigint, bigint, bigint, numeric) to authenticated;
grant execute on function public.decide_payment(bigint, boolean) to authenticated;
grant execute on function public.remove_payment(bigint) to authenticated;
