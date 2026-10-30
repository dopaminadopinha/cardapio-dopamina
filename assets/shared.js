import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=202610300504';

export const BADGES = {
  novo: 'Novo',
  mais_pedido: 'Mais pedido',
  promo: 'Promo',
};

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatPrice(value) {
  return brl.format(Number(value) || 0);
}

// "14,50", "14.50" ou "R$ 14,50" → 14.5 (null se não for um número válido)
export function parsePrice(text) {
  const clean = String(text).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (clean === '') return null;
  const value = Number(clean);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
}

export function slugify(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Cria elementos sem innerHTML, para nenhum texto do banco virar HTML.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'value' || (key in el && typeof value !== 'string')) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

// Busca direto pela API REST, sem a biblioteca do Supabase: o cardápio aparece bem mais rápido no celular.
export async function fetchMenu(headers = {}) {
  const get = async (path) => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPABASE_KEY, ...headers },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Falha ao carregar ${path}: ${response.status}`);
    return response.json();
  };
  const [settings, categories, items] = await Promise.all([
    get('menu_settings?select=*&id=eq.1'),
    get('menu_categories?select=*&order=position.asc,created_at.asc'),
    get('menu_items?select=*&order=position.asc,created_at.asc'),
  ]);
  return { settings: settings[0] ?? {}, categories, items };
}
