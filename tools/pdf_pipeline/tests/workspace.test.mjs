import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function workspace() {
  const elements = new Map();
  const context = vm.createContext({
    document: {getElementById(id) {if (!elements.has(id)) elements.set(id,{addEventListener(){}});return elements.get(id);}},
    window: {addEventListener(){}}, fetch: () => new Promise(()=>{}),
  });
  vm.runInContext(readFileSync(new URL('../src/tax_pdf/table_assets/workspace.js',import.meta.url),'utf8'),context);
  vm.runInContext(`sample={draft:{binding:{source_sha256:'original',artifact_sha256:'revision'}},table:{rows:1,columns:1,cells:[{id:'c1',row:0,column:0,raw_text:'0'}]},blocks:[]};`,context);
  return context;
}
const cell = {id:'c1',disposition:'text',text:'',row_span:null,column_span:null,covered_by:null,header_path:[],unit:null,note:''};
const draft = {schema_version:'0.1.0',state:'DRAFT_NOT_ACCEPTED',publication_eligible:false,binding:{source_sha256:'original',artifact_sha256:'revision'},reviewer_name:'',header_rows:[],cells:[cell],footnotes:[],table_note:''};

test('unfinished user choices can round-trip without passing strict validation',()=>{
  const c=workspace();c.value=structuredClone(draft);
  assert.throws(()=>vm.runInContext('validate(value)',c),/enter visible text/);
  const progress=JSON.parse(JSON.stringify(vm.runInContext('progressSnapshot(value)',c)));
  assert.equal(progress.state,'UNFINISHED_TABLE_REVIEW');
  assert.equal(progress.draft.cells[0].text,'');
  c.progress=progress;
  assert.equal(vm.runInContext('unwrapReview(progress).cells[0].text',c),'');
  assert.throws(()=>vm.runInContext('validate(unwrapReview(progress))',c),/enter visible text/);
});

test('progress imports still reject changed bindings and cell identities',()=>{
  const c=workspace();c.value=structuredClone(draft);c.value.binding.source_sha256='other';
  assert.throws(()=>vm.runInContext('progressSnapshot(value)',c),/different source/);
  c.value=structuredClone(draft);c.value.cells[0].id='unknown';
  assert.throws(()=>vm.runInContext('progressSnapshot(value)',c),/Unknown cell/);
  c.value=structuredClone(draft);c.value.publication_eligible=true;
  assert.throws(()=>vm.runInContext('progressSnapshot(value)',c),/Only unaccepted/);
});

test('confirmation copies exact candidate values and never fills unresolved cells',()=>{
  const c=workspace();c.cell=structuredClone(cell);
  for(const text of ['0','-','1.5','Country ofresidence:','']) {
    c.raw=text;
    const result=vm.runInContext('confirmCandidate(raw,cell)',c);
    assert.equal(result.text,text);
    assert.equal(result.disposition,text===''?'blank':'text');
  }
  c.raw=null;
  assert.throws(()=>vm.runInContext('confirmCandidate(raw,cell)',c),/unresolved/);
  assert.equal(c.cell.text,''); // Pure confirmation helper doesn't mutate the input.
});
