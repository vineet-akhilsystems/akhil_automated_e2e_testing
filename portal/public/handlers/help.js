// Help and guide: contents buttons scroll to a section; the search box hides sections that do not match.
document.addEventListener('click', event => {
  const button = event.target.closest?.('[data-docs-go]');
  if (!button) return;
  event.preventDefault();
  const target = document.getElementById('doc-' + button.dataset.docsGo);
  if (!target) return;
  const search = document.getElementById('docs-search');
  if (search?.value) { search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); }
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('.docs-toc button').forEach(b => b.classList.toggle('active', b.dataset.docsGo === button.dataset.docsGo));
});
document.addEventListener('input', event => {
  if (event.target?.id !== 'docs-search') return;
  const query = event.target.value.trim().toLowerCase();
  let shown = 0;
  for (const section of document.querySelectorAll('.doc-section')) {
    const hit = !query || section.textContent.toLowerCase().includes(query);
    section.classList.toggle('hidden', !hit);
    document.querySelector(`.docs-toc button[data-docs-go="${section.id.replace('doc-', '')}"]`)?.classList.toggle('hidden', !hit);
    if (hit) shown++;
  }
  document.getElementById('docs-empty')?.classList.toggle('hidden', shown > 0);
});
