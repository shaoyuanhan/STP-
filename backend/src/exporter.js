/**
 * Excel 导出（零依赖生成标准 .xlsx）
 *
 * 环境无法访问 npm registry，因此不引入 exceljs，直接按 OOXML 规范拼装
 * [Content_Types].xml / workbook.xml / styles.xml / sheet1.xml，并用 zlib
 * 打包为 zip（Node 22+ 内置 zlib.crc32）。
 *
 * 单元格策略：
 *  - 字符串一律 inlineStr（避免数字/公式注入：以 = + - @ 开头的文本不会被当作公式）
 *  - columns 中 type: 'number' 的列转数值单元格，便于 Excel 直接求和
 */
const zlib = require('zlib');

/** XML 文本转义 + 去掉 XML 1.0 非法控制字符 */
function xmlText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 列序号转字母：1 -> A, 27 -> AA */
function colName(index) {
  let n = index;
  let name = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** 把文件列表打包为 zip（deflate，UTF-8 文件名） */
function zip(files) {
  const { time, day } = dosDateTime(new Date());
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const crc = zlib.crc32(data) >>> 0;
    const compressed = zlib.deflateRawSync(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const entry = Buffer.alloc(46 + name.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(day, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    name.copy(entry, 46);

    chunks.push(local, compressed);
    central.push(entry);
    offset += local.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/** 样式：0 默认；1 表头（深蓝底白字加粗居中，细边框）；2 数据（细边框） */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><name val="微软雅黑"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="微软雅黑"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF2F5597"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function buildSheetXml(columns, rows) {
  const lastCol = colName(columns.length);
  const lastRow = rows.length + 1;
  const cols = columns
    .map((col, i) => `<col min="${i + 1}" max="${i + 1}" width="${col.width ?? 16}" customWidth="1"/>`)
    .join('');

  const headerCells = columns
    .map((col, i) => `<c r="${colName(i + 1)}1" s="1" t="inlineStr"><is><t>${xmlText(col.header)}</t></is></c>`)
    .join('');

  const bodyRows = rows.map((row, rowIndex) => {
    const r = rowIndex + 2;
    const cells = columns.map((col, i) => {
      const raw = typeof col.value === 'function' ? col.value(row) : row[col.key];
      const ref = `${colName(i + 1)}${r}`;
      if (col.type === 'number') {
        const num = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
        if (Number.isFinite(num)) return `<c r="${ref}" s="2"><v>${num}</v></c>`;
      }
      return `<c r="${ref}" s="2" t="inlineStr"><is><t>${xmlText(raw === null || raw === undefined ? '-' : raw)}</t></is></c>`;
    });
    return `<row r="${r}">${cells.join('')}</row>`;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastCol}${lastRow}"/>
<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>${cols}</cols>
<sheetData><row r="1" ht="24" customHeight="1">${headerCells}</row>${bodyRows.join('')}</sheetData>
<autoFilter ref="A1:${lastCol}${lastRow}"/>
</worksheet>`;
}

function safeSheetName(name) {
  return String(name || '数据').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || '数据';
}

/** 生成 xlsx Buffer */
function buildXlsx({ sheetName = '数据', columns, rows }) {
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xmlText(safeSheetName(sheetName))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  return zip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: WORKBOOK_RELS },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/worksheets/sheet1.xml', data: buildSheetXml(columns, rows) },
  ]);
}

/** 导出文件名：前缀_YYYYMMDD_HHmmss.xlsx */
function exportFilename(prefix) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${prefix}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.xlsx`;
}

/** 输出 xlsx 响应（Content-Disposition 同时给 ASCII 兜底与 UTF-8 文件名） */
function sendXlsx(res, { prefix, sheetName, columns, rows }) {
  const filename = exportFilename(prefix);
  const buffer = buildXlsx({ sheetName, columns, rows });
  const asciiName = filename.replace(/[^\x20-\x7E]/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('X-Export-Count', String(rows.length));
  res.end(buffer);
}

// ---------------- 展示格式化（与前端 utils/format.ts 保持一致） ----------------
function text(value, fallback = '-') {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s || fallback;
}

function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD HH:mm */
function dateTime(value, fallback = '-') {
  const d = parseDate(value);
  if (!d) return fallback;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** YYYY-MM-DD */
function dateOnly(value, fallback = '-') {
  const d = parseDate(value);
  if (!d) return fallback;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 国内手机号展示为 138 0013 8000，其他原样 */
function phoneText(value, fallback = '-') {
  const s = text(value, '');
  if (!s) return fallback;
  const m = /^(?:\+?86)?(1[3-9]\d{9})$/.exec(s);
  if (m) return `${m[1].slice(0, 3)} ${m[1].slice(3, 7)} ${m[1].slice(7)}`;
  return s;
}

module.exports = {
  buildXlsx,
  sendXlsx,
  exportFilename,
  text,
  dateTime,
  dateOnly,
  phoneText,
};
