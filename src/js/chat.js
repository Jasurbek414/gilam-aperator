const ChatManager = {
  socket: null,
  activeChatUserId: null,
  drivers: {},
  _lastSenderId: null,
  // "Biriktirish" uchun tanlangan lokatsiya
  _attachCoords: null,
  _attachSelectedCustomerId: null,
  _allCustomers: [],
  
  // Xabarni uzatish (Forward)
  _forwardMessageText: null,
  _forwardSelectedUserId: null,
  _allDriversArray: [],

  init() {
    this.el = {
      driversList:   document.getElementById('chat-drivers-list'),
      messagesBox:   document.getElementById('chat-messages-list'),
      input:         document.getElementById('chat-input'),
      sendBtn:       document.getElementById('chat-send-btn'),
      panel:         document.getElementById('chat-panel'),
      placeholder:   document.getElementById('chat-placeholder'),
      panelName:     document.getElementById('chat-panel-name'),
      panelRole:     document.getElementById('chat-panel-role'),
      panelAvatar:   document.getElementById('chat-panel-avatar'),
      closePanelBtn: document.getElementById('btn-close-chat-panel'),
      statusDot:     document.getElementById('chat-status-dot'),
      driversCount:  document.getElementById('chat-drivers-count'),
      searchInput:   document.getElementById('chat-search'),
      fileInput:     document.getElementById('chat-file-input'),
      btnImage:      document.getElementById('chat-btn-image'),
    };

    if (!this.el.driversList) return;

    this.el.closePanelBtn?.addEventListener('click', () => this.closePanel());
    this.el.sendBtn?.addEventListener('click', () => this.sendMessage());
    this.el.input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
    });
    this.el.input?.addEventListener('input', (e) => {
      e.target.style.height = '';
      e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    });
    this.el.searchInput?.addEventListener('input', (e) => this.filterDrivers(e.target.value));

    // Rasm yuborish — Electron native dialog yoki web fallback
    this.el.btnImage?.addEventListener('click', () => this.handleImageFile(null));
    this.el.fileInput?.addEventListener('change', (e) => this.handleImageFile(e));

    // Biriktirish modali event'lari
    document.getElementById('chat-attach-close')?.addEventListener('click', () => this._closeAttachModal());
    document.getElementById('chat-attach-search')?.addEventListener('input', (e) => this._filterCustomers(e.target.value));
    document.getElementById('chat-attach-confirm')?.addEventListener('click', () => this._confirmAttach());

    // Xabarni uzatish event'lari
    document.getElementById('chat-forward-close')?.addEventListener('click', () => this._closeForwardModal());
    document.getElementById('chat-forward-search')?.addEventListener('input', (e) => this._filterForwardDrivers(e.target.value));
    document.getElementById('chat-forward-confirm')?.addEventListener('click', () => this._confirmForward());

    // Chat tab ochilganda ulanish
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab="chat"]');
      if (btn && !this.socket) this.connect();
    });
  },

  filterDrivers(query) {
    const q = (query || '').toLowerCase();
    this.el.driversList?.querySelectorAll('.chat-driver-item').forEach(el => {
      const name = el.querySelector('.chat-driver-name')?.textContent?.toLowerCase() || '';
      el.style.display = name.includes(q) ? '' : 'none';
    });
  },

  // ─── WebSocket ulanish ──────────────────────────────────────────────────────
  async connect() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      this._setStatus('connecting');

      this.socket = io('https://gilam-api.ecos.uz/chat', {
        path: '/socket.io',
        query: { token },
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      });

      this.socket.on('connect', () => {
        console.log('[Chat] /chat namespace ga ulandi');
        this._setStatus('online');
        this.loadDrivers();
      });

      this.socket.on('connect_error', (err) => {
        console.error('[Chat] Ulanish xatoligi:', err.message);
        this._setStatus('offline');
      });

      this.socket.on('disconnect', () => this._setStatus('offline'));
      this.socket.on('newMessage', (msg) => this.handleIncomingMessage(msg));
      this.socket.on('messageSent', (msg) => {
        console.log('[Chat] Server tasdiqladi:', msg?.id);
      });

    } catch (err) {
      console.error('[Chat] connect xatoligi:', err);
      this._setStatus('offline');
    }
  },

  _setStatus(state) {
    const dot = this.el.statusDot;
    if (!dot) return;
    dot.className = 'chat-online-badge ' + state;
  },

  // ─── Haydovchilar ro'yxati ──────────────────────────────────────────────────
  async loadDrivers() {
    try {
      const ulist = await window.Api.request('/users');
      if (!ulist || !Array.isArray(ulist)) return;

      const myId = window.Api.config.currentUser?.id;
      const drivers = ulist.filter(u => u.role === 'DRIVER' && u.id !== myId);

      let convUsers = [];
      try { convUsers = await window.Api.request('/messages/conversations') || []; } catch(_) {}

      const seen = new Set();
      const allUsers = [...drivers, ...convUsers].filter(u => {
        if (!u || !u.id || seen.has(u.id) || u.id === myId) return false;
        seen.add(u.id); return true;
      });

      this.el.driversList.innerHTML = '';

      if (allUsers.length === 0) {
        this.el.driversList.innerHTML = `<div class="chat-list-loading"><span class="material-icons-round">people_outline</span><span>Haydovchilar topilmadi</span></div>`;
        return;
      }

      if (this.el.driversCount) this.el.driversCount.textContent = `${allUsers.length} ta haydovchi`;
      allUsers.forEach(u => { this.drivers[u.id] = u; this._addDriverItem(u); });

    } catch (e) {
      console.error('[Chat] Drivers yuklash xatoligi:', e);
    }
  },

  _addDriverItem(user) {
    if (document.getElementById(`driver-item-${user.id}`)) return;
    const initials = (user.fullName || '?').charAt(0).toUpperCase();
    const div = document.createElement('div');
    div.id = `driver-item-${user.id}`;
    div.className = 'chat-driver-item';
    div.innerHTML = `
      <div class="chat-driver-avatar">${initials}</div>
      <div class="chat-driver-info">
        <div class="chat-driver-name">${user.fullName || user.phone}</div>
        <div class="chat-driver-last">Haydovchi</div>
      </div>
      <div class="chat-driver-meta">
        <div class="chat-driver-time" id="driver-time-${user.id}"></div>
      </div>
    `;
    div.addEventListener('click', () => this.selectChat(user.id));
    this.el.driversList.appendChild(div);
  },

  // ─── Chat tanlash ────────────────────────────────────────────────────────────
  async selectChat(userId) {
    this.activeChatUserId = userId;

    this.el.driversList.querySelectorAll('.chat-driver-item').forEach(el => {
      el.classList.toggle('active', el.id === `driver-item-${userId}`);
    });
    document.getElementById(`driver-item-${userId}`)?.querySelector('.chat-unread-badge')?.remove();

    const user = this.drivers[userId];
    const initials = (user?.fullName || '?').charAt(0).toUpperCase();

    if (this.el.panelName)   this.el.panelName.textContent   = user?.fullName || '-';
    if (this.el.panelRole)   this.el.panelRole.textContent   = 'Haydovchi • Online';
    if (this.el.panelAvatar) this.el.panelAvatar.textContent = initials;
    if (this.el.panel)       this.el.panel.style.display     = 'flex';
    if (this.el.placeholder) this.el.placeholder.style.display = 'none';

    this.el.input?.focus();

    try {
      const history = await window.Api.request(`/messages/history/${userId}`);
      if (this.el.messagesBox) this.el.messagesBox.innerHTML = '';
      this._lastSenderId = null;
      if (history && Array.isArray(history)) {
        history.forEach(m => this.renderMessage(m));
      }
      this.scrollToBottom();
    } catch (e) {
      console.warn('[Chat] Tarix yuklanmadi:', e);
    }
  },

  closePanel() {
    this.activeChatUserId = null;
    this._lastSenderId = null;
    if (this.el.panel)       this.el.panel.style.display       = 'none';
    if (this.el.placeholder) this.el.placeholder.style.display = 'flex';
    this.el.driversList?.querySelectorAll('.chat-driver-item').forEach(el => el.classList.remove('active'));
  },

  // ─── Matn xabari yuborish ────────────────────────────────────────────────────
  sendMessage() {
    const val = this.el.input?.value?.trim();
    if (!val || !this.activeChatUserId || !this.socket) return;

    const me = window.Api.config.currentUser || {};
    this.socket.emit('sendMessage', {
      text: val,
      recipientId: this.activeChatUserId,
      companyId: me.companyId,
    });

    this.renderMessage({
      text: val,
      senderId: me.id,
      sender: me,
      createdAt: new Date().toISOString(),
    });

    this.el.input.value = '';
    this.el.input.style.height = '';
    this.scrollToBottom();
  },

  _sendRaw(text) {
    if (!this.activeChatUserId || !this.socket) return;
    const me = window.Api.config.currentUser || {};
    this.socket.emit('sendMessage', {
      text,
      recipientId: this.activeChatUserId,
      companyId: me.companyId,
    });
  },

  // ─── Rasm yuborish (Electron native dialog) ─────────────────────────────────
  async handleImageFile(e) {
    if (!this.activeChatUserId) return;

    // Electron native dialog orqali
    if (window.require) {
      try {
        const { ipcRenderer } = window.require('electron');
        const result = await ipcRenderer.invoke('pick-image');
        if (!result) return;
        if (result.error) { window.Utils?.showToast(result.error, 'warning'); return; }
        this._sendImageBase64(result.base64);
        return;
      } catch (_) {}
    }

    // Web fallback
    const file = e && e.target && e.target.files ? e.target.files[0] : null;
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      window.Utils?.showToast('Rasm 5MB dan katta bolmasin', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => this._sendImageBase64(ev.target.result);
    reader.readAsDataURL(file);
    if (e && e.target) e.target.value = '';
  },

  _sendImageBase64(base64) {
    if (!base64 || !this.activeChatUserId) return;
    const text = '[IMAGE]:' + base64;
    this._sendRaw(text);
    this.renderMessage({
      text,
      senderId: window.Api.config.currentUser && window.Api.config.currentUser.id,
      sender: window.Api.config.currentUser,
      createdAt: new Date().toISOString(),
    });
    this.scrollToBottom();
  },

  // ─── Kiruvchi xabar ──────────────────────────────────────────────────────────
  handleIncomingMessage(msg) {
    if (!this.drivers[msg.senderId] && msg.sender) {
      this.drivers[msg.senderId] = msg.sender;
      this._addDriverItem(msg.sender);
    }

    if (this.activeChatUserId === msg.senderId) {
      this.renderMessage(msg);
      this.scrollToBottom();
    } else {
      const preview = msg.text?.startsWith('[IMAGE]:')?    '📷 Rasm'
                    : msg.text?.startsWith('[LOCATION]:')?  '📍 Lokatsiya'
                    : msg.text?.substring(0, 40);
      if (window.Utils?.showToast) {
        window.Utils.showToast(`💬 ${msg.sender?.fullName || 'Haydovchi'}: ${preview}`, 'info');
      }
      const driverEl = document.getElementById(`driver-item-${msg.senderId}`);
      if (driverEl) {
        let badge = driverEl.querySelector('.chat-unread-badge');
        if (!badge) {
          badge = document.createElement('div');
          badge.className = 'chat-unread-badge';
          badge.textContent = '1';
          driverEl.querySelector('.chat-driver-meta')?.appendChild(badge);
        } else {
          badge.textContent = String((parseInt(badge.textContent) || 0) + 1);
        }
        const lastEl = driverEl.querySelector('.chat-driver-last');
        if (lastEl) lastEl.textContent = preview;
      }
    }
  },

  // ─── Lokatsiyani mijozga biriktirish ─────────────────────────────────────────
  async openAttachModal(lat, lng) {
    this._attachCoords = { lat, lng };
    this._attachSelectedCustomerId = null;

    const modal = document.getElementById('chat-attach-modal');
    if (!modal) return;

    // Coords ko'rsatish
    const coordsEl = document.getElementById('chat-attach-coords');
    if (coordsEl) coordsEl.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    const gmapsEl = document.getElementById('chat-attach-gmaps');
    if (gmapsEl) gmapsEl.href = `https://www.google.com/maps?q=${lat},${lng}`;

    // Confirm tugmasini o'chirish
    const confirmBtn = document.getElementById('chat-attach-confirm');
    if (confirmBtn) confirmBtn.disabled = true;

    const statusEl = document.getElementById('chat-attach-status');
    if (statusEl) statusEl.textContent = '';

    modal.style.display = 'flex';

    // Mijozlarni yuklash
    await this._loadCustomers();
    this._renderCustomers(this._allCustomers);

    // Qidiruv inputini tozalash
    const search = document.getElementById('chat-attach-search');
    if (search) search.value = '';
  },

  _closeAttachModal() {
    const modal = document.getElementById('chat-attach-modal');
    if (modal) modal.style.display = 'none';
    this._attachCoords = null;
    this._attachSelectedCustomerId = null;
  },

  async _loadCustomers() {
    const listEl = document.getElementById('chat-attach-customers-list');
    if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);font-size:13px;">Yuklanmoqda...</div>';

    try {
      const myUser = window.Api.config.currentUser;
      const companyId = myUser?.companyId;
      let customers = [];

      if (companyId) {
        customers = await window.Api.request(`/customers/company/${companyId}`) || [];
      } else {
        customers = await window.Api.request('/customers') || [];
      }

      this._allCustomers = customers;
    } catch (e) {
      console.warn('[Chat] Customers yuklashda xato:', e);
      this._allCustomers = [];
    }
  },

  _renderCustomers(list) {
    const listEl = document.getElementById('chat-attach-customers-list');
    if (!listEl) return;

    if (!list || list.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);font-size:13px;">Mijozlar topilmadi</div>';
      return;
    }

    listEl.innerHTML = '';
    list.forEach(c => {
      const item = document.createElement('div');
      item.className = 'chat-attach-customer-item';
      item.dataset.id = c.id;
      item.innerHTML = `
        <div class="chat-attach-customer-avatar">${(c.fullName || '?')[0].toUpperCase()}</div>
        <div class="chat-attach-customer-info">
          <div class="chat-attach-customer-name">${c.fullName || '-'}</div>
          <div class="chat-attach-customer-phone">${c.phone1 || ''} ${c.address ? '· ' + c.address.substring(0, 30) : ''}</div>
        </div>
        ${c.location ? '<span class="material-icons-round" style="font-size:14px;color:var(--accent);" title="Manzil mavjud">location_on</span>' : ''}
      `;

      item.addEventListener('click', () => {
        listEl.querySelectorAll('.chat-attach-customer-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        this._attachSelectedCustomerId = c.id;
        const confirmBtn = document.getElementById('chat-attach-confirm');
        if (confirmBtn) confirmBtn.disabled = false;
        const statusEl = document.getElementById('chat-attach-status');
        if (statusEl) statusEl.textContent = `✓ Tanlandi: ${c.fullName}`;
      });

      listEl.appendChild(item);
    });
  },

  _filterCustomers(query) {
    const q = (query || '').toLowerCase();
    const filtered = this._allCustomers.filter(c =>
      (c.fullName || '').toLowerCase().includes(q) ||
      (c.phone1 || '').includes(q) ||
      (c.phone2 || '').includes(q) ||
      (c.address || '').toLowerCase().includes(q)
    );
    this._renderCustomers(filtered);
  },

  async _confirmAttach() {
    if (!this._attachCoords || !this._attachSelectedCustomerId) return;

    const { lat, lng } = this._attachCoords;
    const confirmBtn = document.getElementById('chat-attach-confirm');
    const statusEl = document.getElementById('chat-attach-status');

    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Saqlanmoqda...'; }

    try {
      await window.Api.request(`/customers/${this._attachSelectedCustomerId}`, {
        method: 'PUT',
        body: JSON.stringify({
          // PostgreSQL & TypeORM 'point' expects {x, y} format (x = lng, y = lat)
          location: { x: lng, y: lat },
          address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        })
      });

      if (statusEl) statusEl.textContent = '✅ Muvaffaqiyatli birikirildi!';
      if (statusEl) statusEl.style.color = 'var(--accent)';
      window.Utils?.showToast('📍 Lokatsiya mijoz manziliga biriktirildi', 'success');

      setTimeout(() => this._closeAttachModal(), 1500);

    } catch (e) {
      console.error('[Chat] Biriktirish xatoligi:', e);
      if (statusEl) statusEl.textContent = '❌ Xatolik: ' + (e.message || 'Saqlashda xato');
      if (statusEl) statusEl.style.color = '#f87171';
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.innerHTML = '<span class="material-icons-round">check</span> Biriktirish'; }
    }
  },

  // ─── Xabarni uzatish (Forward) ──────────────────────────────────────────────
  async openForwardModal(text) {
    this._forwardMessageText = text;
    this._forwardSelectedUserId = null;

    const modal = document.getElementById('chat-forward-modal');
    if (!modal) return;

    const confirmBtn = document.getElementById('chat-forward-confirm');
    if (confirmBtn) confirmBtn.disabled = true;

    const statusEl = document.getElementById('chat-forward-status');
    if (statusEl) statusEl.textContent = '';

    modal.style.display = 'flex';

    await this._loadForwardDrivers();
    this._renderForwardDrivers(this._allDriversArray);

    const search = document.getElementById('chat-forward-search');
    if (search) search.value = '';
  },

  _closeForwardModal() {
    const modal = document.getElementById('chat-forward-modal');
    if (modal) modal.style.display = 'none';
    this._forwardMessageText = null;
    this._forwardSelectedUserId = null;
  },

  async _loadForwardDrivers() {
    const listEl = document.getElementById('chat-forward-drivers-list');
    if (listEl) listEl.innerHTML = '<div class="chat-attach-loading"><span class="material-icons-round">hourglass_empty</span> Yuklanmoqda...</div>';

    try {
      const ulist = await window.Api.request('/users');
      if (!ulist || !Array.isArray(ulist)) return;

      const myId = window.Api.config.currentUser?.id;
      // Faqat boshqa haydovchilar yoki xodimlar
      const usersList = ulist.filter(u => u.id !== myId);
      this._allDriversArray = usersList;
    } catch (e) {
      console.warn('[Chat] Forward users yuklashda xato:', e);
      this._allDriversArray = [];
    }
  },

  _renderForwardDrivers(list) {
    const listEl = document.getElementById('chat-forward-drivers-list');
    if (!listEl) return;

    if (!list || list.length === 0) {
      listEl.innerHTML = '<div class="chat-attach-loading">Foydalanuvchilar topilmadi</div>';
      return;
    }

    listEl.innerHTML = '';
    list.forEach(u => {
      const item = document.createElement('div');
      item.className = 'chat-attach-customer-item';
      item.dataset.id = u.id;
      item.innerHTML = `
        <div class="chat-attach-customer-avatar">${(u.fullName || '?')[0].toUpperCase()}</div>
        <div class="chat-attach-customer-info">
          <div class="chat-attach-customer-name">${u.fullName || '-'}</div>
          <div class="chat-attach-customer-phone">${u.role || 'Haydovchi'} · ${u.phone}</div>
        </div>
      `;

      item.addEventListener('click', () => {
        listEl.querySelectorAll('.chat-attach-customer-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        this._forwardSelectedUserId = u.id;
        const confirmBtn = document.getElementById('chat-forward-confirm');
        if (confirmBtn) confirmBtn.disabled = false;
        const statusEl = document.getElementById('chat-forward-status');
        if (statusEl) statusEl.textContent = `✓ Tanlandi: ${u.fullName}`;
      });
      listEl.appendChild(item);
    });
  },

  _filterForwardDrivers(query) {
    const q = (query || '').toLowerCase();
    const filtered = this._allDriversArray.filter(u =>
      (u.fullName || '').toLowerCase().includes(q) ||
      (u.phone || '').includes(q)
    );
    this._renderForwardDrivers(filtered);
  },

  _confirmForward() {
    if (!this._forwardMessageText || !this._forwardSelectedUserId) return;

    // Save current active chat so we can send to another user properly
    const me = window.Api.config.currentUser || {};
    
    // We send via socket directly to recipient
    if (this.socket) {
      this.socket.emit('sendMessage', {
        text: this._forwardMessageText,
        recipientId: this._forwardSelectedUserId,
        companyId: me.companyId,
      });
    }

    // Agar uzatilgan xabar hozirgi ochiq chatdagi odamga bo'lsa render qilamiz
    if (this.activeChatUserId === this._forwardSelectedUserId) {
      this.renderMessage({
        text: this._forwardMessageText,
        senderId: me.id,
        sender: me,
        createdAt: new Date().toISOString(),
      });
      this.scrollToBottom();
    }

    window.Utils?.showToast('Xabar muvaffaqiyatli uzatildi', 'success');
    this._closeForwardModal();
  },

  // ─── Xabar render ────────────────────────────────────────────────────────────
  renderMessage(m) {
    if (!this.el.messagesBox) return;
    const myId = window.Api.config.currentUser?.id;
    const isMe = m.senderId === myId;
    const side = isMe ? 'me' : 'other';
    const timeStr = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const isSameGroup = this._lastSenderId === m.senderId;
    this._lastSenderId = m.senderId;

    let group;
    if (isSameGroup) {
      const groups = this.el.messagesBox.querySelectorAll(`.chat-msg-group.${side}`);
      group = groups[groups.length - 1];
      const timeEl = group?.querySelector('.chat-msg-time');
      if (timeEl) timeEl.textContent = timeStr;
    }

    if (!group) {
      group = document.createElement('div');
      group.className = `chat-msg-group ${side}`;

      if (!isMe && m.sender?.fullName) {
        const sender = document.createElement('div');
        sender.className = 'chat-msg-sender';
        sender.textContent = m.sender.fullName;
        group.appendChild(sender);
      }

      const timeEl = document.createElement('div');
      timeEl.className = 'chat-msg-time';
      timeEl.textContent = timeStr;
      this.el.messagesBox.appendChild(group);
      group.appendChild(timeEl);
    }

    const timeEl = group.querySelector('.chat-msg-time');

    // ── Bubble & Actions Wrapper ──
    const wrap = document.createElement('div');
    wrap.className = 'chat-bubble-wrap';

    // Actions button
    const actions = document.createElement('div');
    actions.className = 'chat-bubble-actions';
    actions.innerHTML = `<button class="btn-icon" title="Uzatish (Forward)"><span class="material-icons-round" style="font-size:16px;">forward</span></button>`;
    actions.addEventListener('click', () => this.openForwardModal(m.text));

    let bubbleEl = null;

    // ── Rasm ──
    if (m.text?.startsWith('[IMAGE]:')) {
      const src = m.text.slice(8);
      bubbleEl = document.createElement('div');
      bubbleEl.className = 'chat-bubble chat-bubble-image';
      const img = document.createElement('img');
      img.src = src;
      img.className = 'chat-img-thumb';
      img.alt = 'Rasm';
      img.loading = 'lazy';
      img.addEventListener('click', () => {
        const modal = document.getElementById('chat-image-modal');
        const modalImg = document.getElementById('chat-image-modal-img');
        if (modal && modalImg) { modalImg.src = src; modal.style.display = 'flex'; }
      });
      bubbleEl.appendChild(img);

    // ── Lokatsiya (faqat haydovchidan kelganda biriktirish tugmasi) ──
    } else if (m.text?.startsWith('[LOCATION]:')) {
      const coords = m.text.slice(11);
      const [lat, lng] = coords.split(',').map(Number);
      if (isNaN(lat) || isNaN(lng)) return;

      const googleUrl = `https://www.google.com/maps?q=${lat},${lng}`;
      bubbleEl = document.createElement('div');
      bubbleEl.className = 'chat-bubble chat-bubble-location';

      const mapContainer = document.createElement('div');
      mapContainer.className = 'chat-location-map';
      
      const bottomRow = document.createElement('div');
      bottomRow.className = 'chat-location-bottom';
      const link = document.createElement('a');
      link.href = googleUrl;
      link.target = '_blank';
      link.className = 'chat-location-link';
      link.innerHTML = `<span class="material-icons-round" style="font-size:14px;">open_in_new</span> ${lat.toFixed(4)}, ${lng.toFixed(4)}`;

      bottomRow.appendChild(link);

      // Faqat haydovchidan kelgan lokatsiyaga "biriktir" tugmasi
      if (!isMe) {
        const attachBtn = document.createElement('button');
        attachBtn.className = 'chat-attach-btn';
        attachBtn.innerHTML = `<span class="material-icons-round" style="font-size:14px;">person_pin</span> Biriktir`;
        attachBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openAttachModal(lat, lng);
        });
        bottomRow.appendChild(attachBtn);
      }

      bubbleEl.appendChild(mapContainer);
      bubbleEl.appendChild(bottomRow);

      // Mini Leaflet xarita
      setTimeout(() => {
        if (window.L) {
          const miniMap = L.map(mapContainer, { zoomControl: false, dragging: false, scrollWheelZoom: false })
            .setView([lat, lng], 14);
          L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '', maxZoom: 19
          }).addTo(miniMap);
          L.marker([lat, lng]).addTo(miniMap);
          mapContainer.addEventListener('click', () => window.open(googleUrl, '_blank'));
        }
      }, 300);

    // ── Oddiy matn ──
    } else {
      bubbleEl = document.createElement('div');
      bubbleEl.className = 'chat-bubble';
      bubbleEl.textContent = m.text;
    }

    if (m.senderId === myId) {
      wrap.appendChild(actions); // My messages: actions on the left
      wrap.appendChild(bubbleEl);
    } else {
      wrap.appendChild(bubbleEl); // Other messages: actions on the right
      wrap.appendChild(actions);
    }

    group.insertBefore(wrap, timeEl);
  },

  scrollToBottom() {
    if (this.el.messagesBox) {
      this.el.messagesBox.scrollTop = this.el.messagesBox.scrollHeight;
    }
  },
};

window.ChatManager = ChatManager;
