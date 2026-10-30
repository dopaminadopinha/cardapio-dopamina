-- Cardápio online: tabelas, permissões e dados iniciais.
-- Rode este arquivo inteiro no SQL Editor do Supabase (uma vez).

create extension if not exists pgcrypto;

-- Configurações gerais (sempre uma única linha, id = 1)
create table if not exists public.menu_settings (
  id int primary key default 1 check (id = 1),
  bar_name text not null default 'Dopamina',
  tagline text not null default '',
  notice_text text not null default '',
  notice_active boolean not null default false,
  footer_text text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.menu_settings (id) values (1) on conflict (id) do nothing;

-- Quem pode editar o cardápio
create table if not exists public.menu_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  position int not null default 0,
  visible boolean not null default true,
  -- Nomes das colunas de preço; com price2_label preenchido a aba mostra dois preços
  price_label text not null default '',
  price2_label text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.menu_categories (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  detail text not null default '',
  description text not null default '',
  price numeric(10, 2) not null default 0 check (price >= 0),
  price2 numeric(10, 2) check (price2 >= 0),
  promo_price numeric(10, 2) check (promo_price >= 0),
  badge text check (badge in ('novo', 'mais_pedido', 'promo')),
  available boolean not null default true,
  visible boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists menu_items_category_position_idx
  on public.menu_items (category_id, position);

-- Verifica se o usuário logado é administrador do cardápio
create or replace function public.is_menu_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.menu_admins where user_id = auth.uid());
$$;

-- Qualquer mudança em abas/itens "carimba" menu_settings.updated_at.
-- A página pública escuta só essa linha e recarrega o cardápio,
-- inclusive quando um item é escondido (o que o Realtime não entregaria).
create or replace function public.touch_menu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.menu_settings set updated_at = now() where id = 1;
  return null;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists menu_items_set_updated_at on public.menu_items;
create trigger menu_items_set_updated_at
  before update on public.menu_items
  for each row execute function public.set_updated_at();

drop trigger if exists menu_settings_set_updated_at on public.menu_settings;
create trigger menu_settings_set_updated_at
  before update on public.menu_settings
  for each row execute function public.set_updated_at();

drop trigger if exists menu_items_touch on public.menu_items;
create trigger menu_items_touch
  after insert or update or delete on public.menu_items
  for each statement execute function public.touch_menu();

drop trigger if exists menu_categories_touch on public.menu_categories;
create trigger menu_categories_touch
  after insert or update or delete on public.menu_categories
  for each statement execute function public.touch_menu();

-- Segurança (RLS): o público só lê o que está visível; só admins editam
alter table public.menu_settings enable row level security;
alter table public.menu_admins enable row level security;
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;

drop policy if exists "settings_read" on public.menu_settings;
create policy "settings_read" on public.menu_settings
  for select to anon, authenticated using (true);

drop policy if exists "settings_admin_update" on public.menu_settings;
create policy "settings_admin_update" on public.menu_settings
  for update to authenticated
  using (public.is_menu_admin()) with check (public.is_menu_admin());

drop policy if exists "admins_read_self" on public.menu_admins;
create policy "admins_read_self" on public.menu_admins
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "categories_read" on public.menu_categories;
create policy "categories_read" on public.menu_categories
  for select to anon, authenticated
  using (visible or public.is_menu_admin());

drop policy if exists "categories_admin_write" on public.menu_categories;
create policy "categories_admin_write" on public.menu_categories
  for all to authenticated
  using (public.is_menu_admin()) with check (public.is_menu_admin());

drop policy if exists "items_read" on public.menu_items;
create policy "items_read" on public.menu_items
  for select to anon, authenticated
  using (
    public.is_menu_admin()
    or (
      visible
      and exists (
        select 1 from public.menu_categories c
        where c.id = category_id and c.visible
      )
    )
  );

drop policy if exists "items_admin_write" on public.menu_items;
create policy "items_admin_write" on public.menu_items
  for all to authenticated
  using (public.is_menu_admin()) with check (public.is_menu_admin());

grant select on public.menu_settings, public.menu_categories, public.menu_items to anon, authenticated;
grant update on public.menu_settings to authenticated;
grant insert, update, delete on public.menu_categories, public.menu_items to authenticated;
grant select on public.menu_admins to authenticated;
grant execute on function public.is_menu_admin() to anon, authenticated;
-- Funções de gatilho não devem ser chamáveis pela API
revoke execute on function public.touch_menu() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- Atualização em tempo real da página pública
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'menu_settings'
  ) then
    alter publication supabase_realtime add table public.menu_settings;
  end if;
end;
$$;

-- Dados iniciais (só entram se o cardápio estiver vazio)
do $$
declare
  cervejas uuid;
  nao_alcoolicas uuid;
begin
  if exists (select 1 from public.menu_categories) then
    return;
  end if;

  insert into public.menu_categories (name, position) values ('Cervejas', 0) returning id into cervejas;
  insert into public.menu_categories (name, position) values ('Não alcoólicas', 1) returning id into nao_alcoolicas;
  insert into public.menu_categories (name, position) values
    ('Drinks', 2), ('Copões', 3), ('Doses', 4), ('Comidas', 5);

  insert into public.menu_items (category_id, name, detail, price, position) values
    (cervejas, 'Antartica Boa', 'Litrão', 14.50, 0),
    (cervejas, 'Budweiser', '600ml', 15.00, 1),
    (cervejas, 'Budweiser', 'Litrão', 18.00, 2),
    (cervejas, 'Brahma', '600ml', 14.00, 3),
    (cervejas, 'Corona', 'Longneck', 13.00, 4),
    (cervejas, 'Corona Long', 'Zero', 13.00, 5),
    (cervejas, 'Stella', 'Longneck', 13.00, 6),
    (cervejas, 'Budweiser', 'Longneck', 13.00, 7),
    (nao_alcoolicas, 'Água', 'Sem gás', 3.50, 0),
    (nao_alcoolicas, 'Água', 'Com gás', 4.00, 1),
    (nao_alcoolicas, 'Coca', 'Lata', 7.00, 2),
    (nao_alcoolicas, 'Coca Zero', 'Lata', 7.00, 3),
    (nao_alcoolicas, 'Pepsi', 'Lata', 7.00, 4),
    (nao_alcoolicas, 'Guaraná', 'Lata', 7.00, 5),
    (nao_alcoolicas, 'Guaraná Zero', 'Lata', 7.00, 6),
    (nao_alcoolicas, 'H2O', 'Limão/Limoneto', 9.00, 7),
    (nao_alcoolicas, 'Água Tônica', '', 8.00, 8);
end;
$$;
