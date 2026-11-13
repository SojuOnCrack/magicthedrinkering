-- CommanderForge security hardening
-- Applied to the production project pwrpvtzocycnemgnsooz on 2026-11-13.
-- Tracker tables (mp_*) are intentionally excluded.
begin;

-- Public usernames only; profile email remains private and inaccessible via the Data API.
drop policy if exists "Users manage own profile" on public.profiles;
drop policy if exists "Profiles are public" on public.profiles;
drop policy if exists "Anyone reads profiles" on public.profiles;
drop policy if exists "Public usernames are visible" on public.profiles;
create policy "Public usernames are visible" on public.profiles
  for select to anon, authenticated using (true);
create policy "Users insert own profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "Users update own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
revoke all on public.profiles from anon, authenticated;
grant select (id, username) on public.profiles to anon, authenticated;
grant insert (id, username) on public.profiles to authenticated;
grant update (username, username_changed_at) on public.profiles to authenticated;
create or replace view public.public_profiles with (security_invoker = true)
  as select id, username from public.profiles;
grant select on public.public_profiles to anon, authenticated;

-- Deck ownership and public visibility.
drop policy if exists "Users own their decks" on public.decks;
drop policy if exists "Users delete own decks" on public.decks;
drop policy if exists "Users insert own decks" on public.decks;
drop policy if exists "Users see own decks" on public.decks;
drop policy if exists "Users update own decks" on public.decks;
drop policy if exists "Read own or public decks" on public.decks;
drop policy if exists "Insert own decks" on public.decks;
drop policy if exists "Update own decks" on public.decks;
drop policy if exists "Delete own decks" on public.decks;
create policy "Read own or public decks" on public.decks for select to anon, authenticated
  using (public = true or (select auth.uid()) = user_id);
create policy "Insert own decks" on public.decks for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Update own decks" on public.decks for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own decks" on public.decks for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Shared deck links remain publicly readable; creating them requires a session.
drop policy if exists "Authenticated users can share decks" on public.shared_decks;
drop policy if exists "Anyone can read shared decks" on public.shared_decks;
drop policy if exists "Signed-in users can create shared decks" on public.shared_decks;
create policy "Anyone can read shared decks" on public.shared_decks
  for select to anon, authenticated using (true);
create policy "Signed-in users can create shared decks" on public.shared_decks
  for insert to authenticated with check ((select auth.uid()) is not null);

-- Owner-only alerts and friendships.
drop policy if exists "Users see own alerts" on public.alerts;
drop policy if exists "Users manage own alerts" on public.alerts;
create policy "Users manage own alerts" on public.alerts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users manage own friendships" on public.friendships;
create policy "Users manage own friendships" on public.friendships for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Bulk pool stays public/read-only for discovery; mutations are owner-scoped.
drop policy if exists "Users manage own pool entries" on public.bulk_pool;
drop policy if exists "Users delete own entries" on public.bulk_pool;
drop policy if exists "bulk_pool_delete_signed_in" on public.bulk_pool;
drop policy if exists "Auth users add to pool" on public.bulk_pool;
drop policy if exists "bulk_pool_insert_signed_in" on public.bulk_pool;
drop policy if exists "Anyone reads bulk pool" on public.bulk_pool;
drop policy if exists "Bulk pool is public" on public.bulk_pool;
drop policy if exists "bulk_pool_select_all" on public.bulk_pool;
drop policy if exists "Public can read bulk pool" on public.bulk_pool;
drop policy if exists "Users insert own bulk entries" on public.bulk_pool;
drop policy if exists "Users update own bulk entries" on public.bulk_pool;
drop policy if exists "Users delete own bulk entries" on public.bulk_pool;
create policy "Public can read bulk pool" on public.bulk_pool for select to anon, authenticated using (true);
create policy "Users insert own bulk entries" on public.bulk_pool for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users update own bulk entries" on public.bulk_pool for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own bulk entries" on public.bulk_pool for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Comments and reactions are visible only for public decks (or their owner's own decks).
drop policy if exists "Users delete own comments" on public.deck_comments;
drop policy if exists "Auth users comment" on public.deck_comments;
drop policy if exists "Authenticated users can comment" on public.deck_comments;
drop policy if exists "Anyone reads comments" on public.deck_comments;
drop policy if exists "Comments on public decks are public" on public.deck_comments;
drop policy if exists "Read comments on visible decks" on public.deck_comments;
drop policy if exists "Signed-in users comment on public decks" on public.deck_comments;
create policy "Read comments on visible decks" on public.deck_comments for select to anon, authenticated
  using (exists (select 1 from public.decks d where d.id = deck_comments.deck_id
    and (d.public = true or d.user_id = (select auth.uid()))));
create policy "Signed-in users comment on public decks" on public.deck_comments for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.decks d where d.id = deck_comments.deck_id and d.public = true));
create policy "Users delete own comments" on public.deck_comments for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Auth users react" on public.deck_reactions;
drop policy if exists "Users delete own reactions" on public.deck_reactions;
drop policy if exists "Authenticated users can react" on public.deck_reactions;
drop policy if exists "Anyone reads reactions" on public.deck_reactions;
drop policy if exists "Reactions on public decks are public" on public.deck_reactions;
drop policy if exists "Read reactions on visible decks" on public.deck_reactions;
drop policy if exists "Users insert own reactions" on public.deck_reactions;
create policy "Read reactions on visible decks" on public.deck_reactions for select to anon, authenticated
  using (exists (select 1 from public.decks d where d.id = deck_reactions.deck_id
    and (d.public = true or d.user_id = (select auth.uid()))));
create policy "Users insert own reactions" on public.deck_reactions for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.decks d where d.id = deck_reactions.deck_id and d.public = true));
create policy "Users delete own reactions" on public.deck_reactions for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Trade lists and wishlists remain public community features, but email columns are never readable.
drop policy if exists "Users manage own trade list" on public.trade_list;
drop policy if exists "Users delete own trade entries" on public.trade_list;
drop policy if exists "Users manage own trade entries" on public.trade_list;
drop policy if exists "Anyone reads trade list" on public.trade_list;
drop policy if exists "Trade list is public" on public.trade_list;
drop policy if exists "Users update own trade entries" on public.trade_list;
drop policy if exists "Public can read trade lists" on public.trade_list;
drop policy if exists "Users insert own trade entries" on public.trade_list;
create policy "Public can read trade lists" on public.trade_list for select to anon, authenticated using (true);
create policy "Users insert own trade entries" on public.trade_list for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users update own trade entries" on public.trade_list for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own trade entries" on public.trade_list for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users manage own wishlist" on public.wishlist;
drop policy if exists "Users delete own wishlist entries" on public.wishlist;
drop policy if exists "Anyone reads wishlist" on public.wishlist;
drop policy if exists "Wishlist is public" on public.wishlist;
drop policy if exists "Users update own wishlist entries" on public.wishlist;
drop policy if exists "Public can read wishlists" on public.wishlist;
drop policy if exists "Users insert own wishlist entries" on public.wishlist;
create policy "Public can read wishlists" on public.wishlist for select to anon, authenticated using (true);
create policy "Users insert own wishlist entries" on public.wishlist for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users update own wishlist entries" on public.wishlist for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own wishlist entries" on public.wishlist for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Restrict SELECT to safe fields; email columns are excluded from all API roles.
revoke select on public.bulk_pool, public.trade_list, public.wishlist, public.deck_comments from anon, authenticated;
grant select (id, card_name, qty, condition, user_id, price_usd, created_at, foil, set_code, collector_number, scryfallid)
  on public.bulk_pool to anon, authenticated;
grant select (id, user_id, card_name, qty, condition, created_at, img, type_line, cmc, prices, set, set_name, collector_number, scryfall_id, rarity, color_identity)
  on public.trade_list to anon, authenticated;
grant select (id, user_id, card_name, note, created_at, img, type_line, cmc, prices, set, set_name, collector_number, scryfall_id, rarity, color_identity)
  on public.wishlist to anon, authenticated;
grant select (id, deck_id, user_id, comment_text, created_at)
  on public.deck_comments to anon, authenticated;
grant insert, update, delete on public.bulk_pool, public.trade_list, public.wishlist, public.deck_comments, public.deck_reactions to authenticated;

-- Lock down function search paths and direct execution of trigger helpers.
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $function$
begin new.updated_at = now(); return new; end;
$function$;
create or replace function public.update_updated_at()
returns trigger language plpgsql set search_path = '' as $function$
begin new.updated_at = now(); return new; end;
$function$;
create or replace function public.increment_view_count(token_val text)
returns void language sql set search_path = '' as $function$
  update public.shared_decks set view_count = view_count + 1 where token = token_val;
$function$;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  insert into public.profiles (id, email, username)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$function$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.increment_view_count(text) from public, anon, authenticated;

-- Supporting indexes for foreign keys.
create index if not exists alerts_user_id_idx on public.alerts(user_id);
create index if not exists bulk_pool_user_id_idx on public.bulk_pool(user_id);
create index if not exists deck_comments_user_id_idx on public.deck_comments(user_id);
create index if not exists deck_reactions_user_id_idx on public.deck_reactions(user_id);
create index if not exists trade_list_user_id_idx on public.trade_list(user_id);
create index if not exists wishlist_user_id_idx on public.wishlist(user_id);

commit;
