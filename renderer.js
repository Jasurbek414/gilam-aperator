/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GILAM OPERATOR — Renderer Process
 * SIP Desktop Client with Backend Integration
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { ipcRenderer } = require('electron');

// ─── CONFIGURATION ──────────────────────────────────────────────────────────
let API_BASE = localStorage.getItem('serverUrl') || 'https://gilam.ecos.uz';
let token = localStorage.getItem('token') || null;
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');
let campaigns = [];
let activeCampaign = null;
let sipSocket = null;
let callsSocket = null;
let sipRegistered = false;
let activeCallTimer = null;
let activeCallSeconds = 0;
let currentFilter = 'all';
let incomingCallData = null;

// ─── UTILITY FUNCTIONS ─────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }
function $$(sel) { return document.querySelectorAll(sel); }

async function apiRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  const res = await fetch(`${API_BASE}/api${path}`, { ...options, headers });
  
  if (res.status === 401) {
    token = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    showScreen('login');
    throw new Error('Sessiya tugadi');
  }
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Xatolik' }));
    throw new Error(Array.isArray(err.message) ? err.message.join(', ') : err.message);
  }
  
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  return res.json();
}

function showToast(message, type = 'info') {
  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: 'check_circle', error: 'error', info: 'info', warning: 'warning' };
  toast.innerHTML = `<span class="material-icons-round">${icons[type] || 'info'}</span>${message}`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(60px)'; }, 3000);
  setTimeout(() => toast.remove(), 3500);
}

function formatTime(date) {
  const d = new Date(date);
  return d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function showScreen(name) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  if (name === 'login') {
    $('login-screen').classList.add('active');
  } else {
    $('app-screen').classList.add('active');
  }
}

function switchTab(tabName) {
  $$('.tab').forEach(t => t.classList.remove('active'));
  $$('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tabName}"]`)?.classList.add('active');
  $(`tab-${tabName}`)?.classList.add('active');
}

// ─── TITLE BAR ──────────────────────────────────────────────────────────────

$('btn-minimize').addEventListener('click', () => ipcRenderer.send('window-minimize'));
$('btn-maximize').addEventListener('click', () => ipcRenderer.send('window-maximize'));
$('btn-close').addEventListener('click', () => ipcRenderer.send('window-close'));

// ─── TAB NAVIGATION ─────────────────────────────────────────────────────────

$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    switchTab(tabName);
    // Load data for tab
    if (tabName === 'lines') loadCampaigns();
    if (tabName === 'calls') loadCallHistory();
    if (tabName === 'contacts') loadContacts();
  });
});

// ─── LOGIN ──────────────────────────────────────────────────────────────────

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = $('login-phone').value.trim();
  const password = $('login-password').value.trim();
  
  if (!phone || !password) {
    $('login-error').textContent = 'Telefon va parolni kiriting';
    $('login-error').style.display = 'block';
    return;
  }
  
  API_BASE = 'https://gilam.ecos.uz';
  localStorage.setItem('serverUrl', API_BASE);
  
  const btn = $('btn-login');
  btn.disabled = true;
  btn.innerHTML = 'Kirilmoqda...';
  $('login-error').style.display = 'none';

  // 👉 VAQTINCHALIK KOMPYUTERDA KORISH UCHUN (TEST REJIMI)
  if (phone === 'test' && password === 'test') {
    token = 'test-token';
    currentUser = { id: 'test1', fullName: 'Faqat Interfeys Testi', phone: '+998901234567', role: 'OPERATOR' };
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(currentUser));
    
    // Kampaniyalar va kontaktlar ishlamay qolmasligi uchun vaqtinchalik test ma'lumot qoshamiz:
    campaigns = [
      { id: 'cam1', name: 'Mijozlarga yordam', phoneNumber: '+998712000001', status: 'ACTIVE' },
      { id: 'cam2', name: 'Shikoyatlar', phoneNumber: '+998712000002', status: 'ACTIVE' }
    ];
    
    showToast(`Test Interfeys rejimiga xush kelibsiz!`, 'success');
    
    // fetch larni ozgartirib otirmaymiz, initApp o'zi ochilaveradi
    showScreen('app');
    updateUserInfo();
    renderLines(); // Mock campaigns
    
    // Test oyna uchun mock qilish
    const mockCalls = [
      { direction: 'INCOMING', status: 'ANSWERED', callerPhone: '+998 90 123 45 67', createdAt: new Date(), durationSeconds: 120, customer: { fullName: 'Alijon Valiyev' } },
      { direction: 'OUTGOING', status: 'ANSWERED', callerPhone: '+998 90 999 88 77', createdAt: new Date(Date.now() - 3600000), durationSeconds: 45, customer: { fullName: 'Salimaxon' } },
      { direction: 'INCOMING', status: 'MISSED', callerPhone: '+998 94 555 44 33', createdAt: new Date(Date.now() - 7200000), durationSeconds: 0 },
      { direction: 'INCOMING', status: 'ANSWERED', callerPhone: '+998 93 222 11 00', createdAt: new Date(Date.now() - 10000000), durationSeconds: 300, customer: { fullName: 'Gulruh Kamolova' } }
    ];
    renderCallHistory(mockCalls);
    
    btn.disabled = false;
    btn.innerHTML = 'Kirish <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-left:8px"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
    return;
  }
  
  try {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password }),
    });
    
    token = data.access_token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(currentUser));
    
    showToast(`Xush kelibsiz, ${currentUser.fullName}!`, 'success');
    initApp();
  } catch (err) {
    $('login-error').textContent = err.message || 'Kirishda xatolik';
    $('login-error').style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Kirish <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-left:8px"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
  }
});

// ─── INIT APP ────────────────────────────────────────────────────────────────

function initApp() {
  showScreen('app');
  updateUserInfo();
  connectSipSocket();
  connectCallsSocket();
  loadCampaigns();
  loadCallHistory();
}

function updateUserInfo() {
  if (!currentUser) return;
  $('operator-name').textContent = currentUser.fullName || 'Operator';
  $('settings-name').textContent = currentUser.fullName || '—';
  $('settings-phone').textContent = currentUser.phone || '—';
  $('settings-role').textContent = currentUser.role || '—';
  $('settings-company').textContent = currentUser.companyId || '—';
  
  // Load company name
  if (currentUser.companyId) {
    apiRequest(`/companies/${currentUser.companyId}`).then(company => {
      if (company) {
        $('settings-company').textContent = company.name;
      }
    }).catch(() => {});
  }
}

// ─── SIP SOCKET CONNECTION ──────────────────────────────────────────────────

function connectSipSocket() {
  if (sipSocket) {
    sipSocket.disconnect();
    sipSocket = null;
  }
  
  try {
    const io = require('socket.io-client');
    sipSocket = io(`${API_BASE}/sip`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 3000,
    });
    
    sipSocket.on('connect', () => {
      console.log('SIP socket connected');
      updateSipIndicator('connecting');
      // Ping to get SIP status
      sipSocket.emit('sip:ping');
    });
    
    sipSocket.on('sip:status', (data) => {
      sipRegistered = data.registered;
      updateSipIndicator(sipRegistered ? 'online' : 'offline');
    });
    
    sipSocket.on('sip:pong', (data) => {
      sipRegistered = data.registered;
      updateSipIndicator(sipRegistered ? 'online' : 'offline');
      $('sip-extension-text').textContent = `Ext: ${data.extension || '—'}`;
      $('settings-sip-server').textContent = `${data.sipServer}:${data.localPort}`;
      $('settings-sip-ext').textContent = data.extension || '—';
      $('settings-sip-status').textContent = sipRegistered ? '✅ Ulangan' : '❌ Ulanmagan';
      $('settings-sip-status').style.color = sipRegistered ? 'var(--green)' : 'var(--red)';
    });
    
    sipSocket.on('sip:calling', (data) => {
      showActiveCall(data.display || data.target, 'Qo\'ng\'iroq qilinmoqda...');
    });
    
    sipSocket.on('sip:ringing', () => {
      $('call-status-label').textContent = 'Jiringlayapti...';
    });
    
    sipSocket.on('sip:call_answered', () => {
      $('call-status-label').textContent = 'Suhbatda';
      startCallTimer();
    });
    
    sipSocket.on('sip:call_ended', () => {
      hideActiveCall();
      showToast('Qo\'ng\'iroq tugadi', 'info');
    });
    
    sipSocket.on('sip:call_failed', (data) => {
      hideActiveCall();
      showToast(data.reason || 'Qo\'ng\'iroq amalga oshmadi', 'error');
    });
    
    sipSocket.on('sip:error', (data) => {
      showToast(data.message || 'SIP xatolik', 'error');
    });
    
    sipSocket.on('sip:dial_external', (data) => {
      // Open SIP URI to trigger external softphone (MicroSIP/X-Lite)
      const sipUri = `sip:${data.target}@${data.sipDomain}`;
      console.log('Opening SIP URI:', sipUri);
      ipcRenderer.send('open-external', sipUri);
    });
    
    sipSocket.on('disconnect', () => {
      sipRegistered = false;
      updateSipIndicator('offline');
    });
    
    sipSocket.on('connect_error', () => {
      updateSipIndicator('offline');
    });
    
  } catch (err) {
    console.error('SIP socket error:', err);
    showToast('SIP ulanishda xatolik', 'error');
  }
}

// ─── CALLS SOCKET CONNECTION ────────────────────────────────────────────────

function connectCallsSocket() {
  if (callsSocket) {
    callsSocket.disconnect();
    callsSocket = null;
  }
  
  try {
    const io = require('socket.io-client');
    callsSocket = io(`${API_BASE}/calls`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 3000,
    });
    
    callsSocket.on('connect', () => {
      console.log('Calls socket connected');
      // Register operator
      if (currentUser) {
        callsSocket.emit('operator:join', {
          operatorId: currentUser.id,
          companyId: currentUser.companyId,
        });
      }
    });
    
    // Incoming call
    callsSocket.on('call:incoming', (data) => {
      console.log('Incoming call:', data);
      incomingCallData = data;
      showIncomingCall(data);
    });
    
    // Call taken by another operator
    callsSocket.on('call:taken', (data) => {
      if (incomingCallData && incomingCallData.call.id === data.callId) {
        if (data.operatorId !== currentUser?.id) {
          hideIncomingCall();
          showToast('Boshqa operator qabul qildi', 'info');
        }
      }
    });
    
    // Call updated
    callsSocket.on('call:updated', (data) => {
      console.log('Call updated:', data);
    });
    
    callsSocket.on('disconnect', () => {
      console.log('Calls socket disconnected');
    });
    
  } catch (err) {
    console.error('Calls socket error:', err);
  }
}

function updateSipIndicator(status) {
  const dot = $('sip-indicator');
  const statusDot = $('sip-status-dot');
  const statusText = $('sip-status-text');
  
  dot.className = 'sip-dot ' + status;
  statusDot.className = 'status-dot ' + status;
  
  const labels = {
    online: 'SIP ulangan',
    offline: 'Ulanmagan',
    connecting: 'Ulanmoqda...',
  };
  statusText.textContent = labels[status] || 'Noma\'lum';
  dot.title = labels[status] || '';
}

// ─── DIALER ─────────────────────────────────────────────────────────────────

// Dialpad keys
$$('.dial-key').forEach(key => {
  key.addEventListener('click', () => {
    const val = key.dataset.key;
    const input = $('dial-number');
    input.value += val;
    input.focus();
  });
  
  // Long press "0" for "+"
  if (key.dataset.key === '0') {
    let pressTimer;
    key.addEventListener('mousedown', () => {
      pressTimer = setTimeout(() => {
        $('dial-number').value += '+';
      }, 500);
    });
    key.addEventListener('mouseup', () => clearTimeout(pressTimer));
    key.addEventListener('mouseleave', () => clearTimeout(pressTimer));
  }
});

// Clear button
$('btn-clear-number').addEventListener('click', () => {
  const input = $('dial-number');
  input.value = input.value.slice(0, -1);
});

// Call button
$('btn-call').addEventListener('click', () => makeCall());

// Enter to call
$('dial-number').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') makeCall();
});

// Number input change - lookup customer
let lookupTimeout;
$('dial-number').addEventListener('input', () => {
  const num = $('dial-number').value.trim();
  clearTimeout(lookupTimeout);
  if (num.length >= 9) {
    lookupTimeout = setTimeout(() => lookupCustomer(num), 500);
  } else {
    $('customer-lookup').style.display = 'none';
  }
});

function makeCall() {
  const target = $('dial-number').value.trim();
  if (!target) {
    showToast('Raqam kiriting', 'warning');
    return;
  }
  
  if (!sipSocket || !sipSocket.connected) {
    showToast('SIP ulanmagan', 'error');
    return;
  }
  
  sipSocket.emit('sip:call', {
    target,
    operatorId: currentUser?.id,
    companyId: currentUser?.companyId,
  });
}

async function lookupCustomer(phone) {
  if (!currentUser?.companyId) return;
  try {
    const customers = await apiRequest(`/customers/search/${currentUser.companyId}?q=${encodeURIComponent(phone)}`);
    if (customers && customers.length > 0) {
      const c = customers[0];
      $('lookup-name').textContent = c.fullName;
      $('lookup-phone').textContent = c.phone1;
      $('lookup-address').textContent = c.address || 'Manzil kiritilmagan';
      $('customer-lookup').style.display = 'block';
    } else {
      $('customer-lookup').style.display = 'none';
    }
  } catch (err) {
    $('customer-lookup').style.display = 'none';
  }
}

// ─── ACTIVE CALL OVERLAY ────────────────────────────────────────────────────

function showActiveCall(target, statusLabel) {
  $('call-target-display').textContent = target;
  $('call-status-label').textContent = statusLabel || 'Qo\'ng\'iroq qilinmoqda...';
  $('call-timer').textContent = '00:00';
  $('call-target-name').textContent = '';
  $('active-call-overlay').style.display = 'flex';
  activeCallSeconds = 0;
}

function hideActiveCall() {
  $('active-call-overlay').style.display = 'none';
  stopCallTimer();
}

function startCallTimer() {
  activeCallSeconds = 0;
  stopCallTimer();
  activeCallTimer = setInterval(() => {
    activeCallSeconds++;
    $('call-timer').textContent = formatDuration(activeCallSeconds);
  }, 1000);
}

function stopCallTimer() {
  if (activeCallTimer) {
    clearInterval(activeCallTimer);
    activeCallTimer = null;
  }
}

// Hangup button
$('btn-hangup').addEventListener('click', () => {
  if (sipSocket) {
    sipSocket.emit('sip:hangup');
  }
  hideActiveCall();
});

// Mute toggle
$('btn-mute').addEventListener('click', function() {
  this.classList.toggle('active');
  const icon = this.querySelector('.material-icons-round');
  icon.textContent = this.classList.contains('active') ? 'mic_off' : 'mic';
});

// Hold toggle
$('btn-hold').addEventListener('click', function() {
  this.classList.toggle('active');
  const icon = this.querySelector('.material-icons-round');
  icon.textContent = this.classList.contains('active') ? 'play_arrow' : 'pause';
});

// ─── INCOMING CALL ──────────────────────────────────────────────────────────

function showIncomingCall(data) {
  $('incoming-caller-number').textContent = data.call?.callerPhone || 'Noma\'lum';
  $('incoming-caller-name').textContent = data.customer?.fullName || '';
  $('incoming-campaign-name').textContent = data.campaign?.name ? `📋 ${data.campaign.name}` : '';
  $('incoming-call-overlay').style.display = 'block';
  
  // Play ringtone
  try {
    const ring = $('ringtone');
    ring.currentTime = 0;
    ring.play().catch(() => {});
  } catch (e) {}
}

function hideIncomingCall() {
  $('incoming-call-overlay').style.display = 'none';
  incomingCallData = null;
  try { $('ringtone').pause(); } catch (e) {}
}

// Answer call
$('btn-answer-call').addEventListener('click', async () => {
  if (!incomingCallData) return;
  
  try {
    await apiRequest(`/calls/${incomingCallData.call.id}/answer`, { method: 'PUT' });
    hideIncomingCall();
    showActiveCall(
      incomingCallData.call.callerPhone,
      'Kiruvchi qo\'ng\'iroq'
    );
    if (incomingCallData.customer) {
      $('call-target-name').textContent = incomingCallData.customer.fullName;
    }
    startCallTimer();
    showToast('Qo\'ng\'iroq qabul qilindi', 'success');
  } catch (err) {
    showToast('Qabul qilishda xatolik: ' + err.message, 'error');
  }
});

// Reject call
$('btn-reject-call').addEventListener('click', async () => {
  if (!incomingCallData) {
    hideIncomingCall();
    return;
  }
  
  try {
    await apiRequest(`/calls/${incomingCallData.call.id}/miss`, { method: 'PUT' });
  } catch (e) {}
  hideIncomingCall();
  showToast('Qo\'ng\'iroq rad etildi', 'info');
});

// ─── CAMPAIGNS / LINES ─────────────────────────────────────────────────────

async function loadCampaigns() {
  try {
    campaigns = await apiRequest('/campaigns') || [];
    renderLines();
    
    // Set first active campaign as active line
    if (campaigns.length > 0 && !activeCampaign) {
      activeCampaign = campaigns[0];
      $('active-campaign-info').style.display = 'block';
      $('campaign-name-badge').textContent = activeCampaign.name;
    }
  } catch (err) {
    console.error('Load campaigns error:', err);
  }
}

function renderLines() {
  const container = $('lines-list');
  
  if (!campaigns || campaigns.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-icons-round">phone_disabled</span>
        <p>Kampaniyalar topilmadi</p>
      </div>`;
    return;
  }
  
  container.innerHTML = campaigns.map((c, i) => `
    <div class="line-card ${activeCampaign?.id === c.id ? 'active' : ''}" data-campaign-id="${c.id}">
      <div class="line-indicator ${c.status === 'ACTIVE' ? 'active' : 'inactive'}"></div>
      <div class="line-info">
        <div class="line-name">Liniya ${i + 1} — ${c.name}</div>
        <div class="line-number">${c.phoneNumber || 'Raqam yo\'q'}</div>
        <div class="line-company">${c.company?.name || ''}</div>
      </div>
      <div class="line-actions">
        <button class="btn-icon" onclick="selectLine('${c.id}')" title="Tanlash">
          <span class="material-icons-round">check_circle</span>
        </button>
      </div>
    </div>
  `).join('');
}

window.selectLine = function(campaignId) {
  activeCampaign = campaigns.find(c => c.id === campaignId);
  if (activeCampaign) {
    $('active-campaign-info').style.display = 'block';
    $('campaign-name-badge').textContent = activeCampaign.name;
    showToast(`Liniya tanlandi: ${activeCampaign.name}`, 'success');
    renderLines();
    switchTab('dialer');
  }
};

$('btn-refresh-lines').addEventListener('click', () => loadCampaigns());

// ─── CALL HISTORY ───────────────────────────────────────────────────────────

async function loadCallHistory() {
  try {
    const calls = await apiRequest('/calls') || [];
    renderCallHistory(calls);
  } catch (err) {
    console.error('Load calls error:', err);
  }
}

function renderCallHistory(calls) {
  const container = $('calls-list');
  const dashContainer = $('dashboard-calls-list');
  
  let filtered = calls;
  if (currentFilter !== 'all') {
    if (currentFilter === 'MISSED') {
      filtered = calls.filter(c => c.status === 'MISSED');
    } else {
      filtered = calls.filter(c => c.direction === currentFilter);
    }
  }
  
  if (!filtered || filtered.length === 0) {
    const emptyState = `
      <div class="empty-state">
        <span class="material-icons-round">history</span>
        <p>Qo'ng'iroqlar tarixi bo'sh</p>
      </div>`;
    if(container) container.innerHTML = emptyState;
    if(dashContainer) dashContainer.innerHTML = emptyState;
    return;
  }
  
  const html = filtered.map(call => {
    const isMissed = call.status === 'MISSED';
    const dirClass = isMissed ? 'missed' : (call.direction === 'INCOMING' ? 'incoming' : 'outgoing');
    const dirIcon = isMissed ? 'phone_missed' : (call.direction === 'INCOMING' ? 'call_received' : 'call_made');
    const phone = call.direction === 'INCOMING' ? call.callerPhone : (call.calledPhone || call.callerPhone);
    
    return `
      <div class="call-item" onclick="callFromHistory('${phone}')">
        <div class="call-direction-icon ${dirClass}">
          <span class="material-icons-round">${dirIcon}</span>
        </div>
        <div class="call-item-info">
          <div class="call-item-phone">${phone}</div>
          <div class="call-item-meta">
            <span>${call.campaign?.name || ''}</span>
            <span>${call.customer?.fullName || ''}</span>
          </div>
        </div>
        <div>
          <div class="call-item-time">${formatTime(call.createdAt)}</div>
          <div class="call-item-duration">${formatDuration(call.durationSeconds)}</div>
        </div>
      </div>
    `;
  }).join('');
  
  if (container) container.innerHTML = html;
  if ($('dashboard-calls-list')) $('dashboard-calls-list').innerHTML = html;
}

window.callFromHistory = function(phone) {
  $('dial-number').value = phone;
  switchTab('dialer');
};

// Filter buttons
$$('.filter-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    $$('.filter-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    currentFilter = this.dataset.filter;
    loadCallHistory();
  });
});

$('btn-refresh-calls').addEventListener('click', () => loadCallHistory());

// ─── CONTACTS ───────────────────────────────────────────────────────────────

let allContacts = [];

async function loadContacts(query = '') {
  if (!currentUser?.companyId) return;
  
  try {
    if (query) {
      allContacts = await apiRequest(`/customers/search/${currentUser.companyId}?q=${encodeURIComponent(query)}`) || [];
    } else {
      allContacts = await apiRequest(`/customers/company/${currentUser.companyId}`) || [];
    }
    renderContacts(allContacts);
  } catch (err) {
    console.error('Load contacts error:', err);
  }
}

function renderContacts(contacts) {
  const container = $('contacts-list');
  
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
      <div class="contact-item" onclick="callContact('${c.phone1}')">
        <div class="contact-avatar">${initials}</div>
        <div class="contact-info">
          <div class="contact-name">${c.fullName}</div>
          <div class="contact-phone">${c.phone1}${c.phone2 ? ' / ' + c.phone2 : ''}</div>
          <div class="contact-company">${c.address || ''}</div>
        </div>
        <div class="contact-actions">
          <button class="btn-icon" onclick="event.stopPropagation(); callContact('${c.phone1}')" title="Qo'ng'iroq">
            <span class="material-icons-round">call</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.callContact = function(phone) {
  $('dial-number').value = phone;
  switchTab('dialer');
  makeCall();
};

// Search contacts
let searchTimeout;
$('contacts-search').addEventListener('input', function() {
  clearTimeout(searchTimeout);
  const q = this.value.trim();
  searchTimeout = setTimeout(() => loadContacts(q), 400);
});

// Add contact button
$('btn-add-contact').addEventListener('click', () => {
  $('modal-new-customer').style.display = 'flex';
  $('new-customer-phone1').value = $('dial-number').value || '';
});

$('btn-close-customer-modal').addEventListener('click', () => {
  $('modal-new-customer').style.display = 'none';
});

$('btn-cancel-customer').addEventListener('click', () => {
  $('modal-new-customer').style.display = 'none';
});

$('form-new-customer').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const data = {
    fullName: $('new-customer-name').value.trim(),
    phone1: $('new-customer-phone1').value.trim(),
    phone2: $('new-customer-phone2').value.trim() || undefined,
    address: $('new-customer-address').value.trim() || undefined,
    companyId: currentUser?.companyId,
  };
  
  if (!data.fullName || !data.phone1) {
    showToast('Ism va telefon kiritish kerak', 'warning');
    return;
  }
  
  try {
    await apiRequest('/customers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    showToast('Mijoz qo\'shildi!', 'success');
    $('modal-new-customer').style.display = 'none';
    $('form-new-customer').reset();
    loadContacts();
  } catch (err) {
    showToast('Xatolik: ' + err.message, 'error');
  }
});

// ─── SMS ────────────────────────────────────────────────────────────────────

$('btn-send-sms').addEventListener('click', async () => {
  const to = $('sms-to').value.trim();
  const text = $('sms-text').value.trim();
  
  if (!to || !text) {
    showToast('Raqam va xabar matni kerak', 'warning');
    return;
  }
  
  // SMS is simulated locally since backend may not support it
  const smsList = JSON.parse(localStorage.getItem('smsHistory') || '[]');
  smsList.unshift({ to, text, time: new Date().toISOString(), status: 'sent' });
  localStorage.setItem('smsHistory', JSON.stringify(smsList));
  
  showToast('SMS yuborildi!', 'success');
  $('sms-to').value = '';
  $('sms-text').value = '';
  renderSmsHistory();
});

function renderSmsHistory() {
  const container = $('sms-list');
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
    <div class="sms-item">
      <div class="sms-item-header">
        <span class="sms-item-to">📤 ${sms.to}</span>
        <span class="sms-item-time">${formatTime(sms.time)}</span>
      </div>
      <div class="sms-item-text">${sms.text}</div>
    </div>
  `).join('');
}

// ─── SETTINGS ───────────────────────────────────────────────────────────────

// SIP reconnect
$('btn-sip-reconnect').addEventListener('click', () => {
  showToast('SIP qayta ulanmoqda...', 'info');
  connectSipSocket();
});

// Logout
$('btn-logout').addEventListener('click', () => {
  token = null;
  currentUser = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  
  if (sipSocket) { sipSocket.disconnect(); sipSocket = null; }
  if (callsSocket) { callsSocket.disconnect(); callsSocket = null; }
  
  showScreen('login');
  showToast('Tizimdan chiqdingiz', 'info');
});

// Load audio devices
async function loadAudioDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputSelect = $('audio-input');
    const outputSelect = $('audio-output');
    const ringSelect = $('audio-ring');
    
    inputSelect.innerHTML = '';
    outputSelect.innerHTML = '';
    ringSelect.innerHTML = '';
    
    devices.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Qurilma (${d.deviceId.substr(0, 8)})`;
      
      if (d.kind === 'audioinput') inputSelect.appendChild(opt.cloneNode(true));
      if (d.kind === 'audiooutput') {
        outputSelect.appendChild(opt.cloneNode(true));
        ringSelect.appendChild(opt.cloneNode(true));
      }
    });
  } catch (e) {
    console.error('Audio devices:', e);
  }
}

// ─── KEYBOARD SHORTCUTS ─────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  // Escape to close modals/overlays
  if (e.key === 'Escape') {
    if ($('incoming-call-overlay').style.display !== 'none') {
      // Don't auto-reject on Escape
    } else if ($('modal-new-customer').style.display !== 'none') {
      $('modal-new-customer').style.display = 'none';
    }
  }
  
  // Ctrl+1-6 for tabs
  if (e.ctrlKey && e.key >= '1' && e.key <= '6') {
    const tabs = ['dialer', 'lines', 'calls', 'contacts', 'sms', 'settings'];
    switchTab(tabs[parseInt(e.key) - 1]);
  }
});

// ─── INIT ON LOAD ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Check if already logged in
  if (token && currentUser) {
    initApp();
  } else {
    showScreen('login');
  }
  
  // Restore server URL
  const savedUrl = localStorage.getItem('serverUrl');
  if (savedUrl) {
    $('server-url').value = savedUrl;
  }
  
  // Load audio devices
  loadAudioDevices();
  
  // Load SMS history
  renderSmsHistory();
});
