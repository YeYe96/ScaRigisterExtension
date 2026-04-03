(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./sm2.js'));
    return;
  }
  root.SCASM2Utils = factory(root.sm2);
})(typeof self !== 'undefined' ? self : globalThis, function (sm2Lib) {
  'use strict';

  const DEFAULT_CIPHER_MODE = 1;

  function normalizeText(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  function looksLikeSm2PublicKey(value) {
    const text = normalizeText(value);
    return /^(04)?[0-9a-fA-F]{128}$/.test(text);
  }

  function normalizeSm2PublicKey(value) {
    const text = normalizeText(value);
    if (!text) {
      return '';
    }
    return text.startsWith('04') ? text : `04${text}`;
  }

  function getSm2Lib() {
    if (!sm2Lib || typeof sm2Lib.doEncrypt !== 'function') {
      throw new Error('sm2.js 未加载，无法执行 SM2 加密');
    }
    return sm2Lib;
  }

  function encryptPassword(plainPassword, publicKey) {
    const normalizedPassword = normalizeText(plainPassword);
    const normalizedPublicKey = normalizeSm2PublicKey(publicKey);
    if (!looksLikeSm2PublicKey(normalizedPublicKey)) {
      throw new Error('SM2 公钥格式不正确');
    }
    return getSm2Lib().doEncrypt(normalizedPassword, normalizedPublicKey, DEFAULT_CIPHER_MODE);
  }

  function createSm2Encryptor(publicKey) {
    const normalizedPublicKey = normalizeSm2PublicKey(publicKey);
    if (!looksLikeSm2PublicKey(normalizedPublicKey)) {
      throw new Error('SM2 公钥格式不正确');
    }
    return {
      encrypt(plainPassword) {
        return encryptPassword(plainPassword, normalizedPublicKey);
      },
    };
  }

  return {
    DEFAULT_CIPHER_MODE: DEFAULT_CIPHER_MODE,
    createSm2Encryptor: createSm2Encryptor,
    encryptPassword: encryptPassword,
    looksLikeSm2PublicKey: looksLikeSm2PublicKey,
    normalizeSm2PublicKey: normalizeSm2PublicKey,
  };
});
