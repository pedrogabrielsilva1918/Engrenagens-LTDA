(() => {
  const API = String(window.API_BASE_URL || '').replace(/\/$/, '');
  const STORAGE_KEY = 'engrenagens-chat-session';
  let saved = readSavedSession();
  let currentSession = null;
  let pollTimer = null;
  let sending = false;

  const root = document.createElement('div');
  root.id = 'engChatRoot';
  root.innerHTML = '<button id="engChatLauncher" class="engChatLauncher" type="button" aria-expanded="false" aria-controls="engChatPanel"><span class="engChatLauncherIcon" aria-hidden="true">✉</span><span>Falar com atendimento</span></button>' +
    '<section id="engChatPanel" class="engChatPanel" aria-label="Atendimento por chat" hidden>' +
    '<header class="engChatHeader"><div><strong>Atendimento Engrenagens</strong><small id="engChatSubtitle">Tire suas dúvidas com nossa equipe</small></div><button id="engChatClose" class="engChatClose" type="button" aria-label="Fechar chat">×</button></header>' +
    '<div id="engChatBody" class="engChatBody">' +
    '<div class="engChatWelcome"><span class="engChatWelcomeIcon">E</span><strong>Olá! Como podemos ajudar?</strong><p>Envie sua dúvida sobre produtos, pedidos ou orçamentos.</p></div>' +
    '<form id="engChatStartForm" class="engChatForm">' +
    '<label>Seu nome<input id="engChatName" name="name" maxlength="100" autocomplete="name" required placeholder="Nome completo"></label>' +
    '<label>E-mail<input id="engChatEmail" name="email" type="email" maxlength="200" autocomplete="email" required placeholder="voce@empresa.com"></label>' +
    '<label>Mensagem<textarea id="engChatFirstMessage" name="message" maxlength="1500" required rows="3" placeholder="Escreva sua dúvida..."></textarea></label>' +
    '<button id="engChatStartButton" class="engChatPrimary" type="submit">Iniciar conversa</button><p id="engChatStartError" class="engChatError" role="alert"></p></form>' +
    '<div id="engChatConversation" class="engChatConversation" hidden><div id="engChatMessages" class="engChatMessages" role="log" aria-live="polite" aria-label="Mensagens da conversa"></div>' +
    '<p id="engChatClosedNotice" class="engChatClosedNotice" hidden>Esta conversa foi encerrada pelo atendimento.</p>' +
    '<form id="engChatReplyForm" class="engChatReplyForm"><label class="engChatSrOnly" for="engChatReply">Sua mensagem</label><textarea id="engChatReply" maxlength="1500" rows="2" required placeholder="Digite uma mensagem..."></textarea><button id="engChatSendButton" type="submit" aria-label="Enviar mensagem">Enviar</button></form>' +
    '<p id="engChatReplyError" class="engChatError" role="alert"></p><button id="engChatNewButton" class="engChatNewButton" type="button" hidden>Iniciar nova conversa</button></div></div>' +
    '<footer class="engChatFooter"><span id="engChatConnectionDot" aria-hidden="true"></span><span id="engChatFooterText">Atendimento via chat</span><span>•</span><span>Chat de suporte</span></footer></section>';
  document.body.appendChild(root);

  const byId = id => document.getElementById(id);
  const launcher = byId('engChatLauncher');
  const panel = byId('engChatPanel');
  const startForm = byId('engChatStartForm');
  const conversation = byId('engChatConversation');
  const messagesElement = byId('engChatMessages');
  const startError = byId('engChatStartError');
  const replyError = byId('engChatReplyError');
  const sendButton = byId('engChatSendButton');

  function readSavedSession() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return value && typeof value.id === 'string' && typeof value.token === 'string' ? value : null;
    } catch {
      return null;
    }
  }

  function setFooter(message, online = true) {
    byId('engChatFooterText').textContent = message;
    byId('engChatConnectionDot').classList.toggle('offline', !online);
  }

  async function api(path, options = {}, token = saved && saved.token) {
    if (!API) throw new Error('O chat ainda não está conectado à API da loja.');
    const headers = Object.assign({ Accept: 'application/json' }, options.body ? { 'Content-Type': 'application/json' } : {}, token ? { 'x-chat-token': token } : {}, options.headers || {});
    let response;
    try {
      response = await fetch(API + path, Object.assign({}, options, { headers }));
    } catch {
      throw new Error('Não foi possível conectar ao chat. Confira a conexão e tente novamente.');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'O chat não conseguiu concluir a solicitação.');
    return payload;
  }

  function timeLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function renderMessages(session) {
    messagesElement.replaceChildren();
    for (const message of session.messages || []) {
      const article = document.createElement('article');
      article.className = 'engChatMessage ' + (message.sender === 'customer' ? 'fromCustomer' : 'fromAdmin');
      const label = document.createElement('div');
      label.className = 'engChatMessageMeta';
      label.textContent = (message.sender === 'customer' ? 'Você' : 'Atendimento') + (message.createdAt ? ' · ' + timeLabel(message.createdAt) : '');
      const text = document.createElement('p');
      text.textContent = message.text || '';
      article.append(label, text);
      messagesElement.appendChild(article);
    }
    messagesElement.scrollTop = messagesElement.scrollHeight;
    const isOpen = session.status === 'open';
    byId('engChatReply').disabled = !isOpen;
    sendButton.disabled = !isOpen || sending;
    byId('engChatReplyForm').hidden = !isOpen;
    byId('engChatClosedNotice').hidden = isOpen;
    byId('engChatNewButton').hidden = isOpen;
    byId('engChatSubtitle').textContent = isOpen ? 'Conversa aberta' : 'Conversa encerrada';
  }

  function showConversation(session) {
    currentSession = session;
    startForm.hidden = true;
    root.querySelector('.engChatWelcome').hidden = true;
    conversation.hidden = false;
    renderMessages(session);
    setFooter(session.status === 'open' ? 'Conversa ativa' : 'Conversa encerrada', session.status === 'open');
  }

  function showWelcome() {
    currentSession = null;
    conversation.hidden = true;
    startForm.hidden = false;
    root.querySelector('.engChatWelcome').hidden = false;
    byId('engChatSubtitle').textContent = 'Tire suas dúvidas com nossa equipe';
    setFooter(API ? 'Atendimento via chat' : 'Chat indisponível: API não configurada', Boolean(API));
    stopPolling();
  }

  async function refreshConversation(quiet = true) {
    if (!saved || panel.hidden) return;
    try {
      const payload = await api('/api/chat/sessions/' + encodeURIComponent(saved.id), {}, saved.token);
      showConversation(payload.session);
      setFooter(payload.session.status === 'open' ? 'Conectado ao atendimento' : 'Conversa encerrada', payload.session.status === 'open');
    } catch (error) {
      if (error.message.includes('token inválido') || error.message.includes('Conversa não encontrada')) {
        localStorage.removeItem(STORAGE_KEY);
        saved = null;
        showWelcome();
        startError.textContent = 'A sessão anterior expirou. Inicie uma nova conversa.';
      } else if (!quiet) {
        replyError.textContent = error.message;
      } else {
        setFooter('Reconectando...', false);
      }
    }
  }

  function startPolling() {
    stopPolling();
    if (saved) pollTimer = window.setInterval(() => refreshConversation(true), 5000);
  }

  function stopPolling() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = null;
  }

  launcher.addEventListener('click', async () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    launcher.setAttribute('aria-expanded', String(opening));
    launcher.querySelector('span:last-child').textContent = opening ? 'Fechar atendimento' : 'Falar com atendimento';
    if (opening) {
      if (saved) {
        await refreshConversation(false);
        startPolling();
      } else {
        showWelcome();
        if (!API) startError.textContent = 'A API da loja não está configurada. Acesse a loja pela porta 3000.';
      }
      byId(saved ? 'engChatReply' : 'engChatName').focus();
    } else {
      stopPolling();
    }
  });

  byId('engChatClose').addEventListener('click', () => {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.querySelector('span:last-child').textContent = 'Falar com atendimento';
    stopPolling();
  });

  startForm.addEventListener('submit', async event => {
    event.preventDefault();
    startError.textContent = '';
    const button = byId('engChatStartButton');
    button.disabled = true;
    button.textContent = 'Iniciando...';
    try {
      const payload = await api('/api/chat/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: byId('engChatName').value.trim(),
          email: byId('engChatEmail').value.trim(),
          message: byId('engChatFirstMessage').value.trim()
        })
      }, null);
      saved = { id: payload.session.id, token: payload.token, name: payload.session.name, email: payload.session.email };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      byId('engChatFirstMessage').value = '';
      showConversation(payload.session);
      startPolling();
      byId('engChatReply').focus();
    } catch (error) {
      startError.textContent = error.message || 'Não foi possível iniciar o chat.';
    } finally {
      button.disabled = false;
      button.textContent = 'Iniciar conversa';
    }
  });

  byId('engChatReplyForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!saved || !currentSession || currentSession.status !== 'open') return;
    const input = byId('engChatReply');
    const message = input.value.trim();
    if (!message || sending) return;
    sending = true;
    sendButton.disabled = true;
    replyError.textContent = '';
    try {
      const payload = await api('/api/chat/sessions/' + encodeURIComponent(saved.id) + '/messages', {
        method: 'POST',
        body: JSON.stringify({ message })
      });
      input.value = '';
      showConversation(payload.session);
    } catch (error) {
      replyError.textContent = error.message || 'Não foi possível enviar a mensagem.';
    } finally {
      sending = false;
      sendButton.disabled = !currentSession || currentSession.status !== 'open';
    }
  });

  byId('engChatNewButton').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    saved = null;
    startForm.reset();
    startError.textContent = '';
    replyError.textContent = '';
    showWelcome();
    byId('engChatName').focus();
  });

  if (saved) setFooter('Conversa disponível', true);
})();