(function () {
  'use strict';

  const PAGE_BRIDGE_SOURCE = 'sca-page-auth-bridge';
  const PAGE_BRIDGE_SNAPSHOT = 'SCA_AUTH_SNAPSHOT';

  if (window.__scaAuthBridgeInstalled) {
    return;
  }
  window.__scaAuthBridgeInstalled = true;

  let latestSnapshot = {
    token: '',
    tokenKey: '',
    rsaKey: '',
    rsaKeySource: '',
  };

  function getAuthUtils() {
    return typeof SCAAuthUtils === 'object' ? SCAAuthUtils : null;
  }

  function postSnapshot(snapshot) {
    window.postMessage({
      source: PAGE_BRIDGE_SOURCE,
      type: PAGE_BRIDGE_SNAPSHOT,
      payload: snapshot,
    }, window.location.origin);
  }

  function mergeSnapshot() {
    const authUtils = getAuthUtils();
    if (!authUtils || typeof authUtils.mergeAuthInfo !== 'function') {
      return latestSnapshot;
    }

    const merged = authUtils.mergeAuthInfo.apply(null, arguments);
    latestSnapshot = merged;
    return merged;
  }

  function emitCurrentSnapshot(extra) {
    const authUtils = getAuthUtils();
    const globalSnapshot = authUtils && typeof authUtils.readAuthFromGlobalContext === 'function'
      ? authUtils.readAuthFromGlobalContext(window)
      : null;
    const snapshot = mergeSnapshot(extra, globalSnapshot, latestSnapshot);
    postSnapshot(snapshot);
  }

  function captureRSAValue(value, sourceLabel, format) {
    const authUtils = getAuthUtils();
    if (!authUtils || typeof authUtils.normalizeRSAKeyValue !== 'function') {
      return;
    }

    const normalizedKey = authUtils.normalizeRSAKeyValue(value, format);
    if (!normalizedKey) {
      return;
    }

    emitCurrentSnapshot({
      token: '',
      tokenKey: '',
      rsaKey: normalizedKey,
      rsaKeySource: sourceLabel,
    });
  }

  function captureHeaders(headersLike, sourceLabel) {
    const authUtils = getAuthUtils();
    if (!authUtils || typeof authUtils.readTokenFromHeaders !== 'function') {
      return;
    }

    const tokenInfo = authUtils.readTokenFromHeaders(headersLike);
    if (!tokenInfo) {
      return;
    }

    emitCurrentSnapshot({
      token: tokenInfo.value,
      tokenKey: `${sourceLabel}.${tokenInfo.key}`,
      rsaKey: '',
      rsaKeySource: '',
    });
  }

  function patchFetch() {
    if (typeof window.fetch !== 'function' || window.fetch.__scaAuthWrapped) {
      return;
    }

    const originalFetch = window.fetch;
    const wrappedFetch = function (input, init) {
      if (init && init.headers) {
        captureHeaders(init.headers, 'page.fetch');
      }
      if (input && typeof input === 'object' && input.headers) {
        captureHeaders(input.headers, 'page.fetch');
      }
      return originalFetch.apply(this, arguments);
    };
    wrappedFetch.__scaAuthWrapped = true;
    window.fetch = wrappedFetch;
  }

  function wrapPrototypeMethod(target, methodName, callback) {
    if (!target || typeof target[methodName] !== 'function') {
      return false;
    }
    if (target[methodName].__scaAuthWrapped) {
      return true;
    }

    const original = target[methodName];
    const wrapped = function () {
      try {
        callback.apply(this, arguments);
      } catch (_error) {
        // 忽略探针异常，避免影响页面原逻辑
      }
      return original.apply(this, arguments);
    };
    wrapped.__scaAuthWrapped = true;
    target[methodName] = wrapped;
    return true;
  }

  function patchJSEncrypt() {
    if (typeof window.JSEncrypt !== 'function') {
      return false;
    }

    const proto = window.JSEncrypt.prototype;
    let patched = false;

    patched = wrapPrototypeMethod(proto, 'setPublicKey', function (key) {
      captureRSAValue(key, 'page.JSEncrypt.setPublicKey');
    }) || patched;

    patched = wrapPrototypeMethod(proto, 'setKey', function (key) {
      captureRSAValue(key, 'page.JSEncrypt.setKey');
    }) || patched;

    return patched;
  }

  function patchWebCrypto() {
    const subtle = window.crypto && window.crypto.subtle;
    if (!subtle || typeof subtle.importKey !== 'function' || subtle.importKey.__scaAuthWrapped) {
      return false;
    }

    const originalImportKey = subtle.importKey.bind(subtle);
    const wrappedImportKey = function (format, keyData) {
      if (String(format || '').toLowerCase() === 'spki') {
        captureRSAValue(keyData, 'page.webcrypto.importKey.spki', 'spki');
      }
      return originalImportKey.apply(this, arguments);
    };
    wrappedImportKey.__scaAuthWrapped = true;

    try {
      subtle.importKey = wrappedImportKey;
      return true;
    } catch (_error) {
      return false;
    }
  }

  function scheduleCryptoPatches() {
    let attempt = 0;
    const maxAttempts = 20;

    function run() {
      patchWebCrypto();
      patchJSEncrypt();
      attempt += 1;
      if (attempt < maxAttempts) {
        window.setTimeout(run, 500);
      }
    }

    run();
  }

  function patchXMLHttpRequest() {
    const proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (!proto || proto.__scaAuthWrapped) {
      return;
    }

    const originalOpen = proto.open;
    const originalSetRequestHeader = proto.setRequestHeader;
    const originalSend = proto.send;

    proto.open = function () {
      this.__scaAuthHeaders = {};
      return originalOpen.apply(this, arguments);
    };

    proto.setRequestHeader = function (name, value) {
      if (!this.__scaAuthHeaders) {
        this.__scaAuthHeaders = {};
      }
      this.__scaAuthHeaders[name] = value;
      return originalSetRequestHeader.apply(this, arguments);
    };

    proto.send = function () {
      captureHeaders(this.__scaAuthHeaders, 'page.xhr');
      return originalSend.apply(this, arguments);
    };

    proto.__scaAuthWrapped = true;
  }

  patchFetch();
  patchXMLHttpRequest();
  scheduleCryptoPatches();
  emitCurrentSnapshot();
  window.setTimeout(emitCurrentSnapshot, 0);
  window.setTimeout(emitCurrentSnapshot, 300);
  window.addEventListener('load', function () {
    emitCurrentSnapshot();
  });
})();
