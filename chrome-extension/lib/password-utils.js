(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.SCAPasswordUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function normalizeText(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  function looksLikeEncryptedPassword(value) {
    const text = normalizeText(value);
    return text.length >= 64 && text.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(text);
  }

  function resolvePasswordValue(options) {
    const input = options && typeof options === 'object' ? options : {};
    const encryptedPasswordOverride = normalizeText(input.encryptedPasswordOverride);

    if (encryptedPasswordOverride) {
      if (!looksLikeEncryptedPassword(encryptedPasswordOverride)) {
        throw new Error('固定加密密码格式不正确，应为十六进制密文');
      }
      return {
        value: encryptedPasswordOverride,
        mode: 'override',
      };
    }

    if (input.encryptor && typeof input.encryptor.encrypt === 'function') {
      return {
        value: input.encryptor.encrypt(normalizeText(input.defaultPassword)),
        mode: 'encrypted',
      };
    }

    return {
      value: normalizeText(input.defaultPassword),
      mode: 'plain',
    };
  }

  return {
    looksLikeEncryptedPassword: looksLikeEncryptedPassword,
    resolvePasswordValue: resolvePasswordValue,
  };
});
