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
  const twoPrices = Boolean(section.price2_label);
  const listClass = ['items', animate && 'is-entering', twoPrices && 'has-two-prices'].filter(Boolean).join(' ');
  els.panel.replaceChildren(...[
    h('h2', { class: 'section-title' }, section.name),
    twoPrices
      ? h('p', { class: 'price-head' },
          h('span', { class: 'price-head-label' }, section.price_label || 'R$'),
          h('span', { class: 'price-head-label' }, section.price2_label))
      : null,
    h('ul', { class: listClass }, section.items.map((item) => renderItem(item, twoPrices))),
  ].filter(Boolean));
}

function renderItem(item, twoPrices) {
  const money = twoPrices ? (value) => formatPrice(value).replace(/^R\$\s?/, '') : formatPrice;
  const promo = item.promo_price !== null && Number(item.promo_price) < Number(item.price);
  const price = !item.available
    ? h('span', { class: 'price price-out' }, 'Esgotado')
    : promo
      ? h('span', { class: 'price' },
          h('s', { class: 'price-old' }, money(item.price)),
          money(item.promo_price))
      : h('span', { class: 'price' }, money(item.price));

  const content = [
    h('span', { class: 'item-line' },
      h('span', { class: 'item-name' },
        h('strong', {}, item.name),
        item.detail ? h('span', { class: 'item-detail' }, ` ${item.detail}`) : null,
        item.badge && BADGES[item.badge] ? h('span', { class: `badge badge-${item.badge}` }, BADGES[item.badge]) : null,
      ),
      price,
      twoPrices
        ? h('span', { class: 'price' }, item.available && item.price2 !== null ? money(item.price2) : '')
        : null,
    ),
    item.description ? h('span', { class: 'item-desc' }, item.description) : null,
  ];

  // Item sem foto fica só com o texto; com foto ganha a miniatura e abre a foto ao tocar.
  return h('li', { class: `item${item.available ? '' : ' is-out'}` },
    item.image_url
      ? h('button', {
          type: 'button',
          class: 'item-button',
          'aria-label': `Ver foto: ${item.name} ${item.detail}`.trim(),
          onclick: () => openPhoto(item),
        },
          h('img', { class: 'item-thumb', src: item.image_url, alt: '', loading: 'lazy', decoding: 'async' }),
          h('span', { class: 'item-body' }, content),
        )
      : content,
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

supabase
  .channel('cardapio')
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'menu_settings' }, scheduleReload)
  .subscribe();

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleReload();
});

load();
