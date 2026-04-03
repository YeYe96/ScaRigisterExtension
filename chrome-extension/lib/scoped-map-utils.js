(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.SCAScopedMapUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const SCOPED_MAP_MARKER = '__scopedMap__';
  const DEFAULT_SCOPE = '__global__';

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeScope(value) {
    const text = String(value || '').trim();
    if (!text) {
      return DEFAULT_SCOPE;
    }

    try {
      return new URL(text).origin.toLowerCase();
    } catch (_error) {
      return text.replace(/\/+$/, '').toLowerCase() || DEFAULT_SCOPE;
    }
  }

  function readScopedMap(rawValue, scope) {
    if (isPlainObject(rawValue) && rawValue[SCOPED_MAP_MARKER] === true && isPlainObject(rawValue.values)) {
      const scopedValue = rawValue.values[normalizeScope(scope)];
      return isPlainObject(scopedValue) ? scopedValue : {};
    }
    return isPlainObject(rawValue) ? rawValue : {};
  }

  function writeScopedMap(rawValue, scope, nextMap) {
    const values = isPlainObject(rawValue) && rawValue[SCOPED_MAP_MARKER] === true && isPlainObject(rawValue.values)
      ? Object.assign({}, rawValue.values)
      : {};

    values[normalizeScope(scope)] = isPlainObject(nextMap) ? Object.assign({}, nextMap) : {};
    return {
      [SCOPED_MAP_MARKER]: true,
      values: values,
    };
  }

  return {
    SCOPED_MAP_MARKER: SCOPED_MAP_MARKER,
    DEFAULT_SCOPE: DEFAULT_SCOPE,
    normalizeScope: normalizeScope,
    readScopedMap: readScopedMap,
    writeScopedMap: writeScopedMap,
  };
});
