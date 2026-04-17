const ChatManager = {
  socket: null,
  activeChatUserId: null,
  drivers: {}, // userId -> UserObj

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
    };

    if (!this.el.driversList) return;

    this.el.closePanelBtn?.addEventListener('click', () => this.closePanel());
    this.el.sendBtn?.addEventListener('click', () => this.sendMessage());
    this.el.input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
    });
    // textarea auto-resize
    this.el.input?.addEventListener('input', (e) => {
      e.target.style.height = '';
      e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    });

    // Search filter
    this.el.searchInput?.addEventListener('input', (e) => this.filterDrivers(e.target.value));

    // Chat tab ochilganda ulanish
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab="chat"]');
      if (btn && !this.socket) this.connect();
    });
  },

  filterDrivers(query) {
    const q = (query || '').toLowerCase();
    this.el.driversList.querySelectorAll('.chat-driver-item').forEach(el => {
      const name = el.querySelector('.chat-driver-name')?.textContent?.toLowerCase() || '';
      el.style.display = name.includes(q) ? '' : 'none';
    });
  },

  // ─── WebSocket ulanish ─────────────────────────────────────────────────────
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

      this.socket.on('disconnect', () => {
        this._setStatus('offline');
      });

      this.socket.on('newMessage', (msg) => {
        this.handleIncomingMessage(msg);
      });

      this.socket.on('messageSent', (msg) => {
        // Server tasdiqladi — optimistic xabar allaqachon ko'rsatilgan
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
    dot.className = 'status-dot ' + state;
  },

  // ─── Haydovchilar ro'yxatini yuklash ──────────────────────────────────────
  async loadDrivers() {
    try {
      const ulist = await window.Api.request('/users');
      if (!ulist || !Array.isArray(ulist)) return;

      const myId = window.Api.config.currentUser?.id;
      const drivers = ulist.filter(u => u.role === 'DRIVER' && u.id !== myId);

      // Suhbat tarixdan ham foydalanuvchilarni olamiz
      let convUsers = [];
      try {
        convUsers = await window.Api.request('/messages/conversations') || [];
      } catch(_) {}

      // Barcha unique users
      const seen = new Set();
      const allUsers = [...drivers, ...convUsers].filter(u => {
        if (!u || !u.id || seen.has(u.id) || u.id === myId) return false;
        seen.add(u.id);
        return true;
      });

      this.el.driversList.innerHTML = '';

      if (allUsers.length === 0) {
        this.el.driversList.innerHTML = `<div class="chat-list-loading"><span class="material-icons-round">people_outline</span><span>Haydovchilar topilmadi</span></div>`;
        return;
      }

      if (this.el.driversCount) this.el.driversCount.textContent = `${allUsers.length} ta haydovchi`;

      allUsers.forEach(u => {
        this.drivers[u.id] = u;
        this._addDriverItem(u);
      });

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

  // ─── Chat tanlash ──────────────────────────────────────────────────────────
  async selectChat(userId) {
    this.activeChatUserId = userId;

    // Sidebar: active class
    this.el.driversList.querySelectorAll('.chat-driver-item').forEach(el => {
      el.classList.toggle('active', el.id === `driver-item-${userId}`);
    });
    // Unread badge olib tashlash
    const driverEl = document.getElementById(`driver-item-${userId}`);
    driverEl?.querySelector('.chat-unread-badge')?.remove();

    const user = this.drivers[userId];
    const initials = (user?.fullName || '?').charAt(0).toUpperCase();

    if (this.el.panelName)   this.el.panelName.textContent   = user?.fullName || '-';
    if (this.el.panelRole)   this.el.panelRole.textContent   = 'Haydovchi • Online';
    if (this.el.panelAvatar) this.el.panelAvatar.textContent = initials;

    if (this.el.panel)       this.el.panel.style.display       = 'flex';
    if (this.el.placeholder) this.el.placeholder.style.display = 'none';

    this.el.input?.focus();

    // Tarixni yuklash
    try {
      const history = await window.Api.request(`/messages/history/${userId}`);
      if (this.el.messagesBox) this.el.messagesBox.innerHTML = '';
      this._lastSenderId = null; // reset grouping
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
    this.el.driversList.querySelectorAll('.chat-driver-item').forEach(el => el.classList.remove('active'));
  },

  // ─── Xabar yuborish ────────────────────────────────────────────────────────
  sendMessage() {
    const val = this.el.input?.value?.trim();
    if (!val || !this.activeChatUserId || !this.socket) return;

    const me = window.Api.config.currentUser || {};

    this.socket.emit('sendMessage', {
      text: val,
      recipientId: this.activeChatUserId,
      companyId: me.companyId,
    });

    // Optimistic render
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

  // ─── Kiruvchi xabar ───────────────────────────────────────────────────────
  handleIncomingMessage(msg) {
    if (!this.drivers[msg.senderId] && msg.sender) {
      this.drivers[msg.senderId] = msg.sender;
      this._addDriverItem(msg.sender);
    }

    if (this.activeChatUserId === msg.senderId) {
      this.renderMessage(msg);
      this.scrollToBottom();
    } else {
      if (window.Utils?.showToast) {
        window.Utils.showToast(`💬 ${msg.sender?.fullName || 'Haydovchi'}: ${msg.text?.substring(0, 40)}`, 'info');
      }
      // Badge qo'shish
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
      }
    }
  },

  // ─── Xabar render (guruhli) ────────────────────────────────────────────────
  renderMessage(m) {
    if (!this.el.messagesBox) return;
    const myId = window.Api.config.currentUser?.id;
    const isMe = m.senderId === myId;
    const side = isMe ? 'me' : 'other';
    const timeStr = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Guruh — ketma-ket bir xil yuboruvchi uchun yangi wrapper ochmaslik
    const isSameGroup = this._lastSenderId === m.senderId;
    this._lastSenderId = m.senderId;

    let group;
    if (isSameGroup) {
      // Oxirgi guruhga qo'shish
      const groups = this.el.messagesBox.querySelectorAll(`.chat-msg-group.${side}`);
      group = groups[groups.length - 1];
      // Vaqt labelini yangilash
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

      // Time oxirida qo'shiladi
      group._timeEl = timeEl;
      this.el.messagesBox.appendChild(group);
      group.appendChild(timeEl);
    }

    // Bubble ni time dan oldin qo'shish
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = m.text;
    const timeEl = group.querySelector('.chat-msg-time');
    group.insertBefore(bubble, timeEl);
  },

  scrollToBottom() {
    if (this.el.messagesBox) {
      this.el.messagesBox.scrollTop = this.el.messagesBox.scrollHeight;
    }
  },
};

window.ChatManager = ChatManager;
