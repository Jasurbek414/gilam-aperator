/**
 * crm.js - Contacts, SMS, and Call History Handlers
 */

const CRM = {
  allContacts: [],
  services: [],
  searchTimeout: null,
  activeCallId: null, // WebSocket orqali keladigan call id
  
  init() {
    this.bindEvents();
    this.renderSmsHistory();
    this.loadCompanies();
    this.loadServices();
    this.loadDrivers();
  },

  async loadContacts(query = '') {
    const isGlobal = !window.Api.config.currentUser?.companyId;
    
    try {
      if (query) {
        const path = isGlobal ? `/customers/search/global?q=${encodeURIComponent(query)}` : `/customers/search/${window.Api.config.currentUser.companyId}?q=${encodeURIComponent(query)}`;
        this.allContacts = await window.Api.request(path) || [];
      } else {
        const path = isGlobal ? `/customers` : `/customers/company/${window.Api.config.currentUser.companyId}`;
        this.allContacts = await window.Api.request(path) || [];
      }
      this.renderContacts(this.allContacts);
    } catch (err) {
      console.error('Load contacts error:', err);
    }
  },

  async loadCompanies() {
    try {
      const isGlobal = !window.Api.config.currentUser?.companyId;
      if (isGlobal) {
        this.companies = await window.Api.request('/public/companies') || [];
      } else {
        const comp = await window.Api.request(`/companies/${window.Api.config.currentUser.companyId}`);
        this.companies = comp ? [comp] : [];
      }
      const select = Utils.$('quick-crm-campaign');
      if (select) {
        select.innerHTML = '<option value="">Kampaniya tanlang...</option>';
        this.companies.forEach(company => {
          const opt = document.createElement('option');
          opt.value = company.id;
          opt.textContent = company.name;
          select.appendChild(opt);
        });
      }
    } catch (err) {
      console.warn('[CRM] Load companies error:', err);
    }
  },

  async loadServices() {
    const isGlobal = !window.Api.config.currentUser?.companyId;
    try {
      const path = isGlobal ? `/services` : `/services/company/${window.Api.config.currentUser.companyId}`;
      this.services = await window.Api.request(path) || [];
      this.renderServices();
    } catch (err) {
      console.error('Load services error:', err);
    }
  },

  renderServices(companyId = null) {
    const select = Utils.$('quick-order-product');
    if (!select) return;
    
    select.innerHTML = '<option value="">Xizmat tanlang</option>';
    
    // Agar companyId tanlangan bo'lsa, faqat o'sha kampaniyaning xizmatlari chiqsin
    const filteredServices = companyId ? this.services.filter(s => s.companyId === companyId || s.company?.id === companyId) : this.services;
    
    filteredServices.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.price} s'om)${s.company ? ' — ' + s.company.name : ''}`;
      select.appendChild(opt);
    });
  },

  async loadDrivers() {
    try {
      const ulist = await window.Api.request('/users');
      if (ulist && Array.isArray(ulist)) {
        this.allDrivers = ulist.filter(u => u.role === 'DRIVER');
        const select = Utils.$('quick-order-driver');
        if (select) {
          select.innerHTML = '<option value="">Haydovchi tanlang...</option>';
          this.allDrivers.forEach(d => {
            const companyName = d.company?.name || '';
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = `${d.fullName}${companyName ? ' — ' + companyName : ''}`;
            select.appendChild(opt);
          });
        }
      }
    } catch(e) {
      console.warn('[CRM] Haydovchilarni yuklash xatoligi:', e);
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

    // Kampaniya tanlanganda unga tegishli Xizmatlarni filtrlash
    Utils.$('quick-crm-campaign')?.addEventListener('change', (e) => {
      const selectedCompanyId = e.target.value;
      this.renderServices(selectedCompanyId);
      
      // Ixtiyoriy ravishda Haydovchilarni ham ushbu kampaniyaga moslab qoldirish kerakmi degan masala:
      if (this.allDrivers && Utils.$('quick-order-driver')) {
          const dSelect = Utils.$('quick-order-driver');
          dSelect.innerHTML = '<option value="">Haydovchi tanlang...</option>';
          const filteredDrivers = selectedCompanyId ? this.allDrivers.filter(d => d.companyId === selectedCompanyId || d.company?.id === selectedCompanyId) : this.allDrivers;
          filteredDrivers.forEach(d => {
            const companyName = d.company?.name || '';
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = `${d.fullName}${companyName ? ' — ' + companyName : ''}`;
            dSelect.appendChild(opt);
          });
      }
    });

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

    // ─── SMS Telegram UI Eventlari ──────────────────────────────────────────
    
    // 1. Matn kiritishda Enter ishlatish (Shift + Enter yangi qator)
    const smsInput = Utils.$('sms-text');
    if (smsInput) {
      smsInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          Utils.$('btn-send-sms')?.click();
        }
      });
    }

    // 2. Raqam formatlash: +998 (XX) XXX XX XX qilib chiroyli kiritish
    const smsTo = Utils.$('sms-to');
    if (smsTo) {
      smsTo.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, '');
        if (val.length === 0) val = '998';
        else if (!val.startsWith('99')) val = '998' + val;

        let formatted = '+' + val.substring(0, 3); // +998
        if (val.length > 3) formatted += ' (' + val.substring(3, 5);
        if (val.length > 5) formatted += ') ' + val.substring(5, 8);
        if (val.length > 8) formatted += ' ' + val.substring(8, 10);
        if (val.length > 10) formatted += ' ' + val.substring(10, 12);

        e.target.value = formatted;
        
        // Raqam yetarli uzunlikka yetsa, chatni aynan shu raqamga o'girish
        if (val.length >= 12) {
          this.activeSmsNumber = formatted;
          this.renderSmsHistory();
        }
      });
    }

    // 3. Xabar yuborish
    Utils.$('btn-send-sms')?.addEventListener('click', () => {
      const toVal = Utils.$('sms-to').value;
      const cleanTo = toVal.replace(/\D/g, '');
      const text = Utils.$('sms-text').value.trim();
      
      if (cleanTo.length < 12 || !text) {
        return Utils.showToast('Asl raqam va xabarni to\'liq yozing', 'warning');
      }
      
      const smsList = JSON.parse(localStorage.getItem('smsHistory') || '[]');
      // Xabarni guruhlash oson bo'lishi formati saqlaymiz: qabul qiluvchi = "+998(90)1234567" logikasi
      smsList.push({ to: toVal, text, time: new Date().toISOString(), status: 'sent', sender: 'me' });
      localStorage.setItem('smsHistory', JSON.stringify(smsList));
      
      Utils.$('sms-text').value = '';
      Utils.$('sms-text').style.height = ''; 
      
      this.activeSmsNumber = toVal;
      this.renderSmsHistory();
      
      // Auto-focus back to textarea
      Utils.$('sms-text').focus();
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
    const listCont = Utils.$('sms-chat-list');
    const histCont = Utils.$('sms-history-area');
    if (!listCont || !histCont) return;

    const smsList = JSON.parse(localStorage.getItem('smsHistory') || '[]');
    
    // 1. Kontaktlar ro'yxatini yig'ish (Chap panel)
    const contactsMap = {};
    smsList.forEach(sms => {
      if (!contactsMap[sms.to]) {
        contactsMap[sms.to] = [];
      }
      contactsMap[sms.to].push(sms);
    });

    if (Object.keys(contactsMap).length === 0) {
      listCont.innerHTML = `
        <div class="empty-state" style="margin-top: 40px; transform: scale(0.9);">
          <span class="material-icons-round">forum</span>
          <p>Yozishmalar yo'q</p>
        </div>`;
    } else {
      let listHTML = '';
      for (const [phone, chats] of Object.entries(contactsMap)) {
        const lastMsg = chats[chats.length - 1];
        const isActive = this.activeSmsNumber === phone;
        
        listHTML += `
          <div class="tg-chat-item ${isActive ? 'active' : ''}" onclick="window.CRM.activeSmsNumber='${Utils.escapeHtml(phone)}'; document.getElementById('sms-to').value='${Utils.escapeHtml(phone)}'; window.CRM.renderSmsHistory();">
            <div class="tg-avatar">${Utils.escapeHtml(phone.substring( phone.length-2 ))}</div>
            <div class="tg-chat-info">
              <div class="tg-chat-top">
                <h4>${Utils.escapeHtml(phone)}</h4>
                <span class="tg-time">${Utils.formatTime(lastMsg.time)}</span>
              </div>
              <div class="tg-chat-bottom">
                <p>${Utils.escapeHtml(lastMsg.text)}</p>
              </div>
            </div>
          </div>
        `;
      }
      listCont.innerHTML = listHTML;
    }

    // 2. Chat tarixini yig'ish (O'ng panel)
    if (!this.activeSmsNumber || !contactsMap[this.activeSmsNumber]) {
      histCont.innerHTML = `
        <div class="tg-empty-chat">
          <div class="tg-empty-icon"><span class="material-icons-round">question_answer</span></div>
          <p>Raqam kiritib suhbatni boshlang...</p>
        </div>`;
    } else {
      const msgs = contactsMap[this.activeSmsNumber];
      let histHTML = '';
      
      msgs.forEach(sms => {
        const isMine = true; // Hozircha hamma sms chiquvchi deb olinmoqda
        const rowClass = isMine ? 'sent' : 'recv';
        histHTML += `
          <div class="tg-message-row ${rowClass}">
            <div class="tg-bubble">
              ${Utils.escapeHtml(sms.text)}
              <span class="tg-bubble-time">${Utils.formatTime(sms.time)}</span>
            </div>
          </div>
        `;
      });
      
      histCont.innerHTML = histHTML;
      // Eng pastga skroll qilish (Yangi sms kelganda ko'rinishi uchun)
      histCont.scrollTop = histCont.scrollHeight;
    }
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
    
    const serviceId = Utils.$('quick-order-product')?.value;
    const qty = parseInt(Utils.$('quick-order-qty')?.value || '1');
    const note = Utils.$('quick-crm-note')?.value?.trim();
    
    // Kampaniya majburiy emas, backend o'zi aniqlab oladi agar topilsa

    if (!phone) {
      Utils.showToast('Telefon raqam kerak!', 'warning');
      return;
    }
    if (!serviceId) {
      Utils.showToast('Xizmatni tanlang!', 'warning');
      return;
    }

    try {
      // Haydovchi yoki xizmat orqali kompaniyani aniqlash
      const selectedDriverId = Utils.$('quick-order-driver')?.value || null;
      let resolvedCompanyId = window.Api.config.currentUser.companyId;
      
      const selService = this.services?.find(s => s.id === serviceId);
      if (selService && selService.companyId) {
        resolvedCompanyId = selService.companyId;
      }
      
      if (selectedDriverId && this.allDrivers) {
        const selDriver = this.allDrivers.find(d => d.id === selectedDriverId);
        if (selDriver && selDriver.companyId) {
          resolvedCompanyId = selDriver.companyId;
        }
      }

      let customerId = null;
      // 1. Mijozni qidirish yoki yaratish
      const existing = this.allContacts.find(c => c.phone1 === phone || c.phone2 === phone);
      if (existing) {
        customerId = existing.id;
      } else {
        const newCust = await window.Api.request('/customers', {
          method: 'POST',
          body: JSON.stringify({
            fullName: name || "Noma'lum",
            phone1: phone,
            address: address || undefined,
            companyId: resolvedCompanyId,
          })
        });
        customerId = newCust.id;
        this.loadContacts(); // update lists
      }

      // 2. Buyurtma yaratish
      const driverId = Utils.$('quick-order-driver')?.value || null;

      // Tanlangan haydovchining kompaniyasini aniqlash (yoki xizmatdan)
      let targetCompanyId = window.Api.config.currentUser.companyId;

      if (selService && selService.companyId) {
        targetCompanyId = selService.companyId;
      }

      if (driverId && this.allDrivers) {
        const selectedDriver = this.allDrivers.find(d => d.id === driverId);
        if (selectedDriver && selectedDriver.companyId) {
          targetCompanyId = selectedDriver.companyId;
        }
      }

      const orderData = {
        companyId: targetCompanyId,
        customerId: customerId,
        operatorId: window.Api.config.currentUser.id,
        notes: note,
        items: [
          {
            serviceId: serviceId,
            quantity: qty,
            notes: note
          }
        ]
      };

      const newOrder = await window.Api.request('/orders', {
        method: 'POST',
        body: JSON.stringify(orderData)
      });

      // 3. Haydovchini tayinlash (push notification ham avtomatik ketadi)
      if (driverId && newOrder && newOrder.id) {
        try {
          await window.Api.request(`/orders/${newOrder.id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'DRIVER_ASSIGNED', driverId })
          });
          console.log('[CRM] Haydovchi tayinlandi:', driverId);
        } catch(assignErr) {
          console.warn('[CRM] Haydovchi tayinlash xatoligi:', assignErr);
        }
      }
      
      Utils.showToast("Buyurtma saqlandi!", 'success');
      
      // 3. Agar hozir suhbat bo'layotgan bo'lsa, statusni complete qilishga ID ni uzatib qo'yamiz
      // Lekin aslida sessiya tugaganda sip-client.js completeCall chaqiradi.
      // Biz qo'shimcha ma'lumot qoldirishimiz mumkin:
      this.lastCreatedOrderId = newOrder.id;

      // Local list uchun 
      const orders = JSON.parse(localStorage.getItem('orders') || '[]');
      orders.unshift({ ...orderData, createdAt: new Date().toISOString() });
      localStorage.setItem('orders', JSON.stringify(orders));
      
      // Formani tozalash
      ['quick-order-product', 'quick-order-price', 'quick-crm-note', 'quick-order-driver'].forEach(id => {
        const el = Utils.$(id);
        if (el) el.value = '';
      });
      if (Utils.$('quick-order-qty')) Utils.$('quick-order-qty').value = '1';

    } catch (e) {
      console.error('[CRM] Buyurtma xatosi:', e);
      Utils.showToast('Buyurtma xatosi: ' + e.message, 'error');
    }
  }
};

window.CRM = CRM;
