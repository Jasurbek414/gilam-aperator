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
    };

    if (!this.el.driversList) return; // chat tab DOM'da yo'q

    // Panel yopish
    this.el.closePanelBtn?.addEventListener('click', () => this.closePanel());

    // Xabar yuborish
    this.el.sendBtn?.addEventListener('click', () => this.sendMessage());
    this.el.input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Chat tab ochilganda ulanish
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab="chat"]');
      if (btn && !this.socket) this.connect();
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
        this.el.driversList.innerHTML = `
          <div class="empty-state">
            <span class="material-icons-round">people_outline</span>
            <p>Haydovchilar topilmadi</p>
          </div>`;
        return;
      }

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
    div.style = `
      display:flex; align-items:center; gap:10px;
      padding:10px 12px; border-radius:10px; cursor:pointer;
      margin-bottom:4px; transition:background 0.15s;
    `;
    div.innerHTML = `
      <div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#0ea5e9);
        display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;color:#fff;flex-shrink:0;">
        ${initials}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:14px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${user.fullName || user.phone}
        </div>
        <div style="font-size:11px;color:var(--text-secondary);">Haydovchi</div>
      </div>
    `;
    div.addEventListener('click', () => this.selectChat(user.id));
    div.addEventListener('mouseenter', () => {
      if (this.activeChatUserId !== user.id) div.style.background = 'var(--bg-hover, rgba(0,0,0,0.05))';
    });
    div.addEventListener('mouseleave', () => {
      if (this.activeChatUserId !== user.id) div.style.background = '';
    });
    this.el.driversList.appendChild(div);
  },

  // ─── Chat tanlash ──────────────────────────────────────────────────────────
  async selectChat(userId) {
    this.activeChatUserId = userId;

    // Sidebar highlight
    this.el.driversList.querySelectorAll('[id^="driver-item-"]').forEach(el => {
      el.style.background = el.id === `driver-item-${userId}`
        ? 'var(--accent-soft, rgba(16,185,129,0.12))'
        : '';
    });

    const user = this.drivers[userId];
    const initials = (user?.fullName || '?').charAt(0).toUpperCase();

    // Panel header
    if (this.el.panelName)   this.el.panelName.textContent   = user?.fullName  || '-';
    if (this.el.panelRole)   this.el.panelRole.textContent   = 'Haydovchi';
    if (this.el.panelAvatar) this.el.panelAvatar.textContent = initials;

    // Panel ko'rsatish
    if (this.el.panel)       this.el.panel.style.display       = 'flex';
    if (this.el.placeholder) this.el.placeholder.style.display = 'none';

    this.el.input?.focus();

    // Tarixni yuklash
    try {
      const history = await window.Api.request(`/messages/history/${userId}`);
      if (this.el.messagesBox) this.el.messagesBox.innerHTML = '';
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
    if (this.el.panel)       this.el.panel.style.display       = 'none';
    if (this.el.placeholder) this.el.placeholder.style.display = 'flex';
    // Barcha highlights olib tashlash
    this.el.driversList.querySelectorAll('[id^="driver-item-"]').forEach(el => {
      el.style.background = '';
    });
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
      // Badge qo'shish (xabar soni)
      const driverEl = document.getElementById(`driver-item-${msg.senderId}`);
      if (driverEl && !driverEl.querySelector('.unread-badge')) {
        const badge = document.createElement('div');
        badge.className = 'unread-badge';
        badge.style = 'width:8px;height:8px;border-radius:50%;background:#ef4444;flex-shrink:0;';
        driverEl.appendChild(badge);
      }
    }
  },

  // ─── Xabar render ──────────────────────────────────────────────────────────
  renderMessage(m) {
    if (!this.el.messagesBox) return;
    const myId = window.Api.config.currentUser?.id;
    const isMe = m.senderId === myId;

    const wrapper = document.createElement('div');
    wrapper.style = `display:flex; flex-direction:column; align-items:${isMe ? 'flex-end' : 'flex-start'}; gap:2px;`;

    if (!isMe && m.sender?.fullName) {
      const name = document.createElement('span');
      name.style = 'font-size:10px; color:var(--text-secondary); padding:0 4px; font-weight:600;';
      name.textContent = m.sender.fullName;
      wrapper.appendChild(name);
    }

    const bubble = document.createElement('div');
    bubble.style = `
      max-width:75%; padding:9px 14px; border-radius:${isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px'};
      font-size:14px; line-height:1.4;
      color:${isMe ? '#fff' : 'var(--text-primary)'};
      background:${isMe ? 'var(--accent)' : 'var(--bg-2, #e2e8f0)'};
      word-break:break-word;
    `;
    bubble.textContent = m.text;
    wrapper.appendChild(bubble);

    const time = document.createElement('span');
    time.style = 'font-size:10px; color:var(--text-secondary); padding:0 4px;';
    time.textContent = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    wrapper.appendChild(time);

    this.el.messagesBox.appendChild(wrapper);
  },

  scrollToBottom() {
    if (this.el.messagesBox) {
      this.el.messagesBox.scrollTop = this.el.messagesBox.scrollHeight;
    }
  },
};

window.ChatManager = ChatManager;
