#!/usr/bin/env node
// Writes a small, valid one-page PDF used as a synthetic ID proof for upload tests.
//   node qa/tools/make-test-pdf.js [out.pdf]
const fs = require('fs');
const path = require('path');

const out = process.argv[2] || 'qa/modules/registration/data/agent-test-id-proof.pdf';
const text = [
  'AGENT TESTING - SYNTHETIC ID PROOF',
  'Not a real document. Created by the Augastam E2E suite.',
  `Generated: ${new Date().toISOString()}`,
];
const content = ['BT', '/F1 16 Tf', '60 760 Td', ...text.flatMap((t, i) => [i ? '0 -28 Td' : '', `(${t.replace(/[()\\]/g, '\\$&')}) Tj`]).filter(Boolean), 'ET'].join('\n');

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
let pdf = '%PDF-1.4\n';
const offsets = [];
objects.forEach((o, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, pdf);
console.log(`wrote ${out} (${pdf.length} bytes)`);
