const ChatManager = {
  socket: null,
  activeChatUserId: null,
  drivers: {}, // userId -> UserObj

  init() {
    this.elements = {
      fab: document.getElementById('chat-fab'),
      modal: document.getElementById('chat-modal'),
      closeBtn: document.getElementById('chat-close'),
      messagesBox: document.getElementById('chat-messages'),
      input: document.getElementById('chat-input'),
      sendBtn: document.getElementById('chat-send'),
      recordBtn: document.getElementById('chat-record'),
      recordIcon: document.getElementById('chat-record-icon'),
      driversList: document.getElementById('chat-drivers-list')
    };

    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;

    this.elements.fab.addEventListener('click', () => {
      this.elements.modal.style.display = 'flex';
      this.elements.fab.style.display = 'none';
      if(!this.socket) this.connect();
    });

    this.elements.closeBtn.addEventListener('click', () => {
      this.elements.modal.style.display = 'none';
      this.elements.fab.style.display = 'flex';
    });

    this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
    this.elements.input.addEventListener('keypress', (e) => {
      if(e.key === 'Enter') this.sendMessage();
    });

    if (this.elements.recordBtn) {
      this.elements.recordBtn.addEventListener('click', () => {
        if (!this.activeChatUserId) return;
        if (this.isRecording) {
          this.stopRecording();
        } else {
          this.startRecording();
        }
      });
    }
  },

  async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];
      this.mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) this.audioChunks.push(e.data);
      };
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(blob); 
        reader.onloadend = () => {
          const base64Audio = reader.result;
          this.sendVoiceMessage(base64Audio);
        }
      };
      this.mediaRecorder.start();
      this.isRecording = true;
      
      this.elements.recordIcon.innerText = 'stop';
      this.elements.recordBtn.style.color = '#ef4444';
      this.elements.input.placeholder = 'Ochiq qoldiring... (Yozilmoqda)';
      this.elements.input.disabled = true;
    } catch(err) {
      console.warn("Mikrofonni ochishda xatolik:", err);
      if (window.UI) window.UI.showToast("Mikrofonga ruxsat yo'q!", "error");
    }
  },

  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    this.isRecording = false;
    this.elements.recordIcon.innerText = 'mic';
    this.elements.recordBtn.style.color = '#64748b';
    this.elements.input.placeholder = 'Xabar yozing...';
    this.elements.input.disabled = false;
  },

  sendVoiceMessage(base64Audio) {
    if(!this.activeChatUserId) return;

    const userStr = localStorage.getItem('user');
    const me = userStr ? JSON.parse(userStr) : {};

    const msgPayload = {
      text: '[VOICE]:' + base64Audio,
      recipientId: this.activeChatUserId,
      companyId: me.companyId
    };

    this.socket.emit('sendMessage', msgPayload);
    
    // Render optimistic
    this.renderMessage({ text: msgPayload.text, senderId: me.id, sender: me, createdAt: new Date().toISOString() });
    this.scrollToBottom();
  },

  async connect() {
    try {
      const token = localStorage.getItem('token');
      if(!token) return;

      // /chat namespace'ga to'g'ridan-to'g'ri ulanish
      // Cloudflare tunnel WebSocket Upgrade'ni qo'llab-quvvatlaydi
      this.socket = io('https://gilam-api.ecos.uz/chat', {
        path: '/socket.io',
        query: { token },
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      });

      this.socket.on('connect', () => {
        console.log('[Chat] /chat namespace ga ulandi');
        this.loadConversations();
      });

      this.socket.on('connect_error', (err) => {
        console.error('[Chat] Ulanish xatoligi:', err.message);
      });

      this.socket.on('newMessage', (msg) => {
        this.handleIncomingMessage(msg);
      });

      this.socket.on('messageSent', (msg) => {
        // Server tasdiqladi — optimistic kopyasi allaqachon ko'ringan
        console.log('[Chat] Server xabarni tasdiqladi:', msg?.id);
      });

    } catch (err) {
      console.error('Chat connect error:', err);
    }
  },

  async loadConversations() {
     try {
       const userStr = localStorage.getItem('user');
       const myProfile = userStr ? JSON.parse(userStr) : null;
       
       let drivers = [];
       if (myProfile) {
          // /users returns all users for Super Admin, and only company users for Operators/Company Admins.
          const ulist = await window.Api.request(`/users`);
          if (ulist && Array.isArray(ulist)) {
             drivers = ulist.filter(u => u.role === 'DRIVER');
          }
       }

       const convs = await window.Api.request('/messages/conversations');
       const merged = [...drivers, ...(Array.isArray(convs) ? convs : [])];
       
       const uniqueUsers = [];
       const seen = new Set();
       for(let u of merged) {
          if (u && u.id && !seen.has(u.id) && u.id !== myProfile?.id) {
             seen.add(u.id);
             uniqueUsers.push(u);
          }
       }

       this.elements.driversList.innerHTML = '<span style="font-size: 11px; color: #64748b; white-space: nowrap;">Barcha haydovchilar:</span>';
       
       if (uniqueUsers.length > 0) {
          uniqueUsers.forEach(u => {
             this.drivers[u.id] = u;
             this.addDriverBadge(u);
          });
       } else {
          this.elements.driversList.innerHTML += '<span style="font-size: 11px; color: #94a3b8; margin-left: 8px;">Topilmadi.</span>';
       }
     } catch(e) {
       console.log('Load conv error', e);
     }
  },

  addDriverBadge(user) {
     const existing = document.getElementById(`driver-badge-${user.id}`);
     if(existing) return;

     const div = document.createElement('div');
     div.id = `driver-badge-${user.id}`;
     div.style = `padding: 4px 8px; background: #e2e8f0; border-radius: 12px; font-size: 12px; cursor: pointer; color: #0f172a; font-weight: 600; flex-shrink: 0;`;
     div.innerText = user.fullName;
     div.onclick = () => this.selectChat(user.id);
     this.elements.driversList.appendChild(div);
  },

  async selectChat(userId) {
     this.activeChatUserId = userId;
     this.elements.input.disabled = false;
     this.elements.sendBtn.disabled = false;
     this.elements.sendBtn.style.background = '#10b981';
     this.elements.sendBtn.style.cursor = 'pointer';

     // Update chat header title
     const user = this.drivers[userId];
     const titleEl = document.getElementById('chat-title');
     if (titleEl && user) {
       titleEl.innerText = 'Suhbat: ' + (user.fullName || userId);
     }

     // Highlight chosen driver
     Array.from(this.elements.driversList.children).forEach(el => {
       if(el.id.startsWith('driver-badge-')) {
          el.style.background = el.id === `driver-badge-${userId}` ? '#10b981' : '#e2e8f0';
          el.style.color = el.id === `driver-badge-${userId}` ? '#fff' : '#0f172a';
       }
     });

     try {
       const history = await window.Api.request(`/messages/history/${userId}`);
       this.elements.messagesBox.innerHTML = '';
       if (history && Array.isArray(history)) {
         history.forEach(m => this.renderMessage(m));
       }
       this.scrollToBottom();
     } catch (e) {}
  },

  handleIncomingMessage(msg) {
     if(!this.drivers[msg.senderId] && msg.sender) {
        this.drivers[msg.senderId] = msg.sender;
        this.addDriverBadge(msg.sender);
     }
     
     if (this.activeChatUserId === msg.senderId) {
        this.renderMessage(msg);
        this.scrollToBottom();
     } else {
        // notification logic
        if (window.UI && window.UI.showToast) {
           window.UI.showToast(`Yangi xabar: ${msg.sender?.fullName || 'Haydovchi'}`);
        }
     }
  },

  sendMessage() {
     const val = this.elements.input.value.trim();
     if(!val || !this.activeChatUserId) return;

     const userStr = localStorage.getItem('user');
     const me = userStr ? JSON.parse(userStr) : {};

     const msgPayload = {
       text: val,
       recipientId: this.activeChatUserId,
       companyId: me.companyId
     };

     this.socket.emit('sendMessage', msgPayload);
     
     // Render optimistic
     this.renderMessage({ text: val, senderId: me.id, sender: me, createdAt: new Date().toISOString() });
     
     this.elements.input.value = '';
     this.scrollToBottom();
  },

  renderMessage(m) {
     const userStr = localStorage.getItem('user');
     const myId = userStr ? JSON.parse(userStr).id : null;
     const isMe = m.senderId === myId;

     const wrapper = document.createElement('div');
     wrapper.style = `display: flex; flex-direction: column; align-items: ${isMe ? 'flex-end' : 'flex-start'}; margin-bottom: 6px;`;
     
     // Sender Name Badge
     if (!isMe && m.sender?.fullName) {
       const nameLb = document.createElement('span');
       nameLb.style = 'font-size: 10px; color: #64748b; margin-bottom: 2px; padding: 0 4px; font-weight: 600;';
       nameLb.innerText = m.sender.fullName;
       wrapper.appendChild(nameLb);
     }

     const bubble = document.createElement('div');
     bubble.style = `max-width: 80%; padding: 8px 12px; border-radius: 16px; font-size: 13px; color: ${isMe?'white':'#0f172a'}; background: ${isMe?'#10b981':'#e2e8f0'};`;
     
     if (m.text && m.text.startsWith('[VOICE]:')) {
       // Ovozli xabar rendering
       const audioSrc = m.text.replace('[VOICE]:', '');
       bubble.style.padding = '4px 8px';
       bubble.innerHTML = `<audio controls style="height: 36px; max-width: 200px; border-radius: 18px;" src="${audioSrc}"></audio>`;
     } else {
       bubble.innerText = m.text;
     }

     const time = document.createElement('span');
     time.style = `font-size: 10px; color: #94a3b8; margin-top: 2px; px: 4px;`;
     time.innerText = new Date(m.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

     wrapper.appendChild(bubble);
     wrapper.appendChild(time);
     this.elements.messagesBox.appendChild(wrapper);
  },

  scrollToBottom() {
     this.elements.messagesBox.scrollTop = this.elements.messagesBox.scrollHeight;
  }
};

window.addEventListener('DOMContentLoaded', () => {
   ChatManager.init();
});
