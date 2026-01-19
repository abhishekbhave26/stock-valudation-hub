create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  email text,
  goal_amount numeric not null default 900000
);

create table if not exists snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  as_of_date date not null default current_date,
  my_robinhood_portfolio numeric not null default 0,
  girlfriend_robinhood_portfolio numeric not null default 0,
  girlfriend_bank_account numeric not null default 0,
  my_savings_account numeric not null default 0,
  my_meta_stock_value numeric not null default 0,
  miscellaneous_assets numeric not null default 0,
  total_saved numeric not null,
  goal_amount numeric not null,
  notes text
);

alter table profiles enable row level security;
alter table snapshots enable row level security;

create policy "Profiles are viewable by owner"
  on profiles for select
  using (auth.uid() = id);

create policy "Profiles are insertable by owner"
  on profiles for insert
  with check (auth.uid() = id);

create policy "Profiles are editable by owner"
  on profiles for update
  using (auth.uid() = id);

create policy "Snapshots are viewable by owner"
  on snapshots for select
  using (auth.uid() = user_id);

create policy "Snapshots are insertable by owner"
  on snapshots for insert
  with check (auth.uid() = user_id);

create policy "Snapshots are updatable by owner"
  on snapshots for update
  using (auth.uid() = user_id);

create policy "Snapshots are deletable by owner"
  on snapshots for delete
  using (auth.uid() = user_id);
