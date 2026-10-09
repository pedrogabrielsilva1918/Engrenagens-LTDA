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


async function prepareOrder(body = {}) {
  const { customer, items, payment = 'pix' } = body || {};
  const customerError = validateCustomer(customer);
  if (customerError) throw Object.assign(new Error(customerError), { statusCode: 400 });

  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error('O pedido precisa ter pelo menos um item.'), { statusCode: 400 });
  }
  if (!['pix', 'card', 'boleto'].includes(payment)) {
    throw Object.assign(new Error('Forma de pagamento inválida.'), { statusCode: 400 });
  }

  const products = await readJson(productsFile);
  const orders = await readJson(ordersFile);
  const requested = items.map(item => ({ id: Number(item.id), qty: Number(item.qty) }));
  if (requested.some(item => !Number.isInteger(item.id) || !Number.isInteger(item.qty) || item.qty <= 0)) {
    throw Object.assign(new Error('Itens do pedido inválidos.'), { statusCode: 400 });
  }

  const quantitiesByProduct = new Map();
  for (const item of requested) {
    quantitiesByProduct.set(item.id, (quantitiesByProduct.get(item.id) || 0) + item.qty);
  }
  const normalizedRequest = [...quantitiesByProduct.entries()].map(([id, qty]) => ({ id, qty }));
  const normalizedItems = [];

  for (const item of normalizedRequest) {
    const product = products.find(entry => entry.id === item.id);
    if (!product || product.active === false) throw Object.assign(new Error('Produto ' + item.id + ' não está disponível.'), { statusCode: 400 });
    if (product.stock < item.qty) {
      throw Object.assign(new Error('Estoque insuficiente para "' + product.name + '". Disponível: ' + product.stock + '.'), { statusCode: 409 });
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
    payment,
    paymentProvider: 'demo',
    paymentStatus: 'not_configured',
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
  return { order, products, orders };
}

async function persistPreparedOrder(prepared) {
  for (const item of prepared.order.items) {
    const product = prepared.products.find(entry => entry.id === item.id);
    if (product) product.stock -= item.qty;
  }
  prepared.orders.push(prepared.order);
  await writeJson(productsFile, prepared.products);
  await writeJson(ordersFile, prepared.orders);
}

function mercadoPagoSettings() {
  const accessToken = String(process.env.MP_ACCESS_TOKEN || '').trim();
  const webhookSecret = String(process.env.MP_WEBHOOK_SECRET || '').trim();
  const configuredBase = String(process.env.PUBLIC_BASE_URL || '').trim();
  let publicBaseUrl = '';

  try {
    const parsed = new URL(configuredBase);
    if (parsed.protocol === 'https:' && parsed.pathname === '/' && !parsed.search && !parsed.hash) {
      publicBaseUrl = parsed.origin;
    }
  } catch {
    // Uma URL pública inválida mantém a integração desativada.
  }

  const missing = [];
  if (!accessToken) missing.push('MP_ACCESS_TOKEN');
  if (!webhookSecret) missing.push('MP_WEBHOOK_SECRET');
  if (!publicBaseUrl) missing.push('PUBLIC_BASE_URL (URL HTTPS sem caminho)');
  const anyConfigured = Boolean(accessToken || webhookSecret || configuredBase);
  return {
    accessToken,
    webhookSecret,
    publicBaseUrl,
    missing,
    configured: missing.length === 0,
    mode: missing.length === 0 ? 'mercadopago' : (anyConfigured ? 'incomplete' : 'demo')
  };
}

function validateMercadoPagoSignature(signature, requestId, dataId, secret) {
  if (!signature || !requestId || !dataId || !secret) return false;
  const parts = Object.create(null);
  for (const part of String(signature).split(',')) {
    const index = part.indexOf('=');
    if (index > 0) parts[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  if (!parts.ts || !parts.v1) return false;

  const manifest = 'id:' + String(dataId).toLowerCase() + ';request-id:' + requestId + ';ts:' + parts.ts + ';';
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest();
  let received;
  try {
    received = Buffer.from(parts.v1, 'hex');
  } catch {
    return false;
  }
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'engrenagens-ltda-api', timestamp: new Date().toISOString() });
});

app.get('/api/products', async (_req, res, next) => {
  try {
    const allProducts = await readJson(productsFile);
    // Registros antigos sem "active" continuam ativos; os inativos não vão para a loja.
    const products = allProducts.filter(product => product.active !== false);
    res.json({ products });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/products', requireAdmin, async (_req, res, next) => {
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

app.post('/api/admin/products', requireAdmin, serializeMutations, async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const category = String(body.category || '').trim();
    const sku = String(body.sku || '').trim().toUpperCase();
    const description = String(body.description || '').trim();
    const badge = String(body.badge || '').trim();
    const price = Number(body.price);
    const oldValue = body.old === '' || body.old === null || body.old === undefined
      ? null
      : Number(body.old);
    const stock = Number(body.stock);

    if (!name || name.length > 120) {
      return res.status(400).json({ error: 'Informe o nome do produto (até 120 caracteres).' });
    }
    if (!category || category.length > 80) {
      return res.status(400).json({ error: 'Informe a categoria (até 80 caracteres).' });
    }
    if (!/^[A-Z0-9][A-Z0-9._/-]{1,59}$/.test(sku)) {
      return res.status(400).json({ error: 'Informe um SKU com 2 a 60 caracteres: letras, números, ponto, hífen, barra ou sublinhado.' });
    }
    if (!description || description.length > 700) {
      return res.status(400).json({ error: 'Informe a descrição do produto (até 700 caracteres).' });
    }
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'O preço deve ser um número igual ou maior que zero.' });
    }
    if (oldValue !== null && (!Number.isFinite(oldValue) || oldValue < 0)) {
      return res.status(400).json({ error: 'O preço anterior deve ser um número não negativo ou ficar em branco.' });
    }
    if (!Number.isInteger(stock) || stock < 0) {
      return res.status(400).json({ error: 'O estoque deve ser um inteiro igual ou maior que zero.' });
    }
    if (badge.length > 40) {
      return res.status(400).json({ error: 'O selo promocional deve ter no máximo 40 caracteres.' });
    }

    const products = await readJson(productsFile);
    if (products.some(product => String(product.sku || '').trim().toUpperCase() === sku)) {
      return res.status(409).json({ error: 'Este SKU já está cadastrado. Informe um SKU diferente.' });
    }

    const nextId = products.reduce((max, product) => Math.max(max, Number(product.id) || 0), 0) + 1;
    const product = {
      id: nextId,
      active: true,
      name,
      category,
      price: Number(price.toFixed(2)),
      old: oldValue === null ? null : Number(oldValue.toFixed(2)),
      rating: 5,
      reviews: 0,
      sku,
      badge: badge || null,
      stock,
      description,
      specs: { 'Categoria': category, 'SKU': sku }
    };
    products.push(product);
    await writeJson(productsFile, products);
    res.status(201).json({ product });
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
    const allowedFields = ['price', 'old', 'stock', 'badge', 'active'];
    const suppliedFields = Object.keys(updates);
    if (!suppliedFields.length || suppliedFields.some(field => !allowedFields.includes(field))) {
      return res.status(400).json({ error: 'Informe apenas price, old, stock, badge ou active.' });
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

    if (Object.hasOwn(updates, 'active')) {
      if (typeof updates.active !== 'boolean') {
        return res.status(400).json({ error: 'O estado do produto deve ser verdadeiro ou falso.' });
      }
      product.active = updates.active;
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

app.get('/api/payments/status', (_req, res) => {
  const settings = mercadoPagoSettings();
  res.json({
    provider: 'mercadopago',
    mode: settings.mode,
    configured: settings.configured,
    missing: settings.missing
  });
});

app.post('/api/payments/checkout', serializeMutations, async (req, res, next) => {
  try {
    const settings = mercadoPagoSettings();
    if (!settings.configured) {
      return res.status(503).json({
        error: settings.mode === 'demo'
          ? 'Pagamento real ainda não foi configurado. O checkout demonstrativo continua disponível.'
          : 'Integração Mercado Pago incompleta. Configure: ' + settings.missing.join(', ') + '.'
      });
    }

    const prepared = await prepareOrder(req.body);
    const order = prepared.order;
    const excludedByPayment = {
      pix: ['credit_card', 'debit_card', 'prepaid_card', 'ticket'],
      card: ['bank_transfer', 'ticket'],
      boleto: ['bank_transfer', 'credit_card', 'debit_card', 'prepaid_card']
    };
    const preferenceBody = {
      items: order.items.map(item => ({
        id: String(item.id),
        title: item.name,
        quantity: item.qty,
        currency_id: 'BRL',
        unit_price: item.unitPrice
      })),
      payer: { name: order.customer.name, email: order.customer.email },
      external_reference: order.orderNumber,
      metadata: { order_number: order.orderNumber },
      back_urls: {
        success: settings.publicBaseUrl + '/checkout.html?payment=success&order=' + encodeURIComponent(order.orderNumber),
        pending: settings.publicBaseUrl + '/checkout.html?payment=pending&order=' + encodeURIComponent(order.orderNumber),
        failure: settings.publicBaseUrl + '/checkout.html?payment=failure&order=' + encodeURIComponent(order.orderNumber)
      },
      auto_return: 'approved',
      notification_url: settings.publicBaseUrl + '/api/webhooks/mercadopago',
      payment_methods: {
        excluded_payment_types: excludedByPayment[order.payment].map(id => ({ id }))
      }
    };

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + settings.accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(preferenceBody),
      signal: AbortSignal.timeout(15000)
    });
    const preference = await mpResponse.json().catch(() => ({}));
    if (!mpResponse.ok) {
      console.error('Mercado Pago preference error:', mpResponse.status, preference.message || preference.error || 'unknown');
      return res.status(502).json({ error: 'Não foi possível iniciar o pagamento no Mercado Pago. Verifique as credenciais de teste e tente novamente.' });
    }

    const checkoutUrl = preference.sandbox_init_point || preference.init_point;
    let checkoutHost = '';
    try { checkoutHost = new URL(checkoutUrl).hostname; } catch { /* URL inválida */ }
    if (!checkoutUrl || !/^https:/.test(checkoutUrl) || !/(^|\.)mercadopago\.(com\.br|com)$/.test(checkoutHost)) {
      return res.status(502).json({ error: 'O Mercado Pago não retornou um endereço de checkout seguro válido.' });
    }

    order.paymentProvider = 'mercadopago';
    order.paymentStatus = 'created';
    order.preferenceId = String(preference.id || '');
    await persistPreparedOrder(prepared);
    res.status(201).json({ orderNumber: order.orderNumber, checkoutUrl });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
});

app.post('/api/webhooks/mercadopago', serializeMutations, async (req, res, next) => {
  try {
    const settings = mercadoPagoSettings();
    if (!settings.configured) return res.sendStatus(503);

    const type = String(req.query.type || req.body?.type || '');
    if (type && type !== 'payment') return res.sendStatus(200);

    const dataId = String(req.query['data.id'] || req.body?.data?.id || '');
    const isValid = validateMercadoPagoSignature(
      req.get('x-signature'),
      req.get('x-request-id'),
      dataId,
      settings.webhookSecret
    );
    if (!isValid) return res.status(401).json({ error: 'Assinatura de webhook inválida.' });

    const paymentResponse = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(dataId), {
      headers: { Authorization: 'Bearer ' + settings.accessToken },
      signal: AbortSignal.timeout(12000)
    });
    const payment = await paymentResponse.json().catch(() => ({}));
    if (!paymentResponse.ok) return res.status(502).json({ error: 'Não foi possível consultar o pagamento no Mercado Pago.' });

    const orders = await readJson(ordersFile);
    const order = orders.find(item => item.orderNumber === String(payment.external_reference || ''));
    if (!order) return res.sendStatus(200);

    const paidAmount = Math.round(Number(payment.transaction_amount) * 100);
    const expectedAmount = Math.round(Number(order.total) * 100);
    if (payment.currency_id !== 'BRL' || paidAmount !== expectedAmount) {
      console.warn('Webhook Mercado Pago ignorado: valor/moeda divergente para o pedido', order.orderNumber);
      return res.sendStatus(200);
    }
    if (order.preferenceId && payment.preference_id && String(order.preferenceId) !== String(payment.preference_id)) {
      console.warn('Webhook Mercado Pago ignorado: preferência divergente para o pedido', order.orderNumber);
      return res.sendStatus(200);
    }

    const paymentStatus = String(payment.status || 'unknown');
    let shouldWriteProducts = false;
    let changed = false;
    if (order.status === 'pending_payment' && paymentStatus === 'approved') {
      order.status = 'paid';
      order.paymentProvider = 'mercadopago';
      order.paymentStatus = paymentStatus;
      order.paymentId = String(payment.id || dataId);
      order.paymentMethodId = String(payment.payment_method_id || '');
      changed = true;
    } else if (order.status === 'pending_payment' && ['rejected', 'cancelled'].includes(paymentStatus)) {
      const products = await readJson(productsFile);
      for (const item of order.items || []) {
        const product = products.find(entry => entry.id === item.id);
        if (product) product.stock += Number(item.qty) || 0;
      }
      order.status = 'cancelled';
      order.paymentProvider = 'mercadopago';
      order.paymentStatus = paymentStatus;
      order.paymentId = String(payment.id || dataId);
      order.cancelledAt = new Date().toISOString();
      order.cancellationStockRestored = true;
      await writeJson(productsFile, products);
      shouldWriteProducts = true;
      changed = true;
    } else if (order.paymentStatus !== paymentStatus) {
      order.paymentStatus = paymentStatus;
      order.paymentId = String(payment.id || dataId);
      changed = true;
    }

    if (changed) {
      order.updatedAt = new Date().toISOString();
      await writeJson(ordersFile, orders);
    }
    if (shouldWriteProducts) console.log('Estoque restaurado após pagamento cancelado/rejeitado:', order.orderNumber);
    res.sendStatus(200);
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders', serializeMutations, async (req, res, next) => {
  try {
    const prepared = await prepareOrder(req.body);
    await persistPreparedOrder(prepared);
    res.status(201).json({ order: prepared.order });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
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
  await fs.copyFile(path.join(seedDir, 'orders.json'), ordersFile);
}
app.listen(port, () => {
  console.log(`Engrenagens LTDA API em http://localhost:${port}`);
});
