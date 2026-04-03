/**
 * 轻量级 RSA PKCS#1 v1.5 加密（纯 JS + BigInt）
 * 与后端 PyCryptodome / 前端 JSEncrypt 完全兼容
 */
class RSAEncryptor {
  constructor() { this.n = null; this.e = null; this.keySize = 0; }

  /** 设置 PEM 或纯 Base64 格式的公钥 */
  setPublicKey(pem) {
    let b64 = pem.trim()
      .replace(/-----BEGIN [^-]+-----/g, '')
      .replace(/-----END [^-]+-----/g, '')
      .replace(/\s+/g, '');
    const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const { n, e, keySize } = this._parseSPKI(der);
    this.n = n; this.e = e; this.keySize = keySize;
  }

  /** 加密明文，返回十六进制字符串 */
  encrypt(plaintext) {
    if (!this.n) throw new Error('Public key not set');
    const msg = new TextEncoder().encode(plaintext);
    const padded = this._pkcs1Pad(msg, this.keySize);
    const m = this._bytes2bi(padded);
    const c = this._modpow(m, this.e, this.n);
    return c.toString(16).padStart(this.keySize * 2, '0');
  }

  /* ---- ASN.1 DER 解析 ---- */
  _readTLV(buf, off) {
    const tag = buf[off];
    let len = buf[off + 1], hdr = 2;
    if (len & 0x80) {
      const nb = len & 0x7f; len = 0;
      for (let i = 0; i < nb; i++) len = len * 256 + buf[off + 2 + i];
      hdr = 2 + nb;
    }
    return { tag, hdr, len, cOff: off + hdr, total: hdr + len };
  }

  _parseSPKI(der) {
    let o = 0;
    let t = this._readTLV(der, o); o = t.cOff;           // outer SEQUENCE
    t = this._readTLV(der, o); o = t.cOff + t.len;       // AlgorithmIdentifier (skip)
    t = this._readTLV(der, o); o = t.cOff + 1;           // BIT STRING + unused-bits byte
    t = this._readTLV(der, o); o = t.cOff;               // inner SEQUENCE

    // modulus
    t = this._readTLV(der, o);
    let nBytes = der.slice(t.cOff, t.cOff + t.len);
    if (nBytes[0] === 0) nBytes = nBytes.slice(1);        // strip sign byte
    o = t.cOff + t.len;

    // exponent
    t = this._readTLV(der, o);
    const eBytes = der.slice(t.cOff, t.cOff + t.len);

    return { n: this._bytes2bi(nBytes), e: this._bytes2bi(eBytes), keySize: nBytes.length };
  }

  /* ---- PKCS#1 v1.5 填充 ---- */
  _pkcs1Pad(msg, kLen) {
    const psLen = kLen - msg.length - 3;
    if (psLen < 8) throw new Error('Message too long');
    const out = new Uint8Array(kLen);
    out[0] = 0x00; out[1] = 0x02;
    const ps = crypto.getRandomValues(new Uint8Array(psLen));
    for (let i = 0; i < psLen; i++) {
      while (ps[i] === 0) ps[i] = crypto.getRandomValues(new Uint8Array(1))[0];
      out[i + 2] = ps[i];
    }
    out[psLen + 2] = 0x00;
    out.set(msg, psLen + 3);
    return out;
  }

  /* ---- BigInt 工具 ---- */
  _bytes2bi(bytes) {
    let h = ''; for (const b of bytes) h += b.toString(16).padStart(2, '0');
    return BigInt('0x' + (h || '0'));
  }
  _modpow(base, exp, mod) {
    let r = 1n; base %= mod;
    while (exp > 0n) {
      if (exp & 1n) r = r * base % mod;
      exp >>= 1n; base = base * base % mod;
    }
    return r;
  }
}
