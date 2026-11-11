// Pure reconstruction operations. No OCR, inferred text or acceptance occurs here.
const copy = value => structuredClone(value);
export const points = text => Array.from(text);
export function audit(draft, sample) {
  const binding=v=>JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))));
  if(draft.state!=='TABLE_RECONSTRUCTION_DRAFT' || draft.publication_eligible!==false || draft.owner_verified!==false || binding(draft.binding)!==binding(sample.draft.binding)) throw Error('Wrong source revision or approval state.');
  for(const [axis,limit] of [[draft.x,sample.width],[draft.y,sample.height]]) {
    if(!Array.isArray(axis)||axis.length<2||axis.length>101||axis.some((p,i)=>!Number.isFinite(p)||p<0||p>limit||(i&&p-axis[i-1]<.1))) throw Error('Grid boundaries must be ordered within the source page.');
  }
  if(!draft.cells.length||draft.cells.length>10000||(draft.x.length-1)*(draft.y.length-1)>10000) throw Error('Grid budget exceeded.');
  const ids=new Map(draft.cells.map(c=>[c.id,c])), occupied=new Set(), assigned=new Map();
  if(ids.size!==draft.cells.length) throw Error('Duplicate cell identity.');
  for(const c of draft.cells) {
    if(![c.row,c.column,c.row_span,c.column_span].every(Number.isInteger)||c.row<0||c.column<0||c.row_span<1||c.column_span<1||c.row+c.row_span>=draft.y.length||c.column+c.column_span>=draft.x.length) throw Error('Cell outside grid.');
    for(let r=c.row;r<c.row+c.row_span;r++)for(let col=c.column;col<c.column+c.column_span;col++){const key=r+':'+col;if(occupied.has(key))throw Error('Cells overlap.');occupied.add(key);}
    if(!['unresolved','transcribed','blank','unreadable'].includes(c.state)||!['header','value','context'].includes(c.role)) throw Error('Invalid cell state.');
    if(c.state==='transcribed'&&(typeof c.text!=='string'||!c.text.trim()))throw Error('Enter a transcription or leave the cell unresolved.');
    if(c.state==='blank'&&(c.text!==''||!c.note.trim()))throw Error('Confirmed blank requires a source-review note.');
    if(['unresolved','unreadable'].includes(c.state)&&c.text!==null)throw Error('Unresolved cells cannot invent text.');
    let literal='';
    for(const ref of c.source_refs){const raw=sample.raw_cells[ref.cell];if(!raw||![ref.cell,ref.start,ref.end].every(Number.isInteger)||ref.start<0||ref.end<=ref.start||ref.end>points(raw.text).length)throw Error('Invalid raw OCR fragment.');const old=assigned.get(ref.cell)||[];if(old.some(([a,b])=>ref.start<b&&a<ref.end))throw Error('OCR characters are already attached to another cell.');old.push([ref.start,ref.end]);assigned.set(ref.cell,old);literal+=points(raw.text).slice(ref.start,ref.end).join('');}
    if(c.state==='transcribed'&&c.text!==literal&&!c.note.trim())throw Error('A source transcription or correction needs a note.');
    if(new Set(c.headers).size!==c.headers.length)throw Error('Duplicate header link.');
    for(const id of c.headers){const h=ids.get(id);if(!h||h.role!=='header'||h.row+h.row_span>c.row||h.column>c.column||h.column+h.column_span<c.column+c.column_span)throw Error('A header must be above and cover this cell’s columns.');}
  }
  if(occupied.size!==(draft.x.length-1)*(draft.y.length-1))throw Error('Grid contains unrepresented positions.');
  const unplaced=[];let total=0,unused=0;
  sample.raw_cells.forEach((c,index)=>{const text=points(c.text);total+=text.length;let cursor=0;for(const [a,b]of(assigned.get(index)||[]).sort((a,b)=>a[0]-b[0])){if(cursor<a)unplaced.push({cell:index,start:cursor,end:a});cursor=b;}if(cursor<text.length)unplaced.push({cell:index,start:cursor,end:text.length});});
  unused=unplaced.reduce((n,r)=>n+r.end-r.start,0);
  return {raw_characters:total,mapped_characters:total-unused,unplaced_characters:unused,unplaced,unresolved_cells:draft.cells.filter(c=>c.state==='unresolved').length,publication_eligible:false};
}
export function splitCell(value, id, axis, point, newId) {
  const d=copy(value), c=d.cells.find(c=>c.id===id);if(!c||d.cells.some(c=>c.id===newId)||!['x','y'].includes(axis))throw Error('Choose a cell and a new identity.');
  const pos=axis==='x'?'column':'row',span=axis==='x'?'column_span':'row_span',bounds=d[axis],lo=bounds[c[pos]],hi=bounds[c[pos]+c[span]];
  if(!Number.isFinite(point)||point-lo<.1||hi-point<.1)throw Error('Split must be inside the selected cell.');
  let at=bounds.findIndex(x=>Math.abs(x-point)<.01);
  if(at<0){at=bounds.findIndex(x=>x>point);const interval=at-1;bounds.splice(at,0,point);for(const cell of d.cells){if(cell[pos]>interval)cell[pos]++;else if(cell[pos]+cell[span]>interval)cell[span]++;}}
  const end=c[pos]+c[span], first=at-c[pos];
  const right={...copy(c),id:newId,[pos]:at,[span]:end-at,state:'unresolved',text:null,source_refs:[],headers:[],note:'Split proposal; compare the source and reattach OCR fragments.'};
  c[span]=first;c.state='unresolved';c.text=null;c.source_refs=[];c.note='Split proposal; prior text remains in undo/saved history and the raw OCR.';
  for(const cell of d.cells)cell.headers=cell.headers.filter(h=>h!==id);
  d.cells.push(right);return d;
}
export function mergeCells(value, ids) {
  const d=copy(value), chosen=d.cells.filter(c=>ids.includes(c.id));if(chosen.length<2||chosen.length!==new Set(ids).size)throw Error('Select at least two distinct cells.');
  const r0=Math.min(...chosen.map(c=>c.row)),c0=Math.min(...chosen.map(c=>c.column)),r1=Math.max(...chosen.map(c=>c.row+c.row_span)),c1=Math.max(...chosen.map(c=>c.column+c.column_span));
  if(chosen.reduce((n,c)=>n+c.row_span*c.column_span,0)!==(r1-r0)*(c1-c0))throw Error('Selected cells must form a complete rectangle.');
  const anchor=chosen.find(c=>c.row===r0&&c.column===c0);if(!anchor)throw Error('Missing top-left anchor.');
  const refs=chosen.flatMap(c=>c.source_refs), removed=new Set(chosen.map(c=>c.id));
  Object.assign(anchor,{row_span:r1-r0,column_span:c1-c0,state:'unresolved',text:null,source_refs:refs,headers:[],note:'Merged proposal; recheck transcription and header associations.'});
  d.cells=d.cells.filter(c=>!removed.has(c.id)||c.id===anchor.id);for(const c of d.cells)c.headers=c.headers.filter(id=>!removed.has(id));return d;
}
