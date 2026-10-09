# Engrenagens-LTDA

## Executar loja e API localmente

Requer Node.js 20 ou superior.

1. No terminal, na raiz do repositório:

```bash
npm install
```

Se o arquivo `.env` ainda não existir, crie-o com `cp .env.example .env`. Se ele já existir, não o sobrescreva; apenas edite-o para adicionar as variáveis que estiverem faltando.

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

5. Em um segundo terminal, rode o diagnóstico:

```bash
npm run check:api
```

O comando verifica saúde da API, catálogo, página inicial, checkout e painel administrativo, além de confirmar que arquivos JSON internos não estão expostos.

No GitHub Codespaces, abra a porta 3000 na aba **Ports** e use o endereço encaminhado pelo Codespaces. A configuração do frontend detecta automaticamente a porta 3000 quando a página está em um endereço `*.app.github.dev`.

## Páginas

- `/` ou `/index.html` — loja.
- `/checkout.html` — finalização demonstrativa do pedido.
- `/admin.html` — painel administrativo.

O backend só entrega uma lista explícita de arquivos de frontend. Os arquivos de dados iniciais ficam em `server/src/data`; na primeira execução, a API os copia para a pasta mutável `/data` na raiz. Essa pasta é ignorada pelo Git e não é servida como conteúdo estático. O arquivo `.env` também não é servido.

## Pagamentos com Mercado Pago (Checkout Pro)

A loja agora possui uma integração opcional com o Checkout Pro do Mercado Pago. Sem credenciais, o sistema permanece no modo demonstrativo e deixa explícito que nenhum pagamento real foi processado.

Para ativar a integração em ambiente de teste:

1. Crie uma aplicação no painel de desenvolvedores do Mercado Pago e obtenha um **Access Token de teste**.
2. Nas configurações de Webhooks da aplicação, configure o evento **Pagamentos** e copie a chave secreta do webhook.
3. No arquivo local `.env` (não no `.env.example`), acrescente estas variáveis:

```dotenv
MP_ACCESS_TOKEN=SEU_ACCESS_TOKEN_DE_TESTE
MP_WEBHOOK_SECRET=SEGREDO_DO_WEBHOOK
PUBLIC_BASE_URL=https://SEU-CODESPACE-3000.app.github.dev
```

4. Troque a URL de exemplo pela URL HTTPS encaminhada da porta 3000 no Codespaces, sem caminho adicional e sem barra no final. Para que o Mercado Pago consiga chamar o webhook no Codespaces, a porta 3000 precisa estar acessível publicamente durante o teste. Não use dados de produção enquanto estiver testando.
5. Reinicie o servidor com `npm run dev`. O checkout verificará a configuração e redirecionará o comprador ao Mercado Pago quando as três variáveis estiverem válidas.

A API cria uma preferência de pagamento, salva a referência do pedido e verifica a assinatura do webhook antes de consultar o pagamento diretamente no Mercado Pago. Um pedido só muda automaticamente para `paid` quando o provedor confirma o status `approved` e o valor/moeda conferem. O retorno do navegador, sozinho, nunca confirma o pagamento.

**Importante:** mantenha Access Token e segredo do webhook somente no `.env`; não os envie por chat, não os coloque em `config.js` nem faça commit deles. Pagamentos de teste podem exigir a simulação de webhook no painel do Mercado Pago para testar a atualização de status.

Antes de vender em produção, hospede a aplicação em uma URL permanente HTTPS, configure e teste os webhooks de produção, implemente expiração de pedidos pendentes e migre os dados JSON para um banco transacional. O armazenamento atual é apropriado para protótipo/desenvolvimento, não para venda comercial de alto volume.

## API

- `GET /api/health` — estado do servidor.
- `GET /api/products` — catálogo e estoque.
- `POST /api/orders` — cria pedido e valida preço/estoque no servidor.
- `GET /api/admin/orders` — consulta pedidos, com chave administrativa.
- `GET /api/orders/:orderNumber` — consulta um pedido, com chave administrativa.
- `PATCH /api/admin/orders/:orderNumber` — atualiza status com transições permitidas, com chave administrativa.
- `POST /api/admin/products` — cadastra um produto novo, validando SKU exclusivo, preço, preço anterior, descrição e estoque; exige chave administrativa.
- `PATCH /api/admin/products/:id` — altera preço, preço anterior, estoque e selo, com chave administrativa.

Para verificar a API, abra `http://localhost:3000/api/health` ou rode em outro terminal:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/products
```

## Configuração da chave administrativa

O arquivo `.env.example` é apenas um modelo. Crie seu próprio `.env`; ele já está listado no `.gitignore`. Nunca coloque `ADMIN_API_KEY` em `config.js`, no frontend ou no GitHub.

No painel, informe a URL da API (`http://localhost:3000`) e a mesma chave configurada em `.env`. A chave é guardada em `sessionStorage` durante a sessão da aba.

## Funcionamento do pedido

O servidor recalcula subtotais usando os preços do catálogo no backend, agrega itens repetidos para validar estoque, serializa as operações que alteram estoque e grava arquivos JSON usando substituição atômica. Ao cancelar um pedido pelo painel, as quantidades voltam ao estoque.

## Limitações antes de produção

A persistência em JSON é adequada para desenvolvimento/protótipo, não para uma loja comercial com múltiplas instâncias. Antes da produção, migre para banco de dados transacional, configure `CORS_ORIGIN` para a origem exata do frontend, hospede a API em HTTPS, implemente autenticação de administrador e integração real com gateway de pagamento. O status `paid` no painel é manual; não existe confirmação de pagamento automática nem estorno financeiro integrado.
