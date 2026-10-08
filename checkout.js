const products = window.PRODUCTS;
const brl = value => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const cart = JSON.parse(localStorage.getItem('engrenagens-cart') || '[]')
  .map(item => ({ id: item.id, qty: Number(item.qty) || 0 }))
  .filter(item => item.qty > 0);

const validCart = cart
  .map(item => {
    const product = products.find(p => p.id === item.id);
    if (!product || product.stock <= 0) return null;
    return { ...item, qty: Math.min(item.qty, product.stock) };
  })
  .filter(Boolean)
  .filter(item => item.qty > 0);

const content = document.getElementById('checkoutContent');
const emptyState = document.getElementById('emptyState');
const successState = document.getElementById('successState');
const orderItems = document.getElementById('orderItems');
const subtotalEl = document.getElementById('subtotal');
const totalEl = document.getElementById('total');
const formError = document.getElementById('formError');
const confirmButton = document.getElementById('confirmOrder');

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

confirmButton.addEventListener('click', () => {
  formError.textContent = '';
  const data = collectFormData();
  const error = validate(data);
  if (error) {
    formError.textContent = error;
    return;
  }

  const orderNumber = createOrderNumber();
  const subtotal = getSubtotal();
  const order = {
    orderNumber,
    createdAt: new Date().toISOString(),
    customer: data,
    items: validCart,
    subtotal
  };

  localStorage.setItem('engrenagens-last-order', JSON.stringify(order));
  localStorage.removeItem('engrenagens-cart');

  content.classList.add('hidden');
  successState.classList.remove('hidden');
  document.getElementById('successText').textContent =
    `Número do pedido: ${orderNumber}. Total demonstrativo: ${brl(subtotal)}. A confirmação foi registrada neste navegador; para operação real, conecte o checkout a um backend e gateway de pagamento.`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

if (validCart.length) {
  renderSummary();
} else {
  showEmptyState();
}
