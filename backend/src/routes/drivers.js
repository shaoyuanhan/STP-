/**
 * 基础数据 - 司机管理（契约 5.3）
 * 规则：姓名/身份证不可改(A0002)；司机档案归属于唯一承运商（driver.carrier_id），
 *       同一司机在多家承运商下是各自独立的档案；
 *       停用后不可分派任务、不影响在途运单；外部狮桥同步 source=2，自建 source=1
 */
const { Router } = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { query, withTransaction } = require('../db');
const {
  wrap, ok, errParam, errBiz, errNotFound, pageOf, pageData, queryOf,
  assertPhone, assertIdCard,
} = require('../helpers');
const { sendXlsx, text, dateOnly, dateTime, phoneText } = require('../exporter');

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/** 行后处理：carrier_id 统一成数字，carrier_name 为空时给空串便于前端直接展示 */
function decorateDriver(row) {
  return {
    ...row,
    carrier_id: row.carrier_id === null || row.carrier_id === undefined ? null : Number(row.carrier_id),
    carrier_name: row.carrier_name || '',
  };
}

/** 列表与导出共用的筛选条件（姓名/手机号/身份证号/驾驶证号/第三方ID/承运商/来源/状态） */
function driverWhere(q) {
  const {
    driver_name = '', phone = '', id_card = '', license_no = '',
    external_driver_id = '', carrier_id = '', source = '', status = '',
  } = q;
  const where = ['d.deleted = 0'];
  const params = [];
  const kw = (v) => `%${String(v).trim()}%`;
  if (driver_name) where.push('d.driver_name LIKE ?'), params.push(kw(driver_name));
  if (phone) where.push('d.phone LIKE ?'), params.push(kw(phone));
  if (id_card) where.push('d.id_card LIKE ?'), params.push(kw(id_card));
  if (license_no) where.push('d.license_no LIKE ?'), params.push(kw(license_no));
  if (external_driver_id) where.push('d.external_driver_id LIKE ?'), params.push(kw(external_driver_id));
  if (carrier_id) {
    where.push('d.carrier_id = ?');
    params.push(Number(carrier_id));
  }
  if (source !== '' && source !== undefined && source !== null) {
    where.push('d.source = ?');
    params.push(Number(source));
  }
  if (status !== '' && status !== undefined && status !== null) {
    where.push('d.status = ?');
    params.push(Number(status));
  }
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

/** 导出列（与列表展示一致） */
const DRIVER_EXPORT_COLUMNS = [
  { header: '姓名', value: (r) => r.driver_name, width: 12 },
  { header: '第三方司机ID', value: (r) => text(r.external_driver_id), width: 20 },
  { header: '手机号', value: (r) => phoneText(r.phone), width: 16 },
  { header: '身份证号', value: (r) => r.id_card, width: 22 },
  { header: '驾驶证号', value: (r) => text(r.license_no), width: 22 },
  { header: '准驾车型', value: (r) => text(r.license_type), width: 10 },
  { header: '有效期自', value: (r) => dateOnly(r.license_valid_from), width: 12 },
  { header: '有效期至', value: (r) => dateOnly(r.license_valid_to), width: 12 },
  { header: '所属承运商', value: (r) => text(r.carrier_name) || '-', width: 28 },
  { header: '来源', value: (r) => ({ 1: '系统录入', 2: '狮桥同步' }[Number(r.source)] || '-'), width: 12 },
  { header: '状态', value: (r) => (Number(r.status) === 1 ? '启用' : '停用'), width: 8 },
  { header: '创建时间', value: (r) => dateTime(r.create_time), width: 20 },
];

/** 导入模板列；required 表示表头必须存在，第三方司机ID等选填列可留空 */
const DRIVER_IMPORT_COLUMNS = [
  { key: 'name', header: '司机姓名', width: 12, required: true },
  { key: 'phone', header: '手机号', width: 16, required: true },
  { key: 'id_card', header: '身份证号', width: 22, required: true },
  { key: 'carrier_code', header: '承运商编码', width: 16, required: true },
  { key: 'license_no', header: '驾驶证号', width: 22 },
  { key: 'license_type', header: '准驾车型', width: 10 },
  { key: 'license_valid_from', header: '驾驶证有效期自', width: 18, required: true, date: true },
  { key: 'license_valid_to', header: '驾驶证有效期至', width: 18, required: true, date: true },
  { key: 'external_driver_id', header: '第三方司机ID', width: 20 },
  { key: 'remark', header: '备注', width: 30 },
];

/** 列表/导出/详情共用的查询主体：司机 + 所属承运商名 */
const DRIVER_SELECT = `
  SELECT d.*, c.carrier_name AS carrier_name
  FROM driver d
  LEFT JOIN carrier c ON c.id = d.carrier_id AND c.deleted = 0`;

const DRIVER_QUERY_ALIASES = {
  driverName: 'driver_name',
  idCard: 'id_card',
  externalDriverId: 'external_driver_id',
  carrierId: 'carrier_id',
};

/** 列表：按字段分项筛选 + 关联承运商名称 */
async function listDrivers(req, res) {
  const q = queryOf(req, DRIVER_QUERY_ALIASES);
  const { page, size, offset } = pageOf(q);
  const { whereSql, params } = driverWhere(q);

  const totalRows = await query(`SELECT COUNT(*) AS n FROM driver d ${whereSql}`, params);
  const list = await query(
    `${DRIVER_SELECT}
     ${whereSql}
     ORDER BY d.create_time DESC, d.id DESC
     LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  ok(res, pageData(list.map(decorateDriver), Number(totalRows[0].n), page, size));
}
router.get('/', wrap(listDrivers));
router.post('/queryPage', wrap(listDrivers));

/** 导出：按当前筛选条件导出全部（不分页） */
async function exportDrivers(req, res) {
  const { whereSql, params } = driverWhere(queryOf(req, DRIVER_QUERY_ALIASES));
  const rows = await query(
    `${DRIVER_SELECT}
     ${whereSql}
     ORDER BY d.create_time DESC, d.id DESC
     LIMIT 50000`,
    params
  );
  sendXlsx(res, {
    prefix: '司机管理',
    sheetName: '司机',
    columns: DRIVER_EXPORT_COLUMNS,
    rows: rows.map(decorateDriver),
  });
}
router.get('/export', wrap(exportDrivers));
router.post('/export', wrap(exportDrivers));

/** 导入模板：仅生成表头，导入时按表头名称定位列 */
router.get(['/import/template', '/import-template'], wrap(async (req, res) => {
  sendXlsx(res, {
    prefix: '司机导入模板',
    sheetName: '司机导入',
    columns: DRIVER_IMPORT_COLUMNS,
    rows: [],
  });
}));

/** 可选司机下拉：该承运商下启用的司机 */
router.get('/options', wrap(async (req, res) => {
  const { carrier_id = '' } = req.query;
  let list;
  if (carrier_id) {
    list = await query(
      `SELECT d.id, d.driver_name AS name, d.phone, d.license_type, d.external_driver_id
       FROM driver d
       WHERE d.carrier_id = ? AND d.deleted = 0 AND d.status = 1
       ORDER BY d.id`,
      [Number(carrier_id)]
    );
  } else {
    list = await query(
      `SELECT d.id, d.driver_name AS name, d.phone, d.license_type, d.external_driver_id
       FROM driver d WHERE d.deleted = 0 AND d.status = 1 ORDER BY d.id`
    );
  }
  ok(res, list);
}));

/** 校验驾驶证有效期起止顺序，倒置抛 A0001 */
function assertLicenseRange(from, to) {
  if (!from) throw errParam('驾驶证有效期自必填');
  if (!to) throw errParam('驾驶证有效期至必填');
  if (String(from) > String(to)) {
    throw errParam(`驾驶证有效期起（${from}）不能晚于有效期止（${to}）`);
  }
}

/** 校验并归一化司机入参（新增/编辑共用，不含姓名身份证不可改校验） */
function normalizeDriverBody(body) {
  const phone = assertPhone(body.phone, { label: '手机号', mobileOnly: true });
  const id_card = assertIdCard(body.id_card ?? body.idCard, { label: '身份证号' });
  const license_valid_from = body.license_valid_from ?? body.licenseValidFrom;
  const license_valid_to = body.license_valid_to ?? body.licenseValidTo;
  assertLicenseRange(license_valid_from, license_valid_to);
  const license_no = (body.license_no ?? body.licenseNo)?.toString().trim() || null;
  const license_type = (body.license_type ?? body.licenseType)?.toString().trim() || null;
  const remark = body.remark?.toString().trim() || null;
  const external_driver_id = (body.external_driver_id ?? body.externalDriverId)?.toString().trim() || null;
  if (external_driver_id && external_driver_id.length > 64) throw errParam('第三方司机ID不能超过 64 字');
  const carrier_id = Number(body.carrier_id ?? body.carrierId);
  if (!Number.isInteger(carrier_id) || carrier_id <= 0) throw errParam('所属承运商必填');
  return {
    phone, id_card, license_no, license_type, license_valid_from, license_valid_to,
    remark, carrier_id, external_driver_id,
  };
}

/** 普通查询与事务查询共用相同的行结果结构 */
async function queryRows(conn, sql, params = []) {
  if (!conn) return query(sql, params);
  const [rows] = await conn.query(sql, params);
  return rows;
}

/** 所属承运商必须存在 */
async function assertCarrierExists(carrierId, conn) {
  const rows = await queryRows(conn, 'SELECT id, carrier_name FROM carrier WHERE id = ? AND deleted = 0', [carrierId]);
  if (!rows.length) throw errNotFound(`承运商不存在（ID: ${carrierId}）`);
  return rows[0];
}

/** 第三方司机ID去重（A0002）：承运商内唯一 */
async function assertExternalDriverIdUnique(externalDriverId, carrierId, excludeId, conn) {
  if (!externalDriverId) return;
  const dup = await queryRows(
    conn,
    `SELECT id FROM driver WHERE carrier_id = ? AND external_driver_id = ? AND deleted = 0${excludeId ? ' AND id != ?' : ''}`,
    excludeId ? [carrierId, externalDriverId, excludeId] : [carrierId, externalDriverId]
  );
  if (dup.length) throw errBiz(`第三方司机ID ${externalDriverId} 已被本承运商其他司机使用`);
}

/** 新增校验与写入供单条新增、Excel 导入共用 */
async function createDriver(body, conn) {
  const name = String(body.name ?? body.driverName ?? '').trim();
  if (!name) throw errParam('司机姓名必填');
  if (name.length > 64) throw errParam('司机姓名不能超过 64 字');
  const v = normalizeDriverBody(body);
  await assertCarrierExists(v.carrier_id, conn);

  const dup = await queryRows(
    conn,
    'SELECT id FROM driver WHERE carrier_id = ? AND id_card = ? AND deleted = 0',
    [v.carrier_id, v.id_card]
  );
  if (dup.length) throw errBiz('该承运商下已存在相同身份证号的司机，请勿重复添加');
  await assertExternalDriverIdUnique(v.external_driver_id, v.carrier_id, null, conn);

  const inserted = await queryRows(
    conn,
    `INSERT INTO driver (driver_name, external_driver_id, phone, id_card, carrier_id, license_no, license_type, license_valid_from, license_valid_to, source, status, remark, create_name, update_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, '系统管理员', '系统管理员')`,
    [name, v.external_driver_id, v.phone, v.id_card, v.carrier_id, v.license_no, v.license_type, v.license_valid_from, v.license_valid_to, v.remark]
  );
  const [created] = await queryRows(conn, `${DRIVER_SELECT} WHERE d.id = ?`, [inserted.insertId]);
  return created ? decorateDriver(created) : null;
}

/** 新增司机：source=1 自建；同一承运商内身份证唯一(A0002) */
router.post('/', wrap(async (req, res) => {
  const created = await createDriver(req.body);
  ok(res, created);
}));

/** Excel 日期单元格统一转成数据库 DATE 使用的 YYYY-MM-DD */
function formatExcelDate(value) {
  if (Number.isNaN(value.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

/** 展开 ExcelJS 的富文本、超链接和公式结果单元格 */
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

function importCellDate(cell) {
  const value = importCellValue(cell.value);
  if (!value) return '';
  if (value instanceof Date) return formatExcelDate(value);
  const valueText = String(value).trim();
  const matched = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T].*)?$/.exec(valueText);
  if (!matched) return valueText;
  return `${matched[1]}-${matched[2].padStart(2, '0')}-${matched[3].padStart(2, '0')}`;
}

/** 按承运商编码定位唯一所属承运商，再走现有新增校验与写入 */
async function importDriverRow(conn, body) {
  const carrierCode = String(body.carrier_code ?? '').trim();
  if (!carrierCode) throw errParam('承运商编码必填');
  const carriers = await queryRows(
    conn,
    'SELECT id FROM carrier WHERE carrier_code = ? AND deleted = 0',
    [carrierCode]
  );
  if (!carriers.length) throw errNotFound(`承运商编码 ${carrierCode} 对应的承运商不存在`);
  const created = await createDriver({ ...body, carrier_id: Number(carriers[0].id) }, conn);
  if (!created) throw new Error('司机新增后读取详情失败');
  return created;
}

/** Excel 导入：逐行校验、逐行独立事务，失败行不影响其他行 */
router.post('/import', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw errParam('请上传 Excel 文件（multipart 字段名 file）');
  if (!/\.xlsx$/i.test(req.file.originalname || '')) throw errParam('仅支持 .xlsx 格式文件');

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(req.file.buffer);
  } catch (e) {
    throw errParam('Excel 文件解析失败，请确认文件有效且未损坏');
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw errParam('Excel 文件中没有工作表');

  const headerMap = new Map();
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = importCellText(cell).replace(/^\uFEFF/, '').trim();
    if (header) headerMap.set(header, colNumber);
  });
  const missing = DRIVER_IMPORT_COLUMNS.filter((column) => column.required && !headerMap.has(column.header));
  if (missing.length) {
    throw errParam(`导入文件缺少必需列：${missing.map((column) => column.header).join('、')}`);
  }

  const results = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const excelRow = worksheet.getRow(rowNumber);
    const body = {};
    let hasValue = false;
    for (const column of DRIVER_IMPORT_COLUMNS) {
      const colNumber = headerMap.get(column.header);
      const cell = colNumber ? excelRow.getCell(colNumber) : null;
      const value = cell
        ? (column.date ? importCellDate(cell) : importCellText(cell))
        : '';
      body[column.key] = value;
      if (value !== '') hasValue = true;
    }
    if (!hasValue) continue;

    try {
      const created = await withTransaction((conn) => importDriverRow(conn, body));
      results.push({ row: rowNumber, success: true, code: '00000', message: '导入成功', driverId: created.id });
    } catch (err) {
      const dup = err.code === 'ER_DUP_ENTRY';
      const code = dup ? 'A0002' : (/^[A-D]\d{4}$/.test(String(err.code ?? '')) ? err.code : 'B0001');
      const message = dup ? '该承运商下身份证号或第三方司机ID已存在' : (err.message || '导入失败');
      results.push({ row: rowNumber, success: false, code, message });
    }
  }

  if (!results.length) throw errParam('导入文件没有可处理的数据行');
  const success = results.filter((result) => result.success).length;
  const failed = results.length - success;
  ok(res, { total: results.length, success, failed, results }, `司机导入完成：成功 ${success} 条，失败 ${failed} 条`);
}));

/** 司机详情：与列表、新增、编辑返回相同字段 */
router.get('/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [driver] = await query(`${DRIVER_SELECT} WHERE d.id = ? AND d.deleted = 0`, [id]);
  if (!driver) throw errNotFound('司机不存在');
  ok(res, decorateDriver(driver));
}));

/** 编辑：姓名与身份证号不可修改(A0002)；可调整所属承运商（有在途任务时禁止） */
router.put('/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [exist] = await query('SELECT * FROM driver WHERE id = ? AND deleted = 0', [id]);
  if (!exist) throw errNotFound('司机不存在');

  const requestedName = req.body.name ?? req.body.driverName;
  const requestedIdCard = req.body.id_card ?? req.body.idCard;
  if (requestedName !== undefined && String(requestedName).trim() !== exist.driver_name) {
    throw errBiz('司机姓名不可修改');
  }
  if (requestedIdCard !== undefined && String(requestedIdCard).trim().toUpperCase() !== exist.id_card) {
    throw errBiz('身份证号不可修改');
  }

  const v = normalizeDriverBody({
    ...req.body,
    carrier_id: req.body.carrier_id ?? req.body.carrierId ?? exist.carrier_id,
    id_card: exist.id_card,
  });
  const carrierChanged = Number(exist.carrier_id) !== v.carrier_id;
  if (carrierChanged) {
    await assertCarrierExists(v.carrier_id);
    const active = await query(
      `SELECT id FROM shipping_task
       WHERE driver_id = ? AND deleted = 0
         AND status IN ('CARRIER_ACCEPTED','PICKED','OUTBOUND','IN_TRANSIT','ARRIVED')
       LIMIT 1`,
      [id]
    );
    if (active.length) throw errBiz('该司机存在在途任务，暂不能更换所属承运商');
    const dup = await query(
      'SELECT id FROM driver WHERE carrier_id = ? AND id_card = ? AND deleted = 0 AND id != ?',
      [v.carrier_id, v.id_card, id]
    );
    if (dup.length) throw errBiz('目标承运商下已存在相同身份证号的司机档案');
  }
  await assertExternalDriverIdUnique(v.external_driver_id, v.carrier_id, id);

  await query(
    `UPDATE driver SET carrier_id = ?, external_driver_id = ?, phone = ?, license_no = ?, license_type = ?, license_valid_from = ?, license_valid_to = ?, remark = ?, update_name = '系统管理员' WHERE id = ?`,
    [v.carrier_id, v.external_driver_id, v.phone, v.license_no, v.license_type, v.license_valid_from, v.license_valid_to, v.remark, id]
  );
  const [updated] = await query(`${DRIVER_SELECT} WHERE d.id = ?`, [id]);
  ok(res, updated ? decorateDriver(updated) : null);
}));

/** 停用/启用：停用后不可再分派任务，不影响在途运单 */
router.put('/:id/status', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  if (!Number.isInteger(Number(status)) || ![0, 1].includes(Number(status))) {
    throw errParam('状态值仅支持 1（启用）或 0（停用）');
  }
  const [exist] = await query('SELECT * FROM driver WHERE id = ? AND deleted = 0', [id]);
  if (!exist) throw errNotFound('司机不存在');

  await query('UPDATE driver SET status = ?, update_name = ? WHERE id = ?', [Number(status), '系统管理员', id]);
  const [updated] = await query('SELECT * FROM driver WHERE id = ?', [id]);
  ok(res, updated);
}));

module.exports = router;
