const baseUrl = (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');

async function check(path, validator) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const body = await response.text();
  const result = validator ? validator(body, response) : true;
  if (!result) throw new Error(`${path}: resposta inesperada`);
  console.log(`OK  ${path}`);
  return body;
}

try {
  await check('/api/health', body => {
    const health = JSON.parse(body);
    return health.ok === true && health.service === 'engrenagens-ltda-api';
  });

  await check('/api/products', body => {
    const payload = JSON.parse(body);
    return Array.isArray(payload.products) &&
      payload.products.length > 0 &&
      payload.products.every(product =>
        Number.isInteger(product.id) &&
        typeof product.name === 'string' &&
        typeof product.sku === 'string' &&
        Number.isFinite(product.price) &&
        Number.isInteger(product.stock)
      );
  });

  const productAdminResponse = await fetch(`${baseUrl}/api/admin/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({})
  });
  if (![401, 503].includes(productAdminResponse.status)) {
    throw new Error(`/api/admin/products: esperado endpoint protegido (HTTP 401 ou 503), recebido HTTP ${productAdminResponse.status}`);
  }
  console.log('OK  /api/admin/products exige autenticação administrativa');

  await check('/api/payments/status', body => {
    const payment = JSON.parse(body);
    return ['demo', 'incomplete', 'mercadopago'].includes(payment.mode) &&
      typeof payment.configured === 'boolean';
  });

  await check('/', body => body.toLowerCase().includes('<!doctype html') && body.includes('Engrenagens LTDA'));
  await check('/checkout.html', body => body.includes('checkout.js'));
  await check('/admin.html', body => body.includes('admin.js'));

  const privateData = await fetch(`${baseUrl}/server/src/data/orders.json`);
  if (privateData.status !== 404) {
    throw new Error('Os arquivos internos do servidor parecem estar expostos.');
  }
  console.log('OK  arquivos internos não são públicos');

  console.log('\nDiagnóstico concluído: API e páginas principais respondendo corretamente.');
} catch (error) {
  console.error('\nFalha no diagnóstico:', error.message);
  console.error('Confirme se npm run dev está rodando e se a API está em', baseUrl);
  process.exitCode = 1;
}
