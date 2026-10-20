# STP 联系电话校验实现说明

> 本文梳理“联系电话”从输入、前端校验、后端校验到入库与展示的完整实现，并补充该链路中引用到的公共组件、工具函数与接口服务，便于复用与后续维护。

| 项目 | 内容 |
| --- | --- |
| 适用范围 | STP 智能运输管理平台 |
| 代码基线 | STP AI测试环境 |
| 控件版本 | intl-tel-input v29.5.5 |
| 校验库 | libphonenumber-js/max |
| 更新日期 | 2026-10-20 |

## 目录

- [1. 概述与分层](#1-概述与分层)
- [2. 校验规则速查](#2-校验规则速查)
- [3. 全链路时序](#3-全链路时序)
- [4. 前端实现](#4-前端实现)
  - [4.1 PhoneInput 控件](#41-phoneinput-控件)
  - [4.2 表单规则](#42-表单规则)
- [5. 后端强校验](#5-后端强校验)
- [6. 存储与展示](#6-存储与展示)
- [7. 存量数据迁移](#7-存量数据迁移)
- [8. 引用的公共组件](#8-引用的公共组件)
  - [8.1 业务组件](#81-业务组件)
  - [8.2 公共工具与服务](#82-公共工具与服务)
- [9. 组件依赖关系](#9-组件依赖关系)
- [10. 注意事项](#10-注意事项)
- [11. 文件清单](#11-文件清单)

---

## 1. 概述与分层

电话校验不是单点正则，而是“控件格式化 + 表单校验 + 后端强校验 + 统一存储”四层配合。核心原则只有两条：**前端负责即时反馈，后端负责最终裁决**；**落库统一为 E.164 格式**（如 `+8613800138000`）。

```text
交互层   PhoneInput（国家选择 + 号码输入）
           + NForm / NFormItem（naive-ui）
           → 表单规则（required + validator）
              ↓ v-model 输出 E.164
服务层   services/carriers.ts / services/drivers.ts
           → services/http.ts（信封拆包 / ApiError）
              ↓ POST / PUT
后端     helpers.assertPhone()
           → libphonenumber-js/max（parse + isValid + getType）
           → MySQL（VARCHAR(20)，存 E.164）
              ↓ 查询返回
展示层   formatPhone()（138 0013 8000）
           → PageTable（列表列）/ DetailSection（详情分区）
```

## 2. 校验规则速查

全平台默认国家为中国（+86）。号码类型由 libphonenumber 判定，不使用手写正则做最终校验；只有展示层才用轻量正则做格式化。

| 号码类型 | 规则 | 示例 | 承运商 | 司机 | CRM 任务 |
| --- | --- | --- | --- | --- | --- |
| 国内手机 | 11 位，1 开头，3–9 第二位 | `13800138000` | 允许 | 必须 | 允许 |
| 国内座机 | 区号（0 开头 3–4 位）+ 7–8 位号码 | `0551-63612345` | 允许 | 拒绝 | 允许 |
| 400 / 800 | 10 位热线号码 | `4001234567` | 允许 | 拒绝 | 允许 |
| 国际号码 | 必须带 `+` 国家区号 | `+12025550123` | 允许 | 仅手机类型 | 允许 |
| 空值 | 承运商 / 司机必填；CRM 下发选填 | — | 必填 | 必填 | 选填 |

> **为什么“司机必须是手机号”不写在前端？**
> PhoneInput 的 `isValid()` 只判断号码本身是否有效，不区分类型；类型约束由后端 `assertPhone(..., { mobileOnly: true })` 通过 `getType()` 裁决。前端提示文案仅做提前告知，避免把业务类型规则耦合进通用控件。

## 3. 全链路时序

1. **用户输入**
   PhoneInput 初始化 intl-tel-input，默认 `initialCountry: 'cn'`，国旗与区号分离展示，占位符按手机号类型生成。

2. **实时产出 E.164**
   `input` 与 `countrychange` 事件触发 `iti.getNumber()`，号码不完整时返回 `''`，通过 `v-model` 写回表单。

3. **前端校验**
   表单 `validator` 调用 `phoneRef.value.isValid()`，优先 `isValidNumberPrecise()`（严格校验），退化到 `isValidNumber()`，最后兜底判断非空。

4. **提交**
   校验通过后直接提交 E.164 字符串；服务层经 `http.ts` 发请求，响应为统一信封，`postEnvelope` 保留后端 message。

5. **后端裁决**
   `assertPhone()` 重新解析、严格校验、类型判断，失败抛 `A0001`（HTTP 400），成功返回标准 E.164。

6. **入库与展示**
   数据库统一存 E.164；列表与详情通过 `formatPhone()` 转成人类可读格式，避免直接暴露 `+86`。

## 4. 前端实现

### 4.1 PhoneInput 控件

文件：`frontend/src/components/PhoneInput.vue`，封装本地 vendor 版 intl-tel-input v29.5.5。脚本与样式由 `frontend/index.html` 引入，控件初始化时读取全局 `window.intlTelInput` 与中文文案 `window.itiZh`。

**初始化参数**

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `modelValue` | `''` | E.164 值，支持空值 |
| `placeholder` | `请输入电话号码` | 页面通常传入“请输入联系电话”等业务文案 |
| `disabled` | `false` | 提交中禁用 |
| `initialCountry` | `'cn'` | 默认中国 +86 |
| `separateDialCode` | `true` | 国旗与区号独立展示 |

**事件与暴露方法**

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| emit | `update:modelValue` | 输出 E.164，未输完为 `''` |
| emit | `change` | 值变化时同步触发，便于联动 |
| emit | `blur` | 透传原生失焦事件 |
| expose | `getInstance()` | 获取 intl-tel-input 实例 |
| expose | `getNumber()` | 当前 E.164 值 |
| expose | `isValid()` | 严格校验结果，表单规则使用 |
| expose | `reset()` | 清空并恢复默认国家 |

**关键实现**

```ts
// 1. 初始化：默认中国 + 手机号占位
iti = window.intlTelInput(input, {
  initialCountry: props.initialCountry,
  separateDialCode: props.separateDialCode,
  placeholderNumberType: 'MOBILE',
  i18n: window.itiZh ?? undefined,
})
// 初始值回显：E.164 自动识别国家
if (props.modelValue) iti.setNumber(props.modelValue)
input.addEventListener('input', emitValue)
input.addEventListener('countrychange', emitValue)

// 2. 输出 E.164（号码不完整时为 ''）
function currentE164(): string {
  if (iti) return iti.getNumber() || ''
  return inputRef.value?.value ?? ''
}

// 3. 严格校验：v29 中 isValidNumber 仅位数校验，必须优先 Precise
isValid: (): boolean => {
  if (!iti) return Boolean(inputRef.value?.value)
  if (typeof iti.isValidNumberPrecise === 'function') return iti.isValidNumberPrecise()
  if (typeof iti.isValidNumber === 'function') return iti.isValidNumber()
  return Boolean(iti.getNumber())
}
```

其他约定：

- **外部赋值同步**：`watch(modelValue)` 判断与当前值不同后调用 `iti.setNumber()`；清空时恢复默认国家。
- **降级策略**：vendor 脚本未加载时退化为普通 `<input type="tel">`，`isValid()` 只判断非空，并输出告警日志。
- **资源释放**：`onBeforeUnmount` 移除监听并 `iti.destroy()`，避免 keep-alive 页签切换造成 DOM/事件泄漏。

### 4.2 表单规则

两个业务页面共用同一套写法：必填规则 + 自定义 validator，校验时机为 `input` 与 `blur`。

**承运商（允许手机 / 座机 / 400）**

```ts
const phoneRef = ref<InstanceType<typeof PhoneInput> | null>(null)

contact_phone: [
  { required: true, message: '请输入联系电话', trigger: ['input', 'blur'] },
  {
    message: '请输入有效的联系电话（默认中国 +86，支持手机/座机/400）',
    trigger: ['input', 'blur'],
    validator: () => (formModel.contact_phone ? (phoneRef.value?.isValid() ?? true) : true),
  },
]
```

**司机（要求手机号）**

```ts
phone: [
  { required: true, message: '请输入手机号', trigger: ['input', 'blur'] },
  {
    message: '请输入有效的手机号（司机需留手机号，座机/400 号码无法通过校验）',
    trigger: ['input', 'blur'],
    validator: () => (formModel.phone ? (phoneRef.value?.isValid() ?? true) : true),
  },
]
```

> **校验分工**：前端只保证“号码有效”；“司机必须手机号”由后端 `mobileOnly` 兜底。因此前端文案写的是提前提示，最终以接口返回的 `A0001` 为准。

**模板挂载**

```vue
<n-form-item label="联系电话" path="contact_phone">
  <div class="readonly-field">
    <PhoneInput
      ref="phoneRef"
      v-model="formModel.contact_phone"
      :disabled="submitting"
      placeholder="请输入联系电话"
    />
    <span class="field-tip">默认中国 +86：手机 11 位；座机为区号+8 位号码；400/800 十位，点击国旗可切换国家</span>
  </div>
</n-form-item>
```

## 5. 后端强校验

文件：`backend/src/helpers.js` 的 `assertPhone(value, { label, mobileOnly, required })`。基于 `libphonenumber-js/max`，校验失败统一抛 `ApiError('A0001')`，由 `errorHandler` 映射为 HTTP 400。

1. **空值处理**
   `String(value ?? '').trim()` 后为空：`required` 为真抛「{label}必填」，否则返回 `null`。

2. **长度保护**
   长度大于 25 直接判「{label}长度不正确」，避免异常长串进入解析器。

3. **按前缀选择解析策略**
   以 `+` 开头按国际号码解析；否则按 `'CN'` 解析。因此国外号码必须带国家区号。

4. **严格有效性校验**
   `parsePhoneNumberFromString()` 结果为空或 `isValid()` 为假时抛格式错误，文案即界面上的规则说明。

5. **类型校验（可选）**
   `mobileOnly` 为真时要求 `getType()` 为 `MOBILE` 或 `FIXED_LINE_OR_MOBILE`，否则报「座机/热线号码不可用，请填写手机号」。

6. **归一化返回**
   返回 `p.number`，即标准 E.164，上层直接入库，无需再做拼接。

```js
const { parsePhoneNumberFromString: parsePhone } = require('libphonenumber-js/max')

function assertPhone(value, { label = '联系电话', mobileOnly = false, required = true } = {}) {
  const v = String(value ?? '').trim()
  if (!v) {
    if (required) throw errParam(`${label}必填`)
    return null
  }
  if (v.length > 25) throw errParam(`${label}长度不正确`)
  const p = v.startsWith('+') ? parsePhone(v) : parsePhone(v, 'CN')
  if (!p || !p.isValid()) {
    throw errParam(`${label}格式不正确：国内支持手机号（11 位）、座机（区号+8 位号码，如 0551-63612345）、400/800 号码（10 位）；国外号码需带国家区号（如 +1 202-555-0123）`)
  }
  if (mobileOnly) {
    const t = p.getType()
    if (t !== 'MOBILE' && t !== 'FIXED_LINE_OR_MOBILE') {
      throw errParam('座机/热线号码不可用，请填写手机号')
    }
  }
  return p.number
}
```

**调用点**

| 路由 | 字段 | 参数 | 说明 |
| --- | --- | --- | --- |
| `routes/carriers.js:51` | `contact_phone` | `mobileOnly: false` | 承运商新增 / 编辑，必填 |
| `routes/drivers.js:95` | `phone` | `mobileOnly: true` | 司机新增 / 编辑，必须手机号 |
| `routes/external.js:135` | `salesPhone` | `required: false` | CRM 下发任务，销售人员电话选填 |
| `routes/external.js:136` | `receiverPhone` | `required: false` | CRM 下发任务，接车人电话选填 |
| `routes/external.js:382` | `phone` | `mobileOnly: true` | 狮桥同步司机，必须手机号 |

## 6. 存储与展示

### 数据库字段

均定义为 `VARCHAR(20)`，统一存 E.164（E.164 最长 16 字符，字段长度足够）：

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `carrier` | `contact_phone` | 承运商联系电话，NOT NULL |
| `driver` | `phone` | 司机手机号，NOT NULL，含索引 `idx_phone` |
| `shipping_task` | `sales_phone` | 销售人员联系方式，可空 |
| `shipping_task` | `receiver_phone` | 接车人联系电话，可空 |

### 展示格式化

文件：`frontend/src/utils/format.ts`。仅用于展示，不参与校验。

| 输入 | 输出 | 规则 |
| --- | --- | --- |
| `+8613800138000` | `138 0013 8000` | 国内手机 3-4-4 分隔 |
| `13800138000` | `138 0013 8000` | 无 +86 前缀同样识别 |
| `055163612345` | `0551-63612345` | 座机区号-号码 |
| `+12025550123` | `+12025550123` | 其他国家原样返回 |
| `null` / `''` | `-` | 占位符可自定义 |

## 7. 存量数据迁移

文件：`backend/scripts/migrate-phones.js`，用于把历史裸号一次性转为 E.164。规则：空值与已带 `+` 前缀的记录跳过；其余按中国号码解析，成功则更新，失败保留原值并输出清单。

```js
const TASKS = [
  { table: 'carriers',     col: 'contact_phone',  pk: 'id', label: '承运商联系电话' },
  { table: 'drivers',      col: 'phone',          pk: 'id', label: '司机手机号' },
  { table: 'ship_tasks',   col: 'sales_phone',    pk: 'id', label: '销售电话' },
  { table: 'ship_tasks',   col: 'receiver_phone', pk: 'id', label: '接车人电话' },
]
```

执行方式：`node scripts/migrate-phones.js`。脚本会打印“已转 E.164 / 已跳过 / 失败”三类统计，失败项需人工确认。

## 8. 引用的公共组件

电话链路并不是孤立实现的，它复用了 `frontend/src/components` 下的 8 个公共组件，以及若干公共工具与服务。

| 组件 | 路径 | 职责 | 在电话链路中的角色 |
| --- | --- | --- | --- |
| **PhoneInput** | `components/PhoneInput.vue` | 国际电话输入控件 | **核心**：输入、格式化、前端严格校验 |
| **PageTable** | `components/PageTable.vue` | 远程分页表格 | 司机 / 承运商列表，电话列展示与刷新 |
| **StatusTag** | `components/StatusTag.vue` | 状态药丸标签 | 列表状态列，与电话同表展示 |
| **ConfirmAction** | `components/ConfirmAction.vue` | 二次确认弹窗 | 停用 / 启用确认，与表单提交共用提交态 |
| **DetailSection** | `components/DetailSection.vue` | 详情分区描述栅格 | 任务详情展示销售 / 接车人 / 司机电话 |
| **MoneyText** | `components/MoneyText.vue` | 金额格式化文本 | 同页复用，非电话字段 |
| **PagePlaceholder** | `components/PagePlaceholder.vue` | 页面建设中占位 | 骨架阶段占位，与电话无直接关系 |
| **ChinaMap** | `components/ChinaMap.vue` | 中国地图与运输路径 | 轨迹页使用，与电话无直接关系 |

### 8.1 业务组件

#### PhoneInput

路径：`frontend/src/components/PhoneInput.vue`

intl-tel-input 的 Vue 封装，负责国家选择、号码输入与 E.164 输出，并暴露严格校验方法。

- `v-model` 双向绑定 E.164
- `ref.isValid()` 供表单规则调用
- `ref.reset()` 清空并恢复默认国家
- vendor 未加载时自动降级

#### PageTable

路径：`frontend/src/components/PageTable.vue`

NDataTable + 远程分页封装，内置 loading、空态、错误态与重试，查询参数变更自动回到第一页。

- `remote({ page, pageSize })` 返回 `{ list, total }`
- 暴露 `reload()` / `refresh()`
- 电话列通过 `render` 调 `formatPhone()`

#### StatusTag

路径：`frontend/src/components/StatusTag.vue`

统一状态药丸，内置任务 / 承运商 / 司机 / 对账 / 电子签五类映射，未知值回退字典接口。

- `type` + `value` 两个属性即可
- 配色对齐旧版设计系统

#### ConfirmAction

路径：`frontend/src/components/ConfirmAction.vue`

危险 / 常规二次确认弹窗，支持异步提交：`loading` + `auto-close=false` 由父组件决定关闭时机。

- 承运商 / 司机停用、启用均复用
- 正文支持字符串或默认插槽

#### DetailSection

路径：`frontend/src/components/DetailSection.vue`

详情分区标题 + NDescriptions 栅格，默认 3 列、带边框、浅灰 label 背景。

- 电话通过 `formatPhone()` 渲染
- `#extra` 插槽放编辑按钮

#### MoneyText

路径：`frontend/src/components/MoneyText.vue`

金额千分位 + 两位小数，兼容 DECIMAL 字符串，支持前缀与空值占位。

- 与电话同处详情页 / 列表页
- 复用 `utils/format.ts` 的 `money()`

#### PagePlaceholder

路径：`frontend/src/components/PagePlaceholder.vue`

页面建设期占位，保证路由可访问、可编译；页面完成后整体替换，无需保留。

#### ChinaMap

路径：`frontend/src/components/ChinaMap.vue`

包装 `lib/china-map.js` 渲染器，按起终点自适应视野，支持回传点点击。

- 用于轨迹页，不在电话链路内

### 8.2 公共工具与服务

| 模块 | 路径 | 能力 | 电话链路中的用途 |
| --- | --- | --- | --- |
| **format** | `utils/format.ts` | `money` / `datetime` / `dateOnly` / `formatPhone` | 列表与详情的电话展示 |
| **http** | `services/http.ts` | axios 实例、统一信封拆包、`ApiError`、`postEnvelope` | 提交电话字段，透传后端校验错误 message |
| **carriers** | `services/carriers.ts` | 列表 / 新增 / 编辑 / 启停 | 新增与编辑携带 E.164 电话 |
| **drivers** | `services/drivers.ts` | 列表 / 新增 / 编辑 / 启停 / 下拉选项 | 新增与编辑携带手机号 |
| **dictionary store** | `stores/dictionary.ts` | 字典缓存 | StatusTag 未知状态回退 |
| **api 类型** | `types/api.ts` | Carrier / Driver / ShipTask 等类型 | `contact_phone`、`phone`、`sales_phone` 等字段定义 |
| **全局注册** | `main.ts` | naive-ui 全量注册 | 页面可直接使用 `n-form` / `n-modal` 等 |
| **vendor 资源** | `index.html` + `public/vendor/intl-tel-input` | 注入 `window.intlTelInput` / `window.itiZh` | PhoneInput 的运行时依赖 |

> **复用建议**：`envSuccessText()` 目前在承运商、司机两个页面各有一份完全相同的实现（优先取后端信封 message，占位 `success` 时用前端兜底）。若要继续收敛公共代码，可提到 `utils/format.ts` 或独立 `utils/message.ts`，避免文案策略分叉。

## 9. 组件依赖关系

按“页面 → 组件 → 服务 → 后端”的方向依赖，公共组件不直接访问接口，保持可复用性。

```text
页面
  base/carriers/index.vue
  base/drivers/index.vue
  dispatch/tasks/TaskDetailDrawer.vue
        ↓ import
组件
  PhoneInput  PageTable  StatusTag  ConfirmAction
  DetailSection  MoneyText
        ↓ 调用
工具 / 服务
  utils/format.ts（formatPhone）
  services/carriers.ts  services/drivers.ts
  services/http.ts  stores/dictionary.ts
        ↓ HTTP /api
后端
  routes/* → helpers.assertPhone → MySQL
```

> **为什么 PhoneInput 必须独立成组件：** 它需要持有 intl-tel-input 实例、监听国家切换、在卸载时销毁 DOM，这些是有状态的命令式逻辑；抽成组件后，业务页面只关心 `v-model` 与 `isValid()`，无需重复处理初始化和清理。

## 10. 注意事项

| # | 问题 | 说明与处理 |
| --- | --- | --- |
| 1 | 误用 `isValidNumber()` | v29 中该方法仅做位数校验，必须优先调用 `isValidNumberPrecise()`。 |
| 2 | 号码未输完就提交 | `getNumber()` 返回空串，必填规则先命中，不会把半截号码写入表单。 |
| 3 | 国际号码缺少 `+` | 无前缀会按中国号码解析，导致校验失败；必须带国家区号。 |
| 4 | 前端未限制号码类型 | 司机“必须手机号”依赖后端 `mobileOnly`，前端文案仅为提示。 |
| 5 | 400 / 800 类型差异 | libphonenumber 可能判定为 `TOLL_FREE` / `UAN`：承运商放行，司机被 `mobileOnly` 拦截，属预期行为。 |
| 6 | 长度阈值不一致 | 后端拦截阈值为 25 字符，数据库字段为 `VARCHAR(20)`；E.164 最长 16 字符，正常数据安全，但阈值建议后续统一为 20。 |
| 7 | vendor 脚本加载失败 | 控件降级为普通输入，`isValid()` 退化为非空判断；上线前需确认本地 vendor 路径可访问。 |
| 8 | keep-alive 页签切换 | 组件卸载时必须 `iti.destroy()`，否则重复进入页面会残留 DOM 与事件监听。 |

## 11. 文件清单

| 端 | 文件 | 内容 |
| --- | --- | --- |
| 前端 | `frontend/src/components/PhoneInput.vue` | 电话输入控件与前端校验出口 |
| 前端 | `frontend/src/views/base/carriers/index.vue` | 承运商表单与电话规则 |
| 前端 | `frontend/src/views/base/drivers/index.vue` | 司机表单与手机号规则 |
| 前端 | `frontend/src/utils/format.ts` | `formatPhone()` 展示格式化 |
| 前端 | `frontend/src/types/global.d.ts` | intl-tel-input 实例类型声明 |
| 前端 | `frontend/index.html` | vendor 脚本与中文 locale 引入 |
| 后端 | `backend/src/helpers.js` | `assertPhone()` 强校验 |
| 后端 | `backend/src/routes/carriers.js` | 承运商接口调用点 |
| 后端 | `backend/src/routes/drivers.js` | 司机接口调用点 |
| 后端 | `backend/src/routes/external.js` | CRM / 狮桥外部接口调用点 |
| 后端 | `backend/scripts/migrate-phones.js` | 存量号码迁移脚本 |
| 数据库 | `database/schema.sql` | 电话字段定义 |
