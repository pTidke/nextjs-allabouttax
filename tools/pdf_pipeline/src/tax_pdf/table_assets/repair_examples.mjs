// Known, source-informed engineering examples. This is not an OCR repair policy.
import fs from 'node:fs';
import {audit,splitCell,mergeCells,points} from './repair_ops.mjs';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
function make(ctx,plan,x){return {schema_version:'0.1.0',state:'TABLE_RECONSTRUCTION_DRAFT',publication_eligible:false,owner_verified:false,binding:ctx.binding,reviewer_name:'Agent engineering proposal — not owner verified',scope_note:plan.scope_note,x,y:plan.y,cells:Array.from({length:plan.y.length-1},(_,row)=>Array.from({length:x.length-1},(_,column)=>({id:'r'+row+'c'+column,row,column,row_span:1,column_span:1,state:'unresolved',text:null,role:'value',headers:[],source_refs:[],note:''}))).flat()};}
function cell(d,id){const c=d.cells.find(c=>c.id===id);if(!c)throw Error('Unknown example cell '+id);return c;}
function ref(ctx,predicate,token){const index=ctx.raw_cells.findIndex(predicate);if(index<0)throw Error('Source-bound raw example changed.');const text=ctx.raw_cells[index].text;if(token===undefined)return {cell:index,start:0,end:points(text).length};const at=text.indexOf(token);if(at<0||text.indexOf(token,at+1)>=0)throw Error('Ambiguous source fragment.');return {cell:index,start:points(text.slice(0,at)).length,end:points(text.slice(0,at+token.length)).length};}
function full(ctx,text){return ref(ctx,c=>c.text===text);}
function set(d,id,text,refs=[],role='header',headers=[]){Object.assign(cell(d,id),{state:'transcribed',text,source_refs:refs,role,headers,note:'Agent source-comparison proposal; awaiting reviewer confirmation.'});}
function rawText(ctx,ref){return points(ctx.raw_cells[ref.cell].text).slice(ref.start,ref.end).join('');}
function copyRaw(d,id,ctx,predicate,role='header'){const r=ref(ctx,predicate);set(d,id,rawText(ctx,r),[r],role);}
function rectangle(d,r0,r1,c0,c1){return d.cells.filter(c=>r0<=c.row&&c.row+c.row_span<=r1&&c0<=c.column&&c.column+c.column_span<=c1).map(c=>c.id);}
const samples=[];
for(const ctx of input.contexts){const p=input.plan.examples.find(p=>p.case_id===ctx.case_id);let before,after;
 if(ctx.case_id==='3756112e45b5-p5'){
  before=make(ctx,p,p.x.filter((_,i)=>i!==2));
  before=mergeCells(before,rectangle(before,0,1,0,7));
  for(const col of [0,1,2,3])before=mergeCells(before,rectangle(before,1,3,col,col+1));
  before=mergeCells(before,rectangle(before,1,2,4,7));
  copyRaw(before,'r0c0',ctx,c=>c.text.startsWith('Part C:'),'context');
  for(const [id,test]of [['r1c0',c=>c.text==='Sl. No.'],['r1c1',c=>c.text==='Date of investment'],['r1c2',c=>c.text.startsWith('Nature of investment')],['r1c3',c=>c.text.startsWith('Nature Jo income')],['r1c4',c=>c.text.startsWith('Details of the entity')],['r2c4',c=>c.text.startsWith('Nature of entity')],['r2c5',c=>c.text==='Name'],['r2c6',c=>c.text==='PAN']])copyRaw(before,id,ctx,test);
  for(const [col,text]of ['A','B C','D','E','F','G','H'].entries())copyRaw(before,'r3c'+col,ctx,c=>c.text===text);
  after=splitCell(before,'r1c1','x',p.x[2],'amount-heading');
  for(const row of [3,4,5,6])after=splitCell(after,'r'+row+'c1','x',p.x[2],'split-'+row);
  after=mergeCells(after,['r6c0','r6c1']);
  const title=ref(ctx,c=>c.text.startsWith('Part C:'));
  const amount=ref(ctx,c=>c.text.startsWith('Part C:'),'Amount');
  set(after,'r0c0',rawText(ctx,{...title,end:amount.start}).trimEnd(),[{...title,end:amount.start-1}],'context');
  copyRaw(after,'r1c1',ctx,c=>c.text==='Date of investment');set(after,'amount-heading','Amount',[amount]);
  set(after,'r1c3','Nature of income (refer Note 5)',[ref(ctx,c=>c.text.startsWith('Nature Jo income'))]);
  const bc=ref(ctx,c=>c.text==='B C');set(after,'r3c1','B',[{...bc,end:bc.start+1}]);set(after,'split-3','C',[{...bc,start:bc.end-1}]);
  copyRaw(after,'r4c0',ctx,c=>c.text==='1.'&&c.start_row_offset_idx>=15,'value');copyRaw(after,'r5c0',ctx,c=>c.text==='2.'&&c.start_row_offset_idx>=15,'value');copyRaw(after,'r5c1',ctx,c=>c.text.startsWith('(Repeat'),'value');copyRaw(after,'r6c0',ctx,c=>c.text==='Total','value');
  for(const id of ['r2c4','r2c5','r2c6'])cell(after,id).headers=['r1c4'];
  cell(after,'r3c1').headers=['r1c1'];cell(after,'split-3').headers=['amount-heading'];
  for(const row of [4,5]){cell(after,'r'+row+'c1').headers=['r1c1','r3c1'];cell(after,'split-'+row).headers=['amount-heading','split-3'];}
 }else if(ctx.case_id==='e228528d7afc-p6'){
  before=make(ctx,p,p.x.filter((_,i)=>![2,4].includes(i)));
  for(const [col,letter]of ['A','B','C','D','E','F','G'].entries())copyRaw(before,'r0c'+col,ctx,c=>c.text.startsWith('['+letter+']'));
  copyRaw(before,'r1c1',ctx,c=>c.text==='Amount (Rs.)');copyRaw(before,'r1c2',ctx,c=>c.text==='Section (Rs.)');
  after=splitCell(before,'r1c1','x',p.x[2],'b-section');after=splitCell(after,'r1c2','x',p.x[4],'c-section');
  const combined=c=>c.text.startsWith('[C]');
  set(after,'r0c2','[C]',[ref(ctx,combined,'[C]')]);copyRaw(after,'r1c1',ctx,c=>c.text==='Amount (Rs.)');
  set(after,'b-section','Section',[ref(ctx,combined,'Section')]);set(after,'r1c2','Amount (Rs.)',[ref(ctx,combined,'Amount')]);set(after,'c-section','Section',[ref(ctx,c=>c.text==='Section (Rs.)','Section')]);
  for(const id of ['r1c1','b-section'])cell(after,id).headers=['r0c1'];for(const id of ['r1c2','c-section'])cell(after,id).headers=['r0c2'];
 }else throw Error('Unsupported source-informed example.');
 const sample={...ctx,id:ctx.case_id+'-reconstruction',title:p.title,draft:before,prepared:after};audit(before,sample);audit(after,sample);samples.push(sample);
}
process.stdout.write(JSON.stringify({publication_eligible:false,samples}));
