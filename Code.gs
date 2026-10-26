const SYNC_TABLES = {
  students: { keys: [['admis_no']] },
  increments: { keys: [['id'], ['admis_no']] },
  fees: { keys: [['voucher_id', 'type', 'period']] },
  accounts: { keys: [['voucher_id']] },
  settings: { keys: [['setting_key', 'setting_value']] },
  books: { keys: [['id']] },
  staff: { keys: [['staff_id'], ['id']] },
  payroll: { keys: [['staff_id', 'month']] },
  staff_attendance: { keys: [['staff_id', 'attendance_date']] },
  call_logs: { keys: [['id']] }
};

const SYNC_META_COLUMN = '__sync_key';
const SUPABASE_PAGE_SIZE = 1000;
const DATE_ONLY_COLUMNS = new Set([
  'date', 'doj', 'left_date', 'joining_date', 'leaving_date', 'paid_date',
  'attendance_date', 'promise_date'
]);

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Supabase Sync')
    .addItem('Create all table tabs from Supabase', 'createAllTableSheets')
    .addItem('Sync current sheet', 'syncCurrentSheet')
    .addItem('Sync all table sheets', 'syncAllSheets')
    .addSeparator()
    .addItem('Export current table from Supabase', 'exportCurrentTable')
    .addItem('Export all tables from Supabase', 'exportAllTables')
    .addToUi();
}

function createAllTableSheets() {
  withUiErrors_(function () {
    const ss = SpreadsheetApp.getActive();
    const created = [];
    const skipped = [];
    const issues = [];

    Object.keys(SYNC_TABLES).forEach(function (table) {
      try {
        exportTable_(table);
        const exportSheet = ss.getSheetByName(`Supabase_${table}`);
        let workingSheet = ss.getSheetByName(table);
        if (workingSheet && (workingSheet.getLastRow() > 0 || workingSheet.getLastColumn() > 0)) {
          skipped.push(table);
          return;
        }
        if (!workingSheet) workingSheet = ss.insertSheet(table);

        const data = exportSheet.getDataRange().getValues();
        if (workingSheet.getMaxRows() < data.length) {
          workingSheet.insertRowsAfter(workingSheet.getMaxRows(), data.length - workingSheet.getMaxRows());
        }
        if (workingSheet.getMaxColumns() < data[0].length) {
          workingSheet.insertColumnsAfter(workingSheet.getMaxColumns(), data[0].length - workingSheet.getMaxColumns());
        }
        workingSheet.getRange(1, 1, data.length, data[0].length).setValues(data);
        workingSheet.setFrozenRows(1);
        workingSheet.hideColumns(data[0].length);
        created.push(table);
      } catch (error) {
        issues.push(`${table}: ${error.message}`);
      }
    });

    const lines = [
      `Created and populated: ${created.length ? created.join(', ') : 'none'}.`,
      skipped.length ? `Kept existing tabs unchanged: ${skipped.join(', ')}.` : '',
      issues.length ? `Could not export/create:\n${issues.join('\n')}` : ''
    ].filter(Boolean);
    SpreadsheetApp.getUi().alert('Table tabs', lines.join('\n\n'), SpreadsheetApp.getUi().ButtonSet.OK);
  });
}

function syncCurrentSheet() {
  withUiErrors_(function () {
    const sheet = SpreadsheetApp.getActiveSheet();
    const table = tableForSheet_(sheet);
    const result = syncSheet_(sheet, table);
    SpreadsheetApp.getUi().alert(
      'Sync complete',
      `${table}: ${result.inserted} inserted, ${result.updated} updated, ${result.unchanged} unchanged.`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  });
}

function syncAllSheets() {
  withUiErrors_(function () {
    const ss = SpreadsheetApp.getActive();
    const totals = { inserted: 0, updated: 0, unchanged: 0 };
    const issues = [];
    let syncedSheets = 0;

    Object.keys(SYNC_TABLES).forEach(function (table) {
      const sheet = ss.getSheetByName(table);
      if (!sheet) return;
      syncedSheets++;
      try {
        const result = syncSheet_(sheet, table);
        totals.inserted += result.inserted;
        totals.updated += result.updated;
        totals.unchanged += result.unchanged;
      } catch (error) {
        issues.push(`${table}: ${error.message}`);
      }
    });
    if (!syncedSheets) throw new Error(`No table tabs found. Name tabs exactly after a supported table: ${Object.keys(SYNC_TABLES).join(', ')}.`);

    const message = `${totals.inserted} inserted, ${totals.updated} updated, ${totals.unchanged} unchanged.` +
      (issues.length ? `\n\nNot synced:\n${issues.join('\n')}` : '');
    issues.forEach(function (issue) { console.error(issue); });
    SpreadsheetApp.getUi().alert('Sync all sheets', message, SpreadsheetApp.getUi().ButtonSet.OK);
  });
}

function exportCurrentTable() {
  withUiErrors_(function () {
    const table = tableForSheet_(SpreadsheetApp.getActiveSheet());
    exportTable_(table);
    SpreadsheetApp.getUi().alert(`Supabase_${table} is ready with the current Supabase data.`);
  });
}

function exportAllTables() {
  withUiErrors_(function () {
    const errors = [];
    Object.keys(SYNC_TABLES).forEach(function (table) {
      try {
        exportTable_(table);
      } catch (error) {
        errors.push(`${table}: ${error.message}`);
      }
    });
    if (errors.length) throw new Error(`Some tables could not be exported:\n${errors.join('\n')}`);
    SpreadsheetApp.getUi().alert('All operational Supabase tables have been exported to Supabase_* tabs.');
  });
}

function withUiErrors_(action) {
  try {
    action();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    SpreadsheetApp.getUi().alert('Supabase operation failed', String(error.message || error), SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function tableForSheet_(sheet) {
  const name = sheet.getName();
  const table = name.indexOf('Supabase_') === 0 ? name.slice('Supabase_'.length) : name;
  if (!Object.prototype.hasOwnProperty.call(SYNC_TABLES, table)) {
    throw new Error(`Active sheet "${name}" is not a supported table sheet. Use a table name or its Supabase_<table> export.`);
  }
  return table;
}

function supabaseConfig_() {
  const props = PropertiesService.getScriptProperties();
  const config = {
    url: String(props.getProperty('SUPABASE_URL') || '').replace(/\/+$/, ''),
    anonKey: props.getProperty('SUPABASE_ANON_KEY'),
    email: props.getProperty('SUPABASE_EMAIL'),
    password: props.getProperty('SUPABASE_PASSWORD')
  };
  const missing = Object.keys(config).filter(function (key) { return !config[key]; });
  if (missing.length) {
    throw new Error(`Set these Script Properties before using sync: ${missing.map(function (key) {
      return ({ url: 'SUPABASE_URL', anonKey: 'SUPABASE_ANON_KEY', email: 'SUPABASE_EMAIL', password: 'SUPABASE_PASSWORD' })[key];
    }).join(', ')}.`);
  }
  return config;
}

function accessToken_() {
  const config = supabaseConfig_();
  const response = UrlFetchApp.fetch(`${config.url}/auth/v1/token?grant_type=password`, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: config.anonKey },
    payload: JSON.stringify({ email: config.email, password: config.password }),
    muteHttpExceptions: true
  });
  const body = parseResponse_(response, 'Supabase sign-in');
  if (!body.access_token) throw new Error('Supabase sign-in did not return an access token.');
  return { config: config, token: body.access_token };
}

function request_(session, path, options) {
  const settings = options || {};
  const response = UrlFetchApp.fetch(`${session.config.url}${path}`, {
    method: settings.method || 'get',
    contentType: settings.contentType || 'application/json',
    headers: Object.assign({
      apikey: session.config.anonKey,
      Authorization: `Bearer ${session.token}`
    }, settings.headers || {}),
    payload: settings.payload,
    muteHttpExceptions: true
  });
  return response;
}

function parseResponse_(response, label) {
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code < 200 || code >= 300) {
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.message || parsed.details || parsed.hint || parsed.error_description || text;
    } catch (ignored) {}
    throw new Error(`${label} failed (${code}): ${detail}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${text.slice(0, 300)}`);
  }
}

function getAllRows_(session, table) {
  const probe = parseResponse_(
    request_(session, `/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`),
    `Read ${table}`
  );
  if (!Array.isArray(probe)) throw new Error(`Supabase returned a non-array response for ${table}.`);
  if (!probe.length) return [];
  const stableKeys = availableKeys_(table, probe[0]);
  const order = usableKey_(probe[0], stableKeys)
    ? `&order=${encodeURIComponent(stableKeys.map(function (key) { return `${key}.asc`; }).join(','))}`
    : '';
  const rows = [];
  for (let offset = 0; ; offset += SUPABASE_PAGE_SIZE) {
    const path = `/rest/v1/${encodeURIComponent(table)}?select=*&limit=${SUPABASE_PAGE_SIZE}&offset=${offset}${order}`;
    const page = parseResponse_(request_(session, path), `Read ${table}`);
    if (!Array.isArray(page)) throw new Error(`Supabase returned a non-array response for ${table}.`);
    rows.push.apply(rows, page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }
  return rows;
}

function availableKeys_(table, row) {
  const candidates = SYNC_TABLES[table].keys;
  return candidates.find(function (candidate) {
    return candidate.every(function (key) {
      return Object.prototype.hasOwnProperty.call(row, key) &&
        row[key] !== null && row[key] !== undefined && String(row[key]).trim() !== '';
    });
  }) || candidates.find(function (candidate) {
    return candidate.every(function (key) { return Object.prototype.hasOwnProperty.call(row, key); });
  }) || null;
}

function keyValues_(row, columns) {
  const result = {};
  columns.forEach(function (column) { result[column] = row[column]; });
  return result;
}

function usableKey_(row, columns) {
  return columns && columns.every(function (column) {
    return row[column] !== null && row[column] !== undefined && String(row[column]).trim() !== '';
  });
}

function stableValue_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function rowKey_(row, columns) {
  return JSON.stringify(columns.map(function (column) { return stableValue_(row[column]); }));
}

function identityMapKey_(row, columns) {
  return JSON.stringify([columns, rowKey_(row, columns)]);
}

function identityOptions_(table, row) {
  return SYNC_TABLES[table].keys.filter(function (columns) {
    return columns.every(function (column) { return Object.prototype.hasOwnProperty.call(row, column); }) &&
      usableKey_(row, columns);
  });
}

function indexRecord_(index, table, record) {
  identityOptions_(table, record).forEach(function (columns) {
    const key = identityMapKey_(record, columns);
    const previous = index.get(key);
    if (previous && previous !== record) {
      throw new Error(`${table} has duplicate records with the same identity fields (${columns.join(', ')}); no data was synced. Resolve duplicates first.`);
    }
    index.set(key, record);
  });
}

function unindexRecord_(index, table, record) {
  identityOptions_(table, record).forEach(function (columns) {
    const key = identityMapKey_(record, columns);
    if (index.get(key) === record) index.delete(key);
  });
}

function assertNoIdentityCollision_(index, table, record, allowedRecord) {
  identityOptions_(table, record).forEach(function (columns) {
    const existing = index.get(identityMapKey_(record, columns));
    if (existing && existing !== allowedRecord) {
      throw new Error(`${table} identity fields (${columns.join(', ')}) already belong to another record.`);
    }
  });
}

function parseIdentity_(value) {
  if (!value) return null;
  try {
    const identity = JSON.parse(value);
    if (!identity || typeof identity !== 'object' || typeof identity.table !== 'string' ||
        !identity.values || typeof identity.values !== 'object' || Array.isArray(identity.values)) {
      throw new Error('invalid identity shape');
    }
    return identity;
  } catch (error) {
    throw new Error(`Invalid ${SYNC_META_COLUMN} value. Do not edit this hidden sync column.`);
  }
}

function sheetValues_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (!data.length || data.length < 1) throw new Error(`Sheet "${sheet.getName()}" needs a header row.`);
  const headers = data[0].map(function (cell) { return String(cell).trim(); });
  if (!headers.some(Boolean)) throw new Error(`Sheet "${sheet.getName()}" needs column names in row 1.`);
  if (headers.filter(function (header) { return header === SYNC_META_COLUMN; }).length > 1) {
    throw new Error(`Only one ${SYNC_META_COLUMN} column is allowed.`);
  }
  return { data: data, headers: headers };
}

function syncSheet_(sheet, table) {
  const session = accessToken_();
  const allRemote = getAllRows_(session, table);
  const sheetData = sheetValues_(sheet);
  let headers = sheetData.headers;
  let metaIndex = headers.indexOf(SYNC_META_COLUMN);
  if (metaIndex < 0) {
    metaIndex = headers.length;
    headers.push(SYNC_META_COLUMN);
    sheet.getRange(1, metaIndex + 1).setValue(SYNC_META_COLUMN);
    sheet.hideColumns(metaIndex + 1);
  }

  const dataHeaders = headers.filter(function (header) { return header && header !== SYNC_META_COLUMN; });
  const existingByKey = new Map();
  allRemote.forEach(function (record) {
    indexRecord_(existingByKey, table, record);
  });

  const seen = new Set();
  const result = { inserted: 0, updated: 0, unchanged: 0 };
  const outputMeta = [];

  try {
    for (let rowIndex = 1; rowIndex < sheetData.data.length; rowIndex++) {
      const row = sheetData.data[rowIndex];
      const input = {};
      dataHeaders.forEach(function (header) {
        const columnIndex = headers.indexOf(header);
        if (columnIndex >= 0 && columnIndex < row.length) {
          input[header] = normalizeCell_(row[columnIndex], header);
        }
      });
      const isEmpty = dataHeaders.every(function (header) {
        return input[header] === null || input[header] === undefined || input[header] === '';
      });
      if (isEmpty) {
        outputMeta.push([row[metaIndex] || '']);
        continue;
      }

      const storedIdentity = parseIdentity_(row[metaIndex]);
      if (storedIdentity && storedIdentity.table !== table) {
        throw new Error(`${table} row ${rowIndex + 1} has sync metadata for another table. Re-export this table before syncing.`);
      }
      const oldKeyValues = storedIdentity ? storedIdentity.values : null;
      const keys = oldKeyValues
        ? SYNC_TABLES[table].keys.find(function (candidate) {
            return candidate.length === Object.keys(oldKeyValues).length &&
              candidate.every(function (key) { return Object.prototype.hasOwnProperty.call(oldKeyValues, key); });
          })
        : availableKeys_(table, input);
      if (!keys) throw new Error(`Sheet "${sheet.getName()}" must include an identity column for ${table}.`);
      const lookup = oldKeyValues || input;
      if (!usableKey_(lookup, keys)) {
        throw new Error(`${table} row ${rowIndex + 1} has an empty identity key (${keys.join(', ')}).`);
      }
      const lookupKey = identityMapKey_(lookup, keys);
      if (!usableKey_(input, keys)) {
        throw new Error(`${table} row ${rowIndex + 1} must keep a value for each identity field (${keys.join(', ')}).`);
      }

      const inputIdentities = identityOptions_(table, input);
      if (!inputIdentities.length) {
        throw new Error(`${table} row ${rowIndex + 1} has no complete identity key.`);
      }
      inputIdentities.forEach(function (columns) {
        const key = identityMapKey_(input, columns);
        if (seen.has(key)) {
          throw new Error(`${table} contains duplicate destination identity keys near row ${rowIndex + 1}.`);
        }
        seen.add(key);
      });

      const existing = existingByKey.get(lookupKey);
      let action;
      let savedRecord;
      if (oldKeyValues && !existing) {
        throw new Error(`${table} row ${rowIndex + 1} was exported from Supabase but its original record no longer exists. Refresh the export before syncing.`);
      } else if (existing) {
        const patch = {};
        dataHeaders.forEach(function (header) {
          if (!Object.prototype.hasOwnProperty.call(input, header)) return;
          if (stableValue_(input[header]) !== stableValue_(existing[header])) patch[header] = input[header];
        });
        keys.forEach(function (key) { patch[key] = input[key]; });
        const changes = Object.keys(patch).filter(function (key) {
          return stableValue_(patch[key]) !== stableValue_(existing[key]);
        });
        if (!changes.length) {
          action = 'unchanged';
          savedRecord = existing;
        } else {
          assertNoIdentityCollision_(existingByKey, table, input, existing);
          const response = request_(session, `/rest/v1/${encodeURIComponent(table)}?${filterQuery_(lookup, keys)}`, {
            method: 'patch',
            headers: { Prefer: 'return=representation' },
            payload: JSON.stringify(patch)
          });
          const updatedRows = parseResponse_(response, `Update ${table} row ${rowIndex + 1}`);
          if (!Array.isArray(updatedRows) || updatedRows.length !== 1) {
            throw new Error(`Expected to update exactly one ${table} record at row ${rowIndex + 1}; Supabase returned ${Array.isArray(updatedRows) ? updatedRows.length : 0}.`);
          }
          action = 'updated';
          savedRecord = updatedRows[0];
          unindexRecord_(existingByKey, table, existing);
        }
      } else {
        assertNoIdentityCollision_(existingByKey, table, input, null);
        const insert = {};
        dataHeaders.forEach(function (header) {
          if (Object.prototype.hasOwnProperty.call(input, header) &&
              input[header] !== null && input[header] !== undefined && input[header] !== '') {
            insert[header] = input[header];
          }
        });
        const response = request_(session, `/rest/v1/${encodeURIComponent(table)}`, {
          method: 'post',
          headers: { Prefer: 'return=representation' },
          payload: JSON.stringify(insert)
        });
        const insertedRows = parseResponse_(response, `Insert ${table} row ${rowIndex + 1}`);
        if (!Array.isArray(insertedRows) || insertedRows.length !== 1) {
          throw new Error(`Expected Supabase to insert exactly one ${table} record at row ${rowIndex + 1}.`);
        }
        action = 'inserted';
        savedRecord = insertedRows[0];
      }

      result[action]++;
      const savedKeys = availableKeys_(table, savedRecord);
      const nextIdentity = savedKeys && usableKey_(savedRecord, savedKeys)
        ? { table: table, values: keyValues_(savedRecord, savedKeys) }
        : '';
      outputMeta.push([nextIdentity ? JSON.stringify(nextIdentity) : '']);
      if (action !== 'unchanged') indexRecord_(existingByKey, table, savedRecord);
    }
  } catch (error) {
    writeSyncMetadata_(sheet, metaIndex, outputMeta);
    throw error;
  }

  writeSyncMetadata_(sheet, metaIndex, outputMeta);
  return result;
}

function writeSyncMetadata_(sheet, metaIndex, outputMeta) {
  if (outputMeta.length) sheet.getRange(2, metaIndex + 1, outputMeta.length, 1).setValues(outputMeta);
}

function normalizeCell_(value, column) {
  if (value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if ((trimmed[0] === '{' && trimmed[trimmed.length - 1] === '}') ||
        (trimmed[0] === '[' && trimmed[trimmed.length - 1] === ']')) {
      try { return JSON.parse(trimmed); } catch (ignored) {}
    }
    return trimmed;
  }
  if (value instanceof Date) {
    const timeZone = Session.getScriptTimeZone();
    return DATE_ONLY_COLUMNS.has(column)
      ? Utilities.formatDate(value, timeZone, 'yyyy-MM-dd')
      : Utilities.formatDate(value, timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return value;
}

function filterQuery_(record, columns) {
  return columns.map(function (column) {
    return `${encodeURIComponent(column)}=eq.${encodeURIComponent(String(record[column]))}`;
  }).join('&');
}

function exportTable_(table) {
  if (!Object.prototype.hasOwnProperty.call(SYNC_TABLES, table)) throw new Error(`Unsupported table: ${table}`);
  const session = accessToken_();
  const records = getAllRows_(session, table);
  const ss = SpreadsheetApp.getActive();
  const sheetName = `Supabase_${table}`;
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  else sheet.clearContents();

  const columns = records.length
    ? Object.keys(records[0])
    : existingColumns_(ss.getSheetByName(table)).length
      ? existingColumns_(ss.getSheetByName(table))
      : getTableColumnsFromOpenApi_(session, table);
  if (!columns.length) throw new Error(`No rows were returned for ${table}, and there is no ${table} sheet from which to read column names.`);

  const headers = columns.concat([SYNC_META_COLUMN]);
  const output = [headers];
  records.forEach(function (record) {
    const keys = availableKeys_(table, record);
    const identity = keys && usableKey_(record, keys)
      ? JSON.stringify({ table: table, values: keyValues_(record, keys) })
      : '';
    output.push(columns.map(function (column) { return cellForSheet_(record[column]); }).concat([identity]));
  });
  if (sheet.getMaxRows() < output.length) {
    sheet.insertRowsAfter(sheet.getMaxRows(), output.length - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  sheet.getRange(1, 1, output.length, headers.length).setValues(output);
  sheet.setFrozenRows(1);
  sheet.hideColumns(headers.length);
  sheet.autoResizeColumns(1, columns.length);
}

function getTableColumnsFromOpenApi_(session, table) {
  const document = parseResponse_(request_(session, '/rest/v1/'), 'Read Supabase table schema');
  const definition = (document.definitions && document.definitions[table]) ||
    (document.components && document.components.schemas && document.components.schemas[table]);
  return definition && definition.properties ? Object.keys(definition.properties) : [];
}

function existingColumns_(sheet) {
  if (!sheet || !sheet.getLastColumn()) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (header) { return String(header).trim(); })
    .filter(function (header) { return header && header !== SYNC_META_COLUMN; });
}

function cellForSheet_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return safeSheetText_(JSON.stringify(value));
  if (typeof value === 'string') return safeSheetText_(value);
  return value;
}

function safeSheetText_(value) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
