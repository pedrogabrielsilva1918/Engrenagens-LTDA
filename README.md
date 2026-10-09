# Engrenagens-LTDA

## Executar loja e API localmente

Requer Node.js 20 ou superior.

1. No terminal, na raiz do repositório:

```bash
npm install
cp .env.example .env
```

2. Edite `.env` e defina uma chave administrativa secreta. Gere uma chave de 32 caracteres com:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Cole a saída depois de `ADMIN_API_KEY=` no arquivo `.env`. Não publique esse arquivo.

3. Inicie o servidor:

```bash
npm run dev
```

4. Abra no navegador: **http://localhost:3000**. O servidor entrega a loja, o checkout, os assets públicos e a API pela mesma porta. Não é necessário abrir `index.html` por `file://` nem executar outro servidor estático.

No GitHub Codespaces, abra a porta 3000 na aba **Ports** e use o endereço encaminhado pelo Codespaces. A configuração do frontend detecta automaticamente a porta 3000 quando a página está em um endereço `*.app.github.dev`.

## Páginas

- `/` ou `/index.html` — loja.
- `/checkout.html` — finalização demonstrativa do pedido.
- `/admin.html` — painel administrativo.

O backend só entrega uma lista explícita de arquivos de frontend. Os arquivos de dados em `server/src/data` e o arquivo `.env` não são servidos como arquivos estáticos.

## API

- `GET /api/health` — estado do servidor.
- `GET /api/products` — catálogo e estoque.
- `POST /api/orders` — cria pedido e valida preço/estoque no servidor.
- `GET /api/admin/orders` — consulta pedidos, com chave administrativa.
- `GET /api/orders/:orderNumber` — consulta um pedido, com chave administrativa.
- `PATCH /api/admin/orders/:orderNumber` — atualiza status com transições permitidas, com chave administrativa.
- `PATCH /api/admin/products/:id` — altera preço, preço anterior, estoque e selo, com chave administrativa.

Para verificar a API, abra `http://localhost:3000/api/health` ou rode em outro terminal:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/products
```

## Configuração da chave administrativa

O arquivo `.env.example` é apenas um modelo. Crie seu próprio `.env`; ele já está listado no `.gitignore`. Nunca coloque `ADMIN_API_KEY` em `config.js`, no frontend ou no GitHub.

No painel, informe a URL da API (`http://localhost:3000) e a mesma chave configurada em `.env`. A chave é guardada em `sessionStorage` durante a sessão da aba.

## Funcionamento do pedido

O servidor recalcula subtotais usando os preços do catálogo no backend, agrega itens repetidos para validar estoque, serializa as operações que alteram estoque e grava arquivos JSON usando substituição atômica. Ao cancelar um pedido pelo painel, as quantidades voltam ao estoque.

## Limitações antes de produção

A persistência em JSON é adequada para desenvolvimento/protótipo, não para uma loja comercial com múltiplas instâncias. Antes da produção, migre para banco de dados transacional, configure `CORS_ORIGIN` para a origem exata do frontend, hospede a API em HTTPS, implemente autenticação de administrador e integração real com gateway de pagamento. O status `paid` no painel é manual; não existe confirmação de pagamento automática nem estorno financeiro integrado.
