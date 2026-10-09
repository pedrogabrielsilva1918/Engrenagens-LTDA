const brl = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const byId = id => document.getElementById(id);
const connectForm = byId('connectForm');
const productCreateForm = byId('productCreateForm');
const apiUrlInput = byId('apiUrl');
const keyInput = byId('adminKey');
const productsTable = byId('productsTable');
const ordersTable = byId('ordersTable');
const toast = byId('adminToast');

let apiBase = sessionStorage.getItem('eng-admin-api') || window.API_BASE_URL || 'http://localhost:3000';
let adminKey = sessionStorage.getItem('eng-admin-key') || '';
let products = [];
let orders = [];

apiUrlInput.value = apiBase;
keyInput.value = adminKey;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function showToast(message, error = false) {
  toast.textContent = message;
  toast.className = 'adminToast show' + (error ? ' error' : '');
  window.setTimeout(() => toast.classList.remove('show'), 3200);
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.admin ? { 'x-admin-key': adminKey } : {}),
      ...(options.headers || {})
    }
  });
  let payload = {};
  try { payload = await response.json(); } catch { /* resposta sem JSON */ }
  if (!response.ok) throw new Error(payload.error || `Falha na API (${response.status}).`);
  return payload;
}

function setConnected(connected, message = '') {
  const status = byId('connectionStatus');
  status.textContent = connected ? 'Conectado' : 'Desconectado';
  status.className = 'statusTag ' + (connected ? 'online' : 'offline');
  byId('refreshBtn').disabled = !connected;
  byId('createProductBtn').disabled = !connected;
  byId('connectBtn').textContent = connected ? 'Reconectar' : 'Conectar';
  byId('connectMessage').textContent = message;
  byId('connectMessage').className = 'connectMessage' + (connected ? ' success' : ' error');
}

async function loadProducts() {
  const payload = await apiRequest('/api/products');
  products = Array.isArray(payload.products) ? payload.products : [];
  renderProducts();
  updateStats();
}

async function loadOrders() {
  const payload = await apiRequest('/api/admin/orders', { admin: true });
  orders = Array.isArray(payload.orders) ? payload.orders : [];
  renderOrders();
  updateStats();
}

async function connect() {
  apiBase = apiUrlInput.value.trim().replace(/\/$/, '');
  adminKey = keyInput.value.trim();
  if (!apiBase || !adminKey) throw new Error('Informe a URL da API e a chave administrativa.');

  await apiRequest('/api/admin/orders', { admin: true });
  sessionStorage.setItem('eng-admin-api', apiBase);
  sessionStorage.setItem('eng-admin-key', adminKey);
  await loadProducts();
  await loadOrders();
  setConnected(true, 'Conexão validada. Alterações em produtos são gravadas no backend.');
}

function updateStats() {
  byId('statProducts').textContent = products.length || 0;
  byId('statStock').textContent = products.reduce((sum, p) => sum + Number(p.stock || 0), 0).toLocaleString('pt-BR');
  byId('statOrders').textContent = orders.length.toLocaleString('pt-BR');
  byId('statValue').textContent = brl(orders.reduce((sum, o) => sum + Number(o.total ?? o.subtotal ?? 0), 0));
}

function renderProducts() {
  const query = byId('productFilter').value.trim().toLowerCase();
  const filtered = products.filter(p => `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(query));
  if (!filtered.length) {
    productsTable.innerHTML = '<tr><td colspan="5" class="tableEmpty">Nenhum produto encontrado.</td></tr>';
    return;
  }
  productsTable.innerHTML = filtered.map(p => `<tr data-product-row="${p.id}">
    <td><div class="productName">${escapeHtml(p.name)}</div><span class="productSku">${escapeHtml(p.sku)} · ${escapeHtml(p.category)}</span></td>
    <td><input class="tableInput" type="number" min="0" step="0.01" aria-label="Preço de ${escapeHtml(p.name)}" data-field="price" value="${Number(p.price).toFixed(2)}"></td>
    <td><input class="tableInput" type="number" min="0" step="0.01" aria-label="Preço anterior de ${escapeHtml(p.name)}" data-field="old" value="${p.old ?? ''}" placeholder="—"></td>
    <td><input class="tableInput stockInput" type="number" min="0" step="1" aria-label="Estoque de ${escapeHtml(p.name)}" data-field="stock" value="${Number(p.stock) || 0}"></td>
    <td><button class="saveRowBtn" data-save-product="${p.id}">Salvar</button></td>
  </tr>`).join('');
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function statusLabel(status) {
  const labels = {
    pending_payment: 'Aguardando pagamento',
    paid: 'Pago',
    processing: 'Em preparação',
    shipped: 'Enviado',
    completed: 'Concluído',
    cancelled: 'Cancelado'
  };
  return labels[status] || status || '—';
}

function renderOrders() {
  const filter = byId('orderFilter').value;
  const filtered = orders.filter(order => filter === 'all' || order.status === filter);
  if (!filtered.length) {
    ordersTable.innerHTML = '<tr><td colspan="7" class="tableEmpty">Nenhum pedido registrado até agora.</td></tr>';
    return;
  }

  const transitions = {
    pending_payment: ['paid', 'cancelled'],
    paid: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['completed'],
    completed: [],
    cancelled: []
  };

  ordersTable.innerHTML = filtered.map(order => {
    const status = String(order.status || 'pending_payment');
    const nextStatuses = transitions[status] || [];
    const choices = [status, ...nextStatuses];
    const options = choices.map(value =>
      `<option value="${escapeHtml(value)}" ${value === status ? 'selected' : ''}>${escapeHtml(statusLabel(value))}</option>`
    ).join('');
    return `<tr>
      <td><button class="orderLink" data-show-order="${escapeHtml(order.orderNumber)}">${escapeHtml(order.orderNumber)}</button></td>
      <td>${escapeHtml(formatDate(order.createdAt))}</td>
      <td>${escapeHtml(order.customer?.company || order.customer?.name || '—')}</td>
      <td>${escapeHtml(String(order.payment || '—').toUpperCase())}</td>
      <td><span class="statusPill ${status === 'pending_payment' ? 'pending' : ''}">${escapeHtml(statusLabel(status))}</span></td>
      <td><b>${brl(order.total ?? order.subtotal)}</b></td>
      <td><div class="orderStatusActions">
        <select class="statusSelect" aria-label="Novo status do pedido ${escapeHtml(order.orderNumber)}" data-status-for="${escapeHtml(order.orderNumber)}" ${nextStatuses.length ? '' : 'disabled'}>${options}</select>
        <button class="saveStatusBtn" data-update-order="${escapeHtml(order.orderNumber)}" ${nextStatuses.length ? '' : 'disabled'}>Salvar</button>
      </div></td>
    </tr>`;
  }).join('');
}

function showOrderDetails(orderNumber) {
  const order = orders.find(item => item.orderNumber === orderNumber);
  if (!order) return;
  const detail = byId('orderDetails');
  const customer = order.customer || {};
  detail.innerHTML = `<h3>Pedido ${escapeHtml(order.orderNumber)}</h3>
    <p><b>Comprador:</b> ${escapeHtml(customer.name || '—')} · ${escapeHtml(customer.company || '—')}</p>
    <p><b>Contato:</b> ${escapeHtml(customer.email || '—')} · ${escapeHtml(customer.phone || '—')}</p>
    <p><b>Entrega:</b> ${escapeHtml(customer.address || '')}, ${escapeHtml(customer.number || '')} — ${escapeHtml(customer.city || '')}/${escapeHtml(customer.state || '')} · CEP ${escapeHtml(customer.cep || '')}</p>
    <p><b>Pagamento:</b> ${escapeHtml(String(order.payment || '—').toUpperCase())} · <b>Status:</b> ${escapeHtml(statusLabel(order.status))}</p>
    <ul>${(order.items || []).map(item => `<li>${escapeHtml(item.name)} (SKU ${escapeHtml(item.sku)}) — ${Number(item.qty)} × ${brl(item.unitPrice)} = <b>${brl(item.total)}</b></li>`).join('')}</ul>
    <p><b>Total:</b> ${brl(order.total ?? order.subtotal)}</p>
    ${customer.notes ? `<p><b>Observações:</b> ${escapeHtml(customer.notes)}</p>` : ''}`;
  detail.classList.remove('hidden');
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function saveProduct(productId, button) {
  const row = document.querySelector(`[data-product-row="${productId}"]`);
  if (!row) return;
  const price = row.querySelector('[data-field="price"]').value;
  const oldInput = row.querySelector('[data-field="old"]').value;
  const stock = row.querySelector('[data-field="stock"]').value;
  if (price === '' || Number(price) < 0 || !Number.isFinite(Number(price))) {
    showToast('Informe um preço válido.', true);
    return;
  }
  if (stock === '' || !Number.isInteger(Number(stock)) || Number(stock) < 0) {
    showToast('O estoque precisa ser um inteiro igual ou maior que zero.', true);
    return;
  }
  if (oldInput !== '' && (!Number.isFinite(Number(oldInput)) || Number(oldInput) < 0)) {
    showToast('Preço anterior inválido.', true);
    return;
  }

  button.disabled = true;
  button.textContent = 'Salvando...';
  try {
    const payload = await apiRequest(`/api/admin/products/${productId}`, {
      method: 'PATCH',
      admin: true,
      body: JSON.stringify({ price: Number(price), old: oldInput === '' ? null : Number(oldInput), stock: Number(stock) })
    });
    products = products.map(p => p.id === productId ? payload.product : p);
    renderProducts();
    updateStats();
    showToast('Produto atualizado no servidor.');
  } catch (error) {
    showToast(error.message || 'Não foi possível salvar o produto.', true);
  } finally {
    button.disabled = false;
    button.textContent = 'Salvar';
  }
}


productCreateForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!adminKey) {
    showToast('Conecte-se à API antes de cadastrar produtos.', true);
    return;
  }

  const name = byId('newProductName').value.trim();
  const category = byId('newProductCategory').value.trim();
  const sku = byId('newProductSku').value.trim().toUpperCase();
  const priceText = byId('newProductPrice').value;
  const oldText = byId('newProductOldPrice').value;
  const stockText = byId('newProductStock').value;
  const badge = byId('newProductBadge').value.trim();
  const description = byId('newProductDescription').value.trim();
  const price = Number(priceText);
  const old = oldText === '' ? null : Number(oldText);
  const stock = Number(stockText);

  if (!name || !category || !sku || !description) {
    showToast('Preencha nome, categoria, SKU e descrição.', true);
    return;
  }
  if (priceText === '' || !Number.isFinite(price) || price < 0) {
    showToast('Informe um preço válido, igual ou maior que zero.', true);
    return;
  }
  if (oldText !== '' && (!Number.isFinite(old) || old < 0)) {
    showToast('O preço anterior deve ser válido ou ficar em branco.', true);
    return;
  }
  if (stockText === '' || !Number.isInteger(stock) || stock < 0) {
    showToast('O estoque inicial precisa ser um inteiro igual ou maior que zero.', true);
    return;
  }

  const button = byId('createProductBtn');
  button.disabled = true;
  button.textContent = 'Cadastrando...';
  try {
    const payload = await apiRequest('/api/admin/products', {
      method: 'POST',
      admin: true,
      body: JSON.stringify({ name, category, sku, price, old, stock, badge, description })
    });
    products.unshift(payload.product);
    productCreateForm.reset();
    byId('newProductStock').value = '0';
    renderProducts();
    updateStats();
    showToast('Produto cadastrado. O catálogo da loja buscará o item na API.');
  } catch (error) {
    showToast(error.message || 'Não foi possível cadastrar o produto.', true);
  } finally {
    button.disabled = byId('connectionStatus').textContent !== 'Conectado';
    button.textContent = 'Cadastrar produto';
  }
});

connectForm.addEventListener('submit', async event => {
  event.preventDefault();
  byId('connectBtn').disabled = true;
  setConnected(false, 'Validando acesso administrativo...');
  try {
    await connect();
  } catch (error) {
    setConnected(false, error.message || 'Não foi possível conectar.');
    showToast(error.message || 'Falha na conexão.', true);
  } finally {
    byId('connectBtn').disabled = false;
  }
});

byId('refreshBtn').addEventListener('click', async () => {
  try {
    await Promise.all([loadProducts(), loadOrders()]);
    showToast('Dados atualizados.');
  } catch (error) {
    showToast(error.message || 'Falha ao atualizar os dados.', true);
  }
});
byId('productFilter').addEventListener('input', renderProducts);
byId('orderFilter').addEventListener('change', renderOrders);
productsTable.addEventListener('click', event => {
  const button = event.target.closest('[data-save-product]');
  if (button) saveProduct(Number(button.dataset.saveProduct), button);
});
ordersTable.addEventListener('click', async event => {
  const detailButton = event.target.closest('[data-show-order]');
  if (detailButton) showOrderDetails(detailButton.dataset.showOrder);

  const updateButton = event.target.closest('[data-update-order]');
  if (!updateButton) return;
  const orderNumber = updateButton.dataset.updateOrder;
  const select = ordersTable.querySelector(`[data-status-for="${CSS.escape(orderNumber)}"]`);
  if (!select) return;

  const nextStatus = select.value;
  const currentOrder = orders.find(order => order.orderNumber === orderNumber);
  if (!currentOrder || nextStatus === currentOrder.status) {
    showToast('Selecione um status diferente do atual.', true);
    return;
  }
  if (nextStatus === 'cancelled' && !window.confirm('Cancelar este pedido e devolver os itens ao estoque? Essa ação não pode ser desfeita pelo painel.')) {
    select.value = currentOrder.status;
    return;
  }

  updateButton.disabled = true;
  updateButton.textContent = 'Salvando...';
  try {
    const payload = await apiRequest(`/api/admin/orders/${encodeURIComponent(orderNumber)}`, {
      method: 'PATCH',
      admin: true,
      body: JSON.stringify({ status: nextStatus })
    });
    orders = orders.map(order => order.orderNumber === orderNumber ? payload.order : order);
    if (nextStatus === 'cancelled') {
      await loadProducts();
    }
    renderOrders();
    updateStats();
    showToast(nextStatus === 'cancelled' ? 'Pedido cancelado e estoque devolvido.' : 'Status do pedido atualizado.');
  } catch (error) {
    showToast(error.message || 'Não foi possível atualizar o pedido.', true);
    updateButton.disabled = false;
    updateButton.textContent = 'Salvar';
  }
});

if (adminKey) {
  connect().catch(error => setConnected(false, error.message || 'Reconecte para carregar os dados.'));
}
