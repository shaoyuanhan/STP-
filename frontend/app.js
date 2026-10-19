/* ==================================================================
   智能运输管理平台 (STP) · 前端 SPA
   依赖: index.html (admin-console 设计系统)
   ================================================================== */

// ============ API 基础 ============
// 解析顺序：
//   1. window.API_BASE 显式指定（部署时可在 index.html 里注入）
//   2. file:// 双击打开 → http://localhost:3000
//   3. http(s) 打开 → 先探测同源 /api/health（配合 server.js 代理）；
//      不通则回退 http://localhost:3000（后端已开启 CORS）
let API = window.API_BASE || (location.protocol === 'file:' ? 'http://localhost:3000' : '');
let apiResolved = Boolean(window.API_BASE) || location.protocol === 'file:';

async function resolveApi() {
  if (apiResolved) return;
  apiResolved = true;
  try {
    const r = await fetch('/api/health', { method: 'GET' });
    if (!r.ok) throw new Error('same-origin api unavailable');
  } catch (e) {
    API = 'http://localhost:3000';
  }
}

async function api(path, { method = 'GET', body } = {}) {
  await resolveApi();
  const res = await fetch(API + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || '请求失败');
  return data;
}

// ============ 工具 ============
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDT = (s) => (s ? String(s).slice(0, 19) : '-');
const fmtD = (s) => (s ? String(s).slice(0, 10) : '-');
const money = (n) => Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 });
const empty = (s) => (s === null || s === undefined || s === '' ? '-' : esc(s));

const TASK_STATUS = {
  PENDING: { t: '待派单', c: 'gray' }, DISPATCHED: { t: '已派单', c: 'blue' },
  ACCEPTED: { t: '承运商已接单', c: 'cyan' }, OUT_BOUND: { t: '已出库', c: 'blue' },
  PICKED_UP: { t: '已提车', c: 'cyan' }, IN_TRANSIT: { t: '在途', c: 'green' },
  ARRIVED: { t: '已到达', c: 'orange' }, FINISHED: { t: '已完结', c: 'green' },
  CANCELLED: { t: '已取消', c: 'red' },
};
const TAGS = {
  COOPERATING: { t: '合作中', c: 'green' }, DISABLED0: { t: '已停用', c: 'gray' },
  ENABLED: { t: '启用', c: 'green' }, DISABLED: { t: '停用', c: 'gray' },
  PENDING_RECON: { t: '待对账', c: 'orange' }, RECONED: { t: '已对账', c: 'green' },
  ES_PEND: { t: '待签署', c: 'orange' }, SIGNED: { t: '已签署', c: 'green' }, ES_CAN: { t: '已取消', c: 'gray' },
};
function stTag(map, code) {
  const it = map[code] || { t: code, c: 'gray' };
  return `<span class="tag tag-${it.c}">${it.t}</span>`;
}
const taskTag = (s) => stTag(TASK_STATUS, s);
const carrierTag = (s) => stTag({ COOPERATING: TAGS.COOPERATING, DISABLED: TAGS.DISABLED }, s);
const driverTag = (s) => stTag({ ENABLED: TAGS.ENABLED, DISABLED: TAGS.DISABLED }, s);
const reconTag = (s) => stTag({ PENDING_RECON: TAGS.PENDING_RECON, RECONED: TAGS.RECONED }, s);
const esignTag = (s) => stTag({ PENDING: TAGS.ES_PEND, SIGNED: TAGS.SIGNED, CANCELLED: TAGS.ES_CAN }, s);

// ============ UI: Toast ============
function toast(msg, ok = true) {
  const el = document.createElement('div');
  el.className = `toast ${ok ? 'toast-ok' : 'toast-err'}`;
  el.innerHTML = `<span class="ic">${ok ? '✓' : '✕'}</span>${esc(msg)}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ============ UI: Modal ============
function openModal({ title, body, foot, wide }) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}">
      <div class="modal-head">${esc(title)}<span class="modal-x">✕</span></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">${foot || `<button class="btn btn-ghost" data-close>关闭</button>`}</div>
    </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  $('.modal-x', mask).onclick = close;
  $$('[data-close]', mask).forEach((b) => (b.onclick = close));
  mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
  return { el: mask, close };
}

function confirmModal(text) {
  return new Promise((resolve) => {
    const m = openModal({
      title: '操作确认',
      body: `<div style="padding:8px 4px;color:var(--text-2)">${esc(text)}</div>`,
      foot: `<button class="btn btn-ghost" data-close>取消</button>
             <button class="btn btn-primary" id="cf-ok">确定</button>`,
    });
    $('#cf-ok', m.el).onclick = () => { m.close(); resolve(true); };
    $('[data-close]', m.el).addEventListener('click', () => resolve(false), { once: true });
    $('.modal-x', m.el).addEventListener('click', () => resolve(false), { once: true });
  });
}

// ===== 电话输入（intl-tel-input，基于 Google libphonenumber）=====
// 控件：国旗下拉(可搜索) + 区号 + 号码，自动格式化、按国家校验、自动识别手机/座机
// 提交输出统一 E.164（如 +8613812345678），与后端 assertPhone 一致

/** 初始化电话输入控件；value 支持 E.164 或国内裸号 */
function initPhoneInput(id, value = '') {
  const input = $('#' + id);
  const iti = window.intlTelInput(input, {
    initialCountry: 'cn',
    preferredCountries: ['cn', 'hk', 'mo', 'tw', 'us', 'jp', 'sg', 'gb'],
    separateDialCode: true,
    countryNameLocale: 'zh-CN',
    uiTranslations: window.itiZh || {},
    countrySearch: true,
    formatAsYouType: true,
    autoPlaceholder: 'aggressive',
  });
  if (value) iti.setNumber(value);
  return { iti, input };
}

/** 提交前校验：返回错误消息或 null；mobileOnly 要求手机号。
 *  注意用 isValidNumberPrecise（libphonenumber 严格规则，与后端一致），
 *  isValidNumber 是宽松校验（仅查位数），会放行 7 位座机这类无效号 */
function phoneCheck(w, label, { required = true, mobileOnly = false } = {}) {
  const raw = w.input.value.trim();
  if (!raw) return required ? `${label}必填` : null;
  const num = w.iti.getNumber();
  if (!num || !w.iti.isValidNumberPrecise()) {
    const err = w.iti.getValidationError();
    if (err === 'TOO_SHORT' || err === 'TOO_LONG' || err === 'INVALID_LENGTH') {
      return `${label}位数不正确，请核对（国内手机 11 位；座机为区号+8 位号码，如 0551-63612345）`;
    }
    return `${label}格式不正确：国内支持手机（11 位）、座机（区号+8 位，如 0551-63612345）、400/800 号码；国外号码点击国旗切换国家后输入`;
  }
  if (mobileOnly) {
    const t = w.iti.getNumberType();
    if (t && t !== 'MOBILE' && t !== 'FIXED_LINE_OR_MOBILE') return '座机/热线号码不可用，请填写手机号';
  }
  return null;
}

/** 读取提交值（E.164）；空返回 '' */
const phoneVal = (w) => w.iti.getNumber() || '';

/** 表格展示格式化：+8613812345678 -> 138 0013 8000；其余原样 */
function fmtPhone(s) {
  const v = String(s || '').trim();
  if (/^\+86\d{11}$/.test(v)) return v.slice(3).replace(/(\d{3})(\d{4})(\d{4})/, '$1 $2 $3');
  return v;
}

/** 日期区间联动：起日期变更后，止日期的最小可选值跟随（阻止选到更早日期） */
function bindDatePair(fromId, toId) {
  const f = $('#' + fromId), t = $('#' + toId);
  if (!f || !t) return;
  f.onchange = () => { t.min = f.value || ''; };
  if (f.value) t.min = f.value;
}

/** 校验日期区间先后顺序，返回错误消息或 null */
function checkDateOrder(fromId, toId, label) {
  const f = fv(fromId), t = fv(toId);
  if (f && t && f > t) return `${label}的开始日期（${f}）不能晚于结束日期（${t}）`;
  return null;
}

// 表单字段构造
const F = {
  text: (id, label, opt = {}) => `
    <div class="form-item"><label class="${opt.req ? 'req' : ''}">${label}</label>
      <div class="ctrl"><input class="input" id="${id}" placeholder="${opt.ph || '请输入'}" value="${esc(opt.value ?? '')}" ${opt.dis ? 'disabled' : ''} ${opt.max ? `maxlength="${opt.max}"` : ''} autocomplete="off">
      ${opt.tip ? `<div class="form-tip">${opt.tip}</div>` : ''}</div></div>`,
  select: (id, label, options, opt = {}) => `
    <div class="form-item"><label class="${opt.req ? 'req' : ''}">${label}</label>
      <div class="ctrl"><select class="select" id="${id}">${options}</select>
      ${opt.tip ? `<div class="form-tip">${opt.tip}</div>` : ''}</div></div>`,
  textarea: (id, label, opt = {}) => `
    <div class="form-item"><label>${label}</label>
      <div class="ctrl"><textarea class="input" id="${id}" rows="2" style="flex:1;padding:8px 9px;resize:vertical" placeholder="${opt.ph || '请输入'}">${esc(opt.value ?? '')}</textarea></div></div>`,
  date: (id, label, opt = {}) => `
    <div class="form-item"><label class="${opt.req ? 'req' : ''}">${label}</label>
      <div class="ctrl"><input class="input" type="date" id="${id}" value="${opt.value || ''}" ${opt.min ? `min="${opt.min}"` : ''} style="flex:1">
      ${opt.tip ? `<div class="form-tip">${opt.tip}</div>` : ''}</div></div>`,
  intlPhone: (id, label, opt = {}) => `
    <div class="form-item"><label class="${opt.req ? 'req' : ''}">${label}</label>
      <div class="ctrl"><input class="input iti-src" id="${id}" type="tel" autocomplete="off">
      ${opt.tip ? `<div class="form-tip">${opt.tip}</div>` : ''}</div></div>`,
};
const fv = (id) => { const el = $('#' + id); return el ? el.value.trim() : ''; };

// ============ 路由与页签 ============
const PAGES = {
  '/dashboard': { mod: '工作台', title: '工作台首页', render: pageDashboard },
  '/carriers': { mod: '基础数据', title: '承运商管理', render: pageCarriers },
  '/drivers': { mod: '基础数据', title: '司机管理', render: pageDrivers },
  '/tasks': { mod: '运输调度', title: '发运任务', render: pageTasks },
  '/tracking': { mod: '运输调度', title: '在途监控', render: pageTracking },
  '/freight': { mod: '结算管理', title: '应付运费对账', render: pageFreight },
  '/esign': { mod: '电子签章', title: '电子签台账', render: pageEsign },
};

let tabs = []; // {route,title}
let activeRoute = '';

function route() {
  const hash = location.hash || '#/dashboard';
  const path = hash.replace('#', '');
  const page = PAGES[path] || PAGES['/dashboard'];
  activeRoute = PAGES[path] ? path : '/dashboard';
  if (!PAGES[path]) { location.hash = '#/dashboard'; return; }

  // 面包屑
  $('#crumb-2').textContent = page.mod;
  $('#crumb-sep').style.display = 'inline';
  $('#crumb-3').textContent = page.title;
  document.title = `${page.title} - 智能运输管理平台`;

  // 菜单激活
  $$('.sub-item').forEach((li) => li.classList.toggle('active', li.dataset.route === '#' + activeRoute));
  $$('.menu-item').forEach((li) => li.classList.toggle('open', li.dataset.parent === page.mod));

  // 页签
  const found = tabs.find((t) => t.route === activeRoute);
  if (!found) tabs.push({ route: activeRoute, title: page.title });
  renderTabs();

  page.render($('#view'));
}

function renderTabs() {
  $('#tabs').innerHTML = tabs.map((t) => `
    <span class="tab ${t.route === activeRoute ? 'active' : ''}" data-r="${t.route}">${esc(t.title)}
      ${t.route === '/dashboard' ? '' : '<span class="x" data-x="' + t.route + '">✕</span>'}</span>`).join('');
  $$('#tabs .tab').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.dataset.x !== undefined) return;
      location.hash = '#' + el.dataset.r;
    };
  });
  $$('#tabs .tab .x').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const r = el.dataset.x;
      const idx = tabs.findIndex((t) => t.route === r);
      tabs.splice(idx, 1);
      if (activeRoute === r) {
        const next = tabs[Math.max(0, idx - 1)];
        location.hash = next ? '#' + next.route : '#/dashboard';
      } else renderTabs();
    };
  });
}

// 菜单点击
$$('#menu .sub-item').forEach((li) => { li.onclick = () => (location.hash = li.dataset.route); });
$$('#menu .menu-item').forEach((li) => { li.onclick = () => { const t = li.nextElementSibling; if (t && t.classList.contains('sub-item')) { li.classList.toggle('open'); } }; });
window.addEventListener('hashchange', route);

// ============ 通用: 列表骨架与分页 ============
function pagerHtml(total, page, size) {
  const pages = Math.max(1, Math.ceil(total / size));
  const nums = [];
  const add = (n) => { if (!nums.includes(n) && n >= 1 && n <= pages) nums.push(n); };
  add(1); add(pages);
  for (let n = page - 2; n <= page + 2; n++) add(n);
  nums.sort((a, b) => a - b);
  let last = 0;
  const items = [];
  for (const n of nums) {
    if (n - last > 1) items.push('<span class="pg-dots">…</span>');
    items.push(`<span class="pg ${n === page ? 'active' : ''}" data-p="${n}">${n}</span>`);
    last = n;
  }
  return `
    <span class="pg ${page <= 1 ? 'disabled' : ''}" data-p="${page - 1}"><svg class="pgi" viewBox="0 0 10 10"><path d="M6.4 1.6 3 5l3.4 3.4"/></svg></span>
    ${items.join('')}
    <span class="pg ${page >= pages ? 'disabled' : ''}" data-p="${page + 1}"><svg class="pgi" viewBox="0 0 10 10"><path d="M3.6 1.6 7 5 3.6 8.4"/></svg></span>
    <select class="select" id="pg-size">${[10, 20, 50].map((n) => `<option value="${n}" ${n === size ? 'selected' : ''}>${n}条/页</option>`).join('')}</select>
    <span class="jump-wrap">跳至 <input class="jump" id="pg-jump" value="${page}"> 页</span>
    <span class="total">总数 ${total}条</span>`;
}

function bindPager(container, state, reload) {
  $$('.pg[data-p]', container).forEach((el) => {
    el.onclick = () => { state.page = Number(el.dataset.p); reload(); };
  });
  const sizeEl = $('#pg-size', container);
  if (sizeEl) sizeEl.onchange = () => { state.size = Number(sizeEl.value); state.page = 1; reload(); };
  const jump = $('#pg-jump', container);
  if (jump) jump.onkeydown = (e) => {
    if (e.key === 'Enter') {
      const v = Number(jump.value);
      const pages = Math.max(1, Math.ceil(state.total / state.size));
      if (v >= 1 && v <= pages) { state.page = v; reload(); }
      else toast('页码超出范围', false);
    }
  };
}

// ============ 页面: 工作台 ============
async function pageDashboard(view) {
  view.innerHTML = `<div class="stat-grid" style="grid-template-columns:repeat(6,1fr)">
    ${'<div class="stat"><div class="label">加载中</div><div class="num">--</div></div>'.repeat(6)}
  </div><div class="dash-grid"><div class="card"><div class="panel-head">最新任务</div><div class="empty-row">加载中…</div></div>
  <div class="card"><div class="panel-head">任务状态分布</div><div class="bar-list">加载中…</div></div></div>`;
  try {
    const [st, latest] = await Promise.all([
      api('/stats'),
      api('/ship-tasks?size=6'),
    ]);
    const t = st.task;
    const cards = [
      { label: '待派单任务', num: t.pending, sub: `已派单 <b>${t.dispatched}</b> 待接单`, cls: 'var(--warning)' },
      { label: '在途运单', num: t.inTransit, sub: `已提车 <b>${t.pickedUp}</b> 已出库 <b>${t.outBound}</b>` },
      { label: '已到达', num: t.arrived, sub: '待客户交接', cls: 'var(--warning)' },
      { label: '已完结', num: t.finished, sub: `本月运费 <b>¥${money(st.freightMonth.amount)}</b>` },
      { label: '待对账运费', num: st.freightPending.count, sub: `<b>¥${money(st.freightPending.amount)}</b>` },
      { label: '合作承运商', num: st.carriers, sub: `启用司机 <b>${st.drivers}</b> 人` },
    ];
    $('.stat-grid', view).innerHTML = cards.map((c) => `
      <div class="stat"><div class="label">${c.label}</div>
      <div class="num" ${c.cls ? `style="color:${c.cls}"` : ''}>${c.num}</div>
      <div class="sub">${c.sub}</div></div>`).join('');

    const dist = [
      ['待派单', t.pending], ['已派单', t.dispatched], ['已接单', t.accepted], ['已出库', t.outBound],
      ['已提车', t.pickedUp], ['在途', t.inTransit], ['已到达', t.arrived], ['已完结', t.finished], ['已取消', t.cancelled],
    ];
    const max = Math.max(...dist.map((d) => d[1]), 1);
    $('.bar-list', view).innerHTML = dist.map(([n, v]) => `
      <div class="bar-item"><span class="name">${n}</span>
        <div class="track"><div class="fill" style="width:${(v / max) * 100}%"></div></div>
        <span class="val">${v}</span></div>`).join('');

    const rows = latest.list.map((r) => `
      <tr>
        <td><a class="link" onclick="openTaskDetail(${r.id})">${esc(r.task_no)}</a></td>
        <td><span class="ellipsis" title="${esc(r.customer_name)}">${esc(r.customer_name)}</span></td>
        <td>${esc(r.vin)}</td>
        <td>${taskTag(r.status)}</td>
        <td>${fmtDT(r.created_at)}</td>
      </tr>`).join('');
    $('.dash-grid .card', view).innerHTML = `
      <div class="panel-head"><span>最新任务</span><a class="link" onclick="location.hash='#/tasks'">查看全部 →</a></div>
      <div class="table-scroll" style="overflow-x:auto">
      <table style="min-width:640px">
        <thead><tr><th>任务单号</th><th>客户名称</th><th>VIN</th><th>状态</th><th>创建日期</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="empty-row">暂无数据</td></tr>'}</tbody>
      </table></div>`;
  } catch (e) {
    view.innerHTML = `<div class="card empty-row">${esc(e.message)}<br><span class="form-tip">请确认后端服务已启动 (默认 http://localhost:3000)</span></div>`;
  }
}

// ============ 页面: 承运商管理 ============
const carrierState = { page: 1, size: 10, keyword: '', status: '', total: 0 };

async function pageCarriers(view) {
  view.innerHTML = `
    <section class="card filter">
      <div class="field"><label>关键字</label><input class="input" id="ck-kw" placeholder="名称/联系人/电话" value="${esc(carrierState.keyword)}"></div>
      <div class="field"><label>状态</label><select class="select" id="ck-st">
        <option value="">全部</option>
        <option value="COOPERATING" ${carrierState.status === 'COOPERATING' ? 'selected' : ''}>合作中</option>
        <option value="DISABLED" ${carrierState.status === 'DISABLED' ? 'selected' : ''}>已停用</option></select></div>
      <div class="filter-actions">
        <button class="btn btn-ghost" id="ck-reset">重置</button>
        <button class="btn btn-primary" id="ck-search">查询</button>
      </div>
    </section>
    <div class="toolbar"><button class="btn btn-primary" id="ck-add">
      <svg class="bi" viewBox="0 0 14 14"><path d="M7 2.2v9.6M2.2 7h9.6"/></svg>新增承运商</button></div>
    <section class="card table-card"><div class="table-scroll" id="ck-body"></div>
      <footer class="pager" id="ck-pager"></footer></section>`;

  const reload = async () => {
    const q = `?page=${carrierState.page}&size=${carrierState.size}&keyword=${encodeURIComponent(carrierState.keyword)}&status=${carrierState.status}`;
    const d = await api('/carriers' + q);
    carrierState.total = d.total;
    $('#ck-body', view).innerHTML = `
      <table>
        <thead><tr><th>承运商编码</th><th>承运商名称</th><th>联系人</th><th>联系电话</th><th>合作路线</th><th>在册司机</th><th>状态</th><th>创建日期</th><th>操作</th></tr></thead>
        <tbody>${d.list.map((r) => `
          <tr>
            <td>${esc(r.carrier_code)}</td>
            <td><span class="ellipsis" title="${esc(r.carrier_name)}">${esc(r.carrier_name)}</span></td>
            <td>${esc(r.contact_person)}</td>
            <td>${esc(fmtPhone(r.contact_phone))}</td>
            <td>${empty(r.coop_routes)}</td>
            <td>${r.driver_count}</td>
            <td>${carrierTag(r.status)}</td>
            <td>${fmtD(r.created_at)}</td>
            <td class="actions">
              <a class="link" onclick="carrierForm(${r.id})">编辑</a>
              <a class="link" onclick="toggleCarrier(${r.id},'${r.status === 'COOPERATING' ? 'DISABLED' : 'COOPERATING'}')">${r.status === 'COOPERATING' ? '停用' : '启用'}</a>
            </td>
          </tr>`).join('') || `<tr><td colspan="9" class="empty-row">暂无数据</td></tr>`}</tbody>
      </table>`;
    $('#ck-pager', view).innerHTML = pagerHtml(d.total, carrierState.page, carrierState.size);
    bindPager($('#ck-pager', view), carrierState, reload);
  };

  $('#ck-search', view).onclick = () => {
    carrierState.keyword = fv('ck-kw'); carrierState.status = fv('ck-st'); carrierState.page = 1; reload();
  };
  $('#ck-kw', view).onkeydown = (e) => { if (e.key === 'Enter') $('#ck-search', view).click(); };
  $('#ck-reset', view).onclick = () => {
    carrierState.keyword = ''; carrierState.status = ''; carrierState.page = 1;
    $('#ck-kw', view).value = ''; $('#ck-st', view).value = ''; reload();
  };
  $('#ck-add', view).onclick = () => carrierForm(null);
  await reload();
}

async function carrierForm(id) {
  let r = { carrier_name: '', contact_person: '', contact_phone: '', coop_routes: '', remark: '' };
  if (id) {
    const d = await api(`/carriers?keyword=&size=100`);
    r = d.list.find((x) => x.id === id) || r;
  }
  const m = openModal({
    title: id ? '编辑承运商' : '新增承运商',
    body: `
      ${F.text('cf-name', '承运商名称', { req: 1, value: r.carrier_name })}
      ${F.select('cf-code', '承运商编码', `<option>${id ? esc(r.carrier_code) : '系统自动生成'}</option>`, { tip: '编码规则：CAR-三位序列号，系统自动生成不可修改' })}
      ${F.text('cf-contact', '联系人', { req: 1, value: r.contact_person })}
      ${F.intlPhone('cf-phone', '联系电话', { req: 1, tip: '默认中国 +86：手机 11 位；座机为区号+8 位号码（如 0551-63612345）；400/800 十位。点击国旗可切换国家' })}
      ${F.text('cf-routes', '合作路线', { value: r.coop_routes || '', ph: '如：合肥—华东、合肥—华南' })}
      ${F.textarea('cf-remark', '备注', { value: r.remark || '' })}`,
    foot: `<button class="btn btn-ghost" data-close>取消</button>
           <button class="btn btn-primary" id="cf-ok">${id ? '保存' : '新增'}</button>`,
  });
  if (id) $('#cf-code', m.el).disabled = true;
  const ph = initPhoneInput('cf-phone', r.contact_phone || '');
  $('#cf-ok', m.el).onclick = async () => {
    try {
      const e1 = phoneCheck(ph, '联系电话');
      if (e1) throw new Error(e1);
      const body = {
        carrier_name: fv('cf-name'), contact_person: fv('cf-contact'), contact_phone: phoneVal(ph),
        coop_routes: fv('cf-routes') || null, remark: fv('cf-remark') || null,
      };
      if (!body.carrier_name || !body.contact_person) throw new Error('请填写完整必填项');
      const d = id ? await api(`/carriers/${id}`, { method: 'PUT', body }) : await api('/carriers', { method: 'POST', body });
      m.close(); toast(d.message); pageCarriers($('#view'));
    } catch (e) { toast(e.message, false); }
  };
}

async function toggleCarrier(id, status) {
  const text = status === 'DISABLED'
    ? '确认停用该承运商？停用后不可被派单，不影响在途运单'
    : '确认启用该承运商？启用后可正常派单';
  if (!(await confirmModal(text))) return;
  try {
    const d = await api(`/carriers/${id}/status`, { method: 'PUT', body: { status } });
    toast(d.message); pageCarriers($('#view'));
  } catch (e) { toast(e.message, false); }
}

// ============ 页面: 司机管理 ============
const driverState = { page: 1, size: 10, keyword: '', carrier_id: '', status: '', total: 0 };

async function pageDrivers(view) {
  const carriers = (await api('/carriers?size=100')).list;
  view.innerHTML = `
    <section class="card filter">
      <div class="field"><label>关键字</label><input class="input" id="dr-kw" placeholder="姓名/手机号/身份证号" value="${esc(driverState.keyword)}"></div>
      <div class="field"><label>所属承运商</label><select class="select" id="dr-car">
        <option value="">全部</option>
        ${carriers.map((c) => `<option value="${c.id}" ${String(driverState.carrier_id) === String(c.id) ? 'selected' : ''}>${esc(c.carrier_name)}</option>`).join('')}</select></div>
      <div class="field"><label>状态</label><select class="select" id="dr-st">
        <option value="">全部</option>
        <option value="ENABLED" ${driverState.status === 'ENABLED' ? 'selected' : ''}>启用</option>
        <option value="DISABLED" ${driverState.status === 'DISABLED' ? 'selected' : ''}>停用</option></select></div>
      <div class="filter-actions">
        <button class="btn btn-ghost" id="dr-reset">重置</button>
        <button class="btn btn-primary" id="dr-search">查询</button>
      </div>
    </section>
    <div class="toolbar"><button class="btn btn-primary" id="dr-add">
      <svg class="bi" viewBox="0 0 14 14"><path d="M7 2.2v9.6M2.2 7h9.6"/></svg>新增司机</button></div>
    <section class="card table-card"><div class="table-scroll" id="dr-body"></div>
      <footer class="pager" id="dr-pager"></footer></section>`;

  const reload = async () => {
    const q = `?page=${driverState.page}&size=${driverState.size}&keyword=${encodeURIComponent(driverState.keyword)}&carrier_id=${driverState.carrier_id}&status=${driverState.status}`;
    const d = await api('/drivers' + q);
    driverState.total = d.total;
    $('#dr-body', view).innerHTML = `
      <table>
        <thead><tr><th>姓名</th><th>手机号</th><th>身份证号</th><th>准驾车型</th><th>有效期起</th><th>有效期止</th><th>所属承运商</th><th>状态</th><th>创建日期</th><th>操作</th></tr></thead>
        <tbody>${d.list.map((r) => {
          const inverted = r.license_valid_from > r.license_valid_to;
          return `
          <tr>
            <td>${esc(r.name)}</td><td>${esc(fmtPhone(r.phone))}</td><td>${esc(r.id_card)}</td>
            <td>${empty(r.vehicle_type)}</td>
            <td${inverted ? ' style="color:#cf1322"' : ''}>${fmtD(r.license_valid_from)}</td>
            <td${inverted ? ' style="color:#cf1322"' : ''}>${fmtD(r.license_valid_to)}</td>
            <td>${r.carrier_name ? esc(r.carrier_name) : '<span class="muted">散单</span>'}</td>
            <td>${driverTag(r.status)}</td><td>${fmtD(r.created_at)}</td>
            <td class="actions">
              <a class="link" onclick="driverForm(${r.id})">编辑</a>
              <a class="link" onclick="toggleDriver(${r.id},'${r.status === 'ENABLED' ? 'DISABLED' : 'ENABLED'}')">${r.status === 'ENABLED' ? '停用' : '启用'}</a>
            </td>
          </tr>`;
        }).join('') || `<tr><td colspan="10" class="empty-row">暂无数据</td></tr>`}</tbody>
      </table>`;
    $('#dr-pager', view).innerHTML = pagerHtml(d.total, driverState.page, driverState.size);
    bindPager($('#dr-pager', view), driverState, reload);
  };

  $('#dr-search', view).onclick = () => {
    driverState.keyword = fv('dr-kw'); driverState.carrier_id = fv('dr-car');
    driverState.status = fv('dr-st'); driverState.page = 1; reload();
  };
  $('#dr-kw', view).onkeydown = (e) => { if (e.key === 'Enter') $('#dr-search', view).click(); };
  $('#dr-reset', view).onclick = () => {
    driverState.keyword = ''; driverState.carrier_id = ''; driverState.status = ''; driverState.page = 1;
    $('#dr-kw', view).value = ''; $('#dr-car', view).value = ''; $('#dr-st', view).value = ''; reload();
  };
  $('#dr-add', view).onclick = () => driverForm(null, carriers);
  await reload();
}

async function driverForm(id, carriersArg) {
  const carriers = carriersArg || (await api('/carriers?size=100')).list;
  let r = null;
  if (id) r = (await api('/drivers?size=100')).list.find((x) => x.id === id);
  const v = r || { name: '', phone: '', id_card: '', license_no: '', vehicle_type: '', carrier_id: '' };
  const m = openModal({
    title: id ? '编辑司机' : '新增司机',
    body: `
      ${F.text('df-name', '姓名', { req: 1, value: v.name, dis: !!id })}
      ${F.text('df-idcard', '身份证号', { req: 1, value: v.id_card, dis: !!id })}
      ${id ? `<div class="form-tip" style="margin:-8px 0 8px 108px">姓名与身份证号创建后不可修改</div>` : ''}
      ${F.intlPhone('df-phone', '手机号', { req: 1, tip: '司机需留手机号，座机/400 号码无法通过校验' })}
      ${F.text('df-license', '驾驶证号', { value: v.license_no || '' })}
      ${F.select('df-vtype', '准驾车型', ['A2', 'B2', 'C1', 'A1', 'B1'].map((x) => `<option ${v.vehicle_type === x ? 'selected' : ''}>${x}</option>`).join(''))}
      ${F.date('df-from', '有效期起', { req: 1, value: v.license_valid_from })}
      ${F.date('df-to', '有效期止', { req: 1, value: v.license_valid_to, min: v.license_valid_from, tip: '不能早于有效期起' })}
      ${F.select('df-carrier', '所属承运商', `<option value="">散单司机</option>` + carriers.map((c) => `<option value="${c.id}" ${String(v.carrier_id) === String(c.id) ? 'selected' : ''}>${esc(c.carrier_name)}</option>`).join(''))}
      ${F.textarea('df-remark', '备注', { value: v.remark || '' })}`,
    foot: `<button class="btn btn-ghost" data-close>取消</button>
           <button class="btn btn-primary" id="df-ok">${id ? '保存' : '新增'}</button>`,
  });
  const ph = initPhoneInput('df-phone', v.phone || '');
  bindDatePair('df-from', 'df-to');
  $('#df-ok', m.el).onclick = async () => {
    try {
      const e2 = phoneCheck(ph, '手机号', { mobileOnly: true });
      if (e2) throw new Error(e2);
      const eDate = checkDateOrder('df-from', 'df-to', '驾驶证有效期');
      if (eDate) throw new Error(eDate);
      const body = {
        phone: phoneVal(ph), license_no: fv('df-license') || null, vehicle_type: fv('df-vtype'),
        license_valid_from: fv('df-from'), license_valid_to: fv('df-to'),
        carrier_id: fv('df-carrier') || null, remark: fv('df-remark') || null,
      };
      if (!id) { body.name = fv('df-name'); body.id_card = fv('df-idcard'); }
      if (!body.phone || !body.license_valid_from || !body.license_valid_to) throw new Error('请填写完整必填项');
      const d = id ? await api(`/drivers/${id}`, { method: 'PUT', body }) : await api('/drivers', { method: 'POST', body });
      m.close(); toast(d.message); pageDrivers($('#view'));
    } catch (e) { toast(e.message, false); }
  };
}

async function toggleDriver(id, status) {
  const text = status === 'DISABLED'
    ? '确认停用该司机？停用后不可再分派任务，不影响当前在途运单'
    : '确认启用该司机？';
  if (!(await confirmModal(text))) return;
  try {
    const d = await api(`/drivers/${id}/status`, { method: 'PUT', body: { status } });
    toast(d.message); pageDrivers($('#view'));
  } catch (e) { toast(e.message, false); }
}

// ============ 页面: 发运任务 ============
const taskState = { page: 1, size: 10, filters: {}, total: 0 };

async function pageTasks(view) {
  const [carriers, drivers] = await Promise.all([
    api('/carriers?size=100'),
    api('/drivers/options'),
  ]);
  const carriersList = carriers.list.filter((c) => c.status === 'COOPERATING');
  const f = taskState.filters;

  view.innerHTML = `
    <section class="card filter">
      <div class="field"><label>任务单号</label><input class="input" id="tk-no" placeholder="请输入" value="${esc(f.task_no || '')}"></div>
      <div class="field"><label>发运申请号</label><input class="input" id="tk-apply" placeholder="请输入" value="${esc(f.apply_no || '')}"></div>
      <div class="field"><label>VIN</label><input class="input" id="tk-vin" placeholder="请输入" value="${esc(f.vin || '')}"></div>
      <div class="field"><label>客户名称</label><input class="input" id="tk-cust" placeholder="请输入" value="${esc(f.customer_name || '')}"></div>
      <div class="field"><label>状态</label><select class="select" id="tk-st">
        <option value="">全部</option>
        ${Object.entries(TASK_STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v.t}</option>`).join('')}</select></div>
      <div class="field"><label>承运商</label><select class="select" id="tk-car">
        <option value="">全部</option>
        ${carriers.list.map((c) => `<option value="${c.id}" ${String(f.carrier_id) === String(c.id) ? 'selected' : ''}>${esc(c.carrier_name)}</option>`).join('')}</select></div>
      <div class="field"><label>创建日期</label><div class="date-range">
        <input class="input" type="date" id="tk-d1" value="${f.start_date || ''}" style="width:130px">
        <span class="muted">~</span>
        <input class="input" type="date" id="tk-d2" value="${f.end_date || ''}" style="width:130px"></div></div>
      <div class="filter-actions">
        <button class="btn btn-ghost" id="tk-reset">重置</button>
        <button class="btn btn-primary" id="tk-search">查询</button>
      </div>
    </section>

    <div class="toolbar">
      <div class="mock-console">
        <select class="select" id="mk-op">
          <option value="">外部系统模拟操作…</option>
          <optgroup label="CRM 系统">
            <option value="crm_apply">下发发运申请（接口1）</option>
            <option value="crm_cancel">同步取消申请（接口6，需待派单）</option>
            <option value="esign_init">发起物流电子签（接口2）</option>
          </optgroup>
          <optgroup label="狮桥物流">
            <option value="accept">承运商接单·分配司机（接口12）</option>
            <option value="track">位置回传（接口15）</option>
            <option value="esign_sign">电子签签收（接口14）</option>
          </optgroup>
          <optgroup label="WMS / 司机端">
            <option value="outbound">WMS 出库回传（接口13）</option>
            <option value="pickup">司机提车发运</option>
            <option value="arrive">司机到达·回填运费</option>
            <option value="finish">司机完结</option>
          </optgroup>
        </select>
        <button class="btn btn-ghost" id="mk-run">执行</button>
        <span class="tag-line">勾选任务后执行</span>
      </div>
      <button class="btn btn-primary" id="tk-dispatch">
        <svg class="bi" viewBox="0 0 14 14"><path d="m2.6 4 4 4-4 4M8 12h4V2H8"/></svg>批量派单</button>
    </div>

    <section class="card table-card"><div class="table-scroll" id="tk-body"></div>
      <footer class="pager" id="tk-pager"></footer></section>`;

  const collectFilters = () => {
    taskState.filters = {
      task_no: fv('tk-no'), apply_no: fv('tk-apply'), vin: fv('tk-vin'), customer_name: fv('tk-cust'),
      status: fv('tk-st'), carrier_id: fv('tk-car'), start_date: fv('tk-d1'), end_date: fv('tk-d2'),
    };
  };

  let currentList = [];
  const reload = async () => {
    const f = taskState.filters;
    const q = `?page=${taskState.page}&size=${taskState.size}` + Object.entries(f)
      .filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');
    const d = await api('/ship-tasks' + q);
    taskState.total = d.total;
    $('#tk-body', view).innerHTML = `
      <table>
        <thead><tr>
          <th style="width:34px"><input type="checkbox" class="ck" id="tk-all"></th>
          <th>任务单号</th><th>发运申请号</th><th>客户名称</th><th>VIN</th><th>车型</th>
          <th>线路</th><th>计划运费</th><th>承运商</th><th>司机</th><th>状态</th><th>创建日期</th><th style="width:150px">操作</th>
        </tr></thead>
        <tbody>${d.list.map((r) => `
          <tr data-id="${r.id}">
            <td><input type="checkbox" class="ck rowck" data-id="${r.id}"></td>
            <td><a class="link" onclick="openTaskDetail(${r.id})">${esc(r.task_no)}</a></td>
            <td>${esc(r.apply_no)}</td>
            <td><span class="ellipsis" title="${esc(r.customer_name)}">${esc(r.customer_name)}</span></td>
            <td>${esc(r.vin)}</td>
            <td>${empty(r.vehicle_model)}</td>
            <td><span class="ellipsis" title="${esc(r.origin)}→${esc(r.dest_address)}">${esc((r.dest_region || '').slice(0, 3) || '-')}线</span></td>
            <td>¥${money(r.plan_freight)}</td>
            <td>${r.carrier_name ? `<span class="ellipsis" title="${esc(r.carrier_name)}">${esc(r.carrier_name)}</span>` : '<span class="muted">-</span>'}</td>
            <td>${r.driver_name ? esc(r.driver_name) : '<span class="muted">-</span>'}</td>
            <td>${taskTag(r.status)}</td>
            <td>${fmtDT(r.created_at)}</td>
            <td class="actions">
              ${r.status === 'PENDING' ? `<a class="link" onclick="dispatchForm(${r.id})">派单</a>` : ''}
              ${r.status === 'DISPATCHED' ? `<a class="link" onclick="cancelDispatchForm(${r.id})">取消派单</a><a class="link" onclick="dispatchForm(${r.id}, true)">改派</a>` : ''}
              <a class="link" onclick="openTaskDetail(${r.id})">详情</a>
            </td>
          </tr>`).join('') || `<tr><td colspan="13" class="empty-row">暂无数据</td></tr>`}</tbody>
      </table>`;
    $('#tk-pager', view).innerHTML = pagerHtml(d.total, taskState.page, taskState.size);
    bindPager($('#tk-pager', view), taskState, reload);

    const all = $('#tk-all', view);
    if (all) all.onchange = () => $$('.rowck', view).forEach((c) => (c.checked = all.checked));
  };

  const checkedIds = () => $$('.rowck', view).filter((c) => c.checked).map((c) => Number(c.dataset.id));

  $('#tk-search', view).onclick = () => { collectFilters(); taskState.page = 1; reload(); };
  $('#tk-reset', view).onclick = () => {
    taskState.filters = {}; taskState.page = 1;
    ['tk-no', 'tk-apply', 'tk-vin', 'tk-cust'].forEach((i) => ($('#' + i, view).value = ''));
    ['tk-st', 'tk-car', 'tk-d1', 'tk-d2'].forEach((i) => ($('#' + i, view).value = ''));
    reload();
  };
  $('#tk-dispatch', view).onclick = async () => {
    const ids = checkedIds();
    if (!ids.length) return toast('请先勾选需要派单的任务', false);
    const tasks = currentList.filter((t) => ids.includes(t.id));
    if (!tasks.length) return toast('所选任务不在当前页，请重新勾选', false);
    dispatchBatchForm(tasks, carriersList);
  };
  $('#mk-run', view).onclick = async () => {
    const op = fv('mk-op');
    if (!op) return toast('请选择模拟操作', false);
    runMock(op, checkedIds(), { carriersList, driversList: drivers.list });
  };

  await reload();
}

/** 派单 / 改派表单：展示线路参考价（CRM计划运费，只读）+ 派单备注 */
async function dispatchForm(taskId, isReassign = false) {
  const [carriers, detail] = await Promise.all([
    api('/carriers?status=COOPERATING&size=100'),
    api(`/ship-tasks/${taskId}`),
  ]);
  const t = detail.task;
  const m = openModal({
    title: `${isReassign ? '改派' : '派单'} · ${t.task_no}`,
    body: `
      <div class="form-tip" style="margin:0 0 12px">派单后同步至三方物流系统（狮桥发运系统），由承运商确认接单并分配司机</div>
      ${F.text('dp-price', '线路参考价（元）', { value: money(t.plan_freight), dis: 1, tip: '取自 CRM 同步的计划运费，不可修改' })}
      ${F.select('dp-carrier', '承运商', carriers.list.filter((c) => !(isReassign && t.carrier_id === c.id)).map((c) => `<option value="${c.id}">${esc(c.carrier_name)}（${esc(c.coop_routes || '不限线路')}）</option>`).join(''), { req: 1, tip: '仅可选择合作中的承运商；已停用的承运商不可被派单' })}
      ${F.textarea('dp-remark', '派单备注', { ph: '选填，调度派单说明（如：加急发运、限高架车辆注意）', value: t.dispatch_remark || '' })}`,
    foot: `<button class="btn btn-ghost" data-close>取消</button>
           <button class="btn btn-primary" id="dp-ok">确认${isReassign ? '改派' : '派单'}</button>`,
  });
  $('#dp-ok', m.el).onclick = async () => {
    try {
      const carrier_id = Number(fv('dp-carrier'));
      const body = { carrier_id, remark: fv('dp-remark') };
      const d = isReassign
        ? await api(`/ship-tasks/${taskId}/reassign`, { method: 'POST', body })
        : await api(`/ship-tasks/${taskId}/dispatch`, { method: 'POST', body });
      m.close(); toast(d.message); pageTasks($('#view'));
    } catch (e) { toast(e.message, false); }
  };
}

/** 批量派单：任务清单 + 参考价合计 + 批量备注 */
function dispatchBatchForm(tasks, carriersList) {
  const total = tasks.reduce((s, t) => s + (Number(t.plan_freight) || 0), 0);
  const m = openModal({
    title: `批量派单（${tasks.length} 单）`,
    wide: true,
    body: `
      <div class="table-scroll" style="margin:0 0 12px"><table>
        <thead><tr><th>任务单号</th><th>客户名称</th><th>VIN</th><th style="text-align:right">线路参考价</th></tr></thead>
        <tbody>${tasks.map((t) => `<tr>
          <td>${esc(t.task_no)}</td>
          <td><span class="ellipsis" title="${esc(t.customer_name)}">${esc(t.customer_name)}</span></td>
          <td>${esc(t.vin)}</td>
          <td style="text-align:right">¥${money(t.plan_freight)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3" style="text-align:right;font-weight:600">参考价合计（${tasks.length} 单）</td>
          <td style="text-align:right;font-weight:700;color:var(--primary)">¥${money(total)}</td></tr></tfoot>
      </table></div>
      ${F.select('bp-carrier', '承运商', carriersList.map((c) => `<option value="${c.id}">${esc(c.carrier_name)}</option>`).join(''), { req: 1, tip: '批量派单仅对待派单任务生效，非待派单自动跳过' })}
      ${F.textarea('bp-remark', '批量派单备注', { ph: '选填，将写入所选任务的派单备注（如：同线路拼载发运）' })}`,
    foot: `<button class="btn btn-ghost" data-close>取消</button>
           <button class="btn btn-primary" id="bp-ok">确认派单</button>`,
  });
  $('#bp-ok', m.el).onclick = async () => {
    try {
      const d = await api('/ship-tasks/dispatch-batch', {
        method: 'POST',
        body: { task_ids: tasks.map((t) => t.id), carrier_id: Number(fv('bp-carrier')), remark: fv('bp-remark') },
      });
      m.close(); toast(d.message); pageTasks($('#view'));
    } catch (e) { toast(e.message, false); }
  };
}

/** 取消派单 */
function cancelDispatchForm(taskId) {
  const m = openModal({
    title: '取消派单',
    body: `
      <div class="form-tip" style="margin:0 0 12px">取消后任务回到"待派单"，并同步取消三方物流系统的派单信息</div>
      ${F.select('cd-reason', '取消原因', ['承运商无法履约', '调度调整', '其他'].map((x) => `<option>${x}</option>`).join(''), { req: 1 })}`,
    foot: `<button class="btn btn-ghost" data-close>取消</button>
           <button class="btn btn-primary" id="cd-ok">确认取消派单</button>`,
  });
  $('#cd-ok', m.el).onclick = async () => {
    try {
      const d = await api(`/ship-tasks/${taskId}/cancel-dispatch`, { method: 'POST', body: { reason: fv('cd-reason') } });
      m.close(); toast(d.message); pageTasks($('#view'));
    } catch (e) { toast(e.message, false); }
  };
}

/** 任务详情弹窗 */
async function openTaskDetail(id) {
  const d = await api(`/ship-tasks/${id}`);
  const t = d.task;
  const desc = (items) => `<div class="desc-grid">${items.map(([l, v, w]) => `
    <div class="desc ${w ? 'wide' : ''}"><label>${l}</label><span>${v}</span></div>`).join('')}</div>`;

  openModal({
    title: `任务详情 · ${t.task_no}`,
    wide: true,
    body: `
      <div class="sec-title">基础信息</div>
      ${desc([
        ['任务单号', esc(t.task_no)], ['任务状态', taskTag(t.status)], ['发运申请号', esc(t.apply_no)],
        ['客户名称', esc(t.customer_name)], ['大区', empty(t.region)], ['销售人员', empty(t.sales_name)],
        ['销售电话', empty(t.sales_phone) === '—' ? '—' : esc(fmtPhone(t.sales_phone))], ['创建人', esc(t.created_by)], ['创建日期', fmtDT(t.created_at)],
      ])}
      <div class="sec-title">车辆信息</div>
      ${desc([
        ['VIN', esc(t.vin)], ['车型', empty(t.vehicle_model)], ['发动机配置', empty(t.engine_config)],
        ['驾驶室类型', empty(t.cab_type)], ['订单号', empty(t.order_no)], ['报单号', empty(t.report_no)],
        ['生产工厂', empty(t.factory)], ['存放地点', empty(t.storage_location)],
      ])}
      <div class="sec-title">发运信息</div>
      ${desc([
        ['发运方式', esc(t.ship_mode)], ['计划运费', '¥' + money(t.plan_freight)],
        ['实际运费', t.actual_freight !== null ? '¥' + money(t.actual_freight) : '<span class="muted">到达后回填</span>'],
        ['运输里程', t.mileage ? t.mileage + ' 公里' : '<span class="muted">-</span>'],
        ['发运地点', esc(t.origin)], ['交付地区', empty(t.dest_region)],
        ['交付地址', esc(t.dest_address), 1], ['接车人电话', empty(t.receiver_phone) === '—' ? '—' : esc(fmtPhone(t.receiver_phone))],
      ])}
      ${t.cancel_reason ? `<div class="sec-title">取消信息</div>${desc([['取消原因', esc(t.cancel_reason), 1]])}` : ''}
      <div class="sec-title">承运信息</div>
      ${desc([
        ['承运商', t.carrier_name ? `${esc(t.carrier_name)}（${esc(t.carrier_code)}）` : '<span class="muted">待派单</span>'],
        ['司机', t.driver_name ? esc(t.driver_name) : '<span class="muted">承运商接单后分配</span>'],
        ['司机电话', empty(t.driver_phone)], ['预计提车日期', fmtD(t.plan_pickup_date)],
        ['派单备注', empty(t.dispatch_remark), 1],
      ])}
      <div class="sec-title">运输执行（时间轴）</div>
      <div class="timeline" style="padding:6px 2px 0">
        ${d.events.map((e, i) => `
          <div class="tl-item ${i === d.events.length - 1 && t.status !== 'CANCELLED' ? 'cur' : 'done'}">
            <span class="tl-dot"></span>
            <div class="tl-head"><span class="tl-name">${esc(e.node_name)}</span><span class="tl-time">${fmtDT(e.created_at)}</span></div>
            <div class="tl-detail">${esc(e.detail || '')} <span class="muted">· 操作人: ${esc(e.operator)}</span></div>
          </div>`).join('') || '<div class="empty-row">暂无执行节点</div>'}
      </div>
      ${d.esigns.length ? `<div class="sec-title">关联电子签</div>
        <table style="min-width:0"><thead><tr><th>电子签ID</th><th>签署类型</th><th>签署方</th><th>发起时间</th><th>状态</th></tr></thead>
        <tbody>${d.esigns.map((e) => `<tr><td>${esc(e.esign_id)}</td><td>${esc(e.sign_type)}</td><td>${empty(e.signer)}</td><td>${fmtDT(e.initiated_at)}</td><td>${esignTag(e.status)}</td></tr>`).join('')}</tbody></table>` : ''}`,
  });
}

// ============ 外部系统模拟执行 ============
async function runMock(op, ids, ctx) {
  if (!ids.length && op !== 'crm_apply' && op !== 'esign_init') return toast('请先勾选任务', false);

  // 需要参数的操作：弹表单
  if (op === 'crm_apply') return crmApplyForm();
  if (op === 'esign_init') {
    const esign_id = prompt('输入电子签ID（如 ES202610160099）') || '';
    if (!esign_id) return;
    return execMockBatch(op, ids, { esign_id });
  }
  if (op === 'accept') {
    const drivers = ctx.driversList || (await api('/drivers/options')).list;
    const m = openModal({
      title: `狮桥接单 · 分配司机（${ids.length} 单）`,
      body: `
        ${F.select('mk-driver', '分配司机', drivers.map((x) => `<option value="${x.id}">${esc(x.name)} · ${esc(fmtPhone(x.phone))} · ${esc(x.carrier_name || '散单')}</option>`).join(''), { req: 1 })}
        ${F.text('mk-date', '预计提车日期', { value: new Date(Date.now() + 86400000).toISOString().slice(0, 10) })}`,
      foot: `<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="mk-ok">执行</button>`,
    });
    $('#mk-ok', m.el).onclick = async () => {
      m.close();
      execMockBatch(op, ids, { driver_id: Number(fv('mk-driver')), plan_pickup_date: fv('mk-date') });
    };
    return;
  }
  if (op === 'track') {
    const m = openModal({
      title: `狮桥位置回传（${ids.length} 单）`,
      body: `
        ${F.text('mk-pos', '当前位置描述', { req: 1, ph: '如：南京市江宁区 G42沪蓉高速', value: '合肥市 G40沪陕高速' })}
        ${F.text('mk-speed', '当前时速(km/h)', { value: '65' })}`,
      foot: `<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="mk-ok">执行</button>`,
    });
    $('#mk-ok', m.el).onclick = async () => {
      m.close();
      execMockBatch(op, ids, { position_desc: fv('mk-pos'), speed: Number(fv('mk-speed')) || null });
    };
    return;
  }
  if (op === 'arrive') {
    const m = openModal({
      title: `司机到达 · 回填运费（${ids.length} 单）`,
      body: `
        <div class="form-tip" style="margin:0 0 12px">留空则默认使用计划运费。到达后将自动生成运费单（进入应付运费对账）</div>
        ${F.text('mk-freight', '实际运费(元)', { ph: '留空=计划运费' })}
        ${F.text('mk-mileage', '运输里程(公里)', { ph: '如 620' })}`,
      foot: `<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="mk-ok">执行</button>`,
    });
    $('#mk-ok', m.el).onclick = async () => {
      m.close();
      execMockBatch(op, ids, {
        actual_freight: fv('mk-freight') ? Number(fv('mk-freight')) : undefined,
        mileage: fv('mk-mileage') ? Number(fv('mk-mileage')) : undefined,
      });
    };
    return;
  }
  return execMockBatch(op, ids, {});
}

async function execMockBatch(op, ids, ext) {
  // 需要任务单号：先查列表拿 task_no
  let tasks = [];
  try {
    const d = await api(`/ship-tasks?size=100`);
    tasks = d.list.filter((t) => ids.includes(t.id));
  } catch (e) { return toast(e.message, false); }

  const opDef = {
  crm_cancel: ['crm/cancel', (t, e) => ({ apply_no: t.apply_no, cancel_reason: 'CRM发起取消' })],
  esign_init: ['esign/init', (t, e) => ({ esign_id: e.esign_id, vin: t.vin, apply_no: t.apply_no })],
  esign_sign: ['esign/sign-task', (t) => ({ apply_no: t.apply_no, task_no: t.task_no })],
  accept: ['shiqiao/accept', (t, e) => ({ apply_no: t.apply_no, task_no: t.task_no, driver_id: e.driver_id, plan_pickup_date: e.plan_pickup_date })],
  outbound: ['wms/outbound', (t) => ({ apply_no: t.apply_no, task_no: t.task_no })],
  pickup: ['shiqiao/pickup', (t) => ({ apply_no: t.apply_no, task_no: t.task_no })],
  track: ['shiqiao/track', (t, e) => ({ apply_no: t.apply_no, task_no: t.task_no, position_desc: e.position_desc, speed: e.speed })],
  arrive: ['shiqiao/arrive', (t, e) => ({ apply_no: t.apply_no, task_no: t.task_no, actual_freight: e.actual_freight, mileage: e.mileage })],
  finish: ['shiqiao/finish', (t) => ({ apply_no: t.apply_no, task_no: t.task_no })],
}[op];
  if (!opDef) return toast('操作类型未实现: ' + op, false);

  const okList = [];
  const failList = [];
  for (const t of tasks) {
    try {
      const d = await api(`/mock/${opDef[0]}`, { method: 'POST', body: opDef[1](t, ext) });
      okList.push(`${t.task_no}: ${d.message}`);
    } catch (e) {
      failList.push(`${t.task_no}: ${e.message}`);
    }
  }
  openModal({
    title: `模拟执行结果 · ${okList.length} 成功 / ${failList.length} 失败`,
    wide: true,
    body: `
      ${okList.length ? `<div class="sec-title" style="color:var(--success)">成功</div>${okList.map((x) => `<div style="padding:4px 0;color:var(--text-2)">✓ ${esc(x)}</div>`).join('')}` : ''}
      ${failList.length ? `<div class="sec-title" style="color:var(--danger)">失败（状态校验未通过）</div>${failList.map((x) => `<div style="padding:4px 0;color:var(--danger)">✕ ${esc(x)}</div>`).join('')}` : ''}`,
  });
  if (okList.length) { route(); }
}

/** CRM 下发发运申请表单 */
function crmApplyForm() {
  const m = openModal({
    title: 'CRM 下发发运申请（接口1）',
    wide: true,
    body: `
      <div class="form-tip" style="margin:0 0 12px">模拟 CRM 系统向 STP 下发发运申请，平台按「FY+年月日+四位序列号」自动生成任务单号，并进入待派单状态</div>
      ${F.text('ca-apply', '发运申请号', { req: 1, ph: '如 APPLY-20261016-100', value: 'APPLY-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Math.floor(Math.random() * 900) + 100) })}
      ${F.text('ca-cust', '客户名称', { req: 1, ph: '请输入客户全称' })}
      <div class="pair" style="display:contents">
      ${F.text('ca-vin', 'VIN', { req: 1, ph: '17位车架号' })}
      ${F.text('ca-model', '车型', { ph: '如 星辰重卡H9' })}
      </div>
      ${F.text('ca-dest', '交付地址', { req: 1, ph: '省市区详细地址' })}
      ${F.text('ca-freight', '计划运费(元)', { req: 1, ph: '线路参考价', value: '9800' })}
      ${F.text('ca-sales', '销售人员', { ph: '销售姓名' })}
      ${F.intlPhone('ca-phone', '销售电话', { tip: '选填；默认中国 +86，点击国旗可切换国家' })}`,
    foot: `<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="ca-ok">下发</button>`,
  });
  const ph = initPhoneInput('ca-phone', '');
  $('#ca-ok', m.el).onclick = async () => {
    try {
      const e3 = phoneCheck(ph, '销售电话', { required: false });
      if (e3) throw new Error(e3);
      const body = {
        apply_no: fv('ca-apply'), customer_name: fv('ca-cust'), vin: fv('ca-vin'),
        vehicle_model: fv('ca-model') || null, dest_address: fv('ca-dest'),
        plan_freight: Number(fv('ca-freight')), sales_name: fv('ca-sales') || null, sales_phone: phoneVal(ph) || null,
      };
      if (!body.apply_no || !body.customer_name || !body.vin || !body.dest_address || !body.plan_freight) throw new Error('请填写完整必填项');
      const d = await api('/mock/crm/apply', { method: 'POST', body });
      m.close(); toast(`${d.message} · 任务单号 ${d.data.task_no}`); route();
    } catch (e) { toast(e.message, false); }
  };
}

// ============ 页面: 在途监控 ============
const trackState = { page: 1, size: 50, keyword: '', total: 0, selected: null };

async function pageTracking(view) {
  view.innerHTML = `
    <section class="card filter">
      <div class="field"><label>任务单号</label><input class="input" id="tr-kw" placeholder="请输入任务单号" value="${esc(trackState.keyword)}"></div>
      <div class="filter-actions">
        <button class="btn btn-ghost" id="tr-reset">重置</button>
        <button class="btn btn-primary" id="tr-search">查询</button>
      </div>
    </section>
    <div class="track-layout">
      <section class="card track-list" id="tr-list" style="overflow:hidden;max-height:calc(100vh - 220px);overflow-y:auto"></section>
      <section id="tr-detail"><div class="card empty-row">选择左侧运单查看在途详情</div></section>
    </div>`;

  const loadDetail = async (taskId) => {
    trackState.selected = taskId;
    const d = await api(`/tracking/${taskId}`);
    const t = d.task;
    const STAGE_PCT = { PENDING: 0, DISPATCHED: 8, ACCEPTED: 15, OUT_BOUND: 25, PICKED_UP: 40, IN_TRANSIT: 60, ARRIVED: 88, FINISHED: 100, CANCELLED: 0 };
    const pct = STAGE_PCT[t.status] ?? 0;
    const curPos = d.trackings.length ? d.trackings[d.trackings.length - 1].position_desc : '—';

    $('#tr-detail', view).innerHTML = `
      <div class="card">
        <div class="panel-head"><span>运单信息</span>${taskTag(t.status)}</div>
        <div class="route-viz">
          <div class="route-line">
            <div class="route-fill" style="width:${pct}%"></div>
            <div class="route-node done" style="left:0"><div class="pt"></div><div class="txt" style="left:0;transform:none">${esc(t.origin || '起点').slice(0, 6)}</div></div>
            ${d.trackings.length ? `<div class="route-node done" style="left:${pct}%"><div class="pt"></div><div class="txt bottom">${esc(curPos).slice(0, 10)}</div></div>` : ''}
            <div class="route-node ${pct >= 100 ? 'done' : ''}" style="left:100%"><div class="pt"></div><div class="txt" style="left:auto;right:-30px;transform:none">${esc(t.dest_region || '终点').slice(0, 5)}</div></div>
          </div>
        </div>
        <div class="desc-grid" style="border-left:none;border-right:none;border-radius:0">
          ${[['任务单号', esc(t.task_no)], ['运输单号', empty(d.trackings[0]?.transport_no)], ['VIN', esc(t.vin)], ['车型', empty(t.vehicle_model)],
            ['客户名称', esc(t.customer_name)], ['承运商', empty(t.carrier_name)], ['司机', empty(t.driver_name)], ['司机电话', empty(t.driver_phone)],
            ['预计提车', fmtD(t.plan_pickup_date)], ['发运时间', fmtDT(t.ship_at)], ['到达时间', fmtDT(t.arrive_at)], ['计划运费', '¥' + money(t.plan_freight)],
            ['交付地址', esc(t.dest_address), 1]]
            .map(([l, v, w]) => `<div class="desc ${w ? 'wide' : ''}"><label>${l}</label><span>${v}</span></div>`).join('')}
        </div>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="panel-head"><span>运输地图</span><span style="font-weight:400;color:var(--text-3);font-size:12px">${esc(t.origin || '')} → ${esc(t.dest_region || '')}</span></div>
        <div id="tm-zoom"></div>
        <div id="tm-map"></div>
      </div>
      <div class="dash-grid" style="grid-template-columns:1fr 1fr;margin-top:12px">
        <div class="card">
          <div class="panel-head">运输节点</div>
          <div class="timeline" style="padding:12px 16px">
            ${d.events.map((e, i) => `
              <div class="tl-item ${i === d.events.length - 1 ? 'cur' : 'done'}">
                <span class="tl-dot"></span>
                <div class="tl-head"><span class="tl-name">${esc(e.node_name)}</span><span class="tl-time">${fmtDT(e.created_at)}</span></div>
                <div class="tl-detail">${esc(e.detail || '')}</div>
              </div>`).join('') || '<div class="empty-row">暂无节点</div>'}
          </div>
        </div>
        <div class="card">
          <div class="panel-head">位置记录（狮桥每小时回传）</div>
          <div class="table-scroll" style="max-height:340px;overflow-y:auto">
            <table style="min-width:0">
              <thead><tr><th>上报时间</th><th>当前位置</th><th>时速</th></tr></thead>
              <tbody>${d.trackings.map((r) => `
                <tr><td>${fmtDT(r.reported_at)}</td>
                    <td><span class="ellipsis" style="max-width:220px" title="${esc(r.position_desc)}">${esc(r.position_desc)}</span></td>
                    <td>${r.speed ? r.speed + ' km/h' : '-'}</td></tr>`).join('') || `<tr><td colspan="3" class="empty-row">暂无位置记录</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    // ===== 运输地图渲染（PRD: 上为整体路径放大界面，底部为中国地图） =====
    const og = matchCityGeo(t.origin) || matchCityGeo('合肥');
    const dg = matchCityGeo(t.dest_address) || matchCityGeo(t.dest_region);
    const isArrived = ['ARRIVED', 'FINISHED'].includes(t.status);
    const originM = og ? { label: og.city, geo2: toXY(...og.geo), tip: `起始地：${t.origin || ''}` } : null;
    const destM = dg ? { label: dg.city, geo2: toXY(...dg.geo), tip: `目的地：${t.dest_address || t.dest_region || ''}` } : null;

    // 位置回传点（城市坐标匹配成功的）
    const trkPts = d.trackings.map((r) => ({ r, m: matchCityGeo(r.position_desc) })).filter((x) => x.m);
    const curX = trkPts.length ? trkPts[trkPts.length - 1] : null;
    const stopMs = (isArrived ? trkPts : trkPts.slice(0, -1)).map((x) => ({
      geo2: toXY(...x.m.geo),
      tip: `${fmtDT(x.r.reported_at)} ${x.r.position_desc}${x.r.speed ? ` · ${x.r.speed}km/h` : ''}`,
    }));
    const curM = curX && !isArrived ? {
      geo2: toXY(...curX.m.geo),
      tip: `当前位置：${curX.r.position_desc}${curX.r.speed ? ` · ${curX.r.speed}km/h` : ''}`,
    } : null;

    // 整体路径放大界面：起点 → 按时间序的位置点 → 终点
    renderRouteZoom($('#tm-zoom', view), {
      originLabel: og?.city || (t.origin || '起点'),
      destLabel: dg?.city || (t.dest_region || '终点'),
      stops: trkPts.map((x, i) => ({
        name: x.m.city,
        meta: `${String(x.r.reported_at).slice(5, 16)}${x.r.speed ? ' · ' + x.r.speed + 'km/h' : ''}`,
        tip: x.r.position_desc,
        cur: !isArrived && i === trkPts.length - 1,
      })),
      done: isArrived,
    });
    // 中国地图：起终点 + 位置点 + 路径动画
    const provHL = ['安徽'];
    const dp = String(t.dest_region || '').replace(/省|市|自治区|特别行政区|维吾尔|回族|壮族/g, '');
    if (dp && !provHL.includes(dp)) provHL.push(dp);
    renderChinaMap($('#tm-map', view), {
      origin: originM, dest: destM, stops: stopMs, cur: curM,
      originLabel: t.origin, destLabel: t.dest_address || t.dest_region,
      curLabel: curX ? curX.r.position_desc : '',
      provincesHL: provHL,
    });
  };

  const reload = async () => {
    const d = await api(`/tracking?page=${trackState.page}&size=${trackState.size}&task_no=${encodeURIComponent(trackState.keyword)}`);
    trackState.total = d.total;
    $('#tr-list', view).innerHTML = `<div class="panel-head" style="padding:11px 14px">在途运单（${d.total}）</div>` + d.list.map((r) => `
      <div class="row ${trackState.selected === r.id ? 'selected' : ''}" data-id="${r.id}">
        <div class="l1"><span><b>${esc(r.task_no)}</b></span>${taskTag(r.status)}</div>
        <div class="l2"><span>${esc(r.vehicle_model || '')}</span><span>${esc(r.driver_name || '未分配司机')}</span></div>
        <div class="l2"><span>📍 ${r.position_desc ? esc(r.position_desc) : '暂无位置'}</span><span>${r.reported_at ? fmtDT(r.reported_at) : ''}</span></div>
      </div>`).join('') || '<div class="empty-row">暂无运单</div>';
    $$('#tr-list .row', view).forEach((el) => {
      el.onclick = () => { loadDetail(Number(el.dataset.id)); $$('#tr-list .row', view).forEach((x) => x.classList.remove('selected')); el.classList.add('selected'); };
    });
    if (!trackState.selected && d.list.length) loadDetail(d.list[0].id);
  };

  $('#tr-search', view).onclick = () => { trackState.keyword = fv('tr-kw'); trackState.page = 1; reload(); };
  $('#tr-kw', view).onkeydown = (e) => { if (e.key === 'Enter') $('#tr-search', view).click(); };
  $('#tr-reset', view).onclick = () => { trackState.keyword = ''; $('#tr-kw', view).value = ''; reload(); };
  await reload();
}

// ============ 页面: 应付运费对账 ============
const freightState = { page: 1, size: 10, filters: {}, total: 0 };

async function pageFreight(view) {
  const carriers = (await api('/carriers?size=100')).list;
  const f = freightState.filters;
  view.innerHTML = `
    <section class="card filter">
      <div class="field"><label>运费单号</label><input class="input" id="fr-no" placeholder="请输入" value="${esc(f.freight_no || '')}"></div>
      <div class="field"><label>任务单号</label><input class="input" id="fr-task" placeholder="请输入" value="${esc(f.task_no || '')}"></div>
      <div class="field"><label>承运商</label><select class="select" id="fr-car">
        <option value="">全部</option>
        ${carriers.map((c) => `<option value="${c.id}" ${String(f.carrier_id) === String(c.id) ? 'selected' : ''}>${esc(c.carrier_name)}</option>`).join('')}</select></div>
      <div class="field"><label>对账状态</label><select class="select" id="fr-st">
        <option value="">全部</option>
        <option value="PENDING_RECON" ${f.status === 'PENDING_RECON' ? 'selected' : ''}>待对账</option>
        <option value="RECONED" ${f.status === 'RECONED' ? 'selected' : ''}>已对账</option></select></div>
      <div class="filter-actions">
        <button class="btn btn-ghost" id="fr-reset">重置</button>
        <button class="btn btn-primary" id="fr-search">查询</button>
      </div>
    </section>
    <div class="toolbar"><span class="hint" id="fr-sum"></span></div>
    <section class="card table-card"><div class="table-scroll" id="fr-body"></div>
      <footer class="pager" id="fr-pager"></footer></section>`;

  const reload = async () => {
    const f = freightState.filters;
    const q = `?page=${freightState.page}&size=${freightState.size}` + Object.entries(f)
      .filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');
    const d = await api('/freight-orders' + q);
    freightState.total = d.total;
    $('#fr-sum', view).textContent = `当前筛选合计金额：¥${money(d.amount)}`;
    $('#fr-body', view).innerHTML = `
      <table>
        <thead><tr><th>运费单号</th><th>任务单号</th><th>承运商</th><th>司机</th><th>线路</th><th>里程</th>
          <th>计划运费</th><th>实际运费</th><th>完结时间</th><th>状态</th><th style="width:190px">操作</th></tr></thead>
        <tbody>${d.list.map((r) => `
          <tr>
            <td>${esc(r.freight_no)}</td>
            <td><a class="link" onclick="freightDetail(${r.id})">${esc(r.task_no)}</a></td>
            <td><span class="ellipsis" title="${esc(r.carrier_name)}">${esc(r.carrier_name || '-')}</span></td>
            <td>${empty(r.driver_name)}</td>
            <td><span class="ellipsis" title="${esc(r.origin)} → ${esc(r.dest)}">${esc(r.origin || '-')} → ${esc(r.dest || '-')}</span></td>
            <td>${r.mileage ? r.mileage + ' km' : '-'}</td>
            <td>¥${money(r.plan_freight)}</td>
            <td><b style="color:var(--primary)">¥${money(r.actual_freight)}</b></td>
            <td>${fmtDT(r.finish_at)}</td>
            <td>${reconTag(r.status)}</td>
            <td class="actions">
              <a class="link" onclick="freightDetail(${r.id})">费用明细</a>
              ${r.status === 'PENDING_RECON' ? `
                <a class="link" onclick="adjustFreightForm(${r.id},${Number(r.actual_freight)})">修改运费</a>
                <a class="link" onclick="reconFreight(${r.id})">确认对账</a>` : ''}
            </td>
          </tr>`).join('') || `<tr><td colspan="11" class="empty-row">暂无数据</td></tr>`}</tbody>
      </table>`;
    $('#fr-pager', view).innerHTML = pagerHtml(d.total, freightState.page, freightState.size);
    bindPager($('#fr-pager', view), freightState, reload);
  };

  $('#fr-search', view).onclick = () => {
    freightState.filters = { freight_no: fv('fr-no'), task_no: fv('fr-task'), carrier_id: fv('fr-car'), status: fv('fr-st') };
    freightState.page = 1; reload();
  };
  $('#fr-reset', view).onclick = () => {
    freightState.filters = {}; freightState.page = 1;
    ['fr-no', 'fr-task', 'fr-car', 'fr-st'].forEach((i) => ($('#' + i, view).value = ''));
    reload();
  };
  await reload();
}

async function freightDetail(id) {
  const d = await api(`/freight-orders/${id}`);
  const o = d.order;
  openModal({
    title: `费用明细 · ${o.freight_no}`,
    body: `
      <div class="sec-title">费用信息</div>
      <div class="desc-grid">
        ${[['任务单号', esc(o.task_no)], ['承运商', empty(o.carrier_name)], ['司机', empty(o.driver_name)],
          ['线路', `${esc(o.origin || '-')} → ${esc(o.dest || '-')}`, 1], ['里程', o.mileage ? o.mileage + ' 公里' : '-'],
          ['计划运费', '¥' + money(o.plan_freight)], ['实际运费', '¥' + money(o.actual_freight)], ['对账状态', reconTag(o.status)],
          ['完结时间', fmtDT(o.finish_at)], ['创建时间', fmtDT(o.created_at)]]
          .map(([l, v, w]) => `<div class="desc ${w ? 'wide' : ''}"><label>${l}</label><span>${v}</span></div>`).join('')}
      </div>
      <div class="sec-title">运费修改记录</div>
      <table style="min-width:0">
        <thead><tr><th>修改时间</th><th>修改前</th><th>修改后</th><th>修改原因</th><th>操作人</th></tr></thead>
        <tbody>${d.adjustments.map((a) => `
          <tr><td>${fmtDT(a.created_at)}</td><td>¥${money(a.before_amount)}</td><td>¥${money(a.after_amount)}</td>
              <td>${esc(a.reason)}</td><td>${esc(a.operator)}</td></tr>`).join('') || `<tr><td colspan="5" class="empty-row">暂无修改记录</td></tr>`}</tbody>
      </table>`,
  });
}

function adjustFreightForm(id, current) {
  const m = openModal({
    title: '修改运费',
    body: `
      <div class="form-tip" style="margin:0 0 12px">当前实际运费：<b>¥${money(current)}</b>，修改后系统将自动记录修改日志</div>
      ${F.text('af-amount', '新运费(元)', { req: 1, ph: '请输入金额' })}
      ${F.textarea('af-reason', '修改原因', { req: 1, ph: '请填写修改原因（必填）' })}`,
    foot: `<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="af-ok">确认修改</button>`,
  });
  $('#af-ok', m.el).onclick = async () => {
    try {
      const d = await api(`/freight-orders/${id}/adjust`, { method: 'POST', body: { amount: Number(fv('af-amount')), reason: fv('af-reason') } });
      m.close(); toast(d.message); pageFreight($('#view'));
    } catch (e) { toast(e.message, false); }
  };
}

async function reconFreight(id) {
  if (!(await confirmModal('确认与承运商完成该运费单对账？确认后不可再修改运费'))) return;
  try {
    const d = await api(`/freight-orders/${id}/recon`, { method: 'POST' });
    toast(d.message); pageFreight($('#view'));
  } catch (e) { toast(e.message, false); }
}

// ============ 页面: 电子签台账 ============
const esignState = { page: 1, size: 10, filters: {}, total: 0 };

async function pageEsign(view) {
  const f = esignState.filters;
  view.innerHTML = `
    <section class="card filter">
      <div class="field"><label>电子签ID</label><input class="input" id="es-id" placeholder="请输入" value="${esc(f.esign_id || '')}"></div>
      <div class="field"><label>任务单号</label><input class="input" id="es-task" placeholder="请输入" value="${esc(f.task_no || '')}"></div>
      <div class="field"><label>签署类型</label><select class="select" id="es-type">
        <option value="">全部</option>
        <option value="物流电子签" ${f.sign_type === '物流电子签' ? 'selected' : ''}>物流电子签</option>
        <option value="客户电子签" ${f.sign_type === '客户电子签' ? 'selected' : ''}>客户电子签</option></select></div>
      <div class="field"><label>签署状态</label><select class="select" id="es-st">
        <option value="">全部</option>
        <option value="PENDING" ${f.status === 'PENDING' ? 'selected' : ''}>待签署</option>
        <option value="SIGNED" ${f.status === 'SIGNED' ? 'selected' : ''}>已签署</option>
        <option value="CANCELLED" ${f.status === 'CANCELLED' ? 'selected' : ''}>已取消</option></select></div>
      <div class="filter-actions">
        <button class="btn btn-ghost" id="es-reset">重置</button>
        <button class="btn btn-primary" id="es-search">查询</button>
      </div>
    </section>
    <section class="card table-card"><div class="table-scroll" id="es-body"></div>
      <footer class="pager" id="es-pager"></footer></section>`;

  const reload = async () => {
    const f = esignState.filters;
    const q = `?page=${esignState.page}&size=${esignState.size}` + Object.entries(f)
      .filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');
    const d = await api('/esigns' + q);
    esignState.total = d.total;
    $('#es-body', view).innerHTML = `
      <table>
        <thead><tr><th>电子签ID</th><th>任务单号</th><th>VIN</th><th>签署类型</th><th>触发节点</th>
          <th>签署方</th><th>发起时间</th><th>签署完成时间</th><th>签署状态</th><th>任务状态</th></tr></thead>
        <tbody>${d.list.map((r) => `
          <tr>
            <td>${esc(r.esign_id)}</td>
            <td>${r.task_id ? `<a class="link" onclick="openTaskDetail(${r.task_id})">${esc(r.task_no)}</a>` : '<span class="muted">-</span>'}</td>
            <td>${esc(r.vin || '-')}</td>
            <td>${esc(r.sign_type)}</td>
            <td>${empty(r.trigger_node)}</td>
            <td>${empty(r.signer)}</td>
            <td>${fmtDT(r.initiated_at)}</td>
            <td>${fmtDT(r.signed_at)}</td>
            <td>${esignTag(r.status)}</td>
            <td>${r.task_status ? taskTag(r.task_status) : '<span class="muted">-</span>'}</td>
          </tr>`).join('') || `<tr><td colspan="10" class="empty-row">暂无数据</td></tr>`}</tbody>
      </table>`;
    $('#es-pager', view).innerHTML = pagerHtml(d.total, esignState.page, esignState.size);
    bindPager($('#es-pager', view), esignState, reload);
  };

  $('#es-search', view).onclick = () => {
    esignState.filters = { esign_id: fv('es-id'), task_no: fv('es-task'), sign_type: fv('es-type'), status: fv('es-st') };
    esignState.page = 1; reload();
  };
  $('#es-reset', view).onclick = () => {
    esignState.filters = {}; esignState.page = 1;
    ['es-id', 'es-task', 'es-type', 'es-st'].forEach((i) => ($('#' + i, view).value = ''));
    reload();
  };
  await reload();
}

// 暴露给 onclick 调用
Object.assign(window, {
  openTaskDetail, dispatchForm, dispatchBatchForm, cancelDispatchForm,
  carrierForm, toggleCarrier, driverForm, toggleDriver,
  freightDetail, adjustFreightForm, reconFreight,
});

// ============ 启动 ============
route();
