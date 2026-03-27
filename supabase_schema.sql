create table if not exists decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  commander text default '',
  partner text default '',
  cards text default '[]',
  public boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table decks enable row level security;
create policy "Users own their decks" on decks
  for all using (auth.uid() = user_id);

create table if not exists profiles (
  id uuid primary key references auth.users,
  email text,
  username text
);
alter table profiles enable row level security;
create policy "Profiles are public" on profiles for select using (true);
create policy "Users manage own profile" on profiles for all using (auth.uid() = id);

create table if not exists shared_decks (
  token text primary key,
  deck_name text,
  commander text,
  partner text,
  cards text,
  created_at timestamptz default now()
);
alter table shared_decks enable row level security;
create policy "Shared decks are public" on shared_decks for select using (true);
create policy "Authenticated can share" on shared_decks for insert with check (auth.role() = 'authenticated');

create table if not exists trade_list (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  user_email text,
  card_name text,
  img jsonb default '{}'::jsonb,
  type_line text default '',
  cmc numeric default 0,
  prices jsonb default '{}'::jsonb,
  set text default '',
  set_name text default '',
  collector_number text default '',
  scryfall_id text default '',
  rarity text default '',
  color_identity jsonb default '[]'::jsonb,
  condition text,
  note text,
  created_at timestamptz default now()
);
alter table trade_list add column if not exists img jsonb default '{}'::jsonb;
alter table trade_list add column if not exists type_line text default '';
alter table trade_list add column if not exists cmc numeric default 0;
alter table trade_list add column if not exists prices jsonb default '{}'::jsonb;
alter table trade_list add column if not exists set text default '';
alter table trade_list add column if not exists set_name text default '';
alter table trade_list add column if not exists collector_number text default '';
alter table trade_list add column if not exists scryfall_id text default '';
alter table trade_list add column if not exists rarity text default '';
alter table trade_list add column if not exists color_identity jsonb default '[]'::jsonb;
alter table trade_list enable row level security;
create policy "Trade list is public" on trade_list for select using (true);
create policy "Users manage own trades" on trade_list for all using (auth.uid() = user_id);

create table if not exists wishlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  user_email text,
  card_name text,
  img jsonb default '{}'::jsonb,
  type_line text default '',
  cmc numeric default 0,
  prices jsonb default '{}'::jsonb,
  set text default '',
  set_name text default '',
  collector_number text default '',
  scryfall_id text default '',
  rarity text default '',
  color_identity jsonb default '[]'::jsonb,
  note text,
  created_at timestamptz default now()
);
alter table wishlist add column if not exists img jsonb default '{}'::jsonb;
alter table wishlist add column if not exists type_line text default '';
alter table wishlist add column if not exists cmc numeric default 0;
alter table wishlist add column if not exists prices jsonb default '{}'::jsonb;
alter table wishlist add column if not exists set text default '';
alter table wishlist add column if not exists set_name text default '';
alter table wishlist add column if not exists collector_number text default '';
alter table wishlist add column if not exists scryfall_id text default '';
alter table wishlist add column if not exists rarity text default '';
alter table wishlist add column if not exists color_identity jsonb default '[]'::jsonb;
alter table wishlist enable row level security;
create policy "Users own their wishlist" on wishlist for all using (auth.uid() = user_id);

create table if not exists bulk_pool (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  user_email text,
  card_name text,
  qty integer default 1,
  condition text default 'NM',
  note text,
  price_usd numeric(10,2) default 0,
  created_at timestamptz default now()
);
alter table bulk_pool enable row level security;
create policy "Bulk pool is public" on bulk_pool for select using (true);
create policy "Users manage own pool entries" on bulk_pool for all using (auth.uid() = user_id);

create table if not exists friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  friend_id uuid references auth.users not null,
  unique(user_id, friend_id)
);
alter table friendships enable row level security;
create policy "Users manage own friendships" on friendships for all using (auth.uid() = user_id);

create table if not exists deck_comments (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid references decks,
  user_id uuid references auth.users not null,
  user_email text,
  comment_text text not null,
  created_at timestamptz default now()
);
alter table deck_comments enable row level security;
create policy "Comments on public decks are public" on deck_comments for select using (true);
create policy "Authenticated users can comment" on deck_comments for insert with check (auth.role() = 'authenticated');
create policy "Users delete own comments" on deck_comments for delete using (auth.uid() = user_id);

create table if not exists deck_reactions (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references decks,
  user_id uuid not null references auth.users,
  emoji text not null,
  created_at timestamptz default now(),
  unique(deck_id, user_id, emoji)
);
alter table deck_reactions enable row level security;
create policy "Reactions on public decks are public" on deck_reactions for select using (true);
create policy "Authenticated users can react" on deck_reactions for insert with check (auth.role() = 'authenticated');
create policy "Users delete own reactions" on deck_reactions for delete using (auth.uid() = user_id);
