import { esc, icon } from '../components/dom.js';
import { heading } from '../components/widgets.js';

// Help and guide: plain-language documentation inside the app. Static content, no data loading.
// Keep wording simple: the readers are business analysts and testers, not developers.

const tip = html => `<div class="doc-callout tip"><strong>Tip</strong><div>${html}</div></div>`;
const note = html => `<div class="doc-callout note"><strong>Good to know</strong><div>${html}</div></div>`;
const warn = html => `<div class="doc-callout warn"><strong>Careful</strong><div>${html}</div></div>`;
const steps = list => `<ol class="doc-steps">${list.map(s => `<li><div>${s}</div></li>`).join('')}</ol>`;
const cards = list => `<div class="doc-cards">${list.map(([n, t, d]) => `<div class="doc-card"><span class="doc-num">${n}</span><strong>${t}</strong><p>${d}</p></div>`).join('')}</div>`;
const table = (head, rows) => `<div class="table-scroll"><table class="doc-table"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<${i ? 'td' : 'th scope="row"'}>${c}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const words = list => `<dl class="doc-words">${list.map(([w, d]) => `<div><dt>${w}</dt><dd>${d}</dd></div>`).join('')}</dl>`;

export const SECTIONS = [
  { id: 'start', title: 'Start here', lead: 'What Test Studio is for, and the path every module follows.', body: () => `
    <p>Test Studio is the place where your team keeps <strong>test cases</strong> for every module of your application, <strong>runs</strong> them, and keeps the <strong>results and evidence</strong> in one place. It can also read your documents, screenshots and walkthrough videos and <strong>draft test cases for you</strong>, which a person then reviews.</p>
    <p>You do not need to know any code to use it. Most people only ever do four things: <strong>upload what they know</strong>, <strong>review the cases</strong>, <strong>run them</strong>, and <strong>read the report</strong>.</p>
    <h3>The path of a module</h3>
    ${cards([['1', 'Add the module', 'Create a module for one area of the application, such as Registration or Billing.'], ['2', 'Upload what you know', 'Documents, spreadsheets, PDFs, screenshots and walkthrough videos.'], ['3', 'Let the AI read it', 'It drafts test cases and lists what is unclear. Nothing is final yet.'], ['4', 'Review the cases', 'A person approves or rejects every draft. Only approved cases can run.'], ['5', 'Run the tests', 'Run by hand and record results, or let the browser robot run them.'], ['6', 'Read the report', 'Download a PDF, Excel or JSON report with the evidence.']])}
    ${note('Steps 1, 2, 4, 5 and 6 are for everyone. Making a module <em>automated</em> (the browser robot) needs a developer for a few steps. See <button class="link-button" data-docs-go="automation">Automate a module</button>.')}` },

  { id: 'quickstart', title: 'Your first 10 minutes', lead: 'A walk-through you can follow today.', body: () => `
    ${steps([
      '<strong>Sign in</strong> with the username and password an administrator gave you.',
      '<strong>Choose a product</strong> on the first screen (for example Augastam or Miracle). Everything you see afterwards belongs to that product. Use <strong>Switch product</strong> at the top to change.',
      'Open <strong>Module library</strong> in the left menu. Each card is a module. Open one.',
      'On the module page, look at the <strong>tabs</strong>: <em>Test cases</em> (the list), <em>Intake</em> (upload), <em>Review queue</em> (drafts waiting for a decision), <em>Generate with AI</em>, <em>Coverage &amp; gaps</em>, <em>Run history</em>, <em>Members</em> and <em>Module settings</em>.',
      'Open <strong>Intake</strong>, drop in a document or two, then press <strong>Analyse files</strong>. When it finishes, draft cases appear in the <strong>Review queue</strong>.',
      'In the <strong>Review queue</strong>, open a case, read it, then <strong>Approve</strong> or <strong>Reject</strong>.',
      'Open <strong>Test runs</strong> and press <strong>New test run</strong>. Pick the module and the approved cases, then run them by hand and record Pass, Fail or Blocked for each.',
      'Close the run, then press <strong>Download bug report (PDF)</strong> for the report.'
    ])}
    ${tip('Not sure where you are? The small line at the top shows the product and the page. The <strong>Readiness</strong> box on a module page tells you the next step for that module.')}` },

  { id: 'words', title: 'Words you will see', lead: 'The few terms used everywhere in the app.', body: () => words([
    ['Product', 'A whole application you test, such as Augastam or Miracle. Each product has its own modules, login profiles and people.'],
    ['Module', 'One area of a product, such as Registration or Billing. Test cases belong to a module.'],
    ['Test case', 'One check: what to do, and what should happen. Cases have an ID such as REG-014, a priority and steps.'],
    ['Suite', 'A group of related cases inside a module, shown in the list on the left of the Test cases tab.'],
    ['Draft, Approved, Rejected', 'The review status of a case. Cases made by the AI or imported start as <em>Draft</em>. Only <em>Approved</em> cases can be run.'],
    ['Manual / Automated', 'A manual case is carried out by a person who records the result. An automated case is carried out by a browser robot.'],
    ['Run', 'One round of testing: a chosen set of cases, a place to test, and the results. A run keeps a copy of its cases so history never changes.'],
    ['Evidence', 'Screenshots and notes that prove a result. Attach them while recording results.'],
    ['Intake', 'The uploads for a module: documents, spreadsheets, PDFs, screenshots, videos and transcripts.'],
    ['Insights', 'What the AI understood from your uploads: fields, rules, flows, edge cases, open questions. It improves each time you analyse again.'],
    ['Login profile', 'A saved test website address with the login to use (username, password and choices such as facility). Needed for automated runs.'],
    ['Session', 'The saved sign-in of a login profile. It can expire, so you sometimes press <em>Refresh application login</em>.'],
    ['Shared data template', 'Valid starting data defined once, so automated cases only change the few fields they are testing.'],
    ['Readiness', 'The checklist on a module page that shows how far the module is from automated testing.']
  ]) },

  { id: 'modules', title: 'Modules and test cases', lead: 'Create modules, write cases, organise and share them.', body: () => `
    <h3>Add a module</h3>
    ${steps(['Open <strong>Module library</strong> and press <strong>Add module</strong>.', 'Give it a <strong>name</strong>, a <strong>business area</strong> (this is how modules are grouped) and a short <strong>case prefix</strong> such as <em>BIL</em>. Cases will be numbered BIL-001, BIL-002 and so on.', 'Leave <strong>Automation adapter</strong> on <em>None (Manual testing)</em> unless a developer has told you which adapter to connect.', 'Press <strong>Create module</strong>.'])}
    ${note('A case prefix can only be used once inside a product, so two modules never create the same case ID.')}
    <h3>Add and change cases</h3>
    <ul>
      <li><strong>Add test case</strong> on the Test cases tab. Give it a title, a suite, a priority (P0 is the most important), the steps and what should happen at each step.</li>
      <li>Open any case to <strong>edit</strong> it, or use <strong>duplicate</strong> to start from a similar case.</li>
      <li>Use the <strong>search box and filters</strong> to find cases by words, type or priority, and the <strong>suite list</strong> on the left to narrow by group.</li>
      <li>Tick several cases to <strong>enable, disable or delete</strong> them together. Disabled cases stay in the library but are left out of runs.</li>
      <li><strong>Import</strong> loads cases from a JSON or Excel file. <strong>Export</strong> saves the module's cases to a file.</li>
    </ul>
    ${warn('Deleting a case cannot be undone, so the app asks you to confirm first. Disabling is usually safer.')}
    <h3>Change or delete a module</h3>
    <p>Open <strong>Module settings</strong> to rename it, change its area or description, or require a second person to approve cases. Only an <strong>administrator</strong> sees <strong>Delete module</strong>, and a module that already has test runs cannot be deleted, so history is never lost.</p>` },

  { id: 'sources', title: 'Upload your documents and videos', lead: 'What you can upload, and how to get the best result.', body: () => `
    <p>Open a module and choose the <strong>Intake</strong> tab. Drag files into the box or press the button to choose them. You can add a short note to each file.</p>
    ${table(['You upload', 'What happens'], [
      ['Word, Excel, CSV, text, PDF', 'The text and tables are read automatically. This gives the best results.'],
      ['Screenshots (PNG, JPG)', 'Kept and shown to the AI as images, so it can see screens, field names and messages.'],
      ['Walkthrough videos (MP4, WebM, MOV)', 'The app takes pictures (keyframes) from the video and the AI looks at them. <strong>Spoken words are not understood</strong> unless you also upload a transcript.'],
      ['Transcripts (.srt, .vtt or .txt)', 'Read like a document. For a video, give the transcript <strong>the same file name</strong> (walkthrough.mp4 and walkthrough.srt) so they are used together.']
    ])}
    ${tip('Videos explain a lot, but the AI can only <em>see</em> them. Rules that people only <em>say</em> in the video are lost unless you add a transcript or a short written note. This is the single biggest way to improve results.')}
    <ul>
      <li>If you upload the same file twice, the app tells you it is already there.</li>
      <li>Very large files are fine. They can take a few minutes to process, and the file shows <em>processing</em> until it is ready.</li>
      <li>Each file has <strong>Download</strong> and <strong>Delete</strong> next to it. Deleting asks you to confirm. Insights already made from the file are kept.</li>
      <li><strong>Download module pack</strong> saves everything about a module (cases, insights and uploads) in one zip.</li>
    </ul>` },

  { id: 'analyse', title: 'Let the AI read your files', lead: 'How analysis works, what you get back, and how much it costs.', body: () => `
    ${steps(['On the <strong>Intake</strong> tab press <strong>Analyse files</strong>.', 'Choose the assistant if more than one is installed, then start. You can watch its progress and stop it.', 'When it finishes you get <strong>insights</strong> (what it understood) and <strong>draft cases</strong> in the Review queue.'])}
    <h3>What you get</h3>
    <ul>
      <li><strong>Fields, rules, flows and edge cases</strong> it found, each with the file (and video time) it came from.</li>
      <li><strong>Open questions</strong>: things the material does not answer. Take these to your business analyst or product owner.</li>
      <li><strong>Draft cases</strong>. They are <em>not</em> final. A person must review them.</li>
    </ul>
    ${note('The AI never invents requirements. If your material does not say something, it lists it as a question instead of guessing. If you upload material that is about a different module, it says so and writes no cases.')}
    <h3>Analysing again</h3>
    <p>Add new files and press Analyse again. The AI <strong>builds on the earlier insights</strong> and only reads what is new or changed. If nothing is new the app says <em>Nothing new to analyse</em>, and <strong>Run anyway</strong> makes it read everything again.</p>
    <h3>Quality and cost</h3>
    <p>An administrator chooses how much the AI may spend in <strong>Settings &rarr; AI usage and quality</strong>:</p>
    ${table(['Choice', 'Best for'], [['Economy', 'Quick checks and short documents. Fastest and cheapest. Screenshots and very large files are trimmed.'], ['Balanced', 'Everyday use. The recommended default.'], ['Best quality', 'Important modules. Reads more of every file and more video pictures, and uses the strongest model for hard jobs.']])}
    <p>Every job stops after a fixed number of steps, so it cannot run on forever. If a job uses all its steps, the message tells you what to try. An administrator can also set a <strong>daily limit</strong> on AI jobs, and the same panel shows how much was used.</p>` },

  { id: 'review', title: 'Review and approve cases', lead: 'Why nothing runs until a person has looked at it.', body: () => `
    <p>Open the <strong>Review queue</strong> tab. Cases are shown as <strong>Needs review</strong>, <strong>Approved</strong> or <strong>Rejected</strong>; use the buttons at the top to switch.</p>
    ${steps(['Open a case and read it. Edit anything that is wrong or unclear.', 'Press <strong>Approve</strong> if it is right, or <strong>Reject</strong> and give a short reason.', 'To decide on many at once, tick them and use <strong>Approve selected</strong> or <strong>Reject selected</strong>.'])}
    ${warn('<strong>The second-person rule.</strong> By default nobody can approve a case they created or last edited. This includes administrators. If you made every draft, the Approve buttons are greyed out and the page tells you why. A one-person team can switch the rule off in <strong>Module settings</strong>.')}
    <p>Approved cases appear in the main Test cases list and can be added to runs. Rejected cases are kept but never run.</p>` },

  { id: 'runs', title: 'Run tests and record results', lead: 'Manual runs, automated runs, evidence and reports.', body: () => `
    <h3>Start a run</h3>
    ${steps(['Open <strong>Test runs</strong> and press <strong>New test run</strong> (or choose cases in a module and press <strong>Run approved cases</strong>).', 'Pick the <strong>module</strong>, the <strong>cases</strong> and, for automated runs, the <strong>login profile</strong> (the website to test).', 'Check the run <strong>name</strong> and press <strong>Create run</strong>.'])}
    <h3>Manual runs</h3>
    <ul>
      <li>Open each case, carry out the steps in the real application, then choose <strong>Pass</strong>, <strong>Fail</strong> or <strong>Blocked</strong> and say what actually happened.</li>
      <li>Attach a <strong>screenshot</strong> as evidence (PNG files).</li>
      <li>When every case has a result, press <strong>Close run</strong>. After that the results are locked.</li>
    </ul>
    <h3>Automated runs</h3>
    <p>The browser robot carries out the steps itself. It needs the module to be connected to automation and a login profile with a <strong>saved session</strong>. Results and screenshots appear as it works. A running job can be cancelled.</p>
    <h3>After a run</h3>
    <ul>
      <li><strong>Re-run failures</strong> repeats only the cases that failed. <strong>Rerun all cases</strong> repeats everything.</li>
      <li>Use <strong>Report details</strong> to add a title, release and notes, and the triage section to classify failures.</li>
      <li><strong>Download bug report (PDF)</strong> creates the report. It becomes available once the run is closed. <strong>Export Excel</strong> and <strong>JSON</strong> save the results as data.</li>
      <li>In <strong>Test runs</strong> use the status buttons (Passed, Failed, Error and so on), the module menu and the search box to find an old run.</li>
    </ul>
    ${note('Runs keep a copy of the cases as they were, so changing a case later never changes an old result.')}` },

  { id: 'automation', title: 'Automate a module', lead: 'The Readiness checklist, and who does each step.', body: () => `
    <p>Every module page has a <strong>Readiness</strong> box. It shows seven steps. The ones marked <em>you</em> can be done by anyone; the others need a developer.</p>
    ${table(['Step', 'Who', 'What it means'], [
      ['1. Sources', 'You', 'At least one usable upload exists.'],
      ['2. Insights', 'You', 'The AI has analysed the uploads.'],
      ['3. Reviewed cases', 'You', 'At least one case is approved.'],
      ['4. Target setup', 'A lead', 'Confirm the module\'s page address (such as /billing), its tabs, and which login profile to use. Use the button in the checklist.'],
      ['5. Discovery', 'Developer', 'A read-only scan of the live page that lists its fields. It never saves anything. It counts only if it finds at least one field.'],
      ['6. Automation package', 'Developer', 'The AI proposes the robot code; a developer reviews and installs it.'],
      ['7. Smoke run', 'You', 'Run one automated case to prove it works end to end.']
    ])}
    ${warn('At the moment automation is built for the Augastam web app. Other products, such as Miracle, can sign in and keep manual test cases, but their automated discovery and robot are not built yet. The checklist says so.')}` },

  { id: 'settings', title: 'Settings: logins and AI usage', lead: 'For administrators.', body: () => `
    <h3>Login profiles</h3>
    <p>A login profile holds a test website and the login to use. Open <strong>Settings</strong> and press <strong>Add login profile</strong>.</p>
    ${table(['Product', 'You enter'], [['Augastam', 'ID, name, website address, username, password, <strong>tenant</strong>, <strong>facility</strong> and <strong>application role</strong>'], ['Miracle', 'ID, name, website address, username, password, <strong>facility</strong>, <strong>group</strong> and <strong>entry site</strong>']])}
    <ul>
      <li>The <strong>ID</strong> is lowercase letters, numbers and dashes. It cannot be changed later, and an ID already in use is refused.</li>
      <li>The <strong>website address</strong> is the site only (for example https://test.augastam.com), with no page path.</li>
      <li>Passwords are stored encrypted and are never shown again. When you edit a profile, leave the password blank to keep the saved one.</li>
      <li>Press <strong>Refresh application login</strong> to sign in once and save the session. Repeat it when the badge says <em>Login expired</em> or <em>Login required</em>.</li>
    </ul>
    <h3>AI usage and quality</h3>
    <p>Choose <strong>Economy</strong>, <strong>Balanced</strong> or <strong>Best quality</strong>, and set the most AI jobs allowed per day (0 means no limit). The panel also shows recent jobs and how much each used.</p>` },

  { id: 'people', title: 'People and permissions', lead: 'Who can do what.', body: () => `
    ${table(['Role', 'Can'], [
      ['Viewer', 'Read everything they have access to. Cannot change anything.'],
      ['BA', 'Upload sources, analyse them, write and edit their own cases.'],
      ['Tester', 'Everything a BA can, plus review and approve cases and start runs.'],
      ['Lead', 'Everything a tester can, plus change a module\'s settings and manage who has access to it.'],
      ['Administrator', 'Everything, including users, login profiles, AI settings and deleting modules.']
    ])}
    <ul>
      <li><strong>Users</strong> (administrators): create accounts, change roles, disable or delete people, reset passwords. The built-in administrator account is set on the server and cannot be changed here.</li>
      <li><strong>Product access</strong> and each module's <strong>Members</strong> tab: give a person or a team a role for a product or a single module, and set when it ends.</li>
      <li><strong>Teams</strong>: group people so you can give access to all of them at once.</li>
      <li>Everyone can change their own password with <strong>Password</strong> at the top right.</li>
    </ul>
    ${note('If a button is missing or greyed out, you probably do not have that permission. The page usually says why. Ask a lead or administrator.')}` },

  { id: 'safety', title: 'Good to know', lead: 'How the app protects your work.', body: () => `
    <ul>
      <li><strong>It asks before anything is lost.</strong> Deleting cases, templates, requirements, uploads, users, modules or closing a run all need a confirmation.</li>
      <li><strong>Nothing is overwritten quietly.</strong> A new login profile or data template with a name that already exists is refused.</li>
      <li><strong>Why it works this way.</strong> The design notes behind Test Studio are on the <a href="#/research">Design and research</a> page.</li>
      <li><strong>Everything is recorded.</strong> Changes to access, settings, modules and runs are written to an audit trail.</li>
      <li><strong>AI is supervised.</strong> It drafts; people approve. It works only on the files you give it and cannot reach your systems.</li>
      <li><strong>Team data is shared through the repository.</strong> Administrators export users, modules, cases, settings and login profiles with the snapshot tool so a new machine starts with the same data. The repository must stay private because the login passwords travel with it.</li>
    </ul>` },

  { id: 'trouble', title: 'When something looks wrong', lead: 'The messages people ask about most.', body: () => table(['You see', 'What it means and what to do'], [
    ['Nothing new to analyse', 'Every upload was already read. Add or change a file, or press <strong>Run anyway</strong> to read everything again.'],
    ['Another person must approve this case', 'You created or edited it, so someone else with the review right has to approve it. Admins, and anyone granted <strong>Approve cases you wrote yourself</strong> (Members &rarr; the person&rsquo;s permissions), can approve their own work. For a one-person team a lead can turn the rule off in Module settings.'],
    ['AI generation locked', 'The module is not ready yet. Open the Readiness box to see which step is missing.'],
    ['Login required / Login expired', 'Open Settings or Environments and press Refresh application login for that profile.'],
    ['A case prefix is already used', 'Two modules in one product cannot share a prefix. Choose a different one.'],
    ['The daily limit of AI jobs has been reached', 'An administrator can raise it in Settings &rarr; AI usage, or try again tomorrow.'],
    ['The agent used all its steps', 'The job was too big. Try fewer files, or ask an administrator to choose Best quality.'],
    ['An automated run ended with an error and no results', 'Check that the module is connected to automation and that the login profile has a saved session.'],
    ['Cannot delete this module', 'It has test runs. Their history is kept, so the module cannot be deleted.'],
    ['We could not find that page', 'The address is wrong or the item was deleted. Use the left menu to go back.'],
    ['I cannot see a page or button', 'You may not have permission. Ask a lead or administrator.']
  ]) }
];

export function helpPage() {
  return heading('Help and guide', 'How to use Test Studio', 'Everything you need, in plain language.',
    '<div class="docs-search"><input id="docs-search" type="search" placeholder="Search the guide…" aria-label="Search the guide" autocomplete="off"></div>')
    + `<div class="docs"><nav class="docs-toc" aria-label="Guide contents"><strong>Contents</strong>${SECTIONS.map((s, i) => `<button type="button" data-docs-go="${s.id}" class="${i === 0 ? 'active' : ''}"><span>${i + 1}</span>${esc(s.title)}</button>`).join('')}</nav>`
    + `<div class="docs-body">${SECTIONS.map((s, i) => `<section class="doc-section" id="doc-${s.id}" data-docs-text><header><span class="doc-index">${i + 1}</span><div><h2>${esc(s.title)}</h2><p class="doc-lead">${esc(s.lead)}</p></div></header>${s.body()}</section>`).join('')}<p class="docs-empty hidden" id="docs-empty">Nothing in the guide matches that search. Try a shorter word.</p></div></div>`;
}
