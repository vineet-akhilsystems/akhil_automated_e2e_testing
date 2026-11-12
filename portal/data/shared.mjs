// Shared helpers for the data repositories: every table stores one JSON document per row.
export const decode = row => row ? JSON.parse(row.document) : undefined;
