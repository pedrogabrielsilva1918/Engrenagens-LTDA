import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
const productsFile = path.join(dataDir, 'products.json');
const ordersFile = path.join(dataDir, 'orders.json');

const app = express();
const port = Number(process.env.PORT || 3000);
const corsOrigin = process.env.CORS_ORIGIN || '*';

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '100kb' }));

async function readJson(file) {
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
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

app.get('/api/orders/:orderNumber', async (req, res, next) => {
  try {
    const orders = await readJson(ordersFile);
    const order = orders.find(item => item.orderNumber === req.params.orderNumber);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    res.json({ order });
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders', async (req, res, next) => {
  try {
    const { customer, items, payment } = req.body || {};
    const customerError = validateCustomer(customer);
    if (customerError) return res.status(400).json({ error: customerError });

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'O pedido precisa ter pelo menos um item.' });
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

    const normalizedItems = [];
    for (const item of requested) {
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

app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

await fs.mkdir(dataDir, { recursive: true });
app.listen(port, () => {
  console.log(`Engrenagens LTDA API em http://localhost:${port}`);
});
