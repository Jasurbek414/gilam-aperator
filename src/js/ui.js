/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ui.js — Centralized DOM manipulations & Event Bindings
 * ═══════════════════════════════════════════════════════════════════════════
 */

const UI = {
  activeCallTimer: null,
  activeCallSeconds: 0,

  init() {
    this.bindWindowControls();
    this.bindTabs();
    this.bindDialer();
    this.renderDialerLines();
    this.renderCampLinesTab();
    this.renderCallHistory('all');
  },

  showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    if (name === 'login') {
      Utils.$('login-screen').classList.add('active');
    } else {
      Utils.$('app-screen').classList.add('active');
    }
  },

  bindWindowControls() {
    try {
      const { ipcRenderer } = require('electron');
      Utils.$('btn-minimize')?.addEventListener('click', () => ipcRenderer.send('window-minimize'));
      Utils.$('btn-maximize')?.addEventListener('click', () => ipcRenderer.send('window-maximize'));
      Utils.$('btn-close')?.addEventListener('click', () => ipcRenderer.send('window-close'));
    } catch(e) {
      console.warn('[UI] Not in Electron environment');
    }
  },

  bindTabs() {
    Utils.$$('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        Utils.$$('.tab').forEach(t => t.classList.remove('active'));
        Utils.$$('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const tabEl = Utils.$(`tab-${tabName}`);
        if (tabEl) tabEl.classList.add('active');
      });
    });

    Utils.$('btn-refresh-lines')?.addEventListener('click', () => {
      this.renderCampLinesTab();
      Utils.showToast('Liniyalar ro\'yxati yangilandi', 'info');
    });

    Utils.$$('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        Utils.$$('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderCallHistory(btn.dataset.filter);
      });
    });

    Utils.$('btn-refresh-calls')?.addEventListener('click', () => {
      const activeFilter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
      this.renderCallHistory(activeFilter);
      Utils.showToast('Tarix yangilandi', 'info');
    });
  },

  switchTab(tabName) {
    Utils.$$('.tab').forEach(t => t.classList.remove('active'));
    Utils.$$('.tab-content').forEach(c => c.classList.remove('active'));
    const tabBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (tabBtn) tabBtn.classList.add('active');
    const tabEl = Utils.$(`tab-${tabName}`);
    if (tabEl) tabEl.classList.add('active');
  },

  bindDialer() {
    // Dial tugmalar
    Utils.$$('.dial-key').forEach(key => {
      key.addEventListener('click', () => {
        const val = key.dataset.key;
        const input = Utils.$('dial-number');
        if (input) {
          input.value += val;
          input.focus();
        }

        // Agar suhbat aktiv bo'lsa, DTMF yuborish
        if (window.SipClient && window.SipClient.currentSession) {
          window.SipClient.sendDTMF(val);
        }
      });
    });

    // Backspace
    Utils.$('btn-clear-number')?.addEventListener('click', () => {
      const input = Utils.$('dial-number');
      if (input) input.value = input.value.slice(0, -1);
    });

    // Call button
    Utils.$('btn-call')?.addEventListener('click', () => {
      const target = Utils.$('dial-number')?.value?.trim();
      if (!target) return Utils.showToast('Raqam kiriting', 'warning');
      window.SipClient.makeCall(target);
    });

    // Enter to call
    Utils.$('dial-number')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const target = Utils.$('dial-number')?.value?.trim();
        if (target) window.SipClient.makeCall(target);
      }
    });

    // Hangup
    Utils.$('btn-hangup')?.addEventListener('click', () => window.SipClient.hangup());
    // Answer
    Utils.$('btn-answer-call')?.addEventListener('click', () => window.SipClient.answer());
    // Reject
    Utils.$('btn-reject-call')?.addEventListener('click', () => window.SipClient.reject());

    // ═══ Quick Actions ═══
    // Redial
    Utils.$('dq-redial')?.addEventListener('click', () => {
      const last = localStorage.getItem('gilam-last-dialed');
      if (last) {
        const input = Utils.$('dial-number');
        if (input) input.value = last;
        window.SipClient.makeCall(last);
      } else {
        Utils.showToast("Oxirgi raqam topilmadi", "warning");
      }
    });
    // Transfer
    Utils.$('dq-transfer')?.addEventListener('click', () => {
      if (window.SipClient?.transfer) {
        const target = prompt("Yo'naltirish raqami:");
        if (target) window.SipClient.transfer(target);
      } else {
        Utils.showToast("Hozir faol qo'ng'iroq yo'q", "warning");
      }
    });
    // Hold
    Utils.$('dq-hold')?.addEventListener('click', () => {
      if (window.SipClient?.hold) window.SipClient.hold();
      else Utils.showToast("Kutish funksiyasi mavjud emas", "warning");
    });
    // Mute
    Utils.$('dq-mute')?.addEventListener('click', () => {
      if (window.SipClient?.mute) window.SipClient.mute();
      else Utils.showToast("Mute funksiyasi mavjud emas", "warning");
    });

    // Store last dialed
    const origMakeCall = window.SipClient?.makeCall;
    if (origMakeCall) {
      const wrapped = function(target) {
        if (target) localStorage.setItem('gilam-last-dialed', target);
        return origMakeCall.call(window.SipClient, target);
      };
      window.SipClient.makeCall = wrapped;
    }

    // ═══ Map Location Picker — Leaflet widget ═══
    let mapInstance = null;
    let mapMarker = null;
    let selectedCoords = null;

    Utils.$('btn-pick-location')?.addEventListener('click', () => {
      const modal = Utils.$('map-modal');
      if (!modal) return;
      modal.style.display = 'flex';

      // Initialize or reset map
      setTimeout(() => {
        if (!mapInstance) {
          mapInstance = L.map('map-container', { zoomControl: true }).setView([41.2995, 69.2401], 12);
          
          // Dark tile layer
          L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            maxZoom: 19,
          }).addTo(mapInstance);

          // Click to place marker
          mapInstance.on('click', (e) => {
            selectedCoords = e.latlng;
            if (mapMarker) mapMarker.setLatLng(e.latlng);
            else mapMarker = L.marker(e.latlng, { draggable: true }).addTo(mapInstance);
            
            mapMarker.on('dragend', () => {
              selectedCoords = mapMarker.getLatLng();
              Utils.$('map-coords-text').textContent = `${selectedCoords.lat.toFixed(6)}, ${selectedCoords.lng.toFixed(6)}`;
            });
            
            Utils.$('map-coords-text').textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
          });
        } else {
          mapInstance.invalidateSize();
        }

        // Try to center on GPS
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const lat = pos.coords.latitude;
              const lng = pos.coords.longitude;
              mapInstance.setView([lat, lng], 16);
              
              // Auto-place marker at GPS
              selectedCoords = L.latLng(lat, lng);
              if (mapMarker) mapMarker.setLatLng(selectedCoords);
              else mapMarker = L.marker(selectedCoords, { draggable: true }).addTo(mapInstance);
              
              mapMarker.on('dragend', () => {
                selectedCoords = mapMarker.getLatLng();
                Utils.$('map-coords-text').textContent = `${selectedCoords.lat.toFixed(6)}, ${selectedCoords.lng.toFixed(6)}`;
              });
              
              Utils.$('map-coords-text').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            },
            () => {}, { enableHighAccuracy: true, timeout: 5000 }
          );
        }
      }, 100);
    });

    // Confirm location
    Utils.$('map-confirm')?.addEventListener('click', async () => {
      if (!selectedCoords) return Utils.showToast("Avval xaritadan joy tanlang", "warning");
      
      const lat = selectedCoords.lat.toFixed(6);
      const lng = selectedCoords.lng.toFixed(6);
      Utils.$('quick-crm-lat').value = lat;
      Utils.$('quick-crm-lng').value = lng;
      
      const btn = Utils.$('btn-pick-location');
      btn.classList.add('active');
      btn.innerHTML = '<span class="material-icons-round">gps_fixed</span>';
      
      const status = Utils.$('location-status');
      const locText = Utils.$('location-text');
      if (status) { status.style.display = 'flex'; locText.textContent = `${lat}, ${lng}`; }
      
      // Reverse geocode
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=uz`);
        const d = await r.json();
        if (d.display_name) {
          Utils.$('quick-crm-address').value = d.display_name.split(',').slice(0, 3).join(',').trim();
        }
      } catch(e) {}
      
      Utils.$('map-modal').style.display = 'none';
      Utils.showToast("Lokatsiya belgilandi ✓", "success");
    });

    // Cancel / Close
    const closeMap = () => { Utils.$('map-modal').style.display = 'none'; };
    Utils.$('map-cancel')?.addEventListener('click', closeMap);
    Utils.$('map-modal-close')?.addEventListener('click', closeMap);
  },

  // ═══ CAMPAIGN AUTO-LOAD ═══════════════════════════════════════════════
  // Liniya bo'yicha kampaniya ma'lumotlarini avtomatik yuklash
  async loadCampaignByLine(lineNumber) {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) return;
      
      const res = await fetch(`http://127.0.0.1:3000/api/campaigns/by-line/${lineNumber}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) return;
      const campaign = await res.json();
      
      if (campaign && campaign.data) {
        const c = campaign.data;
        
        // Kampaniya nomini ko'rsatish
        const badge = Utils.$('campaign-name-badge');
        const info = Utils.$('active-campaign-info');
        if (badge) badge.textContent = c.name || '—';
        if (info) info.style.display = '';
        
        // Xizmat turlarini to'ldirish
        const productSelect = Utils.$('quick-order-product');
        if (productSelect && c.products) {
          productSelect.innerHTML = '<option value="">Xizmat tanlang</option>';
          c.products.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id || p.name;
            opt.textContent = `${p.name} — ${p.price?.toLocaleString() || '—'} so'm`;
            opt.dataset.price = p.price || '';
            productSelect.appendChild(opt);
          });
        }
        
        // Kampaniya selectni to'ldirish
        const campSelect = Utils.$('quick-crm-campaign');
        if (campSelect) {
          campSelect.innerHTML = `<option value="${c.id}" selected>${c.name}</option>`;
        }
        
        // Narxni avtomatik to'ldirish (xizmat tanlanganda)
        productSelect?.addEventListener('change', () => {
          const sel = productSelect.options[productSelect.selectedIndex];
          const priceField = Utils.$('quick-order-price');
          if (sel?.dataset?.price && priceField) {
            priceField.value = sel.dataset.price;
          }
        });
        
        Utils.showToast(`Kampaniya: ${c.name}`, "success");
      }
    } catch (e) {
      console.warn('Campaign load error:', e);
    }
  },

  // ═══ ACTIVE CALL OVERLAY ════════════════════════════════════════════════
  showActiveCall(target, statusLabel) {
    const d = Utils.$('call-target-display');
    if (d) d.textContent = target;
    
    const s = Utils.$('call-status-label');
    if (s) s.textContent = statusLabel || "Qo'ng'iroq qilinmoqda...";
    
    const t = Utils.$('call-timer');
    if (t) t.textContent = '00:00';
    
    const n = Utils.$('call-target-name');
    if (n) n.textContent = '';
    
    const o = Utils.$('active-call-overlay');
    if (o) o.style.display = 'flex';
    
    this.activeCallSeconds = 0;
  },

  hideActiveCall() {
    const o = Utils.$('active-call-overlay');
    if (o) o.style.display = 'none';
    this.stopCallTimer();
  },

  startCallTimer() {
    this.activeCallSeconds = 0;
    this.stopCallTimer();
    this.activeCallTimer = setInterval(() => {
      this.activeCallSeconds++;
      const el = Utils.$('call-timer');
      if (el) el.textContent = Utils.formatDuration(this.activeCallSeconds);
    }, 1000);
  },

  stopCallTimer() {
    if (this.activeCallTimer) {
      clearInterval(this.activeCallTimer);
      this.activeCallTimer = null;
    }
  },

  // ═══ INCOMING CALL OVERLAY ══════════════════════════════════════════════
  showIncomingCallUI(data) {
    const num = Utils.$('incoming-caller-number');
    if (num) num.textContent = data.callerNumber || "Noma'lum";
    
    const name = Utils.$('incoming-caller-name');
    if (name) name.textContent = data.callerName || '';
    
    const camp = Utils.$('incoming-campaign-name');
    if (camp) camp.textContent = data.campaignName ? `📋 ${data.campaignName}` : '';
    
    const overlay = Utils.$('incoming-call-overlay');
    if (overlay) overlay.style.display = 'flex';
    
    try {
      const ring = Utils.$('ringtone');
      if (ring) {
        ring.currentTime = 0;
        ring.play().catch(() => {});
      }
    } catch (e) {}
  },

  hideIncomingCall() {
    const overlay = Utils.$('incoming-call-overlay');
    if (overlay) overlay.style.display = 'none';
    try {
      const ring = Utils.$('ringtone');
      if (ring) ring.pause();
    } catch (e) {}
  },

  renderCampLinesTab() {
    const list = Utils.$('lines-list');
    if (!list) return;

    let lines = [];
    try {
      lines = JSON.parse(localStorage.getItem('sip_accounts')) || [];
    } catch(e) {}

    if (lines.length === 0) {
      list.innerHTML = `<div class="empty-state">
        <span class="material-icons-round">phone_disabled</span>
        <p>Hali hech qanday liniya konfiguratsiyasi yo'q</p>
      </div>`;
      return;
    }

    list.innerHTML = '';
    
    lines.forEach(acc => {
      let activeExt = '';
      try {
        const active = JSON.parse(localStorage.getItem('sip_account') || '{}');
        activeExt = active.extension || active.username || '';
      } catch(e) {}
      
      const isActive = (acc.extension === activeExt);
      const campName = acc.campaignName || 'Umumiy Kampaniya';
      
      const div = document.createElement('div');
      div.className = 'line-card';
      if (isActive) div.classList.add('active');
      
      div.innerHTML = `
        <div class="lc-icon"><span class="material-icons-round">dialer_sip</span></div>
        <div class="lc-info">
          <h3>${campName}</h3>
          <p>Liniya: <strong>${acc.extension}</strong></p>
        </div>
        <div class="lc-status">
          <span class="status-badge ${isActive ? 'online' : 'offline'}">${isActive ? 'Faol Liniya' : 'Kutish'}</span>
        </div>
        <div class="lc-actions">
          <button class="${isActive ? 'btn-secondary' : 'btn-primary'}" onclick="window.UI.setActiveLine('${acc.extension}')">
            ${isActive ? '<span class="material-icons-round">check</span> Tanlangan' : 'Buni Tanlash'}
          </button>
        </div>
      `;
      list.appendChild(div);
    });
  },

  renderCallHistory(filter = 'all') {
    const list = Utils.$('calls-list');
    if (!list) return;

    let history = [];
    try {
      history = JSON.parse(localStorage.getItem('call_recordings')) || [];
    } catch(e) {}
    
    // Add mock history if it is empty so they can see the design
    if (history.length === 0) {
      history = [
        { id: 1, date: new Date(Date.now() - 1000 * 60 * 5).toISOString(), target: '+998901234567', duration: 125, type: 'INCOMING' },
        { id: 2, date: new Date(Date.now() - 1000 * 60 * 60).toISOString(), target: '+998991112233', duration: 0, type: 'MISSED' },
        { id: 3, date: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), target: '+998941112233', duration: 45, type: 'OUTGOING' },
        { id: 4, date: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), target: '+998971112233', duration: 320, type: 'INCOMING' }
      ];
      localStorage.setItem('call_recordings', JSON.stringify(history));
    }

    // Filter logic
    let filtered = history;
    if (filter !== 'all') {
      filtered = history.filter(h => h.type === filter || (!h.type && filter === 'INCOMING')); // fallback old recordings to INCOMING
    }

    if (filtered.length === 0) {
      list.innerHTML = `<div class="empty-state">
        <span class="material-icons-round">history</span>
        <p>Qo'ng'iroqlar tarixi bo'sh</p>
      </div>`;
      return;
    }

    list.innerHTML = '';
    
    filtered.forEach(call => {
      const date = new Date(call.date);
      const timeStr = date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      const dateStr = date.toLocaleDateString();
      const durStr = window.Utils.formatDuration(call.duration || 0);
      
      let typeIcon = 'call_received';
      let typeCol = 'var(--green)';
      let isMissed = false;
      
      if (call.type === 'OUTGOING') { 
        typeIcon = 'call_made'; typeCol = '#3b82f6';
      } else if (call.type === 'MISSED') { 
        typeIcon = 'call_missed'; typeCol = 'var(--red)'; isMissed = true;
      }
      
      // Determine if it's a known contact
      let contactName = call.target;
      let initials = '#';
      let recognized = false;
      if (window.CRM && window.CRM.allContacts) {
        const found = window.CRM.allContacts.find(c => c.phone1 === call.target || c.phone2 === call.target);
        if (found) {
          contactName = found.fullName || call.target;
          initials = contactName.charAt(0).toUpperCase();
          recognized = true;
        }
      }
      
      // Audio Recording logic
      const hasAudio = call.data ? true : false;
      
      const div = document.createElement('div');
      div.className = 'history-card';
      div.innerHTML = `
        <div class="hc-avatar ${isMissed ? 'missed-bg' : ''}">${initials}</div>
        <div class="hc-details">
          <h4 style="${isMissed ? 'color: var(--red);' : ''}">${contactName}</h4>
          <p>
            <span class="material-icons-round type-indicator" style="color: ${typeCol}">${typeIcon}</span> 
            ${dateStr} • ${timeStr}
          </p>
        </div>
        <div class="hc-duration">
          ${call.duration ? `<span class="dur-badge">${durStr}</span>` : '<span class="status-badge offline" style="font-size:10px;padding:3px 8px;">Javobsiz</span>'}
        </div>
        <div class="hc-actions">
          ${hasAudio ? `
          <button class="btn-icon" onclick="window.UI.playRecording('${call.id}')" title="Eshitish">
            <span class="material-icons-round">play_arrow</span>
          </button>` : ''}
          ${!recognized ? `
          <button class="btn-icon" onclick="document.getElementById('new-customer-phone1').value='${call.target}'; document.getElementById('modal-new-customer').style.display='flex';" title="Mijoz sifatida saqlash">
            <span class="material-icons-round">person_add</span>
          </button>` : ''}
          <button class="btn-icon history-call-btn" onclick="document.getElementById('dial-number').value='${call.target}'; window.UI.switchTab('dialer');" title="Qong'iroq qilish">
            <span class="material-icons-round">call</span>
          </button>
        </div>
      `;
      list.appendChild(div);
    });
  },
  
  playRecording(id) {
    let history = [];
    try {
      history = JSON.parse(localStorage.getItem('call_recordings')) || [];
    } catch(e) {}
    const rec = history.find(r => r.id === id);
    if (rec && rec.data) {
      const audio = new Audio(rec.data);
      audio.play().catch(e => Utils.showToast('Audio chalishda xatolik', 'error'));
      Utils.showToast(`${rec.target} audiosi eshittirilmoqda`, 'info');
    } else {
      Utils.showToast('Audio yozuv topilmadi', 'warning');
    }
  },

  setActiveLine(ext) {
    let lines = [];
    try {
      lines = JSON.parse(localStorage.getItem('sip_accounts')) || [];
    } catch(e) {}
    
    const target = lines.find(l => l.extension === ext);
    if(target) {
      localStorage.setItem('sip_account', JSON.stringify(target));
      this.renderCampLinesTab();
      this.renderDialerLines();
      Utils.showToast(`Faol liniya o'zgartirildi: ${ext}`, 'success');
      
      // If we want to connect to it automatically:
      if(window.SipClient) {
        window.SipClient.connect(target);
      }
    }
  },

  renderDialerLines() {
    const list = Utils.$('dialer-lines-list');
    if (!list) return;
    
    let lines = [];
    try {
      lines = JSON.parse(localStorage.getItem('sip_accounts')) || [];
    } catch(e) {}
    
    if (lines.length === 0) {
      list.innerHTML = `<div class="dl-empty">
        <span class="material-icons-round">sim_card_alert</span>
        Chiziqlar ro'yxati bo'sh
      </div>`;
      return;
    }

    list.innerHTML = '';
    
    // SIP accounts usually have extension, campaignName
    lines.forEach(acc => {
      // Find connection status internally or just assume from state?
      // Since sip-client hooks handles connection, we'll try to find active SIP account
      let activeExt = '';
      try {
        const active = JSON.parse(localStorage.getItem('sip_account') || '{}');
        activeExt = active.extension || active.username || '';
      } catch(e) {}

      const isActive = (acc.extension === activeExt);
      const statusClass = isActive ? 'on' : 'off';
      const campName = acc.campaignName || 'Umumiy';
      
      const item = document.createElement('div');
      item.className = 'dl-item';
      item.innerHTML = `
        <div class="dl-dot ${statusClass}"></div>
        <div class="dl-name">${acc.extension || acc.username || 'Raqam'}</div>
        <span class="material-icons-round dl-arrow">arrow_forward_ios</span>
        <div class="dl-campaign">${campName}</div>
      `;
      list.appendChild(item);
    });
  }
};

window.UI = UI;
