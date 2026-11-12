import { decode } from './shared.mjs';

export const productsSchema = `
    CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, document TEXT NOT NULL);`;

export function createProductsRepo(db) {
  return {
    products: () => db.prepare('SELECT document FROM products ORDER BY rowid').all().map(decode),
    product: id => decode(db.prepare('SELECT document FROM products WHERE id=?').get(String(id))),
    saveProduct(product) {
      const doc = { id: product.id, name: product.name, description: product.description ?? '', createdAt: product.createdAt ?? new Date().toISOString() };
      db.prepare('INSERT INTO products VALUES (?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(doc.id, JSON.stringify(doc));
      return doc;
    },
  };
}
