(function () {
  'use strict';

  const BATCH_STATE_KEY = 'scaBatchCreateState';
  const DEPARTMENT_MAP_KEY = 'scaBatchDepartmentMap';
  const PROJECT_MAP_KEY = 'scaBatchProjectMap';
  const CREATE_USER_PATH_KEY = 'scaBatchCreateUserPath';
  const ENCRYPTED_PASSWORD_OVERRIDE_KEY = 'scaBatchEncryptedPasswordOverride';
  const DEFAULT_PASSWORD_KEY = 'scaBatchDefaultPassword';
  const SM2_PUBLIC_KEY_KEY = 'scaBatchSm2PublicKey';

  const appState = {
    activeTabId: null,
    activeTabUrl: '',
    authInfo: null,
    parsed: null,
    batchState: null,
    departmentOptions: [],
    departmentOptionsError: '',
    projectOptionsByName: {},
    projectOptionsError: '',
    storedDepartmentMap: {},
    storedProjectMap: {},
    storedCreateUserPath: '',
    storedEncryptedPasswordOverride: '',
    storedDefaultPassword: '',
    storedSm2PublicKey: '',
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMultilineHtml(value) {
    return escapeHtml(value).replace(/\n/g, '<br>');
  }

  function friendlyChromeError(message, context) {
    if (typeof SCADiagnosticsUtils === 'object' && typeof SCADiagnosticsUtils.toFriendlyChromeError === 'function') {
      return SCADiagnosticsUtils.toFriendlyChromeError(message, { context: context || 'tab' });
    }
    return String(message || '未知扩展错误');
  }

  function isProbablySCAPageUrl(url) {
    return /^https?:\/\//i.test(String(url || ''));
  }

  function getLastFailedResult() {
    if (appState.batchState?.lastError) {
      return appState.batchState.lastError;
    }
    const results = appState.batchState?.results || [];
    for (let index = results.length - 1; index >= 0; index -= 1) {
      if (results[index].status === 'failed') {
        return results[index];
      }
    }
    return null;
  }

  function buildDebugReport() {
    if (typeof SCADiagnosticsUtils === 'object' && typeof SCADiagnosticsUtils.buildBatchDebugReport === 'function') {
      return SCADiagnosticsUtils.buildBatchDebugReport({
        authInfo: Object.assign({}, appState.authInfo || {}, {
          createUserPath: getCreateUserPathValue(),
        }),
        parsed: appState.parsed,
        batchState: appState.batchState,
      });
    }
    return '调试信息模块未加载';
  }

  function getDefaultCreateUserPath() {
    if (typeof SCARequestUtils === 'object' && SCARequestUtils.DEFAULT_CREATE_USER_PATH) {
      return SCARequestUtils.DEFAULT_CREATE_USER_PATH;
    }
    return '/sca/api-v1/user/add';
  }

  function getPasswordUtils() {
    return typeof SCAPasswordUtils === 'object' ? SCAPasswordUtils : null;
  }

  function getSm2Utils() {
    return typeof SCASM2Utils === 'object' ? SCASM2Utils : null;
  }

  function getBatchUtils() {
    return typeof SCABatchUtils === 'object' ? SCABatchUtils : null;
  }

  function getConfiguredSm2PublicKey() {
    const localKey = String($('sm2-public-key')?.value || appState.storedSm2PublicKey || '').trim();
    if (localKey) {
      const sm2Utils = getSm2Utils();
      if (sm2Utils && typeof sm2Utils.normalizeSm2PublicKey === 'function') {
        return sm2Utils.normalizeSm2PublicKey(localKey);
      }
      return localKey;
    }
    return String(appState.authInfo?.sm2PublicKey || '').trim();
  }

  function hasConfiguredSm2PublicKey() {
    const sm2Utils = getSm2Utils();
    const publicKey = getConfiguredSm2PublicKey();
    if (sm2Utils && typeof sm2Utils.looksLikeSm2PublicKey === 'function') {
      return sm2Utils.looksLikeSm2PublicKey(publicKey);
    }
    return /^(04)?[0-9a-fA-F]{128}$/.test(publicKey);
  }

  function normalizeCreateUserPath(value) {
    if (typeof SCARequestUtils === 'object' && typeof SCARequestUtils.normalizeApiPath === 'function') {
      return SCARequestUtils.normalizeApiPath(value, getDefaultCreateUserPath());
    }
    const text = String(value || '').trim();
    if (!text) {
      return getDefaultCreateUserPath();
    }
    return text.startsWith('/') ? text : `/${text}`;
  }

  function getCreateUserPathValue() {
    const input = $('create-user-path');
    return normalizeCreateUserPath(input?.value || appState.storedCreateUserPath || getDefaultCreateUserPath());
  }

  function getDepartmentOptions() {
    return Array.isArray(appState.departmentOptions) ? appState.departmentOptions : [];
  }

  function getDepartmentSelectionState() {
    const batchUtils = getBatchUtils();
    const departmentNames = batchUtils
      ? batchUtils.collectDepartmentNames(appState.parsed?.validUsers || [])
      : [];
    if (!batchUtils || typeof batchUtils.buildDepartmentSelectionState !== 'function') {
      return [];
    }
    return batchUtils.buildDepartmentSelectionState(
      departmentNames,
      getDepartmentOptions(),
      appState.storedDepartmentMap
    );
  }

  function getProjectSelectionState() {
    const batchUtils = getBatchUtils();
    const projectNames = batchUtils
      ? batchUtils.collectProjectNames(appState.parsed?.validUsers || [])
      : [];
    if (!batchUtils || typeof batchUtils.buildProjectSelectionState !== 'function') {
      return [];
    }
    return batchUtils.buildProjectSelectionState(
      projectNames,
      appState.projectOptionsByName,
      appState.storedProjectMap
    );
  }

  function buildDepartmentOptionsMarkup(selectedValue, options) {
    const selected = String(selectedValue || '');
    const optionList = Array.isArray(options) ? options : [];
    const rows = ['<option value="">未匹配时回退兜底部门</option>'];
    optionList.forEach(function (option) {
      const id = Number(option.id);
      if (!Number.isFinite(id)) {
        return;
      }
      rows.push(`<option value="${id}"${String(id) === selected ? ' selected' : ''}>${escapeHtml(option.label || option.name || id)}</option>`);
    });
    return rows.join('');
  }

  function renderDefaultDepartmentOptions() {
    const select = $('default-department-id');
    if (!select) {
      return;
    }

    const currentValue = String(select.dataset.currentValue || select.value || '2').trim() || '2';
    const options = getDepartmentOptions();

    if (options.length === 0) {
      select.innerHTML = `<option value="${escapeHtml(currentValue)}">未加载部门列表，当前值 ${escapeHtml(currentValue)}</option>`;
      select.value = currentValue;
      select.dataset.currentValue = currentValue;
      return;
    }

    select.innerHTML = buildDepartmentOptionsMarkup(currentValue, options);
    if (Array.from(select.options).some(function (option) { return option.value === currentValue; })) {
      select.value = currentValue;
    } else {
      select.value = '';
    }
    select.dataset.currentValue = select.value || currentValue;
  }

  function buildProjectOptionsMarkup(selectedValue, options) {
    const selected = String(selectedValue || '');
    const optionList = Array.isArray(options) ? options : [];
    const rows = ['<option value="">不关联项目（传空值）</option>'];
    optionList.forEach(function (option) {
      const id = Number(option.id);
      if (!Number.isFinite(id)) {
        return;
      }
      rows.push(`<option value="${id}"${String(id) === selected ? ' selected' : ''}>${escapeHtml(option.label || option.name || id)}</option>`);
    });
    return rows.join('');
  }

  function getEncryptedPasswordOverrideValue() {
    const input = $('encrypted-password-override');
    return String(input?.value || appState.storedEncryptedPasswordOverride || '').trim();
  }

  function getDefaultPasswordValue() {
    const input = $('default-password');
    return String(input?.value || appState.storedDefaultPassword || '').trim();
  }

  function looksLikeEncryptedPassword(value) {
    const passwordUtils = getPasswordUtils();
    if (passwordUtils && typeof passwordUtils.looksLikeEncryptedPassword === 'function') {
      return passwordUtils.looksLikeEncryptedPassword(value);
    }
    const text = String(value || '').trim();
    return text.length >= 64 && text.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(text);
  }

  async function persistCreateUserPath() {
    const createUserPath = getCreateUserPathValue();
    appState.storedCreateUserPath = createUserPath;
    const input = $('create-user-path');
    if (input && input.value !== createUserPath) {
      input.value = createUserPath;
    }
    await storageSet({ [CREATE_USER_PATH_KEY]: createUserPath });
    renderAuthInfo();
  }

  async function persistEncryptedPasswordOverride() {
    const encryptedPasswordOverride = getEncryptedPasswordOverrideValue();
    appState.storedEncryptedPasswordOverride = encryptedPasswordOverride;
    const input = $('encrypted-password-override');
    if (input && input.value !== encryptedPasswordOverride) {
      input.value = encryptedPasswordOverride;
    }
    await storageSet({ [ENCRYPTED_PASSWORD_OVERRIDE_KEY]: encryptedPasswordOverride });
    renderAuthInfo();
    renderDebugStatus();
  }

  async function persistDefaultPassword() {
    const defaultPassword = getDefaultPasswordValue();
    appState.storedDefaultPassword = defaultPassword;
    const input = $('default-password');
    if (input && input.value !== defaultPassword) {
      input.value = defaultPassword;
    }
    await storageSet({ [DEFAULT_PASSWORD_KEY]: defaultPassword });
  }

  async function persistSm2PublicKey() {
    const sm2PublicKey = getConfiguredSm2PublicKey();
    appState.storedSm2PublicKey = sm2PublicKey;
    const input = $('sm2-public-key');
    if (input && input.value !== sm2PublicKey) {
      input.value = sm2PublicKey;
    }
    await storageSet({ [SM2_PUBLIC_KEY_KEY]: sm2PublicKey });
    renderAuthInfo();
    renderDebugStatus();
  }

  async function refreshActiveTabContext() {
    const activeTab = await getActiveTab();
    appState.activeTabId = activeTab?.id || null;
    appState.activeTabUrl = activeTab?.url || '';
    return activeTab;
  }

  async function refreshDepartmentOptions() {
    if (!appState.activeTabId || !appState.authInfo?.token || (appState.activeTabUrl && !isProbablySCAPageUrl(appState.activeTabUrl))) {
      appState.departmentOptions = [];
      appState.departmentOptionsError = '';
      renderDefaultDepartmentOptions();
      renderDepartmentMappings();
      return;
    }

    try {
      const response = await sendMessageToTab({
        type: 'GET_DEPARTMENT_OPTIONS',
        token: appState.authInfo.token,
      });
      if (!response?.ok || !Array.isArray(response.options)) {
        throw new Error(response?.error || '部门列表加载失败');
      }
      appState.departmentOptions = response.options;
      appState.departmentOptionsError = '';
    } catch (error) {
      appState.departmentOptions = [];
      appState.departmentOptionsError = error instanceof Error ? error.message : String(error);
    }

    renderDefaultDepartmentOptions();
    renderDepartmentMappings();
  }

  async function refreshProjectOptions() {
    const batchUtils = getBatchUtils();
    const projectNames = batchUtils
      ? batchUtils.collectProjectNames(appState.parsed?.validUsers || [])
      : [];

    if (!appState.activeTabId || !appState.authInfo?.token || projectNames.length === 0 || (appState.activeTabUrl && !isProbablySCAPageUrl(appState.activeTabUrl))) {
      appState.projectOptionsByName = {};
      appState.projectOptionsError = '';
      renderProjectMappings();
      return;
    }

    try {
      const response = await sendMessageToTab({
        type: 'GET_PROJECT_OPTIONS',
        token: appState.authInfo.token,
        projectNames: projectNames,
      });
      if (!response?.ok || !response.optionsByName || typeof response.optionsByName !== 'object') {
        throw new Error(response?.error || '项目列表加载失败');
      }
      appState.projectOptionsByName = response.optionsByName;
      appState.projectOptionsError = '';
    } catch (error) {
      appState.projectOptionsByName = {};
      appState.projectOptionsError = error instanceof Error ? error.message : String(error);
    }

    renderProjectMappings();
  }

  function getActiveTab() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (chrome.runtime.lastError) {
          reject(new Error(friendlyChromeError(chrome.runtime.lastError.message, 'tab')));
          return;
        }
        resolve(tabs[0] || null);
      });
    });
  }

  function sendMessageToTab(message) {
    return new Promise((resolve, reject) => {
      if (!appState.activeTabId) {
        reject(new Error('当前没有可用的活动标签页'));
        return;
      }

      chrome.tabs.sendMessage(appState.activeTabId, message, function (response) {
        if (chrome.runtime.lastError) {
          reject(new Error(friendlyChromeError(chrome.runtime.lastError.message, 'tab')));
          return;
        }
        resolve(response);
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

  function setStatus(element, statusClass, message) {
    element.className = `status-card ${statusClass}`;
    element.textContent = message;
  }

  function setHidden(element, hidden) {
    element.classList.toggle('hidden', hidden);
  }

  function renderAuthInfo() {
    const authStatus = $('auth-status');
    const encryptedPasswordOverride = getEncryptedPasswordOverrideValue();
    const hasEncryptedPasswordOverride = looksLikeEncryptedPassword(encryptedPasswordOverride);
    const hasSm2PublicKey = hasConfiguredSm2PublicKey();
    if (!appState.activeTabId) {
      setStatus(authStatus, 'status-danger', '当前没有可用的活动标签页。\n请先打开一个已登录的 SCA 页面。');
      return;
    }

    if (appState.activeTabUrl && !isProbablySCAPageUrl(appState.activeTabUrl)) {
      setStatus(
        authStatus,
        'status-danger',
      `当前标签页不是普通网页，插件脚本不会注入。\n当前页面: ${appState.activeTabUrl}\n请切回已登录的 SCA 页面后重试。`
      );
      return;
    }

    if (!appState.authInfo) {
      setStatus(
        authStatus,
        'status-danger',
        `未能从当前标签页获取认证信息。\n当前页面: ${appState.activeTabUrl || '未知'}\n请先打开已登录的 SCA 页面，再点一次“刷新认证”。`
      );
      return;
    }

    const auth = appState.authInfo;
    const lines = [
      `目标站点: ${auth.baseUrl}`,
      `Token 来源: ${auth.tokenKey || '未找到'}`,
      `Token 状态: ${auth.token ? '已检测到' : '未找到'}`,
      `加密方式: ${auth.cipherType || 'SM2'}`,
      `SM2 公钥: ${hasSm2PublicKey ? '已配置（本地）' : '未配置'}`,
      `创建接口: ${getCreateUserPathValue()}`,
    ];
    if (encryptedPasswordOverride) {
      lines.push(`固定密文: ${hasEncryptedPasswordOverride ? '已配置' : '格式异常'}`);
    }
    if (!auth.token) {
      lines.push('建议: 先确认当前页面还在登录态，再刷新认证。');
      setStatus(authStatus, 'status-danger', lines.join('\n'));
      return;
    }

    if (encryptedPasswordOverride && !hasEncryptedPasswordOverride) {
      lines.push('提示: 固定加密密码必须是成功请求里的十六进制 password。');
      setStatus(authStatus, 'status-warning', lines.join('\n'));
      return;
    }

    if (!hasSm2PublicKey && !hasEncryptedPasswordOverride) {
      lines.push('提示: 没有可用的 SM2 公钥，若后端不接受明文密码，这里会直接失败。');
      lines.push('可改用“固定加密密码”，直接粘贴页面成功请求里的 password 密文。');
      setStatus(authStatus, 'status-warning', lines.join('\n'));
      return;
    }

    if (!getDefaultPasswordValue() && !hasEncryptedPasswordOverride) {
      lines.push('提示: 当前未配置默认密码。公开版仓库不会内置默认密码，请先在本地填写。');
      setStatus(authStatus, 'status-warning', lines.join('\n'));
      return;
    }

    if (hasEncryptedPasswordOverride) {
      lines.push('提示: 当前会直接复用固定密文密码，跳过现场加密。');
    }

    setStatus(authStatus, 'status-success', lines.join('\n'));
  }

  function renderSkippedRows() {
    const container = $('skipped-rows');
    const skippedRows = appState.parsed?.skippedRows || [];

    if (skippedRows.length === 0) {
      container.innerHTML = '';
      setHidden(container, true);
      return;
    }

    const html = skippedRows.map(function (row) {
      const prefix = row.username ? `第 ${row.rowIndex} 行 (${row.username})` : `第 ${row.rowIndex} 行`;
      return `<div class="list-item"><span>${escapeHtml(prefix)}</span><span class="muted">${escapeHtml(row.reason)}</span></div>`;
    }).join('');

    container.innerHTML = `<div class="muted">已跳过以下行：</div>${html}`;
    setHidden(container, false);
  }

  function renderUserPreview() {
    const wrapper = $('user-preview');
    const users = appState.parsed?.validUsers || [];

    if (users.length === 0) {
      wrapper.innerHTML = '';
      setHidden(wrapper, true);
      return;
    }

    const rows = users.map(function (user) {
      return `
        <tr>
          <td>${escapeHtml(user.rowIndex)}</td>
          <td>${escapeHtml(user.username)}</td>
          <td>${escapeHtml(user.realName || '-')}</td>
          <td>${escapeHtml(user.departmentName || '-')}</td>
          <td>${escapeHtml(user.email)}</td>
        </tr>
      `;
    }).join('');

    wrapper.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>行</th>
            <th>用户名</th>
            <th>姓名</th>
            <th>部门</th>
            <th>邮箱</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    setHidden(wrapper, false);
  }

  function renderDepartmentMappings() {
    const wrapper = $('department-mapping');
    const selectionState = getDepartmentSelectionState();
    const defaultDepartmentId = $('default-department-id').value.trim();
    const departmentOptions = getDepartmentOptions();

    if (selectionState.length === 0) {
      wrapper.innerHTML = '';
      setHidden(wrapper, true);
      return;
    }

    if (departmentOptions.length === 0) {
      wrapper.innerHTML = `<div class="muted">部门列表还没加载出来。先点“刷新认证”，确认当前页已登录；加载成功后这里会自动按部门名称匹配。</div>${appState.departmentOptionsError ? `<div class="mapping-help">${escapeHtml(appState.departmentOptionsError)}</div>` : ''}`;
      setHidden(wrapper, false);
      return;
    }

    const rows = selectionState.map(function (item) {
      const matchStatusTextMap = {
        stored: '已手动确认',
        auto: '已自动匹配',
        ambiguous: '存在重名，需手动选择',
        missing: '未匹配到，需手动选择',
      };
      const matchStatusClass = `mapping-match-${item.matchStatus}`;
      const selectedValue = item.selectedId === '' ? '' : String(item.selectedId);
      const selectedOption = departmentOptions.find(function (option) {
        return String(option.id) === selectedValue;
      });
      const pathText = selectedOption ? selectedOption.path : '未选择，提交时会回退兜底部门';
      return `
        <div class="mapping-row">
          <div class="mapping-meta">
            <div class="mapping-name">${escapeHtml(item.name)}</div>
            <div class="mapping-match ${matchStatusClass}">${escapeHtml(matchStatusTextMap[item.matchStatus] || '待确认')}</div>
            <div class="mapping-path">${escapeHtml(pathText)}</div>
          </div>
          <label>
            <span>部门选择（留空则回退 ${defaultDepartmentId || '兜底部门'}）</span>
            <select
              class="department-id-input"
              data-department-name="${escapeHtml(item.name)}">${buildDepartmentOptionsMarkup(selectedValue, departmentOptions)}</select>
          </label>
        </div>
      `;
    }).join('');

    wrapper.innerHTML = `<div class="muted">按模板中的唯一部门名称映射到系统 departmentId；已自动匹配的也可以改，留空就回退到兜底部门。</div>${rows}`;
    setHidden(wrapper, false);

    Array.from(document.querySelectorAll('.department-id-input')).forEach(function (select) {
      select.addEventListener('change', async function () {
        await persistDepartmentMappings();
        renderDepartmentMappings();
      });
    });
  }

  function renderProjectMappings() {
    const wrapper = $('project-mapping');
    const selectionState = getProjectSelectionState();

    if (selectionState.length === 0) {
      wrapper.innerHTML = '';
      setHidden(wrapper, true);
      return;
    }

    const hasAnyOptions = selectionState.some(function (item) {
      return Array.isArray(appState.projectOptionsByName[item.name]) && appState.projectOptionsByName[item.name].length > 0;
    });
    if (!hasAnyOptions && appState.projectOptionsError) {
      wrapper.innerHTML = `<div class="muted">项目列表还没加载出来。先点“刷新认证”，再导入带项目名称的模板；接口会按每个唯一项目名做模糊查询。</div><div class="mapping-help">${escapeHtml(appState.projectOptionsError)}</div>`;
      setHidden(wrapper, false);
      return;
    }

    const rows = selectionState.map(function (item) {
      const options = Array.isArray(appState.projectOptionsByName[item.name]) ? appState.projectOptionsByName[item.name] : [];
      const matchStatusTextMap = {
        stored: '已手动确认',
        auto: '已唯一精确匹配',
        ambiguous: `模糊查询命中 ${item.candidateCount} 项，需确认`,
        missing: '未匹配到，可留空',
      };
      const matchStatusClass = `mapping-match-${item.matchStatus}`;
      const selectedValue = item.selectedId === '' ? '' : String(item.selectedId);
      const selectedOption = options.find(function (option) {
        return String(option.id) === selectedValue;
      });
      const pathText = selectedOption
        ? selectedOption.label
        : (options.length > 0 ? '请从候选项目中手动确认，或留空不关联项目' : '未命中项目，留空会传空数组');
      return `
        <div class="mapping-row">
          <div class="mapping-meta">
            <div class="mapping-name">${escapeHtml(item.name)}</div>
            <div class="mapping-match ${matchStatusClass}">${escapeHtml(matchStatusTextMap[item.matchStatus] || '待确认')}</div>
            <div class="mapping-path">${escapeHtml(pathText)}</div>
          </div>
          <label>
            <span>项目选择（留空则 projectMemberList 传空值）</span>
            <select
              class="project-id-input"
              data-project-name="${escapeHtml(item.name)}">${buildProjectOptionsMarkup(selectedValue, options)}</select>
          </label>
        </div>
      `;
    }).join('');

    wrapper.innerHTML = `<div class="muted">按模板中的唯一项目名称做模糊查询；只有唯一精确命中才会自动映射，多个候选时需要你手动确认，也可以直接留空不关联项目。</div>${rows}`;
    setHidden(wrapper, false);

    Array.from(document.querySelectorAll('.project-id-input')).forEach(function (select) {
      select.addEventListener('change', async function () {
        await persistProjectMappings();
        renderProjectMappings();
      });
    });
  }

  function renderParseSummary() {
    const summary = $('parse-summary');
    const users = appState.parsed?.validUsers || [];
    const skippedRows = appState.parsed?.skippedRows || [];

    if (!appState.parsed) {
      setStatus(summary, 'status-neutral', '请选择 [SCA用户账号模板.xlsx] 对应的填报文件。');
      return;
    }

    if (users.length === 0) {
      const reason = skippedRows[0]?.reason || '未解析到有效用户';
      setStatus(summary, 'status-danger', `解析失败：${reason}`);
      return;
    }

    setStatus(
      summary,
      skippedRows.length > 0 ? 'status-warning' : 'status-success',
      `解析完成：有效用户 ${users.length} 条，跳过 ${skippedRows.length} 条。`
    );
  }

  function collectDepartmentMap() {
    const mapping = {};
    Array.from(document.querySelectorAll('.department-id-input')).forEach(function (select) {
      const value = select.value.trim();
      const departmentName = select.dataset.departmentName;
      if (value) {
        mapping[departmentName] = Number(value);
      }
    });
    return mapping;
  }

  function collectProjectMap() {
    const mapping = {};
    Array.from(document.querySelectorAll('.project-id-input')).forEach(function (select) {
      const value = select.value.trim();
      const projectName = select.dataset.projectName;
      if (value) {
        mapping[projectName] = Number(value);
      }
    });
    return mapping;
  }

  async function persistDepartmentMappings() {
    const mapping = collectDepartmentMap();
    appState.storedDepartmentMap = mapping;
    await storageSet({ [DEPARTMENT_MAP_KEY]: mapping });
  }

  async function persistProjectMappings() {
    const mapping = collectProjectMap();
    appState.storedProjectMap = mapping;
    await storageSet({ [PROJECT_MAP_KEY]: mapping });
  }

  function setBatchFailureState(message, details) {
    const failedState = {
      status: 'failed',
      phase: details?.phase || 'preflight',
      total: appState.parsed?.validUsers?.length || 0,
      currentIndex: 0,
      currentUsername: '',
      successCount: 0,
      failCount: 0,
      results: [],
      error: message,
      lastError: {
        status: 'failed',
        message: message,
        phase: details?.phase || 'preflight',
        httpStatus: details?.httpStatus || 0,
        apiCode: details?.apiCode || '',
        apiMessage: details?.apiMessage || '',
        responseSnippet: details?.responseSnippet || '',
        hint: details?.hint || '',
      },
    };
    appState.batchState = failedState;
    storageSet({ [BATCH_STATE_KEY]: failedState }).catch(function () {});
  }

  function renderBatchResults() {
    const wrapper = $('batch-results');
    const results = appState.batchState?.results || [];

    if (results.length === 0) {
      wrapper.innerHTML = '';
      setHidden(wrapper, true);
      return;
    }

    const rows = results.map(function (item) {
      const detail = item.status === 'failed' && typeof SCADiagnosticsUtils === 'object'
        ? SCADiagnosticsUtils.formatBatchResultSummary(item)
        : (item.message || '-');
      return `
        <tr class="${item.status === 'failed' ? 'result-row-failed' : ''}">
          <td>${escapeHtml(item.rowIndex || '-')}</td>
          <td>${escapeHtml(item.username || '-')}</td>
          <td>${escapeHtml(item.status)}</td>
          <td><div class="result-detail">${formatMultilineHtml(detail)}</div></td>
        </tr>
      `;
    }).join('');

    wrapper.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>行</th>
            <th>用户名</th>
            <th>结果</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    setHidden(wrapper, false);
  }

  function renderDebugStatus() {
    const debugStatus = $('debug-status');
    const lastFailedResult = getLastFailedResult();

    if (lastFailedResult) {
      setStatus(
        debugStatus,
        'status-danger',
        `最近错误：\n${typeof SCADiagnosticsUtils === 'object'
          ? SCADiagnosticsUtils.formatBatchResultSummary(lastFailedResult)
          : (lastFailedResult.message || '创建失败')}`
      );
      return;
    }

    if (!appState.authInfo?.token) {
      setStatus(
        debugStatus,
        'status-warning',
        '启动前提示：当前还没检测到可用 Token。\n先打开已登录的 SCA 页面，再点一次“刷新认证”。'
      );
      return;
    }

    if (appState.batchState?.status === 'running') {
      setStatus(
        debugStatus,
        'status-neutral',
        '任务执行中。若某条失败，这里会立刻显示最近错误。\n也可以点“复制调试信息”，把当前认证、解析和运行摘要一起带走。'
      );
      return;
    }

    if (appState.batchState?.status === 'completed' && appState.batchState.failCount === 0) {
      setStatus(
        debugStatus,
        'status-success',
        '当前没有失败记录。若后面要回溯现场，直接点“复制调试信息”即可。'
      );
      return;
    }

    setStatus(
      debugStatus,
      'status-neutral',
      '调试信息会跟着运行状态一起更新；启动失败、单条失败和整批完成后的最近错误，都会在这里汇总。'
    );
  }

  function renderBatchState() {
    const status = $('batch-status');
    const batchState = appState.batchState;
    const usersReady = (appState.parsed?.validUsers || []).length > 0;
    $('start-create').disabled = !usersReady || (batchState && batchState.status === 'running');

    if (!batchState) {
      setStatus(status, 'status-neutral', '尚未开始。');
      renderBatchResults();
      renderDebugStatus();
      return;
    }

    if (batchState.status === 'running') {
      const latestFailure = getLastFailedResult();
      setStatus(
        status,
        'status-warning',
        `执行中：${batchState.currentIndex}/${batchState.total}\n当前用户：${batchState.currentUsername || '-'}\n成功 ${batchState.successCount} / 失败 ${batchState.failCount}${latestFailure ? '\n最近失败已记录在下方调试摘要。' : ''}`
      );
      renderBatchResults();
      renderDebugStatus();
      return;
    }

    if (batchState.status === 'failed') {
      const failedSummary = batchState.lastError && typeof SCADiagnosticsUtils === 'object'
        ? SCADiagnosticsUtils.formatBatchResultSummary(batchState.lastError)
        : (batchState.error || '未知错误');
      setStatus(
        status,
        'status-danger',
        `任务启动失败：${batchState.error || '未知错误'}\n\n${failedSummary}`
      );
      renderBatchResults();
      renderDebugStatus();
      return;
    }

    const latestFailure = getLastFailedResult();
    setStatus(
      status,
      batchState.failCount > 0 ? 'status-warning' : 'status-success',
      `执行完成：总计 ${batchState.total} 条，成功 ${batchState.successCount} 条，失败 ${batchState.failCount} 条。${latestFailure ? '\n最近失败已汇总到下方调试摘要。' : ''}`
    );
    renderBatchResults();
    renderDebugStatus();
  }

  async function refreshAuthInfo() {
    try {
      await refreshActiveTabContext();
      const response = await sendMessageToTab({ type: 'GET_AUTH_INFO' });
      appState.authInfo = response;
    } catch (_error) {
      appState.authInfo = null;
    }
    await refreshDepartmentOptions();
    await refreshProjectOptions();
    renderAuthInfo();
    renderDebugStatus();
  }

  async function restoreLocalState() {
    const items = await storageGet([
      DEPARTMENT_MAP_KEY,
      PROJECT_MAP_KEY,
      BATCH_STATE_KEY,
      CREATE_USER_PATH_KEY,
      ENCRYPTED_PASSWORD_OVERRIDE_KEY,
      DEFAULT_PASSWORD_KEY,
      SM2_PUBLIC_KEY_KEY,
    ]);
    appState.storedDepartmentMap = items[DEPARTMENT_MAP_KEY] || {};
    appState.storedProjectMap = items[PROJECT_MAP_KEY] || {};
    appState.batchState = items[BATCH_STATE_KEY] || null;
    appState.storedCreateUserPath = normalizeCreateUserPath(items[CREATE_USER_PATH_KEY] || getDefaultCreateUserPath());
    appState.storedEncryptedPasswordOverride = String(items[ENCRYPTED_PASSWORD_OVERRIDE_KEY] || '').trim();
    appState.storedDefaultPassword = String(items[DEFAULT_PASSWORD_KEY] || '').trim();
    appState.storedSm2PublicKey = String(items[SM2_PUBLIC_KEY_KEY] || '').trim();
    $('default-department-id').dataset.currentValue = $('default-department-id').value.trim();
    $('default-password').value = appState.storedDefaultPassword;
    $('sm2-public-key').value = appState.storedSm2PublicKey;
    $('create-user-path').value = appState.storedCreateUserPath;
    $('encrypted-password-override').value = appState.storedEncryptedPasswordOverride;
    renderDefaultDepartmentOptions();
  }

  async function handleFileChange(event) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: '',
      });
      appState.parsed = SCABatchUtils.parseWorksheetRows(rows);
    } catch (error) {
      appState.parsed = {
        validUsers: [],
        skippedRows: [{ rowIndex: 0, reason: `${file.name} 解析失败: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }

    renderParseSummary();
    renderSkippedRows();
    renderUserPreview();
    renderDepartmentMappings();
    await refreshProjectOptions();
    renderBatchState();
  }

  async function handleStartCreate() {
    if (!appState.parsed || appState.parsed.validUsers.length === 0) {
      setBatchFailureState('没有可创建的用户数据', {
        phase: 'preflight',
        hint: '先导入 Excel 模板，并确认至少解析出 1 条有效用户。',
      });
      renderBatchState();
      return;
    }

    await refreshAuthInfo();

    if (appState.activeTabUrl && !isProbablySCAPageUrl(appState.activeTabUrl)) {
      setBatchFailureState('当前标签页不是 SCA 页面', {
        phase: 'preflight',
        hint: `请切回已登录的 SCA 页面后再启动。\n当前页面: ${appState.activeTabUrl}`,
      });
      renderAuthInfo();
      renderBatchState();
      return;
    }

    if (!appState.authInfo?.token) {
      setBatchFailureState('当前未检测到可用 Token', {
        phase: 'preflight',
        hint: '先确认当前页面已登录，再点“刷新认证”；必要时直接刷新 SCA 页面。',
      });
      renderAuthInfo();
      renderBatchState();
      return;
    }

    const departmentMap = collectDepartmentMap();
    const projectMap = collectProjectMap();
    const payload = {
      type: 'START_BATCH_CREATE',
      users: appState.parsed.validUsers,
      token: appState.authInfo?.token || '',
      sm2PublicKey: getConfiguredSm2PublicKey(),
      createUserPath: getCreateUserPathValue(),
      encryptedPasswordOverride: getEncryptedPasswordOverrideValue(),
      defaultPassword: getDefaultPasswordValue(),
      defaultRoleId: Number($('default-role-id').value.trim() || 1),
      defaultDepartmentId: Number($('default-department-id').value.trim() || 2),
      departmentMap: departmentMap,
      projectMap: projectMap,
    };

    setStatus($('batch-status'), 'status-warning', '任务已提交，正在启动…');
    $('start-create').disabled = true;

    try {
      await persistDepartmentMappings();
      await persistProjectMappings();
      await persistDefaultPassword();
      await persistSm2PublicKey();
      await persistCreateUserPath();
      await persistEncryptedPasswordOverride();
      const response = await sendMessageToTab(payload);
      appState.batchState = response?.state || null;
    } catch (error) {
      setBatchFailureState(error instanceof Error ? error.message : String(error), {
        phase: 'request',
        hint: '大概率是当前页面没注入 content script，或标签页已切走。先刷新 SCA 页面再试。',
      });
    }

    renderBatchState();
  }

  async function handleResetState() {
    try {
      await sendMessageToTab({ type: 'RESET_BATCH_STATE' });
    } catch (_error) {
      // 当前页不在脚本注入范围时，至少清掉本地缓存
    }

    appState.batchState = null;
    await storageSet({ [BATCH_STATE_KEY]: null });
    renderBatchState();
  }

  async function handleCopyDebug() {
    const copyButton = $('copy-debug');
    const report = buildDebugReport();

    try {
      await navigator.clipboard.writeText(report);
      copyButton.textContent = '已复制';
      window.setTimeout(function () {
        copyButton.textContent = '复制调试信息';
      }, 1600);
    } catch (error) {
      setStatus(
        $('debug-status'),
        'status-danger',
        `复制调试信息失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  function bindEvents() {
    $('refresh-auth').addEventListener('click', refreshAuthInfo);
    $('excel-file').addEventListener('change', handleFileChange);
    $('start-create').addEventListener('click', handleStartCreate);
    $('copy-debug').addEventListener('click', handleCopyDebug);
    $('reset-state').addEventListener('click', handleResetState);
    $('default-department-id').addEventListener('change', function (event) {
      event.currentTarget.dataset.currentValue = event.currentTarget.value.trim();
      renderDepartmentMappings();
    });
    $('default-password').addEventListener('change', persistDefaultPassword);
    $('sm2-public-key').addEventListener('change', persistSm2PublicKey);
    $('create-user-path').addEventListener('change', persistCreateUserPath);
    $('encrypted-password-override').addEventListener('change', persistEncryptedPasswordOverride);

    chrome.runtime.onMessage.addListener(function (message) {
      if (message.type === 'BATCH_STATE_UPDATE') {
        appState.batchState = message.state || null;
        renderBatchState();
      }
    });
  }

  async function init() {
    bindEvents();
    await restoreLocalState();

    await refreshActiveTabContext();

    await refreshAuthInfo();
    renderParseSummary();
    renderSkippedRows();
    renderUserPreview();
    renderDepartmentMappings();
    renderProjectMappings();
    renderBatchState();
  }

  init().catch(function (error) {
    setStatus(
      $('auth-status'),
      'status-danger',
      `初始化失败：${error instanceof Error ? error.message : String(error)}`
    );
    setStatus(
      $('debug-status'),
      'status-danger',
      `初始化失败：${error instanceof Error ? error.message : String(error)}`
    );
  });
})();
