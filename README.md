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
- `GET /api/orders/:orderNumber` — consulta um pedido.

Para conectar o checkout à API, ajuste `config.js`:

```js
window.API_BASE_URL = 'https://api.seudominio.com';
```

Sem uma URL configurada, o checkout permanece em modo demonstrativo.

> A persistência atual usa arquivos JSON e é adequada para desenvolvimento/protótipo. Antes de produção, substitua por banco de dados, autenticação, controle de concorrência, logs e gateway de pagamento.
