import {
  fetchMenu, formatPrice, slugify, h, BADGES,
  barNow, promotionStatus, promotionAppliesTo, formatCountdown, formatTime,
} from './shared.js?v=202610311626';

const els = {
  barName: document.getElementById('bar-name'),
  tagline: document.getElementById('tagline'),
  notice: document.getElementById('notice'),
  tabs: document.getElementById('tabs'),
  panel: document.getElementById('panel'),
  footer: document.getElementById('footer-text'),
  promos: document.getElementById('promo-banner'),
};

let sections = [];
let firstLoad = true;
let activeSlug = decodeURIComponent(location.hash.slice(1));

const CACHE_KEY = 'menu-cache-v1';
let lastJson = '';

let currentMenu = null;
let activePromoKey = '';

function show(menu) {
  currentMenu = menu;
  const { settings, categories, items } = menu;
  const now = barNow();
  const running = (menu.promotions ?? []).filter((p) => promotionStatus(p, now).active);
  activePromoKey = running.map((p) => p.id).join();

  sections = categories
    .filter((c) => c.visible)
    .map((c) => ({
      ...c,
      slug: slugify(c.name),
      items: items.filter((i) => i.category_id === c.id && i.visible).map((i) => withPromotions(i, running)),
    }))
    .filter((c) => c.items.length > 0);
  renderHeader(settings);
  renderTabs();
  renderPanel(firstLoad);
  renderPromoBanner();
  firstLoad = false;
}

// Aplica a promoção programada que estiver valendo agora (fica com o menor preço, se houver mais de uma).
function withPromotions(item, running) {
  const prices = running.filter((p) => promotionAppliesTo(p, item)).map((p) => Number(p.price));
  if (item.promo_price !== null) prices.push(Number(item.promo_price));
  const best = Math.min(...prices);
  if (!(best < Number(item.price))) return item;
  return { ...item, promo_price: best, badge: item.badge || 'promo' };
}

/* ---------- Faixa de promoções com cronômetro ---------- */

function promoTarget(promo) {
  const category = currentMenu.categories.find((c) => c.id === promo.category_id);
  const name = category?.name ?? '';
  // Evita concordância errada ("Todos os cervejas"): usa o nome da aba como está
  return promo.item_ids ? `${name}: itens selecionados` : name;
}

const promoTrack = document.getElementById('promo-track');
const promoDots = document.getElementById('promo-dots');
let bannerKey = '';
let bannerIndex = 0;
let pausedUntil = 0;

function currentPromos() {
  const now = barNow();
  const visible = new Set(sections.map((s) => s.id));
  return (currentMenu.promotions ?? [])
    .filter((p) => visible.has(p.category_id))
    .map((p) => ({ promo: p, status: promotionStatus(p, now) }))
    .filter(({ status }) => status.active || status.startsIn !== undefined)
    .sort((a, b) => Number(b.status.active) - Number(a.status.active));
}

const promoTagText = (promo, status) =>
  status.active ? 'Promoção agora' : `Hoje das ${formatTime(promo.start_time)} às ${formatTime(promo.end_time)}`;

// Monta os cards só quando a lista muda; a cada segundo atualiza apenas os cronômetros,
// para não atrapalhar quem está arrastando o carrossel.
function renderPromoBanner() {
  if (!currentMenu) return;
  const promos = currentPromos();
  const key = promos.map(({ promo, status }) => promo.id + (status.active ? '+' : '-') + (promo.image_url ?? '')).join();
  els.promos.hidden = promos.length === 0;

  if (key !== bannerKey) {
    bannerKey = key;
    promoTrack.replaceChildren(...promos.map(({ promo, status }) => {
      const slug = sections.find((s) => s.id === promo.category_id)?.slug;
      return h('button', {
        type: 'button',
        class: `promo-card${status.active ? ' is-live' : ''}${promo.image_url ? ' has-image' : ''}`,
        dataset: { id: promo.id },
        style: promo.image_url ? `--promo-image: url(${JSON.stringify(promo.image_url)})` : null,
        onclick: () => slug && select(slug),
      },
        h('span', { class: 'promo-tag' }, promoTagText(promo, status)),
        h('span', { class: 'promo-name' }, promo.name),
        h('span', { class: 'promo-offer' }, `${promoTarget(promo)} por ${formatPrice(promo.price)}`),
        h('span', { class: 'promo-timer' },
          status.active ? 'termina em ' : 'começa em ',
          h('strong', { class: 'promo-clock' }, '')),
      );
    }));
    promoDots.hidden = promos.length < 2;
    promoDots.replaceChildren(...promos.map(() => h('span', { class: 'dot' })));
    bannerIndex = Math.min(bannerIndex, Math.max(0, promos.length - 1));
    scrollToPromo(bannerIndex, false);
  }

  promos.forEach(({ promo, status }) => {
    const clock = promoTrack.querySelector(`[data-id="${promo.id}"] .promo-clock`);
    if (clock) clock.textContent = formatCountdown(status.active ? status.endsIn : status.startsIn);
  });
  updateDots();
}

function promoStep() {
  const card = promoTrack.firstElementChild;
  if (!card) return 0;
  return card.offsetWidth + parseFloat(getComputedStyle(promoTrack).columnGap || 0);
}

function scrollToPromo(index, smooth = true) {
  const step = promoStep();
  if (!step) return;
  const left = Math.min(index * step, promoTrack.scrollWidth - promoTrack.clientWidth);
  if (smooth) slideTo(left);
  else promoTrack.scrollLeft = left;
}

// Deslize próprio (não depende do "smooth" do navegador, que no iPhone costuma pular direto).
// Durante a animação o encaixe fica desligado, senão ele puxa o card antes da hora.
let slideFrame = 0;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function slideTo(left, duration = 900) {
  stopSlide();
  const from = promoTrack.scrollLeft;
  const start = performance.now();
  promoTrack.style.scrollSnapType = 'none';
  const frame = (now) => {
    const t = Math.min(1, (now - start) / duration);
    promoTrack.scrollLeft = from + (left - from) * ease(t);
    if (t < 1) slideFrame = requestAnimationFrame(frame);
    else stopSlide();
  };
  slideFrame = requestAnimationFrame(frame);
}

function stopSlide() {
  cancelAnimationFrame(slideFrame);
  slideFrame = 0;
  promoTrack.style.scrollSnapType = '';
}

function updateDots() {
  [...promoDots.children].forEach((dot, i) => dot.classList.toggle('is-active', i === bannerIndex));
}

promoTrack.addEventListener('scroll', () => {
  const step = promoStep();
  if (!step) return;
  bannerIndex = Math.min(promoTrack.children.length - 1, Math.round(promoTrack.scrollLeft / step));
  updateDots();
}, { passive: true });

// Se a pessoa mexer no carrossel, a troca automática espera um pouco
for (const type of ['pointerdown', 'touchstart', 'wheel']) {
  promoTrack.addEventListener(type, () => {
    pausedUntil = Date.now() + 10000;
    if (slideFrame) stopSlide(); // o dedo manda: interrompe o deslize automático
  }, { passive: true });
}

// Troca de card a cada 5 segundos; depois do último volta para o primeiro
setInterval(() => {
  const count = promoTrack.children.length;
  if (count < 2 || els.promos.hidden || document.hidden || Date.now() < pausedUntil) return;
  bannerIndex = (bannerIndex + 1) % count;
  scrollToPromo(bannerIndex);
  updateDots();
}, 5000);

// A cada segundo: atualiza os cronômetros e, quando uma promoção começa ou acaba, os preços.
setInterval(() => {
  if (!currentMenu || document.hidden) return;
  const now = barNow();
  const key = (currentMenu.promotions ?? []).filter((p) => promotionStatus(p, now).active).map((p) => p.id).join();
  if (key !== activePromoKey) {
    show(currentMenu);
    return;
  }
  renderPromoBanner();
}, 1000);

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

/* ---------- Abas em "vidro líquido" ---------- */
// A gota de vidro (tab-drop) desliza atrás das abas. As abas brancas ganham um "furo" onde a gota
// está, e uma cópia roxa das abas aparece só dentro dela: a cor "escorre" junto com a gota e, enquanto
// ela se move, o texto lá dentro aumenta um pouco, como uma lente.
const tabsGlass = document.querySelector('.tabs-glass');
const drop = h('span', { class: 'tab-drop', 'aria-hidden': 'true' });
const tabsRow = h('div', { class: 'tabs-row', role: 'tablist', 'aria-label': 'Seções do cardápio' });
const inkRow = h('div', { class: 'tabs-ink-row' });
const ink = h('div', { class: 'tabs-ink', 'aria-hidden': 'true' }, inkRow);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

// Duas bordas com molas diferentes: a da frente é mais rígida, então a gota estica na direção
// do movimento, passa um pouco do ponto e assenta com elasticidade, como gel.
const dropState = { l: 0, r: 0, vl: 0, vr: 0, tl: 0, tr: 0, lens: 1, energy: 0, dir: 1, frame: 0, last: 0 };
let jumpDrop = true;

function renderTabs() {
  const current = currentSection();
  const signature = sections.map((s) => `${s.slug}:${s.name}`).join('|');
  if (els.tabs.dataset.signature !== signature) {
    els.tabs.dataset.signature = signature;
    tabsRow.replaceChildren(...sections.map((s) =>
      h('a', { class: 'tab', href: `#${s.slug}`, role: 'tab', dataset: { slug: s.slug } }, s.name)));
    inkRow.replaceChildren(...sections.map((s) => h('span', { class: 'tab tab-ink' }, s.name)));
    if (!els.tabs.contains(tabsRow)) els.tabs.replaceChildren(drop, tabsRow, ink);
    jumpDrop = true;
  }
  for (const tab of tabsRow.children) tab.setAttribute('aria-selected', String(tab.dataset.slug === current?.slug));
  moveDrop();
  tabsRow.querySelector('[aria-selected="true"]')
    ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
}

// Um clique dentro da gota cai no "furo" das abas; por isso o clique é resolvido pela posição.
els.tabs.addEventListener('click', (event) => {
  event.preventDefault();
  const tab = event.target.closest('.tab[data-slug]') ?? tabAt(event.clientX);
  if (tab) select(tab.dataset.slug);
});

function tabAt(clientX) {
  const x = clientX - els.tabs.getBoundingClientRect().left + els.tabs.scrollLeft;
  return [...tabsRow.children].find((t) => x >= t.offsetLeft && x <= t.offsetLeft + t.offsetWidth);
}

// Ao tocar, o vidro se ilumina a partir do ponto do dedo
els.tabs.addEventListener('pointerdown', (event) => {
  const rect = tabsGlass.getBoundingClientRect();
  tabsGlass.style.setProperty('--px', `${event.clientX - rect.left}px`);
  tabsGlass.classList.remove('is-touched');
  void tabsGlass.offsetWidth;
  tabsGlass.classList.add('is-touched');
});

function moveDrop() {
  const active = tabsRow.querySelector('.tab[aria-selected="true"]');
  if (!active) return;
  const d = dropState;
  d.tl = active.offsetLeft;
  d.tr = active.offsetLeft + active.offsetWidth;
  if (jumpDrop || reduceMotion.matches) {
    jumpDrop = false;
    Object.assign(d, { l: d.tl, r: d.tr, vl: 0, vr: 0, lens: 1, energy: 0 });
    paintDrop();
    return;
  }
  d.dir = Math.sign(d.tl + d.tr - (d.l + d.r)) || d.dir;
  if (!d.frame) {
    d.last = performance.now();
    d.frame = requestAnimationFrame(stepDrop);
  }
}

function stepDrop(now) {
  const d = dropState;
  const dt = Math.min(0.05, (now - d.last) / 1000);
  d.last = now;
  const lead = d.dir > 0 ? 'r' : 'l';
  const steps = Math.max(1, Math.ceil(dt * 240));
  const sub = dt / steps;
  for (let i = 0; i < steps; i++) {
    for (const edge of ['l', 'r']) {
      const stiff = edge === lead ? 330 : 165;
      const damp = edge === lead ? 23 : 18.5;
      const accel = stiff * (d[`t${edge}`] - d[edge]) - damp * d[`v${edge}`];
      d[`v${edge}`] += accel * sub;
      d[edge] += d[`v${edge}`] * sub;
    }
  }
  const speed = (Math.abs(d.vl) + Math.abs(d.vr)) / 2;
  d.lens += (Math.min(1.16, 1 + speed / 9000) - d.lens) * Math.min(1, dt * 16);
  d.energy += (Math.min(1, speed / 1500) - d.energy) * Math.min(1, dt * 9);
  const settled = ['l', 'r'].every((e) => Math.abs(d[`t${e}`] - d[e]) < 0.3 && Math.abs(d[`v${e}`]) < 4)
    && d.lens < 1.003 && d.energy < 0.02;
  if (settled) Object.assign(d, { l: d.tl, r: d.tr, vl: 0, vr: 0, lens: 1, energy: 0, frame: 0 });
  paintDrop();
  if (!settled) d.frame = requestAnimationFrame(stepDrop);
}

function paintDrop() {
  const d = dropState;
  const style = els.tabs.style;
  style.setProperty('--dl', `${d.l.toFixed(2)}px`);
  style.setProperty('--dw', `${Math.max(0, d.r - d.l).toFixed(2)}px`);
  style.setProperty('--lens', d.lens.toFixed(4));
  style.setProperty('--energy', d.energy.toFixed(3));
}

/* ---------- Lente de verdade (só no Chrome/Android) ---------- */
// O Chrome aceita um filtro SVG como backdrop-filter: um mapa de distorção curva o que passa
// atrás da barra perto das bordas, como uma lente. Outros navegadores (Safari/iPhone) ficam com
// o vidro desfocado e os brilhos, que já funcionam em todos.
const lensSupported = /Chrome\/\d+/.test(navigator.userAgent)
  && !matchMedia('(prefers-reduced-transparency: reduce)').matches;

function buildLensMap() {
  if (!lensSupported) return;
  const w = Math.round(tabsGlass.offsetWidth);
  const hgt = Math.round(tabsGlass.offsetHeight);
  if (!w || !hgt) return;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(w, hgt);
  const radius = hgt / 2;
  const bezel = Math.min(16, radius);
  const maxShift = 12; // px
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      // ponto mais próximo no eixo central da cápsula
      const ax = Math.min(Math.max(px, radius), w - radius);
      const dx = ax - px;
      const dy = radius - py;
      const dist = Math.hypot(dx, dy);
      const edge = radius - dist; // distância até a borda
      let red = 128;
      let green = 128;
      if (edge > 0 && edge < bezel && dist > 0) {
        const t = 1 - edge / bezel; // 1 na borda, 0 onde o bisel acaba
        const m = t * t; // mais forte perto da borda, como uma superfície arredondada
        red = 128 + (dx / dist) * m * 127;
        green = 128 + (dy / dist) * m * 127;
      }
      const i = (y * w + x) * 4;
      image.data[i] = red;
      image.data[i + 1] = green;
      image.data[i + 2] = 128;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const filter = document.getElementById('tabs-lens');
  const map = document.getElementById('tabs-lens-map');
  for (const el of [filter, map]) {
    el.setAttribute('width', w);
    el.setAttribute('height', hgt);
  }
  map.setAttribute('href', canvas.toDataURL());
  filter.querySelector('feDisplacementMap').setAttribute('scale', maxShift * 2);
  tabsGlass.classList.add('has-lens');
}

// A largura das abas muda quando a fonte termina de carregar; a barra muda de tamanho quando as
// abas aparecem ou a tela gira (aí a lente precisa de um mapa novo, do tamanho exato da barra)
function relayoutTabs() {
  jumpDrop = true;
  moveDrop();
}
document.fonts?.ready.then(relayoutTabs);

let lensFrame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(lensFrame);
  lensFrame = requestAnimationFrame(() => {
    relayoutTabs();
    buildLensMap();
  });
}).observe(tabsGlass);

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
    const { supabase } = await import('./client.js?v=202610311626');
    supabase
      .channel('cardapio')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'menu_settings' }, scheduleReload)
      .subscribe();
  } catch (error) {
    console.error(error); // sem tempo real, o cardápio ainda atualiza ao voltar para a página
  }
}
