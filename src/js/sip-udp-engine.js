/**
 * ═══════════════════════════════════════════════════════════════════════════
 * sip-udp-engine.js — Native UDP SIP Engine for Electron
 * 
 * X-Lite / MicroSIP kabi UDP orqali to'g'ridan-to'g'ri Asterisk ga ulanadi.
 * WebSocket kerak emas — haqiqiy SIP protokol ishlatiladi.
 * 
 * Xususiyatlar:
 *   - SIP REGISTER/UNREGISTER (UDP port 5060)
 *   - SIP INVITE/BYE (qo'ng'iroq qilish/tugatish)
 *   - Digest Authentication (MD5)
 *   - Auto re-register
 *   - Kiruvchi qo'ng'iroqlarni qabul qilish
 * ═══════════════════════════════════════════════════════════════════════════
 */

const dgram = require('dgram');
const crypto = require('crypto');
const os = require('os');
const EventEmitter = require('events');
const RtpMediaEngine = require('./rtp-media');

class SipUdpEngine extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.localIp = '';
    this.localPort = 5062;
    this.sipServer = '';
    this.sipPort = 5060;
    this.extension = '';
    this.password = '';
    this.displayName = '';
    this.isRegistered = false;
    this.registerTimer = null;
    this.keepAliveTimer = null;
    this.callId = '';
    this.tag = '';
    this.cseq = 0;
    this.currentCall = null;
    this._pendingAuth = {};
    this.mediaEngine = new RtpMediaEngine();
  }

  // ═══ HELPERS ═════════════════════════════════════════════════════════════
  _randomHex(n) { return crypto.randomBytes(n).toString('hex'); }
  _branch() { return 'z9hG4bK' + this._randomHex(6); }
  _tag() { return this._randomHex(8); }
  _callId() { return this._randomHex(16); }
  _md5(str) { return crypto.createHash('md5').update(str).digest('hex'); }

  _getLocalIp() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          // Prefer 10.x.x.x network to match SIP server
          if (iface.address.startsWith('10.')) return iface.address;
        }
      }
    }
    // Fallback to any non-internal IPv4
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  // ═══ DIGEST AUTH ═════════════════════════════════════════════════════════
  _parseWwwAuth(response) {
    const match = response.match(/WWW-Authenticate:\s*Digest\s+(.*)/i);
    if (!match) return null;
    const params = {};
    const re = /(\w+)="([^"]+)"/g;
    let m;
    while ((m = re.exec(match[1])) !== null) {
      params[m[1]] = m[2];
    }
    return params;
  }

  _buildDigestAuth(authParams, method, uri) {
    const realm = authParams.realm;
    const nonce = authParams.nonce;
    const ha1 = this._md5(`${this.extension}:${realm}:${this.password}`);
    const ha2 = this._md5(`${method}:${uri}`);
    const response = this._md5(`${ha1}:${nonce}:${ha2}`);
    return `Digest username="${this.extension}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}", algorithm=MD5`;
  }

  // ═══ SIP MESSAGE BUILDER ════════════════════════════════════════════════
  _buildRequest(method, requestUri, extraHeaders, body, authHeader) {
    this.cseq++;
    const branch = this._branch();
    let msg = `${method} ${requestUri} SIP/2.0\r\n`;
    msg += `Via: SIP/2.0/UDP ${this.localIp}:${this.localPort};rport;branch=${branch}\r\n`;
    msg += `Max-Forwards: 70\r\n`;
    msg += `From: "${this.displayName}" <sip:${this.extension}@${this.sipServer}>;tag=${this.tag}\r\n`;
    
    if (method === 'REGISTER') {
      msg += `To: <sip:${this.extension}@${this.sipServer}>\r\n`;
    } else if (this.currentCall) {
      msg += `To: <sip:${this.currentCall.targetExt}@${this.sipServer}>${this.currentCall.toTag ? ';tag=' + this.currentCall.toTag : ''}\r\n`;
    }
    
    msg += `Call-ID: ${method === 'REGISTER' ? this.callId : (this.currentCall?.callId || this.callId)}\r\n`;
    msg += `CSeq: ${this.cseq} ${method}\r\n`;
    
    if (method === 'REGISTER') {
      msg += `Contact: <sip:${this.extension}@${this.localIp}:${this.localPort};transport=udp>\r\n`;
      msg += `Expires: 3600\r\n`;
    }
    
    msg += `User-Agent: GilamOperator/2.0\r\n`;
    msg += `Allow: INVITE, ACK, CANCEL, BYE, OPTIONS, INFO, NOTIFY, REFER\r\n`;
    
    if (authHeader) {
      msg += `Authorization: ${authHeader}\r\n`;
    }
    
    if (extraHeaders) {
      msg += extraHeaders;
    }
    
    const bodyStr = body || '';
    msg += `Content-Length: ${Buffer.byteLength(bodyStr)}\r\n`;
    msg += `\r\n`;
    msg += bodyStr;
    
    return { msg, branch, cseq: this.cseq };
  }

  // ═══ SEND ═══════════════════════════════════════════════════════════════
  _send(message) {
    if (!this.socket) return;
    const buf = Buffer.from(message);
    this.socket.send(buf, 0, buf.length, this.sipPort, this.sipServer, (err) => {
      if (err) console.error('[SIP-UDP] Send error:', err.message);
    });
  }

  // ═══ INIT & CONNECT ════════════════════════════════════════════════════
  connect(config) {
    this.sipServer = config.domain || config.sipServer;
    this.sipPort = config.sipPort || 5060;
    this.extension = config.extension;
    this.password = config.password;
    this.displayName = config.name || config.extension;
    this.localPort = config.localPort || (5060 + Math.floor(Math.random() * 100) + 2);
    this.localIp = this._getLocalIp();
    this.callId = this._callId();
    this.tag = this._tag();
    this.cseq = 0;
    this.isRegistered = false;

    console.log(`[SIP-UDP] Connecting: ${this.extension}@${this.sipServer}:${this.sipPort}`);
    console.log(`[SIP-UDP] Local: ${this.localIp}:${this.localPort}`);

    if (this.socket) {
      try { this.socket.close(); } catch(e) {}
    }

    this.socket = dgram.createSocket('udp4');
    
    this.socket.on('message', (msg, rinfo) => {
      this._handleMessage(msg.toString(), rinfo);
    });

    this.socket.on('error', (err) => {
      console.error('[SIP-UDP] Socket error:', err.message);
      this.emit('error', err);
    });

    this.socket.bind(this.localPort, () => {
      console.log(`[SIP-UDP] Socket bound to ${this.localPort}`);
      this._register();
    });
  }

  // ═══ REGISTER ═══════════════════════════════════════════════════════════
  _register(authHeader) {
    const { msg } = this._buildRequest('REGISTER', `sip:${this.sipServer}`, null, null, authHeader);
    console.log(`[SIP-UDP] --> REGISTER ${authHeader ? '(with auth)' : '(initial)'}`);
    this._send(msg);
  }

  unregister() {
    this.cseq++;
    const branch = this._branch();
    let msg = `REGISTER sip:${this.sipServer} SIP/2.0\r\n`;
    msg += `Via: SIP/2.0/UDP ${this.localIp}:${this.localPort};rport;branch=${branch}\r\n`;
    msg += `Max-Forwards: 70\r\n`;
    msg += `From: "${this.displayName}" <sip:${this.extension}@${this.sipServer}>;tag=${this.tag}\r\n`;
    msg += `To: <sip:${this.extension}@${this.sipServer}>\r\n`;
    msg += `Call-ID: ${this.callId}\r\n`;
    msg += `CSeq: ${this.cseq} REGISTER\r\n`;
    msg += `Contact: *\r\n`;
    msg += `Expires: 0\r\n`;
    msg += `User-Agent: GilamOperator/2.0\r\n`;
    msg += `Content-Length: 0\r\n\r\n`;
    
    this._send(msg);
    this.isRegistered = false;
    clearInterval(this.registerTimer);
    clearInterval(this.keepAliveTimer);
    this.emit('unregistered');
  }

  disconnect() {
    if (this.isRegistered) {
      this.unregister();
    }
    clearInterval(this.registerTimer);
    clearInterval(this.keepAliveTimer);
    if (this.socket) {
      try { this.socket.close(); } catch(e) {}
      this.socket = null;
    }
    this.isRegistered = false;
    this.emit('disconnected');
  }

  // ═══ MAKE CALL (INVITE) ════════════════════════════════════════════════
  makeCall(targetNumber) {
    if (!this.isRegistered) {
      this.emit('error', new Error('SIP registratsiya qilinmagan'));
      return;
    }

    const callId = this._callId();
    const branch = this._branch();
    const fromTag = this._tag();
    
    this.currentCall = {
      callId,
      targetExt: targetNumber,
      branch,
      fromTag,
      toTag: '',
      state: 'CALLING',
      direction: 'outgoing',
    };

    this.cseq++;
    
    // Simple SDP for audio
    const sdp = this._buildSdp();
    
    let msg = `INVITE sip:${targetNumber}@${this.sipServer} SIP/2.0\r\n`;
    msg += `Via: SIP/2.0/UDP ${this.localIp}:${this.localPort};rport;branch=${branch}\r\n`;
    msg += `Max-Forwards: 70\r\n`;
    msg += `From: "${this.displayName}" <sip:${this.extension}@${this.sipServer}>;tag=${fromTag}\r\n`;
    msg += `To: <sip:${targetNumber}@${this.sipServer}>\r\n`;
    msg += `Call-ID: ${callId}\r\n`;
    msg += `CSeq: ${this.cseq} INVITE\r\n`;
    msg += `Contact: <sip:${this.extension}@${this.localIp}:${this.localPort};transport=udp>\r\n`;
    msg += `Content-Type: application/sdp\r\n`;
    msg += `Allow: INVITE, ACK, CANCEL, BYE, OPTIONS, INFO, NOTIFY, REFER\r\n`;
    msg += `User-Agent: GilamOperator/2.0\r\n`;
    msg += `Content-Length: ${Buffer.byteLength(sdp)}\r\n`;
    msg += `\r\n`;
    msg += sdp;

    console.log(`[SIP-UDP] --> INVITE ${targetNumber}`);
    this._send(msg);
    this.emit('calling', { target: targetNumber });
  }

  // ═══ HANGUP (BYE) ═════════════════════════════════════════════════════
  hangup() {
    if (!this.currentCall) return;
    
    this.cseq++;
    const branch = this._branch();
    
    let msg = `BYE sip:${this.currentCall.targetExt}@${this.sipServer} SIP/2.0\r\n`;
    msg += `Via: SIP/2.0/UDP ${this.localIp}:${this.localPort};rport;branch=${branch}\r\n`;
    msg += `Max-Forwards: 70\r\n`;
    msg += `From: "${this.displayName}" <sip:${this.extension}@${this.sipServer}>;tag=${this.currentCall.fromTag}\r\n`;
    msg += `To: <sip:${this.currentCall.targetExt}@${this.sipServer}>${this.currentCall.toTag ? ';tag=' + this.currentCall.toTag : ''}\r\n`;
    msg += `Call-ID: ${this.currentCall.callId}\r\n`;
    msg += `CSeq: ${this.cseq} BYE\r\n`;
    msg += `User-Agent: GilamOperator/2.0\r\n`;
    msg += `Content-Length: 0\r\n\r\n`;

    console.log(`[SIP-UDP] --> BYE`);
    this._send(msg);
    const lastCall = this.currentCall;
    this.currentCall = null;
    this.mediaEngine.stop();
    this.emit('callEnded', { reason: 'local_hangup', target: lastCall?.targetExt, direction: lastCall?.direction });
  }

  // ═══ ANSWER INCOMING CALL ═════════════════════════════════════════════
  answerCall() {
    if (!this.currentCall || this.currentCall.state !== 'RINGING') return;
    
    const sdp = this._buildSdp();
    
    let msg = `SIP/2.0 200 OK\r\n`;
    msg += `Via: ${this.currentCall.via}\r\n`;
    msg += `From: ${this.currentCall.from}\r\n`;
    msg += `To: ${this.currentCall.to};tag=${this.tag}\r\n`;
    msg += `Call-ID: ${this.currentCall.callId}\r\n`;
    msg += `CSeq: ${this.currentCall.cseq} INVITE\r\n`;
    msg += `Contact: <sip:${this.extension}@${this.localIp}:${this.localPort};transport=udp>\r\n`;
    msg += `Content-Type: application/sdp\r\n`;
    msg += `User-Agent: GilamOperator/2.0\r\n`;
    msg += `Content-Length: ${Buffer.byteLength(sdp)}\r\n`;
    msg += `\r\n`;
    msg += sdp;

    console.log(`[SIP-UDP] --> 200 OK (Answer)`);
    this._send(msg);
    this.currentCall.state = 'ANSWERED';
    
    // Start media if we got remote SDP during INVITE
    if (this.currentCall.remoteIp && this.currentCall.remotePort) {
      this.mediaEngine.start(this.localPort + 2, this.currentCall.remoteIp, this.currentCall.remotePort);
    }
    
    this.emit('callAnswered', { target: this.currentCall.targetExt });
  }

  rejectCall() {
    if (!this.currentCall || this.currentCall.state !== 'RINGING') return;
    
    let msg = `SIP/2.0 486 Busy Here\r\n`;
    msg += `Via: ${this.currentCall.via}\r\n`;
    msg += `From: ${this.currentCall.from}\r\n`;
    msg += `To: ${this.currentCall.to};tag=${this.tag}\r\n`;
    msg += `Call-ID: ${this.currentCall.callId}\r\n`;
    msg += `CSeq: ${this.currentCall.cseq} INVITE\r\n`;
    msg += `User-Agent: GilamOperator/2.0\r\n`;
    msg += `Content-Length: 0\r\n\r\n`;

    console.log(`[SIP-UDP] --> 486 Busy (Reject)`);
    this._send(msg);
    const lastCall = this.currentCall;
    this.currentCall = null;
    this.mediaEngine.stop();
    this.emit('callEnded', { reason: 'rejected', target: lastCall?.targetExt, direction: lastCall?.direction });
  }

  // ═══ SDP BUILDER ═══════════════════════════════════════════════════════
  _buildSdp() {
    const rtpPort = this.localPort + 2;
    let sdp = `v=0\r\n`;
    sdp += `o=- ${Date.now()} ${Date.now()} IN IP4 ${this.localIp}\r\n`;
    sdp += `s=GilamOperator\r\n`;
    sdp += `c=IN IP4 ${this.localIp}\r\n`;
    sdp += `t=0 0\r\n`;
    sdp += `m=audio ${rtpPort} RTP/AVP 0 8 101\r\n`;
    sdp += `a=rtpmap:0 PCMU/8000\r\n`;
    sdp += `a=rtpmap:8 PCMA/8000\r\n`;
    sdp += `a=rtpmap:101 telephone-event/8000\r\n`;
    sdp += `a=fmtp:101 0-16\r\n`;
    sdp += `a=sendrecv\r\n`;
    sdp += `a=ptime:20\r\n`;
    return sdp;
  }

  // ═══ RESPONSE HANDLER ═════════════════════════════════════════════════
  _handleMessage(data, rinfo) {
    // Check if it's a response (starts with SIP/2.0) or request (starts with method)
    if (data.startsWith('SIP/2.0')) {
      this._handleResponse(data);
    } else {
      this._handleRequest(data, rinfo);
    }
  }

  _handleResponse(data) {
    const statusMatch = data.match(/SIP\/2\.0\s+(\d+)\s+(.*)/);
    if (!statusMatch) return;
    
    const code = parseInt(statusMatch[1]);
    const reason = statusMatch[2].trim();
    
    // Determine which request this is a response to
    const cseqMatch = data.match(/CSeq:\s*(\d+)\s+(\w+)/i);
    const method = cseqMatch ? cseqMatch[2].toUpperCase() : '';
    
    console.log(`[SIP-UDP] <-- ${code} ${reason} (${method})`);

    if (method === 'REGISTER') {
      if (code === 401) {
        // Auth challenge
        const authParams = this._parseWwwAuth(data);
        if (authParams) {
          const authHeader = this._buildDigestAuth(authParams, 'REGISTER', `sip:${this.sipServer}`);
          this._register(authHeader);
        }
      } else if (code === 200) {
        console.log(`[SIP-UDP] ✅ REGISTERED: ${this.extension}@${this.sipServer}`);
        this.isRegistered = true;
        this.emit('registered');
        
        // Auto re-register every 300 seconds
        clearInterval(this.registerTimer);
        this.registerTimer = setInterval(() => {
          this.cseq = 0;
          this.callId = this._callId();
          this.tag = this._tag();
          this._register();
        }, 280000);

        // NAT Keep-Alive (every 20s to keep UDP port open for incoming calls)
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = setInterval(() => {
          if (this.socket) {
            const ping = Buffer.from('\r\n\r\n');
            this.socket.send(ping, 0, ping.length, this.sipPort, this.sipServer);
          }
        }, 20000);
      } else if (code === 403) {
        console.error(`[SIP-UDP] ❌ Registration 403 Forbidden`);
        this.emit('registrationFailed', { cause: 'Parol noto\'g\'ri (403)' });
      }
    } else if (method === 'INVITE') {
      if (code === 401 || code === 407) {
        // MUST send ACK for the 401 Unauthorized before resending!
        const cseqMatchErr = data.match(/CSeq:\s*(\d+)/i);
        const errCseq = cseqMatchErr ? cseqMatchErr[1] : this.cseq;
        
        // Extract original branch from Via for the non-2xx ACK
        const viaMatch = data.match(/Via:.*?;branch=([^\s;]+)/i);
        const originalBranch = viaMatch ? viaMatch[1] : this.currentCall.branch;
        
        this._sendNon2xxAck(errCseq, originalBranch);

        // Auth for INVITE
        const authParams = this._parseWwwAuth(data) || this._parseProxyAuth(data);
        if (authParams && this.currentCall) {
          const targetUri = `sip:${this.currentCall.targetExt}@${this.sipServer}`;
          const authHeader = this._buildDigestAuth(authParams, 'INVITE', targetUri);
          // Re-send INVITE with auth
          this._resendInviteWithAuth(authHeader);
        }
      } else if (code === 100) {
        console.log(`[SIP-UDP]    Trying...`);
      } else if (code === 180 || code === 183) {
        console.log(`[SIP-UDP]    Ringing...`);
        if (this.currentCall) {
          this.currentCall.state = 'RINGING_REMOTE';
          // Extract To tag
          const toTagMatch = data.match(/To:.*?;tag=([^\s;>]+)/i);
          if (toTagMatch) this.currentCall.toTag = toTagMatch[1];
        }
        this.emit('ringing', { target: this.currentCall?.targetExt });
      } else if (code === 200) {
        console.log(`[SIP-UDP]    Call answered!`);
        if (this.currentCall) {
          this.currentCall.state = 'ANSWERED';
          const toTagMatch = data.match(/To:.*?;tag=([^\s;>]+)/i);
          if (toTagMatch) this.currentCall.toTag = toTagMatch[1];
          
          // Parse remote SDP
          const rtpPortMatch = data.match(/m=audio\s+(\d+)/i);
          const rtpIpMatch = data.match(/c=IN\s+IP4\s+([0-9.]+)/i);
          if (rtpPortMatch && rtpIpMatch) {
            this.mediaEngine.start(this.localPort + 2, rtpIpMatch[1], parseInt(rtpPortMatch[1]));
          }
        }
        
        // PBX sends CSeq: X INVITE, we MUST reply with CSeq: X ACK
        const cseqMatchOk = data.match(/CSeq:\s*(\d+)/i);
        const ackCseq = cseqMatchOk ? cseqMatchOk[1] : this.cseq;

        this._sendAck(ackCseq);
        this.emit('callAnswered', { target: this.currentCall?.targetExt });
      } else if (code >= 400) {
        console.log(`[SIP-UDP]    Call failed: ${code} ${reason}`);
        
        if (this.currentCall) {
          const cseqMatchErr = data.match(/CSeq:\s*(\d+)/i);
          const errCseq = cseqMatchErr ? cseqMatchErr[1] : this.cseq;
          const viaMatch = data.match(/Via:.*?;branch=([^\s;]+)/i);
          const originalBranch = viaMatch ? viaMatch[1] : this.currentCall.branch;
          
          const toTagMatch = data.match(/To:.*?;tag=([^\s;>]+)/i);
          if (toTagMatch) this.currentCall.toTag = toTagMatch[1];
          
          this._sendNon2xxAck(errCseq, originalBranch);
          this.mediaEngine.stop();
          const lastCall = this.currentCall;
          this.currentCall = null;
          this.emit('callFailed', { code, reason, target: lastCall?.targetExt, direction: lastCall?.direction });
        }
      }
    } else if (method === 'BYE') {
      if (code === 200) {
        console.log(`[SIP-UDP]    BYE acknowledged`);
      }
    }
  }

  _handleRequest(data, rinfo) {
    const methodMatch = data.match(/^(\w+)\s+/);
    if (!methodMatch) return;
    
    const method = methodMatch[1].toUpperCase();
    console.log(`[SIP-UDP] <-- ${method} request`);

    if (method === 'INVITE') {
      // Send 100 Trying immediately
      const viaMatch = data.match(/Via:\s*(.*)/i);
      const fromMatch = data.match(/From:\s*(.*)/i);
      const toMatch = data.match(/To:\s*(.*)/i);
      const callIdMatch = data.match(/Call-ID:\s*(.*)/i);
      const cseqMatch = data.match(/CSeq:\s*(\d+)\s+INVITE/i);

      let trying = `SIP/2.0 100 Trying\r\n`;
      trying += `Via: ${viaMatch ? viaMatch[1].trim() : ''}\r\n`;
      trying += `From: ${fromMatch ? fromMatch[1].trim() : ''}\r\n`;
      trying += `To: ${toMatch ? toMatch[1].trim() : ''}\r\n`;
      trying += `Call-ID: ${callIdMatch ? callIdMatch[1].trim() : ''}\r\n`;
      trying += `CSeq: ${cseqMatch ? cseqMatch[1] : '1'} INVITE\r\n`;
      trying += `Content-Length: 0\r\n\r\n`;
      this._send(trying);

      // Extract details
      const callerMatch = data.match(/From:.*?[<]?sip:([^\s@>:]+)/i);
      const callerDisplayMatch = data.match(/From:\s*"([^"]+)"/i);
      const rtpPortMatch = data.match(/m=audio\s+(\d+)/i);
      const rtpIpMatch = data.match(/c=IN\s+IP4\s+([0-9.]+)/i);

      this.currentCall = {
        callId: callIdMatch ? callIdMatch[1].trim() : '',
        targetExt: callerMatch ? callerMatch[1] : 'Noma\'lum',
        from: fromMatch ? fromMatch[1].trim() : '',
        to: toMatch ? toMatch[1].trim() : '',
        via: viaMatch ? viaMatch[1].trim() : '',
        cseq: cseqMatch ? cseqMatch[1] : '1',
        toTag: '',
        state: 'RINGING',
        direction: 'incoming',
        remoteIp: rtpIpMatch ? rtpIpMatch[1] : null,
        remotePort: rtpPortMatch ? parseInt(rtpPortMatch[1]) : null,
      };

      // Send 180 Ringing
      let ring = `SIP/2.0 180 Ringing\r\n`;
      ring += `Via: ${this.currentCall.via}\r\n`;
      ring += `From: ${this.currentCall.from}\r\n`;
      ring += `To: ${this.currentCall.to};tag=${this.tag}\r\n`;
      ring += `Call-ID: ${this.currentCall.callId}\r\n`;
      ring += `CSeq: ${this.currentCall.cseq} INVITE\r\n`;
      ring += `User-Agent: GilamOperator/2.0\r\n`;
      ring += `Content-Length: 0\r\n\r\n`;
      
      this._send(ring);
      
      this.emit('incomingCall', {
        callerNumber: this.currentCall.targetExt,
        callerName: callerDisplayMatch ? callerDisplayMatch[1] : '',
      });
    } else if (method === 'BYE') {
      // Remote hangup
      const callIdMatch = data.match(/Call-ID:\s*(.*)/i);
      const viaMatch = data.match(/Via:\s*(.*)/i);
      const fromMatch = data.match(/From:\s*(.*)/i);
      const toMatch = data.match(/To:\s*(.*)/i);
      const cseqMatch = data.match(/CSeq:\s*(\d+)\s+BYE/i);
      
      // Send 200 OK
      let ok = `SIP/2.0 200 OK\r\n`;
      ok += `Via: ${viaMatch ? viaMatch[1].trim() : ''}\r\n`;
      ok += `From: ${fromMatch ? fromMatch[1].trim() : ''}\r\n`;
      ok += `To: ${toMatch ? toMatch[1].trim() : ''}\r\n`;
      ok += `Call-ID: ${callIdMatch ? callIdMatch[1].trim() : ''}\r\n`;
      ok += `CSeq: ${cseqMatch ? cseqMatch[1] : '1'} BYE\r\n`;
      ok += `User-Agent: GilamOperator/2.0\r\n`;
      ok += `Content-Length: 0\r\n\r\n`;
      
      this._send(ok);
      const lastCall = this.currentCall;
      this.currentCall = null;
      this.mediaEngine.stop();
      this.emit('callEnded', { reason: 'remote_hangup', target: lastCall?.targetExt, direction: lastCall?.direction });
    } else if (method === 'OPTIONS') {
      // Keepalive - respond 200
      const callIdMatch = data.match(/Call-ID:\s*(.*)/i);
      const viaMatch = data.match(/Via:\s*(.*)/i);
      const fromMatch = data.match(/From:\s*(.*)/i);
      const toMatch = data.match(/To:\s*(.*)/i);
      const cseqMatch = data.match(/CSeq:\s*(\d+)\s+OPTIONS/i);
      
      let ok = `SIP/2.0 200 OK\r\n`;
      ok += `Via: ${viaMatch ? viaMatch[1].trim() : ''}\r\n`;
      ok += `From: ${fromMatch ? fromMatch[1].trim() : ''}\r\n`;
      ok += `To: ${toMatch ? toMatch[1].trim() : ''};tag=${this.tag}\r\n`;
      ok += `Call-ID: ${callIdMatch ? callIdMatch[1].trim() : ''}\r\n`;
      ok += `CSeq: ${cseqMatch ? cseqMatch[1] : '1'} OPTIONS\r\n`;
      ok += `Allow: INVITE, ACK, CANCEL, BYE, OPTIONS, INFO, NOTIFY, REFER\r\n`;
      ok += `User-Agent: GilamOperator/2.0\r\n`;
      ok += `Content-Length: 0\r\n\r\n`;
      
      this._send(ok);
    } else if (method === 'ACK') {
      // ACK received - call is fully established
      console.log(`[SIP-UDP]    ACK received - call established`);
    }
  }

  // ═══ TRANSFER (REFER) ═════════════════════════════════════════════════
  refer(targetExt) {
    if (!this.currentCall || this.currentCall.state !== 'ANSWERED') {
      throw new Error("Active call required for transfer");
    }
    
    this.cseq++;
    const branch = this._branch();
    const referTo = `<sip:${targetExt}@${this.sipServer}>`;

    let msg = `REFER sip:${this.currentCall.targetExt}@${this.sipServer} SIP/2.0\r\n`;
    msg += `Via: SIP/2.0/UDP ${this.localIp}:${this.localPort};rport;branch=${branch}\r\n`;
    msg += `Max-Forwards: 70\r\n`;
    msg += `From: "${this.displayName}" <sip:${this.extension}@${this.sipServer}>;tag=${this.currentCall.fromTag || this.tag}\r\n`;
    msg += `To: <sip:${this.currentCall.targetExt}@${this.sipServer}>${this.currentCall.toTag ? ';tag=' + this.currentCall.toTag : ''}\r\n`;
    msg += `Call-ID: ${this.currentCall.callId}\r\n`;
    msg += `CSeq: ${this.cseq} REFER\r\n`;
    msg += `Refer-To: ${referTo}\r\n`;
    msg += `Referred-By: <sip:${this.extension}@${this.sipServer}>\r\n`;
    msg += `User-Agent: GilamOperator/2.0\r\n`;
    msg += `Content-Length: 0\r\n\r\n`;
    
    console.log(`[SIP-UDP] --> REFER ${targetExt}`);
    this._send(msg);
  }

  _sendAck(cseqOverride) {
    if (!this.currentCall) return;
    
    // RFC 3261: CSeq number in ACK MUST match the INVITE CSeq!
    const ackCseq = cseqOverride || (this.currentCall.direction === 'outgoing' ? this.cseq : this.currentCall.cseq);
    
    const branch = this._branch();
    
    let msg = `ACK sip:${this.currentCall.targetExt}@${this.sipServer} SIP/2.0\r\n`;
    msg += `Via: SIP/2.0/UDP ${this.localIp}:${this.localPort};rport;branch=${branch}\r\n`;
    msg += `Max-Forwards: 70\r\n`;
    msg += `From: "${this.displayName}" <sip:${this.extension}@${this.sipServer}>;tag=${this.currentCall.fromTag || this.tag}\r\n`;
    msg += `To: <sip:${this.currentCall.targetExt}@${this.sipServer}>${this.currentCall.toTag ? ';tag=' + this.currentCall.toTag : ''}\r\n`;
    msg += `Call-ID: ${this.currentCall.callId}\r\n`;
    msg += `CSeq: ${ackCseq} ACK\r\n`;
    msg += `User-Agent: GilamOperator/2.0\r\n`;
    msg += `Content-Length: 0\r\n\r\n`;
    
    this._send(msg);
  }

  _sendNon2xxAck(cseq, branch) {
    if (!this.currentCall) return;
    let msg = `ACK sip:${this.currentCall.targetExt}@${this.sipServer} SIP/2.0\r\n`;
    msg += `Via: SIP/2.0/UDP ${this.localIp}:${this.localPort};rport;branch=${branch}\r\n`;
    msg += `Max-Forwards: 70\r\n`;
    msg += `From: "${this.displayName}" <sip:${this.extension}@${this.sipServer}>;tag=${this.currentCall.fromTag || this.tag}\r\n`;
    msg += `To: <sip:${this.currentCall.targetExt}@${this.sipServer}>${this.currentCall.toTag ? ';tag=' + this.currentCall.toTag : ''}\r\n`;
    msg += `Call-ID: ${this.currentCall.callId}\r\n`;
    msg += `CSeq: ${cseq} ACK\r\n`;
    msg += `User-Agent: GilamOperator/2.0\r\n`;
    msg += `Content-Length: 0\r\n\r\n`;
    this._send(msg);
  }

  _resendInviteWithAuth(authHeader) {
    if (!this.currentCall) return;
    
    this.cseq++;
    const branch = this._branch();
    const sdp = this._buildSdp();
    
    let msg = `INVITE sip:${this.currentCall.targetExt}@${this.sipServer} SIP/2.0\r\n`;
    msg += `Via: SIP/2.0/UDP ${this.localIp}:${this.localPort};rport;branch=${branch}\r\n`;
    msg += `Max-Forwards: 70\r\n`;
    msg += `From: "${this.displayName}" <sip:${this.extension}@${this.sipServer}>;tag=${this.currentCall.fromTag}\r\n`;
    msg += `To: <sip:${this.currentCall.targetExt}@${this.sipServer}>\r\n`;
    msg += `Call-ID: ${this.currentCall.callId}\r\n`;
    msg += `CSeq: ${this.cseq} INVITE\r\n`;
    msg += `Contact: <sip:${this.extension}@${this.localIp}:${this.localPort};transport=udp>\r\n`;
    msg += `Authorization: ${authHeader}\r\n`;
    msg += `Content-Type: application/sdp\r\n`;
    msg += `User-Agent: GilamOperator/2.0\r\n`;
    msg += `Content-Length: ${Buffer.byteLength(sdp)}\r\n`;
    msg += `\r\n`;
    msg += sdp;

    console.log(`[SIP-UDP] --> INVITE (with auth)`);
    this._send(msg);
  }

  _parseProxyAuth(response) {
    const match = response.match(/Proxy-Authenticate:\s*Digest\s+(.*)/i);
    if (!match) return null;
    const params = {};
    const re = /(\w+)="([^"]+)"/g;
    let m;
    while ((m = re.exec(match[1])) !== null) {
      params[m[1]] = m[2];
    }
    return params;
  }

  // ═══ DTMF ═════════════════════════════════════════════════════════════
  sendDtmf(digit) {
    if (!this.currentCall || this.currentCall.state !== 'ANSWERED') return;
    
    this.cseq++;
    const branch = this._branch();
    const body = `Signal=${digit}\r\nDuration=160\r\n`;
    
    let msg = `INFO sip:${this.currentCall.targetExt}@${this.sipServer} SIP/2.0\r\n`;
    msg += `Via: SIP/2.0/UDP ${this.localIp}:${this.localPort};rport;branch=${branch}\r\n`;
    msg += `Max-Forwards: 70\r\n`;
    msg += `From: "${this.displayName}" <sip:${this.extension}@${this.sipServer}>;tag=${this.currentCall.fromTag || this.tag}\r\n`;
    msg += `To: <sip:${this.currentCall.targetExt}@${this.sipServer}>${this.currentCall.toTag ? ';tag=' + this.currentCall.toTag : ''}\r\n`;
    msg += `Call-ID: ${this.currentCall.callId}\r\n`;
    msg += `CSeq: ${this.cseq} INFO\r\n`;
    msg += `Content-Type: application/dtmf-relay\r\n`;
    msg += `User-Agent: GilamOperator/2.0\r\n`;
    msg += `Content-Length: ${Buffer.byteLength(body)}\r\n`;
    msg += `\r\n`;
    msg += body;

    this._send(msg);
  }
}

module.exports = SipUdpEngine;
