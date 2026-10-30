import { fetchMenu, formatPrice, slugify, h, BADGES } from './shared.js?v=202610300540';

const els = {
  barName: document.getElementById('bar-name'),
  tagline: document.getElementById('tagline'),
  notice: document.getElementById('notice'),
  tabs: document.getElementById('tabs'),
  panel: document.getElementById('panel'),
  footer: document.getElementById('footer-text'),
};

let sections = [];
let firstLoad = true;
let activeSlug = decodeURIComponent(location.hash.slice(1));

const CACHE_KEY = 'menu-cache-v1';
let lastJson = '';

function show(menu) {
  const { settings, categories, items } = menu;
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
}

async function load() {
  try {
    const menu = await fetchMenu();
    const json = JSON.stringify(menu);
    if (json === lastJson) return; // nada mudou desde o que já está na tela
    lastJson = json;
    show(menu);
    try {
      localStorage.setItem(CACHE_KEY, json);
    } catch {}
  } catch (error) {
    console.error(error);
    if (!sections.length) {
      els.panel.replaceChildren(h('p', { class: 'state' }, 'Não foi possível carregar o cardápio. Verifique sua conexão e recarregue a página.'));
    }
  }
}

// Na volta ao cardápio, mostra na hora a última versão guardada neste celular e atualiza em seguida.
function showCached() {
  try {
    const json = localStorage.getItem(CACHE_KEY);
    if (!json) return;
    lastJson = json;
    show(JSON.parse(json));
  } catch {}
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
    return;
  }
  // Em abas com dois preços, os itens sem foto usam colunas; o cabeçalho das colunas só aparece se houver algum.
  const columns = section.price2_label && section.items.some((i) => !i.image_url);
  els.panel.replaceChildren(...[
    h('h2', { class: 'section-title' }, section.name),
    columns
      ? h('p', { class: 'price-head' },
          h('span', { class: 'price-head-label' }, section.price_label || 'R$'),
          h('span', { class: 'price-head-label' }, section.price2_label))
      : null,
    h('ul', { class: animate ? 'items is-entering' : 'items' }, section.items.map((item) => renderItem(item, section))),
  ].filter(Boolean));
}

function renderItem(item, section) {
  return item.image_url ? renderPhotoItem(item, section) : renderPlainItem(item, section);
}

function itemPrice(item, money) {
  if (!item.available) return h('span', { class: 'price price-out' }, 'Esgotado');
  const promo = item.promo_price !== null && Number(item.promo_price) < Number(item.price);
  return h('span', { class: 'price' },
    promo ? h('s', { class: 'price-old' }, money(item.price)) : null,
    money(promo ? item.promo_price : item.price));
}

function badge(item) {
  return item.badge && BADGES[item.badge] ? h('span', { class: `badge badge-${item.badge}` }, BADGES[item.badge]) : null;
}

// Sem foto: nome à esquerda e preço à direita, numa linha só (layout clássico).
function renderPlainItem(item, section) {
  const twoPrices = Boolean(section.price2_label);
  const money = twoPrices ? (value) => formatPrice(value).replace(/^R\$\s?/, '') : formatPrice;
  return h('li', { class: `item item-plain${item.available ? '' : ' is-out'}` },
    h('p', { class: `item-line${twoPrices ? ' has-two-prices' : ''}` },
      h('span', { class: 'item-name' },
        h('strong', {}, item.name),
        item.detail ? h('span', { class: 'item-detail' }, ` ${item.detail}`) : null,
        badge(item),
      ),
      itemPrice(item, money),
      twoPrices
        ? h('span', { class: 'price' }, item.available && item.price2 !== null ? money(item.price2) : '')
        : null,
    ),
    item.description ? h('p', { class: 'item-desc' }, item.description) : null,
  );
}

// Com foto: texto e preço à esquerda, foto pequena à direita; tocar abre a foto grande.
function renderPhotoItem(item, section) {
  const twoPrices = Boolean(section.price2_label);
  const label = (text) => (twoPrices && text ? h('span', { class: 'price-label' }, text) : null);
  const first = itemPrice(item, formatPrice);
  if (item.available) first.prepend(...[label(section.price_label)].filter(Boolean));
  const prices = [
    first,
    item.available && twoPrices && item.price2 !== null
      ? h('span', { class: 'price' }, label(section.price2_label), formatPrice(item.price2))
      : null,
  ];

  return h('li', { class: `item item-photo-row${item.available ? '' : ' is-out'}` },
    h('button', {
      type: 'button',
      class: 'item-row',
      'aria-label': `Ver foto: ${item.name} ${item.detail}`.trim(),
      onclick: () => openPhoto(item),
    },
      h('span', { class: 'item-body' },
        h('span', { class: 'item-title' }, item.name, badge(item)),
        item.detail ? h('span', { class: 'item-sub' }, item.detail) : null,
        item.description ? h('span', { class: 'item-desc' }, item.description) : null,
        h('span', { class: 'item-prices' }, prices),
      ),
      h('img', { class: 'item-photo', src: item.thumb_url || item.image_url, alt: '', loading: 'lazy', decoding: 'async' }),
    ),
  );
}

/* ---------- Foto do item (desliza para ver as outras fotos da aba) ---------- */

const photoDialog = document.getElementById('photo-dialog');
const photoImg = document.getElementById('photo-img');
let gallery = [];
let galleryIndex = 0;

function openPhoto(item) {
  gallery = currentSection().items.filter((i) => i.image_url);
  galleryIndex = Math.max(0, gallery.indexOf(item));
  showPhoto(0);
  photoDialog.showModal();
}

function showPhoto(direction) {
  const section = currentSection();
  const twoPrices = Boolean(section.price2_label);
  const item = gallery[galleryIndex];
  photoImg.src = item.image_url;
  photoImg.alt = `${item.name} ${item.detail}`.trim();
  photoImg.classList.remove('slide-next', 'slide-prev');
  if (direction) {
    void photoImg.offsetWidth; // reinicia a animação
    photoImg.classList.add(direction > 0 ? 'slide-next' : 'slide-prev');
  }
  document.getElementById('photo-name').replaceChildren(
    h('strong', {}, item.name),
    ...(item.detail ? [h('span', { class: 'item-detail' }, ` ${item.detail}`)] : []),
  );
  const promo = item.promo_price !== null && Number(item.promo_price) < Number(item.price);
  document.getElementById('photo-price').textContent = !item.available
    ? 'Esgotado'
    : [
        `${twoPrices && section.price_label ? `${section.price_label}: ` : ''}${formatPrice(promo ? item.promo_price : item.price)}`,
        twoPrices && item.price2 !== null ? `${section.price2_label}: ${formatPrice(item.price2)}` : null,
      ].filter(Boolean).join(' · ');
  const desc = document.getElementById('photo-desc');
  desc.textContent = item.description || '';
  desc.hidden = !item.description;

  const many = gallery.length > 1;
  document.getElementById('photo-prev').hidden = !many;
  document.getElementById('photo-next').hidden = !many;
  const dots = document.getElementById('photo-dots');
  dots.hidden = !many;
  dots.replaceChildren(...gallery.map((_, i) => h('span', { class: i === galleryIndex ? 'dot is-active' : 'dot' })));
  // Já carrega a próxima foto para o deslize ser instantâneo
  if (many) new Image().src = gallery[(galleryIndex + 1) % gallery.length].image_url;
}

function step(delta) {
  if (gallery.length < 2) return;
  galleryIndex = (galleryIndex + delta + gallery.length) % gallery.length;
  showPhoto(delta);
}

document.getElementById('photo-prev').addEventListener('click', () => step(-1));
document.getElementById('photo-next').addEventListener('click', () => step(1));

photoDialog.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') step(1);
  if (event.key === 'ArrowLeft') step(-1);
});

let touchStart = null;
photoDialog.addEventListener('touchstart', (event) => {
  touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
}, { passive: true });
photoDialog.addEventListener('touchend', (event) => {
  if (!touchStart) return;
  const dx = event.changedTouches[0].clientX - touchStart.x;
  const dy = event.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
});

photoDialog.addEventListener('click', (event) => {
  // Toque fora da foto (no fundo escuro) ou no botão fecha
  if (event.target === photoDialog || event.target.closest('[data-close]')) photoDialog.close();
});

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

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleReload();
});

showCached();
load().then(startLiveUpdates);

// Tempo real: a biblioteca do Supabase só é baixada depois que o cardápio já está na tela.
async function startLiveUpdates() {
  try {
    const { supabase } = await import('./client.js?v=202610300540');
    supabase
      .channel('cardapio')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'menu_settings' }, scheduleReload)
      .subscribe();
  } catch (error) {
    console.error(error); // sem tempo real, o cardápio ainda atualiza ao voltar para a página
  }
}
