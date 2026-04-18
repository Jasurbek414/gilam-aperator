/**
 * utils.js - Common helper functions
 */

const Utils = {
  $(id) { return document.getElementById(id); },
  $$(sel) { return document.querySelectorAll(sel); },
  
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: 'check_circle', error: 'error', info: 'info', warning: 'warning' };
    toast.innerHTML = `<span class="material-icons-round">${icons[type] || 'info'}</span>${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(60px)'; }, 3000);
    setTimeout(() => toast.remove(), 3500);
  },

  formatTime(date) {
    const d = new Date(date);
    return d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
  },

  formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  _getCrypto() {
    return (typeof require !== 'undefined') ? require('crypto') : null;
  },

  encryptData(text) {
    if (!text) return text;
    try {
      const crypto = this._getCrypto();
      if (!crypto) return btoa(text);
      const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from('G1lamS3cur3K3y!@987654321012345'), Buffer.from('G1lamInv3ctor123'));
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return encrypted;
    } catch(e) { 
      try { return btoa(text); } catch { return text; }
    }
  },

  decryptData(hexStr) {
    if (!hexStr) return hexStr;
    try {
      const crypto = this._getCrypto();
      if (!crypto) return atob(hexStr);
      // Ochiq JWT matnlari kelsa decrypt qilishdan saqlanish:
      if (hexStr.includes('eyJ') && !/^[0-9a-fA-F]+$/.test(hexStr)) return hexStr;
      
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from('G1lamS3cur3K3y!@987654321012345'), Buffer.from('G1lamInv3ctor123'));
      let decrypted = decipher.update(hexStr, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch(e) {
      try { return atob(hexStr); } catch { return hexStr; }
    }
  },

  secureStorageInit() {
    const originalSet = Storage.prototype.setItem;
    const originalGet = Storage.prototype.getItem;
    // Faqat shaxsiy va kiber xavfsizlikka aloqador maydonlarni shifrlash
    const secureKeys = ['token', 'user', 'sip_accounts', 'sip_account', 'authToken'];

    Storage.prototype.setItem = function(key, value) {
      if (secureKeys.includes(key)) {
        value = Utils.encryptData(value);
      }
      originalSet.call(this, key, value);
    };

    Storage.prototype.getItem = function(key) {
      let value = originalGet.call(this, key);
      if (value && secureKeys.includes(key)) {
        value = Utils.decryptData(value);
      }
      return value;
    };
  }
};

window.Utils = Utils;
// Avtomatik ravishda barcha xavfsizlik interceptorlarini ishga tushiramiz
window.Utils.secureStorageInit();
