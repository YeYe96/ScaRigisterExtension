(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.SCADiagnosticsUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function normalizeText(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  function truncateText(value, maxLength) {
    const text = normalizeText(value);
    const limit = Number(maxLength) > 0 ? Number(maxLength) : 160;
    if (text.length <= limit) {
      return text;
    }
    return text.slice(0, limit - 3) + '...';
  }

  function maskToken(token) {
    const value = normalizeText(token);
    if (!value) {
      return 'missing';
    }
    if (value.length <= 8) {
      return value[0] + '...' + value[value.length - 1];
    }
    return value.slice(0, 6) + '...' + value.slice(-4);
  }

  function formatKeyNames(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return 'none';
    }

    return entries
      .map(function (entry) {
        if (entry && typeof entry === 'object') {
          return normalizeText(entry.key);
        }
        return normalizeText(entry);
      })
      .filter(function (entry) {
        return entry.length > 0;
      })
      .join(', ') || 'none';
  }

  function formatPayloadPreview(payloadPreview) {
    if (!payloadPreview || typeof payloadPreview !== 'object') {
      return '';
    }

    const parts = [];
    if (payloadPreview.roleId !== null && payloadPreview.roleId !== undefined && normalizeText(payloadPreview.roleId) !== '') {
      parts.push('roleId=' + payloadPreview.roleId);
    }
    if (payloadPreview.departmentId !== null && payloadPreview.departmentId !== undefined && normalizeText(payloadPreview.departmentId) !== '') {
      parts.push('departmentId=' + payloadPreview.departmentId);
    }
    if (payloadPreview.status !== null && payloadPreview.status !== undefined && normalizeText(payloadPreview.status) !== '') {
      parts.push('status=' + payloadPreview.status);
    }
    if (Array.isArray(payloadPreview.projectMemberList)) {
      parts.push('projectMemberList=' + payloadPreview.projectMemberList.length);
    }

    return parts.join(', ');
  }

  function formatBatchResultSummary(result) {
    if (!result || typeof result !== 'object') {
      return '无可用错误详情';
    }

    const identityParts = [];
    if (result.rowIndex) {
      identityParts.push('第 ' + result.rowIndex + ' 行');
    }
    if (result.username) {
      identityParts.push(result.username);
    }

    const lines = [];
    if (identityParts.length > 0) {
      lines.push(identityParts.join(' / '));
    }

    if (normalizeText(result.message)) {
      lines.push('错误: ' + normalizeText(result.message));
    }
    if (normalizeText(result.phase)) {
      lines.push('阶段: ' + normalizeText(result.phase));
    }
    if (result.httpStatus) {
      lines.push('HTTP: ' + result.httpStatus);
    }

    const apiParts = [];
    if (result.apiCode !== null && result.apiCode !== undefined && normalizeText(result.apiCode) !== '') {
      apiParts.push(String(result.apiCode));
    }
    if (normalizeText(result.apiMessage)) {
      apiParts.push(normalizeText(result.apiMessage));
    }
    if (apiParts.length > 0) {
      lines.push('接口: ' + apiParts.join(' - '));
    }
    if (normalizeText(result.requestPath)) {
      lines.push('路径: ' + normalizeText(result.requestPath));
    }

    if (normalizeText(result.hint)) {
      lines.push('建议: ' + normalizeText(result.hint));
    }
    if (normalizeText(result.responseSnippet)) {
      lines.push('响应: ' + truncateText(result.responseSnippet, 180));
    }
    const payloadPreview = formatPayloadPreview(result.payloadPreview);
    if (payloadPreview) {
      lines.push('Payload: ' + payloadPreview);
    }

    return lines.join('\n') || '无可用错误详情';
  }

  function buildBatchDebugReport(input) {
    const authInfo = input && input.authInfo ? input.authInfo : {};
    const parsed = input && input.parsed ? input.parsed : null;
    const batchState = input && input.batchState ? input.batchState : null;
    const validUsers = parsed && Array.isArray(parsed.validUsers) ? parsed.validUsers.length : 0;
    const skippedRows = parsed && Array.isArray(parsed.skippedRows) ? parsed.skippedRows.length : 0;
    const lastError = batchState && (batchState.lastError || (Array.isArray(batchState.results)
      ? batchState.results.slice().reverse().find(function (item) { return item.status === 'failed'; })
      : null));

    const sections = [
      '[认证信息]',
      'Base URL: ' + (normalizeText(authInfo.baseUrl) || 'missing'),
      'Token Key: ' + (normalizeText(authInfo.tokenKey) || 'missing'),
      'Token: ' + maskToken(authInfo.token),
      'Cipher: ' + (normalizeText(authInfo.cipherType) || 'SM2'),
      'SM2 Key: ' + (normalizeText(authInfo.sm2PublicKey) ? 'configured' : 'missing'),
      'Create User API: ' + (normalizeText(authInfo.createUserPath)
        || normalizeText(batchState && batchState.createUserPath)
        || 'missing'),
      'Storage Keys: ' + formatKeyNames(authInfo.allKeys),
      'Cookie Keys: ' + formatKeyNames(authInfo.cookieKeys),
      '',
      '[解析结果]',
      '解析结果: 有效 ' + validUsers + ' 条, 跳过 ' + skippedRows + ' 条',
      '',
      '[批量状态]',
    ];

    if (!batchState) {
      sections.push('批量状态: not-started');
      return sections.join('\n');
    }

    sections.push('批量状态: ' + (normalizeText(batchState.status) || 'unknown'));
    sections.push('进度: ' + Number(batchState.currentIndex || 0) + '/' + Number(batchState.total || 0));
    sections.push('结果: 成功 ' + Number(batchState.successCount || 0) + ' 条, 失败 ' + Number(batchState.failCount || 0) + ' 条');

    if (normalizeText(batchState.error)) {
      sections.push('任务错误: ' + normalizeText(batchState.error));
    }
    if (lastError) {
      sections.push('最近错误: ' + formatBatchResultSummary(lastError).replace(/\n/g, ' | '));
    }

    return sections.join('\n');
  }

  function toFriendlyChromeError(message, options) {
    const raw = normalizeText(message);
    const context = options && options.context ? options.context : 'tab';

    if (!raw) {
      return '未知扩展错误';
    }
    if (/Receiving end does not exist/i.test(raw)) {
      return context === 'tab'
        ? '当前标签页未注入插件脚本。请确认打开的是 SCA 页面，并刷新页面后重试。'
        : '插件上下文未建立连接，请关闭 popup 后重新打开。';
    }
    if (/Cannot access contents of the page/i.test(raw)) {
      return '当前页面不允许注入扩展脚本，请切回 SCA 页面后再试。';
    }
    if (/No tab with id/i.test(raw)) {
      return '当前活动标签页已变化或已关闭，请重新打开目标 SCA 页面。';
    }
    return raw;
  }

  return {
    truncateText: truncateText,
    maskToken: maskToken,
    formatBatchResultSummary: formatBatchResultSummary,
    buildBatchDebugReport: buildBatchDebugReport,
    toFriendlyChromeError: toFriendlyChromeError,
  };
});
