(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.SCAAuthUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const TOKEN_KEY_NAMES = new Set([
    'token',
    'accesstoken',
    'access_token',
    'authorization',
    'authtoken',
    'auth_token',
    'openapiusertoken',
  ]);

  const RSA_KEY_NAMES = new Set([
    'publickey',
    'rsapublickey',
    'rsa_public_key',
    'pubkey',
    'public_key',
    'rsakey',
  ]);

  function normalizeText(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  function cleanTokenValue(value) {
    return normalizeText(value)
      .replace(/^["']|["']$/g, '')
      .replace(/^Bearer\s+/i, '')
      .trim();
  }

  function normalizeKeyName(value) {
    return normalizeText(value).replace(/[-_]/g, '').toLowerCase();
  }

  function looksLikeToken(value) {
    return cleanTokenValue(value).length > 10;
  }

  function looksLikeRSAKey(value) {
    const text = normalizeText(value);
    if (!text) {
      return false;
    }
    if (/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/.test(text)) {
      return true;
    }
    return text.length > 80 && /^[A-Za-z0-9+/=\s]+$/.test(text);
  }

  function looksLikeRSAKeyName(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return false;
    }
    return RSA_KEY_NAMES.has(normalized)
      || normalized.includes('publickey')
      || normalized.includes('pubkey')
      || normalized.endsWith('rsakey');
  }

  function toUint8Array(value) {
    if (!value) {
      return null;
    }
    if (value instanceof Uint8Array) {
      return value;
    }
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (Array.isArray(value)) {
      return Uint8Array.from(value);
    }
    return null;
  }

  function bytesToBase64(bytes) {
    if (!bytes || bytes.length === 0) {
      return '';
    }

    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    if (typeof btoa === 'function') {
      return btoa(binary);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }
    return '';
  }

  function wrapPemBody(base64Body) {
    const chunks = normalizeText(base64Body).match(/.{1,64}/g) || [];
    return `-----BEGIN PUBLIC KEY-----\n${chunks.join('\n')}\n-----END PUBLIC KEY-----`;
  }

  function normalizeRSAKeyValue(value, format) {
    if (looksLikeRSAKey(value)) {
      return normalizeText(value);
    }

    if (normalizeText(format).toLowerCase() === 'spki') {
      const bytes = toUint8Array(value);
      const base64Body = bytesToBase64(bytes);
      if (!base64Body) {
        return '';
      }
      return wrapPemBody(base64Body);
    }

    return '';
  }

  function getPathValue(root, path) {
    if (!root || !path) {
      return undefined;
    }

    const segments = String(path).split('.');
    let current = root;
    for (const segment of segments) {
      if (!current || (typeof current !== 'object' && typeof current !== 'function')) {
        return undefined;
      }
      current = current[segment];
    }
    return current;
  }

  function headersToEntries(headersLike) {
    if (!headersLike) {
      return [];
    }

    if (typeof headersLike.forEach === 'function') {
      const entries = [];
      headersLike.forEach(function (value, key) {
        entries.push([key, value]);
      });
      return entries;
    }

    if (Array.isArray(headersLike)) {
      return headersLike;
    }

    if (typeof headersLike === 'object') {
      return Object.keys(headersLike).map(function (key) {
        return [key, headersLike[key]];
      });
    }

    return [];
  }

  function readTokenFromHeaders(headersLike) {
    const entries = headersToEntries(headersLike);
    const preferredOrder = ['authorization', 'openapiusertoken'];

    for (const preferredKey of preferredOrder) {
      for (const entry of entries) {
        const key = entry[0];
        const value = entry[1];
        if (normalizeKeyName(key) !== preferredKey) {
          continue;
        }
        if (!looksLikeToken(value)) {
          continue;
        }
        return {
          key: normalizeText(key) || (preferredKey === 'authorization' ? 'Authorization' : 'OpenApiUserToken'),
          value: cleanTokenValue(value),
        };
      }
    }

    return null;
  }

  function toTraversalChildren(value) {
    if (!value || typeof value !== 'object') {
      return [];
    }

    const keys = Array.isArray(value)
      ? value.map(function (_item, index) { return index; })
      : Object.keys(value);

    return keys.slice(0, 80).map(function (key) {
      let child;
      try {
        child = value[key];
      } catch (_error) {
        child = undefined;
      }
      return [key, child];
    });
  }

  function buildChildPath(parentPath, key, isArray) {
    return isArray ? `${parentPath}[${key}]` : `${parentPath}.${key}`;
  }

  function findValueByKey(root, rootPath, candidateKeys, validator, transform, maxDepth) {
    if (!root || (typeof root !== 'object' && typeof root !== 'function')) {
      return null;
    }

    const seen = new Set();
    const queue = [{ value: root, path: rootPath, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current.value || (typeof current.value !== 'object' && typeof current.value !== 'function')) {
        continue;
      }
      if (seen.has(current.value)) {
        continue;
      }
      seen.add(current.value);

      const isArray = Array.isArray(current.value);
      const children = toTraversalChildren(current.value);
      for (const childEntry of children) {
        const key = childEntry[0];
        const childValue = childEntry[1];
        const childPath = buildChildPath(current.path, key, isArray);
        const normalizedKey = normalizeKeyName(key);

        const matchesCandidate = typeof candidateKeys === 'function'
          ? candidateKeys(normalizedKey)
          : candidateKeys.has(normalizedKey);

        if (matchesCandidate && validator(childValue)) {
          return {
            value: transform(childValue),
            path: childPath,
          };
        }

        if (current.depth >= maxDepth) {
          continue;
        }
        if (!childValue || typeof childValue !== 'object') {
          continue;
        }
        queue.push({
          value: childValue,
          path: childPath,
          depth: current.depth + 1,
        });
      }
    }

    return null;
  }

  function readAuthFromGlobalContext(context) {
    if (!context || (typeof context !== 'object' && typeof context !== 'function')) {
      return {
        token: '',
        tokenKey: '',
        rsaKey: '',
        rsaKeySource: '',
      };
    }

    const directHeaderPaths = [
      'axios.defaults.headers.common.Authorization',
      'axios.defaults.headers.common.authorization',
      'axios.defaults.headers.common.OpenApiUserToken',
      'axios.defaults.headers.common.openApiUserToken',
      'axios.defaults.headers.Authorization',
      'axios.defaults.headers.authorization',
      'axios.defaults.headers.OpenApiUserToken',
      'axios.defaults.headers.openApiUserToken',
    ];

    for (const path of directHeaderPaths) {
      const value = getPathValue(context, path);
      if (!looksLikeToken(value)) {
        continue;
      }
      return mergeAuthInfo({
        token: cleanTokenValue(value),
        tokenKey: `window.${path}`,
        rsaKey: '',
        rsaKeySource: '',
      }, readAuthFromGlobalRoots(context));
    }

    return readAuthFromGlobalRoots(context);
  }

  function readAuthFromGlobalRoots(context) {
    const roots = [
      { path: 'window', value: context, depth: 1 },
      { path: 'window.__INITIAL_STATE__', value: context.__INITIAL_STATE__, depth: 4 },
      { path: 'window.__NUXT__', value: context.__NUXT__, depth: 4 },
      { path: 'window.__NEXT_DATA__', value: context.__NEXT_DATA__, depth: 4 },
      { path: 'window.store', value: context.store, depth: 4 },
      { path: 'window.store.state', value: context.store && context.store.state, depth: 4 },
      { path: 'window.app', value: context.app, depth: 4 },
      { path: 'window.app.$store', value: context.app && context.app.$store, depth: 4 },
      { path: 'window.app.$store.state', value: context.app && context.app.$store && context.app.$store.state, depth: 4 },
      { path: 'window.__STORE__', value: context.__STORE__, depth: 4 },
      { path: 'window.__APP__', value: context.__APP__, depth: 4 },
    ];

    let tokenResult = null;
    let rsaResult = null;

    for (const root of roots) {
      if (!tokenResult) {
        tokenResult = findValueByKey(
          root.value,
          root.path,
          TOKEN_KEY_NAMES,
          looksLikeToken,
          cleanTokenValue,
          root.depth
        );
      }
      if (!rsaResult) {
        rsaResult = findValueByKey(
          root.value,
          root.path,
          looksLikeRSAKeyName,
          looksLikeRSAKey,
          normalizeText,
          root.depth
        );
      }
      if (tokenResult && rsaResult) {
        break;
      }
    }

    return {
      token: tokenResult ? tokenResult.value : '',
      tokenKey: tokenResult ? tokenResult.path : '',
      rsaKey: rsaResult ? rsaResult.value : '',
      rsaKeySource: rsaResult ? rsaResult.path : '',
    };
  }

  function mergeAuthInfo() {
    const merged = {
      token: '',
      tokenKey: '',
      rsaKey: '',
      rsaKeySource: '',
    };

    for (const source of arguments) {
      if (!source || typeof source !== 'object') {
        continue;
      }

      if (!merged.token && looksLikeToken(source.token)) {
        merged.token = cleanTokenValue(source.token);
        merged.tokenKey = normalizeText(source.tokenKey);
      }

      if (!merged.rsaKey && looksLikeRSAKey(source.rsaKey)) {
        merged.rsaKey = normalizeText(source.rsaKey);
        merged.rsaKeySource = normalizeText(source.rsaKeySource);
      }
    }

    return merged;
  }

  return {
    cleanTokenValue: cleanTokenValue,
    normalizeRSAKeyValue: normalizeRSAKeyValue,
    readTokenFromHeaders: readTokenFromHeaders,
    readAuthFromGlobalContext: readAuthFromGlobalContext,
    mergeAuthInfo: mergeAuthInfo,
  };
});
