import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {audit,splitCell,mergeCells,points} from '../src/tax_pdf/table_assets/repair_ops.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/table-repair-cases.json',import.meta.url),'utf8'));
const examples=JSON.parse(execFileSync(process.execPath,[new URL('../src/tax_pdf/table_assets/repair_examples.mjs',import.meta.url).pathname],{input:JSON.stringify(fixture),encoding:'utf8'})).samples;
test('prepared cases restore scoped columns without selecting or accepting an OCR engine',()=>{
 const [a,b]=examples;assert.equal(a.draft.x.length-1,7);assert.equal(a.prepared.x.length-1,8);
 assert.equal(b.prepared.x.length-1,9);
 for(const sample of examples){const before=JSON.stringify(sample.raw_cells);for(const d of[sample.draft,sample.prepared]){const report=audit(d,sample);assert.equal(report.mapped_characters+report.unplaced_characters,report.raw_characters);assert.ok(report.unplaced_characters>0);assert.ok(report.unresolved_cells>0);assert.equal(d.publication_eligible,false);assert.equal(d.owner_verified,false);assert.ok(d.cells.every(c=>c.state!=='blank'));}assert.equal(JSON.stringify(sample.raw_cells),before);}
 const amount=a.prepared.cells.find(c=>c.id==='amount-heading');assert.equal(amount.text,'Amount');assert.equal(amount.column_span,1);assert.equal(amount.row_span,2);
 const title=a.prepared.cells.find(c=>c.id==='r0c0');assert.ok(!title.text.endsWith('Amount'));
 const letters=a.prepared.cells.filter(c=>c.row===3).sort((a,b)=>a.column-b.column).map(c=>c.text);assert.deepEqual(letters,['A','B','C','D','E','F','G','H']);
 const rowTwo=a.prepared.cells.find(c=>c.id==='r5c0');assert.ok(a.raw_cells[rowTwo.source_refs[0].cell].start_row_offset_idx>=15);
 const leaves=b.prepared.cells.filter(c=>c.row===1&&c.text).sort((a,b)=>a.column-b.column);assert.deepEqual(leaves.map(c=>c.text),['Amount (Rs.)','Section','Amount (Rs.)','Section']);assert.deepEqual(leaves.map(c=>c.headers[0]),['r0c1','r0c1','r0c2','r0c2']);
});
test('splitting adds a boundary, clears affected text and leaves all raw evidence available',()=>{
 const s=examples[0],before=structuredClone(s.draft),c=before.cells.find(c=>c.id==='r1c1');const old=JSON.stringify(before);
 const after=splitCell(before,c.id,'x',fixture.plan.examples[0].x[2],'new-amount');
 assert.equal(JSON.stringify(before),old);assert.equal(after.x.length,before.x.length+1);
 for(const id of[c.id,'new-amount']){const cell=after.cells.find(c=>c.id===id);assert.equal(cell.state,'unresolved');assert.equal(cell.text,null);assert.deepEqual(cell.source_refs,[]);}
 assert.ok(audit(after,s).unplaced_characters>=audit(before,s).unplaced_characters);
});
test('splitting on an existing boundary preserves the remaining geometry',()=>{
 const s=examples[0];let d=splitCell(s.draft,'r1c1','x',188.94,'a');const n=d.x.length;
 d=splitCell(d,'r3c1','x',188.94,'b');assert.equal(d.x.length,n);audit(d,s);
 assert.throws(()=>splitCell(d,'b','x',188.94,'bad'),/inside/);
});
test('rectangular merge preserves OCR links but requires transcription and header review again',()=>{
 const s=examples[1],d=s.prepared;const ids=['r1c1','b-section'];const count=ids.flatMap(id=>d.cells.find(c=>c.id===id).source_refs).length;
 const merged=mergeCells(d,ids),anchor=merged.cells.find(c=>c.id==='r1c1');assert.equal(anchor.column_span,2);assert.equal(anchor.state,'unresolved');assert.equal(anchor.text,null);assert.equal(anchor.source_refs.length,count);audit(merged,s);
 assert.throws(()=>mergeCells(d,['r1c1','c-section']),/rectangle/);
});
test('mismatched revisions and publication claims cannot pass browser validation',()=>{
 const s=examples[0];for(const update of[{publication_eligible:true},{owner_verified:true},{binding:{...s.draft.binding,raw_sha256:'a'.repeat(64)}}])assert.throws(()=>audit({...s.draft,...update},s));
});
test('Unicode raw fragments use code point offsets and duplicate characters are held',()=>{
 const s=structuredClone(examples[0]);s.raw_cells=[{text:'A😀B C'}];const d=structuredClone(s.draft);for(const c of d.cells){c.state='unresolved';c.text=null;c.source_refs=[];c.headers=[];}
 const a=d.cells[0],b=d.cells[1];a.state='transcribed';a.text='A😀';a.source_refs=[{cell:0,start:0,end:2}];assert.equal(points('A😀B C').length,5);assert.equal(audit(d,s).mapped_characters,2);
 b.source_refs=[{cell:0,start:1,end:3}];assert.throws(()=>audit(d,s),/already attached/);
 b.source_refs=[{cell:0,start:3,end:6}];assert.throws(()=>audit(d,s),/Invalid raw/);
});
test('a changed transcription needs an explicit source-review note',()=>{
 const s=examples[0],d=structuredClone(s.prepared);const c=d.cells.find(c=>c.id==='amount-heading');c.text='Different source transcription';c.note='';assert.throws(()=>audit(d,s),/needs a note/);c.note='Unaccepted synthetic correction note';audit(d,s);
});
