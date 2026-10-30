const { Router } = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { query, withTransaction } = require('../db');
const {
  wrap, ok, errParam, errBiz, errNotFound, pageOf, pageData, queryOf, assertPhone,
} = require('../helpers');
const { sendXlsx, dateTime, phoneText } = require('../exporter');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const FACTORY_QUERY_ALIASES = {
  companyCode: 'company_code',
  companyName: 'company_name',
  factoryCode: 'factory_code',
  factoryName: 'factory_name',
  contactPerson: 'contact_person',
};

function factoryWhere(q) {
  const {
    company_code = '', company_name = '', factory_code = '', factory_name = '', contact_person = '',
  } = q;
  const where = ['deleted = 0'];
  const params = [];
  const like = (value) => `%${String(value).trim()}%`;
  if (company_code) where.push('company_code LIKE ?'), params.push(like(company_code));
  if (company_name) where.push('company_name LIKE ?'), params.push(like(company_name));
  if (factory_code) where.push('factory_code LIKE ?'), params.push(like(factory_code));
  if (factory_name) where.push('factory_name LIKE ?'), params.push(like(factory_name));
  if (contact_person) where.push('contact_person LIKE ?'), params.push(like(contact_person));
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

const FACTORY_EXPORT_COLUMNS = [
  { header: '公司编码', value: (r) => r.company_code, width: 18 },
  { header: '公司名称', value: (r) => r.company_name, width: 28 },
  { header: '工厂编码', value: (r) => r.factory_code, width: 18 },
  { header: '工厂名称', value: (r) => r.factory_name, width: 28 },
  { header: '工厂联系人', value: (r) => r.contact_person, width: 16 },
  { header: '工厂联系人电话', value: (r) => phoneText(r.contact_phone), width: 20 },
  { header: '创建时间', value: (r) => dateTime(r.create_time), width: 20 },
];

async function listFactories(req, res) {
  const q = queryOf(req, FACTORY_QUERY_ALIASES);
  const { page, size, offset } = pageOf(q);
  const { whereSql, params } = factoryWhere(q);
  const totalRows = await query(`SELECT COUNT(*) AS n FROM factory ${whereSql}`, params);
  const list = await query(
    `SELECT * FROM factory ${whereSql} ORDER BY create_time DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  ok(res, pageData(list, Number(totalRows[0].n), page, size));
}
router.get('/', wrap(listFactories));
router.post('/queryPage', wrap(listFactories));

async function exportFactories(req, res) {
  const { whereSql, params } = factoryWhere(queryOf(req, FACTORY_QUERY_ALIASES));
  const rows = await query(
    `SELECT * FROM factory ${whereSql} ORDER BY create_time DESC, id DESC LIMIT 50000`,
    params
  );
  sendXlsx(res, { prefix: '工厂管理', sheetName: '工厂', columns: FACTORY_EXPORT_COLUMNS, rows });
}
router.get('/export', wrap(exportFactories));
router.post('/export', wrap(exportFactories));

function requiredText(value, label, maxLength) {
  const textValue = String(value ?? '').trim();
  if (!textValue) throw errParam(`${label}必填`);
  if (textValue.length > maxLength) throw errParam(`${label}不能超过 ${maxLength} 字`);
  return textValue;
}

function normalizeFactoryBody(body) {
  return {
    company_code: requiredText(body.company_code ?? body.companyCode, '公司编码', 32),
    company_name: requiredText(body.company_name ?? body.companyName, '公司名称', 128),
    factory_code: requiredText(body.factory_code ?? body.factoryCode, '工厂编码', 32),
    factory_name: requiredText(body.factory_name ?? body.factoryName, '工厂名称', 128),
    contact_person: requiredText(body.contact_person ?? body.contactPerson, '工厂联系人', 64),
    contact_phone: assertPhone(body.contact_phone ?? body.contactPhone, { label: '工厂联系人电话' }),
  };
}

async function queryRows(conn, sql, params = []) {
  if (!conn) return query(sql, params);
  const [rows] = await conn.query(sql, params);
  return rows;
}

async function assertFactoryCodeUnique(factoryCode, excludeId, conn) {
  const duplicate = await queryRows(
    conn,
    `SELECT id FROM factory WHERE factory_code = ? AND deleted = 0${excludeId ? ' AND id != ?' : ''}`,
    excludeId ? [factoryCode, excludeId] : [factoryCode]
  );
  if (duplicate.length) throw errBiz(`工厂编码 ${factoryCode} 已存在`);
}

async function createFactory(body, conn) {
  const value = normalizeFactoryBody(body);
  await assertFactoryCodeUnique(value.factory_code, null, conn);
  const inserted = await queryRows(
    conn,
    `INSERT INTO factory (
      company_code, company_name, factory_code, factory_name,
      contact_person, contact_phone, create_name, update_name
    ) VALUES (?, ?, ?, ?, ?, ?, '系统管理员', '系统管理员')`,
    [
      value.company_code, value.company_name, value.factory_code, value.factory_name,
      value.contact_person, value.contact_phone,
    ]
  );
  const [created] = await queryRows(conn, 'SELECT * FROM factory WHERE id = ?', [inserted.insertId]);
  return created;
}

router.post('/', wrap(async (req, res) => {
  const created = await withTransaction((conn) => createFactory(req.body, conn));
  ok(res, created, '新增工厂成功');
}));

router.get(['/import/template', '/import-template'], wrap(async (_req, res) => {
  sendXlsx(res, {
    prefix: '工厂导入模板',
    sheetName: '工厂导入',
    columns: FACTORY_IMPORT_COLUMNS,
    rows: [],
  });
}));

router.get('/:id', wrap(async (req, res) => {
  const [factory] = await query('SELECT * FROM factory WHERE id = ? AND deleted = 0', [Number(req.params.id)]);
  if (!factory) throw errNotFound('工厂不存在');
  ok(res, factory);
}));

router.put('/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await query('SELECT * FROM factory WHERE id = ? AND deleted = 0', [id]);
  if (!existing) throw errNotFound('工厂不存在');
  const value = normalizeFactoryBody(req.body);
  await assertFactoryCodeUnique(value.factory_code, id);
  await query(
    `UPDATE factory SET
      company_code = ?, company_name = ?, factory_code = ?, factory_name = ?,
      contact_person = ?, contact_phone = ?, update_name = '系统管理员'
     WHERE id = ?`,
    [
      value.company_code, value.company_name, value.factory_code, value.factory_name,
      value.contact_person, value.contact_phone, id,
    ]
  );
  const [updated] = await query('SELECT * FROM factory WHERE id = ?', [id]);
  ok(res, updated, '工厂信息已保存');
}));

const FACTORY_IMPORT_COLUMNS = [
  { key: 'company_code', header: '公司编码', width: 18, required: true },
  { key: 'company_name', header: '公司名称', width: 28, required: true },
  { key: 'factory_code', header: '工厂编码', width: 18, required: true },
  { key: 'factory_name', header: '工厂名称', width: 28, required: true },
  { key: 'contact_person', header: '工厂联系人', width: 16, required: true },
  { key: 'contact_phone', header: '工厂联系人电话', width: 20, required: true },
];

function importCellValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date || typeof value !== 'object') return value;
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('');
  if (value.result !== undefined) return importCellValue(value.result);
  if (value.text !== undefined) return importCellValue(value.text);
  return '';
}

function importCellText(cell) {
  return String(importCellValue(cell.value) ?? '').trim();
}

router.post('/import', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw errParam('请上传 Excel 文件（multipart 字段名 file）');
  if (!/\.xlsx$/i.test(req.file.originalname || '')) throw errParam('仅支持 .xlsx 格式文件');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(req.file.buffer);
  } catch (_error) {
    throw errParam('Excel 文件解析失败，请确认文件有效且未损坏');
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw errParam('Excel 文件中没有工作表');

  const headerMap = new Map();
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = importCellText(cell).replace(/^\uFEFF/, '').trim();
    if (header) headerMap.set(header, colNumber);
  });
  const missing = FACTORY_IMPORT_COLUMNS.filter((column) => column.required && !headerMap.has(column.header));
  if (missing.length) {
    throw errParam(`导入文件缺少必需列：${missing.map((column) => column.header).join('、')}`);
  }

  const results = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const excelRow = worksheet.getRow(rowNumber);
    const body = {};
    let hasValue = false;
    for (const column of FACTORY_IMPORT_COLUMNS) {
      const colNumber = headerMap.get(column.header);
      const cell = colNumber ? excelRow.getCell(colNumber) : null;
      const value = cell ? importCellText(cell) : '';
      body[column.key] = value;
      if (value !== '') hasValue = true;
    }
    if (!hasValue) continue;
    try {
      const created = await withTransaction((conn) => createFactory(body, conn));
      results.push({ row: rowNumber, success: true, code: '00000', message: '导入成功', factoryId: created.id });
    } catch (error) {
      const duplicate = error.code === 'ER_DUP_ENTRY';
      const code = duplicate ? 'A0002' : (/^[A-D]\d{4}$/.test(String(error.code ?? '')) ? error.code : 'B0001');
      const message = duplicate ? '工厂编码已存在' : (error.message || '导入失败');
      results.push({ row: rowNumber, success: false, code, message });
    }
  }

  if (!results.length) throw errParam('导入文件没有可处理的数据行');
  const success = results.filter((result) => result.success).length;
  const failed = results.length - success;
  ok(res, { total: results.length, success, failed, results }, `工厂导入完成：成功 ${success} 条，失败 ${failed} 条`);
}));

module.exports = router;
