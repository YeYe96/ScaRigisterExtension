(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.SCARequestUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const DEFAULT_CREATE_USER_PATH = '/sca/api-v1/user/add';

  function normalizeText(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  function normalizeApiPath(value, fallbackPath) {
    const fallback = normalizeText(fallbackPath) || DEFAULT_CREATE_USER_PATH;
    const raw = normalizeText(value);
    if (!raw) {
      return fallback;
    }

    const normalized = raw.startsWith('/') ? raw : `/${raw}`;
    return normalized.replace(/\/{2,}/g, '/');
  }

  function buildApiUrl(baseUrl, apiPath) {
    const origin = normalizeText(baseUrl).replace(/\/+$/, '');
    const path = normalizeApiPath(apiPath);
    return `${origin}${path}`;
  }

  return {
    DEFAULT_CREATE_USER_PATH: DEFAULT_CREATE_USER_PATH,
    normalizeApiPath: normalizeApiPath,
    buildApiUrl: buildApiUrl,
  };
});
