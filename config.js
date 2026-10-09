/*
 * Configuração da API:
 * - VS Code local: usa http://localhost:3000 automaticamente.
 * - GitHub Codespaces: troca a porta do frontend pela porta 3000.
 * - Produção: defina uma URL HTTPS fixa para a API.
 *
 * Nunca coloque ADMIN_API_KEY aqui. Essa chave fica somente no .env do servidor.
 */
(function configureApiBaseUrl() {
  const host = window.location.hostname;
  let apiBaseUrl = '';

  if (host === 'localhost' || host === '127.0.0.1') {
    apiBaseUrl = 'http://localhost:3000';
  } else if (/-\d+\.app\.github\.dev$/.test(host)) {
    apiBaseUrl = window.location.protocol + '//' + host.replace(/-\d+\.app\.github\.dev$/, '-3000.app.github.dev');
  }

  // Para produção, substitua por uma URL real da API, por exemplo:
  // apiBaseUrl = 'https://api.seudominio.com';

  window.API_BASE_URL = apiBaseUrl;
})();
