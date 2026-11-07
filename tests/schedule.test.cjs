const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {window:{}};
for (const name of ['data-personal.js','data-schedule.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist',name),'utf8'),context);
}
const schedule=JSON.parse(JSON.stringify(context.window.PERSONAL_SCHEDULE));
const blood=JSON.parse(JSON.stringify(context.window.PERSONAL_DATA));
const label=id=>schedule.activities.find(activity=>activity.id===id)?.label;

test('schedule dates match all fifteen measurement dates',()=>{
  assert.deepEqual(schedule.days.map(day=>day.date),blood.dates);
  assert.equal(schedule.precisionMinutes,30);
  assert.equal(schedule.activities.length,8);
  assert.equal(new Set(schedule.activities.map(activity=>activity.id)).size,8);
});
test('activity timelines have no overlaps, gaps, or invented overnight activity',()=>{
  const ids=new Set(schedule.activities.map(activity=>activity.id));
  for(const day of schedule.days){
    assert.equal(day.segments[0].start,0);
    assert.equal(day.segments.at(-1).end,1440);
    let end=0;
    for(const segment of day.segments){
      assert.equal(segment.start,end);
      assert.ok(segment.end>segment.start&&segment.end<=1440);
      assert.equal(segment.start%30,0);assert.equal(segment.end%30,0);
      assert.ok(segment.activity===null||ids.has(segment.activity));
      end=segment.end;
    }
    assert.deepEqual(day.segments[0],{start:0,end:360,activity:null});
  }
});
test('corrected wake-up and café intervals are retained from the source schedule',()=>{
  const sunday=schedule.days.find(day=>day.date==='2026-10-25');
  const reading=sunday.segments.find(segment=>label(segment.activity)==='독서');
  assert.equal(reading.start,450);assert.equal(reading.end,570);
  const monday=schedule.days.find(day=>day.date==='2026-10-26');
  const cafe=monday.segments.find(segment=>label(segment.activity)==='카페 알바');
  assert.equal(cafe.start,480);assert.equal(cafe.end,540);
  const atNine=monday.segments.find(segment=>541>=segment.start&&541<segment.end);
  assert.equal(label(atNine.activity),'수업');
});
