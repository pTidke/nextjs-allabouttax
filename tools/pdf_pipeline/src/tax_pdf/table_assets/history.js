'use strict';
let historyReady=false;
const reviewBases=new Map(), observedHeads=new Map(), pendingSaves=new Map();
async function reviewKey(binding) {
  const ordered=Object.fromEntries(Object.keys(binding).sort().map(k=>[k,binding[k]]));
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(ordered)));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
function currentPayload() {
  pull(); validateBasic(draft);
  return pendingIssue(draft) ? progressSnapshot(draft) : clone(draft);
}
async function api(path,options) {
  const response=await fetch(path,options);
  const result=await response.json();
  if(!response.ok) throw Error(result.message || result.error || 'Review history request failed.');
  return result;
}
async function refreshHistory() {
  if(!historyReady || !sample) return;
  const id=sample.id, binding=clone(sample.draft.binding), key=await reviewKey(binding);
  try {
    const history=await api('/api/reviews?key='+key);
    if(sample.id!==id) return;
    observedHeads.set(id,history.head_revision);
    if(!history.head_revision && !reviewBases.has(id)) reviewBases.set(id,null);
    $('history-status').textContent=history.total_revisions+' saved revisions · local disk history · all unaccepted';
    $('history-load').disabled=!history.head_revision;
    const items=history.revisions.map(r=>{
      const li=document.createElement('li');
      li.textContent=new Date(r.created_at).toLocaleString()+' · '+r.state.replaceAll('_',' ')+' · '+r.id.slice(0,10)+(r.reviewer_label?' · reviewer label: '+r.reviewer_label:'');
      return li;
    });
    $('history-list').replaceChildren(...items);
  } catch(e) { if(sample.id===id) $('history-status').textContent='History unavailable: '+e.message; }
}
async function saveHistory() {
  if(!historyReady || !sample) return;
  const id=sample.id;
  $('history-save').disabled=true;
  try {
    const payload=currentPayload();
    if(!reviewBases.has(id)) throw Error('Saved history already exists. Download your current progress, then load the latest saved review before saving a new revision.');
    const parent=reviewBases.get(id), signature=JSON.stringify({payload,parent});
    let command=pendingSaves.get(id);
    if(!command || command.signature!==signature) {
      command={signature,body:{payload,parent_id:parent,request_id:crypto.randomUUID()}};
      pendingSaves.set(id,command);
    }
    const saved=await api('/api/reviews',{method:'POST',headers:{'Content-Type':'application/json','X-Lab-Review':'1'},body:JSON.stringify(command.body)});
    pendingSaves.delete(id);
    if(saved.head_revision!==saved.revision_id) {
      reviewBases.delete(id);
      throw Error('Your earlier save is recorded, but a newer revision now exists. Load the latest review before continuing.');
    }
    reviewBases.set(id,saved.revision_id);
    if(sample.id===id) {
      const unchanged=JSON.stringify(currentPayload())===JSON.stringify(payload);
      let browserCopyWarning='';
      if(unchanged) { try { localStorage.setItem(key(),JSON.stringify(payload)); } catch { browserCopyWarning=' Browser copy could not be updated; the disk revision is saved.'; } dirty.delete(id); }
      message('Saved to disk history · revision '+saved.revision_id.slice(0,10)+'. '+(unchanged?'':'Newer edits in this tab are still unsaved. ')+(saved.strict_draft_valid?'Draft remains unaccepted.':'Unfinished details remain pending; no acceptance occurred.')+browserCopyWarning);
      await refreshHistory();
    }
  } catch(e) { if(sample.id===id) message(e.message,true); }
  finally { $('history-save').disabled=!historyReady; }
}
async function loadLatestHistory() {
  if(!historyReady || !sample) return;
  const id=sample.id, binding=clone(sample.draft.binding);
  try {
    // Keep a browser recovery copy of current work before replacing the form.
    const recovery=currentPayload(); localStorage.setItem(key()+':before-history-load',JSON.stringify(recovery));
    const keyHash=await reviewKey(binding), history=await api('/api/reviews?key='+keyHash);
    if(!history.head_revision) throw Error('There is no saved review for this table yet.');
    const result=await api('/api/reviews?key='+keyHash+'&revision='+history.head_revision);
    if(sample.id!==id) return;
    if(result.head_revision!==result.revision.id) throw Error('The review changed while loading. Load the latest review again.');
    draft=clone(unwrapReview(result.revision.payload)); memory.set(id,draft);
    reviewBases.set(id,result.revision.id); observedHeads.set(id,result.revision.id); dirty.delete(id);
    showDraft(); message('Loaded disk revision '+result.revision.id.slice(0,10)+'. '+(pendingIssue(draft)||'Draft is still unaccepted.'));
    await refreshHistory();
  } catch(e) { if(sample.id===id) message(e.message,true); }
}
$('history-save').addEventListener('click',saveHistory);
$('history-load').addEventListener('click',loadLatestHistory);
$('history-refresh').addEventListener('click',refreshHistory);
$('history-recover').addEventListener('click',()=>{
  try {
    const value=localStorage.getItem(key()+':before-history-load');
    if(!value) throw Error('No recovery copy exists for this table.');
    draft=clone(unwrapReview(JSON.parse(value))); memory.set(sample.id,draft); reviewBases.delete(sample.id); dirty.add(sample.id);
    showDraft(); message('Previous browser work restored. Download it before loading or merging saved history.');
  } catch(e) { message(e.message,true); }
});
document.addEventListener('lab-table-selected',refreshHistory);
fetch('/api/reviews/capabilities').then(r=>r.ok?r.json():null).then(value=>{
  historyReady=value?.api_version===1 && value?.publication_eligible===false;
  $('history-save').disabled=!historyReady; $('history-refresh').disabled=!historyReady;
  $('history-status').textContent=historyReady?'Disk history connected.':'Disk history is unavailable on this static server. Browser copies and JSON still work.';
  if(historyReady) refreshHistory();
}).catch(()=>{ $('history-status').textContent='Disk history unavailable. Browser copies and JSON still work.'; });
