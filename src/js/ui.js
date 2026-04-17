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
    this.loadCampaignDropdown();
  },

  async loadCampaignDropdown() {
    try {
      if (!window.Api) return;
      const res = await window.Api.getCampaigns();
      const select = Utils.$('sip-campaign');
      // Backend returns a raw array (not {data: [...]})
      const campaigns = Array.isArray(res) ? res : (res?.data || []);
      if (select && campaigns.length > 0) {
        select.innerHTML = `<option value="" selected>Kampaniya tanlang</option>`;
        campaigns.forEach(camp => {
          let opt = document.createElement('option');
          opt.value = camp.id || camp.name;
          opt.textContent = camp.name;
          select.appendChild(opt);
        });
      }
    } catch (err) {
      console.warn("Kampaniyalarni yuklashda xatolik (login bo'lmagan bo'lishi mumkin):", err);
    }
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

    // Hangup — event delegation uchun (component dinamik yuklanadi)
    // Hangup — event delegation uchun (component dinamik yuklanadi)
    document.addEventListener('click', (e) => {
      // Hangup
      const hangupBtn = e.target.closest('#btn-hangup');
      if (hangupBtn) {
        console.log('[UI] Hangup button clicked');
        this.stopRingbackTone();
        if (window.SipClient) window.SipClient.hangup();
        this.hideActiveCall();
        return;
      }

      // Redial
      if (e.target.closest('#dq-redial')) {
        const last = localStorage.getItem('gilam-last-dialed');
        if (last) {
          const input = Utils.$('dial-number');
          if (input) input.value = last;
          if (window.SipClient) window.SipClient.makeCall(last);
        } else {
          Utils.showToast("Oxirgi raqam topilmadi", "warning");
        }
        return;
      }
    });

    // Answer
    Utils.$('btn-answer-call')?.addEventListener('click', () => window.SipClient.answer());
    // Reject
    Utils.$('btn-reject-call')?.addEventListener('click', () => window.SipClient.reject());

    // Transfer, Hold, Mute bindings are handled in sip-client.js 

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

  async loadCampaignByLine(lineNumber) {
    try {
      const token = localStorage.getItem('authToken');
      const apiUrl = window.Api ? window.Api.config.API_BASE : 'https://gilam-api.ecos.uz';
      const res = await fetch(`${apiUrl}/api/campaigns/by-line/${encodeURIComponent(lineNumber)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) return;
      const campaign = await res.json();

      // Backend returns direct campaign object (not {data: campaign})
      if (campaign && campaign.id) {
        const c = campaign;

        const badge = Utils.$('campaign-name-badge');
        const info = Utils.$('active-campaign-info');
        if (badge) badge.textContent = c.name || '—';
        if (info) info.style.display = '';

        const campSelect = Utils.$('quick-crm-campaign');
        if (campSelect) {
          campSelect.innerHTML = `<option value="${c.id}" selected>${c.name}</option>`;
        }

        Utils.showToast(`Kampaniya: ${c.name}`, "success");
      }
    } catch (e) {
      console.warn('Campaign load error:', e);
    }
  },


  // ═══ ACTIVE CALL OVERLAY ════════════════════════════════════════════════
  ringbackOscillator: null,
  ringbackInterval: null,

  showActiveCall(target, statusLabel) {
    const d = Utils.$('call-target-display');
    if (d) d.textContent = typeof target === 'object' ? target.target : target;
    
    const s = Utils.$('call-status-label');
    if (s) s.textContent = statusLabel || "Qo'ng'iroq qilinmoqda...";
    
    const t = Utils.$('call-timer');
    if (t) t.textContent = '00:00';
    
    const n = Utils.$('call-target-name');
    if (n) n.textContent = '';
    
    const o = Utils.$('active-call-overlay');
    if (o) o.style.display = 'flex';
    
    this.activeCallSeconds = 0;

    // Ringback tone boshlash (chaqirish paytida operator eshitsin)
    if (statusLabel !== 'Kiruvchi suhbat') {
      this.startRingbackTone();
    }
  },

  hideActiveCall() {
    const o = Utils.$('active-call-overlay');
    if (o) o.style.display = 'none';
    this.stopCallTimer();
    this.stopRingbackTone();
  },

  // Ringback tone — operator chaqirayotganda "tu-tu-tu" ovoz
  startRingbackTone() {
    this.stopRingbackTone();
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const gainNode = ctx.createGain();
      gainNode.gain.value = 0;
      gainNode.connect(ctx.destination);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 425; // Standard ringback frequency
      osc.connect(gainNode);
      osc.start();

      this.ringbackOscillator = { ctx, osc, gainNode };

      // 1 sec ON, 4 sec OFF pattern (standard ringback)
      let isOn = false;
      const toggle = () => {
        isOn = !isOn;
        gainNode.gain.setValueAtTime(isOn ? 0.15 : 0, ctx.currentTime);
      };
      toggle(); // start ON
      this.ringbackInterval = setInterval(toggle, isOn ? 1000 : 4000);
      // More precise: 1s on, 4s off
      clearInterval(this.ringbackInterval);
      const cycle = () => {
        if (!this.ringbackOscillator) return;
        gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
        setTimeout(() => {
          if (!this.ringbackOscillator) return;
          gainNode.gain.setValueAtTime(0, ctx.currentTime);
          this.ringbackInterval = setTimeout(cycle, 3000);
        }, 1000);
      };
      cycle();
    } catch(e) {
      console.warn('[UI] Ringback tone error:', e);
    }
  },

  stopRingbackTone() {
    if (this.ringbackOscillator) {
      try {
        this.ringbackOscillator.osc.stop();
        this.ringbackOscillator.ctx.close();
      } catch(e) {}
      this.ringbackOscillator = null;
    }
    if (this.ringbackInterval) {
      clearTimeout(this.ringbackInterval);
      this.ringbackInterval = null;
    }
  },

  startCallTimer() {
    this.activeCallSeconds = 0;
    this.stopCallTimer();
    this.stopRingbackTone(); // Javob berganda ringback to'xtaydi
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

  addCallToHistory(target, type, durationSeconds = 0) {
    let history = [];
    try {
      history = JSON.parse(localStorage.getItem('call_recordings')) || [];
    } catch(e) { }

    // Check if target is an object (came from an event payload)
    const targetStr = typeof target === 'object' ? (target.target || target.callerNumber || "Noma'lum") : (target || "Noma'lum");

    const newRecord = {
      id: "call_" + Date.now(),
      target: targetStr,
      type: type || 'OUTGOING',
      date: new Date().toLocaleString('uz-UZ'),
      duration: Utils.formatDuration(durationSeconds)
    };

    history.unshift(newRecord);

    // Keep history manageable
    if (history.length > 500) history.pop();

    localStorage.setItem('call_recordings', JSON.stringify(history));
    
    // Auto-update UI if open
    if (typeof this.renderCallHistory === 'function') {
      this.renderCallHistory();
    }
    
    // Cloud SaaS API ga avtomatik integratsiya
    if (window.Api && window.Api.config.token) {
      if (type === 'OUTGOING') {
        window.Api.request('/calls/outgoing', {
          method: 'POST',
          body: JSON.stringify({
            callerPhone: window.Api.config.currentUser?.phone || 'operator',
            calledPhone: targetStr,
            direction: 'outgoing'
          })
        }).catch(err => console.warn('[Cloud Sync] Failed to sync outgoing call:', err));
      }
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
        <div class="lc-actions" style="display: flex; gap: 8px;">
          <button class="btn-icon" title="O'chirish" onclick="window.UI.deleteLine('${acc.id || acc.extension}')" style="color: var(--red);">
            <span class="material-icons-round">delete_outline</span>
          </button>
          <button class="${isActive ? 'btn-secondary' : 'btn-primary'}" onclick="window.UI.setActiveLine('${acc.extension}')">
            ${isActive ? '<span class="material-icons-round">check</span> Tanlangan' : 'Buni Tanlash'}
          </button>
        </div>
      `;
      list.appendChild(div);
    });
  },

  deleteLine(id) {
    if (!confirm('Ushbu liniyani o\'chirishni xohlaysizmi?')) return;
    let lines = JSON.parse(localStorage.getItem('sip_accounts') || '[]');
    lines = lines.filter(a => a.id !== id && a.extension !== id);
    localStorage.setItem('sip_accounts', JSON.stringify(lines));
    Utils.showToast('Liniya o\'chirildi', 'info');
    
    // Agar aktiv o'chgan bo'lsa
    let active = JSON.parse(localStorage.getItem('sip_account') || '{}');
    if (active.extension === id) {
      localStorage.removeItem('sip_account');
      if (window.SipClient) window.SipClient.disconnectAll();
    }
    this.renderCampLinesTab();
  },

  async renderCallHistory(filter = 'all') {
    const list = Utils.$('calls-list');
    const dashboardList = Utils.$('dashboard-calls-list');
    if (!list && !dashboardList) return;

    let history = [];
    
    // BACKEND INTEGRATION: Fetch securely mapped records natively if authenticated
    if (window.Api && window.Api.config.token) {
      try {
        const res = await window.Api.request(`/calls?limit=100${filter !== 'all' ? `&status=${filter}` : ''}`);
        // Backend returns a raw array (not {data: [...]})
        const records = Array.isArray(res) ? res : (res?.data || []);
        if (records.length > 0) {
           history = records.map(c => ({
             id: c.id,
             target: c.callerPhone || c.calledPhone || 'Noma\'lum',
             type: c.status === 'MISSED' ? 'MISSED' : (c.direction === 'INCOMING' ? 'INCOMING' : 'OUTGOING'),
             date: c.createdAt,
             duration: Utils.formatDuration(c.durationSeconds || 0)
           }));
           // local storage ga arxivlash (zapas)
           localStorage.setItem('call_recordings', JSON.stringify(history));
        }
      } catch(e) {
        console.warn('Backenddan calls yuklash xatosi:', e);
      }
    }

    if (history.length === 0) {
      try {
        history = JSON.parse(localStorage.getItem('call_recordings')) || [];
      } catch(e) {}
    }
    
    // Local Filter (agar backend ulana olmasa fallback ishlaydi)
    let filtered = history;
    if (filter !== 'all' && (!window.Api || !window.Api.config.token)) {
      filtered = history.filter(h => h.type === filter || (!h.type && filter === 'INCOMING')); // fallback
    }

    const emptyHtml = `<div class="empty-state">
      <span class="material-icons-round">history</span>
      <p>Qo'ng'iroqlar tarixi bo'sh</p>
    </div>`;
    
    const dashboardEmptyHtml = `<div class="crm-empty">
      <span class="material-icons-round">phone_disabled</span>
      <span>Hozircha qo'ng'iroqlar yo'q</span>
    </div>`;

    if (filtered.length === 0) {
      if (list) list.innerHTML = emptyHtml;
      if (dashboardList) dashboardList.innerHTML = dashboardEmptyHtml;
      return;
    }

    if (list) list.innerHTML = '';
    if (dashboardList) dashboardList.innerHTML = '';
    
    filtered.forEach((call, index) => {
      const date = new Date(call.date);
      let timeStr = '', dateStr = '';
      try {
        timeStr = date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        dateStr = date.toLocaleDateString();
      } catch(e) {
        timeStr = call.date.split(' ')[1] || '';
        dateStr = call.date.split(' ')[0] || call.date;
      }
      const durStr = call.duration || '00:00';
      
      let typeIcon = 'call_received';
      let typeCol = 'var(--green)';
      let isMissed = false;
      
      if (call.type === 'OUTGOING') { 
        typeIcon = 'call_made'; typeCol = '#3b82f6';
      } else if (call.type === 'MISSED') { 
        typeIcon = 'call_missed'; typeCol = 'var(--red)'; isMissed = true;
      }
      
      // Determine if it's a known contact
      let contactName = call.target || "Noma'lum";
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

      // 1. Populate full history tab (calls-list)
      if (list) {
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
            ${call.duration && call.duration !== '00:00' ? `<span class="dur-badge">${durStr}</span>` : '<span class="status-badge offline" style="font-size:10px;padding:3px 8px;">Javobsiz</span>'}
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
            <button class="btn-icon" onclick="window.UI.deleteCallRecord('${call.id}')" title="O'chirish">
              <span class="material-icons-round" style="color: var(--danger)">delete_outline</span>
            </button>
          </div>
        `;
        list.appendChild(div);
      }

      // 2. Populate dashboard shortcut (limit to 5)
      if (dashboardList && index < 5) {
        const dDiv = document.createElement('div');
        dDiv.className = 'crm-history-item';
        dDiv.style.display = 'flex';
        dDiv.style.alignItems = 'center';
        dDiv.style.justifyContent = 'space-between';
        dDiv.style.padding = '8px 0';
        dDiv.style.borderBottom = '1px solid var(--border-light)';
        
        dDiv.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="material-icons-round" style="color: ${typeCol}; font-size: 16px;">${typeIcon}</span>
            <div style="display: flex; flex-direction: column;">
              <span style="font-size: 13px; font-weight: 500;">${contactName}</span>
              <span style="font-size: 11px; color: var(--text-muted);">${timeStr} • ${durStr}</span>
            </div>
          </div>
          <button class="btn-icon" onclick="document.getElementById('dial-number').value='${call.target}';" style="transform: scale(0.8);">
            <span class="material-icons-round" style="color: var(--success)">call</span>
          </button>
        `;
        dashboardList.appendChild(dDiv);
      }
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
