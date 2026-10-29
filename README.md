# Cardápio online

Cardápio para o link da bio do Instagram. O cliente só vê o cardápio; você edita tudo pelo celular em `/admin.html`, e quem estiver com o cardápio aberto vê a mudança na hora.

- `index.html`: cardápio público, com abas (Cervejas, Não alcoólicas, Drinks…). Abas vazias ou ocultas não aparecem.
- `admin.html`: edição, com login. Troque preços direto na lista, marque itens como esgotados, crie, edite, reordene e esconda itens e abas, e ligue uma faixa de aviso (ex.: happy hour).
- `supabase/schema.sql`: banco de dados, regras de segurança e o cardápio inicial (cervejas e não alcoólicas).

É um site estático, sem etapa de build: os dados ficam no Supabase (plano gratuito).

## Como colocar no ar

1. **Banco**: já criado no projeto `cardapio-dopamina` do Supabase. Para recriar em outro projeto, rode todo o `supabase/schema.sql` no *SQL Editor*.
2. **Seu login**: em *Authentication → Users → Add user*, crie seu usuário com e-mail e senha (marque *Auto confirm*). Depois, no *SQL Editor*:
   ```sql
   insert into public.menu_admins (user_id)
   select id from auth.users where email = 'seu-email@exemplo.com';
   ```
3. **Bloqueie cadastros novos**: em *Authentication → Sign In / Providers*, desligue *Allow new users to sign up*.
4. **Chaves**: já configuradas em `assets/config.js` (projeto `cardapio-dopamina`). A chave *publishable* pode ficar pública: quem protege os dados são as regras do banco.
5. **Site**: na [Vercel](https://vercel.com), *Add New → Project*, importe este repositório e clique em *Deploy* (sem configurar nada). Coloque o endereço gerado na bio do Instagram.

Para editar: abra `seu-endereco/admin.html` no celular e entre. Dica: use "Adicionar à tela de início" no navegador para virar um ícone de app.
