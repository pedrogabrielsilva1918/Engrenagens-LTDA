import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '../..');
const seedDir = path.join(__dirname, 'data');
const dataDir = path.join(siteRoot, 'data'); // dados mutáveis fora dos arquivos versionados
const productsFile = path.join(dataDir, 'products.json');
const ordersFile = path.join(dataDir, 'orders.json');

const app = express();
const port = Number(process.env.PORT || 3000);
const corsOrigin = process.env.CORS_ORIGIN || '*';
const adminApiKey = process.env.ADMIN_API_KEY || '';

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '100kb' }));

async function readJson(file) {
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(file, value) {
  const temporaryFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(temporaryFile, file);
}

let mutationTail = Promise.resolve();

function serializeMutations(_req, res, next) {
  const previous = mutationTail;
  let releaseCurrent;
  const current = new Promise(resolve => { releaseCurrent = resolve; });
  mutationTail = previous.then(() => current);

  previous.then(() => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseCurrent();
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  }).catch(next);
}

function requireAdmin(req, res, next) {
  if (!adminApiKey || adminApiKey === 'troque-por-uma-chave-forte-e-unica' || adminApiKey.length < 32) {
    return res.status(503).json({ error: 'Painel administrativo desativado. Configure uma ADMIN_API_KEY exclusiva com pelo menos 32 caracteres.' });
  }

  const receivedKey = req.get('x-admin-key') || '';
  const receivedBuffer = Buffer.from(receivedKey);
  const expectedBuffer = Buffer.from(adminApiKey);
  const valid = receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer);

  if (!valid) return res.status(401).json({ error: 'Chave administrativa inválida.' });
  next();
}

function createOrderNumber() {
  const stamp = Date.now().toString().slice(-8);
  const random = crypto.randomInt(100, 1000);
  return `ENG-${stamp}-${random}`;
}

function validateCustomer(customer = {}) {
  const required = ['company', 'name', 'email', 'phone', 'cep', 'city', 'state', 'address', 'number'];
  for (const field of required) {
    if (!String(customer[field] || '').trim()) {
      return `Campo obrigatório ausente: ${field}.`;
    }
  }
  if (!/^\S+@\S+\.\S+$/.test(String(customer.email).trim())) {
    return 'Informe um e-mail válido.';
  }
  return null;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'engrenagens-ltda-api', timestamp: new Date().toISOString() });
});

app.get('/api/products', async (_req, res, next) => {
  try {
    const products = await readJson(productsFile);
    res.json({ products });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/orders', requireAdmin, async (_req, res, next) => {
  try {
    const orders = await readJson(ordersFile);
    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ orders });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/orders/:orderNumber', requireAdmin, serializeMutations, async (req, res, next) => {
  try {
    const nextStatus = String(req.body?.status || '');
    const allowedStatuses = ['pending_payment', 'paid', 'processing', 'shipped', 'completed', 'cancelled'];
    if (!allowedStatuses.includes(nextStatus)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }

    const orders = await readJson(ordersFile);
    const order = orders.find(item => item.orderNumber === req.params.orderNumber);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    if (order.status === nextStatus) return res.json({ order });

    const transitions = {
      pending_payment: ['paid', 'cancelled'],
      paid: ['processing', 'cancelled'],
      processing: ['shipped', 'cancelled'],
      shipped: ['completed'],
      completed: [],
      cancelled: []
    };
    if (!transitions[order.status]?.includes(nextStatus)) {
      return res.status(409).json({
        error: `Não é permitido alterar o pedido de "${order.status}" para "${nextStatus}".`
      });
    }

    if (nextStatus === 'cancelled') {
      const products = await readJson(productsFile);
      for (const item of order.items || []) {
        const product = products.find(entry => entry.id === item.id);
        if (product) product.stock += Number(item.qty) || 0;
      }
      await writeJson(productsFile, products);
      order.cancelledAt = new Date().toISOString();
      order.cancellationStockRestored = true;
    }

    order.status = nextStatus;
    order.updatedAt = new Date().toISOString();
    await writeJson(ordersFile, orders);
    res.json({ order });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/products/:id', requireAdmin, serializeMutations, async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId)) {
      return res.status(400).json({ error: 'ID de produto inválido.' });
    }

    const updates = req.body || {};
    const allowedFields = ['price', 'old', 'stock', 'badge'];
    const suppliedFields = Object.keys(updates);
    if (!suppliedFields.length || suppliedFields.some(field => !allowedFields.includes(field))) {
      return res.status(400).json({ error: 'Informe apenas price, old, stock ou badge.' });
    }

    const products = await readJson(productsFile);
    const product = products.find(item => item.id === productId);
    if (!product) return res.status(404).json({ error: 'Produto não encontrado.' });

    if (Object.hasOwn(updates, 'price')) {
      const price = Number(updates.price);
      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({ error: 'Preço deve ser um número igual ou maior que zero.' });
      }
      product.price = Number(price.toFixed(2));
    }

    if (Object.hasOwn(updates, 'old')) {
      if (updates.old === null || updates.old === '') {
        product.old = null;
      } else {
        const old = Number(updates.old);
        if (!Number.isFinite(old) || old < 0) {
          return res.status(400).json({ error: 'Preço anterior deve ser um número não negativo ou vazio.' });
        }
        product.old = Number(old.toFixed(2));
      }
    }

    if (Object.hasOwn(updates, 'stock')) {
      const stock = Number(updates.stock);
      if (!Number.isInteger(stock) || stock < 0) {
        return res.status(400).json({ error: 'Estoque deve ser um número inteiro igual ou maior que zero.' });
      }
      product.stock = stock;
    }

    if (Object.hasOwn(updates, 'badge')) {
      if (updates.badge !== null && typeof updates.badge !== 'string') {
        return res.status(400).json({ error: 'Selo deve ser texto ou null.' });
      }
      product.badge = updates.badge === '' ? null : updates.badge;
    }

    await writeJson(productsFile, products);
    res.json({ product });
  } catch (error) {
    next(error);
  }
});

app.get('/api/orders/:orderNumber', requireAdmin, async (req, res, next) => {
  try {
    const orders = await readJson(ordersFile);
    const order = orders.find(item => item.orderNumber === req.params.orderNumber);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    res.json({ order });
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders', serializeMutations, async (req, res, next) => {
  try {
    const { customer, items, payment = 'pix' } = req.body || {};
    const customerError = validateCustomer(customer);
    if (customerError) return res.status(400).json({ error: customerError });

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'O pedido precisa ter pelo menos um item.' });
    }

    if (!['pix', 'card', 'boleto'].includes(payment)) {
      return res.status(400).json({ error: 'Forma de pagamento inválida.' });
    }

    const products = await readJson(productsFile);
    const orders = await readJson(ordersFile);

    const requested = items.map(item => ({
      id: Number(item.id),
      qty: Number(item.qty)
    }));

    if (requested.some(item => !Number.isInteger(item.id) || !Number.isInteger(item.qty) || item.qty <= 0)) {
      return res.status(400).json({ error: 'Itens do pedido inválidos.' });
    }

    // Junta linhas repetidas do mesmo produto para validar o total solicitado.
    const quantitiesByProduct = new Map();
    for (const item of requested) {
      quantitiesByProduct.set(item.id, (quantitiesByProduct.get(item.id) || 0) + item.qty);
    }
    const normalizedRequest = [...quantitiesByProduct.entries()].map(([id, qty]) => ({ id, qty }));

    const normalizedItems = [];
    for (const item of normalizedRequest) {
      const product = products.find(p => p.id === item.id);
      if (!product) return res.status(400).json({ error: `Produto ${item.id} não encontrado.` });
      if (product.stock < item.qty) {
        return res.status(409).json({
          error: `Estoque insuficiente para "${product.name}". Disponível: ${product.stock}.`,
          productId: product.id,
          available: product.stock
        });
      }
      normalizedItems.push({
        id: product.id,
        name: product.name,
        sku: product.sku,
        qty: item.qty,
        unitPrice: product.price,
        total: Number((product.price * item.qty).toFixed(2))
      });
    }

    const subtotal = Number(normalizedItems.reduce((sum, item) => sum + item.total, 0).toFixed(2));
    const order = {
      orderNumber: createOrderNumber(),
      createdAt: new Date().toISOString(),
      status: 'pending_payment',
      payment: payment || 'pix',
      customer: {
        company: String(customer.company).trim(),
        name: String(customer.name).trim(),
        email: String(customer.email).trim(),
        phone: String(customer.phone).trim(),
        document: String(customer.document || '').trim(),
        cep: String(customer.cep).trim(),
        city: String(customer.city).trim(),
        state: String(customer.state).trim(),
        address: String(customer.address).trim(),
        number: String(customer.number).trim(),
        complement: String(customer.complement || '').trim(),
        notes: String(customer.notes || '').trim()
      },
      items: normalizedItems,
      subtotal,
      total: subtotal
    };

    for (const item of normalizedItems) {
      const product = products.find(p => p.id === item.id);
      product.stock -= item.qty;
    }

    orders.push(order);
    await writeJson(productsFile, products);
    await writeJson(ordersFile, orders);

    res.status(201).json({ order });
  } catch (error) {
    next(error);
  }
});

// Serve somente arquivos públicos da interface. Não exponha a pasta server/ nem os dados JSON.
const publicFiles = new Set([
  'index.html', 'styles.css', 'script.js', 'products.js', 'config.js',
  'checkout.html', 'checkout.css', 'checkout.js',
  'admin.html', 'admin.css', 'admin.js'
]);
const publicRoutes = [
  '/', ...[...publicFiles].map(file => `/${file}`)
];
app.get(publicRoutes, (req, res, next) => {
  const fileName = req.path === '/' ? 'index.html' : req.path.slice(1);
  if (!publicFiles.has(fileName)) return next();
  res.sendFile(path.join(siteRoot, fileName), error => {
    if (error) next(error);
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

await fs.mkdir(dataDir, { recursive: true });
try {
  await fs.access(productsFile);
} catch {
  await fs.copyFile(path.join(seedDir, 'products.json'), productsFile);
}
try {
  await fs.access(ordersFile);
} catch {
  await fs.writeFile(ordersFile, '[]\n', 'utf8');
}
app.listen(port, () => {
  console.log(`Engrenagens LTDA API em http://localhost:${port}`);
});
