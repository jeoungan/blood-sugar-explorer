/* Adapted from https://hsmu-2026-2-site.vercel.app/neuro/cgm/app.js
 * Personal finger-stick readings only. No generated data, uploads, or analytics. */
(function () {
  'use strict';
  const C = window.CGMCore;
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const r1 = v => Math.round(v * 10) / 10;
  const fmtInt = n => Math.round(n).toLocaleString('ko-KR');
  const fmt1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const fmtG = v => (Number.isInteger(v) ? String(v) : fmt1(v));
  const hh = h => String(h).padStart(2, '0');
  // 줄바꿈 막기: 숫자와 단위 사이 (NB), 범위의 '–' 앞뒤 (WJ)
  const NB = '\u00a0', WJ = '\u2060';
  const mgdl = v => `${v}${NB}mg/dL`;
  const range = (a, b) => `${a}${WJ}–${WJ}${b}`;
  const dateLabel = day => window.PERSONAL_DATA.dates[day - 1].slice(5).replace('-', '/');
  const at = (day, minute) => `${dateLabel(day)} (D${day}) ${C.fmtMinute(minute)}`;

  const PAL = {
    band: '#e3f1e7', bandLine: '#3f8f5a', bandText: '#1f5c33', grid: '#e1e7e3', ink: '#173638',
    line: '#087b7e', low: '#c62828', high: '#e69a00', highStroke: '#7a4a00', dim: '#fafbf7',
    agpLight: '#bcd9ec', agpDark: '#5b95c4', median: '#12355b', a: '#087b7e', b: '#7b3fa0', inRange: '#5aa57a',
  };
  const DAY_COLORS = ['#087b7e', '#3656b8', '#7b3fa0', '#8a5a2b', '#1f2d2c'];
  const MAX_OVERLAY = 5;
  const TABS = ['day', 'grid', 'agp', 'compare'];
  const HINT = {
    day: '그래프를 누르면 값 표시',
    grid: '날짜 칸을 누르면 하루씩 보기로 열림',
    agp: '그래프를 누르면 그 시각의 백분위 표시',
    compare: '그래프를 누르면 두 날짜의 실제 측정값과 메모 표시',
  };

  const state = {
    tab: 'day', day: 1, overlay: false, picks: [], agpOut: new Set(),
    startHour: 0, endHour: 24, hits: [], cursor: -1, compareA: 14, compareB: 15, showSchedule: true,
  };
  const scheduleData = window.PERSONAL_SCHEDULE;
  const scheduleByDate = new Map((scheduleData?.days || []).map(day => [day.date, day]));
  const activities = new Map((scheduleData?.activities || []).map(activity => [activity.id, activity]));
  const scheduleForDay = day => scheduleByDate.get(ds().dates[day - 1]);
  const recordMap = new Map(window.PERSONAL_DATA.records.map(r => [r.day + ':' + r.minute, r]));
  const recordById = new Map(window.PERSONAL_DATA.records.map(r => [r.id, r]));
  const recordFor = p => recordMap.get(p[0] + ':' + p[1]);
  const pointText = p => {
    const r = recordFor(p);
    return `${at(p[0], p[1])} · ${mgdl(fmtG(p[2]))}${r && r.note ? ' · ' + r.note : ''}`;
  };

  const infoCache = new WeakMap();

  /* ---------- 자료 ---------- */
  const ds = () => window.PERSONAL_DATA;

  function info(d) {
    let c = infoCache.get(d);
    if (!c) {
      c = { counts: C.dayCounts(d), yDom: C.yDomain(d), fullProfile: null };
      infoCache.set(d, c);
    }
    return c;
  }


  /* 현재 탭의 날짜 선택 */
  function selectedDays() {
    const d = ds();
    if (state.tab === 'compare') return [...new Set([state.compareA, state.compareB])];
    if (state.tab === 'day') return state.overlay ? state.picks.map(p => p.day) : [state.day];
    if (state.tab === 'agp') return C.allDays(d).filter(x => !state.agpOut.has(x));
    return C.allDays(d);
  }

  /* ---------- 글 ---------- */
  // 시작 > 끝 (예: 22–06) = 같은 날짜의 두 구간. 밤을 이어 본 것이 아님
  function windowText() {
    const { startHour: s, endHour: e } = state;
    if (C.isFullDay(s, e)) return `${range('00', 24)}시 (하루 전체)`;
    return s > e ? `${range(hh(s), 24)}시 + ${range('00', hh(e))}시 (같은 날짜)` : `${range(hh(s), hh(e))}시`;
  }
  function daysText(days, total) {
    if (!days.length) return '고른 날 없음';
    if (days.length === total) return `${range('D1', 'D' + total)} 전체`;
    if (days.length <= 5) return days.slice().sort((a, b) => a - b).map(d => dateLabel(d) + ' (D' + d + ')').join(', ');
    const out = [];
    for (let d = 1; d <= total; d += 1) if (!days.includes(d)) out.push('D' + d);
    return `${days.length}일 (뺀 날 ${out.join(', ')})`;
  }

  /* ---------- 그래프 틀 ---------- */
  function geom(width, height, yDom, compact) {
    const m = compact ? { l: 3, r: 3, t: 3, b: 3 } : { l: 42, r: 10, t: 16, b: 26 };
    const pw = width - m.l - m.r, ph = height - m.t - m.b;
    return {
      width, height, m, pw, ph, yDom,
      x: min => r1(m.l + min / C.DAY_MIN * pw),
      y: v => r1(m.t + (1 - (v - yDom[0]) / (yDom[1] - yDom[0])) * ph),
    };
  }

  function baseLayer(g, compact, noBandFill) {
    const { x, y, m, pw, ph } = g;
    const bottom = m.t + ph;
    let s = `<rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="#ffffff" stroke="#c9d6cf"/>`;
    if (!noBandFill) s += `<rect x="${m.l}" y="${y(180)}" width="${pw}" height="${r1(y(70) - y(180))}" fill="${PAL.band}"/>`;
    for (let h = 0; h <= 24; h += compact ? 6 : 3) {
      s += `<line x1="${x(h * 60)}" x2="${x(h * 60)}" y1="${m.t}" y2="${bottom}" stroke="${PAL.grid}"/>`;
    }
    for (const v of [70, 180]) s += `<line x1="${m.l}" x2="${m.l + pw}" y1="${y(v)}" y2="${y(v)}" stroke="${PAL.bandLine}" stroke-width="${compact ? 0.8 : 1.2}"/>`;
    if (compact) return s;
    for (let h = 0; h <= 24; h += 3) {
      s += `<text x="${x(h * 60)}" y="${bottom + 18}" text-anchor="middle" font-size="14" fill="${PAL.ink}">${hh(h)}</text>`;
    }
    const [lo, hi] = g.yDom;
    for (const v of [lo, hi]) {
      if (Math.abs(y(v) - y(70)) < 15 || Math.abs(y(v) - y(180)) < 15) continue;
      s += `<text x="${m.l - 6}" y="${y(v) + 5}" text-anchor="end" font-size="14" fill="${PAL.ink}">${v}</text>`;
    }
    for (const v of [70, 180]) {
      s += `<text x="${m.l - 6}" y="${y(v) + 5}" text-anchor="end" font-size="14" font-weight="700" fill="${PAL.bandText}">${v}</text>`;
    }
    s += `<text x="${m.l + 6}" y="${m.t + 16}" font-size="14" fill="${PAL.ink}">mg/dL</text>`;
    return s;
  }

  function windowLayer(g) {
    if (C.isFullDay(state.startHour, state.endHour)) return '';
    const { x, m, ph } = g;
    const s = state.startHour * 60, e = state.endHour * 60;
    const outside = s < e ? [[0, s], [e, C.DAY_MIN]] : [[e, s]];
    let str = '';
    for (const [a, b] of outside) {
      if (b > a) str += `<rect x="${x(a)}" y="${m.t}" width="${r1(x(b) - x(a))}" height="${ph}" fill="${PAL.dim}" fill-opacity="0.8"/>`;
    }
    for (const edge of [s, e]) {
      if (edge > 0 && edge < C.DAY_MIN) str += `<line x1="${x(edge)}" x2="${x(edge)}" y1="${m.t}" y2="${m.t + ph}" stroke="${PAL.ink}" stroke-dasharray="5 4" stroke-width="1.2"/>`;
    }
    return str;
  }

  const pathOf = (pts, g) => pts.map((p, i) => `${i ? 'L' : 'M'}${g.x(p[1])} ${g.y(p[2])}`).join('');

  /* Schedule rows share the chart's exact 00–24 x coordinates. */
  function scheduleLabel(segment) {
    return segment.activity === null ? '일정 미기록' : activities.get(segment.activity).label;
  }

  function scheduleTextColor(color) {
    const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
    const linear = rgb.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722 < 0.24 ? '#ffffff' : PAL.ink;
  }

  function scheduleLayer(g, days, compact = false, colors = []) {
    if (!state.showSchedule || !days.length || !scheduleData) return {html: '', extra: 0};
    const top = g.height + (compact ? 2 : 26);
    const rowHeight = compact ? 10 : 26, barHeight = compact ? 7 : 20;
    const extra = (compact ? 2 : 26) + days.length * rowHeight + 2;
    g.scheduleBottom = top + days.length * rowHeight - 4;
    let html = '<g class="schedule-tracks">';
    if (!compact) html += `<text x="${g.m.l}" y="${g.height + 14}" font-size="12" fill="${PAL.ink}">스케줄 · 같은 시간축</text>`;
    days.forEach((day, lane) => {
      const source = scheduleForDay(day);
      const segments = source?.segments || [{start: 0, end: 1440, activity: null}];
      const y = top + lane * rowHeight;
      html += `<g class="schedule-track" data-schedule-day="${day}">`;
      if (!compact) html += `<text x="${g.m.l - 6}" y="${y + 14}" text-anchor="end" font-size="11" font-weight="700" fill="${colors[lane] || PAL.ink}">${dateLabel(day)}</text>`;
      segments.forEach((segment, index) => {
        const x = g.x(segment.start), width = r1(g.x(segment.end) - x);
        const color = segment.activity === null ? '#f5f6f5' : activities.get(segment.activity).color;
        const name = scheduleLabel(segment);
        const description = `${dateLabel(day)} · ${C.fmtMinute(segment.start)}–${C.fmtMinute(segment.end)} · ${name}`;
        const interaction = compact ? '' : ` data-schedule-segment="${index}" data-day="${day}" role="button" tabindex="0" aria-label="${esc(description)}"`;
        html += `<g class="schedule-segment"${interaction}><title>${esc(description)}</title>`;
        const cuts = [...new Set([segment.start, segment.end, state.startHour * 60, state.endHour * 60])].filter(v => v >= segment.start && v <= segment.end).sort((a, b) => a - b);
        for (let i = 1; i < cuts.length; i++) {
          const start = cuts[i - 1], end = cuts[i];
          const active = C.inWindow((start + end) / 2, state.startHour, state.endHour);
          html += `<rect class="schedule-block" data-start="${start}" data-end="${end}" x="${g.x(start)}" y="${y}" width="${r1(g.x(end) - g.x(start))}" height="${barHeight}" fill="${color}" fill-opacity="${active ? 1 : 0.22}"/>`;
        }
        html += `<rect class="activity-outline" x="${x}" y="${y}" width="${width}" height="${barHeight}" rx="2" fill="none" stroke="${segment.activity === null ? '#c6d1cb' : '#ffffff'}" stroke-width="0.7"${segment.activity === null ? ' stroke-dasharray="3 2"' : ''}/>`;
        if (!compact && width > name.length * 11 + 10) {
          const active = C.inWindow((segment.start + segment.end) / 2, state.startHour, state.endHour);
          html += `<text x="${r1(x + width / 2)}" y="${y + 14}" text-anchor="middle" font-size="11" fill="${scheduleTextColor(color)}" fill-opacity="${active ? 1 : 0.45}" pointer-events="none">${esc(name)}</text>`;
        }
        html += '</g>';
      });
      html += '</g>';
    });
    return {html: html + '</g>', extra};
  }

  function scheduleHint() {
    return state.tab === 'grid' ? '각 날짜의 그래프 아래 색상 띠가 그날의 일정입니다. 날짜를 누르면 크게 볼 수 있어요.' : '활동 띠를 누르거나 혈당 점을 선택하면 해당 시간의 활동을 볼 수 있어요.';
  }

  function renderScheduleUI() {
    const button = $('#schedule-toggle');
    button.setAttribute('aria-pressed', String(state.showSchedule));
    button.textContent = state.showSchedule ? '스케줄 숨기기' : '스케줄 보기';
    const legend = $('#schedule-legend'), readout = $('#schedule-readout');
    legend.hidden = readout.hidden = !state.showSchedule;
    if (!state.showSchedule) { legend.innerHTML = ''; readout.textContent = ''; return; }
    const sw = color => `<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="2" fill="${color}" stroke="#b9c9bf" stroke-width="0.6"/></svg>`;
    legend.innerHTML = `<p>기억을 바탕으로 정리한 대략적인 일정 · 30분 단위</p><div class="activity-keys">${scheduleData.activities.map(a => `<span>${sw(a.color)}${esc(a.label)}</span>`).join('')}<span>${sw('#f5f6f5')}일정 미기록</span></div>`;
    readout.textContent = scheduleHint();
  }

  function showScheduleSegment(element) {
    const day = Number(element.dataset.day), index = Number(element.dataset.scheduleSegment);
    const segment = scheduleForDay(day)?.segments[index];
    if (!state.showSchedule || !segment) return;
    document.querySelectorAll('.schedule-segment.is-selected').forEach(e => e.classList.remove('is-selected'));
    element.classList.add('is-selected');
    $('#schedule-readout').textContent = `${dateLabel(day)} (D${day}) · ${C.fmtMinute(segment.start)}–${C.fmtMinute(segment.end)} · ${scheduleLabel(segment)}`;
  }

  function showScheduleForRecord(record) {
    if (!state.showSchedule) return;
    if (!record) { $('#schedule-readout').textContent = scheduleHint(); return; }
    const source = scheduleForDay(record.day);
    const index = source?.segments.findIndex(segment => record.minute >= segment.start && record.minute < segment.end);
    const segment = source?.segments[index];
    document.querySelectorAll('.schedule-segment.is-selected').forEach(e => e.classList.remove('is-selected'));
    if (!segment) { $('#schedule-readout').textContent = `${at(record.day, record.minute)} · 일정 미기록`; return; }
    const element = document.querySelector(`[data-schedule-segment="${index}"][data-day="${record.day}"]`);
    element?.classList.add('is-selected');
    $('#schedule-readout').textContent = `${at(record.day, record.minute)} · ${scheduleLabel(segment)} (${C.fmtMinute(segment.start)}–${C.fmtMinute(segment.end)})`;
  }

  /* Prominent dots are observations; faint dashed lines show estimated paths only.
   * Segmentation still disconnects gaps greater than maxGap minutes. */
  function seriesLayer(series, g, maxGap, opt) {
    let s = '';
    for (const sr of series) {
      for (const seg of C.segments(sr.pts, maxGap)) {
        if (seg.length < 2) continue;
        const d = pathOf(seg, g);
        s += `<path class="estimate-line" d="${d}" fill="none" stroke="${sr.color}" stroke-width="${opt.width}" stroke-opacity="0.38" stroke-dasharray="${opt.dot < 3 ? '2 3' : '3 5'}" stroke-linejoin="round" stroke-linecap="round"/>`;
      }
    }
    for (const sr of series) {
      for (const p of sr.pts) {
        const high = p[2] > 180;
        const color = p[2] < 70 ? PAL.low : high ? PAL.high : sr.color;
        s += `<circle class="measurement-point" cx="${g.x(p[1])}" cy="${g.y(p[2])}" r="${opt.dot + (high ? 0.5 : 0)}" fill="${color}" stroke="${high ? PAL.highStroke : '#ffffff'}" stroke-width="${opt.dot < 3 ? 0.5 : 0.9}"/>`;
      }
    }
    return s;
  }

  function chartSize(wrap) {
    const w = Math.max(280, Math.floor(wrap.clientWidth || 340));
    const h = w < 560 ? Math.min(320, Math.max(250, Math.round(w * 0.78))) : Math.round(Math.min(410, Math.max(300, w * 0.46)));
    return [w, h];
  }

  function svgOpen(w, h, label) {
    return `<svg class="main" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="${state.showSchedule ? 'group' : 'img'}" tabindex="0" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">`;
  }

  /* ---------- 탭별 그래프 ---------- */
  function daySeries() {
    const d = ds();
    if (state.overlay) {
      return state.picks.map(p => ({ day: p.day, color: DAY_COLORS[p.slot], pts: d.points.filter(q => q[0] === p.day) }));
    }
    return [{ day: state.day, color: PAL.line, pts: d.points.filter(q => q[0] === state.day) }];
  }

  function drawDay(wrap) {
    const d = ds();
    const series = daySeries();
    const [w, h] = chartSize(wrap);
    const g = geom(w, h, info(d).yDom, false);
    const title = state.overlay ? series.map(s => 'D' + s.day).join(', ') : 'D' + state.day;
    const schedule = scheduleLayer(g, series.map(sr => sr.day), false, series.map(sr => sr.color));
    let s = svgOpen(w, h + schedule.extra, `${d.label} ${title} 하루 포도당 그래프. 가로 00–24시, 세로 mg/dL`);
    s += baseLayer(g, false);
    s += seriesLayer(series, g, d.maxGap, { width: 1.6, dot: 4.2 });
    s += windowLayer(g);
    const empty = series.filter(sr => !sr.pts.length).map(sr => 'D' + sr.day);
    if (!series.length) {
      s += centerText(g, '겹칠 날짜를 고르세요', '위 날짜 단추 · 최대 5일');
    } else if (empty.length === series.length) {
      s += centerText(g, `${empty.join(', ')} · 기록 없음`, '빈 곳 = 모르는 값 · 0 아님');
    }
    s += schedule.html + '<g class="cursor" pointer-events="none"></g></svg>';
    wrap.innerHTML = s;
    const hits = [];
    for (const sr of series) {
      for (const p of sr.pts) hits.push({ x: g.x(p[1]), y: g.y(p[2]), group: sr.day, record: recordFor(p), text: pointText(p) });
    }
    hits.sort((a, b) => a.x - b.x || a.y - b.y);
    // 하루만 볼 때는 누른 시각에 가장 가까운 값. 여러 날이면 그 시각에 선이 있는 날 중 세로로 가까운 선
    // (선이 있다 = 기록 간격 × 1.5 안에 점이 있음)
    const tol = Math.max(3, g.x(d.maxGap * 1.5) - g.x(0));
    return { hits, mode: state.overlay ? 'xy' : 'x', g, tol };
  }

  function centerText(g, a, b) {
    const cx = g.m.l + g.pw / 2, cy = g.m.t + g.ph / 2;
    return `<rect x="${r1(cx - Math.min(g.pw / 2 - 6, 170))}" y="${cy - 34}" width="${r1(Math.min(g.pw - 12, 340))}" height="62" rx="8" fill="#ffffff" fill-opacity="0.92" stroke="#c9d6cf"/>` +
      `<text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="16" font-weight="700" fill="${PAL.ink}">${esc(a)}</text>` +
      `<text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="14" fill="${PAL.ink}">${esc(b)}</text>`;
  }

  function drawGrid(wrap) {
    const d = ds();
    const counts = info(d).counts;
    let html = '<div class="grid">';
    for (let day = 1; day <= d.days; day += 1) {
      const empty = counts[day] === 0;
      // 관측 / 예상 수는 요약과 같이 시간대 안만
      const s = C.summarize(d, { days: [day], startHour: state.startHour, endHour: state.endHour });
      const sub = empty ? '기록 없음' : `${fmtInt(s.observed)}개`;
      html += `<button type="button" class="tile${empty ? ' empty' : ''}" data-day="${day}" aria-label="D${day} ${sub} · 하루씩 보기로 열기">` +
        `<span class="tile-head"><b>D${day} <small>${dateLabel(day)}</small></b><span>${sub}</span></span><span class="tile-plot" data-day="${day}"></span></button>`;
    }
    html += '</div>';
    wrap.innerHTML = html;
    const yDom = info(d).yDom;
    wrap.querySelectorAll('.tile-plot').forEach(el => {
      const day = Number(el.dataset.day);
      const w = Math.max(60, Math.floor(el.clientWidth || 100));
      const h = Math.round(Math.max(64, Math.min(96, w * 0.62)));
      const g = geom(w, h, yDom, true);
      const pts = d.points.filter(p => p[0] === day);
      const schedule = scheduleLayer(g, [day], true);
      let s = `<svg viewBox="0 0 ${w} ${h + schedule.extra}" width="${w}" height="${h + schedule.extra}" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">`;
      s += baseLayer(g, true);
      s += seriesLayer([{ day, color: PAL.line, pts }], g, d.maxGap, { width: 1.1, dot: 2.3 });
      s += windowLayer(g);
      el.innerHTML = s + schedule.html + '</svg>';
    });
    return { hits: [], mode: 'none' };
  }

  function bandPolys(bins, lo, hi, g, color) {
    let s = '', run = [];
    const flush = () => {
      if (run.length > 1) {
        const top = run.map(b => `${g.x(b.minute)},${g.y(b[hi])}`);
        const bottom = run.slice().reverse().map(b => `${g.x(b.minute)},${g.y(b[lo])}`);
        s += `<polygon points="${top.concat(bottom).join(' ')}" fill="${color}"/>`;
      }
      run = [];
    };
    for (const b of bins) { if (b.ok) run.push(b); else flush(); }
    flush();
    return s;
  }
  function medianPath(bins, g, color, width, dash) {
    let s = '', run = [];
    const flush = () => {
      if (run.length > 1) {
        s += `<path d="${run.map((b, i) => `${i ? 'L' : 'M'}${g.x(b.minute)} ${g.y(b.p50)}`).join('')}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
      } else if (run.length === 1) {
        s += `<circle cx="${g.x(run[0].minute)}" cy="${g.y(run[0].p50)}" r="${width}" fill="${color}"/>`;
      }
      run = [];
    };
    for (const b of bins) { if (b.ok) run.push(b); else flush(); }
    flush();
    return s;
  }

  function drawAgp(wrap) {
    const d = ds();
    const days = selectedDays();
    const bins = C.percentileProfile(d, { days });
    const [w, h] = chartSize(wrap);
    const g = geom(w, h, info(d).yDom, false);
    const schedule = scheduleLayer(g, days);
    let s = svgOpen(w, h + schedule.extra, `${d.label} 겹친 하루 관측값 요약 그래프: 중앙값과 25–75%, 5–95% 띠. 가로 00–24시, 세로 mg/dL`);
    s += baseLayer(g, false, true);
    s += bandPolys(bins, 'p5', 'p95', g, PAL.agpLight);
    s += bandPolys(bins, 'p25', 'p75', g, PAL.agpDark);
    s += medianPath(bins, g, PAL.median, 2.6);
    s += windowLayer(g);
    if (!bins.some(b => b.ok)) s += centerText(g, '계산할 값이 부족함', '시각마다 값 5개 이상 필요');
    s += schedule.html + '<g class="cursor" pointer-events="none"></g></svg>';
    wrap.innerHTML = s;
    const midY = g.m.t + g.ph / 2;
    const R = v => Math.round(v);
    // 읽기 줄 (white-space: pre-line): 시각·중앙값 / 25–75% / 5–95%. 휴대폰은 세 줄, 넓은 화면은 두 줄
    const sep = w < 560 ? '\n' : ' · ';
    const hits = bins.map(b => ({
      x: g.x(b.minute), y: b.ok ? g.y(b.p50) : midY,
      text: b.ok
        ? `${C.fmtMinute(b.minute)} · 중앙값 ${mgdl(R(b.p50))} (값 ${b.n}개)\n` +
          `${range(25, 75)}%:${NB}${mgdl(range(R(b.p25), R(b.p75)))}${sep}${range(5, 95)}%:${NB}${mgdl(range(R(b.p5), R(b.p95)))}`
        : `${C.fmtMinute(b.minute)} · 값 ${b.n}개 → 5개 미만이라 비움`,
    }));
    return { hits, mode: 'x', g };
  }

  function drawCompare(wrap) {
    const d = ds();
    const series = [
      {day: state.compareA, color: PAL.a, pts: d.points.filter(p => p[0] === state.compareA)},
      {day: state.compareB, color: PAL.b, pts: d.points.filter(p => p[0] === state.compareB)},
    ];
    const [w, h] = chartSize(wrap);
    const g = geom(w, h, info(d).yDom, false);
    const scheduleDays = [...new Set(series.map(sr => sr.day))];
    const schedule = scheduleLayer(g, scheduleDays, false, scheduleDays.map(day => series.find(sr => sr.day === day).color));
    let s = svgOpen(w, h + schedule.extra, `${dateLabel(state.compareA)}와 ${dateLabel(state.compareB)} 실제 혈당 측정값 비교. 가로 00–24시, 세로 mg/dL`);
    s += baseLayer(g, false);
    s += seriesLayer(series, g, d.maxGap, {width: 1.6, dot: 4.2});
    s += windowLayer(g) + schedule.html + '<g class="cursor" pointer-events="none"></g></svg>';
    wrap.innerHTML = s;
    const hits = series.flatMap(sr => sr.pts.map(p => ({x: g.x(p[1]), y: g.y(p[2]), group: sr.day, record: recordFor(p), text: pointText(p)})));
    hits.sort((a, b) => a.x - b.x || a.y - b.y);
    return {hits, mode: 'xy', g, tol: Math.max(3, g.x(30) - g.x(0))};
  }

  /* ---------- 커서 (누르기·끌기·화살표) ---------- */
  let chartGeom = null;
  function showCursor(i) {
    const svg = $('#chart-wrap svg.main');
    const out = $('#readout');
    if (!svg || i < 0 || !state.hits[i]) {
      // 그래프가 없거나 (A·B 비교 불가) 그릴 값이 없으면 (빈 날) 안내 문구도 비움
      out.textContent = state.tab === 'grid' || (svg && state.hits.length) ? HINT[state.tab] : '';
      out.classList.add('hint-text');
      renderRecord(null);
      showScheduleForRecord(null);
      return;
    }
    state.cursor = i;
    const hit = state.hits[i];
    const g = chartGeom;
    svg.querySelector('.cursor').innerHTML =
      `<line x1="${hit.x}" x2="${hit.x}" y1="${g.m.t}" y2="${g.scheduleBottom || g.m.t + g.ph}" stroke="${PAL.ink}" stroke-width="1" stroke-dasharray="3 3"/>` +
      `<circle cx="${hit.x}" cy="${hit.y}" r="5.5" fill="#ffffff" stroke="${PAL.ink}" stroke-width="2"/>`;
    out.textContent = hit.text;
    renderRecord(hit.record || null);
    showScheduleForRecord(hit.record || null);
    out.classList.remove('hint-text');
  }

  let hitMode = 'none', hitTol = 10;
  function onPointer(e) {
    const segment = e.target.closest?.('[data-schedule-segment]');
    if (segment) { showScheduleSegment(segment); return; }
    const svg = e.target.closest && e.target.closest('svg.main');
    if (!svg || !state.hits.length) return;
    const rect = svg.getBoundingClientRect();
    const scale = chartGeom.width / rect.width;
    if ((e.clientY - rect.top) * scale > chartGeom.m.t + chartGeom.ph) return;
    const i = C.nearestHit(state.hits, (e.clientX - rect.left) * scale, (e.clientY - rect.top) * scale, hitMode, hitTol);
    if (i >= 0) showCursor(i);
  }
  function onChartKey(e) {
    if (!e.target.matches || !e.target.matches('svg.main') || !state.hits.length) return;
    const last = state.hits.length - 1;
    let i = state.cursor;
    if (e.key === 'ArrowRight') i = i < 0 ? 0 : Math.min(last, i + 1);
    else if (e.key === 'ArrowLeft') i = i < 0 ? last : Math.max(0, i - 1);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = last;
    else return;
    e.preventDefault();
    showCursor(i);
  }

  /* ---------- 조작 영역 ---------- */
  function chipHTML(day, n, pressed, extra, outLabel) {
    const empty = n === 0;
    const sub = empty ? '없음' : (!pressed && outLabel) || '';
    const label = `${dateLabel(day)} D${day}${empty ? ' 기록 없음' : sub ? ' ' + sub : ''}`;
    return `<button type="button" class="chip${empty ? ' empty' : ''}" data-chip="${day}" aria-pressed="${pressed}" aria-label="${label}"${extra || ''}>` +
      `<b>D${day}</b><small aria-hidden="true">${dateLabel(day)}</small>${sub ? `<small aria-hidden="true">${sub}</small>` : ''}</button>`;
  }
  const swatch = (color, dash, kind) => {
    if (kind === 'estimate') return `<svg viewBox="0 0 24 12" aria-hidden="true"><line x1="1" y1="6" x2="23" y2="6" stroke="${color}" stroke-width="1.6" stroke-opacity="0.38" stroke-dasharray="3 5" stroke-linecap="round"/></svg>`;
    if (kind === 'band') return `<svg viewBox="0 0 24 12" aria-hidden="true"><rect x="0" y="1" width="24" height="10" fill="${color}" stroke="${PAL.bandLine}"/></svg>`;
    if (kind === 'dot') return `<svg viewBox="0 0 24 12" aria-hidden="true"><circle cx="12" cy="6" r="4.5" fill="${color}"${color === PAL.high ? ` stroke="${PAL.highStroke}"` : ''}/></svg>`;
    if (kind === 'fill') return `<svg viewBox="0 0 24 12" aria-hidden="true"><rect x="0" y="1" width="24" height="10" fill="${color}"/></svg>`;
    return `<svg viewBox="0 0 24 12" aria-hidden="true"><line x1="1" y1="6" x2="23" y2="6" stroke="${color}" stroke-width="3"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>`;
  };

  function renderControls() {
    const box = $('#view-controls');
    const d = ds();
    const counts = info(d).counts;
    if (state.tab === 'day') {
      const pickedDays = new Map(state.picks.map(p => [p.day, p.slot]));
      const full = state.picks.length >= MAX_OVERLAY;
      let chips = '';
      for (let day = 1; day <= d.days; day += 1) {
        if (state.overlay) {
          const on = pickedDays.has(day);
          chips += chipHTML(day, counts[day], on, !on && full ? ' disabled' : '');
        } else chips += chipHTML(day, counts[day], day === state.day);
      }
      box.innerHTML =
        `<div class="view-head">` +
        (state.overlay
          ? `<span class="grow hint">날짜를 눌러 넣고 빼기 · 최대 ${MAX_OVERLAY}일${full ? ' (가득 참)' : ''}</span>`
          : `<button type="button" class="ghost" id="prev-day" ${state.day <= 1 ? 'disabled' : ''} aria-label="이전 날">◀<span class="wide-only"> 이전</span></button>` +
            `<span class="title" aria-live="polite">D${state.day}<small>${dateLabel(state.day)}</small></span>` +
            `<button type="button" class="ghost" id="next-day" ${state.day >= d.days ? 'disabled' : ''} aria-label="다음 날"><span class="wide-only">다음 </span>▶</button>` +
            `<span class="grow"></span>`) +
        `<button type="button" class="ghost toggle" id="overlay" aria-pressed="${state.overlay}">여러 날 같이 보기</button>` +
        `</div><div class="chips" role="group" aria-label="날짜 고르기">${chips}</div>`;
      if (state.overlay) {
        box.querySelectorAll('.chip[aria-pressed=true]').forEach(el => {
          const slot = pickedDays.get(Number(el.dataset.chip));
          el.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 24 8" aria-hidden="true"><rect width="24" height="8" rx="2" fill="#ffffff"/><line x1="3" y1="4" x2="21" y2="4" stroke="${DAY_COLORS[slot]}" stroke-width="4"/></svg>`);
        });
      }
    } else if (state.tab === 'grid') {
      box.innerHTML = `<p class="hint">초록 띠 = 70–180 mg/dL · 가로 = 00–24시 · 칸마다 선택한 시간대의 실제 관측 수</p>`;
    } else if (state.tab === 'agp') {
      let chips = '';
      for (let day = 1; day <= d.days; day += 1) chips += chipHTML(day, counts[day], !state.agpOut.has(day), '', '뺌');
      const inDays = C.allDays(d).filter(x => !state.agpOut.has(x));
      const withData = inDays.filter(x => counts[x] > 0).length;
      box.innerHTML =
        `<p class="hint">겹친 하루 = 여러 날의 비슷한 시각에 측정한 값을 모은 그래프</p>` +
        `<div class="view-head"><span class="grow hint">포함한 날 ${inDays.length}일` +
        `${withData < inDays.length ? ` (기록 있는 날 ${withData}일)` : ''} · 눌러서 빼기·넣기</span>` +
        `<button type="button" class="ghost" id="agp-all" ${state.agpOut.size ? '' : 'hidden'}>모두 포함</button></div>` +
        `<div class="chips agp" role="group" aria-label="겹칠 날짜">${chips}</div>`;
    } else {
      const options = current => C.allDays(d).map(day => `<option value="${day}"${current === day ? ' selected' : ''}>${dateLabel(day)} (D${day})</option>`).join('');
      box.innerHTML = `<div class="compare-controls"><label for="compare-a">날짜 1</label><select id="compare-a">${options(state.compareA)}</select><span aria-hidden="true">↔</span><label for="compare-b">날짜 2</label><select id="compare-b">${options(state.compareB)}</select><button type="button" id="compare-swap" class="ghost">맞바꾸기</button></div><p class="hint">내 기록 안에서 두 날짜의 실제 측정값 비교 · 차이의 원인은 이 그래프만으로 알 수 없음</p>`;
    }
  }

  function renderLegend() {
    const L = $('#legend');
    const winNote = C.isFullDay(state.startHour, state.endHour) ? '' :
      `<span>${swatch('#dfe3df', '', 'fill')}시간대 밖 (흐리게)</span>`;
    const band = `<span>${swatch(PAL.band, '', 'band')}70–180 mg/dL</span>`;
    const lowHigh = `<span>${swatch(PAL.low, '', 'dot')}70 mg/dL 미만</span><span>${swatch(PAL.high, '', 'dot')}180 mg/dL 초과</span>`;
    const estimate = `<span>${swatch(PAL.line, '', 'estimate')}추정 연결</span>`;
    const measurementNote = `<span class="note">큰 점 = 실제 측정값 · 옅은 점선 = 측정 사이 추정값 (실측 아님) · 2시간 넘게 떨어진 값은 연결하지 않음</span>`;
    if (state.tab === 'day') {
      const counts = info(ds()).counts;
      const first = state.overlay
        ? state.picks.map(p => `<span>${swatch(DAY_COLORS[p.slot], '', 'dot')}D${p.day}${counts[p.day] ? '' : ' (기록 없음)'}</span>`).join('')
        : `<span>${swatch(PAL.line, '', 'dot')}실제 측정값</span>`;
      L.innerHTML = first + estimate + lowHigh + band + winNote + measurementNote;
    } else if (state.tab === 'grid') {
      L.innerHTML = `<span>${swatch(PAL.line, '', 'dot')}실제 측정값</span>` + estimate + lowHigh + band + winNote + measurementNote;
    } else if (state.tab === 'agp') {
      L.innerHTML =
        `<span>${swatch(PAL.median)}중앙값 (median) = 50번째 백분위 (percentile)</span>` +
        `<span>${swatch(PAL.agpDark, '', 'fill')}25–75% (가운데 50%)</span>` +
        `<span>${swatch(PAL.agpLight, '', 'fill')}5–95% (가운데 90%)</span>` +
        `<span>${swatch(PAL.bandLine)}70·180 mg/dL 선</span>` + winNote +
        `<span class="note">백분위 = 작은 값부터 줄 세운 위치 · 각 시각 앞뒤 30분 값을 모든 날에서 모음 · 값 5개 미만 시각은 비움 · 측정이 잦은 날의 영향이 더 클 수 있음</span>`;
    } else {
      L.innerHTML = `<span>${swatch(PAL.a, '', 'dot')}${dateLabel(state.compareA)} (D${state.compareA})</span><span>${swatch(PAL.b, '', 'dot')}${dateLabel(state.compareB)} (D${state.compareB})</span>` + estimate + band + winNote + measurementNote;
    }
  }

  function renderChart() {
    renderScheduleUI();
    const wrap = $('#chart-wrap');
    let res = { hits: [], mode: 'none' };
    if (state.tab === 'day') res = drawDay(wrap);
    else if (state.tab === 'grid') res = drawGrid(wrap);
    else if (state.tab === 'agp') res = drawAgp(wrap);
    else res = drawCompare(wrap);

    state.hits = res.hits;
    hitMode = res.mode;
    hitTol = res.tol || 10;
    $('#readout').dataset.tab = state.tab; // AGP 는 두 줄 자리 (그래프가 위아래로 튀지 않게)
    chartGeom = res.g || null;
    const keep = state.cursor;
    state.cursor = -1;
    showCursor(keep >= 0 && keep < state.hits.length ? keep : -1);
  }

  /* ---------- 요약 ---------- */
  function statsBlock(sum) {
    const none = '<span class="none">관측 없음</span>';
    const mm = x => (x ? `${mgdl(fmtG(x.value))}<small>${at(x.day, x.minute)}</small>` : none);
    return `<dl class="stats">` +
      `<div><dt>관측 수</dt><dd>${fmtInt(sum.observed)}개</dd></div>` +
      `<div><dt>측정한 날 <small>(선택 시간대)</small></dt><dd>${sum.observedDays}일 / ${sum.dayCount}일</dd></div>` +
      `<div><dt>평균</dt><dd>${sum.mean === null ? none : mgdl(fmt1(sum.mean))}</dd></div>` +
      `<div><dt>표준편차 (SD)</dt><dd>${sum.sd !== null ? mgdl(fmt1(sum.sd)) : sum.observed ? '<span class="none">값 2개 이상 필요</span>' : none}</dd></div>` +
      `<div><dt>최저</dt><dd>${mm(sum.min)}</dd></div>` +
      `<div><dt>최고</dt><dd>${mm(sum.max)}</dd></div>` +
      `</dl>`;
  }
  function rangeBlock(sum) {
    if (!sum.observed) return `<h3>관측값 비율</h3><p class="none">관측 없음 → 비율 계산 안 함</p>`;
    const w = [sum.lowPct, sum.inRangePct, sum.highPct];
    let x = 0, rects = '';
    [PAL.low, PAL.inRange, PAL.high].forEach((c, i) => {
      if (w[i] > 0) rects += `<rect x="${r1(x)}" y="0" width="${r1(w[i])}" height="10" fill="${c}"/>`;
      x += w[i];
    });
    return `<h3>관측값 비율 <small>관측 개수 기준 · 임상 TIR (Time in Range) 아님</small></h3>` +
      `<svg class="rbar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">${rects}</svg>` +
      `<ul class="ranges">` +
      `<li><i class="sw low"></i>70 mg/dL 미만 <b>${fmt1(sum.lowPct)}%</b></li>` +
      `<li><i class="sw in"></i>70–180 mg/dL <b>${fmt1(sum.inRangePct)}%</b></li>` +
      `<li><i class="sw high"></i>180 mg/dL 초과 <b>${fmt1(sum.highPct)}%</b></li></ul>`;
  }
  function renderSummary() {
    const box = $('#summary');
    const opts = { startHour: state.startHour, endHour: state.endHour };
    if (state.tab === 'compare') {
      const A = ds();
      const sa = C.summarize(A, {days: [state.compareA], ...opts}), sb = C.summarize(A, {days: [state.compareB], ...opts});
      const cell = (s, f) => `<td>${f(s)}</td>`;
      const pct = k => s => (s[k] === null ? '—' : fmt1(s[k]) + '%');
      const mm = k => s => (s[k] ? `${mgdl(fmtG(s[k].value))}<small>${at(s[k].day, s[k].minute)}</small>` : '—');
      const rows = [
        ['관측 수', s => `${fmtInt(s.observed)}개`],
        ['평균', s => (s.mean === null ? '—' : mgdl(fmt1(s.mean)))],
        ['표준편차 (SD)', s => (s.sd === null ? '—' : mgdl(fmt1(s.sd)))],
        ['최저', mm('min')], ['최고', mm('max')],
        ['70 mg/dL 미만', pct('lowPct')], ['70–180 mg/dL', pct('inRangePct')], ['180 mg/dL 초과', pct('highPct')],
      ];
      box.innerHTML = `<h2>요약 · 날짜 비교</h2><p class="scope">${dateLabel(state.compareA)} ↔ ${dateLabel(state.compareB)} · ${windowText()}</p>` +
        `<table class="cmp"><thead><tr><th scope="col"><span class="sr-only">항목</span></th><th scope="col">${dateLabel(state.compareA)}</th><th scope="col">${dateLabel(state.compareB)}</th></tr></thead><tbody>` +
        rows.map(([name, f]) => `<tr><th scope="row">${name}</th>${cell(sa, f)}${cell(sb, f)}</tr>`).join('') +
        `</tbody></table>` +
        `<p class="scope">마지막 세 줄 = 관측값 개수 비율 · 임상 TIR (Time in Range) 아님</p>`;
      return;
    }
    const d = ds();
    const days = selectedDays();
    if (!days.length) {
      box.innerHTML = `<h2>요약</h2><p class="scope">${esc(d.label)} · 고른 날 없음</p><p class="none">날짜를 1개 이상 고르세요</p>`;
      return;
    }
    const sum = C.summarize(d, { days, ...opts });
    box.innerHTML = `<h2>요약</h2><p class="scope">${esc(d.label)} · ${daysText(days, d.days)} · ${windowText()}</p>` +
      statsBlock(sum) + rangeBlock(sum);
  }

  /* ---------- One fixed dataset ---------- */
  function renderChooser() {
    const d = ds();
    $('#data-info').textContent = `${d.days}일 · 불규칙 측정 · 관측 ${fmtInt(d.points.length)}개`;
    $('#grid-days').textContent = `${d.days}일`;
  }

  function renderRecord(record) {
    const box = $('#record-detail');
    box.hidden = !record;
    if (!record) { box.innerHTML = ''; return; }
    const remarks = [record.detail, record.extra].filter(Boolean);
    box.innerHTML = `<div class="record-heading"><strong>${at(record.day, record.minute)} · ${record.value} mg/dL</strong>${record.photo ? `<button type="button" class="ghost" data-photo="${record.id}">측정 사진 보기</button>` : ''}</div>${record.note ? `<p class="record-note">${esc(record.note)}</p>` : ''}<p>${remarks.length ? remarks.map(esc).join('<br>') : '추가 메모 없음'}</p>`;
  }

  function renderRecords() {
    const selected = new Set(selectedDays());
    const records = ds().records.filter(r => selected.has(r.day) && C.inWindow(r.minute, state.startHour, state.endHour));
    $('#record-count').textContent = `· ${records.length}개`;
    $('#record-table').innerHTML = records.length ? `<table class="records-table"><thead><tr><th scope="col">날짜</th><th scope="col">시간</th><th scope="col">mg/dL</th><th scope="col">측정 상황 · 메모</th></tr></thead><tbody>${records.map(r => `<tr><td>${dateLabel(r.day)}</td><td><button class="record-link" type="button" data-record="${r.id}">${r.time}</button></td><td class="reading${r.value > 180 ? ' above' : r.value < 70 ? ' below' : ''}">${r.value}</td><td>${[r.note, r.detail, r.extra].filter(Boolean).map(esc).join(' · ') || '—'}${r.photo ? ` <button type="button" class="photo-link" data-photo="${r.id}">사진</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">선택한 날짜와 시간대에 측정한 기록이 없습니다.</p>';
  }

  function openPhoto(record) {
    if (!record || !record.photo) return;
    $('#photo-title').textContent = `${at(record.day, record.minute)} · ${record.value} mg/dL`;
    $('#photo-image').src = record.photo;
    $('#photo-image').alt = `${at(record.day, record.minute)} 혈당 ${record.value} mg/dL 측정 사진`;
    $('#photo-dialog').showModal();
  }

  /* ---------- 시간대 ---------- */
  function initWindow() {
    const s = $('#win-start'), e = $('#win-end');
    for (let h = 0; h < 24; h += 1) s.add(new Option(`${hh(h)}시`, String(h)));
    for (let h = 1; h <= 24; h += 1) e.add(new Option(`${hh(h)}시`, String(h)));
    // 시작 = 끝이 되면 다른 쪽을 1시간 밀어 줌 (조작칸과 결과가 어긋나지 않게)
    s.addEventListener('change', () => {
      [state.startHour, state.endHour] = C.normalizeWindow(Number(s.value), state.endHour, 'start');
      state.cursor = -1; render();
    });
    e.addEventListener('change', () => {
      [state.startHour, state.endHour] = C.normalizeWindow(state.startHour, Number(e.value), 'end');
      state.cursor = -1; render();
    });
    $('#win-reset').addEventListener('click', () => { state.startHour = 0; state.endHour = 24; render(); });
  }
  function renderWindow() {
    $('#win-start').value = String(state.startHour);
    $('#win-end').value = String(state.endHour);
    const full = C.isFullDay(state.startHour, state.endHour);
    $('#win-reset').hidden = full;
    $('#win-note').textContent = full ? '' : `${C.windowLength(state.startHour, state.endHour) / 60}시간${state.startHour > state.endHour ? ' · 같은 날 두 구간' : ''}`;
  }

  function renderTabs() {
    document.querySelectorAll('[role=tab]').forEach(b => {
      const on = b.dataset.tab === state.tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $('#view').setAttribute('aria-labelledby', 'tab-' + state.tab);
  }

  function render() {
    renderChooser();
    renderTabs();
    renderWindow();
    renderControls();
    renderChart();
    renderLegend();
    renderSummary();
    renderRecords();
  }

  function scrollToViewer() {
    const v = $('#viewer');
    if (v.getBoundingClientRect().top < 0 || v.getBoundingClientRect().top > window.innerHeight * 0.6) v.scrollIntoView({ block: 'start' });
  }

  /* ---------- 이벤트 ---------- */
  function bind() {
    $('#schedule-toggle').addEventListener('click', () => {
      state.showSchedule = !state.showSchedule;
      renderChart();
      $('#schedule-toggle').focus();
    });
    $('#view-controls').addEventListener('change', e => {
      if (e.target.id !== 'compare-a' && e.target.id !== 'compare-b') return;
      const id = e.target.id;
      state[id === 'compare-a' ? 'compareA' : 'compareB'] = Number(e.target.value);
      state.cursor = -1;
      render();
      document.getElementById(id).focus();
    });
    document.addEventListener('click', e => {
      const photo = e.target.closest('[data-photo]');
      if (photo) { openPhoto(recordById.get(photo.dataset.photo)); return; }
      const target = e.target.closest('[data-record]');
      if (target) {
        const record = recordById.get(target.dataset.record);
        const hit = state.hits.findIndex(h => h.record && h.record.id === record.id);
        if (hit >= 0) showCursor(hit); else renderRecord(record);
        $('#record-detail').scrollIntoView({block: 'nearest'});
      }
    });
    $('#photo-close').addEventListener('click', () => $('#photo-dialog').close());
    $('#photo-dialog').addEventListener('click', e => {
      if (e.target === e.currentTarget) {
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close();
      }
    });

    const tablist = $('.tabs');
    tablist.addEventListener('click', e => {
      const b = e.target.closest('[role=tab]');
      if (b && b.dataset.tab !== state.tab) { state.tab = b.dataset.tab; state.cursor = -1; render(); }
    });
    tablist.addEventListener('keydown', e => {
      const i = TABS.indexOf(state.tab);
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
      else if (e.key === 'ArrowLeft') j = (i + TABS.length - 1) % TABS.length;
      if (j === null) return;
      e.preventDefault();
      state.tab = TABS[j]; state.cursor = -1; render();
      $('#tab-' + state.tab).focus();
    });

    $('#view-controls').addEventListener('click', e => {
      const d = ds();
      const chip = e.target.closest('[data-chip]');
      if (e.target.closest('#prev-day')) { state.day = Math.max(1, state.day - 1); state.cursor = -1; }
      else if (e.target.closest('#next-day')) { state.day = Math.min(d.days, state.day + 1); state.cursor = -1; }
      else if (e.target.closest('#compare-swap')) { [state.compareA, state.compareB] = [state.compareB, state.compareA]; state.cursor = -1; }
      else if (e.target.closest('#overlay')) {
        state.overlay = !state.overlay;
        if (state.overlay) state.picks = [{ day: state.day, slot: 0 }];
        else if (state.picks.length) state.day = state.picks[0].day;
        state.cursor = -1;
      } else if (e.target.closest('#agp-all')) state.agpOut.clear();
      else if (chip) {
        const day = Number(chip.dataset.chip);
        if (state.tab === 'agp') {
          if (state.agpOut.has(day)) state.agpOut.delete(day); else state.agpOut.add(day);
        } else if (state.overlay) {
          const i = state.picks.findIndex(p => p.day === day);
          if (i >= 0) state.picks.splice(i, 1);
          else if (state.picks.length < MAX_OVERLAY) {
            const used = new Set(state.picks.map(p => p.slot));
            let slot = 0;
            while (used.has(slot)) slot += 1;
            state.picks.push({ day, slot });
          }
        } else state.day = day;
        state.cursor = -1;
      } else return;
      const focusId = e.target.closest('button') && e.target.closest('button').id;
      const focusChip = chip && chip.dataset.chip;
      render();
      if (focusId && document.getElementById(focusId) && !document.getElementById(focusId).disabled) document.getElementById(focusId).focus();
      else if (focusChip) { const el = document.querySelector(`[data-chip="${focusChip}"]`); if (el) el.focus(); }
    });

    const wrap = $('#chart-wrap');
    wrap.addEventListener('pointerdown', onPointer);
    wrap.addEventListener('pointermove', onPointer);
    wrap.addEventListener('keydown', onChartKey);
    wrap.addEventListener('focusin', e => {
      const segment = e.target.closest('[data-schedule-segment]');
      if (segment) showScheduleSegment(segment);
    });
    wrap.addEventListener('keydown', e => {
      const segment = e.target.closest('[data-schedule-segment]');
      if (segment && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showScheduleSegment(segment); }
    });
    wrap.addEventListener('click', e => {
      const segment = e.target.closest('[data-schedule-segment]');
      if (segment) { showScheduleSegment(segment); return; }
      const tile = e.target.closest('.tile');
      if (tile) {
        state.tab = 'day'; state.overlay = false; state.day = Number(tile.dataset.day); state.cursor = -1;
        render(); scrollToViewer();
        return;
      }
    });

    let raf = 0, lastW = 0;
    const onResize = () => {
      const w = wrap.clientWidth;
      if (w === lastW) return;
      lastW = w;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(renderChart);
    };
    if (window.ResizeObserver) new ResizeObserver(onResize).observe(wrap);
    else window.addEventListener('resize', onResize);
  }

  function init() {


    initWindow();
    bind();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
