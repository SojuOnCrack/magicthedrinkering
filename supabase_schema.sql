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

-- Optional backfill for older trade_list / wishlist rows that were saved
-- before snapshot fields existed. This copies snapshot data from the user's
-- own deck JSON where the same card already exists with embedded metadata.
with trade_source as (
  select distinct on (t.id)
    t.id,
    coalesce(card->'img', '{}'::jsonb) as img,
    coalesce(card->>'type_line', '') as type_line,
    coalesce(nullif(card->>'cmc','')::numeric, 0) as cmc,
    coalesce(card->'prices', '{}'::jsonb) as prices,
    coalesce(card->>'set', '') as set_code,
    coalesce(card->>'set_name', '') as set_name,
    coalesce(card->>'collector_number', '') as collector_number,
    coalesce(card->>'scryfall_id', '') as scryfall_id,
    coalesce(card->>'rarity', '') as rarity,
    coalesce(card->'color_identity', '[]'::jsonb) as color_identity
  from trade_list t
  join decks d on d.user_id = t.user_id
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(d.cards::jsonb) = 'array' then d.cards::jsonb
      else '[]'::jsonb
    end
  ) as card
  where lower(coalesce(card->>'name','')) = lower(coalesce(t.card_name,''))
)
update trade_list t
set
  img = case when coalesce(t.img, '{}'::jsonb) = '{}'::jsonb then trade_source.img else t.img end,
  type_line = case when coalesce(t.type_line,'') = '' then trade_source.type_line else t.type_line end,
  cmc = case when coalesce(t.cmc,0) = 0 then trade_source.cmc else t.cmc end,
  prices = case when coalesce(t.prices, '{}'::jsonb) = '{}'::jsonb then trade_source.prices else t.prices end,
  set = case when coalesce(t.set,'') = '' then trade_source.set_code else t.set end,
  set_name = case when coalesce(t.set_name,'') = '' then trade_source.set_name else t.set_name end,
  collector_number = case when coalesce(t.collector_number,'') = '' then trade_source.collector_number else t.collector_number end,
  scryfall_id = case when coalesce(t.scryfall_id,'') = '' then trade_source.scryfall_id else t.scryfall_id end,
  rarity = case when coalesce(t.rarity,'') = '' then trade_source.rarity else t.rarity end,
  color_identity = case when coalesce(t.color_identity, '[]'::jsonb) = '[]'::jsonb then trade_source.color_identity else t.color_identity end
from trade_source
where trade_source.id = t.id;

with wish_source as (
  select distinct on (w.id)
    w.id,
    coalesce(card->'img', '{}'::jsonb) as img,
    coalesce(card->>'type_line', '') as type_line,
    coalesce(nullif(card->>'cmc','')::numeric, 0) as cmc,
    coalesce(card->'prices', '{}'::jsonb) as prices,
    coalesce(card->>'set', '') as set_code,
    coalesce(card->>'set_name', '') as set_name,
    coalesce(card->>'collector_number', '') as collector_number,
    coalesce(card->>'scryfall_id', '') as scryfall_id,
    coalesce(card->>'rarity', '') as rarity,
    coalesce(card->'color_identity', '[]'::jsonb) as color_identity
  from wishlist w
  join decks d on d.user_id = w.user_id
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(d.cards::jsonb) = 'array' then d.cards::jsonb
      else '[]'::jsonb
    end
  ) as card
  where lower(coalesce(card->>'name','')) = lower(coalesce(w.card_name,''))
)
update wishlist w
set
  img = case when coalesce(w.img, '{}'::jsonb) = '{}'::jsonb then wish_source.img else w.img end,
  type_line = case when coalesce(w.type_line,'') = '' then wish_source.type_line else w.type_line end,
  cmc = case when coalesce(w.cmc,0) = 0 then wish_source.cmc else w.cmc end,
  prices = case when coalesce(w.prices, '{}'::jsonb) = '{}'::jsonb then wish_source.prices else w.prices end,
  set = case when coalesce(w.set,'') = '' then wish_source.set_code else w.set end,
  set_name = case when coalesce(w.set_name,'') = '' then wish_source.set_name else w.set_name end,
  collector_number = case when coalesce(w.collector_number,'') = '' then wish_source.collector_number else w.collector_number end,
  scryfall_id = case when coalesce(w.scryfall_id,'') = '' then wish_source.scryfall_id else w.scryfall_id end,
  rarity = case when coalesce(w.rarity,'') = '' then wish_source.rarity else w.rarity end,
  color_identity = case when coalesce(w.color_identity, '[]'::jsonb) = '[]'::jsonb then wish_source.color_identity else w.color_identity end
from wish_source
where wish_source.id = w.id;
