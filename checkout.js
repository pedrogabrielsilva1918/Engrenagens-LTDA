let products = window.PRODUCTS;
const brl = value => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const cart = JSON.parse(localStorage.getItem('engrenagens-cart') || '[]')
  .map(item => ({ id: Number(item.id), qty: Number(item.qty) || 0 }))
  .filter(item => Number.isInteger(item.id) && item.qty > 0);

let validCart = [];

function rebuildValidCart() {
  validCart = cart
    .map(item => {
      const product = products.find(p => p.id === item.id);
      if (!product || product.stock <= 0) return null;
      return { id: item.id, qty: Math.min(item.qty, product.stock) };
    })
    .filter(Boolean)
    .filter(item => item.qty > 0);
}

async function syncCheckoutProducts() {
  const baseUrl = (window.API_BASE_URL || '').replace(/\/$/, '');
  if (baseUrl) {
    try {
      const response = await fetch(`${baseUrl}/api/products`, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`API de produtos respondeu ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.products)) throw new Error('Formato de catálogo inválido.');
      products = payload.products;
    } catch (error) {
      console.warn('Não foi possível sincronizar o catálogo com a API; usando os dados locais.', error);
    }
  }
  rebuildValidCart();
}

const content = document.getElementById('checkoutContent');
const emptyState = document.getElementById('emptyState');
const successState = document.getElementById('successState');
const orderItems = document.getElementById('orderItems');
const subtotalEl = document.getElementById('subtotal');
const totalEl = document.getElementById('total');
const formError = document.getElementById('formError');
const confirmButton = document.getElementById('confirmOrder');
confirmButton.disabled = true;
confirmButton.textContent = 'Carregando pedido...';

function getSubtotal() {
  return validCart.reduce((sum, item) => {
    const product = products.find(p => p.id === item.id);
    return sum + (product ? product.price * item.qty : 0);
  }, 0);
}

function renderSummary() {
  orderItems.innerHTML = validCart.map(item => {
    const product = products.find(p => p.id === item.id);
    return `<div class="orderItem">
      <div class="orderThumb">⚙️</div>
      <div><b>${product.name}</b><small>${item.qty} × ${brl(product.price)} · SKU ${product.sku}</small></div>
      <strong>${brl(product.price * item.qty)}</strong>
    </div>`;
  }).join('');

  const subtotal = getSubtotal();
  subtotalEl.textContent = brl(subtotal);
  totalEl.textContent = brl(subtotal);
}

function showEmptyState() {
  content.classList.add('hidden');
  emptyState.classList.remove('hidden');
}

function collectFormData() {
  return {
    company: document.getElementById('company').value.trim(),
    name: document.getElementById('name').value.trim(),
    email: document.getElementById('email').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    document: document.getElementById('document').value.trim(),
    cep: document.getElementById('cep').value.trim(),
    city: document.getElementById('city').value.trim(),
    state: document.getElementById('state').value,
    address: document.getElementById('address').value.trim(),
    number: document.getElementById('number').value.trim(),
    complement: document.getElementById('complement').value.trim(),
    notes: document.getElementById('notes').value.trim(),
    payment: document.querySelector('input[name="payment"]:checked')?.value || 'pix'
  };
}

function validate(data) {
  const required = ['company','name','email','phone','cep','city','state','address','number'];
  const missing = required.some(key => !data[key]);
  if (missing) return 'Preencha todos os campos obrigatórios.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return 'Informe um e-mail válido.';
  return '';
}

function createOrderNumber() {
  const stamp = Date.now().toString().slice(-8);
  const random = Math.floor(100 + Math.random() * 900);
  return `ENG-${stamp}-${random}`;
}

async function saveOrderLocally(data) {
  const orderNumber = createOrderNumber();
  const subtotal = getSubtotal();
  const order = {
    orderNumber,
    createdAt: new Date().toISOString(),
    status: 'pending_payment',
    payment: data.payment,
    customer: data,
    items: validCart,
    subtotal,
    total: subtotal
  };
  localStorage.setItem('engrenagens-last-order', JSON.stringify(order));
  return order;
}

async function createOrderOnApi(data) {
  const baseUrl = (window.API_BASE_URL || '').replace(/\/$/, '');
  if (!baseUrl) return { order: await saveOrderLocally(data), demo: true };

  const statusResponse = await fetch(baseUrl + '/api/payments/status', {
    headers: { Accept: 'application/json' }
  });
  let paymentConfig = {};
  try { paymentConfig = await statusResponse.json(); } catch { /* resposta inválida */ }
  if (!statusResponse.ok) throw new Error('Não foi possível consultar a configuração de pagamento da API.');

  if (paymentConfig.mode === 'incomplete') {
    throw new Error('A integração Mercado Pago está incompleta no servidor. Configure MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET e PUBLIC_BASE_URL no arquivo .env.');
  }

  if (paymentConfig.mode === 'mercadopago') {
    const response = await fetch(baseUrl + '/api/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ customer: data, payment: data.payment, items: validCart })
    });
    let payload = {};
    try { payload = await response.json(); } catch { /* resposta sem JSON */ }
    if (!response.ok) throw new Error(payload.error || 'Não foi possível iniciar o pagamento.');
    if (!payload.checkoutUrl) throw new Error('O provedor não retornou o endereço de pagamento.');
    return { redirectUrl: payload.checkoutUrl, orderNumber: payload.orderNumber, demo: false };
  }

  // Sem credenciais, mantém o fluxo de demonstração e nunca simula uma aprovação.
  const response = await fetch(baseUrl + '/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ customer: data, payment: data.payment, items: validCart })
  });
  let payload = {};
  try { payload = await response.json(); } catch { /* resposta sem JSON */ }
  if (!response.ok) throw new Error(payload.error || 'Não foi possível criar o pedido.');
  return { order: payload.order, demo: true };
}

confirmButton.addEventListener('click', async () => {
  formError.textContent = '';
  const data = collectFormData();
  const error = validate(data);
  if (error) {
    formError.textContent = error;
    return;
  }

  confirmButton.disabled = true;
  confirmButton.textContent = 'Processando pedido...';

  try {
    const result = await createOrderOnApi(data);
    if (result.redirectUrl) {
      localStorage.removeItem('engrenagens-cart');
      window.location.assign(result.redirectUrl);
      return;
    }
    localStorage.removeItem('engrenagens-cart');

    content.classList.add('hidden');
    successState.classList.remove('hidden');

    const modeText = result.demo
      ? 'Pedido registrado apenas para demonstração. Nenhum pagamento real foi processado.'
      : 'O pedido foi registrado no servidor e o estoque foi atualizado.';
    document.getElementById('successText').textContent =
      `Número do pedido: ${result.order.orderNumber}. Total: ${brl(result.order.total ?? result.order.subtotal)}. ${modeText}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    formError.textContent = error.message || 'Não foi possível finalizar o pedido.';
  } finally {
    confirmButton.disabled = false;
    confirmButton.textContent = 'Confirmar pedido';
  }
});

async function updatePaymentNotice() {
  const notice = document.getElementById('paymentNotice');
  const baseUrl = (window.API_BASE_URL || '').replace(/\/$/, '');
  if (!notice || !baseUrl) return;
  try {
    const response = await fetch(baseUrl + '/api/payments/status', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const config = await response.json();
    if (config.mode === 'mercadopago') {
      notice.textContent = 'Pagamento seguro: você será redirecionado ao Mercado Pago para concluir a transação.';
    } else if (config.mode === 'incomplete') {
      notice.textContent = 'A integração de pagamento foi iniciada, mas falta configurar credenciais e URL HTTPS no servidor.';
    } else {
      notice.textContent = 'Modo demonstrativo: nenhum pagamento real será processado até configurar um gateway.';
    }
  } catch {
    notice.textContent = 'Não foi possível verificar a configuração de pagamento. Tente novamente em instantes.';
  }
}

function displayPaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const paymentReturn = params.get('payment');
  if (!['success', 'pending', 'failure'].includes(paymentReturn)) return false;

  const orderNumber = params.get('order');
  content.classList.add('hidden');
  emptyState.classList.add('hidden');
  successState.classList.remove('hidden');
  confirmButton.disabled = true;

  const title = document.getElementById('successTitle');
  const message = {
    success: 'Retorno recebido. O servidor confirmará o pagamento somente após validar a notificação do Mercado Pago. Não envie o pedido novamente.',
    pending: 'O pagamento está pendente ou em processamento. Aguarde a confirmação do Mercado Pago antes de considerar o pedido pago.',
    failure: 'O pagamento não foi confirmado. Consulte o painel administrativo antes de tentar novamente para evitar pedidos duplicados.'
  };
  title.textContent = paymentReturn === 'success'
    ? 'Estamos confirmando seu pagamento'
    : (paymentReturn === 'pending' ? 'Pagamento em processamento' : 'Pagamento não confirmado');
  document.getElementById('successText').textContent =
    (orderNumber ? 'Pedido: ' + orderNumber + '. ' : '') + message[paymentReturn];
  return true;
}

const returnedFromPayment = displayPaymentReturn();
updatePaymentNotice();

syncCheckoutProducts().then(() => {
  if (returnedFromPayment) return;
  if (validCart.length) {
    renderSummary();
    confirmButton.disabled = false;
    confirmButton.textContent = 'Confirmar pedido';
  } else {
    showEmptyState();
    confirmButton.disabled = true;
    confirmButton.textContent = 'Pedido vazio';
  }
});
