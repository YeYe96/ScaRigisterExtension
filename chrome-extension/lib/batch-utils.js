(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.SCABatchUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const COLUMN_MAP = {
    '用户名': 'username',
    '真实姓名': 'realName',
    '邮箱': 'email',
    '手机号': 'phone',
    '所属部门': 'departmentName',
    '所属项目': 'projectName',
  };

  const REQUIRED_COLUMNS = ['用户名', '真实姓名', '邮箱', '手机号', '所属部门'];

  const TEMPLATE_SAMPLE_ROWS = [
    {
      username: 'zhangsan',
      realName: '张三',
      email: 'zhangsan@example.com',
      phone: '13800000001',
      departmentName: '示例部门A',
      projectName: '示例项目A',
    },
    {
      username: 'lisi',
      realName: '李四',
      email: 'lisi@example.com',
      phone: '13800000002',
      departmentName: '示例部门B',
      projectName: '示例项目B',
    },
  ];

  function normalizeCell(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  function normalizeHeader(value) {
    return normalizeCell(value).split('\n')[0].trim();
  }

  function isEmptyRow(row) {
    return !row.some(function (cell) {
      return normalizeCell(cell) !== '';
    });
  }

  function looksLikeInstructionRow(rowIndex, mappedRow) {
    if (rowIndex !== 2) {
      return false;
    }
    return REQUIRED_COLUMNS.every(function (fieldName) {
      const internalKey = COLUMN_MAP[fieldName];
      return normalizeCell(mappedRow[internalKey]).length > 0;
    });
  }

  function isTemplateSampleRow(mappedRow) {
    return TEMPLATE_SAMPLE_ROWS.some(function (sampleRow) {
      return Object.keys(sampleRow).every(function (key) {
        return normalizeCell(mappedRow[key]) === sampleRow[key];
      });
    });
  }

  function parseWorksheetRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        headers: [],
        validUsers: [],
        skippedRows: [{ rowIndex: 0, reason: '空工作表' }],
      };
    }

    const headers = rows[0].map(normalizeHeader);
    const presentColumns = headers.filter(function (header) {
      return Object.prototype.hasOwnProperty.call(COLUMN_MAP, header);
    });
    const missingColumns = REQUIRED_COLUMNS.filter(function (header) {
      return !presentColumns.includes(header);
    });

    if (missingColumns.length > 0) {
      return {
        headers: headers,
        validUsers: [],
        skippedRows: [{
          rowIndex: 1,
          reason: '缺少必填列: ' + missingColumns.join(', '),
        }],
      };
    }

    const validUsers = [];
    const skippedRows = [];

    rows.slice(1).forEach(function (row, offset) {
      const rowIndex = offset + 2;
      const normalizedRow = Array.isArray(row) ? row : [];

      if (isEmptyRow(normalizedRow)) {
        return;
      }

      const mappedRow = {};
      headers.forEach(function (header, colIndex) {
        if (!Object.prototype.hasOwnProperty.call(COLUMN_MAP, header)) {
          return;
        }
        mappedRow[COLUMN_MAP[header]] = normalizeCell(normalizedRow[colIndex]);
      });

      if (looksLikeInstructionRow(rowIndex, mappedRow)) {
        skippedRows.push({ rowIndex: rowIndex, reason: '模板说明行' });
        return;
      }

      if (isTemplateSampleRow(mappedRow)) {
        skippedRows.push({ rowIndex: rowIndex, reason: '模板示例行' });
        return;
      }

      if (!mappedRow.username) {
        skippedRows.push({ rowIndex: rowIndex, reason: '用户名为空' });
        return;
      }

      if (!mappedRow.email) {
        skippedRows.push({
          rowIndex: rowIndex,
          reason: '邮箱为空',
          username: mappedRow.username,
        });
        return;
      }

      validUsers.push({
        rowIndex: rowIndex,
        username: mappedRow.username,
        realName: mappedRow.realName || '',
        email: mappedRow.email,
        phone: mappedRow.phone || '',
        departmentName: mappedRow.departmentName || '',
        projectName: mappedRow.projectName || '',
      });
    });

    return {
      headers: headers,
      validUsers: validUsers,
      skippedRows: skippedRows,
    };
  }

  function collectDepartmentNames(users) {
    const seen = new Set();
    const departments = [];
    users.forEach(function (user) {
      const name = normalizeCell(user.departmentName);
      if (!name || seen.has(name)) {
        return;
      }
      seen.add(name);
      departments.push(name);
    });
    return departments;
  }

  function collectProjectNames(users) {
    const seen = new Set();
    const projects = [];
    (Array.isArray(users) ? users : []).forEach(function (user) {
      const name = normalizeCell(user && user.projectName);
      if (!name || seen.has(name)) {
        return;
      }
      seen.add(name);
      projects.push(name);
    });
    return projects;
  }

  function flattenDepartmentTree(nodes, parentPath) {
    const list = [];
    const pathPrefix = normalizeCell(parentPath);
    const items = Array.isArray(nodes) ? nodes : [];

    items.forEach(function (node) {
      if (!node || typeof node !== 'object') {
        return;
      }
      const name = normalizeCell(node.name);
      if (!name) {
        return;
      }

      const currentPath = pathPrefix ? `${pathPrefix} / ${name}` : name;
      list.push({
        id: Number(node.id),
        name: name,
        label: currentPath,
        path: currentPath,
        parentId: node.parentId === null || node.parentId === undefined ? null : Number(node.parentId),
      });

      if (Array.isArray(node.children) && node.children.length > 0) {
        list.push.apply(list, flattenDepartmentTree(node.children, currentPath));
      }
    });

    return list;
  }

  function buildDepartmentSelectionState(departmentNames, departmentOptions, storedMap) {
    const names = Array.isArray(departmentNames) ? departmentNames : [];
    const options = Array.isArray(departmentOptions) ? departmentOptions : [];
    const stored = storedMap && typeof storedMap === 'object' ? storedMap : {};
    const optionBuckets = new Map();
    const optionById = new Map();

    options.forEach(function (option) {
      if (!option || typeof option !== 'object') {
        return;
      }
      const normalizedName = normalizeCell(option.name);
      const id = Number(option.id);
      if (!normalizedName || !Number.isFinite(id)) {
        return;
      }
      if (!optionBuckets.has(normalizedName)) {
        optionBuckets.set(normalizedName, []);
      }
      optionBuckets.get(normalizedName).push(option);
      optionById.set(id, option);
    });

    return names.map(function (departmentName) {
      const name = normalizeCell(departmentName);
      const storedId = Number(stored[name]);
      if (Number.isFinite(storedId) && optionById.has(storedId)) {
        return {
          name: name,
          selectedId: storedId,
          matchStatus: 'stored',
        };
      }

      const candidates = optionBuckets.get(name) || [];
      if (candidates.length === 1) {
        return {
          name: name,
          selectedId: Number(candidates[0].id),
          matchStatus: 'auto',
        };
      }

      if (candidates.length > 1) {
        return {
          name: name,
          selectedId: '',
          matchStatus: 'ambiguous',
        };
      }

      return {
        name: name,
        selectedId: '',
        matchStatus: 'missing',
      };
    });
  }

  function buildProjectSelectionState(projectNames, projectOptionsByName, storedMap) {
    const names = Array.isArray(projectNames) ? projectNames : [];
    const optionsByName = projectOptionsByName && typeof projectOptionsByName === 'object'
      ? projectOptionsByName
      : {};
    const stored = storedMap && typeof storedMap === 'object' ? storedMap : {};

    return names.map(function (projectName) {
      const name = normalizeCell(projectName);
      const candidates = Array.isArray(optionsByName[name]) ? optionsByName[name] : [];
      const candidateIds = new Set(candidates.map(function (option) {
        return Number(option && option.id);
      }).filter(function (id) {
        return Number.isFinite(id);
      }));
      const storedId = Number(stored[name]);
      if (Number.isFinite(storedId) && candidateIds.has(storedId)) {
        return {
          name: name,
          selectedId: storedId,
          matchStatus: 'stored',
          candidateCount: candidates.length,
        };
      }

      const exactMatches = candidates.filter(function (option) {
        return normalizeCell(option && option.name) === name;
      });
      if (exactMatches.length === 1) {
        return {
          name: name,
          selectedId: Number(exactMatches[0].id),
          matchStatus: 'auto',
          candidateCount: candidates.length,
        };
      }

      if (candidates.length > 0) {
        return {
          name: name,
          selectedId: '',
          matchStatus: 'ambiguous',
          candidateCount: candidates.length,
        };
      }

      return {
        name: name,
        selectedId: '',
        matchStatus: 'missing',
        candidateCount: 0,
      };
    });
  }

  function buildCreateUserPayload(user, encryptedPassword, options) {
    const departmentMap = options.departmentMap || {};
    const projectMap = options.projectMap || {};
    const normalizedDepartmentName = normalizeCell(user.departmentName);
    const normalizedProjectName = normalizeCell(user.projectName);
    const departmentId = Object.prototype.hasOwnProperty.call(departmentMap, normalizedDepartmentName)
      ? Number(departmentMap[normalizedDepartmentName])
      : Number(options.defaultDepartmentId);
    const projectId = Object.prototype.hasOwnProperty.call(projectMap, normalizedProjectName)
      ? Number(projectMap[normalizedProjectName])
      : NaN;

    return {
      username: normalizeCell(user.username),
      password: encryptedPassword,
      realName: normalizeCell(user.realName),
      email: normalizeCell(user.email),
      phone: normalizeCell(user.phone),
      roleId: Number(options.defaultRoleId),
      departmentId: Number.isFinite(departmentId) ? departmentId : Number(options.defaultDepartmentId),
      status: 1,
      projectMemberList: Number.isFinite(projectId) ? [projectId] : [],
    };
  }

  return {
    COLUMN_MAP: COLUMN_MAP,
    REQUIRED_COLUMNS: REQUIRED_COLUMNS,
    TEMPLATE_SAMPLE_ROWS: TEMPLATE_SAMPLE_ROWS,
    normalizeHeader: normalizeHeader,
    parseWorksheetRows: parseWorksheetRows,
    collectDepartmentNames: collectDepartmentNames,
    collectProjectNames: collectProjectNames,
    flattenDepartmentTree: flattenDepartmentTree,
    buildDepartmentSelectionState: buildDepartmentSelectionState,
    buildProjectSelectionState: buildProjectSelectionState,
    buildCreateUserPayload: buildCreateUserPayload,
  };
});
