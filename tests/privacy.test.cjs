const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const context={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'dist/data-personal.js'),'utf8'),context);

test('public data never references private photographs',()=>{
  assert.equal(context.window.PERSONAL_DATA.records.length,207);
  assert.ok(context.window.PERSONAL_DATA.records.every(record=>record.photo===''));
  assert.equal(fs.existsSync(path.join(root,'dist/photos')),false);
});
test('deployment assets contain no photographs or embedded photo data',()=>{
  const visit=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?visit(path.join(directory,entry.name)):[path.join(directory,entry.name)]);
  const files=visit(path.join(root,'dist'));
  assert.deepEqual(files.filter(file=>/\.(?:jpe?g|png|webp|gif|avif|heic|tiff?|bmp)$/i.test(file)),[]);
  for(const file of files.filter(file=>/\.(?:html|css|js)$/i.test(file))){
    assert.doesNotMatch(fs.readFileSync(file,'utf8'),/data:image\/(?:jpeg|png|webp|gif);base64,/i);
  }
});
