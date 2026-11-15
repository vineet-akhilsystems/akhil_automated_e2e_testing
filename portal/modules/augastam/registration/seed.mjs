// Registration module seed: runs once on a brand-new database (see openStore). Must not import store or registry.
import { registrationData } from './adapter.mjs';

export function seed(store) {
  store.saveModule({ id: 'registration', productId: 'augastam', name: 'Registration', area: 'Patient Care', prefix: 'REG', description: 'Patient registration, demographics, contact details and validation.', adapter: 'registration', config: { bases: registrationData.bases, requirements: registrationData.requirements ?? [] } });
  for (const c of registrationData.cases) store.saveCase('registration', { ...c, mode: 'automated', requirement: c.requirement ?? '', preconditions: c.preconditions ?? '', steps: [] });
}
