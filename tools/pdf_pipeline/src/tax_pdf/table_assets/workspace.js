'use strict';
const $ = id => document.getElementById(id);
let samples = [], sample, draft, activeId = null;
const memory = new Map(), dirty = new Set();
const fields = ['reviewer','disposition','text','row-span','column-span','covered-by','header-path','unit','cell-note','header-rows','footnote','footnote-ids','table-note'];
const clone = value => JSON.parse(JSON.stringify(value));
const message = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
const key = () => 'aat-table-draft:' + sample.draft.binding.artifact_sha256 + ':' + sample.table.id;
const list = value => value.split(',').map(x => x.trim()).filter(Boolean);
function shape(object, keys) {
  if (!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).sort().join('|') !== keys.sort().join('|')) throw Error('Unexpected draft fields.');
}
function validateBasic(value) {
  shape(value, ['schema_version','state','publication_eligible','binding','reviewer_name','header_rows','cells','footnotes','table_note']);
  shape(value.binding, Object.keys(sample.draft.binding));
  if (Object.keys(sample.draft.binding).some(k => value.binding[k] !== sample.draft.binding[k])) throw Error('This review belongs to a different source, image or extraction revision.');
  if (value.schema_version !== '0.1.0' || value.state !== 'DRAFT_NOT_ACCEPTED' || value.publication_eligible !== false) throw Error('Only unaccepted reviews are supported.');
  if (typeof value.reviewer_name !== 'string' || value.reviewer_name.length > 200 || typeof value.table_note !== 'string' || value.table_note.length > 8000) throw Error('Invalid reviewer/table notes.');
  if (!Array.isArray(value.header_rows) || value.header_rows.some(r => !Number.isInteger(r))) throw Error('Header rows need whole numbers.');
  if (!Array.isArray(value.cells) || value.cells.length !== sample.table.cells.length || new Set(value.cells.map(c => c?.id)).size !== value.cells.length) throw Error('Every source cell must appear exactly once.');
  const ids = new Set(sample.table.cells.map(c => c.id));
  for (const c of value.cells) {
    shape(c, ['id','disposition','text','row_span','column_span','covered_by','header_path','unit','note']);
    if (!ids.has(c.id) || !['unreviewed','text','blank','covered','unreadable'].includes(c.disposition)) throw Error('Unknown cell or cell state.');
    if (c.text !== null && (typeof c.text !== 'string' || c.text.length > 20000)) throw Error('Invalid cell text.');
    if (c.covered_by !== null && typeof c.covered_by !== 'string') throw Error('Invalid merged-cell reference.');
    if (!Array.isArray(c.header_path) || c.header_path.length > 30 || c.header_path.some(h => typeof h !== 'string') || (c.unit !== null && (typeof c.unit !== 'string' || c.unit.length > 500)) || typeof c.note !== 'string' || c.note.length > 4000) throw Error('Invalid cell context.');
    for (const n of [c.row_span,c.column_span]) if (n !== null && (!Number.isInteger(n) || n < 1)) throw Error('Spans must be positive whole numbers.');
  }
  if (!Array.isArray(value.footnotes) || value.footnotes.length > 1) throw Error('This prototype edits one footnote per review; extra footnotes will not be discarded.');
  for (const f of value.footnotes) {
    shape(f, ['text','source_block_ids']);
    if (typeof f.text !== 'string' || f.text.length > 8000 || !Array.isArray(f.source_block_ids) || f.source_block_ids.length > 100 || f.source_block_ids.some(id => typeof id !== 'string')) throw Error('Invalid footnote input.');
  }
  return value;
}
function progressSnapshot(value) {
  validateBasic(value);
  return {schema_version:'0.1.0',state:'UNFINISHED_TABLE_REVIEW',publication_eligible:false,draft:clone(value)};
}
function unwrapReview(value) {
  if (value?.state !== 'UNFINISHED_TABLE_REVIEW') return validate(value);
  shape(value,['schema_version','state','publication_eligible','draft']);
  if (value.schema_version !== '0.1.0' || value.publication_eligible !== false) throw Error('Only unaccepted progress files are supported.');
  return validateBasic(value.draft);
}
function pendingIssue(value) {
  try { validate(value); return null; } catch (e) { return e.message; }
}
function recordProgress() {
  pull(); validateBasic(draft); const issue = pendingIssue(draft);
  const stored = issue ? progressSnapshot(draft) : draft;
  localStorage.setItem(key(), JSON.stringify(stored)); dirty.delete(sample.id);
  message(issue ? 'Unfinished review saved. Your selections are safe. Still needs attention: '+issue : 'Draft saved on this browser. It has not been accepted or published.');
}
function prepareDownload(value, name) {
  const text = JSON.stringify(value,null,2)+'\n';
  $('prepared-json').value = text; $('prepared').open = true;
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'})), a=document.createElement('a');
  a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function confirmCandidate(raw, cell) {
  if (typeof raw !== 'string') throw Error('This region is unresolved. Keep it for another check instead of confirming inferred text.');
  return {...cell, disposition:raw === '' ? 'blank' : 'text', text:raw, covered_by:null};
}
function validate(value) {
  validateBasic(value);
  shape(value, ['schema_version','state','publication_eligible','binding','reviewer_name','header_rows','cells','footnotes','table_note']);
  shape(value.binding, Object.keys(sample.draft.binding));
  if (Object.keys(sample.draft.binding).some(k => value.binding[k] !== sample.draft.binding[k])) throw Error('This draft belongs to a different source, image or extraction revision.');
  if (value.schema_version !== '0.1.0' || value.state !== 'DRAFT_NOT_ACCEPTED' || value.publication_eligible !== false) throw Error('Only unaccepted drafts are supported.');
  if (typeof value.reviewer_name !== 'string' || value.reviewer_name.length > 200 || typeof value.table_note !== 'string' || value.table_note.length > 8000) throw Error('Invalid reviewer/table notes.');
  if (!Array.isArray(value.header_rows) || new Set(value.header_rows).size !== value.header_rows.length || value.header_rows.some(r => !Number.isInteger(r) || r < 0 || r >= sample.table.rows)) throw Error('Header row is outside this table.');
  if (!Array.isArray(value.cells) || value.cells.length !== sample.table.cells.length || new Set(value.cells.map(c => c.id)).size !== value.cells.length) throw Error('Every source cell must appear exactly once.');
  const originals = new Map(sample.table.cells.map(c => [c.id, c])), occupied = new Map();
  for (const c of value.cells) {
    shape(c, ['id','disposition','text','row_span','column_span','covered_by','header_path','unit','note']);
    if (!originals.has(c.id) || !['unreviewed','text','blank','covered','unreadable'].includes(c.disposition)) throw Error('Unknown cell or cell state.');
    if (c.disposition === 'text' && (typeof c.text !== 'string' || !c.text.trim())) throw Error(c.id + ': enter visible text, or choose blank/unreadable.');
    if (c.text !== null && (typeof c.text !== 'string' || c.text.length > 20000)) throw Error('Invalid cell text.');
    if (c.disposition === 'blank' && c.text !== '') throw Error('A confirmed blank must be an empty string.');
    if (!['text','blank'].includes(c.disposition) && c.text !== null) throw Error('Unreviewed, unreadable and covered cells cannot contain inferred text.');
    if ((c.disposition === 'covered') !== (typeof c.covered_by === 'string' && c.covered_by.length > 0) || (c.disposition !== 'covered' && c.covered_by !== null)) throw Error(c.id + ': covered cells need an anchor cell ID.');
    if (!Array.isArray(c.header_path) || c.header_path.length > 30 || c.header_path.some(h => typeof h !== 'string') || (c.unit !== null && (typeof c.unit !== 'string' || c.unit.length > 500)) || typeof c.note !== 'string' || c.note.length > 4000) throw Error('Invalid cell context.');
    for (const n of [c.row_span,c.column_span]) if (n !== null && (!Number.isInteger(n) || n < 1)) throw Error('Spans must be positive whole numbers.');
    if (!['text','blank'].includes(c.disposition) && (c.row_span !== null || c.column_span !== null)) throw Error('Only text/blank anchor cells may span rows or columns.');
    if (!['text','blank'].includes(c.disposition)) continue;
    const o = originals.get(c.id), rs = c.row_span || 1, cs = c.column_span || 1;
    if (o.row + rs > sample.table.rows || o.column + cs > sample.table.columns) throw Error(c.id + ': span exceeds the source grid.');
    for (let r = o.row; r < o.row + rs; r++) for (let col = o.column; col < o.column + cs; col++) {
      const point = r + ':' + col;
      if (occupied.has(point)) throw Error('Proposed merged cells overlap.');
      occupied.set(point, c.id);
    }
  }
  for (const c of value.cells) {
    const o = originals.get(c.id), owner = occupied.get(o.row + ':' + o.column);
    if (c.disposition === 'covered' && (!owner || owner !== c.covered_by || owner === c.id)) throw Error(c.id + ': this cell is not covered by the specified anchor.');
    if (c.disposition !== 'covered' && owner && owner !== c.id) throw Error(c.id + ': mark this cell as covered by ' + owner + '.');
  }
  const blocks = new Set(sample.blocks.map(b => b.id));
  if (!Array.isArray(value.footnotes) || value.footnotes.length > 1) throw Error('This prototype edits at most one footnote per draft; no extra footnotes will be discarded.');
  for (const f of value.footnotes) {
    shape(f, ['text','source_block_ids']);
    if (typeof f.text !== 'string' || !f.text.trim() || f.text.length > 8000 || !Array.isArray(f.source_block_ids) || !f.source_block_ids.length || f.source_block_ids.length > 100 || new Set(f.source_block_ids).size !== f.source_block_ids.length || f.source_block_ids.some(id => !blocks.has(id))) throw Error('Footnotes need text and unique source block IDs from this page.');
  }
  return value;
}
function highlight(box, id) {
  const marker = $('highlight');
  if (!box) { marker.style.display = 'none'; $('selection').textContent = id + ': no candidate geometry; inspect the full source.'; return; }
  Object.assign(marker.style, {left: 100*box.x0/sample.width+'%', top: 100*box.top/sample.height+'%', width: 100*(box.x1-box.x0)/sample.width+'%', height: 100*(box.bottom-box.top)/sample.height+'%', display:'block'});
  $('selection').textContent = 'Selected original region: ' + id;
}
function rawLabel(value) { return value === null ? '[unresolved / possibly covered]' : value === '' ? '[blank candidate]' : value; }
function renderGrid() {
  const table = document.createElement('table');
  for (let r = 0; r < sample.table.rows; r++) {
    const tr = table.insertRow();
    for (const c of sample.table.cells.filter(c => c.row === r)) {
      const d = draft.cells.find(x => x.id === c.id), td = tr.insertCell(), button = document.createElement('button'), label = document.createElement('small');
      button.type = 'button'; button.dataset.cell = c.id; button.setAttribute('aria-pressed', String(c.id === activeId));
      button.classList.toggle('checked', d.disposition !== 'unreviewed'); button.classList.toggle('confirmed', (d.disposition === 'text' && Boolean(d.text?.trim())) || d.disposition === 'blank'); button.classList.toggle('unresolved', c.raw_text === null);
      button.append(document.createTextNode(rawLabel(c.raw_text))); label.textContent = c.id + ' · ' + (d.disposition === 'text' && !d.text?.trim() ? 'transcription pending' : d.disposition === 'covered' && !d.covered_by ? 'layout pending' : d.disposition); button.append(label); td.append(button);
    }
  }
  $('grid').replaceChildren(table);
}
function pull() {
  if (!draft) return;
  draft.reviewer_name = $('reviewer').value; draft.table_note = $('table-note').value;
  draft.header_rows = list($('header-rows').value).map(x => /^\d+$/.test(x) ? Number(x)-1 : NaN);
  const text = $('footnote').value, ids = list($('footnote-ids').value);
  draft.footnotes = text || ids.length ? [{text, source_block_ids:ids}] : [];
  const c = draft.cells.find(x => x.id === activeId);
  if (c) {
    c.disposition = $('disposition').value;
    c.text = c.disposition === 'text' ? $('text').value : c.disposition === 'blank' ? '' : null;
    c.row_span = $('row-span').value ? Number($('row-span').value) : null;
    c.column_span = $('column-span').value ? Number($('column-span').value) : null;
    c.covered_by = $('covered-by').value || null;
    c.header_path = $('header-path').value.split('|').map(x => x.trim()).filter(Boolean);
    c.unit = $('unit').value || null; c.note = $('cell-note').value;
  }
  memory.set(sample.id, draft);
}
function selectCell(id) {
  pull(); activeId = id;
  const c = draft.cells.find(x => x.id === id), raw = sample.table.cells.find(x => x.id === id);
  $('cell-editor').disabled = false; $('cell-label').textContent = id + ' · row ' + (raw.row+1) + ', column ' + (raw.column+1);
  $('raw').textContent = rawLabel(raw.raw_text); $('disposition').value = c.disposition;
  $('text').value = c.text ?? ''; $('row-span').value = c.row_span ?? ''; $('column-span').value = c.column_span ?? '';
  $('covered-by').value = c.covered_by ?? ''; $('header-path').value = c.header_path.join(' | '); $('unit').value = c.unit ?? ''; $('cell-note').value = c.note;
  updateEnabled(); highlight(raw.bbox, id); renderGrid();
}
function updateEnabled() {
  $('text').disabled = $('disposition').value !== 'text';
  $('covered-by').disabled = $('disposition').value !== 'covered';
}
function showDraft() {
  activeId = null; $('cell-editor').disabled = true; $('cell-label').textContent = 'Select a cell'; $('raw').textContent = '';
  $('reviewer').value = draft.reviewer_name; $('header-rows').value = draft.header_rows.map(r => r+1).join(', ');
  $('footnote').value = draft.footnotes[0]?.text ?? ''; $('footnote-ids').value = draft.footnotes[0]?.source_block_ids.join(', ') ?? ''; $('table-note').value = draft.table_note;
  renderGrid();
}
function chooseSample(index) {
  pull(); sample = samples[index]; draft = memory.get(sample.id) ?? clone(sample.draft);
  let saved = false, storageError = false;
  if (!memory.has(sample.id)) {
    try { const stored = localStorage.getItem(key()); if (stored) { draft = unwrapReview(JSON.parse(stored)); saved = true; } }
    catch { storageError = true; }
  }
  try { localStorage.setItem('aat-table-last-sample',sample.id); } catch {}
  memory.set(sample.id, draft); $('title').textContent = sample.title + ' · page ' + sample.page + ' · ' + sample.table.id;
  $('page-image').src = sample.render; $('page-image').alt = 'Original page ' + sample.page + ' of ' + sample.title; $('full-size').href = sample.render;
  $('provenance').textContent = JSON.stringify(sample.draft.binding, null, 2); $('highlight').style.display = 'none';
  $('selection').textContent = 'Choose a cell to highlight its original position.'; $('preview').replaceChildren(); $('prepared-json').value=''; $('prepared').open=false;
  const blocks = sample.blocks.map(b => { const button = document.createElement('button'); button.type = 'button'; button.textContent = b.id + ' · ' + b.raw_text; button.addEventListener('click', () => highlight(b.bbox,b.id)); return button; });
  $('blocks').replaceChildren(...blocks); showDraft();
  if (storageError) { message('A saved draft could not be loaded. The original candidate remains available.', true); return; }
  const issue=pendingIssue(draft);
  if (saved && issue) { message('Unfinished review loaded. Your selections are safe. Still needs attention: '+issue); return; }
  message((saved ? 'Saved browser draft loaded. ' : '') + sample.kind + ' sample · ' + draft.cells.filter(c => c.disposition !== 'unreviewed').length + ' / ' + draft.cells.length + ' review choices recorded · unaccepted draft.');
}
$('table-picker').addEventListener('change', event => chooseSample(Number(event.target.value)));
$('grid').addEventListener('click', event => { const b = event.target.closest('[data-cell]'); if (b) selectCell(b.dataset.cell); });
for (const id of fields) $(id).addEventListener('input', () => { pull(); updateEnabled(); renderGrid(); dirty.add(sample.id); message('Unsaved changes in this tab. Save or download the draft to keep them.'); });
$('disposition').addEventListener('change', () => {
  if (!['text','blank'].includes($('disposition').value)) { $('row-span').value = ''; $('column-span').value = ''; }
  if ($('disposition').value !== 'covered') $('covered-by').value = '';
  pull(); updateEnabled(); renderGrid();
});
$('save').addEventListener('click', () => { try { recordProgress(); } catch (e) { message(e.message,true); } });
$('export-progress').addEventListener('click', () => {
  try { pull(); prepareDownload(progressSnapshot(draft),'unfinished-review-'+draft.binding.source_sha256.slice(0,12)+'-'+sample.table.id+'.json'); message('Unfinished review prepared. Missing details remain pending; no approval occurred.'); }
  catch(e) { message(e.message,true); }
});
$('export').addEventListener('click', () => {
  try { pull(); validate(draft); prepareDownload(draft,'table-draft-'+draft.binding.source_sha256.slice(0,12)+'-'+sample.table.id+'.json'); message('Draft JSON prepared and download requested. Copy the JSON below if the browser blocks the download.'); }
  catch(e) { message('This draft is unfinished. Use Save progress or Download unfinished review. '+e.message,true); }
});
$('import').addEventListener('change', async event => {
  try { const file = event.target.files[0]; if (!file) return; if (file.size > 5*1024*1024) throw Error('Draft exceeds 5 MiB.'); const imported = unwrapReview(JSON.parse(await file.text())); draft = clone(imported); memory.set(sample.id,draft); dirty.add(sample.id); showDraft(); message('Review loaded for this exact revision. Save progress to retain it. '+(pendingIssue(draft) || 'No structural validation errors; still unaccepted.')); }
  catch (e) { message(e.message,true); } finally { event.target.value=''; }
});
window.addEventListener('beforeunload', event => { if (dirty.size) { event.preventDefault(); event.returnValue=''; } });
fetch('tables.json').then(r => { if (!r.ok) throw Error('Could not load table samples.'); return r.json(); }).then(data => {
  samples = data.tables;
  if (!samples.length) { message('No table candidates in this run.'); return; }
  samples.forEach((s,i) => { const option=document.createElement('option'); option.value=i; option.textContent=s.kind+' · '+s.title+' · p'+s.page+' · '+s.table.id; $('table-picker').append(option); });
  let last; try { last=localStorage.getItem('aat-table-last-sample'); } catch {}
  const index=samples.findIndex(s=>s.id===last); chooseSample(index < 0 ? 0 : index);
}).catch(e => message(e.message,true));

$('preview-button').addEventListener('click', () => {
  try {
    pull(); validate(draft); const table = document.createElement('table');
    for (let row = 0; row < sample.table.rows; row++) {
      const tr = table.insertRow();
      for (const raw of sample.table.cells.filter(c => c.row === row)) {
        const c = draft.cells.find(d => d.id === raw.id); if (c.disposition === 'covered') continue;
        const td = document.createElement(draft.header_rows.includes(row) ? 'th' : 'td');
        td.rowSpan = c.row_span || 1; td.colSpan = c.column_span || 1;
        td.textContent = c.disposition === 'text' ? c.text : c.disposition === 'blank' ? '[confirmed blank]' : '['+c.disposition+']';
        tr.append(td);
      }
    }
    $('preview').replaceChildren(table); message('Proposed structure preview updated. Unchecked cells stay labelled; no acceptance occurred.');
  } catch (e) { $('preview').textContent = 'Cannot preview this draft yet: '+e.message; message(e.message,true); }
});

function applyQuickChoice(kind) {
  if (!activeId) return;
  pull(); const index=draft.cells.findIndex(c=>c.id===activeId), old=draft.cells[index];
  try {
    if (kind === 'match') draft.cells[index]=confirmCandidate(sample.table.cells.find(c=>c.id===activeId).raw_text,old);
    else draft.cells[index]={...old,disposition:kind==='blank'?'blank':'unreadable',text:kind==='blank'?'':null,covered_by:null,row_span:null,column_span:null};
    dirty.add(sample.id); const id=activeId; activeId=null; selectCell(id);
    $('prepared-json').value=''; $('preview').replaceChildren();
    message(kind==='match'?'Candidate copied exactly into this draft. Save progress when ready.':'Choice recorded. Save progress when ready.');
  } catch(e) { message(e.message,true); }
}
$('matches-original').addEventListener('click',()=>applyQuickChoice('match'));
$('mark-blank').addEventListener('click',()=>applyQuickChoice('blank'));
$('mark-uncertain').addEventListener('click',()=>applyQuickChoice('uncertain'));
