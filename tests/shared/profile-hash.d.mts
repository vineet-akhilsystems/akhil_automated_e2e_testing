export const VOLATILE_KEYS: string[];
export const PROFILE_URL: RegExp;
export function partForUrl(url: string): string | undefined;
export function normalizeConfig(value: unknown): unknown;
export function responseKey(url: string): string;
export function combineHashes(parts: Record<string, string>): string;
export function profileFingerprint(parts: Record<string, unknown>): { hash: string; parts: Record<string, string> };
