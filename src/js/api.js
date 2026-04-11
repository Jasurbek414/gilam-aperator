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

  logout() {
    this.config.token = null;
    this.config.currentUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.UI.showScreen('login');
  }
};

window.Api = Api;
