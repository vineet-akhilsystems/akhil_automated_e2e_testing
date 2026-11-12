import { check, HttpError } from '../registry.mjs';

export const readJson = async req => {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    check(size <= 10 * 1024 * 1024, 'Upload is too large (maximum 10 MB).', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new HttpError(400, 'Request must contain valid JSON.'); }
  check(value && typeof value === 'object' && !Array.isArray(value), 'Send a JSON object.', 400);
  return value;
};
