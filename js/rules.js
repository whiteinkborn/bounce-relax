/* =========================================================
   rules.js — 纯规则层（无 DOM、无 canvas，可在 Node 里测试）
   ========================================================= */
(function (root) {
  'use strict';

  /** 方块类型定义 */
  var BLOCK_TYPES = {
    normal: { key: 'normal', label: '普通墙体', hp: 1, score: 10, breakable: true },
    sturdy: { key: 'sturdy', label: '坚固墙体', hp: 2, score: 20, breakable: true },
    ice:    { key: 'ice',    label: '冰晶墙体', hp: 3, score: 30, breakable: true },
    solid:  { key: 'solid',  label: '不可破坏', hp: Infinity, score: 0, breakable: false }
  };

  /** 关卡图案字符 → 类型 */
  var CHAR_TO_TYPE = { '1': 'normal', '2': 'sturdy', '3': 'ice', '#': 'solid' };

  /** 道具类型（概率平均，每种各 1/5） */
  var POWERUP_TYPES = ['split', 'spawn', 'power', 'widen', 'slow'];
  var POWERUP_META = {
    split: { label: '分', name: '分裂弹珠', desc: '一颗弹珠分裂成三颗', color: '#ffd166' },
    spawn: { label: '生', name: '生成弹珠', desc: '墙体上立刻生成并发射两颗弹珠', color: '#5cf2b6' },
    power: { label: '力', name: '强力弹珠', desc: '随机一颗弹珠伤害翻倍', color: '#ff7a45' },
    widen: { label: '宽', name: '加宽墙体', desc: '墙体变宽 12 秒', color: '#4dd9ff' },
    slow:  { label: '慢', name: '减速力场', desc: '弹珠减速 8 秒', color: '#b388ff' }
  };

  /** 模式配置 */
  var MODE_CONFIG = {
    campaign:  { key: 'campaign',  label: '闯关', lives: 3, maxLives: 5, dropRate: 0.22, baseSpeed: 420, speedStep: 18 },
    challenge: { key: 'challenge', label: '挑战', lives: 3, maxLives: 3, dropRate: 0.14, baseSpeed: 450, speedStep: 14 },
    endless:   { key: 'endless',   label: '无尽', lives: 3, maxLives: 3, dropRate: 0.14, baseSpeed: 450, speedStep: 14 },
    relax:     { key: 'relax',     label: '解压', lives: 5, maxLives: 5, dropRate: 0.80, baseSpeed: 330, speedStep: 0 }
  };

  var POWERUP_DURATION = { widen: 12, slow: 8 };

  function charToType(ch) {
    return CHAR_TO_TYPE[ch] || null;
  }

  function blockTypeDef(type) {
    return BLOCK_TYPES[type] || null;
  }

  /** 按模式与关卡/波次计算弹珠速度 */
  function ballSpeedFor(mode, value) {
    var cfg = MODE_CONFIG[mode];
    if (!cfg) return 400;
    if (mode === 'campaign') {
      var lv = Math.max(1, value | 0);
      return cfg.baseSpeed + (lv - 1) * cfg.speedStep;
    }
    if (mode === 'challenge' || mode === 'endless') {
      var wave = Math.max(1, value | 0);
      // 挑战模式每波递增，封顶 900，避免速度失控
      return Math.min(900, cfg.baseSpeed + (wave - 1) * cfg.speedStep);
    }
    return cfg.baseSpeed;
  }

  /** 通关奖励分 */
  function levelClearBonus(level, lives) {
    return 200 + Math.max(0, level) * 50 + Math.max(0, lives) * 50;
  }

  /** 通关后生命奖励（仅闯关模式，最多 maxLives） */
  function livesAfterClear(mode, lives) {
    var cfg = MODE_CONFIG[mode];
    if (!cfg) return lives;
    if (mode === 'campaign') return Math.min(cfg.maxLives, lives + 1);
    return lives;
  }

  /** 掉落判定 */
  function rollDrop(dropRate, rng) {
    rng = rng || Math.random;
    return rng() < dropRate;
  }

  /** 道具类型判定：五种平均 */
  function rollPowerupType(rng) {
    rng = rng || Math.random;
    var i = Math.floor(rng() * POWERUP_TYPES.length);
    if (i < 0) i = 0;
    if (i >= POWERUP_TYPES.length) i = POWERUP_TYPES.length - 1;
    return POWERUP_TYPES[i];
  }

  /** 对墙块造成伤害；返回 { destroyed, hp } */
  function applyDamage(block, damage) {
    if (!block || !block.breakable || block.hp <= 0) {
      return { destroyed: false, hp: block ? block.hp : 0 };
    }
    block.hp -= Math.max(1, damage | 0);
    var destroyed = block.hp <= 0;
    if (destroyed) block.hp = 0;
    return { destroyed: destroyed, hp: block.hp };
  }

  function countBreakable(blocks) {
    var n = 0;
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].breakable && blocks[i].alive) n++;
    }
    return n;
  }

  /** 生命损失：返回剩余生命 */
  function loseLife(lives) {
    return Math.max(0, lives - 1);
  }

  /** 连击倍率（按连击数，最多 10 倍） */
  function comboMultiplier(combo) {
    return Math.max(1, Math.min(10, combo | 0));
  }

  var api = {
    BLOCK_TYPES: BLOCK_TYPES,
    CHAR_TO_TYPE: CHAR_TO_TYPE,
    POWERUP_TYPES: POWERUP_TYPES,
    POWERUP_META: POWERUP_META,
    POWERUP_DURATION: POWERUP_DURATION,
    MODE_CONFIG: MODE_CONFIG,
    charToType: charToType,
    blockTypeDef: blockTypeDef,
    ballSpeedFor: ballSpeedFor,
    levelClearBonus: levelClearBonus,
    livesAfterClear: livesAfterClear,
    rollDrop: rollDrop,
    rollPowerupType: rollPowerupType,
    applyDamage: applyDamage,
    countBreakable: countBreakable,
    loseLife: loseLife,
    comboMultiplier: comboMultiplier
  };

  root.BRRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
