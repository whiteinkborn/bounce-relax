/* =========================================================
   levels.js — 关卡、挑战波次、解压模式随机图案生成
   ========================================================= */
(function (root) {
  'use strict';

  var R = root.BRRules || (typeof require === 'function' ? require('./rules.js') : null);

  /* 网格常量（与 game.js 的 960×640 画布对应） */
  var GRID = {
    COLS: 16,
    ROWS: 20,
    CELL_W: 54,
    CELL_H: 20,
    BLOCK_W: 50,
    BLOCK_H: 16,
    ORIGIN_X: 48,   // (960 - 16*54) / 2
    ORIGIN_Y: 104
  };

  /* ---------------- 闯关模式：10 个手工关卡 ---------------- */
  var CAMPAIGN = [
    {
      name: '初见',
      hint: '动起来，把第一排球砸碎',
      pattern: [
        '111111111111',
        '111111111111',
        '111111111111'
      ]
    },
    {
      name: '夹心',
      hint: '上下两层是坚固墙体，中间是普通墙体',
      pattern: [
        '222222222222',
        '111111111111',
        '111111111111',
        '222222222222'
      ]
    },
    {
      name: '金字塔',
      hint: '从塔尖开始拆',
      pattern: [
        '.....11.....',
        '....1111....',
        '...111111...',
        '..11111111..',
        '.1111111111.',
        '111111111111'
      ]
    },
    {
      name: '棋盘',
      hint: '一格一格地敲，节奏感最好',
      pattern: [
        '1.1.1.1.1.1.',
        '.1.1.1.1.1.1',
        '1.1.1.1.1.1.',
        '.1.1.1.1.1.1'
      ]
    },
    {
      name: '城墙',
      hint: '灰色柱子打不碎，绕着走',
      pattern: [
        '111111111111',
        '1#11111111#1',
        '111111111111',
        '1#11111111#1',
        '111111111111',
        '1#11111111#1'
      ]
    },
    {
      name: '菱形',
      hint: '冰晶在正中心，三下才能敲碎',
      pattern: [
        '.....11.....',
        '....1221....',
        '...122221...',
        '..12233221..',
        '.1223333221.',
        '..12233221..',
        '...122221...',
        '....1221....'
      ]
    },
    {
      name: '双塔',
      hint: '两座高塔，底部藏着硬石头',
      pattern: [
        '111111111111',
        '122222222221',
        '123333333321',
        '122222222221',
        '111111111111',
        '.#........#.'
      ]
    },
    {
      name: '冰封',
      hint: '冰晶墙夹着不可破坏的横梁',
      pattern: [
        '3.3.3.3.3.3.',
        '333333333333',
        '#1#1#1#1#1#1',
        '333333333333',
        '3.3.3.3.3.3.'
      ]
    },
    {
      name: '回字',
      hint: '一层套一层，从外往里拆',
      pattern: [
        '111111111111',
        '1..........1',
        '1.22222222.1',
        '1.2......2.1',
        '1.2.3333.2.1',
        '1.2......2.1',
        '1.22222222.1',
        '111111111111'
      ]
    },
    {
      name: '终局',
      hint: '冰与火的最终考验',
      pattern: [
        '#3333333333#',
        '#2333333332#',
        '.2223333222.',
        '..12222221..',
        '...111111...',
        '....1111....'
      ]
    }
  ];

  /* 挑战模式图案池 */
  var CHALLENGE_POOL = [
    CAMPAIGN[3].pattern, // 棋盘
    CAMPAIGN[4].pattern, // 城墙
    CAMPAIGN[5].pattern, // 菱形
    CAMPAIGN[6].pattern, // 双塔
    CAMPAIGN[7].pattern, // 冰封
    CAMPAIGN[8].pattern, // 回字
    CAMPAIGN[9].pattern  // 终局
  ];

  /* ---------------- 通用构建 ---------------- */

  function buildLevel(def) {
    var pattern = def.pattern || [];
    var blocks = [];
    var id = 0;
    for (var r = 0; r < pattern.length; r++) {
      var row = pattern[r] || '';
      for (var c = 0; c < row.length && c < GRID.COLS; c++) {
        var type = R.charToType(row[c]);
        if (!type) continue;
        var t = R.BLOCK_TYPES[type];
        blocks.push({
          id: id++,
          row: r,
          col: c,
          x: GRID.ORIGIN_X + c * GRID.CELL_W + (GRID.CELL_W - GRID.BLOCK_W) / 2,
          y: GRID.ORIGIN_Y + r * GRID.CELL_H,
          w: GRID.BLOCK_W,
          h: GRID.BLOCK_H,
          type: type,
          hp: t.hp,
          maxHp: t.hp,
          breakable: t.breakable,
          alive: true,
          flash: 0,
          wobble: 0
        });
      }
    }
    return {
      name: def.name || '未命名',
      hint: def.hint || '',
      pattern: pattern,
      blocks: blocks,
      breakableCount: R.countBreakable(blocks),
      speed: def.speed != null ? def.speed : 380,
      dropRate: def.dropRate != null ? def.dropRate : 0.18,
      mode: def.mode || 'campaign',
      level: def.level || 1
    };
  }

  /** 把旧的 12 列图案居中放到 16 列地图里 */
  function centerPattern(pattern) {
    var width = GRID.COLS;
    var w = pattern[0] ? pattern[0].length : 0;
    var pad = width - w;
    if (pad <= 0) return pattern;
    var left = Math.floor(pad / 2);
    var right = pad - left;
    return pattern.map(function (row) {
      return new Array(left + 1).join('.') + row + new Array(right + 1).join('.');
    });
  }

  /* ---------------- 闯关 ---------------- */

  function campaignCount() {
    return CAMPAIGN.length;
  }

  /** 1-based 关卡索引；越界时夹到合法范围 */
  function campaignLevel(index) {
    var i = Math.max(1, Math.min(CAMPAIGN.length, index | 0)) - 1;
    var def = CAMPAIGN[i];
    return buildLevel({
      name: '第 ' + (i + 1) + ' 关 · ' + def.name,
      hint: def.hint,
      pattern: centerPattern(def.pattern),
      speed: R.ballSpeedFor('campaign', i + 1),
      dropRate: R.MODE_CONFIG.campaign.dropRate,
      mode: 'campaign',
      level: i + 1
    });
  }

  /* ---------------- 挑战 ---------------- */

  function generateChallengeLevel(wave) {
    var w = Math.max(1, wave | 0);
    var pattern = CHALLENGE_POOL[(w - 1) % CHALLENGE_POOL.length];
    return buildLevel({
      name: '第 ' + w + ' 波',
      hint: '速度越来越快，撑住',
      pattern: centerPattern(pattern),
      speed: R.ballSpeedFor('challenge', w),
      dropRate: R.MODE_CONFIG.challenge.dropRate,
      mode: 'challenge',
      level: w
    });
  }

  /* ---------------- 挑战（无尽）：周期生成的小波次图案 ---------------- */

  var CHALLENGE_NAMES = ['碎浪', '铁幕', '浮岛', '荆棘', '星屑', '回廊', '齿轮', '潮汐'];

  /**
   * 生成一个整宽（12 列）、左右对称的紧凑波次图案（2~4 行）。
   * 波次越高：坚固/冰晶/不可破坏的比例越高。
   * @param {number} wave
   * @param {function} [rng]
   * @returns {{name:string, pattern:string[]}}
   */
  function generateChallengeWave(wave, rng) {
    rng = rng || Math.random;
    var w = Math.max(1, wave | 0);
    var height = 2 + Math.floor(rng() * (w < 3 ? 2 : 3)); // 2..4
    var g = emptyGrid(height);
    var half = GRID.COLS / 2;

    var solidP = Math.min(0.10, Math.max(0, (w - 3) * 0.008));
    var sturdyP = Math.min(0.34, 0.16 + w * 0.012);
    var iceP = Math.min(0.28, 0.06 + w * 0.010);

    function pickType() {
      var x = rng();
      if (x < solidP) return '#';
      if (x < solidP + sturdyP) return '2';
      if (x < solidP + sturdyP + iceP) return '3';
      return '1';
    }

    var style = rng();
    for (var r = 0; r < height; r++) {
      for (var c = 0; c < half; c++) {
        var filled;
        if (style < 0.32) {
          filled = true; // 整排
        } else if (style < 0.58) {
          filled = c >= half - (r + 1); // 倒金字塔（上窄下宽）
        } else if (style < 0.8) {
          filled = (r + c) % 2 === 0; // 棋盘
        } else {
          filled = rng() < 0.68; // 对称随机
        }
        if (!filled) continue;
        var type = pickType();
        g[r][c] = type;
        g[r][GRID.COLS - 1 - c] = type;
      }
    }

    // 至少保证 10 个方块、且不能全是不可破坏
    var total = 0;
    var breakable = 0;
    for (var rr = 0; rr < height; rr++) {
      for (var cc = 0; cc < GRID.COLS; cc++) {
        if (g[rr][cc] !== '.') total++;
        if (g[rr][cc] === '1' || g[rr][cc] === '2' || g[rr][cc] === '3') breakable++;
      }
    }
    if (total < 10) {
      for (var c2 = 0; c2 < half; c2++) {
        g[0][c2] = '1';
        g[0][GRID.COLS - 1 - c2] = '1';
      }
    }
    if (breakable === 0) {
      g[0][half - 1] = '1';
      g[0][half] = '1';
    }

    return {
      name: CHALLENGE_NAMES[Math.floor(rng() * CHALLENGE_NAMES.length) % CHALLENGE_NAMES.length],
      pattern: g.map(function (row) { return row.join(''); })
    };
  }

  /**
   * 把图案按网格偏移构建成方块数组（用于无尽模式动态生成墙体）。
   * @param {string[]} pattern
   * @param {number} rowOffset 行偏移（0 = 第一行位置）
   * @param {number} startId 起始 id
   */
  function buildPatternBlocks(pattern, rowOffset, startId) {
    var blocks = [];
    var id = startId || 0;
    for (var r = 0; r < pattern.length; r++) {
      var row = pattern[r] || '';
      for (var c = 0; c < row.length && c < GRID.COLS; c++) {
        var type = R.charToType(row[c]);
        if (!type) continue;
        var t = R.BLOCK_TYPES[type];
        blocks.push({
          id: id++,
          row: rowOffset + r,
          col: c,
          x: GRID.ORIGIN_X + c * GRID.CELL_W + (GRID.CELL_W - GRID.BLOCK_W) / 2,
          y: GRID.ORIGIN_Y + (rowOffset + r) * GRID.CELL_H,
          w: GRID.BLOCK_W,
          h: GRID.BLOCK_H,
          type: type,
          hp: t.hp,
          maxHp: t.hp,
          breakable: t.breakable,
          alive: true,
          flash: 0,
          wobble: 0
        });
      }
    }
    return blocks;
  }

  /** 由存活方块生成占用网格（rows × COLS） */
  function occupancyFromBlocks(blocks, rows) {
    var occ = [];
    for (var r = 0; r < rows; r++) {
      var row = [];
      for (var c = 0; c < GRID.COLS; c++) row.push(false);
      occ.push(row);
    }
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (!b.alive) continue;
      if (b.row >= 0 && b.row < rows && b.col >= 0 && b.col < GRID.COLS) occ[b.row][b.col] = true;
    }
    return occ;
  }

  /**
   * 找一个能放下图案的行偏移。返回 null 表示当前没有空位。
   * @param {string[]} pattern
   * @param {boolean[][]} occupied
   * @param {number} maxRow 图案顶部允许的最大行号
   * @param {function} [rng]
   */
  function findPlacement(pattern, occupied, maxRow, rng) {
    rng = rng || Math.random;
    var rows = occupied.length;
    var h = pattern.length;
    var maxTop = Math.min(maxRow == null ? rows - h : maxRow, rows - h);
    if (maxTop < 0) return null;
    var candidates = [];
    for (var top = 0; top <= maxTop; top++) {
      var ok = true;
      for (var r = 0; r < h && ok; r++) {
        for (var c = 0; c < GRID.COLS; c++) {
          if (pattern[r][c] === '.') continue;
          if (occupied[top + r][c]) { ok = false; break; }
        }
      }
      if (ok) candidates.push(top);
    }
    if (!candidates.length) return null;
    /* 尽量往低处放（贴着已有墙体的下沿），让无尽模式像"墙体一层层往下长" */
    return candidates[candidates.length - 1];
  }

  /* ---------------- 解压模式：随机但规整 ---------------- */

  var RELAX_NAMES = [
    '奶油方阵', '彩虹阶梯', '软糖金字塔', '糖霜棋盘', '薄荷立柱',
    '泡泡相框', '星愿闪阵', '棉花糖墙', '柠檬塔', '蜜桃波',
    '极光菱格', '芝士条', '汽水泡', '布丁格子', '云朵阵'
  ];

  function emptyGrid(rows) {
    var g = [];
    for (var r = 0; r < rows; r++) {
      var row = [];
      for (var c = 0; c < GRID.COLS; c++) row.push('.');
      g.push(row);
    }
    return g;
  }

  /** 按左半区（0..5）造型并镜像到右半区，保证左右对称 */
  function symmetricFill(g, shapeFn, rng) {
    var rows = g.length;
    var half = GRID.COLS / 2;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < half; c++) {
        if (!shapeFn(r, c, rows, half)) continue;
        var x = rng();
        var type = x < 0.58 ? '1' : (x < 0.85 ? '2' : '3');
        g[r][c] = type;
        g[r][GRID.COLS - 1 - c] = type;
      }
    }
    return g;
  }

  function pickStyle(rng) {
    var styles = ['rows', 'pyramid', 'diamond', 'checker', 'columns', 'frame', 'cross', 'stripes'];
    return styles[Math.floor(rng() * styles.length) % styles.length];
  }

  /**
   * 生成一个规整（左右对称）的解压图案。
   * @param {function} [rng] 可选随机源，便于测试
   * @returns {{name:string, pattern:string[]}}
   */
  function generateRelaxPattern(rng) {
    rng = rng || Math.random;
    var style = pickStyle(rng);
    var rows, shapeFn, g;

    switch (style) {
      case 'rows': {
        rows = 4 + Math.floor(rng() * 4); // 4..7
        var full = rng() < 0.55;
        var gapCol = 2 + Math.floor(rng() * 2); // 2..3
        g = symmetricFill(emptyGrid(rows), function (r, c) {
          if (full) return true;
          // 每两行留一条对称的空隙，看起来像规整的条纹
          return !(r % 3 === 1 && c === gapCol);
        }, rng);
        break;
      }
      case 'pyramid': {
        rows = 5 + Math.floor(rng() * 3); // 5..7
        g = symmetricFill(emptyGrid(rows), function (r, c, rs) {
          var need = Math.max(1, Math.round((r / (rs - 1)) * (GRID.COLS / 2)));
          return c >= GRID.COLS / 2 - need;
        }, rng);
        break;
      }
      case 'diamond': {
        var p = 4 + Math.floor(rng() * 2); // 4..5 → 7..9 行
        rows = 2 * p - 1;
        g = symmetricFill(emptyGrid(rows), function (r, c) {
          var k = r < p ? r : 2 * p - 2 - r; // 距顶/底的层数
          return c >= GRID.COLS / 2 - (k + 1);
        }, rng);
        break;
      }
      case 'checker': {
        rows = 4 + Math.floor(rng() * 3); // 4..6
        g = symmetricFill(emptyGrid(rows), function (r, c) {
          return (r + c) % 2 === 0;
        }, rng);
        break;
      }
      case 'columns': {
        rows = 5 + Math.floor(rng() * 3); // 5..7
        var mask = [];
        for (var i = 0; i < GRID.COLS / 2; i++) mask.push(rng() < 0.62);
        if (mask.indexOf(true) < 0) mask[0] = true;
        g = symmetricFill(emptyGrid(rows), function (r, c) {
          return mask[c];
        }, rng);
        break;
      }
      case 'frame': {
        rows = 6 + Math.floor(rng() * 3); // 6..8
        var thick = rng() < 0.4 ? 1 : 0;
        g = symmetricFill(emptyGrid(rows), function (r, c, rs) {
          return r === 0 || r === rs - 1 || c <= thick;
        }, rng);
        break;
      }
      case 'cross': {
        rows = 6 + Math.floor(rng() * 3); // 6..8
        var mid = Math.floor(rows / 2);
        g = symmetricFill(emptyGrid(rows), function (r, c) {
          return (c === 2 || c === 3) || (r === mid || r === mid - 1);
        }, rng);
        break;
      }
      case 'stripes':
      default: {
        rows = 5 + Math.floor(rng() * 3); // 5..7
        var phase = Math.floor(rng() * 4);
        g = symmetricFill(emptyGrid(rows), function (r, c) {
          return (r + c + phase) % 4 < 2;
        }, rng);
        break;
      }
    }

    // 至少要有一定数量，否则退化为整行（保证爽感）
    var count = 0;
    for (var rr = 0; rr < g.length; rr++) {
      for (var cc = 0; cc < GRID.COLS; cc++) if (g[rr][cc] !== '.') count++;
    }
    if (count < 24) {
      var rows2 = 5 + Math.floor(rng() * 2);
      g = symmetricFill(emptyGrid(rows2), function () { return true; }, rng);
    }

    var name = RELAX_NAMES[Math.floor(rng() * RELAX_NAMES.length) % RELAX_NAMES.length];
    return {
      name: name,
      pattern: g.map(function (row) { return row.join(''); })
    };
  }

  /* ---------------- 解压模式：不可破坏墙体围成的"回弹腔体" ---------------- */

  var CHAMBER_NAMES = ['铁壁圣殿', '回弹大厅', '双子堡', '深井', '铁笼', '钟罩', '围城', '弹珠浴缸', '困兽场'];

  function pickRelaxType(rng) {
    var x = rng();
    if (x < 0.55) return '1';
    if (x < 0.83) return '2';
    return '3';
  }

  /**
   * 生成「钢铁回弹舱」：悬浮在场地中的钢板箱，四周只留 1~2 个缺口（上/下/左/右都可能）。
   * 舱内（以及墙内墙里）塞满可破坏方块——玩家必须把弹珠送进缺口，进去后持续弹射清场。
   * 支持 5 种模板：大殿堂 / 回字套娃 / 双子堡 / 多层搁板 / 柱厅。
   */
  function buildChamberOnce(rng) {
    rng = rng || Math.random;
    var COLS = GRID.COLS;
    var ROWS = GRID.ROWS;
    var g = [];
    for (var rr = 0; rr < ROWS; rr++) {
      var row = [];
      for (var cc = 0; cc < COLS; cc++) row.push('.');
      g.push(row);
    }

    function put(r, c, ch) {
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) g[r][c] = ch;
    }
    function typeAt() { return pickRelaxType(rng); }
    function fill(r1, r2, c1, c2) {
      for (var r = r1; r <= r2; r++) {
        for (var c = c1; c <= c2; c++) {
          if (g[r][c] === '.') g[r][c] = typeAt();
        }
      }
    }
    function box(top, bottom, left, right, gapMode) {
      for (var c = left; c <= right; c++) {
        put(top, c, '#');
        put(bottom, c, '#');
      }
      for (var r = top; r <= bottom; r++) {
        put(r, left, '#');
        put(r, right, '#');
      }
      var midC = Math.floor((left + right) / 2);
      var midR = Math.floor((top + bottom) / 2);
      if (gapMode === 'bottom') {
        put(bottom, midC, '.');
        put(bottom, midC + 1, '.');
      } else if (gapMode === 'top') {
        put(top, midC, '.');
        put(top, midC + 1, '.');
      } else {
        put(midR, left, '.');
        put(midR + 1, left, '.');
        put(midR, right, '.');
        put(midR + 1, right, '.');
      }
    }

    /* 舱体几乎铺满整个场地：上下左右各留一条窄通道，方便从任意方向开口进入 */
    var top = 1;
    var bottom = ROWS - 2;
    var left = 1;
    var right = COLS - 2;

    var styles = ['hall', 'nest', 'twin', 'shelves', 'pillars'];
    var style = styles[Math.floor(rng() * styles.length) % styles.length];
    var gapMode = ['bottom', 'top', 'top', 'both', 'both'][Math.floor(rng() * 5) % 5];

    if (style === 'twin') {
      /* 双子堡：一个大外箱 + 半高中间隔板；全图只有一个朝下缺口 */
      fill(top + 1, bottom - 1, left + 1, right - 1);
      box(top, bottom, left, right, gapMode);
      for (var tr = top + 2; tr <= bottom - 3; tr++) {
        put(tr, 7, '#');
        put(tr, 8, '#');
      }
    } else if (style === 'nest') {
      /* 回字套娃：外墙内再一层钢板墙，清场要过两道缺口 */
      fill(top + 1, bottom - 1, left + 1, right - 1);
      var innerTop = top + 3;
      var innerBottom = bottom - 3;
      var innerLeft = left + 3;
      var innerRight = right - 3;
      if (innerBottom - innerTop >= 3 && innerRight - innerLeft >= 3) {
        box(innerTop, innerBottom, innerLeft, innerRight,
          ['bottom', 'top', 'both'][Math.floor(rng() * 3) % 3]);
      }
      box(top, bottom, left, right, gapMode);
    } else if (style === 'shelves') {
      /* 多层搁板：两条横向钢板把大舱切成三层 */
      fill(top + 1, bottom - 1, left + 1, right - 1);
      var s1 = top + 5;
      var s2 = top + 11;
      var shelfRows = [s1, s2];
      for (var si = 0; si < shelfRows.length; si++) {
        for (var sc = left + 1; sc < right; sc++) put(shelfRows[si], sc, '#');
        put(shelfRows[si], 7, '.');
        put(shelfRows[si], 8, '.');
      }
      box(top, bottom, left, right, gapMode);
    } else if (style === 'pillars') {
      /* 柱厅：两排钢柱把大舱隔出多条弹道 */
      fill(top + 1, bottom - 1, left + 1, right - 1);
      for (var pr = top + 2; pr <= bottom - 2; pr++) {
        put(pr, 5, '#');
        put(pr, 10, '#');
      }
      box(top, bottom, left, right, gapMode);
    } else {
      /* 大殿堂：一整间塞满全场的钢舱 */
      fill(top + 1, bottom - 1, left + 1, right - 1);
      box(top, bottom, left, right, gapMode);
    }

    /* 整张图严格左右对称：左半边直接镜像到右半边（缺口位置也对称） */
    for (var mr = 0; mr < ROWS; mr++) {
      for (var mc = 0; mc < Math.floor(COLS / 2); mc++) {
        g[mr][COLS - 1 - mc] = g[mr][mc];
      }
    }

    return {
      name: CHAMBER_NAMES[Math.floor(rng() * CHAMBER_NAMES.length) % CHAMBER_NAMES.length],
      pattern: g.map(function (row) { return row.join(''); })
    };
  }

  /** 生成多个候选，优先选可破坏方块 >= 65 的，保证爽快的清场量 */
  function generateRelaxChamber(rng) {
    rng = rng || Math.random;
    var best = null;
    var good = [];
    for (var i = 0; i < 6; i++) {
      var c = buildChamberOnce(rng);
      var count = 0;
      for (var r = 0; r < c.pattern.length; r++) {
        for (var q = 0; q < c.pattern[r].length; q++) {
          var ch = c.pattern[r][q];
          if (ch === '1' || ch === '2' || ch === '3') count++;
        }
      }
      c.breakableCount = count;
      if (!best || count > best.breakableCount) best = c;
      if (count >= 120) good.push(c);
    }
    if (good.length) return good[Math.floor(rng() * good.length) % good.length];
    return best;
  }

  /**
   * 把外墙上的大缺口用钢板收窄成一个小门（约 26px），球不容易再弹出去。
   * 不改变图案本身，只在缺口两侧补两段钢板。
   */
  function narrowChamberGaps(level) {
    var pattern = level.pattern;
    var blocks = level.blocks;
    if (!pattern || !pattern.length || !blocks.length) return;

    var minR = 1e9, maxR = -1, minC = 1e9, maxC = -1, maxId = 0;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      minR = Math.min(minR, b.row);
      maxR = Math.max(maxR, b.row);
      minC = Math.min(minC, b.col);
      maxC = Math.max(maxC, b.col);
      if (b.id > maxId) maxId = b.id;
    }
    if (maxR < 0) return;

    var SLOT = 26;
    var BH = GRID.BLOCK_H;
    var nextId = maxId + 1;

    function cellX(c) { return GRID.ORIGIN_X + c * GRID.CELL_W + (GRID.CELL_W - GRID.BLOCK_W) / 2; }
    function cellY(r) { return GRID.ORIGIN_Y + r * GRID.CELL_H; }
    function addFiller(x, y, w, h, row, col) {
      blocks.push({
        id: nextId++, row: row, col: col,
        x: x, y: y, w: w, h: h,
        type: 'solid', hp: Infinity, maxHp: Infinity,
        breakable: false, alive: true, flash: 0, wobble: 0
      });
    }
    function narrowHorizontal(row) {
      var c = minC;
      while (c <= maxC) {
        if (pattern[row][c] !== '.') { c++; continue; }
        var start = c;
        while (c <= maxC && pattern[row][c] === '.') c++;
        var end = c - 1;
        var x1 = cellX(start);
        var x2 = cellX(end) + GRID.BLOCK_W;
        var y = cellY(row);
        if (x2 - x1 > SLOT + 6) {
          var mid = (x1 + x2) / 2;
          var lw = mid - SLOT / 2 - x1;
          var rs = mid + SLOT / 2;
          var rw = x2 - rs;
          if (lw > 2) addFiller(x1, y, lw, BH, row, start);
          if (rw > 2) addFiller(rs, y, rw, BH, row, end);
        }
      }
    }
    function narrowVertical(col) {
      var r = minR;
      while (r <= maxR) {
        if (pattern[r][col] !== '.') { r++; continue; }
        var start = r;
        while (r <= maxR && pattern[r][col] === '.') r++;
        var end = r - 1;
        var y1 = cellY(start);
        var y2 = cellY(end) + GRID.BLOCK_H;
        var x = cellX(col);
        if (y2 - y1 > SLOT + 6) {
          var mid = (y1 + y2) / 2;
          var th = mid - SLOT / 2 - y1;
          var bs = mid + SLOT / 2;
          var bh = y2 - bs;
          if (th > 2) addFiller(x, y1, GRID.BLOCK_W, th, start, col);
          if (bh > 2) addFiller(x, bs, GRID.BLOCK_W, bh, end, col);
        }
      }
    }

    narrowHorizontal(minR);
    narrowHorizontal(maxR);
    narrowVertical(minC);
    narrowVertical(maxC);
    level.blocks = blocks;
  }

  function generateRelaxLevel(rng) {
    var p = generateRelaxChamber(rng);
    var built = buildLevel({
      name: p.name,
      hint: '把弹珠打进底部的缺口，舱内会一直弹射',
      pattern: p.pattern,
      speed: R.MODE_CONFIG.relax.baseSpeed,
      dropRate: R.MODE_CONFIG.relax.dropRate,
      mode: 'relax',
      level: 1
    });
    narrowChamberGaps(built);
    built.relaxStyle = p.name;
    return built;
  }

  var api = {
    GRID: GRID,
    CAMPAIGN: CAMPAIGN,
    CHALLENGE_POOL: CHALLENGE_POOL,
    campaignCount: campaignCount,
    campaignLevel: campaignLevel,
    generateChallengeLevel: generateChallengeLevel,
    generateChallengeWave: generateChallengeWave,
    buildPatternBlocks: buildPatternBlocks,
    occupancyFromBlocks: occupancyFromBlocks,
    findPlacement: findPlacement,
    generateRelaxPattern: generateRelaxPattern,
    generateRelaxChamber: generateRelaxChamber,
    generateRelaxLevel: generateRelaxLevel,
    buildLevel: buildLevel,
    centerPattern: centerPattern
  };

  root.BRLevels = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
