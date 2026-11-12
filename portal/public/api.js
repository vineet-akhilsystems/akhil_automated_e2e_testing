import { loginScreen } from './pages/login.js';

export async function api(url, method = 'GET', body) {
  const res = await fetch(url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.endsWith('/login') && !url.endsWith('/me/password')) loginScreen();
    throw Object.assign(new Error(value.error ?? value.reason ?? value.message ?? (res.status === 404 ? 'This feature is not available on the server yet.' : res.status === 403 ? 'Your role does not allow this action.' : 'Request failed.')), { status: res.status, body: value });
  }
  return value;
}
