# Engrenagens-LTDA

## Loja virtual
Site de vendas responsivo em `index.html`, com catálogo, busca, filtros, carrinho, checkout demonstrativo e formulário de orçamento técnico.

## Publicação
O projeto está pronto para hospedagem estática como GitHub Pages, Vercel ou Netlify. Para vendas reais, conecte backend, gateway de pagamento, estoque e os canais comerciais da empresa.

## Backend

A loja agora possui uma API Node.js/Express em `server/src/server.js`.

### Rodar localmente

```bash
npm install
npm run dev
```

A API inicia por padrão em `http://localhost:3000`.

### Endpoints

- `GET /api/health` — verifica a API.
- `GET /api/products` — consulta o catálogo do servidor.
- `POST /api/orders` — cria pedido, valida estoque e baixa as quantidades.
- `GET /api/orders/:orderNumber` — consulta um pedido (exige a chave administrativa `x-admin-key`).

Para conectar o checkout à API, ajuste `config.js`:

```js
window.API_BASE_URL = 'https://api.seudominio.com';
```

Sem uma URL configurada, o checkout permanece em modo demonstrativo.

> A persistência atual usa arquivos JSON e é adequada para desenvolvimento/protótipo. Antes de produção, substitua por banco de dados, autenticação, controle de concorrência, logs e gateway de pagamento.

## Painel administrativo

Abra `admin.html` para consultar pedidos e editar preço/preço anterior/estoque dos produtos. O painel exige uma chave que não deve ser publicada.

### Configurar a chave administrativa

```bash
cp .env.example .env
```

Edite o arquivo `.env` e troque `ADMIN_API_KEY` por uma chave forte e exclusiva. O `.env` está no `.gitignore` e não deve ser enviado ao GitHub.

Depois instale a nova dependência e reinicie a API:

```bash
npm install
npm run dev
```

No painel `admin.html`, informe a URL da API (localmente `http://localhost:3000`) e a mesma chave configurada no servidor. A chave fica em `sessionStorage` apenas para a sessão atual.

Rotas administrativas protegidas por `x-admin-key`:

- `GET /api/admin/orders` — consulta todos os pedidos.
- `PATCH /api/admin/products/:id` — atualiza preço, preço anterior, estoque e selo.

Em produção, configure `CORS_ORIGIN` para a origem exata do frontend, publique a API com HTTPS e use banco de dados persistente antes de processar vendas reais.

### Gestão de status dos pedidos

No painel `admin.html`, cada pedido pode avançar pelo fluxo permitido:

- `pending_payment` → `paid` ou `cancelled`.
- `paid` → `processing` ou `cancelled`.
- `processing` → `shipped` ou `cancelled`.
- `shipped` → `completed`.
- Pedidos concluídos ou cancelados não podem ser reabertos pelo painel.

Ao cancelar um pedido, a API devolve as quantidades dos itens ao estoque e registra a data do cancelamento. Se já houve pagamento em um provedor externo, o estorno financeiro precisa ser feito separadamente no provedor.

Endpoint administrativo protegido:

- `PATCH /api/admin/orders/:orderNumber` — atualiza o status do pedido conforme as transições permitidas.
