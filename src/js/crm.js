/**
 * crm.js - Contacts, SMS, and Call History Handlers
 */

const CRM = {
  allContacts: [],
  searchTimeout: null,
  
  init() {
    this.bindEvents();
    this.renderSmsHistory();
  },

  async loadContacts(query = '') {
    if (!window.Api.config.currentUser?.companyId) return;
    
    try {
      if (query) {
        this.allContacts = await window.Api.request(`/customers/search/${window.Api.config.currentUser.companyId}?q=${encodeURIComponent(query)}`) || [];
      } else {
        this.allContacts = await window.Api.request(`/customers/company/${window.Api.config.currentUser.companyId}`) || [];
      }
      this.renderContacts(this.allContacts);
    } catch (err) {
      console.error('Load contacts error:', err);
    }
  },

  renderContacts(contacts) {
    const container = Utils.$('contacts-list');
    if (!container) return;
    
    if (!contacts || contacts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="material-icons-round">people</span>
          <p>Mijozlar topilmadi</p>
        </div>`;
      return;
    }
    
    container.innerHTML = contacts.map(c => {
      const initials = (c.fullName || '?').charAt(0).toUpperCase();
      return `
        <div class="contact-item" onclick="CRM.callContact('${c.phone1}')">
          <div class="contact-avatar">${initials}</div>
          <div class="contact-info">
            <div class="contact-name">${c.fullName}</div>
            <div class="contact-phone">${c.phone1}${c.phone2 ? ' / ' + c.phone2 : ''}</div>
            <div class="contact-company">${c.address || ''}</div>
          </div>
          <div class="contact-actions">
            <button class="btn-icon" onclick="event.stopPropagation(); CRM.callContact('${c.phone1}')" title="Qo'ng'iroq">
              <span class="material-icons-round">call</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  callContact(phone) {
    Utils.$('dial-number').value = phone;
    Utils.$$('.tab-content').forEach(c => c.classList.remove('active'));
    Utils.$$('.tab').forEach(t => t.classList.remove('active'));
    Utils.$('tab-dialer').classList.add('active');
    document.querySelector('[data-tab="dialer"]').classList.add('active');
    window.SipClient.makeCall(phone);
  },

  bindEvents() {
    Utils.$('contacts-search')?.addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      const q = e.target.value.trim();
      this.searchTimeout = setTimeout(() => this.loadContacts(q), 400);
    });

    Utils.$('btn-add-contact')?.addEventListener('click', () => {
      Utils.$('modal-new-customer').style.display = 'flex';
      Utils.$('new-customer-phone1').value = Utils.$('dial-number').value || '';
    });

    Utils.$('btn-close-customer-modal')?.addEventListener('click', () => Utils.$('modal-new-customer').style.display = 'none');
    Utils.$('btn-cancel-customer')?.addEventListener('click', () => Utils.$('modal-new-customer').style.display = 'none');

    Utils.$('form-new-customer')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        fullName: Utils.$('new-customer-name').value.trim(),
        phone1: Utils.$('new-customer-phone1').value.trim(),
        phone2: Utils.$('new-customer-phone2').value.trim() || undefined,
        address: Utils.$('new-customer-address').value.trim() || undefined,
        companyId: window.Api.config.currentUser?.companyId,
      };
      
      if (!data.fullName || !data.phone1) {
        Utils.showToast('Ism va telefon kiritish kerak', 'warning');
        return;
      }
      
      try {
        await window.Api.request('/customers', {
          method: 'POST',
          body: JSON.stringify(data),
        });
        Utils.showToast("Mijoz qo'shildi!", 'success');
        Utils.$('modal-new-customer').style.display = 'none';
        Utils.$('form-new-customer').reset();
        this.loadContacts();
      } catch (err) {
        Utils.showToast('Xatolik: ' + err.message, 'error');
      }
    });

    Utils.$('btn-send-sms')?.addEventListener('click', () => {
      const to = Utils.$('sms-to').value.trim();
      const text = Utils.$('sms-text').value.trim();
      if (!to || !text) return Utils.showToast('Raqam va xabar matni kerak', 'warning');
      
      const smsList = JSON.parse(localStorage.getItem('smsHistory') || '[]');
      smsList.unshift({ to, text, time: new Date().toISOString(), status: 'sent' });
      localStorage.setItem('smsHistory', JSON.stringify(smsList));
      
      Utils.showToast('SMS yuborildi!', 'success');
      Utils.$('sms-to').value = '';
      Utils.$('sms-text').value = '';
      this.renderSmsHistory();
    });

    Utils.$('btn-logout')?.addEventListener('click', () => window.Api.logout());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = Utils.$('modal-new-customer');
        if (modal && modal.style.display !== 'none') modal.style.display = 'none';
        
        const sipModal = Utils.$('modal-add-sip');
        if (sipModal && sipModal.style.display !== 'none') sipModal.style.display = 'none';
      }
    });
  },

  renderSmsHistory() {
    const container = Utils.$('sms-list');
    if (!container) return;
    const smsList = JSON.parse(localStorage.getItem('smsHistory') || '[]');
    
    if (smsList.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="material-icons-round">sms</span>
          <p>SMS xabarlar bo'sh</p>
        </div>`;
      return;
    }
    
    container.innerHTML = smsList.map(sms => `
      <div class="sms-item" style="padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05);">
        <div class="sms-item-header" style="display:flex; justify-content:space-between; color:var(--text-secondary); font-size:12px; margin-bottom: 5px;">
          <span class="sms-item-to" style="color:white; font-weight:bold;">${sms.to}</span>
          <span class="sms-item-time">${Utils.formatTime(sms.time)}</span>
        </div>
        <div class="sms-item-text" style="font-size:13px; color:var(--text-main);">${sms.text}</div>
      </div>
    `).join('');
  }
};

window.CRM = CRM;
