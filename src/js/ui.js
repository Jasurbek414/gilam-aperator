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

    // ═══ Location Picker ═══
    Utils.$('btn-pick-location')?.addEventListener('click', async () => {
      const btn = Utils.$('btn-pick-location');
      const status = Utils.$('location-status');
      const locText = Utils.$('location-text');
      const latField = Utils.$('quick-crm-lat');
      const lngField = Utils.$('quick-crm-lng');
      const addrField = Utils.$('quick-crm-address');

      if (!navigator.geolocation) {
        return Utils.showToast("Geolokatsiya qo'llab-quvvatlanmaydi", "error");
      }

      btn.innerHTML = '<span class="material-icons-round" style="animation:pulse 1s infinite">gps_not_fixed</span>';
      
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude.toFixed(6);
          const lng = pos.coords.longitude.toFixed(6);
          latField.value = lat;
          lngField.value = lng;
          btn.classList.add('active');
          btn.innerHTML = '<span class="material-icons-round">gps_fixed</span>';
          
          if (status) {
            status.style.display = 'flex';
            locText.textContent = `${lat}, ${lng}`;
          }
          
          // Reverse geocode
          try {
            const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=uz`);
            const d = await r.json();
            if (d.display_name && addrField) {
              addrField.value = d.display_name.split(',').slice(0, 3).join(',');
              Utils.showToast("Lokatsiya belgilandi ✓", "success");
            }
          } catch(e) {
            Utils.showToast(`GPS: ${lat}, ${lng}`, "success");
          }
        },
        (err) => {
          btn.innerHTML = '<span class="material-icons-round">my_location</span>';
          Utils.showToast("Lokatsiyani olishda xatolik: " + err.message, "error");
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
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
  }
};

window.UI = UI;
