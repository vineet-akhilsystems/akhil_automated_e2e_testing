export const state = {
  data: null, cases: [], route: [], selected: new Set(), search: '', suite: '', caseMode: '', priority: '', area: '',
  moduleSearch: '', runStatus: '', runModule: '', runSearch: '', runModalSearch: '', runCaseFilter: '', runCaseSearch: '',
  runDetail: null, generation: 0, aiThinking: false, aiThinkingStep: 0, aiDrafts: [], aiSelected: new Set(), aiSummary: null,
  aiOptions: { prompt: '', count: 5, focus: 'all', targetField: '', variant: '', priority: 'auto', mode: '', presetId: 'out-of-box' },
  casePageSize: null
};
Object.assign(state, { user: null, intake: null, insights: null, uploads: [], analysis: null, users: null, reviewFilter: 'draft', reviewSel: new Set() });
export const currentModule = () => state.data.modules.find(m => m.id === state.route[1]);
export const adapterFor = m => state.data.adapters.find(a => a.id === m?.adapter);

// Shared mutable drafts (dialog form state) live on one object so every module sees the same values.
export const drafts = { runDraft: undefined, editorDraft: undefined, templateModule: undefined, memberDraft: undefined, personTimer: undefined, noticeSeq: 0 };
