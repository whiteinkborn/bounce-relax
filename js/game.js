/* =========================================================
   game.js — 弹弹解压 · 主逻辑
   ========================================================= */
(function () {
  'use strict';

  var Rules = window.BRRules;
  var Physics = window.BRPhysics;
  var Levels = window.BRLevels;
  var Audio = window.BRAudio;

  /* ---------------- 常量 ---------------- */
  var W = 960;
  var H = 640;
  var BASE_PADDLE_W = 130;
  var PADDLE_H = 14;
  var PADDLE_Y = H - 48;
  var BALL_R = 7;
  var POWER_BALL_R = 8.5;
  var MAX_ITEMS = 9;
  var MAX_GRID_ROWS = 19;     // 无尽模式墙体最多生成到第 19 行（地图 20 行）
  var MAX_FIELD_BLOCKS = 280; // 场景内方块总数上限（性能保护）
  var SAVE_KEY = 'bounceRelax.save.v1';
  var FONT = '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';

  var BLOCK_STYLE = {
    normal: { top: '#7fe9ff', mid: '#2fb8e8', bottom: '#137ea8', border: '#0b5f80', glow: 'rgba(77, 217, 255, 0.5)' },
    sturdy: { top: '#ffd08a', mid: '#f0a13e', bottom: '#b96a16', border: '#8a4c0c', glow: 'rgba(255, 178, 88, 0.45)' },
    ice:    { top: '#eaf9ff', mid: '#9adcff', bottom: '#5fb6ef', border: '#3a8dbf', glow: 'rgba(190, 235, 255, 0.6)' },
    solid:  { top: '#aebfd4', mid: '#7d8fa8', bottom: '#4c5a70', border: '#333d4d', glow: 'rgba(160, 180, 210, 0.25)' }
  };

  var MODE_LABEL = { campaign: '闯关', challenge: '挑战', endless: '无尽', relax: '解压' };

  /* ---------------- DOM ---------------- */
  function $(id) { return document.getElementById(id); }

  var el = {};
  var canvas, ctx;

  /* ---------------- 状态 ---------------- */
  var save = {
    campaignUnlocked: 1,
    challengeBest: 0,
    endlessBest: 0,
    music: true,
    sound: true
  };

  var G = {
    dpr: 1,
    state: 'menu',
    prevState: null,
    mode: 'campaign',
    levelIndex: 1,
    wave: 1,
    relaxRound: 1,
    nextWaveIn: 0,
    nextBlockId: 100000,
    sinceDrop: 0,
    destroyedTotal: 0,
    clearCooldown: 0,
    fieldClearAwarded: false,
    score: 0,
    lives: 3,
    level: null,
    blocks: [],
    balls: [],
    items: [],
    particles: [],
    floats: [],
    ambient: [],
    paddle: { x: W / 2 - BASE_PADDLE_W / 2, y: PADDLE_Y, w: BASE_PADDLE_W, h: PADDLE_H, vx: 0, targetX: W / 2, squash: 0 },
    combo: 0,
    comboTimer: 0,
    slowTime: 0,
    widenTime: 0,
    shake: 0,
    flash: 0,
    now: 0,
    levelTime: 0,
    clearTimer: 0,
    overTimer: 0,
    winFlag: false,
    lastWallSfx: 0,
    audio: null,
    keys: { left: false, right: false },
    touch: { left: false, right: false },
    pointerActive: false,
    lastFrame: 0,
    toastTimer: null,
    pendingNext: null,
    hudCache: {}
  };

  /* =========================================================
     存档
     ========================================================= */
  function loadSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        if (typeof data.campaignUnlocked === 'number') save.campaignUnlocked = Math.max(1, Math.min(Levels.campaignCount(), data.campaignUnlocked));
        if (typeof data.challengeBest === 'number') save.challengeBest = data.challengeBest;
        if (typeof data.endlessBest === 'number') save.endlessBest = data.endlessBest;
        if (typeof data.music === 'boolean') save.music = data.music;
        if (typeof data.sound === 'boolean') save.sound = data.sound;
      }
    } catch (e) { /* ignore */ }
  }

  function persist() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch (e) { /* ignore */ }
  }

  /* =========================================================
     工具
     ========================================================= */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /** 不同模式的弹珠数量上限：解压模式为了"爽"给得最多 */
  function maxBalls() {
    if (G.mode === 'relax') return 45;
    if (G.mode === 'endless') return 32;
    return 24;
  }

  /** 解压模式挡板更宽，降低焦虑感 */
  function basePaddleWidth() {
    return G.mode === 'relax' ? 160 : BASE_PADDLE_W;
  }

  function roundRect(c, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function showScreen(id) {
    var screens = ['screen-menu', 'screen-levels', 'screen-pause', 'screen-win', 'screen-keep', 'screen-over'];
    for (var i = 0; i < screens.length; i++) el[screens[i]].hidden = true;
    if (id) el[id].hidden = false;
  }

  function showHUD(show) {
    el.hud.hidden = !show;
  }

  function showToast(msg, ms) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    if (G.toastTimer) clearTimeout(G.toastTimer);
    G.toastTimer = setTimeout(function () { el.toast.hidden = true; }, ms || 1800);
  }

  /* =========================================================
     音效 / 音乐开关
     ========================================================= */
  function applyAudioPrefs() {
    if (!G.audio) return;
    G.audio.setMusic(save.music);
    G.audio.setSfx(save.sound);
    updateAudioButtons();
  }

  function updateAudioButtons() {
    el['btn-music'].setAttribute('aria-pressed', String(save.music));
    el['btn-sound'].setAttribute('aria-pressed', String(save.sound));
    el['btn-music'].title = '背景音乐：' + (save.music ? '开' : '关') + ' (M)';
    el['btn-sound'].title = '音效：' + (save.sound ? '开' : '关') + ' (N)';
    el['btn-menu-music'].setAttribute('aria-pressed', String(save.music));
    el['btn-menu-sound'].setAttribute('aria-pressed', String(save.sound));
    el['btn-menu-music'].textContent = save.music ? '♫ 音乐' : '♫ 音乐 关';
    el['btn-menu-sound'].textContent = save.sound ? '🔊 音效' : '🔇 音效 关';
  }

  function toggleMusic() {
    save.music = !save.music;
    persist();
    applyAudioPrefs();
    if (G.audio) G.audio.click();
  }
  function toggleSound() {
    save.sound = !save.sound;
    persist();
    applyAudioPrefs();
    if (G.audio && save.sound) G.audio.click();
  }

  /* =========================================================
     菜单
     ========================================================= */
  function updateMenuInfo() {
    el['campaign-progress'].textContent = Math.min(save.campaignUnlocked - 1, Levels.campaignCount()) + '/' + Levels.campaignCount();
    el['challenge-best'].textContent = '最高 ' + save.challengeBest;
    if (el['endless-best']) el['endless-best'].textContent = '最远 ' + save.endlessBest + ' 波';
    updateAudioButtons();
  }

  function showMenu() {
    G.state = 'menu';
    G.level = null;
    G.blocks = [];
    G.balls = [];
    G.items = [];
    G.particles = [];
    G.floats = [];
    G.audio.setPaused(false);
    showHUD(false);
    showScreen('screen-menu');
    updateMenuInfo();
    if (G.audio) G.audio.setMusic(save.music);
  }

  function showLevels() {
    buildLevelGrid();
    showScreen('screen-levels');
  }

  function buildLevelGrid() {
    var grid = el['level-grid'];
    grid.innerHTML = '';
    for (var i = 1; i <= Levels.campaignCount(); i++) {
      (function (n) {
        var unlocked = n <= save.campaignUnlocked;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'level-btn' + (unlocked ? '' : ' locked');
        btn.innerHTML = n + '<small>' + (unlocked ? Levels.CAMPAIGN[n - 1].name : '未解锁') + '</small>';
        if (!unlocked) btn.disabled = true;
        btn.addEventListener('click', function () {
          if (G.audio) { G.audio.unlock(); G.audio.click(); }
          startCampaign(n);
        });
        grid.appendChild(btn);
      })(i);
    }
  }

  /* =========================================================
     开始游戏
     ========================================================= */
  function resetRun(mode) {
    G.mode = mode;
    G.score = 0;
    G.lives = Rules.MODE_CONFIG[mode].lives;
    G.combo = 0;
    G.comboTimer = 0;
    G.slowTime = 0;
    G.widenTime = 0;
    G.winFlag = false;
    G.overTimer = 0;
    G.clearTimer = 0;
    G.clearCooldown = 0;
    G.fieldClearAwarded = false;
    G.wave = 1;
    G.relaxRound = 1;
    G.nextWaveIn = 0;
    G.nextBlockId = 100000;
    G.sinceDrop = 0;
    G.destroyedTotal = 0;
    G.paddle.w = basePaddleWidth();
    G.paddle.x = W / 2 - G.paddle.w / 2;
    G.paddle.targetX = W / 2;
    if (G.audio) G.audio.unlock();
  }

  function startCampaign(levelNumber) {
    resetRun('campaign');
    G.levelIndex = clamp(levelNumber || save.campaignUnlocked, 1, Levels.campaignCount());
    loadLevel(Levels.campaignLevel(G.levelIndex));
    if (G.audio) G.audio.click();
  }

  function startChallenge() {
    resetRun('challenge');
    G.relaxRound = 1;
    loadLevel(Levels.generateChamberLevel(undefined, 'challenge'));
    showToast('挑战：窄门钢舱，把弹珠送进缺口再清空', 2600);
    if (G.audio) G.audio.click();
  }

  function startEndless() {
    resetRun('endless');
    G.wave = 1;
    loadLevel(Levels.generateChallengeLevel(1));
    G.nextWaveIn = challengeInterval();
    showToast('无尽：墙体不断生成，弹珠永不重置，能撑多久？', 2600);
    if (G.audio) G.audio.click();
  }

  function startRelax() {
    resetRun('relax');
    loadLevel(Levels.generateRelaxLevel());
    showToast('解压：每颗球的第一次碰撞可以穿过钢板，直接进舱', 2800);
    if (G.audio) G.audio.click();
  }

  function loadLevel(level) {
    G.state = 'playing';
    G.level = level;
    G.blocks = level.blocks;
    G.balls = [];
    G.items = [];
    G.particles = [];
    G.floats = [];
    G.combo = 0;
    G.comboTimer = 0;
    G.slowTime = 0;
    G.widenTime = 0;
    G.paddle.w = basePaddleWidth();
    G.paddle.x = W / 2 - G.paddle.w / 2;
    G.paddle.targetX = W / 2;
    G.clearTimer = 0;
    G.winFlag = false;
    G.overTimer = 0;
    G.clearCooldown = 0;
    G.fieldClearAwarded = false;
    G.nextBlockId = 100000;
    G.levelTime = 0;
    G.flash = 0;
    G.shake = 0;
    G.nextWaveIn = G.mode === 'endless' ? challengeInterval() : 0;
    spawnAttachedBall();
    hideScreens();
    showHUD(true);
    updateHud(true);
    showToast(level.name + (level.hint ? ' · ' + level.hint : ''), 2200);
  }

  function spawnAttachedBall() {
    var b = {
      x: G.paddle.x + G.paddle.w / 2,
      y: G.paddle.y - BALL_R - 1,
      r: BALL_R,
      dir: { x: 0, y: -1 },
      speed: G.level ? G.level.speed : 380,
      power: false,
      stuck: true,
      phase: G.mode === 'relax',
      phaseTimer: 0,
      trail: [],
      cooldowns: {}
    };
    G.balls.push(b);
  }

  function hiddenScreens() {
    var screens = ['screen-menu', 'screen-levels', 'screen-pause', 'screen-win', 'screen-keep', 'screen-over'];
    for (var i = 0; i < screens.length; i++) el[screens[i]].hidden = true;
  }
  function hideScreens() { hiddenScreens(); }

  /* =========================================================
     核心更新
     ========================================================= */
  function update(dt) {
    G.now += dt;
    updateAmbient(dt);

    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 5.0);
    if (G.flash > 0) G.flash = Math.max(0, G.flash - dt * 2.2);

    if (G.state === 'menu' || G.state === 'paused' || G.state === 'keepask') return;

    updateParticles(dt);
    updateFloats(dt);

    if (G.state === 'gameover' || G.state === 'win') return;

    if (G.state === 'dying') {
      G.overTimer -= dt;
      if (G.overTimer <= 0) showGameOver();
      return;
    }

    if (G.state === 'clearing') {
      G.clearTimer -= dt;
      updatePlaying(dt, true);
      if (G.clearTimer <= 0) {
        if (G.mode === 'campaign') {
          if (G.levelIndex >= Levels.campaignCount()) showWin();
          else showKeepPrompt();
        } else if (G.mode === 'challenge' || G.mode === 'relax') {
          showKeepPrompt();
        } else {
          showWin();
        }
      }
      return;
    }

    if (G.state === 'playing') {
      updatePlaying(dt, false);
    }
  }

  function updatePlaying(dt, allowMove) {
    updatePaddle(dt);
    updateTimers(dt);
    if (allowMove) {
      updateBalls(dt, false);
    } else {
      updateBalls(dt, true);
    }
    updateItems(dt);
    G.levelTime += dt;

    if (G.state === 'playing') {
      if (G.mode === 'endless') challengeTick(dt);
      if (G.balls.length === 0 && !G.winFlag) {
        loseLife();
      } else if (!G.winFlag && G.clearCooldown <= 0 && Rules.countBreakable(G.blocks) === 0) {
        handleFieldClear();
      }
    }
  }

  /* ---------------- 挑战模式：无尽墙体生成 ---------------- */

  /** 波次越快，间隔越短 */
  function challengeInterval() {
    return Math.max(3.4, 7.6 - (G.wave || 1) * 0.16);
  }

  function challengeTick(dt) {
    G.nextWaveIn -= dt;
    if (G.nextWaveIn <= 0) {
      var ok = spawnChallengeWave();
      G.nextWaveIn = ok ? challengeInterval() : 1.4;
    }
  }

  /**
   * 在场地空位里生成一小波墙体；成功则波次 +1、球速提升。
   * 关键：**不改动任何已有弹珠**，这就是无尽模式的手感。
   */
  function spawnChallengeWave() {
    /* 清掉已摧毁的方块，避免数组无限膨胀 */
    G.blocks = G.blocks.filter(function (b) { return b.alive; });
    if (G.blocks.length > MAX_FIELD_BLOCKS) return false;
    if (Rules.countBreakable(G.blocks) > 64) return false;

    var waveDef = Levels.generateChallengeWave(G.wave + 1);
    var occ = Levels.occupancyFromBlocks(G.blocks, MAX_GRID_ROWS + 1);
    var top = Levels.findPlacement(waveDef.pattern, occ, MAX_GRID_ROWS - waveDef.pattern.length + 1);
    if (top == null) return false;

    var blocks = Levels.buildPatternBlocks(waveDef.pattern, top, G.nextBlockId);
    G.nextBlockId += blocks.length;
    G.blocks = G.blocks.concat(blocks);
    G.wave += 1;
    G.fieldClearAwarded = false;

    var speed = Rules.ballSpeedFor('endless', G.wave);
    G.level.speed = speed;
    for (var i = 0; i < G.balls.length; i++) {
      if (!G.balls[i].stuck) G.balls[i].speed = speed;
    }

    /* 每波附赠一个道具，帮助滚雪球 */
    if (G.items.length < MAX_ITEMS) spawnItem(rand(100, W - 100), 86);

    addFloat('第 ' + G.wave + ' 波', W / 2, 150, '#4dd9ff');
    for (var k = 0; k < 3; k++) {
      addBurst(rand(120, W - 120), rand(120, 300), '#4dd9ff', '#b388ff', 10);
    }
    G.shake = Math.max(G.shake, 0.08);
    return true;
  }

  /** 场地被打空时的分流处理：闯关过关 / 挑战无尽 / 解压换场景 */
  function handleFieldClear() {
    if (G.clearCooldown > 0 || G.fieldClearAwarded) return;

    if (G.mode === 'campaign') {
      triggerClear();
      return;
    }

    G.clearCooldown = 1.2;
    G.fieldClearAwarded = true;
    var bonus;

    if (G.mode === 'challenge') {
      bonus = 250 + G.relaxRound * 40;
      G.score += bonus;
      addFloat('全清 +' + bonus, W / 2, 260, '#ffd166');
      for (var i = 0; i < 4; i++) {
        addBurst(rand(100, W - 100), rand(120, 320), '#ffd166', '#ffffff', 14);
      }
      save.challengeBest = Math.max(save.challengeBest, G.score);
      persist();
      G.state = 'clearing';
      G.clearTimer = 1.25;
    } else if (G.mode === 'endless') {
      bonus = 250 + G.wave * 40;
      G.score += bonus;
      addFloat('全清 +' + bonus, W / 2, 260, '#ffd166');
      for (var i2 = 0; i2 < 4; i2++) {
        addBurst(rand(100, W - 100), rand(120, 320), '#ffd166', '#ffffff', 14);
      }
      spawnChallengeWave();
      G.nextWaveIn = challengeInterval();
    } else {
      bonus = 200 + G.relaxRound * 30;
      G.score += bonus;
      addFloat('全清 +' + bonus, W / 2, 260, '#ffd166');
      G.state = 'clearing';
      G.clearTimer = 1.25;
    }

    G.shake = Math.max(G.shake, 0.22);
    updateHud(true);
  }

  /** 挑战模式：清空后自动进入下一波（不需要点按钮） */
  function advanceChallenge() {
    G.wave++;
    G.fieldClearAwarded = false;
    loadLevel(Levels.generateChallengeLevel(G.wave));
    G.state = 'playing';
    if (G.audio) G.audio.setPaused(false);
    updateHud(true);
  }

  /** 挑战/解压：换一个钢舱（弹珠由 proceedNext 决定是否保留） */
  function nextChamber() {
    var lv = Levels.generateChamberLevel(undefined, G.mode === 'challenge' ? 'challenge' : 'relax');
    G.level = lv;
    G.blocks = lv.blocks;
    G.items = [];
    G.particles = [];
    G.floats = [];
    G.balls = [];
    G.relaxRound = (G.relaxRound || 1) + 1;
    G.clearCooldown = 1.0;
    G.fieldClearAwarded = false;
    G.winFlag = false;
    G.state = 'playing';
    for (var i = 0; i < 5; i++) {
      addBurst(rand(100, W - 100), rand(120, 360), '#5cf2b6', '#ffffff', 16);
    }
    showToast('新舱：' + lv.name, 1400);
    updateHud(true);
  }

  function updateTimers(dt) {
    if (G.comboTimer > 0) {
      G.comboTimer -= dt;
      if (G.comboTimer <= 0) G.combo = 0;
    }
    if (G.clearCooldown > 0) G.clearCooldown = Math.max(0, G.clearCooldown - dt);
    if (G.slowTime > 0) {
      G.slowTime = Math.max(0, G.slowTime - dt);
    }
    if (G.widenTime > 0) {
      G.widenTime = Math.max(0, G.widenTime - dt);
      if (G.widenTime === 0) setPaddleWidth(basePaddleWidth());
    }
  }

  function setPaddleWidth(width) {
    var p = G.paddle;
    var cx = p.x + p.w / 2;
    p.w = width;
    p.x = clamp(cx - p.w / 2, 0, W - p.w);
    p.targetX = clamp(p.targetX, p.w / 2, W - p.w / 2);
  }

  function updatePaddle(dt) {
    var p = G.paddle;
    var speed = 760;
    if (G.keys.left || G.touch.left) p.targetX -= speed * dt;
    if (G.keys.right || G.touch.right) p.targetX += speed * dt;
    p.targetX = clamp(p.targetX, p.w / 2, W - p.w / 2);

    var cx = p.x + p.w / 2;
    var k = Math.min(1, dt * 20);
    var nx = cx + (p.targetX - cx) * k;
    p.vx = (nx - cx) / Math.max(dt, 0.001);
    p.x = clamp(nx - p.w / 2, 0, W - p.w);
    p.squash = Math.max(0, p.squash - dt * 4.5);
  }

  function updateBalls(dt, collide) {
    var slow = G.slowTime > 0 ? 0.78 : 1;
    for (var i = G.balls.length - 1; i >= 0; i--) {
      var b = G.balls[i];
      if (b.stuck) {
        b.x = G.paddle.x + G.paddle.w / 2;
        b.y = G.paddle.y - b.r - 1;
        b.trail.length = 0;
        continue;
      }
      if (b.phaseTimer > 0) b.phaseTimer = Math.max(0, b.phaseTimer - dt);

      if (b.trail.length === 0 || Math.abs(b.trail[b.trail.length - 1].x - b.x) + Math.abs(b.trail[b.trail.length - 1].y - b.y) > 6) {
        b.trail.push({ x: b.x, y: b.y, a: 1 });
        if (b.trail.length > (G.lowFX ? 5 : 8)) b.trail.shift();
      }
      for (var t = 0; t < b.trail.length; t++) b.trail[t].a *= 0.86;

      var dist = b.speed * slow * dt;
      var steps = Physics.substeps(b.dir.x * dist, b.dir.y * dist, Math.max(3, b.r * 0.9));
      var stepDist = dist / steps;
      var dead = false;

      for (var s = 0; s < steps; s++) {
        b.x += b.dir.x * stepDist;
        b.y += b.dir.y * stepDist;

        /* 左右墙 */
        if (b.x - b.r < 0) {
          b.x = b.r;
          b.dir = Physics.reflect(b.dir, 1, 0);
          wallSfx();
        } else if (b.x + b.r > W) {
          b.x = W - b.r;
          b.dir = Physics.reflect(b.dir, -1, 0);
          wallSfx();
        }

        /* 顶墙 */
        if (b.y - b.r < 0) {
          b.y = b.r;
          b.dir = Physics.reflect(b.dir, 0, 1);
          wallSfx();
        }

        /* 挡板 */
        if (collide && b.dir.y > 0) {
          if (hitPaddle(b)) {
            b.dir = Physics.paddleBounce(b.x, G.paddle);
            b.dir = Physics.ensureVertical(b.dir, 0.3);
            b.y = G.paddle.y - b.r - 0.5;
            G.paddle.squash = 1;
            G.combo = 0;
            if (G.audio) G.audio.paddleHit();
            spawnSparks(b.x, G.paddle.y, '#7fe9ff', 4, 120);
          }
        }

        /* 墙块 */
        if (collide) {
          var blockHit = hitBlocks(b);
          if (blockHit) {
            b.x += blockHit.nx * (blockHit.depth + 0.8);
            b.y += blockHit.ny * (blockHit.depth + 0.8);
            b.dir = Physics.reflect(b.dir, blockHit.nx, blockHit.ny);
            b.dir = Physics.ensureVertical(b.dir, 0.16);
          }
        }

        /* 掉出屏幕 */
        if (b.y - b.r > H + 8) {
          dead = true;
          break;
        }
      }

      if (dead) {
        G.balls.splice(i, 1);
        spawnSparks(b.x, H - 4, '#ff5c8a', 8, 160);
        if (G.balls.length > 0 && G.audio) G.audio.wallHit();
      }
    }
  }

  function wallSfx() {
    if (G.now - G.lastWallSfx > 0.05) {
      G.lastWallSfx = G.now;
      if (G.audio) G.audio.wallHit();
    }
  }

  function hitPaddle(b) {
    var p = G.paddle;
    if (b.y + b.r >= p.y && b.y - b.r <= p.y + p.h + 2) {
      // 只处理从上方接触的情况，避免球从侧面/下方穿入被判成反弹
      if (b.y < p.y + p.h * 0.5 && b.x + b.r >= p.x && b.x - b.r <= p.x + p.w) {
        return true;
      }
    }
    return false;
  }

  function hitBlocks(b) {
    for (var i = 0; i < G.blocks.length; i++) {
      var blk = G.blocks[i];
      if (!blk.alive) continue;
      var hit = Physics.circleRectHit(b, blk);
      if (!hit) continue;

      /* 解压模式：每颗球第一次碰到钢板直接穿过去（不反弹、不消耗冷却） */
      if (!blk.breakable && G.mode === 'relax' && (b.phase || b.phaseTimer > 0)) {
        if (b.phase) {
          b.phase = false;
          b.phaseTimer = 0.2;
          spawnSparks(b.x, b.y, '#7fe9ff', 10, 180);
          addFloat('穿透钢板', b.x, b.y - 18, '#7fe9ff');
          if (G.audio) G.audio.launch();
        }
        continue;
      }

      var key = blk.id;
      var last = b.cooldowns[key];
      if (last != null && G.now - last < 0.08) {
        return hit;
      }
      b.cooldowns[key] = G.now;

      handleBlockHit(blk, b, hit);
      return hit;
    }
    return null;
  }

  function handleBlockHit(blk, ball, hit) {
    blk.flash = 1;
    blk.wobble = 1;

    /* 解压模式：一旦碰到舱内可破坏方块，穿墙机会就消耗掉，避免之后从里面穿出去 */
    if (blk.breakable && G.mode === 'relax' && ball.phase) ball.phase = false;

    if (!blk.breakable) {
      /* 解压模式：每颗球第一次碰到钢板直接穿过去 */
      if (G.mode === 'relax' && (ball.phase || ball.phaseTimer > 0)) {
        if (ball.phase) {
          ball.phase = false;
          ball.phaseTimer = 0.18;
          spawnSparks(ball.x, ball.y, '#7fe9ff', 10, 180);
          addFloat('穿透钢板', ball.x, ball.y - 18, '#7fe9ff');
          if (G.audio) G.audio.launch();
        }
        return;
      }
      if (G.audio) G.audio.brickHit('solid');
      spawnSparks(ball.x, ball.y, '#c3d2e8', 4, 150);
      G.shake = Math.max(G.shake, 0.10);
      return;
    }

    var dmg = ball.power ? 2 : 1;
    var res = Rules.applyDamage(blk, dmg);

    if (res.destroyed) {
      destroyBlock(blk, ball);
    } else {
      if (G.audio) G.audio.brickHit(blk.type);
      spawnSparks(blk.x + blk.w / 2, blk.y + blk.h / 2, BLOCK_STYLE[blk.type].top, 6, 170);
      G.combo++;
      G.comboTimer = 2.4;
    }
  }

  function destroyBlock(blk, ball) {
    blk.alive = false;
    G.combo++;
    G.comboTimer = 2.4;
    var mult = Rules.comboMultiplier(G.combo);
    var style = BLOCK_STYLE[blk.type];
    var score = Rules.BLOCK_TYPES[blk.type].score * mult;
    G.score += score;

    addBurst(blk.x + blk.w / 2, blk.y + blk.h / 2, style.mid, style.top, blk.breakable ? 16 : 8);
    if (G.combo >= 3) {
      addFloat('+' + score, blk.x + blk.w / 2, blk.y + blk.h / 2, G.combo >= 6 ? '#ffd166' : '#bff3ff');
    }
    if (G.audio) G.audio.breakBlock(blk.type);
    G.shake = Math.max(G.shake, blk.type === 'ice' ? 0.18 : 0.10);
    G.destroyedTotal++;

    /* 掉落道具：解压模式保底——每打碎 3 块必掉一个 */
    var shouldDrop;
    if (G.mode === 'relax') {
      G.sinceDrop++;
      shouldDrop = G.sinceDrop >= 3 || Rules.rollDrop(G.level.dropRate);
      if (shouldDrop) G.sinceDrop = 0;
    } else {
      shouldDrop = Rules.rollDrop(G.level.dropRate);
    }
    if (shouldDrop && G.items.length < MAX_ITEMS) {
      spawnItem(blk.x + blk.w / 2, blk.y + blk.h / 2);
    }

    /* 冰晶碎裂时给一点小白花 */
    if (blk.type === 'ice') {
      spawnSparks(blk.x + blk.w / 2, blk.y + blk.h / 2, '#ffffff', 8, 220);
    }
  }

  /* ---------------- 掉落物 ---------------- */
  function spawnItem(x, y) {
    var type = Rules.rollPowerupType();
    G.items.push({
      x: x,
      y: y,
      vy: rand(125, 175),
      type: type,
      phase: rand(0, Math.PI * 2),
      scale: 1
    });
  }

  function updateItems(dt) {
    var p = G.paddle;
    for (var i = G.items.length - 1; i >= 0; i--) {
      var it = G.items[i];
      it.y += it.vy * dt;
      it.phase += dt * 3.2;

      var box = { x: p.x, y: p.y, w: p.w, h: p.h };
      if (Physics.rectsOverlap({ x: it.x - 14, y: it.y - 14, w: 28, h: 28 }, box)) {
        applyPowerup(it.type, it.x, it.y);
        G.items.splice(i, 1);
        continue;
      }

      /* 解压模式：弹珠自己也能接道具，球在钢壳里就能滚雪球 */
      if (G.mode === 'relax') {
        var caught = false;
        for (var b = 0; b < G.balls.length; b++) {
          var ball = G.balls[b];
          var dx = ball.x - it.x;
          var dy = ball.y - it.y;
          if (dx * dx + dy * dy <= (ball.r + 15) * (ball.r + 15)) {
            applyPowerup(it.type, it.x, it.y, ball);
            G.items.splice(i, 1);
            caught = true;
            break;
          }
        }
        if (caught) continue;
      }

      if (it.y > H + 30) G.items.splice(i, 1);
    }
  }

  function applyPowerup(type, px, py, srcBall) {
    var meta = Rules.POWERUP_META[type];
    var fx = px == null ? G.paddle.x + G.paddle.w / 2 : px;
    var fy = py == null ? G.paddle.y : py;
    if (G.audio) G.audio.powerup();
    addFloat(meta.name, fx, fy - 26, meta.color);
    spawnSparks(fx, fy, meta.color, 14, 220);
    G.flash = 0.25;

    switch (type) {
      case 'split': {
        var source = null;
        if (srcBall && !srcBall.stuck) source = srcBall;
        var launched = G.balls.filter(function (b) { return !b.stuck; });
        if (launched.length) source = pick(launched);
        else if (G.balls.length) source = pick(G.balls);
        if (!source) break;
        var baseDir = source.stuck ? { x: 0, y: -1 } : source.dir;
        var angles = [-0.42, 0, 0.42];
        for (var i = 0; i < angles.length; i++) {
          if (G.balls.length >= maxBalls()) break;
          var d = Physics.rotate(baseDir, angles[i]);
          G.balls.push(makeBall(source.x, source.y, d, source.speed, source.power));
        }
        break;
      }
      case 'spawn': {
        for (var j = 0; j < 2; j++) {
          if (G.balls.length >= maxBalls()) break;
          if (srcBall && !srcBall.stuck) {
            var dir2 = Physics.rotate(srcBall.dir, j === 0 ? -0.5 : 0.5);
            G.balls.push(makeBall(srcBall.x, srcBall.y, dir2, srcBall.speed, srcBall.power));
          } else {
            var dir = { x: j === 0 ? -0.32 : 0.32, y: -1 };
            G.balls.push(makeBall(G.paddle.x + G.paddle.w / 2, G.paddle.y - BALL_R - 2, dir, G.level.speed, false));
          }
        }
        break;
      }
      case 'power': {
        var target = null;
        if (srcBall && !srcBall.power) target = srcBall;
        var candidates = G.balls.filter(function (b) { return !b.power; });
        if (!target) target = candidates.length ? pick(candidates) : (G.balls.length ? pick(G.balls) : null);
        if (target) {
          target.power = true;
          target.r = POWER_BALL_R;
          addBurst(target.x, target.y, '#ff7a45', '#ffd166', 18);
        }
        break;
      }
      case 'widen': {
        G.widenTime = Rules.POWERUP_DURATION.widen;
        setPaddleWidth(Math.min(250, basePaddleWidth() * 1.45));
        break;
      }
      case 'slow': {
        G.slowTime = Rules.POWERUP_DURATION.slow;
        break;
      }
    }
    updateHud(true);
  }

  function makeBall(x, y, dir, speed, power) {
    return {
      x: x,
      y: y,
      r: power ? POWER_BALL_R : BALL_R,
      dir: Physics.normalize(dir.x, dir.y),
      speed: speed,
      power: !!power,
      stuck: false,
      phase: G.mode === 'relax',
      phaseTimer: 0,
      trail: [],
      cooldowns: {}
    };
  }

  /* ---------------- 生命 ---------------- */
  function loseLife() {
    G.lives = Rules.loseLife(G.lives);
    G.combo = 0;
    G.comboTimer = 0;
    G.shake = 0.32;
    G.flash = 0.15;
    if (G.audio) G.audio.loseLife();
    updateHud(true);

    if (G.lives <= 0) {
      G.state = 'dying';
      G.overTimer = 0.9;
      return;
    }

    spawnAttachedBall();
    showToast('生命 -1 · 还剩 ' + G.lives + ' 条', 1600);
  }

  /* ---------------- 通关 ---------------- */
  function triggerClear() {
    G.winFlag = true;
    G.state = 'clearing';
    G.clearTimer = 1.35;
    var bonus = Rules.levelClearBonus(G.level.level, G.lives);
    G.score += bonus;
    G.lives = Rules.livesAfterClear(G.mode, G.lives);
    if (G.audio) G.audio.win();
    G.shake = 0.30;

    for (var i = 0; i < 6; i++) {
      addBurst(rand(80, W - 80), rand(120, 380), '#ffd166', '#ffffff', 18);
    }

    if (G.mode === 'campaign') {
      save.campaignUnlocked = Math.max(save.campaignUnlocked, Math.min(Levels.campaignCount(), G.levelIndex + 1));
    }
    if (G.mode === 'challenge') {
      save.challengeBest = Math.max(save.challengeBest, G.score);
    }
    persist();
    updateHud(true);
  }

  function cloneBall(b) {
    return {
      x: b.x, y: b.y, r: b.r,
      dir: { x: b.dir.x, y: b.dir.y },
      speed: b.speed,
      power: !!b.power,
      stuck: !!b.stuck,
      phase: b.phase,
      phaseTimer: b.phaseTimer || 0,
      trail: [],
      cooldowns: {}
    };
  }

  function snapshotBalls() {
    return G.balls.map(cloneBall);
  }

  function restoreBalls(saved) {
    if (!saved || !saved.length) return;
    var speed = G.level ? G.level.speed : (saved[0].speed || 400);
    G.balls = saved.map(function (b) {
      var nb = cloneBall(b);
      nb.speed = speed;
      nb.phase = G.mode === 'relax';
      nb.phaseTimer = 0;
      nb.x = clamp(nb.x, nb.r, W - nb.r);
      nb.y = clamp(nb.y, nb.r, G.paddle.y - 20);
      return nb;
    });
  }

  function showKeepPrompt() {
    var dest = G.mode === 'campaign' ? '下一关' : '下一个舱';
    G.state = 'keepask';
    G.clearTimer = 0;
    el['keep-title'].textContent = G.mode === 'campaign' ? '通关！' : '清场！';
    el['keep-sub'].textContent = '要保留当前的 ' + G.balls.length + ' 颗弹珠进入' + dest + '吗？';
    el['keep-stats'].innerHTML =
      '<div class="stat"><b>' + G.score + '</b><span>得分</span></div>' +
      '<div class="stat"><b>' + G.balls.length + '</b><span>当前弹珠</span></div>' +
      '<div class="stat"><b>' + G.lives + '</b><span>剩余生命</span></div>';
    el['btn-keep-yes'].textContent = '保留 ' + G.balls.length + ' 颗弹珠进入' + dest;
    el['btn-keep-no'].textContent = '不保留，' + dest + '重新开始（1 颗球）';
    showScreen('screen-keep');
    showHUD(true);
    if (G.audio) G.audio.setPaused(true);
  }

  /** 玩家选择后继续：preserve=true 保留当前弹珠，否则从 1 颗球重新开始 */
  function proceedNext(preserve) {
    var saved = preserve ? snapshotBalls() : null;
    var mode = G.mode;
    if (G.audio) G.audio.setPaused(false);
    hideScreens();
    showHUD(true);
    G.state = 'playing';

    if (mode === 'campaign') {
      if (G.levelIndex >= Levels.campaignCount()) { showMenu(); return; }
      G.levelIndex++;
      loadLevel(Levels.campaignLevel(G.levelIndex));
    } else if (mode === 'challenge' || mode === 'relax') {
      nextChamber();
    }

    if (saved && saved.length) {
      restoreBalls(saved);
      addFloat('保留 ' + saved.length + ' 颗弹珠', W / 2, 240, '#5cf2b6');
    } else if (G.balls.length === 0) {
      spawnAttachedBall();
    }
    updateHud(true);
  }

  function showWin() {
    G.state = 'win';
    showHUD(true);
    var title = el['win-title'];
    var sub = el['win-sub'];
    var stats = el['win-stats'];

    title.textContent = '通关！';
    sub.textContent = G.level.name + (G.levelIndex >= Levels.campaignCount() ? ' · 全部关卡完成！' : '');
    el['btn-next'].textContent = G.levelIndex >= Levels.campaignCount() ? '回到主菜单' : '下一关';

    stats.innerHTML =
      '<div class="stat"><b>' + G.score + '</b><span>得分</span></div>' +
      '<div class="stat"><b>' + G.lives + '</b><span>剩余生命</span></div>' +
      '<div class="stat"><b>' + G.levelTime.toFixed(1) + 's</b><span>用时</span></div>';

    showScreen('screen-win');
    if (G.audio) G.audio.setPaused(true);
  }

  function nextLevel() {
    if (G.mode !== 'campaign') return;
    if (G.levelIndex >= Levels.campaignCount()) {
      showMenu();
      return;
    }
    G.levelIndex++;
    loadLevel(Levels.campaignLevel(G.levelIndex));
    if (G.audio) G.audio.setPaused(false);
  }

  function showGameOver() {
    G.state = 'gameover';
    var newRecord = false;
    if (G.mode === 'challenge') {
      newRecord = G.score > save.challengeBest && G.score > 0;
      save.challengeBest = Math.max(save.challengeBest, G.score);
      persist();
    } else if (G.mode === 'endless') {
      save.endlessBest = Math.max(save.endlessBest, G.wave);
      persist();
    }

    var reached;
    var sub;
    var thirdLabel;
    var thirdValue;

    if (G.mode === 'campaign') {
      reached = '第 ' + G.levelIndex + ' 关';
      sub = '三条命都用完了 · 第 ' + G.levelIndex + ' 关';
      thirdLabel = '已通关';
      thirdValue = Math.max(0, save.campaignUnlocked - 1);
    } else if (G.mode === 'challenge') {
      reached = '第 ' + (G.relaxRound || 1) + ' 关';
      sub = (newRecord ? '新纪录！' : '') + '钢舱挑战清掉 ' + (G.relaxRound || 1) + ' 个舱，砸碎 ' + G.destroyedTotal + ' 块墙';
      thirdLabel = '最高分';
      thirdValue = save.challengeBest;
    } else if (G.mode === 'endless') {
      reached = '第 ' + G.wave + ' 波';
      sub = '无尽模式坚持到第 ' + G.wave + ' 波，砸碎 ' + G.destroyedTotal + ' 块墙';
      thirdLabel = '最远波次';
      thirdValue = save.endlessBest + ' 波';
    } else {
      reached = '第 ' + (G.relaxRound || 1) + ' 关';
      sub = '解压了 ' + (G.relaxRound || 1) + ' 关，砸碎 ' + G.destroyedTotal + ' 块墙';
      thirdLabel = '砸碎';
      thirdValue = G.destroyedTotal;
    }

    el['over-sub'].textContent = sub;
    el['over-stats'].innerHTML =
      '<div class="stat"><b>' + G.score + '</b><span>得分</span></div>' +
      '<div class="stat"><b>' + reached + '</b><span>最远</span></div>' +
      '<div class="stat"><b>' + thirdValue + '</b><span>' + thirdLabel + '</span></div>';
    showScreen('screen-over');
    showHUD(true);
    if (G.audio) G.audio.setPaused(true);
  }

  /* ---------------- 重开 / 暂停 / 返回 ---------------- */
  function restartCurrent() {
    if (G.mode === 'campaign') {
      G.score = 0;
      G.lives = Rules.MODE_CONFIG.campaign.lives;
      loadLevel(Levels.campaignLevel(G.levelIndex));
    } else if (G.mode === 'challenge') {
      G.score = 0;
      G.lives = Rules.MODE_CONFIG.challenge.lives;
      G.relaxRound = 1;
      loadLevel(Levels.generateChamberLevel(undefined, 'challenge'));
    } else if (G.mode === 'endless') {
      G.score = 0;
      G.lives = Rules.MODE_CONFIG.endless.lives;
      G.wave = 1;
      loadLevel(Levels.generateChallengeLevel(1));
      G.nextWaveIn = challengeInterval();
    } else {
      G.score = 0;
      G.lives = Rules.MODE_CONFIG.relax.lives;
      G.relaxRound = 1;
      loadLevel(Levels.generateRelaxLevel());
    }
    if (G.audio) G.audio.setPaused(false);
  }

  function togglePause() {
    if (G.state === 'paused') {
      resumeGame();
    } else if (G.state === 'playing' || G.state === 'clearing') {
      G.prevState = G.state;
      G.state = 'paused';
      showScreen('screen-pause');
      showHUD(true);
      if (G.audio) G.audio.setPaused(true);
    }
  }

  function resumeGame() {
    G.state = G.prevState || 'playing';
    G.prevState = null;
    hideScreens();
    showHUD(true);
    if (G.audio) G.audio.setPaused(false);
  }

  function quitToMenu() {
    showMenu();
  }

  function launchStuck() {
    var launched = false;
    for (var i = 0; i < G.balls.length; i++) {
      var b = G.balls[i];
      if (!b.stuck) continue;
      b.stuck = false;
      var offset = rand(-14, 14);
      b.dir = Physics.paddleBounce(b.x + offset, G.paddle);
      b.dir = Physics.ensureVertical(b.dir, 0.32);
      launched = true;
    }
    if (launched && G.audio) {
      G.audio.launch();
      spawnSparks(G.paddle.x + G.paddle.w / 2, G.paddle.y - 8, '#7fe9ff', 6, 160);
    }
  }

  /* =========================================================
     HUD
     ========================================================= */
  function updateHud(force) {
    var cache = G.hudCache;
    var modeCfg = Rules.MODE_CONFIG[G.mode] || Rules.MODE_CONFIG.campaign;
    var modeLabel = MODE_LABEL[G.mode] || '闯关';

    if (force || cache.mode !== G.mode) {
      el['hud-mode'].textContent = modeLabel;
      cache.mode = G.mode;
    }

    var levelText = '';
    if (G.mode === 'campaign') {
      levelText = '第 ' + G.levelIndex + ' 关 · ' + (G.level ? G.level.name.split('· ')[1] || '' : '');
    } else if (G.mode === 'challenge') {
      levelText = '第 ' + (G.relaxRound || 1) + ' 关 · 钢舱挑战';
    } else if (G.mode === 'endless') {
      var countdown = G.nextWaveIn > 0 ? ' · 下一波 ' + Math.ceil(G.nextWaveIn) + 's' : ' · 全清！';
      levelText = '第 ' + G.wave + ' 波' + countdown;
    } else {
      levelText = '第 ' + (G.relaxRound || 1) + ' 关 · ' + (G.level ? G.level.name : '');
    }
    if (force || cache.level !== levelText) {
      el['hud-level'].textContent = levelText;
      cache.level = levelText;
    }

    if (force || cache.score !== G.score) {
      el['hud-score'].textContent = G.score;
      cache.score = G.score;
    }

    var livesKey = G.lives + '/' + modeCfg.maxLives;
    if (force || cache.lives !== livesKey) {
      cache.lives = livesKey;
      el['hud-lives'].innerHTML = '';
      for (var i = 0; i < modeCfg.maxLives; i++) {
        var heart = document.createElement('span');
        heart.className = 'heart' + (i < G.lives ? '' : ' empty');
        el['hud-lives'].appendChild(heart);
      }
    }

    var remain = Rules.countBreakable(G.blocks);
    var blocksKey = remain + '|' + G.balls.length;
    if (force || cache.blocks !== blocksKey) {
      cache.blocks = blocksKey;
      el['hud-blocks'].textContent = '剩余 ' + remain;
      el['hud-balls'].textContent = '弹珠 ' + G.balls.length;
    }
  }

  /* =========================================================
     粒子 / 飘字
     ========================================================= */
  function pushParticle(p) {
    if (G.particles.length > 600) G.particles.shift();
    G.particles.push(p);
  }

  function spawnSparks(x, y, color, count, speed) {
    if (G.lowFX) count = Math.ceil(count * 0.6);
    for (var i = 0; i < count; i++) {
      var a = rand(0, Math.PI * 2);
      var sp = rand(speed * 0.3, speed);
      pushParticle({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.18, 0.42),
        maxLife: 0.42,
        size: rand(1.5, 3.2),
        color: color,
        shape: 'spark',
        rot: 0,
        vrot: 0,
        gravity: 40
      });
    }
  }

  function addBurst(x, y, colorA, colorB, count) {
    if (G.lowFX) count = Math.ceil(count * 0.7);
    for (var i = 0; i < count; i++) {
      var a = rand(0, Math.PI * 2);
      var sp = rand(60, 330);
      pushParticle({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - rand(20, 90),
        life: rand(0.35, 0.85),
        maxLife: 0.85,
        size: rand(2, 6),
        color: Math.random() < 0.55 ? colorA : colorB,
        shape: Math.random() < 0.5 ? 'shard' : 'spark',
        rot: rand(0, Math.PI * 2),
        vrot: rand(-10, 10),
        gravity: 420
      });
    }
  }

  function addFloat(text, x, y, color) {
    G.floats.push({ text: text, x: x, y: y, life: 0.9, maxLife: 0.9, color: color || '#ffffff' });
  }

  function updateParticles(dt) {
    for (var i = G.particles.length - 1; i >= 0; i--) {
      var p = G.particles[i];
      p.life -= dt;
      if (p.life <= 0) { G.particles.splice(i, 1); continue; }
      p.vy += (p.gravity || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.985;
      p.rot += (p.vrot || 0) * dt;
    }
  }

  function updateFloats(dt) {
    for (var i = G.floats.length - 1; i >= 0; i--) {
      var f = G.floats[i];
      f.life -= dt;
      f.y -= 42 * dt;
      if (f.life <= 0) G.floats.splice(i, 1);
    }
  }

  /* =========================================================
     渲染
     ========================================================= */
  function initAmbient() {
    G.ambient = [];
    var colors = ['rgba(77,217,255,0.10)', 'rgba(255,92,138,0.08)', 'rgba(179,136,255,0.09)', 'rgba(92,242,182,0.07)'];
    for (var i = 0; i < 22; i++) {
      G.ambient.push({
        x: rand(0, W),
        y: rand(0, H),
        r: rand(6, 46),
        vy: rand(6, 18),
        vx: rand(-6, 6),
        color: pick(colors)
      });
    }
  }

  function updateAmbient(dt) {
    for (var i = 0; i < G.ambient.length; i++) {
      var o = G.ambient[i];
      o.y -= o.vy * dt;
      o.x += o.vx * dt;
      if (o.y < -o.r * 2) { o.y = H + o.r * 2; o.x = rand(0, W); }
      if (o.x < -o.r * 2) o.x = W + o.r * 2;
      if (o.x > W + o.r * 2) o.x = -o.r * 2;
    }
  }

  var bgCanvas = null;
  var glowCache = {};
  var blockSprites = {};

  function getGlow(color) {
    if (glowCache[color]) return glowCache[color];
    var size = 128;
    var cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    var c = cv.getContext('2d');
    var g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    glowCache[color] = cv;
    return cv;
  }

  function buildBackground() {
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(W * G.dpr);
    cv.height = Math.ceil(H * G.dpr);
    var c = cv.getContext('2d');
    c.scale(G.dpr, G.dpr);

    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a1024');
    g.addColorStop(0.5, '#0c1430');
    g.addColorStop(1, '#0a0f22');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    var topGlow = c.createLinearGradient(0, 0, 0, 160);
    topGlow.addColorStop(0, 'rgba(77,217,255,0.10)');
    topGlow.addColorStop(1, 'rgba(77,217,255,0)');
    c.fillStyle = topGlow;
    c.fillRect(0, 0, W, 160);

    var botGlow = c.createLinearGradient(0, H - 140, 0, H);
    botGlow.addColorStop(0, 'rgba(255,92,138,0)');
    botGlow.addColorStop(1, 'rgba(255,92,138,0.08)');
    c.fillStyle = botGlow;
    c.fillRect(0, H - 140, W, 140);

    bgCanvas = cv;
    return cv;
  }

  function drawBackground() {
    var c = ctx;
    var bg = bgCanvas || buildBackground();
    c.drawImage(bg, 0, 0, W, H);
    for (var i = 0; i < G.ambient.length; i++) {
      var o = G.ambient[i];
      c.drawImage(getGlow(o.color), o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
    }
  }

  function getBlockSprite(type, w, h) {
    var key = type + '_' + w + '_' + h;
    if (blockSprites[key]) return blockSprites[key];
    var dpr = G.dpr || 1;
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(w * dpr);
    cv.height = Math.ceil(h * dpr);
    var c = cv.getContext('2d');
    c.scale(dpr, dpr);
    var st = BLOCK_STYLE[type];

    var grad = c.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, st.top);
    grad.addColorStop(0.5, st.mid);
    grad.addColorStop(1, st.bottom);
    roundRect(c, 0, 0, w, h, 6);
    c.fillStyle = grad;
    c.fill();

    c.strokeStyle = st.border;
    c.lineWidth = 1;
    c.stroke();

    /* 顶部高光 */
    roundRect(c, 3, 2, w - 6, 4, 2);
    c.fillStyle = 'rgba(255,255,255,0.32)';
    c.fill();

    /* 不可破坏纹理 */
    if (type === 'solid') {
      c.strokeStyle = 'rgba(20,26,36,0.35)';
      c.lineWidth = 1;
      for (var d = -h; d < w; d += 8) {
        c.beginPath();
        c.moveTo(d, 0);
        c.lineTo(d + h, h);
        c.stroke();
      }
      c.fillStyle = 'rgba(20,26,36,0.4)';
      var pts = [[7, 6], [w - 7, 6], [7, h - 6], [w - 7, h - 6]];
      for (var p = 0; p < pts.length; p++) {
        c.beginPath();
        c.arc(pts[p][0], pts[p][1], 1.6, 0, Math.PI * 2);
        c.fill();
      }
    }

    blockSprites[key] = cv;
    return cv;
  }

  function drawBlocks() {
    var c = ctx;
    for (var i = 0; i < G.blocks.length; i++) {
      var b = G.blocks[i];
      if (!b.alive) continue;
      var wob = b.wobble > 0 ? Math.sin(b.wobble * 18) * 1.4 : 0;
      var x = b.x;
      var y = b.y + wob;

      c.drawImage(getBlockSprite(b.type, b.w, b.h), x, y, b.w, b.h);

      /* 伤害裂纹 */
      if (b.breakable && b.hp < b.maxHp) {
        drawCracks(c, b, y);
      }

      /* 生命值小点（坚固/冰晶） */
      if (b.breakable && b.maxHp > 1) {
        for (var p = 0; p < b.maxHp; p++) {
          c.beginPath();
          c.arc(x + b.w - 8 - p * 6, y + b.h - 5, 1.8, 0, Math.PI * 2);
          c.fillStyle = p < b.hp ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.28)';
          c.fill();
        }
      }

      /* 命中闪白 */
      if (b.flash > 0) {
        roundRect(c, x, y, b.w, b.h, 6);
        c.fillStyle = 'rgba(255,255,255,' + (b.flash * 0.55).toFixed(3) + ')';
        c.fill();
        b.flash = Math.max(0, b.flash - 0.08);
      }

      if (b.wobble > 0) b.wobble = Math.max(0, b.wobble - 0.06);
    }
  }

  function drawCracks(c, b, y) {
    var seed = b.id * 37 + b.hp;
    c.strokeStyle = 'rgba(8,20,30,0.45)';
    c.lineWidth = 1.2;
    var lines = b.maxHp - b.hp;
    for (var i = 0; i < lines; i++) {
      var sx = b.x + 10 + ((seed * (i + 3) * 13) % (b.w - 20));
      var sy = y + 4 + ((seed * (i + 2) * 7) % (b.h - 8));
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(sx + 6, sy + 5);
      c.lineTo(sx + 2, sy + 11);
      c.lineTo(sx + 9, sy + 15);
      c.stroke();
    }
  }

  function drawBalls() {
    var c = ctx;
    for (var i = 0; i < G.balls.length; i++) {
      var b = G.balls[i];

      /* 拖尾 */
      for (var t = 0; t < b.trail.length; t++) {
        var tp = b.trail[t];
        c.beginPath();
        c.arc(tp.x, tp.y, b.r * (0.35 + t / b.trail.length * 0.5), 0, Math.PI * 2);
        c.fillStyle = b.power
          ? 'rgba(255,140,80,' + (tp.a * 0.16).toFixed(3) + ')'
          : 'rgba(120,225,255,' + (tp.a * 0.16).toFixed(3) + ')';
        c.fill();
      }

      if (b.stuck) {
        var pulse = 0.5 + 0.5 * Math.sin(G.now * 5);
        c.beginPath();
        c.arc(b.x, b.y, b.r + 6 + pulse * 3, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(127,233,255,' + (0.35 + pulse * 0.35).toFixed(2) + ')';
        c.lineWidth = 2;
        c.stroke();

        c.setLineDash([4, 6]);
        c.beginPath();
        c.moveTo(b.x, b.y - b.r - 8);
        c.lineTo(b.x, G.paddle.y - 90);
        c.strokeStyle = 'rgba(127,233,255,0.22)';
        c.lineWidth = 2;
        c.stroke();
        c.setLineDash([]);

        c.font = '600 12px ' + FONT;
        c.textAlign = 'center';
        c.fillStyle = 'rgba(200,240,255,' + (0.55 + pulse * 0.35).toFixed(2) + ')';
        c.fillText('点击 / 空格 发射', b.x, G.paddle.y - 20);
      }

      var grad = c.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.35, 1, b.x, b.y, b.r * 1.15);
      if (b.power) {
        grad.addColorStop(0, '#fff6d8');
        grad.addColorStop(0.45, '#ffb347');
        grad.addColorStop(1, '#ff5c2b');
      } else {
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.45, '#bdf4ff');
        grad.addColorStop(1, '#38c6ff');
      }
      c.save();
      c.shadowColor = b.power ? 'rgba(255,122,69,0.9)' : 'rgba(77,217,255,0.85)';
      c.shadowBlur = b.power ? 22 : 14;
      c.beginPath();
      c.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      c.fillStyle = grad;
      c.fill();
      c.restore();

      if (b.power) {
        c.beginPath();
        c.arc(b.x, b.y, b.r + 3, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(255,209,102,0.7)';
        c.lineWidth = 1.5;
        c.stroke();
      }

      /* 解压模式：还有一次穿墙机会时，外圈显示虚线光环 */
      if (b.phase) {
        c.save();
        c.setLineDash([3, 4]);
        c.beginPath();
        c.arc(b.x, b.y, b.r + 5, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(127,233,255,0.9)';
        c.lineWidth = 1.5;
        c.stroke();
        c.setLineDash([]);
        c.restore();
      }
    }
  }

  function drawPaddle() {
    var c = ctx;
    var p = G.paddle;
    var squash = p.squash;
    var h = p.h * (1 - squash * 0.25);
    var y = p.y + (p.h - h);
    var x = p.x;

    c.save();
    c.shadowColor = 'rgba(77,217,255,0.75)';
    c.shadowBlur = 18;
    var grad = c.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, '#c9f7ff');
    grad.addColorStop(0.45, '#5fd8ff');
    grad.addColorStop(1, '#1a86ff');
    roundRect(c, x, y, p.w, h, h / 2);
    c.fillStyle = grad;
    c.fill();
    c.restore();

    c.beginPath();
    c.moveTo(x + 10, y + 2.5);
    c.lineTo(x + p.w - 10, y + 2.5);
    c.strokeStyle = 'rgba(255,255,255,0.75)';
    c.lineWidth = 1.5;
    c.stroke();

    /* 两端光点 */
    c.beginPath();
    c.arc(x + 6, y + h / 2, 2.5, 0, Math.PI * 2);
    c.arc(x + p.w - 6, y + h / 2, 2.5, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.fill();
  }

  function drawItems() {
    var c = ctx;
    for (var i = 0; i < G.items.length; i++) {
      var it = G.items[i];
      var meta = Rules.POWERUP_META[it.type];
      var bob = Math.sin(it.phase) * 2.5;
      var x = it.x;
      var y = it.y + bob;

      c.save();
      c.shadowColor = meta.color;
      c.shadowBlur = 16;
      var rg = c.createRadialGradient(x - 4, y - 5, 1, x, y, 15);
      rg.addColorStop(0, '#ffffff');
      rg.addColorStop(0.35, meta.color);
      rg.addColorStop(1, 'rgba(10,16,32,0.9)');
      c.beginPath();
      c.arc(x, y, 14, 0, Math.PI * 2);
      c.fillStyle = rg;
      c.fill();
      c.restore();

      c.beginPath();
      c.arc(x, y, 14, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(255,255,255,0.7)';
      c.lineWidth = 1.2;
      c.stroke();

      c.font = '700 12px ' + FONT;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#08111f';
      c.fillText(meta.label, x, y + 0.5);
      c.textBaseline = 'alphabetic';
    }
  }

  function drawParticles() {
    var c = ctx;
    for (var i = 0; i < G.particles.length; i++) {
      var p = G.particles[i];
      var alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      c.save();
      c.globalAlpha = alpha;
      c.fillStyle = p.color;
      if (p.shape === 'shard') {
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      } else {
        c.beginPath();
        c.arc(p.x, p.y, p.size * alpha + 0.5, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }
  }

  function drawFloats() {
    var c = ctx;
    c.textAlign = 'center';
    for (var i = 0; i < G.floats.length; i++) {
      var f = G.floats[i];
      var alpha = Math.max(0, f.life / f.maxLife);
      c.globalAlpha = alpha;
      c.font = '800 15px ' + FONT;
      c.fillStyle = f.color;
      c.shadowColor = f.color;
      c.shadowBlur = 8;
      c.fillText(f.text, f.x, f.y);
      c.shadowBlur = 0;
    }
    c.globalAlpha = 1;
  }

  function drawBuffs() {
    var c = ctx;
    var items = [];
    if (G.widenTime > 0) items.push({ label: '加宽', t: G.widenTime, color: '#4dd9ff' });
    if (G.slowTime > 0) items.push({ label: '减速', t: G.slowTime, color: '#b388ff' });
    if (!items.length) return;
    c.font = '600 12px ' + FONT;
    c.textAlign = 'left';
    for (var i = 0; i < items.length; i++) {
      var x = W - 104;
      var y = H - 22 - i * 24;
      c.fillStyle = 'rgba(10,16,32,0.65)';
      roundRect(c, x, y - 13, 82, 20, 10);
      c.fill();
      c.fillStyle = items[i].color;
      c.fillText(items[i].label + ' ' + items[i].t.toFixed(1) + 's', x + 10, y + 2);
    }
  }

  function drawCombo() {
    if (G.combo < 3) return;
    var c = ctx;
    var mult = Rules.comboMultiplier(G.combo);
    var alpha = Math.min(1, G.comboTimer / 0.6);
    c.save();
    c.textAlign = 'center';
    c.globalAlpha = alpha;
    c.font = '900 26px ' + FONT;
    c.fillStyle = '#ffd166';
    c.shadowColor = 'rgba(255,209,102,0.8)';
    c.shadowBlur = 18;
    c.fillText('连击 ×' + mult, W / 2, 96);
    c.restore();
  }

  function drawFlash() {
    if (G.flash <= 0) return;
    ctx.fillStyle = 'rgba(255,255,255,' + (G.flash * 0.14).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
  }

  function render() {
    if (!ctx) return;
    var dpr = G.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var sx = 0;
    var sy = 0;
    if (G.shake > 0) {
      var mag = G.shake * 4.5;
      sx = (Math.random() * 2 - 1) * mag;
      sy = (Math.random() * 2 - 1) * mag;
    }

    drawBackground();
    ctx.save();
    ctx.translate(sx, sy);
    drawBlocks();
    drawItems();
    drawBalls();
    drawPaddle();
    drawParticles();
    drawFloats();
    drawBuffs();
    drawCombo();
    ctx.restore();

    drawFlash();
  }

  /* =========================================================
     主循环
     ========================================================= */
  function frame(ts) {
    if (!G.lastFrame) G.lastFrame = ts;
    var dt = (ts - G.lastFrame) / 1000;
    G.lastFrame = ts;
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.05) dt = 0.05;

    update(dt);
    if (G.state !== 'menu') updateHud(false);
    render();
    requestAnimationFrame(frame);
  }

  /* =========================================================
     输入
     ========================================================= */
  function canvasX(clientX) {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return W / 2;
    return (clientX - rect.left) / rect.width * W;
  }

  function onPointerMove(e) {
    if (G.state !== 'playing' && G.state !== 'clearing' && G.state !== 'paused') return;
    G.paddle.targetX = clamp(canvasX(e.clientX), 0, W);
  }

  function onPointerDown(e) {
    if (G.audio) G.audio.unlock();
    if (G.state === 'playing' || G.state === 'clearing') {
      G.paddle.targetX = clamp(canvasX(e.clientX), 0, W);
      launchStuck();
    }
  }

  function onKeyDown(e) {
    var tag = (e.target && e.target.tagName) || '';
    var onButton = tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA';

    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      G.keys.left = true;
      e.preventDefault();
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      G.keys.right = true;
      e.preventDefault();
    } else if (e.key === ' ' || e.key === 'Spacebar') {
      if (!onButton) {
        e.preventDefault();
        if (G.audio) G.audio.unlock();
        if (G.state === 'playing' || G.state === 'clearing') launchStuck();
      }
    } else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      togglePause();
    } else if ((e.key === 'r' || e.key === 'R') && !onButton) {
      if (G.state === 'playing' || G.state === 'paused' || G.state === 'win' || G.state === 'gameover' || G.state === 'clearing' || G.state === 'dying') {
        restartCurrent();
      }
    } else if (e.key === 'm' || e.key === 'M') {
      toggleMusic();
    } else if (e.key === 'n' || e.key === 'N') {
      toggleSound();
    }
  }

  function onKeyUp(e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') G.keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') G.keys.right = false;
  }

  /* =========================================================
     初始化
     ========================================================= */
  function cacheDom() {
    canvas = $('game');
    ctx = canvas.getContext('2d', { alpha: false });
    el = {
      hud: $('hud'),
      'hud-mode': $('hud-mode'),
      'hud-level': $('hud-level'),
      'hud-score': $('hud-score'),
      'hud-lives': $('hud-lives'),
      'hud-blocks': $('hud-blocks'),
      'hud-balls': $('hud-balls'),
      'btn-music': $('btn-music'),
      'btn-sound': $('btn-sound'),
      'btn-pause': $('btn-pause'),
      'btn-fullscreen': $('btn-fullscreen'),
      'btn-menu-music': $('btn-menu-music'),
      'btn-menu-sound': $('btn-menu-sound'),
      'btn-campaign': $('btn-campaign'),
      'btn-challenge': $('btn-challenge'),
      'btn-endless': $('btn-endless'),
      'endless-best': $('endless-best'),
      'btn-relax': $('btn-relax'),
      'btn-levels': $('btn-levels'),
      'btn-levels-back': $('btn-levels-back'),
      'campaign-progress': $('campaign-progress'),
      'challenge-best': $('challenge-best'),
      toast: $('toast'),
      'mobile-tip': $('mobile-tip'),
      'btn-mobile-full': $('btn-mobile-full'),
      'btn-mobile-close': $('btn-mobile-close'),
      'touch-controls': $('touch-controls'),
      'touch-left': $('touch-left'),
      'touch-right': $('touch-right'),
      'touch-shoot': $('touch-shoot'),
      'screen-menu': $('screen-menu'),
      'screen-levels': $('screen-levels'),
      'screen-pause': $('screen-pause'),
      'screen-win': $('screen-win'),
      'screen-keep': $('screen-keep'),
      'keep-title': $('keep-title'),
      'keep-sub': $('keep-sub'),
      'keep-stats': $('keep-stats'),
      'btn-keep-yes': $('btn-keep-yes'),
      'btn-keep-no': $('btn-keep-no'),
      'btn-keep-menu': $('btn-keep-menu'),
      'screen-over': $('screen-over'),
      'win-title': $('win-title'),
      'win-sub': $('win-sub'),
      'win-stats': $('win-stats'),
      'over-sub': $('over-sub'),
      'over-stats': $('over-stats'),
      'level-grid': $('level-grid'),
      'btn-resume': $('btn-resume'),
      'btn-restart': $('btn-restart'),
      'btn-quit': $('btn-quit'),
      'btn-next': $('btn-next'),
      'btn-replay-win': $('btn-replay-win'),
      'btn-menu-win': $('btn-menu-win'),
      'btn-retry': $('btn-retry'),
      'btn-menu-over': $('btn-menu-over')
    };
  }

  function setupCanvas() {
    var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    G.lowFX = isTouch;
    G.dpr = Math.min(isTouch ? 1.5 : 2, Math.max(1, window.devicePixelRatio || 1));
    blockSprites = {};
    bgCanvas = null;
    glowCache = {};
    canvas.width = Math.round(W * G.dpr);
    canvas.height = Math.round(H * G.dpr);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  }

  function requestStageFullscreen() {
    var stage = document.getElementById('stage');
    if (!stage) return;
    try {
      var fn = stage.requestFullscreen || stage.webkitRequestFullscreen;
      if (fn && !document.fullscreenElement && !document.webkitFullscreenElement) {
        var p = fn.call(stage);
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) { /* ignore */ }
    try {
      if (screen.orientation && screen.orientation.lock) {
        var q = screen.orientation.lock('landscape');
        if (q && q.catch) q.catch(function () {});
      }
    } catch (e) { /* ignore */ }
  }

  function hideMobileTip() {
    if (el['mobile-tip']) el['mobile-tip'].hidden = true;
  }

  function maybeShowMobileTip() {
    var touch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    var small = Math.min(window.screen.width, window.screen.height) <= 900;
    if (touch && small && el['mobile-tip']) {
      el['mobile-tip'].hidden = false;
      setTimeout(hideMobileTip, 12000);
    }
  }

  function bindUi() {
    el['btn-campaign'].addEventListener('click', function () { if (G.audio) G.audio.unlock(); startCampaign(save.campaignUnlocked); });
    el['btn-challenge'].addEventListener('click', function () { if (G.audio) G.audio.unlock(); startChallenge(); });
    el['btn-endless'].addEventListener('click', function () { if (G.audio) G.audio.unlock(); startEndless(); });
    el['btn-relax'].addEventListener('click', function () { if (G.audio) G.audio.unlock(); startRelax(); });
    el['btn-levels'].addEventListener('click', function () { if (G.audio) { G.audio.unlock(); G.audio.click(); } showLevels(); });
    el['btn-levels-back'].addEventListener('click', showMenu);

    el['btn-menu-music'].addEventListener('click', toggleMusic);
    el['btn-menu-sound'].addEventListener('click', toggleSound);
    el['btn-music'].addEventListener('click', toggleMusic);
    el['btn-sound'].addEventListener('click', toggleSound);
    el['btn-pause'].addEventListener('click', togglePause);
    el['btn-fullscreen'].addEventListener('click', function () { requestStageFullscreen(); });
    el['btn-mobile-full'].addEventListener('click', function () { hideMobileTip(); requestStageFullscreen(); });
    el['btn-mobile-close'].addEventListener('click', hideMobileTip);

    function bindHold(id, dir) {
      var btn = el[id];
      btn.addEventListener('pointerdown', function (e) { e.preventDefault(); if (G.audio) G.audio.unlock(); G.touch[dir] = true; });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
        btn.addEventListener(ev, function (e) { e.preventDefault(); G.touch[dir] = false; });
      });
    }
    bindHold('touch-left', 'left');
    bindHold('touch-right', 'right');
    el['touch-shoot'].addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (G.audio) G.audio.unlock();
      if (G.state === 'playing' || G.state === 'clearing') launchStuck();
    });

    el['btn-resume'].addEventListener('click', resumeGame);
    el['btn-restart'].addEventListener('click', restartCurrent);
    el['btn-quit'].addEventListener('click', showMenu);
    el['btn-next'].addEventListener('click', nextLevel);
    el['btn-replay-win'].addEventListener('click', restartCurrent);
    el['btn-menu-win'].addEventListener('click', showMenu);
    el['btn-keep-yes'].addEventListener('click', function () { if (G.audio) G.audio.click(); proceedNext(true); });
    el['btn-keep-no'].addEventListener('click', function () { if (G.audio) G.audio.click(); proceedNext(false); });
    el['btn-keep-menu'].addEventListener('click', showMenu);
    el['btn-retry'].addEventListener('click', restartCurrent);
    el['btn-menu-over'].addEventListener('click', showMenu);

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    var unlock = function () { if (G.audio) G.audio.unlock(); };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && (G.state === 'playing' || G.state === 'clearing')) {
        G.prevState = G.state;
        G.state = 'paused';
        showScreen('screen-pause');
        if (G.audio) G.audio.setPaused(true);
      }
    });
  }

  function parseDebugParams() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('touch') === '1') {
      if (el['touch-controls']) el['touch-controls'].hidden = false;
      G.lowFX = true;
    }
    if (params.get('nomusic') === '1') save.music = false;
    if (params.get('nosound') === '1') save.sound = false;

    var auto = params.get('autostart');
    if (auto === '1') {
      var mode = params.get('mode') || 'campaign';
      if (mode === 'relax') startRelax();
      else if (mode === 'challenge') startChallenge();
      else if (mode === 'endless') startEndless();
      else startCampaign(parseInt(params.get('level') || '1', 10));
    }
    /* 开发用：解压模式直接把球放进舱内，方便截图验证 */
    if (params.get('inside') === '1' && G.mode === 'relax' && G.balls.length) {
      /* 把调试弹珠直接放进舱体中心（先清出小空腔） */
      var cx = 0, cy = 0, cnt = 0;
      for (var ib = 0; ib < G.blocks.length; ib++) {
        var bb0 = G.blocks[ib];
        if (!bb0.alive) continue;
        cx += bb0.x + bb0.w / 2;
        cy += bb0.y + bb0.h / 2;
        cnt++;
      }
      if (cnt > 0) { cx /= cnt; cy /= cnt; } else { cx = W / 2; cy = H / 2; }
      for (var ib2 = G.blocks.length - 1; ib2 >= 0; ib2--) {
        var bb = G.blocks[ib2];
        if (!bb.alive) continue;
        var dx = bb.x + bb.w / 2 - cx;
        var dy = bb.y + bb.h / 2 - cy;
        if (dx * dx + dy * dy < 70 * 70) bb.alive = false;
      }
      var b0 = G.balls[0];
      b0.stuck = false;
      b0.x = cx;
      b0.y = cy;
      b0.dir = Physics.normalize(rand(-0.5, 0.5), rand() < 0.5 ? -1 : 1);
      b0.speed = G.level.speed;
    }

    if (params.get('autolaunch') === '1') {
      setTimeout(function () {
        if (G.state === 'playing') launchStuck();
      }, 500);
    }
    /* 开发用：同步快进 N 秒再截图（无头浏览器里 rAF 不总能推进） */
    var fast = parseInt(params.get('fast') || '0', 10);
    if (fast > 0 && G.state === 'playing') {
      launchStuck();
      var autoPaddle = params.get('autopaddle') === '1';
      var steps = fast * 60;
      for (var i = 0; i < steps; i++) {
        if (autoPaddle && G.balls.length) {
          var track = null;
          for (var bi = 0; bi < G.balls.length; bi++) {
            if (!G.balls[bi].stuck) { track = G.balls[bi]; break; }
          }
          if (track) G.paddle.targetX = clamp(track.x + Math.sin(i * 0.11) * 70, G.paddle.w / 2, W - G.paddle.w / 2);
        }
        update(1 / 60);
        if (autoPaddle && G.balls.some(function (b) { return b.stuck; })) launchStuck();
        if (G.state !== 'playing' && G.state !== 'clearing') break;
      }
      updateHud(true);
      render();
      /* 调试：自动在保留询问里选是/否，验证下一关切换 */
      if (G.state === 'keepask' && params.get('keepauto')) {
        proceedNext(params.get('keepauto') === 'yes');
      }
      document.title = 'DBG t=' + G.levelTime.toFixed(1) + ' score=' + G.score + ' lives=' + G.lives + ' balls=' + G.balls.length +
        ' blocks=' + Rules.countBreakable(G.blocks) + ' state=' + G.state +
        ' stuck=' + G.balls.filter(function (b) { return b.stuck; }).length + ' wave=' + G.wave + ' rounds=' + G.relaxRound + ' items=' + G.items.length + ' drop=' + G.sinceDrop;
    }
    var screenParam = params.get('screen');
    if (G.level) {
      if (screenParam === 'win') showWin();
      else if (screenParam === 'over') showGameOver();
      else if (screenParam === 'levels') showLevels();
      else if (screenParam === 'keep') showKeepPrompt();
    }
  }

  function init() {
    cacheDom();
    setupCanvas();
    loadSave();
    initAmbient();
    G.audio = new Audio();
    G.audio.musicOn = save.music;
    G.audio.sfxOn = save.sound;
    applyAudioPrefs();
    bindUi();
    showMenu();
    var isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (el['touch-controls']) el['touch-controls'].hidden = !isTouchDevice;
    maybeShowMobileTip();
    try {
      parseDebugParams();
    } catch (e) {
      if (window.console && console.error) console.error('autostart failed:', e);
      el.toast.textContent = 'autostart 失败: ' + (e && e.message);
      el.toast.hidden = false;
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
