import { supabase, fetchMenu, formatPrice, slugify, h, BADGES } from './shared.js';

const els = {
  barName: document.getElementById('bar-name'),
  tagline: document.getElementById('tagline'),
  notice: document.getElementById('notice'),
  tabs: document.getElementById('tabs'),
  panel: document.getElementById('panel'),
  spine: document.getElementById('spine-label'),
  footer: document.getElementById('footer-text'),
};

let sections = [];
let firstLoad = true;
let activeSlug = decodeURIComponent(location.hash.slice(1));

async function load() {
  try {
    const { settings, categories, items } = await fetchMenu();
    // Filtra de novo aqui: se o dono estiver logado neste aparelho, o banco devolve também o que está escondido.
    sections = categories
      .filter((c) => c.visible)
      .map((c) => ({
        ...c,
        slug: slugify(c.name),
        items: items.filter((i) => i.category_id === c.id && i.visible),
      }))
      .filter((c) => c.items.length > 0);
    renderHeader(settings);
    renderTabs();
    renderPanel(firstLoad);
    firstLoad = false;
  } catch (error) {
    console.error(error);
    if (!sections.length) {
      els.panel.replaceChildren(h('p', { class: 'state' }, 'Não foi possível carregar o cardápio. Verifique sua conexão e recarregue a página.'));
    }
  }
}

function renderHeader(settings) {
  const name = settings.bar_name || 'Cardápio';
  els.barName.textContent = name;
  document.title = `Cardápio · ${name}`;
  els.tagline.textContent = settings.tagline || '';
  els.tagline.hidden = !settings.tagline;
  els.notice.textContent = settings.notice_text || '';
  els.notice.hidden = !(settings.notice_active && settings.notice_text);
  els.footer.textContent = settings.footer_text || '';
  els.footer.hidden = !settings.footer_text;
}

function currentSection() {
  return sections.find((s) => s.slug === activeSlug) ?? sections[0];
}

function renderTabs() {
  const current = currentSection();
  els.tabs.replaceChildren(
    ...sections.map((s) =>
      h('a', {
        class: 'tab',
        href: `#${s.slug}`,
        role: 'tab',
        'aria-selected': String(s === current),
        onclick: (event) => {
          event.preventDefault();
          select(s.slug);
        },
      }, s.name),
    ),
  );
  els.tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function renderPanel(animate = false) {
  const section = currentSection();
  if (!section) {
    els.panel.replaceChildren(h('p', { class: 'state' }, 'O cardápio está sendo atualizado. Volte em instantes.'));
    els.spine.textContent = '';
    return;
  }
  els.spine.textContent = section.name;
  els.panel.replaceChildren(
    h('h2', { class: 'section-title' }, section.name),
    h('ul', { class: animate ? 'items is-entering' : 'items' }, section.items.map(renderItem)),
  );
}

function renderItem(item) {
  const promo = item.promo_price !== null && Number(item.promo_price) < Number(item.price);
  const price = !item.available
    ? h('span', { class: 'price price-out' }, 'Esgotado')
    : promo
      ? h('span', { class: 'price' },
          h('s', { class: 'price-old' }, formatPrice(item.price)),
          formatPrice(item.promo_price))
      : h('span', { class: 'price' }, formatPrice(item.price));

  return h('li', { class: `item${item.available ? '' : ' is-out'}` },
    h('p', { class: 'item-line' },
      h('span', { class: 'item-name' },
        h('strong', {}, item.name),
        item.detail ? h('span', { class: 'item-detail' }, ` ${item.detail}`) : null,
        item.badge && BADGES[item.badge] ? h('span', { class: `badge badge-${item.badge}` }, BADGES[item.badge]) : null,
      ),
      price,
    ),
    item.description ? h('p', { class: 'item-desc' }, item.description) : null,
  );
}

function select(slug) {
  if (slug === currentSection()?.slug) return;
  activeSlug = slug;
  history.replaceState(null, '', `#${slug}`);
  renderTabs();
  renderPanel(true);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

window.addEventListener('hashchange', () => {
  activeSlug = decodeURIComponent(location.hash.slice(1));
  renderTabs();
  renderPanel(true);
});

// Tempo real: qualquer edição carimba menu_settings, e a página recarrega o cardápio.
let reloadTimer;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(load, 400);
}

supabase
  .channel('cardapio')
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'menu_settings' }, scheduleReload)
  .subscribe();

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleReload();
});

load();
