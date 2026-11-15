// Configuration profile fingerprint. The algorithm lives once in tests/shared/profile-hash.mjs (shared with the Playwright fixture).
export { VOLATILE_KEYS, PROFILE_URL, partForUrl, normalizeConfig, combineHashes, profileFingerprint, responseKey, entryKey, isProfileKey, hashBody, partsFromKeys, profileFromKeys } from '../tests/shared/profile-hash.mjs';
