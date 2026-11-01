export const fault = code => Object.assign(new Error(code), {code});
export const publicCode = error => /^[A-Z][A-Z0-9_]{0,79}$/.test(error?.code || '') ? error.code : 'READ_FAILED';
export const statusCode = code => code === 'UNAUTHORIZED' ? 401 : ['PATH_DENIED', 'SYMLINK_DENIED', 'SENSITIVE_FILE', 'HARDLINK_DENIED'].includes(code) ? 403 : code === 'NOT_FOUND' ? 404 : ['SOURCE_CHANGED', 'REVISION_CHANGED'].includes(code) ? 409 : code === 'BUSY' ? 429 : 400;
