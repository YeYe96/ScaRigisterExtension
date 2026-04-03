// SCA 用户管理助手 - Content Script
// 注入到 SCA 平台页面，自动提取认证信息并执行 SM2 加密

(function () {
  'use strict';

  const BATCH_STATE_KEY = 'scaBatchCreateState';
  const LOG_PREFIX = '[SCA Batch Create]';
  const PAGE_BRIDGE_SOURCE = 'sca-page-auth-bridge';
  const PAGE_BRIDGE_SNAPSHOT = 'SCA_AUTH_SNAPSHOT';
  let currentBatchState = null;
  let pageContextAuthInfo = {
    token: '',
    tokenKey: '',
    rsaKey: '',
    rsaKeySource: '',
  };
  let pageBridgeInjected = false;

  function logInfo(message, extra) {
    if (extra === undefined) {
      console.info(LOG_PREFIX, message);
      return;
    }
    console.info(LOG_PREFIX, message, extra);
  }

  function logError(message, extra) {
    if (extra === undefined) {
      console.error(LOG_PREFIX, message);
      return;
    }
    console.error(LOG_PREFIX, message, extra);
  }

  function createDetailedError(message, details) {
    const error = new Error(message);
    error.details = details || {};
    return error;
  }

  function serializeResponseSnippet(body) {
    if (body === null || body === undefined) {
      return '';
    }

    let text = '';
    if (typeof body === 'string') {
      text = body;
    } else {
      try {
        text = JSON.stringify(body);
      } catch (_error) {
        text = String(body);
      }
    }

    if (typeof SCADiagnosticsUtils === 'object' && typeof SCADiagnosticsUtils.truncateText === 'function') {
      return SCADiagnosticsUtils.truncateText(text, 220);
    }
    return text.length > 220 ? text.slice(0, 217) + '...' : text;
  }

  function buildPayloadPreview(payload) {
    return {
      username: payload.username,
      realName: payload.realName,
      email: payload.email,
      phone: payload.phone,
      roleId: payload.roleId,
      departmentId: payload.departmentId,
      status: payload.status,
      projectMemberList: Array.isArray(payload.projectMemberList) ? payload.projectMemberList.slice() : [],
    };
  }

  function getAuthUtils() {
    return typeof SCAAuthUtils === 'object' ? SCAAuthUtils : null;
  }

  function getRequestUtils() {
    return typeof SCARequestUtils === 'object' ? SCARequestUtils : null;
  }

  function getBatchUtils() {
    return typeof SCABatchUtils === 'object' ? SCABatchUtils : null;
  }

  function getPasswordUtils() {
    return typeof SCAPasswordUtils === 'object' ? SCAPasswordUtils : null;
  }

  function getSm2Utils() {
    return typeof SCASM2Utils === 'object' ? SCASM2Utils : null;
  }

  function getDefaultCreateUserPath() {
    const requestUtils = getRequestUtils();
    if (requestUtils && requestUtils.DEFAULT_CREATE_USER_PATH) {
      return requestUtils.DEFAULT_CREATE_USER_PATH;
    }
    return '/sca/api-v1/user/add';
  }

  function normalizeCreateUserPath(value) {
    const requestUtils = getRequestUtils();
    if (requestUtils && typeof requestUtils.normalizeApiPath === 'function') {
      return requestUtils.normalizeApiPath(value, getDefaultCreateUserPath());
    }

    const raw = String(value || '').trim();
    if (!raw) {
      return getDefaultCreateUserPath();
    }
    return raw.startsWith('/') ? raw : `/${raw}`;
  }

  function buildCreateUserUrl(baseUrl, createUserPath) {
    const requestUtils = getRequestUtils();
    if (requestUtils && typeof requestUtils.buildApiUrl === 'function') {
      return requestUtils.buildApiUrl(baseUrl, createUserPath);
    }
    const origin = String(baseUrl || '').replace(/\/+$/, '');
    return `${origin}${normalizeCreateUserPath(createUserPath)}`;
  }

  function flattenDepartmentOptions(nodes) {
    const batchUtils = getBatchUtils();
    if (batchUtils && typeof batchUtils.flattenDepartmentTree === 'function') {
      return batchUtils.flattenDepartmentTree(nodes);
    }
    return [];
  }

  function normalizeProjectOption(record) {
    if (!record || typeof record !== 'object') {
      return null;
    }
    const id = Number(record.id);
    const name = String(record.name || '').trim();
    if (!Number.isFinite(id) || !name) {
      return null;
    }
    const departmentName = String(record.departmentName || '').trim();
    return {
      id: id,
      name: name,
      label: departmentName ? `${name}（${departmentName}）` : name,
      departmentName: departmentName,
    };
  }

  function mergeDetectedAuthInfo() {
    const authUtils = getAuthUtils();
    if (authUtils && typeof authUtils.mergeAuthInfo === 'function') {
      return authUtils.mergeAuthInfo.apply(null, arguments);
    }

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
      if (!merged.token && source.token) {
        merged.token = String(source.token);
        merged.tokenKey = String(source.tokenKey || '');
      }
      if (!merged.rsaKey && source.rsaKey) {
        merged.rsaKey = String(source.rsaKey);
        merged.rsaKeySource = String(source.rsaKeySource || '');
      }
    }

    return merged;
  }

  /** 从 localStorage 中查找认证 Token */
  function cleanTokenValue(value) {
    const authUtils = getAuthUtils();
    if (authUtils && typeof authUtils.cleanTokenValue === 'function') {
      return authUtils.cleanTokenValue(value);
    }
    return String(value || '')
      .replace(/^["']|["']$/g, '')
      .replace(/^Bearer\s+/i, '')
      .trim();
  }

  function getStorageSources() {
    return [
      { name: 'localStorage', storage: localStorage },
      { name: 'sessionStorage', storage: sessionStorage },
    ];
  }

  function getAuthToken() {
    const tokenKeys = [
      'token', 'access_token', 'userToken', 'user_token',
      'Authorization', 'authToken', 'auth_token',
      'OpenApiUserToken', 'openApiUserToken'
    ];
    for (const source of getStorageSources()) {
      for (const key of tokenKeys) {
        const val = source.storage.getItem(key);
        if (val && val.length > 10) {
          return { key: `${source.name}.${key}`, value: cleanTokenValue(val) };
        }
      }
    }

    // 检查 JSON 形式存储的 token
    const jsonKeys = ['userInfo', 'user', 'auth', 'session', 'loginInfo'];
    for (const source of getStorageSources()) {
      for (const key of jsonKeys) {
        const val = source.storage.getItem(key);
        if (!val) continue;
        try {
          const obj = JSON.parse(val);
          for (const tk of ['token', 'access_token', 'accessToken']) {
            if (obj[tk]) {
              return {
                key: `${source.name}.${key}.${tk}`,
                value: cleanTokenValue(obj[tk]),
              };
            }
          }
        } catch (e) { /* not JSON */ }
      }
    }
    return null;
  }

  /** 尝试从页面中提取 RSA 公钥 */
  function getRSAKeyInfo() {
    const lsKeys = ['publicKey', 'rsaPublicKey', 'rsa_public_key', 'pubKey', 'public_key'];

    // 1. localStorage / sessionStorage
    for (const source of getStorageSources()) {
      for (const key of lsKeys) {
        const val = source.storage.getItem(key);
        if (val && val.length > 50) {
          return {
            value: val,
            source: `${source.name}.${key}`,
          };
        }
      }
    }

    // 2. 内联 <script> 标签
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      const c = script.textContent || '';
      const pem = c.match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/);
      if (pem) {
        return {
          value: pem[0],
          source: 'inlineScript.publicKeyPem',
        };
      }
      const b64 = c.match(/(?:publicKey|pubKey|rsaKey|public_key|rsaPublicKey)\s*[=:]\s*['"`]([A-Za-z0-9+/=\n\r\s]{100,})['"`]/i);
      if (b64) {
        return {
          value: b64[1].trim(),
          source: 'inlineScript.publicKeyBase64',
        };
      }
    }
    return {
      value: '',
      source: '',
    };
  }

  /** 列出所有 localStorage 键（调试用） */
  function getAllKeys() {
    const out = [];
    for (const source of getStorageSources()) {
      for (let i = 0; i < source.storage.length; i++) {
        const k = source.storage.key(i);
        const v = source.storage.getItem(k);
        out.push({
          key: `${source.name}.${k}`,
          len: v?.length || 0,
          preview: v?.substring(0, 80) || '',
        });
      }
    }
    return out;
  }

  function getCookieKeys() {
    const raw = String(document.cookie || '').trim();
    if (!raw) {
      return [];
    }

    return raw
      .split(';')
      .map(function (item) {
        return item.split('=')[0].trim();
      })
      .filter(function (item) {
        return item.length > 0;
      });
  }

  function updatePageContextAuthInfo(snapshot) {
    const nextAuthInfo = mergeDetectedAuthInfo(snapshot, pageContextAuthInfo);
    const changed = nextAuthInfo.token !== pageContextAuthInfo.token
      || nextAuthInfo.tokenKey !== pageContextAuthInfo.tokenKey
      || nextAuthInfo.rsaKey !== pageContextAuthInfo.rsaKey
      || nextAuthInfo.rsaKeySource !== pageContextAuthInfo.rsaKeySource;

    pageContextAuthInfo = nextAuthInfo;

    if (changed && (pageContextAuthInfo.token || pageContextAuthInfo.rsaKey)) {
      logInfo('Captured page-context auth info', {
        tokenKey: pageContextAuthInfo.tokenKey || '',
        rsaKeySource: pageContextAuthInfo.rsaKeySource || '',
      });
    }
  }

  function handlePageBridgeMessage(event) {
    if (event.source !== window) {
      return;
    }

    const message = event.data;
    if (!message || message.source !== PAGE_BRIDGE_SOURCE || message.type !== PAGE_BRIDGE_SNAPSHOT) {
      return;
    }

    if (message.payload && typeof message.payload === 'object') {
      updatePageContextAuthInfo(message.payload);
    }
  }

  function injectPageScript(relativePath, callback) {
    if (!document || typeof document.createElement !== 'function') {
      return false;
    }
    if (!chrome.runtime || typeof chrome.runtime.getURL !== 'function') {
      return false;
    }

    const parent = document.head || document.documentElement || document.body;
    if (!parent) {
      return false;
    }

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(relativePath);
    script.async = false;
    script.onload = function () {
      script.remove();
      if (typeof callback === 'function') {
        callback();
      }
    };
    script.onerror = function () {
      logError(`Failed to inject page script: ${relativePath}`);
      script.remove();
    };
    parent.appendChild(script);
    return true;
  }

  function ensurePageBridgeInjected() {
    if (pageBridgeInjected) {
      return;
    }
    if (!document || typeof document.createElement !== 'function') {
      return;
    }
    if (!chrome.runtime || typeof chrome.runtime.getURL !== 'function') {
      return;
    }
    if (!(document.head || document.documentElement || document.body)) {
      if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        window.setTimeout(ensurePageBridgeInjected, 0);
      }
      return;
    }
    const injected = injectPageScript('lib/auth-utils.js', function () {
      injectPageScript('page-bridge.js');
    });
    if (!injected) {
      return;
    }
    pageBridgeInjected = true;
  }

  function getAuthInfoSnapshot() {
    const tokenInfo = getAuthToken();
    const rsaKeyInfo = getRSAKeyInfo();
    const sm2Utils = getSm2Utils();
    const sm2PublicKey = sm2Utils && typeof sm2Utils.normalizeSm2PublicKey === 'function'
      ? sm2Utils.normalizeSm2PublicKey('')
      : '';
    const mergedAuthInfo = mergeDetectedAuthInfo(pageContextAuthInfo, {
      token: tokenInfo?.value || '',
      tokenKey: tokenInfo?.key || '',
      rsaKey: rsaKeyInfo?.value || '',
      rsaKeySource: rsaKeyInfo?.source || '',
    });
    return {
      token: mergedAuthInfo.token || '',
      tokenKey: mergedAuthInfo.tokenKey || '',
      baseUrl: window.location.origin,
      hostname: window.location.hostname,
      rsaKey: mergedAuthInfo.rsaKey || '',
      rsaKeySource: mergedAuthInfo.rsaKeySource || '',
      cipherType: 'SM2',
      sm2PublicKey: sm2PublicKey,
      sm2PublicKeySource: sm2PublicKey ? 'builtin-default' : '',
      createUserPath: getDefaultCreateUserPath(),
      allKeys: getAllKeys(),
      cookieKeys: getCookieKeys(),
    };
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function storageSet(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, function () {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  function storageGet(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(key, function (items) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(items);
      });
    });
  }

  function storageRemove(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(key, function () {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  function emitBatchState(state) {
    state.updatedAt = new Date().toISOString();
    currentBatchState = state;
    storageSet({ [BATCH_STATE_KEY]: state }).catch(() => {});
    try {
      chrome.runtime.sendMessage({ type: 'BATCH_STATE_UPDATE', state: state });
    } catch (_err) {
      // popup 未打开时这里报错不影响任务执行
    }
  }

  function extractResponseMessage(body) {
    if (!body) {
      return '空响应';
    }
    if (typeof body === 'string') {
      return body;
    }
    return body.msg || body.message || body.error || JSON.stringify(body);
  }

  function extractApiCode(body) {
    if (!body || typeof body !== 'object') {
      return '';
    }
    if (body.code === null || body.code === undefined) {
      return '';
    }
    return body.code;
  }

  function isCreateUserSuccess(statusCode, body) {
    if (statusCode !== 200 || !body || typeof body !== 'object') {
      return false;
    }
    return [200, 0, '200', '0'].includes(body.code) || body.success === true;
  }

  function buildFailureHint(details) {
    const phase = String(details.phase || '');
    const httpStatus = Number(details.httpStatus || 0);
    const apiMessage = String(details.apiMessage || details.message || '');
    const requestPath = String(details.requestPath || details.createUserPath || '').trim();

    if (phase === 'preflight') {
      return '先确认当前标签页是已登录的 SCA 页面，再点一次“刷新认证”。';
    }
    if (phase === 'prepare') {
      return '重点看 SM2 公钥、默认密码和部门映射，必要时在页面 Console 里搜 [SCA Batch Create]。';
    }
    if (httpStatus === 401 || httpStatus === 403) {
      return '大概率是登录态或权限问题。先确认页面没掉登录，再看 Cookie 和 Authorization 头。';
    }
    if (httpStatus === 404) {
      return `当前创建接口可能不存在。先核对路径配置是否和站点版本一致，再去 Network 里找真实的用户新增接口。\n当前路径: ${requestPath || '未记录'}`;
    }
    if (String(details.apiCode || '') === '410' || /请求资源不存在/.test(apiMessage)) {
      return `这次更像是请求体里的资源 ID 不存在或不匹配，不是单纯的路由 404。优先核对 roleId、departmentId、projectMemberList，再对比页面手工创建成功请求的 Request Payload。\n当前路径: ${requestPath || '未记录'}`;
    }
    if (httpStatus >= 500) {
      return `服务端报错，先打开页面 DevTools 的 Network，检查 ${requestPath || '当前创建接口'} 的响应体。`;
    }
    if (/邮箱/.test(apiMessage)) {
      return '检查模板里的邮箱是否重复，或是否已被系统占用。';
    }
    if (/用户名/.test(apiMessage) || /账号/.test(apiMessage)) {
      return '检查用户名是否重复，或是否和已有系统账号身份冲突。';
    }
    if (/部门/.test(apiMessage)) {
      return '优先核对 departmentId 映射是否填对。';
    }
    if (/密码/.test(apiMessage)) {
      return '当前请求里的 password 很可能还是明文，或固定密文格式不对。优先检查 SM2 公钥，或直接填“固定加密密码”。';
    }
    return `打开 SCA 页面 DevTools，先看 Console 里的 [SCA Batch Create] 日志，再看 Network 里的 ${requestPath || '当前创建接口'}。`;
  }

  function createFailedResult(user, details) {
    const result = {
      rowIndex: user && user.rowIndex ? user.rowIndex : '',
      username: user && user.username ? user.username : '',
      status: 'failed',
      message: String(details.message || details.apiMessage || '创建失败'),
      phase: String(details.phase || ''),
      httpStatus: details.httpStatus || 0,
      apiCode: details.apiCode !== undefined ? details.apiCode : '',
      apiMessage: String(details.apiMessage || ''),
      requestPath: String(details.requestPath || details.createUserPath || ''),
      responseSnippet: serializeResponseSnippet(details.responseSnippet || ''),
      hint: String(details.hint || buildFailureHint(details)),
      payloadPreview: details.payloadPreview || null,
    };
    return result;
  }

  function createEncryptor(sm2PublicKey) {
    const sm2Utils = getSm2Utils();
    if (!sm2Utils || typeof sm2Utils.createSm2Encryptor !== 'function') {
      throw new Error('SM2 加密模块未加载，无法加密默认密码');
    }
    return sm2Utils.createSm2Encryptor(sm2PublicKey);
  }

  async function createSingleUser(baseUrl, token, payload, createUserPath) {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers.OpenApiUserToken = token;
      headers.Authorization = `Bearer ${token}`;
    }

    const requestPath = normalizeCreateUserPath(createUserPath);
    const requestUrl = buildCreateUserUrl(baseUrl, requestPath);

    const response = await fetch(requestUrl, {
      method: 'POST',
      credentials: 'include',
      headers: headers,
      body: JSON.stringify(payload),
    });

    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    return {
      statusCode: response.status,
      body: body,
      requestPath: requestPath,
      requestUrl: requestUrl,
    };
  }

  async function fetchDepartmentOptions(baseUrl, token) {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers.OpenApiUserToken = token;
      headers.Authorization = `Bearer ${token}`;
    }

    const requestPath = '/sca/api-v1/system/department/tree';
    const requestUrl = buildCreateUserUrl(baseUrl, requestPath);
    const response = await fetch(requestUrl, {
      method: 'GET',
      credentials: 'include',
      headers: headers,
    });

    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (response.status !== 200) {
      throw createDetailedError('部门列表请求失败', {
        phase: 'department-options',
        httpStatus: response.status,
        responseSnippet: body,
        requestPath: requestPath,
      });
    }

    if (!body || typeof body !== 'object' || ![0, '0', 200, '200'].includes(body.code)) {
      throw createDetailedError('部门列表接口返回失败', {
        phase: 'department-options',
        httpStatus: response.status,
        apiCode: body && body.code,
        apiMessage: extractResponseMessage(body),
        responseSnippet: body,
        requestPath: requestPath,
      });
    }

    return flattenDepartmentOptions(body.data);
  }

  async function fetchProjectCandidates(baseUrl, token, projectName) {
    const queryText = String(projectName || '').trim();
    if (!queryText) {
      return [];
    }

    const headers = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers.OpenApiUserToken = token;
      headers.Authorization = `Bearer ${token}`;
    }

    const requestPath = '/sca/api-v1/project/list';
    const requestUrl = buildCreateUserUrl(baseUrl, requestPath);
    const seenIds = new Set();
    const options = [];
    let pageNum = 1;
    let totalPages = 1;

    do {
      const response = await fetch(requestUrl, {
        method: 'POST',
        credentials: 'include',
        headers: headers,
        body: JSON.stringify({
          pageNum: pageNum,
          pageSize: 100,
          nameOrDescription: queryText,
        }),
      });

      const contentType = response.headers.get('content-type') || '';
      const body = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

      if (response.status !== 200) {
        throw createDetailedError('项目列表请求失败', {
          phase: 'project-options',
          httpStatus: response.status,
          responseSnippet: body,
          requestPath: requestPath,
        });
      }

      if (!body || typeof body !== 'object' || ![0, '0', 200, '200'].includes(body.code)) {
        throw createDetailedError('项目列表接口返回失败', {
          phase: 'project-options',
          httpStatus: response.status,
          apiCode: body && body.code,
          apiMessage: extractResponseMessage(body),
          responseSnippet: body,
          requestPath: requestPath,
        });
      }

      const data = body.data && typeof body.data === 'object' ? body.data : {};
      const records = Array.isArray(data.records) ? data.records : [];
      records.forEach(function (record) {
        const option = normalizeProjectOption(record);
        if (!option || seenIds.has(option.id)) {
          return;
        }
        seenIds.add(option.id);
        options.push(option);
      });

      totalPages = Number(data.pages || 1);
      pageNum += 1;
    } while (pageNum <= totalPages);

    return options;
  }

  async function fetchProjectOptions(baseUrl, token, projectNames) {
    const names = Array.isArray(projectNames) ? projectNames : [];
    const normalizedNames = Array.from(new Set(names.map(function (name) {
      return String(name || '').trim();
    }).filter(function (name) {
      return name.length > 0;
    })));

    const optionsByName = {};
    for (const name of normalizedNames) {
      optionsByName[name] = await fetchProjectCandidates(baseUrl, token, name);
    }
    return optionsByName;
  }

  async function runBatchCreate(request) {
    if (currentBatchState && currentBatchState.status === 'running') {
      throw createDetailedError('已有批量创建任务正在执行，请稍后再试', {
        phase: 'preflight',
      });
    }

    const authInfo = getAuthInfoSnapshot();
    const token = request.token || authInfo.token;
    if (!token) {
      throw createDetailedError('当前页面未检测到可用 Token，请先登录 SCA 平台', {
        phase: 'preflight',
        hint: '先确认当前 SCA 页面还在登录态，再点一次“刷新认证”。',
      });
    }

    const users = Array.isArray(request.users) ? request.users : [];
    if (users.length === 0) {
      throw createDetailedError('没有可创建的用户数据', {
        phase: 'preflight',
        hint: '先导入 Excel 模板，并确认至少解析出 1 条有效用户。',
      });
    }

    const options = {
      defaultPassword: String(request.defaultPassword || ''),
      defaultRoleId: Number(request.defaultRoleId || 1),
      defaultDepartmentId: Number(request.defaultDepartmentId || 2),
      departmentMap: request.departmentMap || {},
      createUserPath: normalizeCreateUserPath(request.createUserPath || authInfo.createUserPath || ''),
      encryptedPasswordOverride: String(request.encryptedPasswordOverride || '').trim(),
      sm2PublicKey: String(request.sm2PublicKey || authInfo.sm2PublicKey || '').trim(),
    };
    if (!options.defaultPassword && !options.encryptedPasswordOverride) {
      throw createDetailedError('默认密码为空，请先在插件里填写默认密码，或提供固定加密密码', {
        phase: 'preflight',
        hint: '公开版仓库不会内置默认密码。先在 popup 里填写默认密码，或直接粘贴成功请求里的固定密文。',
      });
    }
    const passwordUtils = getPasswordUtils();
    if (options.encryptedPasswordOverride
      && passwordUtils
      && typeof passwordUtils.looksLikeEncryptedPassword === 'function'
      && !passwordUtils.looksLikeEncryptedPassword(options.encryptedPasswordOverride)) {
      throw createDetailedError('固定加密密码格式不正确，应为十六进制密文', {
        phase: 'preflight',
        hint: '从页面成功请求的 Request Payload 里复制完整的 password 字段，不要带引号或空格。',
      });
    }

    let encryptor = null;
    try {
      encryptor = createEncryptor(options.sm2PublicKey);
    } catch (error) {
      throw createDetailedError(error instanceof Error ? error.message : String(error), {
        phase: 'prepare',
        hint: 'SM2 初始化失败。先确认共享公钥配置正确，再看 manifest 是否已加载 sm2.js / sm2-utils.js。',
      });
    }

    const state = {
      status: 'running',
      phase: 'preflight',
      startedAt: new Date().toISOString(),
      finishedAt: '',
      hostname: authInfo.hostname,
      baseUrl: authInfo.baseUrl,
      createUserPath: options.createUserPath,
      total: users.length,
      currentIndex: 0,
      currentUsername: '',
      successCount: 0,
      failCount: 0,
      results: [],
      lastError: null,
    };

    logInfo('Batch create started', {
      baseUrl: authInfo.baseUrl,
      total: users.length,
      cipherType: 'SM2',
      hasSm2PublicKey: Boolean(options.sm2PublicKey),
      createUserPath: options.createUserPath,
    });
    emitBatchState(state);

    for (let index = 0; index < users.length; index += 1) {
      const user = users[index];
      state.currentIndex = index + 1;
      state.currentUsername = user.username || '';
      state.phase = 'prepare';
      emitBatchState(state);

      try {
        const runtimePasswordUtils = getPasswordUtils();
        const passwordResult = runtimePasswordUtils && typeof runtimePasswordUtils.resolvePasswordValue === 'function'
          ? runtimePasswordUtils.resolvePasswordValue({
            defaultPassword: options.defaultPassword,
            encryptedPasswordOverride: options.encryptedPasswordOverride,
            encryptor: encryptor,
          })
          : {
            value: encryptor ? encryptor.encrypt(options.defaultPassword) : options.defaultPassword,
            mode: encryptor ? 'encrypted' : 'plain',
          };
        const encryptedPassword = passwordResult.value;
        if (!encryptedPassword) {
          throw createDetailedError('密码加密结果为空', {
            phase: 'prepare',
            hint: 'SM2 公钥可能不完整，或默认密码包含当前库不支持的字符。',
          });
        }

        const payload = SCABatchUtils.buildCreateUserPayload(user, encryptedPassword, options);
        const payloadPreview = buildPayloadPreview(payload);
        state.phase = 'request';
        emitBatchState(state);

        logInfo('Sending create request', {
          username: user.username,
          rowIndex: user.rowIndex,
          passwordMode: passwordResult.mode,
          payloadPreview: payloadPreview,
        });
        const result = await createSingleUser(authInfo.baseUrl, token, payload, options.createUserPath);
        const apiCode = extractApiCode(result.body);
        const apiMessage = extractResponseMessage(result.body);

        if (isCreateUserSuccess(result.statusCode, result.body)) {
          state.successCount += 1;
          state.results.push({
            rowIndex: user.rowIndex || '',
            username: user.username,
            status: 'success',
            message: '创建成功',
            phase: 'response',
            httpStatus: result.statusCode,
            apiCode: apiCode,
            apiMessage: apiMessage,
            requestPath: result.requestPath,
          });
        } else {
          const failedResult = createFailedResult(user, {
            message: result.statusCode !== 200 ? 'HTTP 请求失败' : '接口返回失败',
            phase: 'response',
            httpStatus: result.statusCode,
            apiCode: apiCode,
            apiMessage: apiMessage,
            requestPath: result.requestPath,
            responseSnippet: result.body,
            payloadPreview: payloadPreview,
          });
          state.failCount += 1;
          state.lastError = failedResult;
          state.results.push(failedResult);
          logError('Create user failed', failedResult);
        }
      } catch (error) {
        const errorDetails = error && error.details ? error.details : {};
        const failedResult = createFailedResult(user, {
          message: error instanceof Error ? error.message : String(error),
          phase: errorDetails.phase || state.phase || 'request',
          httpStatus: errorDetails.httpStatus || 0,
          apiCode: errorDetails.apiCode,
          apiMessage: errorDetails.apiMessage || '',
          requestPath: errorDetails.requestPath || options.createUserPath,
          responseSnippet: errorDetails.responseSnippet || '',
          hint: errorDetails.hint || '',
          payloadPreview: errorDetails.payloadPreview || null,
        });
        state.failCount += 1;
        state.lastError = failedResult;
        state.results.push(failedResult);
        logError('Create user exception', failedResult);
      }

      emitBatchState(state);
      await delay(300);
    }

    state.status = 'completed';
    state.phase = 'completed';
    state.finishedAt = new Date().toISOString();
    state.currentUsername = '';
    emitBatchState(state);
    logInfo('Batch create finished', {
      total: state.total,
      successCount: state.successCount,
      failCount: state.failCount,
      lastError: state.lastError,
    });
    return state;
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('message', handlePageBridgeMessage);
  }
  ensurePageBridgeInjected();

  // 监听来自 popup 的消息
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'GET_AUTH_INFO') {
      sendResponse(getAuthInfoSnapshot());
      return true;
    }

    if (msg.type === 'GET_BATCH_STATE') {
      storageGet(BATCH_STATE_KEY)
        .then((items) => {
          sendResponse({
            state: items[BATCH_STATE_KEY] || currentBatchState || null,
          });
        })
        .catch((error) => {
          sendResponse({
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true;
    }

    if (msg.type === 'GET_DEPARTMENT_OPTIONS') {
      const authInfo = getAuthInfoSnapshot();
      const token = msg.token || authInfo.token;
      fetchDepartmentOptions(authInfo.baseUrl, token)
        .then((options) => {
          sendResponse({
            ok: true,
            options: options,
          });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true;
    }

    if (msg.type === 'GET_PROJECT_OPTIONS') {
      const authInfo = getAuthInfoSnapshot();
      const token = msg.token || authInfo.token;
      fetchProjectOptions(authInfo.baseUrl, token, msg.projectNames)
        .then((optionsByName) => {
          sendResponse({
            ok: true,
            optionsByName: optionsByName,
          });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true;
    }

    if (msg.type === 'RESET_BATCH_STATE') {
      currentBatchState = null;
      storageRemove(BATCH_STATE_KEY)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true;
    }

    if (msg.type === 'START_BATCH_CREATE') {
      runBatchCreate(msg)
        .then((state) => {
          sendResponse({ ok: true, state: state });
        })
        .catch((error) => {
          const errorDetails = error && error.details ? error.details : {};
          const failedResult = createFailedResult(null, {
            message: error instanceof Error ? error.message : String(error),
            phase: errorDetails.phase || 'preflight',
            httpStatus: errorDetails.httpStatus || 0,
            apiCode: errorDetails.apiCode,
            apiMessage: errorDetails.apiMessage || '',
            requestPath: errorDetails.requestPath || normalizeCreateUserPath(msg.createUserPath || ''),
            responseSnippet: errorDetails.responseSnippet || '',
            hint: errorDetails.hint || '',
          });
          const failedState = {
            status: 'failed',
            phase: failedResult.phase || 'preflight',
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            hostname: window.location.hostname,
            baseUrl: window.location.origin,
            createUserPath: normalizeCreateUserPath(msg.createUserPath || ''),
            total: Array.isArray(msg.users) ? msg.users.length : 0,
            currentIndex: 0,
            currentUsername: '',
            successCount: 0,
            failCount: 0,
            results: [],
            lastError: failedResult,
            error: failedResult.message,
            errorDetails: failedResult,
          };
          logError('Batch create failed before completion', failedState);
          emitBatchState(failedState);
          sendResponse({ ok: false, error: failedState.error, state: failedState });
        });
      return true;
    }

    return false;
  });
})();
