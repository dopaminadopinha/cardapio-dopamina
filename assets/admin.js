import { supabase, fetchMenu, formatPrice, parsePrice, h, BADGES } from './shared.js';

const $ = (id) => document.getElementById(id);

const views = {
  login: $('login-view'),
  denied: $('denied-view'),
  editor: $('editor-view'),
};

const state = {
  settings: {},
  categories: [],
  items: [],
  view: null, // id de uma aba, 'abas' ou 'avisos'
};

/* ---------- Sessão ---------- */

function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  $('logout').hidden = name === 'login';
}

async function route(session) {
  if (!session) {
    show('login');
    return;
  }
  const { data, error } = await supabase
    .from('menu_admins')
    .select('user_id')
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (error || !data) {
    $('denied-id').textContent = session.user.id;
    show('denied');
    return;
  }
  show('editor');
  await reload();
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  $('login-error').hidden = true;
  const { error } = await supabase.auth.signInWithPassword({
    email: form.email.value.trim(),
    password: form.password.value,
  });
  button.disabled = false;
  if (error) {
    $('login-error').textContent = 'E-mail ou senha incorretos.';
    $('login-error').hidden = false;
  }
});

$('logout').addEventListener('click', () => supabase.auth.signOut());

let lastUserId;
supabase.auth.onAuthStateChange((_event, session) => {
  // Evita recarregar tudo a cada renovação automática do token.
  const userId = session?.user.id ?? null;
  if (userId === lastUserId) return;
  lastUserId = userId;
  setTimeout(() => route(session), 0);
});

/* ---------- Dados ---------- */

async function reload() {
  try {
    Object.assign(state, await fetchMenu());
    const valid = state.view === 'abas' || state.view === 'avisos' || state.categories.some((c) => c.id === state.view);
    if (!valid) state.view = state.categories[0]?.id ?? 'abas';
    render();
  } catch (error) {
    console.error(error);
    toast('Não foi possível carregar o cardápio. Verifique a conexão.', true);
  }
}

async function update(table, id, patch) {
  const { error } = await supabase.from(table).update(patch).eq('id', id);
  if (error) {
    console.error(error);
    toast('Não salvou. Verifique a conexão e tente de novo.', true);
    return false;
  }
  return true;
}

function itemsOf(categoryId) {
  return state.items
    .filter((i) => i.category_id === categoryId)
    .sort((a, b) => a.position - b.position);
}

function categoriesSorted() {
  return [...state.categories].sort((a, b) => a.position - b.position);
}

// Troca de lugar com o vizinho e renumera a lista inteira.
async function move(table, list, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  const reordered = [...list];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  const changes = reordered
    .map((row, position) => ({ row, position }))
    .filter(({ row, position }) => row.position !== position);
  changes.forEach(({ row, position }) => (row.position = position));
  render();
  const results = await Promise.all(changes.map(({ row, position }) => update(table, row.id, { position })));
  if (results.includes(false)) await reload();
}

/* ---------- Interface ---------- */

let toastTimer;
function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('is-error', isError);
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), isError ? 4000 : 1800);
}

function render() {
  renderTabs();
  const editor = $('editor');
  if (state.view === 'abas') editor.replaceChildren(renderCategoriesView());
  else if (state.view === 'avisos') editor.replaceChildren(renderSettingsView());
  else editor.replaceChildren(renderCategoryView(state.categories.find((c) => c.id === state.view)));
}

function renderTabs() {
  const tab = (view, label, extraClass = '') =>
    h('button', {
      type: 'button',
      class: `tab ${extraClass}`,
      'aria-pressed': String(state.view === view),
      onclick: () => {
        state.view = view;
        render();
        window.scrollTo({ top: 0 });
      },
    }, label);

  $('admin-tabs').replaceChildren(
    ...categoriesSorted().map((c) => tab(c.id, c.name, c.visible ? '' : 'is-hidden')),
    tab('abas', '⚙ Abas', 'tab-tool'),
    tab('avisos', '⚙ Avisos e info', 'tab-tool'),
  );
}

function renderCategoryView(category) {
  const list = itemsOf(category.id);
  return h('div', { class: 'stack' },
    h('div', { class: 'view-head' },
      h('h1', {}, category.name),
      category.visible ? null : h('span', { class: 'pill' }, 'Aba oculta'),
    ),
    list.length
      ? h('ul', { class: 'cards' }, list.map((item, index) => renderItemCard(item, index, list)))
      : h('p', { class: 'muted' }, 'Nenhum item nesta aba. Abas vazias não aparecem para o cliente.'),
    h('button', { type: 'button', class: 'btn btn-gold btn-block', onclick: () => openItem(null, category.id) }, '+ Adicionar item'),
  );
}

function renderItemCard(item, index, list) {
  const card = h('li', { class: `card${item.available ? '' : ' is-out'}${item.visible ? '' : ' is-hidden'}` });

  const priceInput = h('input', {
    class: 'price-input',
    inputmode: 'decimal',
    'aria-label': `Preço de ${item.name} ${item.detail}`.trim(),
    value: formatPrice(item.price).replace(/^R\$\s?/, ''),
    onfocus: (event) => event.target.select(),
    onkeydown: (event) => {
      if (event.key === 'Enter') event.target.blur();
    },
    onchange: async (event) => {
      const input = event.target;
      const price = parsePrice(input.value);
      const previous = item.price;
      if (price === null) {
        input.value = formatPrice(previous).replace(/^R\$\s?/, '');
        toast('Preço inválido. Use números, como 14,50.', true);
        return;
      }
      item.price = price;
      input.value = formatPrice(price).replace(/^R\$\s?/, '');
      if (await update('menu_items', item.id, { price })) toast(`${item.name}: ${formatPrice(price)}`);
      else {
        item.price = previous;
        input.value = formatPrice(previous).replace(/^R\$\s?/, '');
      }
    },
  });

  const availability = h('input', {
    type: 'checkbox',
    checked: item.available,
    onchange: async (event) => {
      const available = event.target.checked;
      item.available = available;
      card.classList.toggle('is-out', !available);
      if (await update('menu_items', item.id, { available })) {
        toast(available ? `${item.name} disponível` : `${item.name} marcado como esgotado`);
      } else {
        item.available = !available;
        event.target.checked = !available;
        card.classList.toggle('is-out', available);
      }
    },
  });

  const promo = item.promo_price !== null && Number(item.promo_price) < Number(item.price);

  card.append(
    h('div', { class: 'card-main' },
      h('button', { type: 'button', class: 'card-title', onclick: () => openItem(item) },
        h('strong', {}, item.name),
        item.detail ? h('span', {}, ` ${item.detail}`) : null,
        h('span', { class: 'card-tags' },
          item.badge ? h('span', { class: 'pill' }, BADGES[item.badge]) : null,
          promo ? h('span', { class: 'pill' }, `Promo ${formatPrice(item.promo_price)}`) : null,
          item.visible ? null : h('span', { class: 'pill' }, 'Oculto'),
        ),
      ),
      h('label', { class: 'price-field' }, h('span', { 'aria-hidden': 'true' }, 'R$'), priceInput),
    ),
    h('div', { class: 'card-actions' },
      h('label', { class: 'switch' }, availability, h('span', { class: 'switch-track', 'aria-hidden': 'true' }), 'Disponível'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Subir', disabled: index === 0, onclick: () => move('menu_items', list, index, -1) }, '↑'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Descer', disabled: index === list.length - 1, onclick: () => move('menu_items', list, index, 1) }, '↓'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => openItem(item) }, 'Editar'),
    ),
  );
  return card;
}

function renderCategoriesView() {
  const list = categoriesSorted();
  const addForm = h('form', {
    class: 'add-row',
    onsubmit: async (event) => {
      event.preventDefault();
      const name = event.target.elements.name.value.trim();
      if (!name) return;
      const position = list.length ? Math.max(...list.map((c) => c.position)) + 1 : 0;
      const { data, error } = await supabase.from('menu_categories').insert({ name, position }).select().single();
      if (error) {
        toast('Não foi possível criar a aba.', true);
        return;
      }
      state.categories.push(data);
      toast(`Aba "${name}" criada`);
      render();
    },
  },
    h('input', { name: 'name', placeholder: 'Nova aba, ex.: Copões', required: true, 'aria-label': 'Nome da nova aba' }),
    h('button', { type: 'submit', class: 'btn btn-gold' }, 'Adicionar aba'),
  );

  return h('div', { class: 'stack' },
    h('div', { class: 'view-head' }, h('h1', {}, 'Abas')),
    h('p', { class: 'muted' }, 'A ordem aqui é a ordem das abas no cardápio. Abas ocultas ou vazias não aparecem para o cliente.'),
    h('ul', { class: 'cards' }, list.map((category, index) => {
      const count = itemsOf(category.id).length;
      return h('li', { class: `card${category.visible ? '' : ' is-hidden'}` },
        h('input', {
          class: 'name-input',
          value: category.name,
          'aria-label': 'Nome da aba',
          onkeydown: (event) => {
            if (event.key === 'Enter') event.target.blur();
          },
          onchange: async (event) => {
            const name = event.target.value.trim();
            if (!name) {
              event.target.value = category.name;
              return;
            }
            if (await update('menu_categories', category.id, { name })) {
              category.name = name;
              renderTabs();
              toast('Nome da aba salvo');
            }
          },
        }),
        h('div', { class: 'card-actions' },
          h('label', { class: 'switch' },
            h('input', {
              type: 'checkbox',
              checked: category.visible,
              onchange: async (event) => {
                const visible = event.target.checked;
                if (await update('menu_categories', category.id, { visible })) {
                  category.visible = visible;
                  toast(visible ? `"${category.name}" visível` : `"${category.name}" oculta`);
                  render();
                } else event.target.checked = !visible;
              },
            }),
            h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
            'Visível',
          ),
          h('span', { class: 'muted small' }, `${count} ${count === 1 ? 'item' : 'itens'}`),
          h('span', { class: 'spacer' }),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Subir', disabled: index === 0, onclick: () => move('menu_categories', list, index, -1) }, '↑'),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Descer', disabled: index === list.length - 1, onclick: () => move('menu_categories', list, index, 1) }, '↓'),
          h('button', {
            type: 'button',
            class: 'icon-btn icon-danger',
            'aria-label': `Excluir aba ${category.name}`,
            onclick: async () => {
              const warning = count
                ? `Excluir a aba "${category.name}" e os ${count} itens dela? Não dá para desfazer.`
                : `Excluir a aba "${category.name}"?`;
              if (!confirm(warning)) return;
              const { error } = await supabase.from('menu_categories').delete().eq('id', category.id);
              if (error) {
                toast('Não foi possível excluir a aba.', true);
                return;
              }
              state.categories = state.categories.filter((c) => c.id !== category.id);
              state.items = state.items.filter((i) => i.category_id !== category.id);
              toast('Aba excluída');
              render();
            },
          }, '✕'),
        ),
      );
    })),
    addForm,
  );
}

function renderSettingsView() {
  const s = state.settings;
  const form = h('form', {
    class: 'stack',
    onsubmit: async (event) => {
      event.preventDefault();
      const f = event.target.elements;
      const patch = {
        bar_name: f.bar_name.value.trim() || 'Cardápio',
        tagline: f.tagline.value.trim(),
        notice_text: f.notice_text.value.trim(),
        notice_active: f.notice_active.checked,
        footer_text: f.footer_text.value.trim(),
      };
      if (await update('menu_settings', 1, patch)) {
        Object.assign(state.settings, patch);
        toast('Avisos e informações salvos');
      }
    },
  },
    h('div', { class: 'view-head' }, h('h1', {}, 'Avisos e info')),
    h('fieldset', { class: 'card-plain stack' },
      h('legend', {}, 'Faixa de aviso no topo'),
      h('label', { class: 'field' }, 'Texto do aviso',
        h('input', { name: 'notice_text', value: s.notice_text ?? '', placeholder: 'Happy hour até 20h: Brahma 600ml por R$ 11' })),
      h('label', { class: 'switch' },
        h('input', { name: 'notice_active', type: 'checkbox', checked: Boolean(s.notice_active) }),
        h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
        'Mostrar aviso no cardápio'),
    ),
    h('fieldset', { class: 'card-plain stack' },
      h('legend', {}, 'Informações do bar'),
      h('label', { class: 'field' }, 'Nome do bar', h('input', { name: 'bar_name', value: s.bar_name ?? '' })),
      h('label', { class: 'field' }, 'Frase abaixo do nome', h('input', { name: 'tagline', value: s.tagline ?? '', placeholder: 'Ex.: Aberto de quarta a domingo, das 18h às 2h' })),
      h('label', { class: 'field' }, 'Texto do rodapé', h('textarea', { name: 'footer_text', rows: 2, value: s.footer_text ?? '', placeholder: 'Ex.: Rua Exemplo, 123 · @seubar' })),
    ),
    h('button', { type: 'submit', class: 'btn btn-gold btn-block' }, 'Salvar avisos e informações'),
  );
  return form;
}

/* ---------- Edição de item ---------- */

const dialog = $('item-dialog');
const itemForm = $('item-form');
let editing = null; // item existente, ou null para novo

function openItem(item, categoryId) {
  editing = item;
  const f = itemForm.elements;
  $('item-dialog-title').textContent = item ? 'Editar item' : 'Novo item';
  $('item-delete').hidden = !item;
  $('item-error').hidden = true;
  f.category_id.replaceChildren(...categoriesSorted().map((c) => h('option', { value: c.id }, c.name)));
  f.name.value = item?.name ?? '';
  f.detail.value = item?.detail ?? '';
  f.description.value = item?.description ?? '';
  f.price.value = item ? formatPrice(item.price).replace(/^R\$\s?/, '') : '';
  f.promo_price.value = item?.promo_price !== null && item?.promo_price !== undefined
    ? formatPrice(item.promo_price).replace(/^R\$\s?/, '')
    : '';
  f.badge.value = item?.badge ?? '';
  f.category_id.value = item?.category_id ?? categoryId;
  f.available.checked = item?.available ?? true;
  f.visible.checked = item?.visible ?? true;
  dialog.showModal();
  if (!item) f.name.focus();
}

dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());

function formError(message) {
  $('item-error').textContent = message;
  $('item-error').hidden = false;
}

itemForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const f = itemForm.elements;
  const price = parsePrice(f.price.value);
  const promoText = f.promo_price.value.trim();
  const promo_price = promoText ? parsePrice(promoText) : null;
  if (price === null) return formError('Preço inválido. Use números, como 14,50.');
  if (promoText && promo_price === null) return formError('Preço promocional inválido. Deixe vazio para tirar a promoção.');
  if (promo_price !== null && promo_price >= price) return formError('O preço promocional precisa ser menor que o preço normal.');

  const row = {
    name: f.name.value.trim(),
    detail: f.detail.value.trim(),
    description: f.description.value.trim(),
    price,
    promo_price,
    badge: f.badge.value || null,
    category_id: f.category_id.value,
    available: f.available.checked,
    visible: f.visible.checked,
  };
  if (!row.name) return formError('Dê um nome ao item.');

  if (editing && editing.category_id !== row.category_id) {
    row.position = nextPosition(row.category_id);
  }
  if (!editing) row.position = nextPosition(row.category_id);

  const query = editing
    ? supabase.from('menu_items').update(row).eq('id', editing.id).select().single()
    : supabase.from('menu_items').insert(row).select().single();
  const { data, error } = await query;
  if (error) {
    console.error(error);
    return formError('Não salvou. Verifique a conexão e tente de novo.');
  }
  if (editing) Object.assign(editing, data);
  else state.items.push(data);
  dialog.close();
  toast(editing ? 'Item salvo' : 'Item adicionado');
  render();
});

function nextPosition(categoryId) {
  const list = itemsOf(categoryId);
  return list.length ? Math.max(...list.map((i) => i.position)) + 1 : 0;
}

$('item-delete').addEventListener('click', async () => {
  if (!editing || !confirm(`Excluir "${editing.name} ${editing.detail}"? Não dá para desfazer.`.replace(' "?', '"?'))) return;
  const { error } = await supabase.from('menu_items').delete().eq('id', editing.id);
  if (error) return formError('Não foi possível excluir.');
  state.items = state.items.filter((i) => i.id !== editing.id);
  dialog.close();
  toast('Item excluído');
  render();
});
