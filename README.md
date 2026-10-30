# Cardápio online

Cardápio para o link da bio do Instagram. O cliente só vê o cardápio; você edita tudo pelo celular em `/admin.html`, e quem estiver com o cardápio aberto vê a mudança na hora.

- `index.html`: cardápio público, com abas (Cervejas, Não alcoólicas, Drinks…). Abas vazias ou ocultas não aparecem.
- `admin.html`: edição, sem login, aberta pelo link secreto `admin.html#chave=...`. Troque preços direto na lista, marque itens como esgotados, crie, edite, reordene e esconda itens e abas, e ligue uma faixa de aviso (ex.: happy hour).
- `supabase/schema.sql`: banco de dados, regras de segurança e o cardápio inicial (cervejas e não alcoólicas).

É um site estático, sem etapa de build: os dados ficam no Supabase (plano gratuito).

## No ar

- Cardápio: https://dopaminadopinha.github.io/cardapio-dopamina/ (GitHub Pages, branch `gh-pages`)
- Banco: projeto `cardapio-dopamina` no Supabase (`supabase/schema.sql` recria tudo em outro projeto)

## Link de edição

A edição não tem login: ela abre pelo link `.../admin.html#chave=SUA-CHAVE`. A chave fica só no banco (tabela `menu_secret`, que a API não deixa ler) e no seu aparelho — nunca no código.

- Veja a chave atual no SQL Editor do Supabase: `select key from menu_secret;`
- Vazou o link? Gere outra chave (o link antigo para de funcionar na hora):
  ```sql
  update menu_secret set key = encode(gen_random_bytes(18), 'hex') returning key;
  ```

## Publicar mudanças no código

O site é estático, sem build. Envie para `main` e atualize `gh-pages` (`git push origin main:gh-pages`).
