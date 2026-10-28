/**
 * 本地文件存储：上传、永久/限时访问 URL、存在性检查、删除与下载。
 * objectKey 仅由安全路径段和随机文件名构成，原始文件名只作为元数据保存。
 */
const { Router } = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query } = require('../db');
const { ok, wrap, errParam, errNotFound, cutStr, localDateStr } = require('../helpers');

const router = Router();
const UPLOAD_ROOT = path.resolve(__dirname, '..', '..', 'uploads');
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_OBJECT_KEY_LENGTH = 512;
const MAX_PATH_SEGMENTS = 16;
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FILE_URL_SECRET = process.env.FILE_URL_SECRET
  ? Buffer.from(process.env.FILE_URL_SECRET, 'utf8')
  : crypto.randomBytes(32);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') return next(errParam('文件大小不能超过 10MB'));
      return next(errParam(`文件上传失败：${error.message}`));
    }
    next(error);
  });
}

/** 校验 candidate 的解析路径位于 root 内；目录校验可允许 candidate 等于 root。 */
function assertInside(root, candidate, allowRoot = false) {
  const relative = path.relative(root, candidate);
  const outside = relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative);
  if (outside || (!relative && !allowRoot)) throw errParam('文件路径不合法');
}

/** 严格校验 objectKey，并同时验证其拼接后的路径仍在 uploads 内。 */
function resolveObjectKey(value) {
  if (typeof value !== 'string' || !value) throw errParam('objectKey 必填');
  if (value.length > MAX_OBJECT_KEY_LENGTH || value.includes('\\') || value.includes('\0')) {
    throw errParam('objectKey 格式不正确');
  }
  const segments = value.split('/');
  const fileName = segments[segments.length - 1];
  if (segments.length > MAX_PATH_SEGMENTS
    || segments.slice(0, -1).some((segment) => !PATH_SEGMENT.test(segment))
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(fileName)
    || fileName.includes('..')) {
    throw errParam('objectKey 格式不正确');
  }
  const filePath = path.resolve(UPLOAD_ROOT, ...segments);
  assertInside(UPLOAD_ROOT, filePath);
  return { objectKey: value, filePath };
}

function normalizeCustomPath(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw errParam('customPath 格式不正确');
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  if (!withoutTrailingSlash || withoutTrailingSlash.length > 384) {
    throw errParam('customPath 格式不正确');
  }
  const segments = withoutTrailingSlash.split('/');
  if (segments.length >= MAX_PATH_SEGMENTS
    || segments.some((segment) => !PATH_SEGMENT.test(segment))) {
    throw errParam('customPath 仅支持字母、数字、下划线、短横线及 / 分隔的安全路径');
  }
  return segments.join('/');
}

function normalizeFileName(value, originalName) {
  const extension = path.extname(originalName || '');
  const safeExtension = /^\.[A-Za-z0-9]{1,10}$/.test(extension) ? extension.toLowerCase() : '';
  if (value === undefined || value === null || String(value).trim() === '') {
    return `${crypto.randomBytes(16).toString('hex')}${safeExtension}`;
  }
  const fileName = String(value).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(fileName) || fileName.includes('..')) {
    throw errParam('fileName 仅支持字母、数字、点、下划线和短横线，且不能包含路径');
  }
  return fileName;
}

async function prepareUploadPath(filePath) {
  const parent = path.dirname(filePath);
  await fs.promises.mkdir(UPLOAD_ROOT, { recursive: true });
  await fs.promises.mkdir(parent, { recursive: true });
  const [realRoot, realParent] = await Promise.all([
    fs.promises.realpath(UPLOAD_ROOT),
    fs.promises.realpath(parent),
  ]);
  assertInside(realRoot, realParent, true);
  return path.join(realParent, path.basename(filePath));
}

/** 返回实际存在的文件路径；根目录或文件不存在时返回 null，越界路径仍抛参数错误。 */
async function existingFilePath(objectKey) {
  const { filePath } = resolveObjectKey(objectKey);
  try {
    const [realRoot, realFile] = await Promise.all([
      fs.promises.realpath(UPLOAD_ROOT),
      fs.promises.realpath(filePath),
    ]);
    assertInside(realRoot, realFile);
    const stat = await fs.promises.stat(realFile);
    return stat.isFile() ? realFile : null;
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function requireMetadata(objectKey) {
  const [metadata] = await query(
    'SELECT * FROM sys_file_meta WHERE object_key = ? AND deleted = 0',
    [objectKey]
  );
  if (!metadata) throw errNotFound('文件不存在');
  return metadata;
}

function permanentUrl(req, objectKey) {
  return `${req.protocol}://${req.get('host')}/api/bos/file/content?objectKey=${encodeURIComponent(objectKey)}`;
}

function signUrl(objectKey, expires) {
  return crypto.createHmac('sha256', FILE_URL_SECRET)
    .update(`${objectKey}\n${String(expires)}`)
    .digest('hex');
}

function temporaryUrl(req, objectKey, timeout) {
  const expires = Math.floor(Date.now() / 1000) + timeout;
  const signature = signUrl(objectKey, expires);
  const url = `${permanentUrl(req, objectKey)}&expires=${expires}&signature=${signature}`;
  return { url, expires, signature, timeout };
}

function parseTimeout(value) {
  if (value === undefined || value === '') return 3600;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw errParam('timeout 必须为 60~86400 之间的整数秒数');
  }
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 60 || timeout > 86400) {
    throw errParam('timeout 必须为 60~86400 之间的整数秒数');
  }
  return timeout;
}

function validateSignedRequest(objectKey, queryParams) {
  if (queryParams.expires === undefined) {
    if (queryParams.signature !== undefined) throw errParam('signature 必须搭配 expires 使用');
    return;
  }
  const { expires, signature } = queryParams;
  if (typeof expires !== 'string' || !/^\d{1,16}$/.test(expires)) {
    throw errParam('expires 格式不正确');
  }
  const expiresAt = Number(expires);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) throw errParam('expires 格式不正确');
  if (typeof signature !== 'string' || !/^[a-fA-F0-9]{64}$/.test(signature)) {
    throw errParam('signature 格式不正确');
  }

  const expected = Buffer.from(signUrl(objectKey, expires), 'hex');
  const actual = Buffer.from(signature, 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw errParam('文件访问签名无效');
  }
  if (expiresAt <= Math.floor(Date.now() / 1000)) throw errParam('文件访问 URL 已过期');
}

router.post(['/', '/upload'], uploadSingle, wrap(async (req, res) => {
  if (!req.file) throw errParam('请上传文件（multipart 字段名为 file）');

  const customPath = normalizeCustomPath(req.body && req.body.customPath) || localDateStr().replace(/-/g, '/');
  const storedFileName = normalizeFileName(req.body && req.body.fileName, req.file.originalname);
  const objectKey = `${customPath}/${storedFileName}`;
  const { filePath } = resolveObjectKey(objectKey);
  const safePath = await prepareUploadPath(filePath);
  const fileName = cutStr(req.file.originalname || 'unnamed', 255);
  const md5 = crypto.createHash('md5').update(req.file.buffer).digest('hex');
  const contentType = cutStr(req.file.mimetype || 'application/octet-stream', 255);
  const url = permanentUrl(req, objectKey);
  const size = req.file.size;

  try {
    await fs.promises.writeFile(safePath, req.file.buffer, { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw errParam('同一目录下已存在同名文件，请更换 fileName');
    await fs.promises.unlink(safePath).catch(() => {});
    throw error;
  }

  let inserted;
  try {
    inserted = await query(
      `INSERT INTO sys_file_meta
       (file_name, custom_path, etag, url, object_key, size, md5, content_type, create_name, update_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '系统管理员', '系统管理员')`,
      [fileName, customPath || null, md5, url, objectKey, size, md5, contentType]
    );
  } catch (error) {
    await fs.promises.unlink(safePath).catch(() => {});
    throw error;
  }

  const [created] = await query('SELECT * FROM sys_file_meta WHERE id = ?', [inserted.insertId]);
  const metadata = created || {
    id: inserted.insertId,
    file_name: fileName,
    custom_path: customPath,
    etag: md5,
    url,
    object_key: objectKey,
    size,
    md5,
    content_type: contentType,
    create_name: '系统管理员',
    update_name: '系统管理员',
  };
  ok(res, {
    ...metadata,
    url,
    objectKey,
    contentType,
  });
}));

router.get('/url', wrap(async (req, res) => {
  const { objectKey } = resolveObjectKey(req.query.objectKey);
  await requireMetadata(objectKey);
  ok(res, permanentUrl(req, objectKey));
}));

router.get(['/temporary-url', '/presigned-url'], wrap(async (req, res) => {
  const { objectKey } = resolveObjectKey(req.query.objectKey);
  const timeout = parseTimeout(req.query.expirationSeconds ?? req.query.timeout);
  await requireMetadata(objectKey);
  const result = temporaryUrl(req, objectKey, timeout);
  ok(res, req.path === '/presigned-url' ? result.url : { object_key: objectKey, ...result });
}));

router.get(['/exist', '/exists'], wrap(async (req, res) => {
  const { objectKey } = resolveObjectKey(req.query.objectKey);
  const [metadata] = await query(
    'SELECT id FROM sys_file_meta WHERE object_key = ? AND deleted = 0',
    [objectKey]
  );
  const canonical = req.path === '/exists';
  if (!metadata) return ok(res, canonical ? false : { exists: false });
  const filePath = await existingFilePath(objectKey);
  const exists = Boolean(filePath);
  ok(res, canonical ? exists : { exists });
}));

router.delete(['/', '/delete'], wrap(async (req, res) => {
  const { objectKey } = resolveObjectKey(req.query.objectKey);
  await requireMetadata(objectKey);
  const filePath = await existingFilePath(objectKey);

  await query(
    "UPDATE sys_file_meta SET deleted = 1, update_name = '系统管理员' WHERE object_key = ? AND deleted = 0",
    [objectKey]
  );
  if (filePath) {
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }
  ok(res, req.path === '/delete' ? true : { object_key: objectKey, deleted: true });
}));

router.get('/content', wrap(async (req, res, next) => {
  const { objectKey } = resolveObjectKey(req.query.objectKey);
  validateSignedRequest(objectKey, req.query);
  const metadata = await requireMetadata(objectKey);
  const filePath = await existingFilePath(objectKey);
  if (!filePath) throw errNotFound('文件不存在');

  const headers = { 'Content-Type': metadata.content_type || 'application/octet-stream' };
  res.download(filePath, String(metadata.file_name || 'download'), { headers }, (error) => {
    if (!error) return;
    if (res.headersSent) return res.destroy();
    next(error);
  });
}));

module.exports = router;
