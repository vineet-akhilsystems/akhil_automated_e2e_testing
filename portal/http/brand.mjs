// The name shown for the testing tool itself (sidebar, sign-in, titles). Not the products under test.
export const brandName = () => (process.env.PORTAL_BRAND_NAME || 'Akhil Systems').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60) || 'Akhil Systems';
