/* =========================================================
   physics.js — 纯物理/碰撞工具（无 DOM，可在 Node 里测试）
   ========================================================= */
(function (root) {
  'use strict';

  function clamp(v, a, b) {
    return v < a ? a : (v > b ? b : v);
  }

  /** 归一化方向向量 */
  function normalize(x, y) {
    var len = Math.hypot(x, y);
    if (len < 1e-9) return { x: 0, y: -1 };
    return { x: x / len, y: y / len };
  }

  /**
   * 圆 vs 轴对齐矩形碰撞检测。
   * @param {{x:number,y:number,r:number}} ball
   * @param {{x:number,y:number,w:number,h:number}} rect
   * @returns {null|{nx:number,ny:number,depth:number}} 法线（从矩形指向圆心）与穿透深度
   */
  function circleRectHit(ball, rect) {
    var cx = clamp(ball.x, rect.x, rect.x + rect.w);
    var cy = clamp(ball.y, rect.y, rect.y + rect.h);
    var dx = ball.x - cx;
    var dy = ball.y - cy;
    var d2 = dx * dx + dy * dy;
    var r = ball.r;

    if (d2 > r * r) return null;

    if (d2 > 1e-8) {
      var d = Math.sqrt(d2);
      return { nx: dx / d, ny: dy / d, depth: r - d };
    }

    // 圆心落在矩形内部：沿最近的一条边推出
    var left = ball.x - rect.x;
    var right = rect.x + rect.w - ball.x;
    var top = ball.y - rect.y;
    var bottom = rect.y + rect.h - ball.y;
    var m = Math.min(left, right, top, bottom);
    if (m === left) return { nx: -1, ny: 0, depth: r + left };
    if (m === right) return { nx: 1, ny: 0, depth: r + right };
    if (m === top) return { nx: 0, ny: -1, depth: r + top };
    return { nx: 0, ny: 1, depth: r + bottom };
  }

  /** 方向向量按法线反射（要求 dir 为单位向量） */
  function reflect(dir, nx, ny) {
    var dot = dir.x * nx + dir.y * ny;
    if (dot >= 0) return { x: dir.x, y: dir.y };
    return { x: dir.x - 2 * dot * nx, y: dir.y - 2 * dot * ny };
  }

  /** 圆与矩形是否重叠 */
  function overlaps(ball, rect) {
    return circleRectHit(ball, rect) !== null;
  }

  /**
   * 挡板反弹方向：根据击中位置决定角度，越靠边角度越斜。
   * @param {number} ballX 弹珠 x
   * @param {{x:number,w:number,vx?:number}} paddle
   * @param {number} [maxAngleDeg=62]
   * @returns {{x:number,y:number}} 单位方向，始终朝上（y<0）
   */
  function paddleBounce(ballX, paddle, maxAngleDeg) {
    var maxAngle = (maxAngleDeg == null ? 62 : maxAngleDeg) * Math.PI / 180;
    var half = paddle.w / 2;
    var rel = clamp((ballX - (paddle.x + half)) / half, -1, 1);
    var angle = rel * maxAngle;
    var dir = { x: Math.sin(angle), y: -Math.cos(angle) };

    // 挡板横向速度带来一点"搓球"手感（限制在 ±0.12 以内）
    var vx = paddle.vx || 0;
    dir.x += clamp(vx * 0.00022, -0.12, 0.12);
    return normalize(dir.x, dir.y);
  }

  /** 把移动距离拆成不超过 maxStep 的小步，避免高速穿透 */
  function substeps(dx, dy, maxStep) {
    var dist = Math.hypot(dx, dy);
    var n = Math.ceil(dist / (maxStep || 4));
    return n < 1 ? 1 : Math.min(n, 24);
  }

  /** 两个矩形是否相交 */
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /** 确保方向向量拥有最小垂直分量，避免弹珠变成水平死循环 */
  function ensureVertical(dir, minAbsY) {
    var minY = minAbsY == null ? 0.28 : minAbsY;
    if (Math.abs(dir.y) >= minY) return dir;
    var sign = dir.y < 0 ? -1 : 1;
    var y = sign * minY;
    var x = Math.sqrt(Math.max(0, 1 - y * y)) * (dir.x < 0 ? -1 : 1);
    return { x: x, y: y };
  }

  /** 旋转一个单位方向向量（弧度） */
  function rotate(dir, rad) {
    var c = Math.cos(rad);
    var s = Math.sin(rad);
    return { x: dir.x * c - dir.y * s, y: dir.x * s + dir.y * c };
  }

  var api = {
    clamp: clamp,
    normalize: normalize,
    circleRectHit: circleRectHit,
    reflect: reflect,
    overlaps: overlaps,
    paddleBounce: paddleBounce,
    substeps: substeps,
    rectsOverlap: rectsOverlap,
    ensureVertical: ensureVertical,
    rotate: rotate
  };

  root.BRPhysics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
