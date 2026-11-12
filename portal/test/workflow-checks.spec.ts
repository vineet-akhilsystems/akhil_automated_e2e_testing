import { test, expect } from '@playwright/test';
import { RegistrationPage } from '../../tests/modules/registration/registration.page';
import { runWorkflow } from '../../tests/modules/registration/workflow-runner';

const form = `<div class="registration-card"><div class="registration-card-title">Basic Information</div>
${[['First Name', 'first_name', 'Agent'], ['Middle Name', 'middle_name', 'Testing'], ['Last Name', 'last_name', 'UserFixture'], ['Email ID', 'email', 'before@example.com']].map(([label, name, value]) => `<div class="form-group"><label>${label}</label><input name="${name}" value="${value}"></div>`).join('')}</div>`;
const noFill = async () => {};

test('New workflow verifies fields actually clear, and detects a broken reset button', async ({ page }, info) => {
  await page.setContent(form + `<button onclick="document.querySelectorAll('input').forEach(el=>el.value='')">New</button><button>Save</button>`);
  const reg = new RegistrationPage(page);
  await runWorkflow(reg, 'new-reset', {}, info, 'LOCAL-RESET', noFill);
  await page.getByRole('button', { name: 'New', exact: true }).evaluate(el => el.removeAttribute('onclick'));
  await expect(runWorkflow(reg, 'new-reset', {}, info, 'LOCAL-BROKEN-RESET', noFill)).rejects.toThrow();
});

test('update remarks workflow checks empty and whitespace, cancels and reopens the record', async ({ page }, info) => {
  await page.setContent(form + `<button onclick="document.querySelector('.modal').style.display='block'">Update</button>
    <div class="modal show" style="display:none"><h2>Update Registration</h2>
    <textarea placeholder="Enter remarks" oninput="document.querySelector('#submit').disabled=!this.value.trim()"></textarea>
    <button id="submit" disabled>Submit</button><button onclick="document.querySelector('.modal').style.display='none'">Close</button></div>`);
  const reg = new RegistrationPage(page);
  let reopened = false;
  reg.openExisting = async () => { reopened = true; await reg.input('email').fill('before@example.com'); };
  await runWorkflow(reg, 'update-remarks', {}, info, 'LOCAL-REMARKS', noFill);
  expect(reopened).toBe(true);
  await expect(reg.input('email')).toHaveValue('before@example.com');
});

test('write workflows refuse a record outside Agent Testing even when its fields are writable', async ({ page }, info) => {
  await page.setContent(form);
  const reg = new RegistrationPage(page);
  await reg.input('first_name').fill('Someone');
  await expect(runWorkflow(reg, 'update-persist', {}, info, 'LOCAL-OWNERSHIP', noFill)).rejects.toThrow(/Only synthetic Agent Testing/);
  await expect(reg.input('email')).toHaveValue('before@example.com');
});

test('workflow executor fails closed for an unsupported flow', async ({ page }, info) => {
  await expect(runWorkflow(new RegistrationPage(page), 'not-a-flow', {}, info, 'LOCAL-UNKNOWN', noFill)).rejects.toThrow('Unsupported registration workflow');
});

test('PIN clear workflow detects a stale City even when State and District clear correctly', async ({ page }, info) => {
  await page.setContent(`<div class="registration-card"><div class="registration-card-title">Address Details</div>
    <div class="form-group"><label>Pin Code</label><input id="pin" onblur="['State','District','City'].forEach(k=>{if(!this.value && document.body.dataset.broken && k==='City')return;document.getElementById(k).textContent=this.value?'Lookup '+k:''})"></div>
    ${['State', 'District', 'City'].map(label => `<div class="form-group"><label>${label}</label><span class="singleValue" id="${label}"></span><input></div>`).join('')}</div>`);
  const reg = new RegistrationPage(page);
  reg.addressTab = async () => {};
  // The local fixture applies lookup values on blur; no lookup service is called.
  reg.set = async (key, value) => { await reg.input(key).fill(String(value)); await reg.input(key).press('Tab'); };
  await runWorkflow(reg, 'pin-clear', {}, info, 'LOCAL-PIN-CLEAR', noFill);
  await page.locator('body').evaluate(el => { el.dataset.broken = 'true'; });
  await expect(runWorkflow(reg, 'pin-clear', {}, info, 'LOCAL-PIN-STALE-CITY', noFill)).rejects.toThrow(/Clearing PIN clears State, District and City/);
});

test('duplicate workflow selects the matching UHID radio before using the shared footer action', async ({ page }, info) => {
  const fixture = form.replace('</div></div>', '<div class="form-group"><label>Mobile No</label><input value="9000000000"></div></div></div>')
    + `<div class="modal show" style="display:none"><h2>Duplicate Patients</h2><table>
      <tr><td>OTHER</td><td><input type="radio" name="patient" value="OTHER" checked></td></tr>
      <tr><td>ASNRTEST UserFixture</td><td><input type="radio" name="patient" value="ASNRTEST"></td></tr></table>
      <button onclick="history.pushState({},'', '/registration/workflow/'+document.querySelector('input[name=patient]:checked').value);document.querySelector('.modal').style.display='none'">Use Existing Patient</button></div>`;
  await page.route('http://fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('http://fixture.invalid/registration/workflow/ASNRTEST');
  const reg = new RegistrationPage(page);
  const actualValue = reg.value.bind(reg);
  reg.value = key => ['title', 'gender', 'dob', 'pin_code', 'address'].includes(key) ? Promise.resolve('fixture') : actualValue(key);
  reg.open = async () => { await page.goto('http://fixture.invalid/registration'); };
  reg.save = async () => { await page.locator('.modal').evaluate(el => { (el as HTMLElement).style.display = 'block'; }); return { status: null, body: null, registrationId: null, toasts: [] }; };
  await runWorkflow(reg, 'duplicate-use-existing', {}, info, 'LOCAL-DUPLICATE', noFill);
  await expect(page).toHaveURL('http://fixture.invalid/registration/workflow/ASNRTEST');
});

test('print workflow captures the actual desktop iframe document before it is removed', async ({ page }, info) => {
  await page.setContent(form + '<button>Print</button><div class="registration-print-menu"><button>Card</button></div>');
  await page.getByRole('button', { name: 'Card', exact: true }).evaluate(el => {
    el.addEventListener('click', () => {
      const frame = document.createElement('iframe');
      frame.style.width = '0'; frame.style.height = '0';
      document.body.appendChild(frame);
      frame.onload = () => { frame.contentWindow!.print(); setTimeout(() => frame.remove(), 100); };
      frame.contentDocument!.open();
      frame.contentDocument!.write('<html><body>about:blank Agent UserFixture 9000000000 Male</body></html>');
      frame.contentDocument!.close();
    });
  });
  const reg = new RegistrationPage(page);
  reg.value = key => Promise.resolve(({ first_name: 'Agent', last_name: 'UserFixture', mobile: '9000000000', gender: 'Male' } as Record<string,string>)[key] ?? '');
  await runWorkflow(reg, 'print-card', {}, info, 'LOCAL-PRINT-IFRAME', noFill);
});

test('mandatory Tab traversal ignores optional/disabled fields and detects a keyboard trap', async ({ page }, info) => {
  await page.setContent(`<div class="registration-card"><div class="registration-card-title">Basic Information</div>
    <div class="form-group"><label>Title*</label><input></div>
    <div class="form-group"><label>First Name*</label><input id="trap"></div>
    <div class="form-group"><label>Optional</label><input></div>
    <div class="form-group"><label>Disabled*</label><input disabled></div>
    <div class="form-group"><label>Mobile No*</label><input></div></div>`);
  await runWorkflow(new RegistrationPage(page), 'mandatory-tab-traversal', {}, info, 'LOCAL-TAB', noFill);
  await page.locator('#trap').evaluate(el => el.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Tab') event.preventDefault(); }));
  await expect(runWorkflow(new RegistrationPage(page), 'mandatory-tab-traversal', {}, info, 'LOCAL-TRAP', noFill)).rejects.toThrow(/Tab reaches every enabled mandatory field/);
});
