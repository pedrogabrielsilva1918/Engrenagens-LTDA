let products = window.PRODUCTS;
let categories = [];
let state = { cat: 'Todos', search: '', sort: 'featured', cart: JSON.parse(localStorage.getItem('engrenagens-cart') || '[]') };
state.cart = state.cart
    .map(item => ({ id: item.id, qty: Math.max(0, Math.min(item.qty, products.find(p => p.id === item.id)?.stock ?? 0)) }))
    .filter(item => item.qty > 0);
const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
const grid = document.getElementById('grid'), pills = document.getElementById('pills'), quoteProduct = document.getElementById('quoteProduct');
function renderCategoryPills() {
  categories = ['Todos', ...new Set(products.map(p => String(p.category || '').trim()).filter(Boolean))];
  if (!categories.includes(state.cat)) state.cat = 'Todos';
  pills.innerHTML = '';
  categories.forEach(c => {
    const button = document.createElement('button');
    button.className = 'pill' + (c === state.cat ? ' active' : '');
    button.textContent = c;
    button.onclick = () => { state.cat = c; renderCategoryPills(); render(); };
    pills.appendChild(button);
  });
}
renderCategoryPills();
function populateQuoteProducts() { quoteProduct.innerHTML = '<option value="">Produto de interesse</option>'; products.forEach(p => { const o = document.createElement('option'); o.value = p.name; o.textContent = p.name; quoteProduct.appendChild(o) }); }
populateQuoteProducts();

async function syncProductsFromApi() {
  const baseUrl = (window.API_BASE_URL || '').replace(/\/$/, '');
  if (!baseUrl) return;
  try {
    const response = await fetch(`${baseUrl}/api/products`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const payload = await response.json();
    if (!Array.isArray(payload.products)) return;
    products = payload.products;
    state.cart = state.cart
      .map(item => ({ id: item.id, qty: Math.min(Number(item.qty) || 0, products.find(p => p.id === item.id)?.stock ?? 0) }))
      .filter(item => item.qty > 0);
    localStorage.setItem('engrenagens-cart', JSON.stringify(state.cart));
    renderCategoryPills();
    populateQuoteProducts();
    render();
    updateCart();
  } catch (error) {
    console.warn('API de produtos indisponível. Usando catálogo local.', error);
  }
}
function filtered() { let a = products.filter(p => (state.cat === 'Todos' || p.category === state.cat) && `${p.name} ${p.category} ${p.sku}`.toLowerCase().includes(state.search.toLowerCase())); if (state.sort === 'priceAsc') a.sort((x, y) => x.price - y.price); if (state.sort === 'priceDesc') a.sort((x, y) => y.price - x.price); if (state.sort === 'rating') a.sort((x, y) => y.rating - x.rating); return a }
function render() {
  grid.innerHTML = filtered().map(p => {
    const available = Number(p.stock) > 0;
    const low = available && Number(p.stock) <= 5;
    return `<article class="product" onclick="openProduct(${Number(p.id)})"><div class="thumb">${p.badge ? `<span class="badge">${escapeHtml(p.badge)}</span>` : ''}<button class="wish" onclick="event.stopPropagation();toggleWish(this)" aria-label="Favoritar ${escapeHtml(p.name)}">♡</button><div class="thumbArt"></div></div><div class="info"><div class="category">${escapeHtml(p.category)}</div><div class="name">${escapeHtml(p.name)}</div><div class="sku">SKU ${escapeHtml(p.sku)}</div><div class="rating">★ <b>${Number(p.rating) || 5}</b> · ${Number(p.reviews) || 0} avaliações</div><div class="stockLine ${!available ? 'out' : low ? 'low' : ''}">${!available ? 'Esgotado' : low ? `Últimas ${Number(p.stock)} unidades` : `Em estoque · ${Number(p.stock)} unidades`}</div><div class="price"><strong>${brl(p.price)}</strong>${p.old ? `<span class="old">${brl(p.old)}</span>` : ''}</div><button class="add" ${!available ? 'disabled' : ''} onclick="event.stopPropagation();addToCart(${Number(p.id)})">${available ? 'Adicionar ao pedido' : 'Indisponível'}</button></div></article>`;
  }).join('') || '<div class="empty" style="grid-column:1/-1">Nenhum produto encontrado. Tente outro termo.</div>';
}
function toggleWish(btn) { btn.classList.toggle('active'); btn.textContent = btn.classList.contains('active') ? '♥' : '♡' }
function openProduct(id) { const p = products.find(x => x.id === id); if (!p) return; document.getElementById('detailCategory').textContent = p.category; document.getElementById('detailName').textContent = p.name; document.getElementById('detailSku').textContent = 'SKU ' + p.sku; document.getElementById('detailRating').innerHTML = '★ <b>' + p.rating + '</b> · ' + p.reviews + ' avaliações'; document.getElementById('detailDescription').textContent = p.description || 'Componente para aplicações industriais e transmissão mecânica.'; document.getElementById('detailPrice').textContent = brl(p.price); document.getElementById('detailOld').textContent = p.old ? brl(p.old) : '';
  const detailStock = document.getElementById('detailStock');
  detailStock.textContent = p.stock > 0 ? `Em estoque · ${p.stock} unidades` : 'Esgotado';
  detailStock.className = 'detailStock ' + (p.stock > 0 ? (p.stock <= 5 ? 'low' : '') : 'out');
  const detailAdd = document.getElementById('detailAdd');
  detailAdd.disabled = p.stock <= 0;
  detailAdd.textContent = p.stock > 0 ? 'Adicionar ao pedido' : 'Produto esgotado'; document.getElementById('detailSpecs').innerHTML = Object.entries(p.specs || {}).map(([k, v]) => `<div class="specItem"><small>${escapeHtml(k)}</small><b>${escapeHtml(v)}</b></div>`).join(''); document.getElementById('detailAdd').onclick = () => { addToCart(p.id); closeProduct() }; document.getElementById('detailQuote').onclick = () => { closeProduct(); document.getElementById('quoteProduct').value = p.name; document.getElementById('orcamento').scrollIntoView({ behavior: 'smooth' }) }; document.getElementById('productModal').classList.add('open') }
function closeProduct() { document.getElementById('productModal').classList.remove('open') }
function save() { localStorage.setItem('engrenagens-cart', JSON.stringify(state.cart)); updateCart() }
function addToCart(id) {
  const p = products.find(x => x.id === id);
  if (!p || p.stock <= 0) return;
  let i = state.cart.find(x => x.id === id);
  const current = i ? i.qty : 0;
  if (current >= p.stock) {
    alert(`Limite de estoque atingido: ${p.stock} unidades disponíveis.`);
    return;
  }
  if (i) i.qty++; else state.cart.push({ id, qty: 1 });
  save();
  openCart();
}
function updateCart() { document.getElementById('cartCount').textContent = state.cart.reduce((s, i) => s + i.qty, 0); const body = document.getElementById('cartBody'); if (!state.cart.length) { body.innerHTML = '<div class="empty">Seu pedido está vazio.<br>Adicione peças do catálogo.</div>' } else { body.innerHTML = state.cart.map(i => { const p = products.find(x => x.id === i.id); return `<div class="cartItem"><div class="cartThumb">⚙️</div><div><b>${escapeHtml(p.name)}</b><div style="font-size:11px;color:#777">SKU ${escapeHtml(p.sku)}</div><div style="font-size:12px;color:#777">${brl(p.price)} cada</div><div class="qty"><button onclick="changeQty(${p.id},-1)">−</button><b>${i.qty}</b><button onclick="changeQty(${p.id},1)">+</button><span class="remove" onclick="removeItem(${p.id})">remover</span></div></div><b>${brl(p.price * i.qty)}</b></div>` }).join('') }; document.getElementById('cartTotal').textContent = brl(state.cart.reduce((s, i) => s + products.find(p => p.id === i.id).price * i.qty, 0)) }
function changeQty(id, d) {
  const i = state.cart.find(x => x.id === id);
  const p = products.find(x => x.id === id);
  if (!i || !p) return;
  if (d > 0 && i.qty >= p.stock) {
    alert(`Limite de estoque atingido: ${p.stock} unidades disponíveis.`);
    return;
  }
  i.qty += d;
  if (i.qty <= 0) state.cart = state.cart.filter(x => x.id !== id);
  save();
} function removeItem(id) { state.cart = state.cart.filter(x => x.id !== id); save() }
function openCart() { document.getElementById('drawer').classList.add('open'); document.getElementById('overlay').classList.add('open') } function closeCart() { document.getElementById('drawer').classList.remove('open'); document.getElementById('overlay').classList.remove('open') }
document.getElementById('cartBtn').onclick = openCart; document.getElementById('closeProductModal').onclick = closeProduct; document.getElementById('productModal').addEventListener('click', e => { if (e.target.id === 'productModal') closeProduct() }); document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeProduct(); closeCart() } }); document.getElementById('closeCart').onclick = closeCart; document.getElementById('overlay').onclick = closeCart; document.getElementById('search').addEventListener('input', e => { state.search = e.target.value; render() }); document.getElementById('sort').addEventListener('change', e => { state.sort = e.target.value; render() }); document.getElementById('searchFocus').onclick = () => { document.getElementById('search').focus(); document.getElementById('catalogo').scrollIntoView({ behavior: 'smooth' }) };
document.getElementById('checkoutBtn').onclick = () => {
  if (!state.cart.length) {
    alert('Seu pedido está vazio.');
    return;
  }
  window.location.href = 'checkout.html';
};
document.getElementById('quoteForm').onsubmit = e => { e.preventDefault(); alert('Solicitação de orçamento registrada no modo demonstrativo. Conecte este formulário ao e-mail, CRM ou WhatsApp da empresa.') };
render(); updateCart(); syncProductsFromApi();
