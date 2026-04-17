const ChatManager = {
  socket: null,
  activeChatUserId: null,
  drivers: {},
  _lastSenderId: null,
  _chatMap: null,
  _chatMapMarker: null,
  _chatMapCoords: null,

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
      btnLocation:   document.getElementById('chat-btn-location'),
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

    // Rasm yuborish
    this.el.btnImage?.addEventListener('click', () => this.el.fileInput?.click());
    this.el.fileInput?.addEventListener('change', (e) => this.handleImageFile(e));

    // Lokatsiya yuborish
    this.el.btnLocation?.addEventListener('click', () => this.openLocationModal());

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
      try {
        convUsers = await window.Api.request('/messages/conversations') || [];
      } catch(_) {}

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

    if (this.el.panel)       this.el.panel.style.display       = 'flex';
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

  // ─── Raw emit (rasm/lokatsiya) ───────────────────────────────────────────────
  _sendRaw(text) {
    if (!this.activeChatUserId || !this.socket) return;
    const me = window.Api.config.currentUser || {};
    this.socket.emit('sendMessage', {
      text,
      recipientId: this.activeChatUserId,
      companyId: me.companyId,
    });
  },

  // ─── Rasm yuborish ───────────────────────────────────────────────────────────
  handleImageFile(e) {
    const file = e.target.files?.[0];
    if (!file || !this.activeChatUserId) return;

    if (file.size > 5 * 1024 * 1024) {
      window.Utils?.showToast('Rasm 5MB dan katta bo\'lmasin', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target.result;
      this._sendRaw('[IMAGE]:' + base64);
      this.renderMessage({
        text: '[IMAGE]:' + base64,
        senderId: window.Api.config.currentUser?.id,
        sender: window.Api.config.currentUser,
        createdAt: new Date().toISOString(),
      });
      this.scrollToBottom();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  },

  // ─── Lokatsiya modali ─────────────────────────────────────────────────────────
  openLocationModal() {
    if (!this.activeChatUserId) return;
    const modal = document.getElementById('chat-map-modal');
    if (!modal) return;
    modal.style.display = 'flex';

    setTimeout(() => {
      if (!this._chatMap) {
        this._chatMap = L.map('chat-map-container', { zoomControl: true })
          .setView([41.2995, 69.2401], 12);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          attribution: '© OpenStreetMap © CARTO', maxZoom: 19
        }).addTo(this._chatMap);

        this._chatMap.on('click', (ev) => {
          this._chatMapCoords = ev.latlng;
          if (this._chatMapMarker) this._chatMapMarker.setLatLng(ev.latlng);
          else this._chatMapMarker = L.marker(ev.latlng, { draggable: true }).addTo(this._chatMap);
          this._chatMapMarker.on('dragend', () => {
            this._chatMapCoords = this._chatMapMarker.getLatLng();
            this._updateMapCoordsLabel();
          });
          this._updateMapCoordsLabel();
          const sendBtn = document.getElementById('chat-map-send');
          if (sendBtn) sendBtn.disabled = false;
        });
      } else {
        this._chatMap.invalidateSize();
      }

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => this._chatMap.setView([pos.coords.latitude, pos.coords.longitude], 15),
          () => {},
          { timeout: 4000 }
        );
      }
    }, 150);

    document.getElementById('chat-map-close').onclick = () => { modal.style.display = 'none'; };

    document.getElementById('chat-map-send').onclick = () => {
      if (!this._chatMapCoords) return;
      const { lat, lng } = this._chatMapCoords;
      const payload = `[LOCATION]:${lat.toFixed(6)},${lng.toFixed(6)}`;
      this._sendRaw(payload);
      this.renderMessage({
        text: payload,
        senderId: window.Api.config.currentUser?.id,
        sender: window.Api.config.currentUser,
        createdAt: new Date().toISOString(),
      });
      this.scrollToBottom();
      modal.style.display = 'none';
      document.getElementById('chat-map-send').disabled = true;
    };
  },

  _updateMapCoordsLabel() {
    if (!this._chatMapCoords) return;
    const { lat, lng } = this._chatMapCoords;
    const el = document.getElementById('chat-map-coords');
    if (el) el.textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
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
      const preview = msg.text?.startsWith('[IMAGE]:')    ? '📷 Rasm'
                    : msg.text?.startsWith('[LOCATION]:') ? '📍 Lokatsiya'
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
        // Oxirgi xabar preview ni yangilash
        const lastEl = driverEl.querySelector('.chat-driver-last');
        if (lastEl) lastEl.textContent = preview;
      }
    }
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

    // ── Kontent turini aniqlash ──
    if (m.text?.startsWith('[IMAGE]:')) {
      const src = m.text.slice(8); // '[IMAGE]:' olib tashlash
      const imgWrap = document.createElement('div');
      imgWrap.className = 'chat-bubble chat-bubble-image';
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
      imgWrap.appendChild(img);
      group.insertBefore(imgWrap, timeEl);

    } else if (m.text?.startsWith('[LOCATION]:')) {
      const coords = m.text.slice(11);
      const [lat, lng] = coords.split(',').map(Number);
      if (isNaN(lat) || isNaN(lng)) return;

      const googleUrl = `https://www.google.com/maps?q=${lat},${lng}`;

      const locBubble = document.createElement('div');
      locBubble.className = 'chat-bubble chat-bubble-location';

      const mapContainer = document.createElement('div');
      mapContainer.className = 'chat-location-map';
      mapContainer.style.cssText = 'height:150px;border-radius:10px;overflow:hidden;cursor:pointer;';

      const link = document.createElement('a');
      link.href = googleUrl;
      link.target = '_blank';
      link.className = 'chat-location-link';
      link.innerHTML = `<span class="material-icons-round" style="font-size:14px;">open_in_new</span> ${lat.toFixed(4)}, ${lng.toFixed(4)} — Google Maps`;

      locBubble.appendChild(mapContainer);
      locBubble.appendChild(link);
      group.insertBefore(locBubble, timeEl);

      // Mini Leaflet xarita render
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

    } else {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      bubble.textContent = m.text;
      group.insertBefore(bubble, timeEl);
    }
  },

  scrollToBottom() {
    if (this.el.messagesBox) {
      this.el.messagesBox.scrollTop = this.el.messagesBox.scrollHeight;
    }
  },
};

window.ChatManager = ChatManager;
