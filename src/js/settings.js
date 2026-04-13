/**
 * ═══════════════════════════════════════════════════════════════════════════
 * settings.js — Settings Module
 * 
 * Sozlamalar sahifasi uchun barcha funksiyalar:
 * - Sozlamalarni localStorage da saqlash/o'qish
 * - Mikrofon test (waveform vizualizatsiya)
 * - Dinamik test (beep ovoz)
 * - Tarmoq diagnostikasi (API, WebSocket, PBX ping)
 * - Kesh tozalash
 * - Toggle sozlamalar (auto-answer, auto-record, notifications)
 * ═══════════════════════════════════════════════════════════════════════════
 */

const Settings = (() => {
  const STORAGE_KEY = 'gilam-operator-settings';

  // Standart sozlamalar
  const DEFAULTS = {
    autoAnswer: false,
    autoRecord: false,
    notifications: true,
    ringVolume: 80,
  };

  let _settings = { ...DEFAULTS };
  let _micStream = null;
  let _micAnimFrame = null;

  /**
   * LocalStorage dan sozlamalarni yuklash
   */
  function load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        _settings = { ...DEFAULTS, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('[Settings] Load error:', e);
    }
    _applyToUI();
    _bindEvents();
    _loadAudioDevices();
    console.log('[Settings] ✅ Loaded:', _settings);
  }

  /**
   * Sozlamalarni saqlash
   */
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_settings));
    } catch (e) {
      console.warn('[Settings] Save error:', e);
    }
  }

  /**
   * Sozlamalarni UI elementlarga qo'llash
   */
  function _applyToUI() {
    const el = (id) => document.getElementById(id);

    const autoAnswer = el('setting-auto-answer');
    if (autoAnswer) autoAnswer.checked = _settings.autoAnswer;

    const autoRecord = el('setting-auto-record');
    if (autoRecord) autoRecord.checked = _settings.autoRecord;

    const notifs = el('setting-notifications');
    if (notifs) notifs.checked = _settings.notifications;

    const vol = el('setting-ring-volume');
    if (vol) vol.value = _settings.ringVolume;

    const volLabel = el('ring-volume-label');
    if (volLabel) volLabel.textContent = _settings.ringVolume + '%';
  }

  /**
   * UI eventlarni tinglash
   */
  function _bindEvents() {
    const el = (id) => document.getElementById(id);

    // Toggle sozlamalar
    el('setting-auto-answer')?.addEventListener('change', (e) => {
      _settings.autoAnswer = e.target.checked;
      save();
      if (e.target.checked) {
        Utils.showToast('Avto-javob yoqildi', 'info');
      }
    });

    el('setting-auto-record')?.addEventListener('change', (e) => {
      _settings.autoRecord = e.target.checked;
      save();
      if (e.target.checked) {
        Utils.showToast('Avto-yozish yoqildi', 'info');
      }
    });

    el('setting-notifications')?.addEventListener('change', (e) => {
      _settings.notifications = e.target.checked;
      save();
      if (e.target.checked && Notification.permission !== 'granted') {
        Notification.requestPermission();
      }
    });

    // Volume slider
    el('setting-ring-volume')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      _settings.ringVolume = val;
      const label = el('ring-volume-label');
      if (label) label.textContent = val + '%';

      // Ringtone elementiga volume qo'llash
      const ringtone = document.getElementById('ringtone');
      if (ringtone) ringtone.volume = val / 100;
    });

    el('setting-ring-volume')?.addEventListener('change', () => {
      save();
    });

    // Logout
    el('btn-logout')?.addEventListener('click', () => {
      if (!confirm("Hisobdan chiqishni xohlaysizmi?")) return;
      if (window.SipClient) window.SipClient.disconnectAll();
      localStorage.removeItem('authToken');
      localStorage.removeItem('gilam-user');
      window.location.reload();
    });

    // Audio Selectors Persistence
    ['audio-input', 'audio-output', 'audio-ring'].forEach(id => {
      el(id)?.addEventListener('change', (e) => {
        _settings[id] = e.target.value;
        save();
        Utils.showToast('Audio moslama tanlandi', 'info');

        // Qo'ng'iroq (ringtone) dinamiki
        if (id === 'audio-ring') {
          const ringEl = document.getElementById('ringtone');
          if (ringEl && typeof ringEl.setSinkId === 'function' && e.target.value !== 'default') {
            ringEl.setSinkId(e.target.value).catch(err => console.warn('Ringtone sink error', err));
          }
        }
        
        // Umumiy suhbat dinamiki (SIP Call ovozi)
        if (id === 'audio-output') {
          const sipEl = document.getElementById('sipRemoteAudio');
          if (sipEl && typeof sipEl.setSinkId === 'function' && e.target.value !== 'default') {
            sipEl.setSinkId(e.target.value).catch(err => console.warn('SIP sink error', err));
          }
        }
      });
    });
  }

  /**
   * Sozlama qiymatini olish
   */
  function get(key) {
    return _settings[key];
  }

  // ───────────────────────────────────────────────────────
  // AUDIO DEVICES ENUMERATION
  // ───────────────────────────────────────────────────────
  async function _loadAudioDevices() {
    try {
      // Mikrofon ruxsatini so'rash (ro'yxatni olish uchun kerak)
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => stream.getTracks().forEach(t => t.stop())).catch(()=>{});
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      const audioInput = document.getElementById('audio-input');
      const audioOutput = document.getElementById('audio-output');
      const audioRing = document.getElementById('audio-ring');

      if (audioInput) audioInput.innerHTML = '';
      if (audioOutput) audioOutput.innerHTML = '';
      if (audioRing) audioRing.innerHTML = '';

      devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.text = device.label || `${device.kind} (${device.deviceId.slice(0,5)}...)`;

        if (device.kind === 'audioinput') {
          if (audioInput) audioInput.appendChild(option);
        } else if (device.kind === 'audiooutput') {
          if (audioOutput) audioOutput.appendChild(option);
          // Ringtone uchun ham xuddi shu dynamiklar
          if (audioRing) {
            const opt2 = option.cloneNode(true);
            audioRing.appendChild(opt2);
          }
        }
      });

      // Agar bo'sh qolsa standartni qo'yish
      if (audioInput && audioInput.options.length === 0) audioInput.innerHTML = '<option value="default">Standart mikrofon</option>';
      if (audioOutput && audioOutput.options.length === 0) audioOutput.innerHTML = '<option value="default">Standart dinamik</option>';
      if (audioRing && audioRing.options.length === 0) audioRing.innerHTML = '<option value="default">Standart dinamik</option>';

      // Saqlangan qiymatlarni tanlash
      if (audioInput && _settings['audio-input']) audioInput.value = _settings['audio-input'];
      if (audioOutput && _settings['audio-output']) {
        audioOutput.value = _settings['audio-output'];
        const sipEl = document.getElementById('sipRemoteAudio');
        if (sipEl && typeof sipEl.setSinkId === 'function' && audioOutput.value !== 'default') {
          sipEl.setSinkId(audioOutput.value).catch(err => console.warn('Init SIP sink err:', err));
        }
      }
      
      if (audioRing && _settings['audio-ring']) {
        audioRing.value = _settings['audio-ring'];
        const ringEl = document.getElementById('ringtone');
        if (ringEl && typeof ringEl.setSinkId === 'function' && audioRing.value !== 'default') {
          ringEl.setSinkId(audioRing.value).catch(err => console.warn('Init ringtone sink err:', err));
        }
      }

    } catch(err) {
      console.warn('[Settings] Audio devices load error:', err);
    }
  }

  // ───────────────────────────────────────────────────────
  // MIKROFON TEST
  // ───────────────────────────────────────────────────────
  async function testMic() {
    const btn = document.getElementById('btn-test-mic');
    const meter = document.getElementById('mic-meter');
    const bar = document.getElementById('mic-bar');

    // Agar allaqachon ishlayotgan bo'lsa — to'xtatish
    if (_micStream) {
      _stopMicTest();
      return;
    }

    try {
      btn.classList.add('active');
      btn.innerHTML = '<span class="material-icons-round">stop</span> To\'xtat';
      meter.style.display = 'block';

      // Tanlangan mikrofonni olish
      const selectedMicId = get('audio-input');
      const constraints = { audio: true };
      
      if (selectedMicId && selectedMicId !== 'default') {
        constraints.audio = { deviceId: { exact: selectedMicId } };
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      _micStream = stream;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      function draw() {
        if (!_micStream) return;
        _micAnimFrame = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const level = Math.min(100, Math.round((avg / 128) * 100));
        bar.style.width = level + '%';

        // Rang o'zgarishi
        if (level > 60) {
          bar.style.background = '#22c55e';
        } else if (level > 30) {
          bar.style.background = '#6366f1';
        } else {
          bar.style.background = '#555570';
        }
      }
      draw();

      // 10 sekunddan keyin avtomatik to'xtatish
      setTimeout(() => {
        if (_micStream) _stopMicTest();
      }, 10000);

    } catch (err) {
      console.error('[Settings] Mic test error:', err);
      Utils.showToast('Mikrofonga ruxsat berilmadi', 'error');
      _stopMicTest();
    }
  }

  function _stopMicTest() {
    if (_micStream) {
      _micStream.getTracks().forEach(t => t.stop());
      _micStream = null;
    }
    if (_micAnimFrame) {
      cancelAnimationFrame(_micAnimFrame);
      _micAnimFrame = null;
    }
    const btn = document.getElementById('btn-test-mic');
    const meter = document.getElementById('mic-meter');
    if (btn) {
      btn.classList.remove('active');
      btn.innerHTML = '<span class="material-icons-round">graphic_eq</span> Test';
    }
    if (meter) meter.style.display = 'none';
  }

  // ───────────────────────────────────────────────────────
  // DINAMIK TEST
  // ───────────────────────────────────────────────────────
  async function testSpeaker() {
    const btn = document.getElementById('btn-test-speaker');
    btn.classList.add('active');
    btn.innerHTML = '<span class="material-icons-round">stop</span> ...';

    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      const selectedSpeakerId = get('audio-output');
      if (selectedSpeakerId && selectedSpeakerId !== 'default') {
        if (typeof audioCtx.setSinkId === 'function') {
          await audioCtx.setSinkId(selectedSpeakerId);
        }
      }

      // 440Hz beep ovoz (A4 nota)
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.8);

      setTimeout(() => {
        btn.classList.remove('active');
        btn.innerHTML = '<span class="material-icons-round">play_arrow</span> Test';
        Utils.showToast('Dinamik test muvaffaqiyatli (Moslama tanlandi)', 'success');
      }, 900);
    } catch (err) {
      console.error('[Settings] Speaker test error:', err);
      btn.classList.remove('active');
      btn.innerHTML = '<span class="material-icons-round">play_arrow</span> Test';
      Utils.showToast('Dinamik test xatosi', 'error');
    }
  }

  // ───────────────────────────────────────────────────────
  // TARMOQ DIAGNOSTIKASI
  // ───────────────────────────────────────────────────────
  async function runNetTest() {
    const btn = document.getElementById('btn-net-test');
    const apiStatus = document.getElementById('net-api-status');
    const wsStatus = document.getElementById('net-ws-status');
    const pbxStatus = document.getElementById('net-pbx-status');

    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-round">hourglass_empty</span> Tekshirilmoqda...';
    
    // Reset
    [apiStatus, wsStatus, pbxStatus].forEach(el => {
      if (el) {
        el.textContent = '...';
        el.className = 's-net-status';
      }
    });

    // 1. API Test
    try {
      const start = Date.now();
      const apiUrl = window.Api ? window.Api.config.API_BASE : 'https://gilam-api.ecos.uz';
      
      const abortCont = new AbortController();
      const timeoutId = setTimeout(() => abortCont.abort(), 4000);

      // Tarmoq xatosi bo'lsa fetch Error qaytaradi va catch bloqqa o'tadi
      await fetch(apiUrl + '/api/', { 
        method: 'GET',
        signal: abortCont.signal
      });
      clearTimeout(timeoutId);

      const ping = Date.now() - start;
      if (apiStatus) {
        apiStatus.textContent = `✓ ${ping}ms`;
        apiStatus.classList.add('s-net-ok');
        apiStatus.classList.remove('s-net-fail');
      }
    } catch (e) {
      if (apiStatus) {
        apiStatus.textContent = "✗ Ulanib bo'lmadi";
        apiStatus.classList.add('s-net-fail');
        apiStatus.classList.remove('s-net-ok');
      }
    }

    // 2. WebSocket Test
    if (window.Api && window.Api.socket && window.Api.socket.connected) {
      if (wsStatus) {
        wsStatus.textContent = '✓ Ulangan';
        wsStatus.classList.add('s-net-ok');
      }
    } else {
      if (wsStatus) {
        wsStatus.textContent = '✗ Ulanmagan';
        wsStatus.classList.add('s-net-fail');
      }
    }

    // 3. PBX Test (SIP)
    const sipAccounts = window.SipClient?.getAccounts?.() || [];
    let sipConnected = false;
    if (sipAccounts.length > 0) {
      sipConnected = sipAccounts.some(a => a.status === 'connected' || a.status === 'registered');
    }
    if (pbxStatus) {
      if (sipConnected) {
        pbxStatus.textContent = '✓ Registered';
        pbxStatus.classList.add('s-net-ok');
      } else if (sipAccounts.length > 0) {
        pbxStatus.textContent = '✗ Ulanmagan';
        pbxStatus.classList.add('s-net-fail');
      } else {
        pbxStatus.textContent = '— SIP yo\'q';
        pbxStatus.classList.add('s-net-warn');
      }
    }

    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-round">speed</span> Ulanishni tekshirish';
  }

  // ───────────────────────────────────────────────────────
  // KESH TOZALASH
  // ───────────────────────────────────────────────────────
  function clearCache() {
    if (!confirm('Haqiqatan ham barcha saqlangan ma\'lumotlarni o\'chirasizmi?')) return;

    try {
      localStorage.clear();
      sessionStorage.clear();
      _settings = { ...DEFAULTS };
      _applyToUI();
      Utils.showToast('Kesh tozalandi. Dastur qayta yuklanadi...', 'success');
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (e) {
      Utils.showToast('Kesh tozalashda xatolik', 'error');
    }
  }

  // Public API
  return {
    load,
    save,
    get,
    testMic,
    testSpeaker,
    runNetTest,
    clearCache,
  };
})();

window.Settings = Settings;
