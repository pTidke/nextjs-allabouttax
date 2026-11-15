import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';

function client({failFirst=false,storageThrows=false}={}) {
  const elements=new Map(), commands=[];
  const context=vm.createContext({
    document:{getElementById(id){if(!elements.has(id)) elements.set(id,{value:'',textContent:'',disabled:false,addEventListener(){},replaceChildren(){},classList:{toggle(){}}});return elements.get(id);},addEventListener(){}},
    window:{addEventListener(){}},crypto:webcrypto,TextEncoder,
    localStorage:{setItem(){if(storageThrows) throw Error('Browser storage full');}},
    fetch:async (url,options)=>{
      if(url==='tables.json'||url.endsWith('/capabilities')) return new Promise(()=>{});
      if(options?.method==='POST') {
        commands.push(JSON.parse(options.body));
        if(failFirst && commands.length===1) throw Error('Connection interrupted');
        return {ok:true,json:async()=>({revision_id:'r1',head_revision:'r1',strict_draft_valid:true})};
      }
      return {ok:true,json:async()=>({head_revision:'r1',revisions:[],total_revisions:1})};
    },
  });
  vm.runInContext(readFileSync(new URL('../src/tax_pdf/table_assets/workspace.js',import.meta.url),'utf8'),context);
  vm.runInContext(readFileSync(new URL('../src/tax_pdf/table_assets/history.js',import.meta.url),'utf8'),context);
  vm.runInContext(`sample={id:'test',draft:{binding:{source_sha256:'source'}},table:{rows:1,columns:1,cells:[{id:'c1',row:0,column:0,raw_text:'0'}]},blocks:[]};draft={schema_version:'0.1.0',state:'DRAFT_NOT_ACCEPTED',publication_eligible:false,binding:sample.draft.binding,reviewer_name:'',header_rows:[],cells:[{id:'c1',disposition:'text',text:'0',row_span:null,column_span:null,covered_by:null,header_path:[],unit:null,note:''}],footnotes:[],table_note:''};historyReady=true;reviewBases.set('test',null);dirty.add('test');`,context);
  return {context,commands,elements};
}

test('an interrupted save retries the same command without creating a new request identity',async()=>{
  const c=client({failFirst:true});
  await vm.runInContext('saveHistory()',c.context);
  assert.match(c.elements.get('status').textContent,/Connection interrupted/);
  await vm.runInContext('saveHistory()',c.context);
  assert.equal(c.commands.length,2);
  assert.deepEqual(c.commands[0],c.commands[1]);
  assert.equal(vm.runInContext("reviewBases.get('test')",c.context),'r1');
});

test('browser storage failure cannot hide a successful disk save',async()=>{
  const c=client({storageThrows:true});
  await vm.runInContext('saveHistory()',c.context);
  assert.match(c.elements.get('status').textContent,/Saved to disk history/);
  assert.match(c.elements.get('status').textContent,/Browser copy could not/);
  assert.equal(vm.runInContext("dirty.has('test')",c.context),false);
});
