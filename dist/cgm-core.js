/* CGM 자료 탐색 — 계산 코어 (DOM 없음). 브라우저: window.CGMCore / node: require('./cgm-core.js')
 * 자료 모양: {label, interval, days, points:[[day, minuteOfDay, glucose_mg_dL], ...], source}
 * Adapted from https://hsmu-2026-2-site.vercel.app/neuro/cgm/cgm-core.js
 * Missing values are never interpolated. Only observed values enter statistics. */
(function (root) {
  'use strict';

  const LOW = 70;
  const HIGH = 180;
  const DAY_MIN = 1440;
  const MAX_DAYS = 90;
  const MMOL_TO_MGDL = 18.0;

  /* ---------- 작은 도구 ---------- */
  const pad2 = n => String(n).padStart(2, '0');
  function fmtMinute(m) {
    const t = Math.round(m);
    return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
  }
  function round1(x) { return Math.round(x * 10) / 10; }

  /* ---------- 자료 정리 ---------- */
  function dayCounts(dataset) {
    const counts = new Array(dataset.days + 1).fill(0);
    for (const p of dataset.points) counts[p[0]] += 1;
    return counts; // counts[day]
  }

  function allDays(dataset) {
    return Array.from({ length: dataset.days }, (_, i) => i + 1);
  }

  function valueRange(dataset) {
    let min = Infinity, max = -Infinity;
    for (const p of dataset.points) { if (p[2] < min) min = p[2]; if (p[2] > max) max = p[2]; }
    return Number.isFinite(min) ? { min, max } : null;
  }

  /* 그래프 세로축: 기본 40–250, 자료가 넘으면 넓힘 */
  function yDomain(...datasets) {
    let lo = 40, hi = 250;
    for (const d of datasets) {
      const r = d && valueRange(d);
      if (!r) continue;
      if (r.min < lo) lo = Math.max(0, Math.floor(r.min / 20) * 20);
      if (r.max > hi) hi = Math.ceil(r.max / 50) * 50;
    }
    return [lo, hi];
  }

  /* ---------- 시간대 ---------- */
  // 시작 0–23시, 끝 1–24시. 시작 > 끝이면 같은 날짜의 두 구간: 22–06 = 그날 00:00–06:00 + 그날 22:00–24:00.
  // 00–24 = 하루 전체.
  function windowLength(startHour, endHour) {
    const len = (((endHour - startHour) % 24) + 24) % 24;
    return (len === 0 ? 24 : len) * 60;
  }
  function inWindow(minute, startHour, endHour) {
    const len = windowLength(startHour, endHour);
    const offset = (((minute - startHour * 60) % DAY_MIN) + DAY_MIN) % DAY_MIN;
    return offset < len;
  }
  function isFullDay(startHour, endHour) { return windowLength(startHour, endHour) === DAY_MIN; }
  // 선택칸을 바꾼 뒤 시작 = 끝이 되면 (00–24 제외) 바꾸지 않은 쪽을 1시간 밀어 1시간 구간으로.
  function normalizeWindow(startHour, endHour, changed) {
    if (startHour !== endHour % 24 || (startHour === 0 && endHour === 24)) return [startHour, endHour];
    return changed === 'end' ? [endHour - 1, endHour] : [startHour, startHour + 1];
  }

  /* ---------- 그래프 누른 곳 → 가까운 점 ---------- */
  // hits: [{x, y, group}]. mode 'x' = 누른 시각에 가장 가까운 점 (세로 위치는 안 봄).
  // mode 'xy' (여러 날 겹침) = 선(group)마다 누른 시각에 가장 가까운 점 → 그중 시각 차이 tol px 안인 점 가운데
  // 세로로 가장 가까운 점. 그런 점이 없으면 'x' 와 같음.
  function nearestHit(hits, px, py, mode, tol = 10) {
    const byX = () => {
      let best = -1, bestD = Infinity;
      hits.forEach((h, i) => { const d = Math.abs(h.x - px); if (d < bestD) { bestD = d; best = i; } });
      return best;
    };
    if (mode !== 'xy') return byX();
    const perGroup = new Map();
    hits.forEach((h, i) => {
      const cur = perGroup.get(h.group);
      if (cur === undefined || Math.abs(h.x - px) < Math.abs(hits[cur].x - px)) perGroup.set(h.group, i);
    });
    let best = -1, bestDy = Infinity;
    for (const i of perGroup.values()) {
      if (Math.abs(hits[i].x - px) > tol) continue;
      const dy = Math.abs(hits[i].y - py);
      if (dy < bestDy) { bestDy = dy; best = i; }
    }
    return best >= 0 ? best : byX();
  }

  /* ---------- 선 끊기 ---------- */
  // points: [day, minute, value] 를 시각순으로. 이웃 간격이 maxGapMinutes보다 크면 새 조각.
  function segments(points, maxGapMinutes) {
    const limit = maxGapMinutes;
    const out = [];
    let current = [];
    let prev = null;
    for (const p of points) {
      const t = (p[0] - 1) * DAY_MIN + p[1];
      if (prev !== null && t - prev > limit) { out.push(current); current = []; }
      current.push(p);
      prev = t;
    }
    if (current.length) out.push(current);
    return out;
  }

  /* ---------- 요약 ---------- */
  function selectPoints(dataset, days, startHour = 0, endHour = 24) {
    const set = new Set(days);
    return dataset.points.filter(p => set.has(p[0]) && inWindow(p[1], startHour, endHour));
  }

  function summarize(dataset, opts = {}) {
    const days = opts.days || allDays(dataset);
    const startHour = opts.startHour ?? 0;
    const endHour = opts.endHour ?? 24;
    const pts = selectPoints(dataset, days, startHour, endHour);
    const winMin = windowLength(startHour, endHour);
    const observedDays = new Set(pts.map(p => p[0])).size;
    const n = pts.length;
    const out = {
      dayCount: days.length, windowMinutes: winMin, observed: n, observedDays,
      mean: null, sd: null, min: null, max: null,
      low: 0, inRange: 0, high: 0, lowPct: null, inRangePct: null, highPct: null,
    };
    if (!n) return out;
    let sum = 0, min = pts[0], max = pts[0];
    for (const p of pts) {
      sum += p[2];
      if (p[2] < min[2]) min = p;
      if (p[2] > max[2]) max = p;
      if (p[2] < LOW) out.low += 1;
      else if (p[2] > HIGH) out.high += 1;
      else out.inRange += 1;
    }
    const mean = sum / n;
    out.mean = mean;
    if (n >= 2) {
      let ss = 0;
      for (const p of pts) ss += (p[2] - mean) ** 2;
      out.sd = Math.sqrt(ss / (n - 1)); // 표본 표준편차 (n−1)
    }
    out.min = { value: min[2], day: min[0], minute: min[1] };
    out.max = { value: max[2], day: max[0], minute: max[1] };
    out.lowPct = out.low / n * 100;
    out.inRangePct = out.inRange / n * 100;
    out.highPct = out.high / n * 100;
    return out;
  }

  /* ---------- 백분위 (AGP 비슷한 겹친 하루) ---------- */
  // 선형 보간 (R type 7 = numpy 기본). sorted 는 오름차순.
  function quantile(sorted, p) {
    if (!sorted.length) return null;
    const i = (sorted.length - 1) * p;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }

  const PERCENTILES = [5, 25, 50, 75, 95];
  // 15분마다(00:00, 00:15, … 24:00) 그 시각 ±30분 안의 값을 모든 날에서 모아 백분위 계산.
  // 자정을 넘어 이어 모음(23:50 값은 00:00 칸에도 들어감). 값이 minCount 개 미만인 칸은 비움.
  function percentileProfile(dataset, opts = {}) {
    const days = new Set(opts.days || allDays(dataset));
    const step = opts.step || 15;
    const half = opts.halfWidth ?? 30;
    const minCount = opts.minCount ?? 5;
    const pts = dataset.points.filter(p => days.has(p[0]));
    const bins = [];
    for (let c = 0; c <= DAY_MIN; c += step) {
      const vals = [];
      for (const p of pts) {
        const d = Math.abs(p[1] - (c % DAY_MIN));
        if (Math.min(d, DAY_MIN - d) <= half) vals.push(p[2]);
      }
      vals.sort((a, b) => a - b);
      const bin = { minute: c, n: vals.length, ok: vals.length >= minCount };
      for (const q of PERCENTILES) bin['p' + q] = bin.ok ? quantile(vals, q / 100) : null;
      bins.push(bin);
    }
    return bins;
  }

  const api = { LOW, HIGH, DAY_MIN, PERCENTILES, pad2, fmtMinute,
    dayCounts, allDays, valueRange, yDomain, windowLength, inWindow, isFullDay,
    normalizeWindow, nearestHit, segments, selectPoints, summarize, quantile, percentileProfile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CGMCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
