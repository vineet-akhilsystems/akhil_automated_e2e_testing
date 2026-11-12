import { api } from './api.js';
import { $ } from './components/dom.js';
import { empty } from './components/widgets.js';
import { loginScreen } from './pages/login.js';
import { enterWorkspace } from './pages/workspace.js';
import { state } from './state.js';


export const brandName = () => state.brand || 'Akhil Systems';
export async function start() { try { const session = await api('/api/session'); state.user = session.user ?? null; if (session.brand) { state.brand = session.brand; document.title = `${session.brand} Test Studio`; } if (!session.authenticated) loginScreen(); else await enterWorkspace(false); } catch (error) { $('#app').innerHTML = empty('Could not open workspace', error.message); } }
