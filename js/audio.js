/* =========================================================
   audio.js — WebAudio 合成：背景音乐 + 音效（零外部资源）
   ========================================================= */
(function (root) {
  'use strict';

  var BPM = 84;
  var STEP = 60 / BPM / 2; // 八分音符时长

  /* 和弦进行：Am - F - C - G（A 小调，温柔放松） */
  var PROGRESSION = [
    { pad: [220.00, 261.63, 329.63], bass: 110.00 }, // Am
    { pad: [174.61, 220.00, 261.63], bass: 87.31 },  // F
    { pad: [261.63, 329.63, 392.00], bass: 130.81 }, // C
    { pad: [196.00, 246.94, 293.66], bass: 98.00 }   // G
  ];
  var ARP = [0, 1, 2, 1, 0, 2, 1, 2];

  function AudioEngine() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.delay = null;
    this.noiseBuf = null;

    this.musicOn = true;
    this.sfxOn = true;
    this.started = false;
    this.paused = false;

    this.interval = null;
    this.nextTime = 0;
    this.step = 0;

    this.musicLevel = 0.5;
    this.sfxLevel = 0.85;
  }

  AudioEngine.prototype._supported = function () {
    return typeof root.AudioContext !== 'undefined' || typeof root.webkitAudioContext !== 'undefined';
  };

  /** 用户第一次交互时调用：创建 / 恢复音频上下文 */
  AudioEngine.prototype.unlock = function () {
    if (!this._supported()) return;
    try {
      if (!this.ctx) {
        var Ctx = root.AudioContext || root.webkitAudioContext;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.8;
        this.master.connect(this.ctx.destination);

        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = this.musicOn ? this.musicLevel : 0;
        this.musicGain.connect(this.master);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this.sfxOn ? this.sfxLevel : 0;
        this.sfxGain.connect(this.master);

        // 琶音用的回声
        this.delay = this.ctx.createDelay(1.0);
        this.delay.delayTime.value = 0.32;
        var fb = this.ctx.createGain();
        fb.gain.value = 0.3;
        var wet = this.ctx.createGain();
        wet.gain.value = 0.35;
        this.delay.connect(fb);
        fb.connect(this.delay);
        this.delay.connect(wet);
        wet.connect(this.musicGain);

        // 白噪声缓冲
        var len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        var data = this.noiseBuf.getChannelData(0);
        for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

        this.started = true;
        if (this.musicOn) this._startLoop();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) {
      // 静默失败：无声也能玩
      this.ctx = null;
    }
  };

  AudioEngine.prototype._now = function () {
    return this.ctx ? this.ctx.currentTime : 0;
  };

  /* ---------------- 基础发声 ---------------- */

  AudioEngine.prototype._tone = function (opt) {
    if (!this.ctx) return;
    var t0 = this._now() + (opt.delay || 0);
    try {
      var osc = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      osc.type = opt.type || 'sine';
      osc.frequency.setValueAtTime(Math.max(1, opt.freq), t0);
      if (opt.endFreq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, opt.endFreq), t0 + (opt.dur || 0.1));
      }
      var peak = opt.gain == null ? 0.1 : opt.gain;
      var attack = opt.attack == null ? 0.004 : opt.attack;
      var dur = opt.dur == null ? 0.1 : opt.dur;
      var release = opt.release == null ? Math.max(0.02, dur - attack) : opt.release;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(attack + 0.01, dur + release * 0.2));
      osc.connect(g);
      g.connect(opt.dest || this.sfxGain);
      osc.start(t0);
      osc.stop(t0 + dur + release + 0.05);
    } catch (e) { /* ignore */ }
  };

  AudioEngine.prototype._noise = function (opt) {
    if (!this.ctx || !this.noiseBuf) return;
    var t0 = this._now() + (opt.delay || 0);
    try {
      var src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      var filter = this.ctx.createBiquadFilter();
      filter.type = opt.filter || 'bandpass';
      filter.frequency.setValueAtTime(opt.freq || 1200, t0);
      if (opt.endFreq) filter.frequency.exponentialRampToValueAtTime(Math.max(40, opt.endFreq), t0 + opt.dur);
      filter.Q.value = opt.q || 0.8;
      var g = this.ctx.createGain();
      var dur = opt.dur || 0.12;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(opt.gain == null ? 0.12 : opt.gain, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(opt.dest || this.sfxGain);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    } catch (e) { /* ignore */ }
  };

  /* ---------------- 音效 ---------------- */

  AudioEngine.prototype.bounce = function () {
    this._tone({ freq: 520, endFreq: 360, type: 'triangle', dur: 0.05, gain: 0.12 });
  };
  AudioEngine.prototype.paddleHit = function () {
    this._tone({ freq: 260, endFreq: 180, type: 'sine', dur: 0.07, gain: 0.2 });
    this._tone({ freq: 900, endFreq: 700, type: 'triangle', dur: 0.03, gain: 0.06 });
  };
  AudioEngine.prototype.wallHit = function () {
    this._tone({ freq: 320, endFreq: 260, type: 'triangle', dur: 0.04, gain: 0.06 });
  };
  AudioEngine.prototype.brickHit = function (type) {
    var f = type === 'ice' ? 760 : type === 'sturdy' ? 420 : type === 'solid' ? 210 : 560;
    this._tone({ freq: f, endFreq: f * 0.72, type: type === 'solid' ? 'square' : 'triangle', dur: 0.045, gain: 0.09 });
    this._noise({ freq: f * 1.6, endFreq: f, dur: 0.05, gain: 0.05, filter: 'bandpass' });
  };
  AudioEngine.prototype.breakBlock = function (type) {
    var base = type === 'ice' ? 900 : type === 'sturdy' ? 380 : 600;
    this._noise({ freq: base, endFreq: base * 0.35, dur: 0.18, gain: 0.16, filter: 'bandpass', q: 1.2 });
    this._tone({ freq: base, endFreq: base * 0.3, type: 'triangle', dur: 0.14, gain: 0.1 });
    if (type === 'ice') {
      this._tone({ freq: 1500, endFreq: 2200, type: 'sine', dur: 0.08, gain: 0.05 });
    }
  };
  AudioEngine.prototype.powerup = function () {
    var seq = [660, 880, 1174, 1568];
    for (var i = 0; i < seq.length; i++) {
      this._tone({ freq: seq[i], type: 'triangle', dur: 0.09, gain: 0.1, delay: i * 0.055 });
    }
  };
  AudioEngine.prototype.launch = function () {
    this._tone({ freq: 300, endFreq: 780, type: 'triangle', dur: 0.11, gain: 0.1 });
  };
  AudioEngine.prototype.loseLife = function () {
    this._tone({ freq: 330, endFreq: 82, type: 'sawtooth', dur: 0.55, gain: 0.13, release: 0.4 });
    this._noise({ freq: 500, endFreq: 90, dur: 0.4, gain: 0.08, filter: 'lowpass' });
  };
  AudioEngine.prototype.win = function () {
    var seq = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    for (var i = 0; i < seq.length; i++) {
      this._tone({ freq: seq[i], type: 'triangle', dur: 0.16, gain: 0.12, delay: i * 0.11 });
      this._tone({ freq: seq[i] / 2, type: 'sine', dur: 0.2, gain: 0.06, delay: i * 0.11 });
    }
  };
  AudioEngine.prototype.click = function () {
    this._tone({ freq: 820, endFreq: 620, type: 'triangle', dur: 0.035, gain: 0.07 });
  };

  /* ---------------- 背景音乐 ---------------- */

  AudioEngine.prototype._pad = function (chord, t) {
    if (!this.ctx) return;
    for (var i = 0; i < chord.length; i++) {
      try {
        var osc = this.ctx.createOscillator();
        var g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = chord[i];
        var peak = 0.022;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.9);
        g.gain.linearRampToValueAtTime(0.0001, t + STEP * 8 + 0.8);
        osc.connect(g);
        g.connect(this.musicGain);
        osc.start(t);
        osc.stop(t + STEP * 8 + 1.0);
      } catch (e) { /* ignore */ }
    }
  };

  AudioEngine.prototype._bass = function (freq, t) {
    if (!this.ctx) return;
    try {
      var osc = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.075, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + STEP * 2);
      osc.connect(g);
      g.connect(this.musicGain);
      osc.start(t);
      osc.stop(t + STEP * 2 + 0.05);
    } catch (e) { /* ignore */ }
  };

  AudioEngine.prototype._pluck = function (freq, t, gain) {
    if (!this.ctx) return;
    try {
      var osc = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
      osc.connect(g);
      g.connect(this.musicGain);
      if (this.delay) {
        var send = this.ctx.createGain();
        send.gain.value = 0.5;
        g.connect(send);
        send.connect(this.delay);
      }
      osc.start(t);
      osc.stop(t + 0.45);
    } catch (e) { /* ignore */ }
  };

  AudioEngine.prototype._hat = function (t) {
    if (!this.ctx || !this.noiseBuf) return;
    try {
      var src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      var f = this.ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 6000;
      var g = this.ctx.createGain();
      g.gain.setValueAtTime(0.012, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(f);
      f.connect(g);
      g.connect(this.musicGain);
      src.start(t);
      src.stop(t + 0.06);
    } catch (e) { /* ignore */ }
  };

  AudioEngine.prototype._scheduleStep = function (t) {
    var bar = Math.floor(this.step / 8) % PROGRESSION.length;
    var chord = PROGRESSION[bar];
    var inChord = this.step % 8;

    if (inChord === 0) {
      this._pad(chord.pad, t);
    }
    if (inChord === 0 || inChord === 4) {
      this._bass(chord.bass, t);
    }
    if (inChord % 2 === 0) {
      var note = chord.pad[ARP[inChord % ARP.length]] * 2;
      this._pluck(note, t, 0.028);
    }
    if (inChord % 2 === 1) {
      this._hat(t);
    }
    if (this.step % 16 === 0) {
      // 偶尔来一颗高音星星
      this._pluck(chord.pad[2] * 4, t + 0.1, 0.012);
    }
  };

  AudioEngine.prototype._startLoop = function () {
    if (!this.ctx || this.interval) return;
    var self = this;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.step = 0;
    this.interval = setInterval(function () {
      if (!self.ctx) return;
      try {
        while (self.nextTime < self.ctx.currentTime + 0.25) {
          self._scheduleStep(self.nextTime);
          self.nextTime += STEP;
          self.step++;
        }
      } catch (e) { /* ignore */ }
    }, 80);
  };

  AudioEngine.prototype._stopLoop = function () {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  };

  /* ---------------- 开关 ---------------- */

  AudioEngine.prototype.setMusic = function (on) {
    this.musicOn = !!on;
    if (this.musicGain) {
      this.musicGain.gain.setTargetAtTime(this.musicOn && !this.paused ? this.musicLevel : 0, this._now(), 0.08);
    }
    if (this.musicOn) {
      if (this.ctx && this.started) this._startLoop();
    } else {
      this._stopLoop();
    }
  };

  AudioEngine.prototype.setSfx = function (on) {
    this.sfxOn = !!on;
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxOn ? this.sfxLevel : 0;
  };

  AudioEngine.prototype.setPaused = function (p) {
    this.paused = !!p;
    if (this.musicGain) {
      var target = this.musicOn && !this.paused ? this.musicLevel : (this.musicOn ? 0.06 : 0);
      this.musicGain.gain.setTargetAtTime(target, this._now(), 0.15);
    }
  };

  root.BRAudio = AudioEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = AudioEngine;
})(typeof window !== 'undefined' ? window : globalThis);
