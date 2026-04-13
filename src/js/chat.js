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
      driversList: document.getElementById('chat-drivers-list')
    };

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
  },

  async connect() {
    try {
      const token = localStorage.getItem('gilam_token');
      if(!token) return;

      this.socket = io('wss://gilam-api.ecos.uz/chat', { query: { token } });

      this.socket.on('connect', () => {
        console.log('[Chat] Connected to WebSocket');
        this.loadConversations();
      });

      this.socket.on('newMessage', (msg) => {
        this.handleIncomingMessage(msg);
      });
    } catch (err) {
      console.error('Chat connect error:', err);
    }
  },

  async loadConversations() {
     try {
       const res = await window.Api.request('/messages/conversations');
       this.elements.driversList.innerHTML = '<span style="font-size: 11px; color: #64748b; margin-right:4px;">Haydovchilar:</span>';
       if(res && Array.isArray(res)) {
         res.forEach(user => {
           this.drivers[user.id] = user;
           this.addDriverBadge(user);
         });
       }
     } catch(e) { console.error('Load conv error', e); }
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

     const userStr = localStorage.getItem('gilam_user');
     const me = userStr ? JSON.parse(userStr) : {};

     const msgPayload = {
       text: val,
       recipientId: this.activeChatUserId,
       companyId: me.companyId
     };

     this.socket.emit('sendMessage', msgPayload);
     
     // Render optimistic
     this.renderMessage({ text: val, senderId: me.id, createdAt: new Date().toISOString() });
     
     this.elements.input.value = '';
     this.scrollToBottom();
  },

  renderMessage(m) {
     const userStr = localStorage.getItem('gilam_user');
     const myId = userStr ? JSON.parse(userStr).id : null;
     const isMe = m.senderId === myId;

     const wrapper = document.createElement('div');
     wrapper.style = `display: flex; flex-direction: column; align-items: ${isMe ? 'flex-end' : 'flex-start'}; margin-bottom: 4px;`;
     
     const bubble = document.createElement('div');
     bubble.style = `max-width: 80%; padding: 8px 12px; border-radius: 16px; font-size: 13px; color: ${isMe?'white':'#0f172a'}; background: ${isMe?'#10b981':'#e2e8f0'};`;
     bubble.innerText = m.text;

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
