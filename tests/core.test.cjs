const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../dist/cgm-core.js');
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/data-personal.js'),'utf8'), context);
const data = JSON.parse(JSON.stringify(context.window.PERSONAL_DATA));
const dataset = points => ({days:2,points,maxGap:120});

test('all 207 workbook records and their dates are preserved',()=>{
  assert.equal(data.records.length,207);
  assert.equal(data.points.length,207);
  assert.equal(data.days,15);
  assert.equal(data.startDate,'2026-10-23');
  assert.equal(data.endDate,'2026-11-06');
  assert.equal(data.points.reduce((sum,p)=>sum+p[2],0),26867);
  assert.equal(new Set(data.records.map(r=>r.date+' '+r.time)).size,207);
  assert.equal(data.records.filter(r=>r.photo).length,0);
  for(const r of data.records){
    assert.deepEqual(data.points[data.records.indexOf(r)],[r.day,r.minute,r.value]);
    if(r.photo) assert.ok(fs.existsSync(path.join(__dirname,'../dist',r.photo)));
  }
});
test('full-data summary agrees with independently read workbook extrema and mean',()=>{
  const s=C.summarize(data);
  assert.equal(s.observed,207);
  assert.equal(s.observedDays,15);
  assert.ok(Math.abs(s.mean-129.79227053140096)<1e-10);
  assert.equal(s.min.value,76);
  assert.equal(s.max.value,266);
  assert.equal(s.max.day,14);
  assert.equal(s.max.minute,18*60+45);
  assert.equal(s.low+s.inRange+s.high,207);
  assert.ok(Math.abs(s.lowPct+s.inRangePct+s.highPct-100)<1e-10);
  assert.ok(!('expected' in s),'irregular observations have no invented expected count');
});
test('comparison summaries are scoped to each selected date and time window',()=>{
  const a=C.summarize(data,{days:[14],startHour:18,endHour:24});
  const b=C.summarize(data,{days:[15],startHour:18,endHour:24});
  assert.equal(a.observed,7);
  assert.equal(b.observed,7);
  assert.equal(a.max.value,266);
  assert.equal(b.max.value,135);
  assert.ok(Math.abs(a.mean-1174/7)<1e-10);
  assert.ok(Math.abs(b.mean-810/7)<1e-10);
});
test('70 and 180 are included in range, and SD uses n minus one',()=>{
  const s=C.summarize(dataset([[1,0,69],[1,10,70],[1,20,180],[1,30,181]]));
  assert.equal(s.low,1);assert.equal(s.inRange,2);assert.equal(s.high,1);
  assert.equal(s.mean,125);
  assert.ok(Math.abs(s.sd-Math.sqrt((56**2+55**2+55**2+56**2)/3))<1e-10);
});
test('empty observations remain unavailable instead of zero',()=>{
  const s=C.summarize(data,{days:[1],startHour:0,endHour:5});
  assert.equal(s.observed,0);assert.equal(s.mean,null);assert.equal(s.sd,null);
  assert.equal(s.min,null);assert.equal(s.max,null);assert.equal(s.inRangePct,null);
  assert.equal(s.observedDays,0);
  assert.equal(C.summarize(data,{days:[]}).observed,0);
});
test('one observation has no sample SD',()=>{
  const s=C.summarize(dataset([[1,600,100]]),{days:[1]});
  assert.equal(s.mean,100);assert.equal(s.sd,null);
});
test('time filter uses a half-open interval and same-date wraparound',()=>{
  assert.equal(C.inWindow(18*60,18,24),true);
  assert.equal(C.inWindow(19*60,18,19),false);
  assert.equal(C.inWindow(23*60,22,6),true);
  assert.equal(C.inWindow(3*60,22,6),true);
  assert.equal(C.inWindow(12*60,22,6),false);
  assert.deepEqual(C.normalizeWindow(6,6,'start'),[6,7]);
  assert.deepEqual(C.normalizeWindow(6,6,'end'),[5,6]);
});
test('line segments break after 120 minutes without adding points',()=>{
  const points=[[1,10,100],[1,130,120],[1,251,130]];
  assert.deepEqual(C.segments(points,120),[points.slice(0,2),points.slice(2)]);
});
test('percentile profile requires five actual values and honors excluded days',()=>{
  const d={days:5,points:[[1,600,80],[2,610,100],[3,590,120],[4,605,140],[5,600,160]]};
  const b=C.percentileProfile(d).find(b=>b.minute===600);
  assert.equal(b.n,5);assert.equal(b.p50,120);assert.equal(b.p25,100);assert.equal(b.p75,140);
  const excluded=C.percentileProfile(d,{days:[1,2,3,4]}).find(b=>b.minute===600);
  assert.equal(excluded.ok,false);assert.equal(excluded.p50,null);
  assert.equal(C.percentileProfile(data).filter(b=>b.ok).length>0,true);
});
test('no professor or synthetic datasets and no data switching controls ship',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../dist/index.html'),'utf8');
  const app=fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8');
  assert.doesNotMatch(html,/data-set=|id="csv-file"|교수 기간|가짜/);
  assert.doesNotMatch(app,/CGM_PROFESSOR|makeSynthetic|state\.datasets/);
});
