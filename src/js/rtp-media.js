const dgram = require('dgram');

/**
 * G.711 PCMU (µ-law) Codec lookup tables
 */
function createUlawTables() {
  const CLIP = 32635;
  const BIAS = 0x84;

  const linearToUlaw = (sample) => {
    let sign = (sample >> 8) & 0x80;
    if (sign !== 0) sample = -sample;
    if (sample > CLIP) sample = CLIP;
    sample = sample + BIAS;
    let exponent = 7;
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
    let mantissa = (sample >> (exponent + 3)) & 0x0F;
    let ulawByte = ~(sign | (exponent << 4) | mantissa);
    return ulawByte & 0xFF;
  };

  const ulawToLinear = (ulawByte) => {
    ulawByte = ~ulawByte;
    let sign = (ulawByte & 0x80);
    let exponent = (ulawByte >> 4) & 0x07;
    let mantissa = ulawByte & 0x0F;
    let sample = ((mantissa << 3) + 132) << exponent;
    sample -= 132;
    return sign !== 0 ? -sample : sample;
  };

  const encodeTable = new Uint8Array(65536);
  for (let i = -32768; i <= 32767; i++) {
    encodeTable[new Int16Array([i])[0] & 0xFFFF] = linearToUlaw(i);
  }

  const decodeTable = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    decodeTable[i] = ulawToLinear(i) / 32768.0;
  }

  return { encodeTable, decodeTable };
}

/**
 * G.711 PCMA (A-law) Codec lookup tables
 */
function createAlawTables() {
  const alawToLinear = (alawByte) => {
    alawByte ^= 0x55;
    let sign = (alawByte & 0x80);
    let exponent = (alawByte & 0x70) >> 4;
    let mantissa = alawByte & 0x0f;
    let sample = (mantissa << 4) + 8;
    if (exponent !== 0) {
      sample += 0x100;
      sample <<= (exponent - 1);
    }
    return sign === 0 ? sample : -sample;
  };

  const decodeTable = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    decodeTable[i] = alawToLinear(i) / 32768.0;
  }
  return { decodeTable };
}

const { encodeTable: ulawEncode, decodeTable: ulawDecode } = createUlawTables();
const { decodeTable: alawDecode } = createAlawTables();

class RtpMediaEngine {
  constructor() {
    this.rtpSocket = null;
    this.audioCtx = null;
    this.audioStream = null;
    this.scriptProcessor = null;
    this.sourceNode = null;
    this.localPort = 0;
    
    this.remoteIp = null;
    this.remotePort = 0;

    this.seq = Math.floor(Math.random() * 65536);
    this.ts = Math.floor(Math.random() * 0xFFFFFFFF);
    this.ssrc = Math.floor(Math.random() * 0xFFFFFFFF);

    this.jitterBuffer = []; // stores decoded Float32 chunks
  }

  start(localPort, remoteIp, remotePort) {
    this.stop();
    this.localPort = localPort;
    this.remoteIp = remoteIp;
    this.remotePort = remotePort;

    console.log(`[RTP] Starting media engine. Local port: ${localPort}, Remote: ${remoteIp}:${remotePort}`);

    // Create UDP socket for RTP
    this.rtpSocket = dgram.createSocket('udp4');
    this.rtpSocket.on('error', (err) => console.error('[RTP] UDP Error:', err));
    
    this.rtpSocket.on('message', (msg, rinfo) => {
      // Decode incoming RTP packets
      if (msg.length <= 12) return;
      const pt = msg[1] & 0x7F;
      // PCMU (0) and PCMA (8) support
      if (pt === 0 || pt === 8) {
        const payload = msg.slice(12);
        const pcmFloat = new Float32Array(payload.length);
        const decoder = (pt === 0) ? ulawDecode : alawDecode;
        
        for (let i = 0; i < payload.length; i++) {
          pcmFloat[i] = decoder[payload[i]];
        }
        
        this.jitterBuffer.push(pcmFloat);
        // Dynamic jitter buffer sizing (10 ~ 200ms at 20ms chunks)
        if (this.jitterBuffer.length > 15) {
          this.jitterBuffer.shift();
        }
      }
    });

    this.rtpSocket.bind(this.localPort, () => {
      console.log(`[RTP] Bound to local port ${this.localPort}`);
      this._startAudioContext();
    });
  }

  async _startAudioContext() {
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 8000 });
    // Use smaller buffer for lower latency
    this.scriptProcessor = this.audioCtx.createScriptProcessor(512, 1, 1);

    let micInputAvailable = false;
    this.sendBuffer = []; // Outgoing microphone buffer
    this.sendInterval = null;

    try {
      if (!navigator.mediaDevices) {
        throw new Error("MediaDevices API bu kompyuterda ishlamaydi.");
      }
      const constraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
      
      // Mikrofonni sozlamalardan o'qish (agar tanlangan bo'lsa)
      if (window.Settings && typeof window.Settings.get === 'function') {
        const savedMicId = window.Settings.get('audio-input');
        if (savedMicId && savedMicId !== 'default') {
          constraints.audio.deviceId = { exact: savedMicId };
        }
      }

      this.audioStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.sourceNode = this.audioCtx.createMediaStreamSource(this.audioStream);
      this.sourceNode.connect(this.scriptProcessor);
      micInputAvailable = true;
      console.log('[RTP] Audio capture started successfully.');
    } catch (err) {
      console.error('[RTP] Audio capture failed:', err);
      // Fallback
    }

    this.scriptProcessor.onaudioprocess = (e) => {
      // 1. Playback
      const outputBuffer = e.outputBuffer.getChannelData(0);
      let outIdx = 0;
      
      while (outIdx < outputBuffer.length && this.jitterBuffer.length > 0) {
        let chunk = this.jitterBuffer[0];
        let space = outputBuffer.length - outIdx;
        if (chunk.length <= space) {
          if (!this.isHold) outputBuffer.set(chunk, outIdx);
          outIdx += chunk.length;
          this.jitterBuffer.shift();
        } else {
          if (!this.isHold) outputBuffer.set(chunk.slice(0, space), outIdx);
          this.jitterBuffer[0] = chunk.slice(space);
          outIdx += space;
        }
      }
      while (outIdx < outputBuffer.length) {
        outputBuffer[outIdx++] = 0;
      }

      // 2. Microphone Capture
      if (micInputAvailable) {
        const inputData = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < inputData.length; i++) {
          this.sendBuffer.push(inputData[i]);
        }
      }
    };

    const outDest = this.audioCtx.createMediaStreamDestination();
    this.scriptProcessor.connect(outDest);

    this.speakerAudio = new Audio();
    this.speakerAudio.style.display = 'none';
    document.body.appendChild(this.speakerAudio);

    this.speakerAudio.srcObject = outDest.stream;
    this.speakerAudio.play().catch(e => console.error('[RTP] Playback failed:', e));

    // Smooth network transmission (20ms)
    this.sendInterval = setInterval(() => {
      // Create silent 160-sample array if no mic or buffer depleted
      let chunk = new Float32Array(160);
      if (this.sendBuffer.length >= 160) {
        for (let i = 0; i < 160; i++) {
          chunk[i] = this.sendBuffer.shift();
        }
      } else if (micInputAvailable) {
        // Buffer starvation, wait for next tick
        return;
      }
      
      const rtpPacket = Buffer.alloc(12 + 160);
      
      rtpPacket[0] = 0x80; // V=2
      rtpPacket[1] = 0x00; // PT=0 (PCMU)
      rtpPacket.writeUInt16BE(this.seq & 0xFFFF, 2); // Seq
      rtpPacket.writeUInt32BE(this.ts >>> 0, 4); // TS
      rtpPacket.writeUInt32BE(this.ssrc >>> 0, 8); // SSRC

      for (let i = 0; i < 160; i++) {
        let pcmInt = chunk[i] * 32767;
        
        // Mutening logic
        if (this.isMuted || this.isHold) {
          pcmInt = 0;
        } else {
          // Asl mic signali tahrir qilinmaydi, AGC orqali tekislanadi
          if (pcmInt > 32767) pcmInt = 32767;
          if (pcmInt < -32768) pcmInt = -32768;
        }
        
        rtpPacket[12 + i] = ulawEncode[pcmInt & 0xFFFF];
      }

      if (this.rtpSocket && this.remoteIp && this.remotePort) {
        this.rtpSocket.send(rtpPacket, 0, rtpPacket.length, this.remotePort, this.remoteIp);
      }

      this.seq++;
      this.ts += 160;
    }, 20); // Exactly every 20ms
  }

  setMute(isMuted) {
    this.isMuted = isMuted;
  }

  setHold(isHold) {
    this.isHold = isHold;
  }

  getMixedStream() {
    if (!this.audioCtx) return null;
    const dest = this.audioCtx.createMediaStreamDestination();
    // scriptProcessor'ning ulanishi "remote audio" ni yozib oladi
    if (this.scriptProcessor) {
      this.scriptProcessor.connect(dest);
    }
    // sourceNode'ning ulanishi "mikrofon (local audio)" ni yozib oladi
    if (this.sourceNode) {
      this.sourceNode.connect(dest);
    }
    return dest.stream;
  }

  stop() {
    console.log('[RTP] Stopping media engine.');
    if (this.sendInterval) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }
    this.sendBuffer = [];
    if (this.speakerAudio) {
      this.speakerAudio.pause();
      this.speakerAudio.srcObject = null;
      if (this.speakerAudio.parentNode) {
        this.speakerAudio.parentNode.removeChild(this.speakerAudio);
      }
      this.speakerAudio = null;
    }
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(t => t.stop());
      this.audioStream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(()=>{});
      this.audioCtx = null;
    }
    if (this.rtpSocket) {
      try { this.rtpSocket.close(); } catch(e) {}
      this.rtpSocket = null;
    }
    this.jitterBuffer = [];
  }
}

module.exports = RtpMediaEngine;
