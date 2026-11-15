export type ModuleKind = 'qa' | 'tests' | 'portal';
export const KINDS: ModuleKind[];
export const RESERVED_PRODUCT_NAMES: string[];
export function isReservedProductName(productId: string): boolean;
export function productFolder(kind: ModuleKind, productId: string): string;
export function moduleFolder(kind: ModuleKind, productId: string, moduleId: string): string;
export function listProductFolders(root: string, kind: ModuleKind): string[];
export function legacyModuleFolder(kind: ModuleKind, moduleId: string): string;
export function resolveModuleFolder(root: string, kind: ModuleKind, productId: string, moduleId: string): string;
