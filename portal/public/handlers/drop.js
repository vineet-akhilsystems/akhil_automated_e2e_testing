import { $$ } from '../components/dom.js';
import { addFiles } from '../pages/intake.js';
import { state } from '../state.js';

// Drag and drop for the intake drop zone. Files dropped elsewhere do nothing, so the browser never navigates away.
const hasFiles = e => [...(e.dataTransfer?.types ?? [])].includes('Files');
window.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); $$('[data-dropzone]').forEach(z => z.classList.toggle('drag', Boolean(e.target.closest?.('[data-dropzone]')))); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) $$('[data-dropzone]').forEach(z => z.classList.remove('drag')); });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return; e.preventDefault();
  $$('[data-dropzone]').forEach(z => z.classList.remove('drag'));
  if (e.target.closest?.('[data-dropzone]')) addFiles([...e.dataTransfer.files].filter(f => f.name));
});
window.addEventListener('beforeunload', e => { if (state.uploading) { e.preventDefault(); e.returnValue = ''; } });
