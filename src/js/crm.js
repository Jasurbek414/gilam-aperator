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
  },

  // ═══ QUICK CRM PANEL ═══════════════════════════════════════════════════
  toggleQuickPanel() {
    const body = Utils.$('crm-panel-body');
    const arrow = Utils.$('crm-panel-arrow');
    if (!body) return;
    
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(180deg)';
    
    // Kampaniya selectni yangilash
    if (!isOpen) this._populateCampaigns();
  },

  // Qo'ng'iroq kelganda avtomatik ochilish
  onCallStarted(phoneNumber, lineName) {
    const body = Utils.$('crm-panel-body');
    const arrow = Utils.$('crm-panel-arrow');
    const banner = Utils.$('crm-call-banner');
    const phoneInput = Utils.$('quick-crm-phone');
    const lineLabel = Utils.$('crm-call-line');
    const numLabel = Utils.$('crm-call-number');

    // Panelni ochish
    if (body) body.style.display = 'block';
    if (arrow) arrow.style.transform = 'rotate(180deg)';
    
    // Banner ko'rsatish
    if (banner) banner.style.display = 'block';
    if (lineLabel) lineLabel.textContent = lineName || '-';
    if (numLabel) numLabel.textContent = phoneNumber || '-';
    
    // Telefon raqamni avtomatik to'ldirish
    if (phoneInput) phoneInput.value = phoneNumber || '';
    
    // Kampaniyani tanlash
    this._populateCampaigns(lineName);
  },

  onCallEnded() {
    const banner = Utils.$('crm-call-banner');
    if (banner) banner.style.display = 'none';
  },

  _populateCampaigns(autoSelect) {
    const select = Utils.$('quick-crm-campaign');
    if (!select) return;
    
    const accounts = window.SipClient?.sipAccounts || [];
    select.innerHTML = '<option value="">Kampaniya tanlang...</option>';
    
    accounts.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = `${acc.name} (${acc.extension})`;
      if (autoSelect && acc.name === autoSelect) opt.selected = true;
      select.appendChild(opt);
    });
  },

  // ═══ SAVE CUSTOMER ══════════════════════════════════════════════════════
  async saveQuickCustomer() {
    const name = Utils.$('quick-crm-name')?.value?.trim();
    const phone = Utils.$('quick-crm-phone')?.value?.trim();
    const address = Utils.$('quick-crm-address')?.value?.trim();

    if (!name || !phone) {
      Utils.showToast('Ism va telefon kerak!', 'warning');
      return;
    }

    const data = {
      fullName: name,
      phone1: phone,
      address: address || undefined,
      companyId: window.Api?.config?.currentUser?.companyId,
    };

    try {
      await window.Api.request('/customers', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      Utils.showToast("Mijoz muvaffaqiyatli saqlandi!", 'success');
      // Formani tozalash (telefon qolsin)
      if (Utils.$('quick-crm-name')) Utils.$('quick-crm-name').value = '';
      if (Utils.$('quick-crm-address')) Utils.$('quick-crm-address').value = '';
    } catch (err) {
      Utils.showToast('Saqlashda xatolik: ' + err.message, 'error');
    }
  },

  // ═══ SAVE ORDER ═════════════════════════════════════════════════════════
  async saveQuickOrder() {
    const name = Utils.$('quick-crm-name')?.value?.trim();
    const phone = Utils.$('quick-crm-phone')?.value?.trim();
    const address = Utils.$('quick-crm-address')?.value?.trim();
    const product = Utils.$('quick-order-product')?.value?.trim();
    const qty = Utils.$('quick-order-qty')?.value || '1';
    const price = Utils.$('quick-order-price')?.value?.trim();
    const note = Utils.$('quick-crm-note')?.value?.trim();
    const campaignId = Utils.$('quick-crm-campaign')?.value;

    if (!phone) {
      Utils.showToast('Telefon raqam kerak!', 'warning');
      return;
    }

    const orderData = {
      customerName: name || 'Noaniq',
      phone: phone,
      address: address,
      product: product,
      quantity: parseInt(qty),
      price: price,
      note: note,
      campaignId: campaignId,
      companyId: window.Api?.config?.currentUser?.companyId,
      operatorId: window.Api?.config?.currentUser?.id,
      operatorName: window.Api?.config?.currentUser?.fullName,
      status: 'new',
      createdAt: new Date().toISOString(),
    };

    // Buyurtmalarni localStorage ga saqlash
    const orders = JSON.parse(localStorage.getItem('orders') || '[]');
    orders.unshift(orderData);
    localStorage.setItem('orders', JSON.stringify(orders));

    // API ga ham yuborishga urinish
    try {
      await window.Api.request('/orders', {
        method: 'POST',
        body: JSON.stringify(orderData),
      });
    } catch (e) {
      console.log('[CRM] Order saved locally (API unavailable)');
    }

    Utils.showToast("Buyurtma saqlandi!", 'success');
    
    // Formani tozalash
    ['quick-order-product', 'quick-order-price', 'quick-crm-note'].forEach(id => {
      const el = Utils.$(id);
      if (el) el.value = '';
    });
    if (Utils.$('quick-order-qty')) Utils.$('quick-order-qty').value = '1';
  }
};

window.CRM = CRM;
