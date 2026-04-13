/**
 * ═══════════════════════════════════════════════════════════════════════════
 * sip-client.js — Production-grade JsSIP WebRTC Softphone Engine
 * 
 * X-Lite / MicroSIP darajasidagi haqiqiy SIP client.
 * JsSIP kutubxonasi orqali Asterisk/FreePBX WebSocket bilan ishlaydi.
 * 
 * Xususiyatlar:
 *   - Real SIP REGISTER / INVITE / BYE
 *   - WebRTC Audio (mikrofon + karnay)
 *   - DTMF yuborish (RFC 2833)
 *   - Hold / Unhold
 *   - Mute / Unmute
 *   - Bir nechta SIP akkaunt (Multi-line)
 *   - Avtomatik qayta ulanish (Reconnect)
 *   - Kiruvchi qo'ng'iroqlarni qabul qilish / rad etish
 * ═══════════════════════════════════════════════════════════════════════════
 */

const JsSIP = require('jssip');

// Debug loglarni yoqish (konsolda ko'rish uchun)
// JsSIP.debug.enable('JsSIP:*');
JsSIP.debug.disable('JsSIP:*');

const SipClient = {
  // --- State ---
  activeSipLines: {},        // { [accId]: { phone, isRegistered, acc } }
  sipAccounts: [],           // localStorage dan yuklanadigan akkauntlar
  currentSession: null,      // Hozirgi aktiv session (Inviter yoki Invitation)
  isMuted: false,
  isOnHold: false,
  isRecording: false,
  mediaRecorder: null,
  recordedChunks: [],
  audioContext: null,
  localStream: null,         // Mikrofon stream
  remoteAudio: null,         // <audio> element
  callRecordings: JSON.parse(localStorage.getItem('call_recordings') || '[]'),

  // ═══ INIT ═══════════════════════════════════════════════════════════════
  init() {
    this.sipAccounts = JSON.parse(localStorage.getItem('sip_accounts') || '[]');
    
    // Remote audio element yaratish
    this.remoteAudio = document.getElementById('sipRemoteAudio');
    if (!this.remoteAudio) {
      this.remoteAudio = document.createElement('audio');
      this.remoteAudio.id = 'sipRemoteAudio';
      this.remoteAudio.autoplay = true;
      document.body.appendChild(this.remoteAudio);
    }
    
    this.renderAccounts();
    this._bindMuteHoldButtons();
    console.log('[SIP] Initialized. Accounts:', this.sipAccounts.length);
  },

  // ═══ WEBSOCKET URL BUILDER ══════════════════════════════════════════════
  // Asterisk/FreePBX standart WebSocket portlari:
  //   ws://IP:8088/ws   (HTTP)
  //   wss://IP:8089/ws  (HTTPS)
  _buildWsUrl(acc) {
    const domain = acc.domain.trim();
    const transport = acc.transport || 'ws';
    
    // Agar foydalanuvchi to'liq URL bergan bo'lsa
    if (domain.startsWith('ws://') || domain.startsWith('wss://')) {
      return domain;
    }
    
    // IP:PORT formatida (masalan 10.100.100.1:8088)
    if (domain.includes(':')) {
      const parts = domain.split(':');
      const ip = parts[0];
      const port = parts[1];
      // Agar /ws path bo'lmasa, qo'shamiz
      if (domain.includes('/')) {
        return `${transport}://${domain}`;
      }
      return `${transport}://${ip}:${port}/ws`;
    }
    
    // Faqat IP (masalan 10.100.100.1)
    const defaultPort = transport === 'wss' ? 8089 : 8088;
    return `${transport}://${domain}:${defaultPort}/ws`;
  },

  // Realm (SIP domain) ni ajratib olish
  _extractRealm(domain) {
    return domain.replace(/^(wss?:\/\/)/, '').split(':')[0].split('/')[0];
  },

  // ═══ CONNECT (REGISTER) ═════════════════════════════════════════════════
  connect(acc) {
    // Agar allaqachon ulangan bo'lsa, avval uzamiz
    if (this.activeSipLines[acc.id] && this.activeSipLines[acc.id].phone) {
      try { this.activeSipLines[acc.id].phone.disconnect(); } catch(e) {}
      delete this.activeSipLines[acc.id];
    }

    const SipUdpEngine = require('./sip-udp-engine');
    const engine = new SipUdpEngine();

    console.log(`[SIP] Connecting via UDP: ${acc.name}`);
    console.log(`[SIP]   Server: ${acc.domain}:5060`);
    console.log(`[SIP]   Extension: ${acc.extension}`);

    Utils.showToast(`${acc.name} — ulanilmoqda...`, 'info');

    // ─── Event Handlers ───────────────────────────────────────────
    engine.on('registered', () => {
      console.log(`[SIP] ✅ Registered: ${acc.name} (${acc.extension})`);
      Utils.showToast(`✅ ${acc.name} — PBX ga muvaffaqiyatli ulandi!`, 'success');
      this.activeSipLines[acc.id] = {
        phone: engine,
        isRegistered: true,
        acc
      };
      this.renderAccounts();
    });

    engine.on('unregistered', () => {
      console.log(`[SIP] Unregistered: ${acc.name}`);
      if (this.activeSipLines[acc.id]) {
        this.activeSipLines[acc.id].isRegistered = false;
        this.renderAccounts();
      }
    });

    engine.on('disconnected', () => {
      console.log(`[SIP] Disconnected: ${acc.name}`);
      if (this.activeSipLines[acc.id]) {
        this.activeSipLines[acc.id].isRegistered = false;
        this.renderAccounts();
      }
    });

    engine.on('registrationFailed', (data) => {
      console.error(`[SIP] ❌ Registration failed: ${acc.name}`, data);
      const cause = data.cause || 'Noma\'lum xatolik';
      Utils.showToast(`❌ ${acc.name} — Registratsiya rad etildi: ${cause}`, 'error');
      this.activeSipLines[acc.id] = {
        phone: engine,
        isRegistered: false,
        acc
      };
      this.renderAccounts();
    });

    engine.on('error', (err) => {
      console.error(`[SIP] Error: ${err.message}`);
    });

    // ─── Kiruvchi qo'ng'iroq (Incoming Call) ──────────────────────
    engine.on('incomingCall', (data) => {
      console.log(`[SIP] 📞 Incoming call from: ${data.callerNumber}`);
      
      // Agar boshqa qo'ng'iroq aktiv bo'lsa, band (busy)
      if (this.currentSession) {
        console.log('[SIP] Already in call, sending busy');
        engine.rejectCall();
        return;
      }
      
      this.currentSession = engine;
      
      window.UI.showIncomingCallUI({
        callerNumber: data.callerNumber,
        callerName: data.callerName || '',
        campaignName: acc.name,
      });

      // CRM panelni avtomatik ochish
      if (window.CRM) window.CRM.onCallStarted(data.callerNumber, acc.name);
    });

    engine.on('callAnswered', (data) => {
      console.log(`[SIP] Call connected: ${data.target}`);
      window.UI.showActiveCall({ target: data.target });
    });

    engine.on('callEnded', (data) => {
      console.log(`[SIP] Call ended: ${data.reason}`);
      this.currentSession = null;
      this._cleanupCall();
    });

    engine.on('ringing', (data) => {
      console.log(`[SIP] Ringing: ${data.target}`);
      const label = Utils.$('call-status-label');
      if (label) label.textContent = 'Jiringlayapti...';
    });

    engine.on('callFailed', (data) => {
      console.log(`[SIP] Call failed: ${data.code} ${data.reason}`);
      this.currentSession = null;
      this._cleanupCall();
      Utils.showToast(`❌ Qo'ng'iroq rad etildi: ${data.reason}`, 'error');
    });

    // ─── Start UDP connection ─────────────────────────────────────
    try {
      engine.connect({
        domain: acc.domain,
        sipPort: 5060,
        extension: acc.extension,
        password: acc.password,
        name: acc.name || acc.extension,
      });

      // Saqlaymiz (hali register bo'lmagan, lekin connecting)
      this.activeSipLines[acc.id] = {
        phone: engine,
        isRegistered: false,
        acc
      };
      this.renderAccounts();

    } catch (err) {
      console.error('[SIP] Failed to connect:', err);
      Utils.showToast(`❌ ${acc.name} — xatolik: ${err.message}`, 'error');
    }
  },

  // ═══ SESSION EVENTS (ikkala yo'nalish uchun) ═════════════════════════════
  _attachSessionEvents(session) {
    session.on('progress', () => {
      console.log('[SIP] Call in progress (ringing)');
      const label = Utils.$('call-status-label');
      if (label) label.textContent = 'Jiringlayapti...';
    });

    session.on('accepted', () => {
      console.log('[SIP] Call accepted / established');

      // Backend API: Qo'ng'iroqqa javob berildi
      if (window.CRM && window.CRM.activeCallId && window.Api?.config?.token) {
        window.Api.request(`/calls/${window.CRM.activeCallId}/answer`, { method: 'PUT' }).catch(console.warn);
      }

      const label = Utils.$('call-status-label');
      if (label) label.textContent = 'Suhbat';
      window.UI.startCallTimer();
      // Avtomatik yozib olishni boshlash
      setTimeout(() => this._startRecording(), 1000);
    });

    session.on('confirmed', () => {
      console.log('[SIP] Call confirmed (media established)');
    });

    session.on('ended', (data) => {
      console.log('[SIP] Call ended:', data.cause);
      
      // Backend API: Qo'ng'iroq yakunlandi
      if (window.CRM && window.CRM.activeCallId && window.Api?.config?.token) {
        // Aslida order qilingan bo'lsa, order_id ni ham yuborish kerak.
        // Bu joyda faqat callni yopamiz. (Agar buyurtma saqlangan bo'lsa, u order ni qanday bog'lash crm.js da).
        window.Api.request(`/calls/${window.CRM.activeCallId}/complete`, { 
          method: 'PUT',
          body: JSON.stringify({ notes: Utils.$('quick-crm-note')?.value || '' })
        }).catch(console.warn);
        
        // Qo'ng'iroq tugadi, ID ni tozalaymiz
        window.CRM.activeCallId = null;
      }

      this._cleanupCall();
      if (window.CRM) window.CRM.onCallEnded();
      Utils.showToast("Qo'ng'iroq tugadi", 'info');
    });

    session.on('failed', (data) => {
      console.log('[SIP] Call failed:', data.cause);

      // Backend API: Qo'ng'iroq javobsiz / xato bilan tugadi
      if (session.direction === 'incoming' && window.CRM && window.CRM.activeCallId && window.Api?.config?.token) {
        window.Api.request(`/calls/${window.CRM.activeCallId}/miss`, { method: 'PUT' }).catch(console.warn);
        window.CRM.activeCallId = null;
      }

      this._cleanupCall();
      Utils.showToast(`Qo'ng'iroq xatosi: ${data.cause || 'Noma\'lum'}`, 'error');
    });

    // ─── WebRTC Media ───────────────────────────────────────────────
    session.on('peerconnection', (data) => {
      const pc = data.peerconnection;
      console.log('[SIP] PeerConnection created');

      pc.ontrack = (event) => {
        console.log('[SIP] Remote track received:', event.track.kind);
        if (event.track.kind === 'audio') {
          const remoteStream = new MediaStream();
          remoteStream.addTrack(event.track);
          this.remoteAudio.srcObject = remoteStream;
          this.remoteAudio.play().catch(e => console.error('[SIP] Audio play error:', e));
        }
      };

      // ICE candidate loglar
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('[SIP] ICE candidate:', event.candidate.type);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log('[SIP] ICE state:', pc.iceConnectionState);
      };
    });
  },

  // ═══ MAKE CALL (Chiquvchi qo'ng'iroq) ═══════════════════════════════════
  makeCall(target) {
    // Birinchi ulangan SIP liniyani topish
    const activeKey = Object.keys(this.activeSipLines).find(
      id => this.activeSipLines[id].isRegistered && this.activeSipLines[id].phone
    );

    if (!activeKey) {
      Utils.showToast('SIP profil ulanmagan! Avval Sozlamalar > SIP bo\'limida raqam ulang.', 'error');
      return;
    }

    if (this.currentSession) {
      Utils.showToast('Allaqachon aktiv qo\'ng\'iroq bor. Avval uni tugatib oling.', 'warning');
      return;
    }

    const line = this.activeSipLines[activeKey];

    console.log(`[SIP] Making call to: ${target}`);

    try {
      line.phone.makeCall(target);
      this.currentSession = line.phone;
      this.isMuted = false;
      this.isOnHold = false;
      this._updateMuteHoldUI();

      // UI: qo'ng'iroq overlay ko'rsatish
      window.UI.showActiveCall(target, 'Chaqirilmoqda...');

      // CRM panelni ochish
      const lineName = line.acc?.name || '';
      if (window.CRM) window.CRM.onCallStarted(target, lineName);

    } catch (err) {
      console.error('[SIP] Call error:', err);
      Utils.showToast(`Qo'ng'iroqda xatolik: ${err.message}`, 'error');
    }
  },

  // ═══ ANSWER (Kiruvchi qo'ng'iroqni qabul qilish) ════════════════════════
  answer() {
    if (!this.currentSession) return;
    
    console.log('[SIP] Answering incoming call...');
    
    this.currentSession.answerCall();

    this.isMuted = false;
    this.isOnHold = false;
    this._updateMuteHoldUI();

    window.UI.hideIncomingCall();
    window.UI.showActiveCall(this.currentSession.currentCall?.targetExt || '', 'Kiruvchi suhbat');
  },

  // ═══ REJECT (Kiruvchi qo'ng'iroqni rad etish) ═══════════════════════════
  reject() {
    if (this.currentSession) {
      console.log('[SIP] Rejecting incoming call');
      try {
        this.currentSession.rejectCall();
      } catch(e) {
        console.error('[SIP] Reject error:', e);
      }
      this.currentSession = null;
    }
    window.UI.hideIncomingCall();
  },

  // ═══ HANGUP (Qo'ng'iroqni tugatish) ═════════════════════════════════════
  hangup() {
    if (this.currentSession) {
      console.log('[SIP] Hanging up call');
      try {
        this.currentSession.hangup();
      } catch(e) {
        console.error('[SIP] Hangup error:', e);
      }
    }
    this._cleanupCall();
  },

  // ═══ MUTE / UNMUTE ══════════════════════════════════════════════════════
  toggleMute() {
    if (!this.currentSession) return;
    
    if (this.isMuted) {
      this.currentSession.unmute({ audio: true });
      this.isMuted = false;
      Utils.showToast('🎤 Mikrofon yoqildi', 'info');
    } else {
      this.currentSession.mute({ audio: true });
      this.isMuted = true;
      Utils.showToast('🔇 Mikrofon o\'chirildi', 'info');
    }
    this._updateMuteHoldUI();
  },

  // ═══ HOLD / UNHOLD ══════════════════════════════════════════════════════
  toggleHold() {
    if (!this.currentSession) return;
    
    if (this.isOnHold) {
      this.currentSession.unhold();
      this.isOnHold = false;
      Utils.showToast('▶️ Suhbat davom ettirildi', 'info');
    } else {
      this.currentSession.hold();
      this.isOnHold = true;
      Utils.showToast('⏸️ Kutish rejimida', 'info');
    }
    this._updateMuteHoldUI();
  },

  // ═══ DTMF (Raqam yuborish suhbat vaqtida) ══════════════════════════════
  sendDTMF(tone) {
    if (!this.currentSession) return;
    try {
      this.currentSession.sendDTMF(tone, {
        duration: 100,
        interToneGap: 70
      });
      console.log(`[SIP] DTMF sent: ${tone}`);
    } catch(e) {
      console.error('[SIP] DTMF error:', e);
    }
  },

  // ═══ TRANSFER (Qo'ng'iroqni boshqa raqamga o'tkazish) ══════════════════
  transfer(target) {
    if (!this.currentSession) {
      Utils.showToast('Aktiv qo\'ng\'iroq yo\'q', 'warning');
      return;
    }
    
    const activeKey = Object.keys(this.activeSipLines).find(
      id => this.activeSipLines[id].isRegistered
    );
    if (!activeKey) return;
    
    const realm = this._extractRealm(this.activeSipLines[activeKey].acc.domain);
    const referUri = `sip:${target}@${realm}`;
    
    try {
      this.currentSession.refer(referUri);
      Utils.showToast(`📲 Qo'ng'iroq ${target} ga o'tkazilmoqda...`, 'info');
    } catch(e) {
      Utils.showToast(`Transfer xatosi: ${e.message}`, 'error');
    }
  },

  // ═══ CLEANUP ════════════════════════════════════════════════════════════
  _cleanupCall() {
    // Yozib olishni to'xtatish
    this._stopRecording();
    
    this.currentSession = null;
    this.isMuted = false;
    this.isOnHold = false;
    this.isRecording = false;
    this._updateMuteHoldUI();
    this._updateRecordUI();
    window.UI.hideActiveCall();
    window.UI.hideIncomingCall();
    
    // Remote audio tozalash
    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
    }
  },

  // ═══ MUTE/HOLD UI UPDATE ════════════════════════════════════════════════
  _updateMuteHoldUI() {
    const muteBtn = Utils.$('btn-mute');
    const holdBtn = Utils.$('btn-hold');
    
    if (muteBtn) {
      const icon = muteBtn.querySelector('.material-icons-round');
      if (icon) icon.textContent = this.isMuted ? 'mic_off' : 'mic';
      muteBtn.classList.toggle('active', this.isMuted);
    }
    
    if (holdBtn) {
      const icon = holdBtn.querySelector('.material-icons-round');
      if (icon) icon.textContent = this.isOnHold ? 'play_arrow' : 'pause';
      holdBtn.classList.toggle('active', this.isOnHold);
    }
  },

  _bindMuteHoldButtons() {
    Utils.$('btn-mute')?.addEventListener('click', () => this.toggleMute());
    Utils.$('btn-hold')?.addEventListener('click', () => this.toggleHold());
    Utils.$('btn-record')?.addEventListener('click', () => this.toggleRecord());
    
    // Transfer tugmasi
    Utils.$('btn-transfer')?.addEventListener('click', () => {
      const target = prompt('Transfer raqamini kiriting:');
      if (target) this.transfer(target);
    });

    // Volume slider
    Utils.$('volume-slider')?.addEventListener('input', (e) => {
      this.setVolume(parseFloat(e.target.value));
    });
  },

  // ═══ CALL RECORDING ════════════════════════════════════════════════════
  _startRecording() {
    if (!this.currentSession || this.isRecording) return;
    try {
      const pc = this.currentSession.connection;
      if (!pc) return;

      this.audioContext = new AudioContext();
      const dest = this.audioContext.createMediaStreamDestination();

      // Remote audio stream
      pc.getReceivers().forEach(r => {
        if (r.track && r.track.kind === 'audio') {
          const remoteStream = new MediaStream([r.track]);
          const remoteSource = this.audioContext.createMediaStreamSource(remoteStream);
          remoteSource.connect(dest);
        }
      });

      // Local audio stream (mikrofon)
      pc.getSenders().forEach(s => {
        if (s.track && s.track.kind === 'audio') {
          const localStream = new MediaStream([s.track]);
          const localSource = this.audioContext.createMediaStreamSource(localStream);
          localSource.connect(dest);
        }
      });

      this.recordedChunks = [];
      this.mediaRecorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordedChunks.push(e.data);
      };

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        this._saveRecording(blob);
      };

      this.mediaRecorder.start(1000); // har 1 soniyada data
      this.isRecording = true;
      this._updateRecordUI();
      console.log('[SIP] Recording started');
    } catch(e) {
      console.error('[SIP] Recording start error:', e);
    }
  },

  _stopRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch(e) {}
      console.log('[SIP] Recording stopped');
    }
    if (this.audioContext) {
      try { this.audioContext.close(); } catch(e) {}
      this.audioContext = null;
    }
  },

  _saveRecording(blob) {
    const reader = new FileReader();
    reader.onloadend = () => {
      const record = {
        id: 'rec_' + Date.now(),
        date: new Date().toISOString(),
        target: Utils.$('call-target-display')?.textContent || 'Noma\'lum',
        duration: window.UI.activeCallSeconds || 0,
        size: blob.size,
        data: reader.result // base64
      };
      this.callRecordings.unshift(record);
      // Faqat so'nggi 50 ta yozuvni saqlash
      if (this.callRecordings.length > 50) this.callRecordings = this.callRecordings.slice(0, 50);
      localStorage.setItem('call_recordings', JSON.stringify(this.callRecordings));
      Utils.showToast('Suhbat yozib olindi!', 'success');
    };
    reader.readAsDataURL(blob);
  },

  toggleRecord() {
    if (this.isRecording) {
      this._stopRecording();
      this.isRecording = false;
    } else {
      this._startRecording();
    }
    this._updateRecordUI();
  },

  _updateRecordUI() {
    const btn = Utils.$('btn-record');
    const indicator = Utils.$('recording-indicator');
    if (btn) {
      const icon = btn.querySelector('.material-icons-round');
      const label = btn.querySelector('.action-label');
      if (icon) icon.textContent = this.isRecording ? 'stop_circle' : 'fiber_manual_record';
      if (label) label.textContent = this.isRecording ? 'Stop' : 'Yozish';
      btn.classList.toggle('recording', this.isRecording);
      btn.style.color = this.isRecording ? 'var(--red)' : '';
    }
    if (indicator) indicator.style.display = this.isRecording ? 'block' : 'none';
  },

  // ═══ VOLUME CONTROL ════════════════════════════════════════════════════
  setVolume(val) {
    if (this.remoteAudio) {
      this.remoteAudio.volume = Math.max(0, Math.min(1, val));
    }
  },

  // ═══ ACCOUNT MANAGEMENT ═════════════════════════════════════════════════
  saveAccount() {
    const name = document.getElementById('sip-name')?.value?.trim() || `Liniya ${this.sipAccounts.length + 1}`;
    const domain = document.getElementById('sip-domain')?.value?.trim();
    const extension = document.getElementById('sip-extension')?.value?.trim();
    const username = document.getElementById('sip-username')?.value?.trim() || extension;
    const password = document.getElementById('sip-password')?.value?.trim();
    const transport = document.getElementById('sip-transport')?.value || 'ws';
    const autoConnect = document.getElementById('sip-autoconnect')?.checked ?? true;

    if (!name || !domain || !extension || !password) {
      Utils.showToast('Barcha maydonlarni to\'ldiring!', 'error');
      return;
    }

    const newAccount = {
      id: 'sip_' + Date.now(),
      name,
      domain,
      extension,
      username,
      password,
      transport,
      autoConnect
    };

    this.sipAccounts.push(newAccount);
    localStorage.setItem('sip_accounts', JSON.stringify(this.sipAccounts));

    // Modalni yopish va formani tozalash
    const modal = document.getElementById('modal-add-sip');
    if (modal) modal.style.display = 'none';
    
    ['sip-name', 'sip-domain', 'sip-extension', 'sip-username', 'sip-password'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    Utils.showToast(`✅ ${name} — SIP liniya qo'shildi!`, 'success');
    this.renderAccounts();

    if (autoConnect) {
      setTimeout(() => this.connect(newAccount), 500);
    }
  },

  deleteAccount(id) {
    if (!confirm("Bu SIP raqamni o'chirmoqchimisiz?")) return;

    // Avval disconnect
    if (this.activeSipLines[id]) {
      try { this.activeSipLines[id].phone.disconnect(); } catch(e) {}
      delete this.activeSipLines[id];
    }

    this.sipAccounts = this.sipAccounts.filter(a => a.id !== id);
    localStorage.setItem('sip_accounts', JSON.stringify(this.sipAccounts));
    this.renderAccounts();
    Utils.showToast('SIP raqam o\'chirildi', 'info');
  },

  toggleAccount(id) {
    const acc = this.sipAccounts.find(a => a.id === id);
    if (!acc) return;

    if (this.activeSipLines[id] && this.activeSipLines[id].isRegistered) {
      // Disconnect
      try {
        this.activeSipLines[id].phone.disconnect();
      } catch(e) {}
      this.activeSipLines[id].isRegistered = false;
      this.renderAccounts();
      Utils.showToast(`${acc.name} — uzildi`, 'info');
    } else {
      this.connect(acc);
    }
  },

  // ═══ RENDER ACCOUNTS UI ═════════════════════════════════════════════════
  renderAccounts() {
    const container = document.getElementById('sip-accounts-list');
    if (!container) return;

    if (this.sipAccounts.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 30px; text-align: center;">
          <span class="material-icons-round" style="font-size: 40px; color: var(--text-muted);">headset_off</span>
          <p style="margin-top: 10px; color: var(--text-secondary);">SIP raqam ulanmagan</p>
          <p style="font-size: 12px; color: var(--text-muted);">Yuqoridagi "Yangi Liniya" tugmasini bosing</p>
        </div>`;
      this._updateGlobalStatus(false);
      return;
    }

    container.innerHTML = this.sipAccounts.map(acc => {
      const line = this.activeSipLines[acc.id];
      const isOnline = line && line.isRegistered;
      const statusIcon = isOnline ? 'check_circle' : 'cancel';
      const statusText = isOnline ? 'Ulangan' : 'Ulanmagan';
      const statusColor = isOnline ? 'var(--green)' : 'var(--red)';
      const btnText = isOnline ? 'Uzish' : 'Ulanish';
      const btnClass = isOnline ? 'btn-secondary' : 'btn-primary';
      const wsUrl = this._buildWsUrl(acc);

      return `
        <div class="sip-account-card" style="
          background: rgba(255,255,255,0.02); 
          padding: 16px; 
          border-radius: 12px; 
          margin-bottom: 12px; 
          border: 1px solid ${isOnline ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)'};
          transition: all 0.3s ease;
        ">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="material-icons-round" style="font-size:18px; color:${statusColor};">${statusIcon}</span>
              <strong style="font-size:14px;">${acc.name}</strong>
            </div>
            <span style="
              color:${statusColor}; 
              font-size:11px; 
              font-weight:600;
              padding: 3px 10px;
              border-radius: 20px;
              background: ${isOnline ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'};
            ">${statusText}</span>
          </div>
          
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:12px; color:var(--text-secondary); margin-bottom: 12px;">
            <div>🌐 Server: <span style="color:var(--text-primary)">${acc.domain}</span></div>
            <div>📞 Extension: <span style="color:var(--text-primary)">${acc.extension}</span></div>
            <div>🔌 Transport: <span style="color:var(--text-primary)">${acc.transport.toUpperCase()}</span></div>
            <div>🔗 WS: <span style="color:var(--text-muted); font-size:10px;">${wsUrl.substring(0, 30)}...</span></div>
          </div>
          
          <div style="display:flex; justify-content:flex-end; gap:8px;">
            <button class="btn-secondary btn-sm" onclick="window.SipClient.deleteAccount('${acc.id}')" 
              style="background:rgba(239,68,68,0.08); color:var(--red); border:1px solid rgba(239,68,68,0.15); font-size:12px;">
              <span class="material-icons-round" style="font-size:14px; vertical-align:middle; margin-right:3px;">delete</span>O'chirish
            </button>
            <button class="${btnClass} btn-sm" onclick="window.SipClient.toggleAccount('${acc.id}')" style="font-size:12px;">
              <span class="material-icons-round" style="font-size:14px; vertical-align:middle; margin-right:3px;">${isOnline ? 'link_off' : 'link'}</span>${btnText}
            </button>
          </div>
        </div>
      `;
    }).join('');

    const anyOnline = this.sipAccounts.some(acc => 
      this.activeSipLines[acc.id] && this.activeSipLines[acc.id].isRegistered
    );
    this._updateGlobalStatus(anyOnline);
  },

  _updateGlobalStatus(online) {
    const ind = document.getElementById('sip-indicator');
    const dot = document.getElementById('sip-status-dot');
    const txt = document.getElementById('sip-status-text');
    const ext = document.getElementById('sip-extension-text');

    const cls = online ? 'online' : 'offline';
    if (ind) ind.className = 'sip-dot ' + cls;
    if (dot) dot.className = 'status-dot ' + cls;
    if (txt) txt.textContent = online ? 'SIP Ulangan' : 'SIP Ulanmagan';
    
    if (ext) {
      const firstOnline = this.sipAccounts.find(acc => 
        this.activeSipLines[acc.id] && this.activeSipLines[acc.id].isRegistered
      );
      ext.textContent = firstOnline ? `Ext: ${firstOnline.extension}` : '—';
    }
  },

  // ═══ AUTO-CONNECT ═══════════════════════════════════════════════════════
  autoConnectAll() {
    // Refresh accounts from localStorage (login paytida yangi account qo'shilgan bo'lishi mumkin)
    this.sipAccounts = JSON.parse(localStorage.getItem('sip_accounts') || '[]');
    this.renderAccounts();
    
    console.log('[SIP] Auto-connecting', this.sipAccounts.filter(a => a.autoConnect).length, 'accounts...');
    this.sipAccounts.filter(a => a.autoConnect).forEach((acc, i) => {
      setTimeout(() => this.connect(acc), 500 + i * 1000);
    });
  }
};

window.SipClient = SipClient;
