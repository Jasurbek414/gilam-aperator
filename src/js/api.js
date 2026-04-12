/**
 * api.js - Core API and Authorization Wrapper
 */

const Api = {
  config: {
    API_BASE: localStorage.getItem('serverUrl') || 'https://gilam.ecos.uz',
    token: localStorage.getItem('token') || null,
    currentUser: JSON.parse(localStorage.getItem('user') || 'null')
  },

  updateServerUrl(url) {
    this.config.API_BASE = url;
    localStorage.setItem('serverUrl', url);
  },

  async request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (this.config.token) headers['Authorization'] = `Bearer ${this.config.token}`;
    
    const res = await fetch(`${this.config.API_BASE}/api${path}`, { ...options, headers });
    
    if (res.status === 401) {
      this.logout();
      throw new Error('Sessiya tugadi (401 Unauthorized)');
    }
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Server xatoligi yuz berdi' }));
      throw new Error(Array.isArray(err.message) ? err.message.join(', ') : err.message);
    }
    
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type');
    if (!ct || !ct.includes('application/json')) return null;
    return res.json();
  },

  async login(phone, password) {
    // UI TEST BYPASS
    const ph = String(phone || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const pw = String(password || '').toLowerCase().trim();
    
    if (ph.includes('test') && pw.includes('test')) {
      const mockUser = { id: 999, fullName: 'Test Operator', phone: '+998000000000', role: 'OPERATOR' };
      this.config.token = 'mock_token';
      this.config.currentUser = mockUser;
      localStorage.setItem('token', 'mock_token');
      localStorage.setItem('user', JSON.stringify(mockUser));
      
      // Load mock SIP accounts so lines menu shows something useful
      localStorage.setItem('sip_accounts', JSON.stringify([
        { id: 'm1', extension: '101', name: 'Asosiy Liniya', domain: '127.0.0.1', transport: 'ws', campaignName: 'Gilam Yuvish' },
        { id: 'm2', extension: '102', name: 'Zaxira Liniya', domain: '127.0.0.1', transport: 'ws', campaignName: 'Mebel Tozalash' }
      ]));
      
      return mockUser;
    }

    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password }),
    });
    
    this.config.token = data.access_token;
    this.config.currentUser = data.user;
    localStorage.setItem('token', this.config.token);
    localStorage.setItem('user', JSON.stringify(this.config.currentUser));
    return data.user;
  },

  socket: null,

  connectSocket() {
    if (this.socket) return;
    if (!this.config.currentUser) return;
    
    // Desktop Operator dasturi doim backend bilan bitta kompyuterda ishlaydi.
    // Cloudflare/NextJS proksilari WebSocket Upgrade ni qo'llab-quvvatlamaydi,
    // shuning uchun to'g'ridan-to'g'ri backend portiga ulanamiz.
    const socketUrl = 'http://127.0.0.1:3000/calls';
    console.log('[API] Connecting WebSocket to:', socketUrl);
    
    const ioClient = window.io || (typeof io !== 'undefined' ? io : null);
    if (!ioClient) {
      console.warn('[API] Socket.io client topilmadi');
      return;
    }

    this.socket = ioClient(socketUrl, {
      path: '/api/socket.io',
      extraHeaders: {
        Authorization: `Bearer ${this.config.token}`
      }
    });

    this.socket.on('connect', () => {
      console.log('[API] WebSocket ulangan (Calls namespace)');
      this.socket.emit('operator:join', {
        operatorId: this.config.currentUser.id,
        companyId: this.config.currentUser.companyId
      });
    });

    this.socket.on('disconnect', () => {
      console.log('[API] WebSocket uzildi');
    });

    this.socket.on('call:incoming', (data) => {
      console.log("[API/Socket] Kiruvchi qo'ng'iroq:", data);
      if (window.CRM && data.call) {
        window.CRM.activeCallId = data.call.id;
      }
    });

    this.socket.on('call:updated', (data) => {
      console.log("[API/Socket] Qo'ng'iroq yangilandi:", data);
    });

    this.socket.on('call:taken', (data) => {
      console.log("[API/Socket] Qo'ng'iroqni boshqa operator oldi:", data);
      if (window.UI) {
        const incomingEl = window.UI.$('incoming-call-overlay');
        if (incomingEl) incomingEl.style.display = 'none';
      }
      if (window.SipClient && window.SipClient.currentSession) {
        // Aslida boshqa operator olsa, bizning session ham automatically fail/terminated bo'ladi (sip server tomonidan)
        // Shuning uchun bu yerda faqat UI ni bekitish kifoya qilishi mumkin
      }
    });
  },

  disconnectSocket() {
    if (this.socket) {
      if (this.config.currentUser) {
        this.socket.emit('operator:leave', { operatorId: this.config.currentUser.id });
      }
      this.socket.disconnect();
      this.socket = null;
    }
  },

  logout() {
    this.disconnectSocket();
    this.config.token = null;
    this.config.currentUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.UI.showScreen('login');
  }
};

window.Api = Api;
