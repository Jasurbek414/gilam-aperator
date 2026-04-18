/**
 * ═══════════════════════════════════════════════════════════════════════════
 * app.js — Application Entry Point & Lifecycle Controller
 * ═══════════════════════════════════════════════════════════════════════════
 */

document.addEventListener('DOMContentLoaded', () => {
  console.log('[App] Starting Gilam Operator...');

  // ═══ PHASE 1: KOMPONENTLARNI YUKLASH ═══════════════════════════════
  const root = document.getElementById('app-root');
  
  window.ComponentLoader.load('titlebar', root);
  window.ComponentLoader.load('login', root);
  
  // App screen = main row + statusbar (column)
  const appScreen = document.createElement('div');
  appScreen.id = 'app-screen';
  appScreen.className = 'screen';
  root.appendChild(appScreen);
  
  // Main row = sidebar + content (horizontal)
  const mainRow = document.createElement('div');
  mainRow.className = 'app-main-row';
  appScreen.appendChild(mainRow);
  
  // Sidebar navigation
  window.ComponentLoader.load('tab-bar', mainRow);
  
  // Content wrapper
  const contentWrap = document.createElement('div');
  contentWrap.id = 'content-wrap';
  contentWrap.className = 'content-wrap';
  mainRow.appendChild(contentWrap);
  
  window.ComponentLoader.load('tab-dialer', contentWrap);
  window.ComponentLoader.load('tabs-content', contentWrap);
  
  // Operator bar — app-screen ning pastida
  window.ComponentLoader.load('operator-bar', appScreen);
  
  // Overlays va modallar — root darajada (fixed position)
  window.ComponentLoader.load('call-overlays', root);
  window.ComponentLoader.load('modals', root);

  // ═══ PHASE 2: MODULLARNI BOSHLASH ══════════════════════════════════
  // Komponentlar DOM da bo'lgandan keyin init() chaqiriladi
  window.UI.init();
  window.SipClient.init();
  window.CRM.init();
  window.Settings.load();
  if (window.ChatManager) window.ChatManager.init();


  // ═══ LOGIN ════════════════════════════════════════════════════════════
  Utils.$('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = Utils.$('login-phone')?.value?.trim();
    const password = Utils.$('login-password')?.value?.trim();

    if (!phone || !password) {
      Utils.$('login-error').textContent = 'Telefon va parolni kiriting';
      Utils.$('login-error').style.display = 'block';
      return;
    }

    const btn = Utils.$('btn-login');
    btn.disabled = true;
    btn.textContent = 'Kirilmoqda...';
    Utils.$('login-error').style.display = 'none';

    try {
      const user = await window.Api.login(phone, password);
      Utils.showToast(`Xush kelibsiz, ${user.fullName || user.phone}!`, 'success');
      startApp(user);
    } catch (err) {
      Utils.$('login-error').textContent = err.message || 'Kirishda xatolik';
      Utils.$('login-error').style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Kirish <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-left:8px"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
    }
  });

  // ═══ CHECK EXISTING LOGIN ═════════════════════════════════════════════
  if (window.Api.config.token && window.Api.config.currentUser) {
    console.log('[App] Existing session found, auto-login');
    startApp(window.Api.config.currentUser);
  } else {
    window.UI.showScreen('login');
  }
});

// ═══ START APP ═════════════════════════════════════════════════════════════
function startApp(user) {
  window.UI.showScreen('app');

  // WebSocket ga ulanish (backend mavjud bo'lsagina)
  try {
    if (window.Api && window.Api.connectSocket && window.Api.config.token !== 'mock_token') {
      window.Api.connectSocket();
    }
  } catch(e) {
    console.warn('[App] Backend WebSocket ulanishi imkonsiz:', e.message);
  }

  // Chat WebSocket ga ulanish
  try {
    if (window.ChatManager && window.Api.config.token !== 'mock_token') {
      window.ChatManager.connect();
    }
  } catch(e) {
    console.warn('[App] Chat WebSocket ulanishi imkonsiz:', e.message);
  }

  // Operator info
  const nameEl = Utils.$('operator-name');
  if (nameEl) nameEl.textContent = user.fullName || user.phone || 'Operator';

  // Settings info
  const sName = Utils.$('settings-name');
  if (sName) sName.textContent = user.fullName || '—';
  
  const sPhone = Utils.$('settings-phone');
  if (sPhone) sPhone.textContent = user.phone || '—';
  
  const sRole = Utils.$('settings-role');
  if (sRole) sRole.textContent = user.role || '—';
  
  const sComp = Utils.$('settings-company');
  if (sComp) sComp.textContent = user.companyName || user.companyId || '—';

  // Auto-connect SIP liniyalar
  console.log('[App] Auto-connecting SIP accounts...');
  window.SipClient.autoConnectAll();

  // Audio qurilmalarni yuklash
  loadAudioDevices();

  // CRM ma'lumotlarni yuklash
  try {
    window.CRM.loadContacts();
  } catch(e) {
    console.warn('[App] CRM load failed:', e);
  }

  console.log('[App] ✅ Application started successfully');
}

// ═══ AUDIO DEVICES ════════════════════════════════════════════════════════
async function loadAudioDevices() {
  try {
    // Avval mikrofon ruxsatini so'rash
    await navigator.mediaDevices.getUserMedia({ audio: true });
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputSelect = Utils.$('audio-input');
    const outputSelect = Utils.$('audio-output');
    const ringSelect = Utils.$('audio-ring');

    if (inputSelect) inputSelect.innerHTML = '';
    if (outputSelect) outputSelect.innerHTML = '';
    if (ringSelect) ringSelect.innerHTML = '';

    devices.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Qurilma (${d.deviceId.substring(0, 8)})`;

      if (d.kind === 'audioinput' && inputSelect) {
        inputSelect.appendChild(opt.cloneNode(true));
      }
      if (d.kind === 'audiooutput') {
        if (outputSelect) outputSelect.appendChild(opt.cloneNode(true));
        if (ringSelect) ringSelect.appendChild(opt.cloneNode(true));
      }
    });

    console.log('[App] Audio devices loaded');
  } catch (e) {
    console.warn('[App] Audio devices error:', e);
  }
}

// ESC → chat modallarini yopish
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const imgModal = document.getElementById('chat-image-modal');
    if (imgModal && imgModal.style.display !== 'none') imgModal.style.display = 'none';
    const mapModal = document.getElementById('chat-map-modal');
    if (mapModal && mapModal.style.display !== 'none') mapModal.style.display = 'none';
  }
});
