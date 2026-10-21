# 智能运输管理平台

**Smart Transport Management Platform（简称 STP）**

基于《TMS-整车发运系统 PRD》实现的**前后端分离**企业级运输管理系统，覆盖承运商/司机基础数据、发运任务派单调度、在途监控、应付运费对账、电子签台账，并提供 CRM / WMS / 狮桥物流 / 承运商端的 13 个外部对接接口，支持完整业务流程端到端联调。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3.5 + Vite + TypeScript + Pinia + Naive UI + Axios（工程目录 `frontend/`，dev 端口 5173） |
| 后端 | Node.js 18+ / Express 4 |
| 数据库 | MySQL 5.7+（或 MariaDB 10.x），InnoDB + utf8mb4 |

## 目录结构

```
tms-vehicle-shipping/
├── database/
│   ├── schema.sql          # 建表语句（含第三方 ID 字段与唯一索引）
│   └── seed.sql            # 演示种子数据
├── docs/
│   ├── openapi.json        # OpenAPI 3.0 接口文档（36 个路径，可导入 APIfox）
│   └── api-contract.md     # 前后端统一契约（状态机/表结构/接口清单）
├── backend/
│   ├── package.json
│   ├── .env.example        # 配置模板（复制为 .env 按需修改）
│   ├── scripts/            # 数据迁移与演示数据脚本
│   └── src/
│       ├── server.js       # 应用入口
│       ├── db.js           # 连接池 + 单据序列号引擎
│       ├── helpers.js      # 统一错误/分页工具
│       └── routes/
│           ├── stats.js         # 工作台统计
│           ├── carriers.js      # 承运商管理
│           ├── drivers.js       # 司机管理
│           ├── shippingTasks.js # 发运任务（派单/批量派单/取消派单/改派）
│           ├── tracking.js      # 运输监控
│           ├── freightBills.js  # 应付运费对账
│           ├── esigns.js        # 电子签台账
│           └── external.js      # 外部对接（CRM/WMS/狮桥/承运商）
└── frontend/                  # Vue3 + Vite + TypeScript + Pinia + Naive UI 工程
    ├── package.json           # 依赖与脚本（dev / build / preview）
    ├── vite.config.ts         # dev 端口 5173，/api 代理到 http://localhost:3000
    ├── tsconfig.json          # 严格模式 + @/* 路径别名
    ├── index.html             # 入口（引入本地 vendor/intl-tel-input）
    ├── public/
    │   ├── favicon.svg
    │   └── vendor/intl-tel-input/   # 电话控件本地化资源（无 CDN）
    └── src/
        ├── main.ts            # 应用入口（Pinia + Router + NaiveUI 全量注册）
        ├── App.vue            # NConfigProvider（zhCN 中文 locale + 品牌主题）
        ├── router/index.ts    # 7 个业务路由（懒加载），/ → /dashboard
        ├── layouts/BasicLayout.vue  # 侧边分组菜单 + 顶栏 + 面包屑
        ├── stores/            # dictionary（字典缓存）/ session（演示用户）
        ├── services/          # http 拦截器 + carriers/drivers/tasks/tracking/freight/esigns/stats/dict
        ├── types/api.ts       # 契约实体与枚举类型
        ├── components/        # StatusTag/MoneyText/PageTable/DetailSection/ConfirmAction/PhoneInput/ChinaMap
        ├── lib/china-map.js   # 中国地图数据与渲染器（零依赖离线）
        ├── utils/format.ts    # 金额/日期/电话格式化
        └── views/             # 7 个页面：工作台/承运商/司机/发运任务/运输监控/结算/电子签
```

## 部署步骤

### 1. 导入数据库

本地启动 MySQL 后执行（会自动建库 `tms_vehicle`）：

```bash
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
```

> 种子数据包含：4 家承运商、8 名司机、16 条覆盖全部状态的任务、7 条电子签、3 张运费单、8 条位置回传，开箱即可演示。

### 2. 启动后端

```bash
cd backend
npm install
npm start        # 生产启动；开发热重载可用 npm run dev
```

默认监听 `http://localhost:3000`，API 根路径 `/api`。

数据库连接配置：复制 `.env.example` 为 `.env` 并按实际情况修改（无 `.env` 时默认 `root`/空密码/`tms_vehicle`）：

```ini
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=tms_vehicle
PORT=3000
```

### 3. 启动前端（Vue3 + Vite 工程）

```bash
cd frontend
npm install        # 依赖安装；网络受限时可加 --registry=https://registry.npmmirror.com
npm run dev        # 开发服务器，端口 5173，/api 自动代理到 http://localhost:3000
```

浏览器访问 <http://localhost:5173>（默认重定向到工作台 `/dashboard`）。

生产构建与预览：

```bash
cd frontend
npm run build      # 先 vue-tsc 类型检查，再 vite 构建到 dist/
npm run preview    # 本地预览构建产物
```

> 7 个业务路由：`/dashboard` 工作台、`/carriers` 承运商管理、`/drivers` 司机管理、
> `/tasks` 发运任务、`/tracking` 运输监控（含历史运单）、`/freight` 结算管理、`/esigns` 电子签台账。
> 开发环境所有 `/api` 请求由 Vite 代理转发到后端 3000 端口，
> 前后端可分开部署；生产环境建议用 Nginx 将 `/api` 反代到后端即可，无需修改前端代码。

## 功能模块

| 模块 | 能力 |
|---|---|
| 工作台 | 待办统计卡、任务状态分布、最新任务列表 |
| 承运商管理 | 新增/编辑、自动编码（CAR-001）、名称与第三方承运商ID 去重、启用/停用 |
| 司机管理 | 新增/编辑、身份证/手机号/第三方司机ID 校验去重、驾驶证有效期、所属承运商多选、启用/停用 |
| 发运任务 | 多条件筛选、派单/取消派单/改派/批量派单（支持 STP 内部ID 或第三方ID 定位承运商）、任务详情（客户/销售/发运/物料/承运信息分模块） |
| 运输监控 | 在途与历史运单统一列表、运输进度、节点时间轴、位置回传记录、运单详情面板（运单/物料/司机/回传）、中国地图线路展示与异常线路标识 |
| 应付运费对账 | 筛选、合计金额、费用明细、修改运费（留痕原因与前后金额）、确认对账 |
| 电子签台账 | 多条件筛选、按任务跳转详情 |

## 业务状态机

```
待派单 WAIT_DISPATCH
  └─ 派单 → 已派单 DISPATCHED
       ├─ 承运商接单（分配司机）→ CARRIER_ACCEPTED
       │    └─ 司机提车发运（拍照）→ PICKED
       │         └─ WMS 出库回传 → 已出库 OUTBOUND（瞬时留痕）→ 在途 IN_TRANSIT
       │              └─ 承运商到达回传（生成运费单）→ ARRIVED
       │                   └─ 承运商完结回传 → FINISHED
       └─ 取消派单 → 回到 WAIT_DISPATCH
  └─ CRM 同步取消（仅待派单可取消）→ CANCELLED
```

已确认的流程顺序：**司机先提车（发运）、仓库后出库，出库完成即进入在途**，各节点必须逐步流转。
任务完结后自动生成运费单（状态 `待对账`），确认对账后置为 `已对账`。

## 核心接口一览

完整接口定义见 `docs/openapi.json`（OpenAPI 3.0，可直接导入 APIfox / Postman），含全部 36 个路径的参数、请求体结构与响应示例；字段与错误码约定见 `docs/api-contract.md`。

### 内部管理接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查（真实探测数据库） |
| GET | `/api/stats` | 工作台统计 |
| GET | `/api/dictionaries` | 字典（准驾车型、大区等） |
| GET/POST | `/api/carriers` | 承运商列表/新增（支持 `external_carrier_id` 第三方ID） |
| PUT | `/api/carriers/:id` | 编辑承运商 |
| PUT | `/api/carriers/:id/status` | 启用/停用 |
| GET/POST | `/api/drivers` | 司机列表/新增（支持 `external_driver_id` 第三方ID） |
| PUT | `/api/drivers/:id` | 编辑司机 |
| PUT | `/api/drivers/:id/status` | 启用/停用 |
| GET | `/api/drivers/options` | 可选司机（启用中） |
| GET | `/api/shipping-tasks` | 任务列表（筛选/分页） |
| GET | `/api/shipping-tasks/:id` | 任务详情（客户/发运/物料/承运/时间轴） |
| POST | `/api/shipping-tasks/dispatch` | 派单（`carrier_id` 或 `external_carrier_id`） |
| POST | `/api/shipping-tasks/batch-dispatch` | 批量派单 |
| POST | `/api/shipping-tasks/dispatch/cancel` | 取消派单 |
| POST | `/api/shipping-tasks/dispatch/reassign` | 改派 |
| GET | `/api/tracking/tasks` | 运输监控列表（在途/历史） |
| GET | `/api/tracking/tasks/:id` | 运单详情（进度/时间轴/位置回传） |
| GET | `/api/freight-bills` | 运费单列表（含合计） |
| GET | `/api/freight-bills/:id/detail` | 费用明细 + 修改记录 |
| PUT | `/api/freight-bills/:id/freight` | 修改运费 |
| POST | `/api/freight-bills/:id/reconcile` | 确认对账 |
| GET | `/api/esign-records` | 电子签台账 |

### 外部对接接口（`/api/external/*`，camelCase）

| 方法 | 路径 | 来源 | 说明 |
|---|---|---|---|
| POST | `/shipping-tasks/receive` | CRM | 下发发运申请（生成任务单号） |
| GET | `/shipping-tasks/cancel-check` | CRM | 取消前置校验 |
| POST | `/shipping-tasks/cancel` | CRM | 取消任务（仅待派单） |
| POST | `/wms/outbound-status` | WMS | 出库回传（PICKED→IN_TRANSIT） |
| POST | `/drivers/sync` | 狮桥 | 司机同步（`externalDriverId` 优先，其次身份证号） |
| POST | `/tracking/report` | 狮桥 | 在途点位上报（写轨迹，不改任务状态） |
| POST | `/shipping-tasks/accept` | 承运商 | 接单并指派司机（`driverId` 或 `externalDriverId`） |
| POST | `/shipping-tasks/pickup` | 承运商 | 提车发运（含照片） |
| POST | `/shipping-tasks/arrive` | 承运商 | 到达回传（生成运费单） |
| POST | `/shipping-tasks/finish` | 承运商 | 完结回传 |
| POST | `/esign/sync` | 狮桥 | 电子签下发同步 |
| POST | `/esign/receipt-sync` | 狮桥 | 电子签回执同步 |
| POST | `/esign/sign-status` | 狮桥 | 签署状态回传 |

## 关键设计

- **编号规则引擎**：承运商 `CAR-001`；任务单号 `FY+YYYYMMDD+4位序列`；运费单号 `YF+YYYYMMDD+4位序列`；批量派单批次号 `PD+YYYYMMDD+4位序列`。基于 `UPDATE ... SET seq_val = LAST_INSERT_ID(seq_val + 1)` 的原子机制，多连接并发下不重号，任务/运费序列按日重置。
- **统一响应与错误**：统一信封 `{ code, message, data }`，成功 `00000`，参数 `A0001`、业务 `A0002`、重复请求 `C0001`、状态/版本冲突 `D0001`、不存在 `D0002`；列表统一 `page/size` 分页。
- **幂等与去重**：发运申请号、电子签 ID、司机身份证号、承运商名称、第三方承运商/司机 ID 均做唯一性校验，重复下发会被拒绝或安全更新。
- **ID 定位优先**：派单/接单/回传均以 STP 内部 ID 或第三方 ID 定位承运商与司机，名称仅作旧字段兼容。
- **乐观锁**：派单/取消派单/改派须携带 `version`，不匹配返回 `D0001「任务状态已变化，请刷新后重试」`。
- **留痕**：任务每次状态流转写入 `task_status_log`，派单/改派/取消派单写入 `dispatch_record`，运费修改写入 `freight_adjust_log`（前后金额 + 原因）。

## 验证状态

已完成全链路测试与浏览器全页面验证：CRM 下发 → 派单 → 接单 → 提车 → 出库 → 在途回传 → 到达 → 完结 → 运费修改/对账，以及取消链路，全部通过；第三方承运商 ID 派单 → 第三方司机 ID 接单链路已验证通过。

## 更新记录

### V2.4（2026-10-21）新增在途点位上报接口

- **接口**：`POST /api/external/tracking/report`（狮桥第 ⑪ 号接口），按 `applyNo` / `taskNo` 定位任务，写入 `transport_track`
- **入参**：`longitude`、`latitude` 必填（经纬度范围校验），`locationDesc`、`speed`、`reportTime` 选填（默认当前时间）
- **规则**：仅「已提车 / 已出库 / 在途」可上报；上报时间不得晚于当前时间、不得早于上次上报；同一上报时间+坐标重复推送幂等返回
- **不改状态**：出库完成即进入在途，点位上报只记录轨迹，供运输监控画线与「超 1 小时未上报」异常判定
- 运输单号沿用规则 `SQ+yyyyMMdd+任务id补零4位`；OpenAPI 升至 2.3.0，契约文档同步

### V2.3（2026-10-21）第三方承运商 / 司机 ID 全链路支持

外部系统主键进入系统，派单与接单不再依赖名称：

- **表结构**：`carrier.external_carrier_id`、`driver.external_driver_id` 新增，均建唯一索引保证全局不重复；本地库已执行 ALTER 并为存量演示数据回填
- **基础数据**：承运商、司机新增/编辑可填写第三方 ID，列表新增列并支持关键词搜索；重复时返回 A0002
- **派单 / 批量派单 / 改派**：承运商可用 `carrier_id`（STP 内部ID）或 `external_carrier_id`（第三方ID），二选一即可派单，仍校验承运商存在且合作中
- **接单**：司机支持 `driverId`（内部）或 `externalDriverId`（第三方）；承运商支持 `carrierId` / `externalCarrierId`，`carrierName` 仅兼容保留
- **司机同步**：优先按 `externalDriverId` UPSERT，未命中退回身份证号匹配；`carrierId` / `externalCarrierId` 维护司机-承运商关联
- **文档**：`docs/openapi.json` 升至 2.2.0，`docs/api-contract.md` 同步表结构与定位规则

### V2.2（2026-10-21）发运任务详情字段与运输监控详情重构

- **任务详情抽屉**：按「基础信息 / 发运信息 / 物料明细 / 承运信息」分区展示，补齐发运申请单号、创建人、创建日期、客户名称（合同主体）、大区、销售人员及联系方式、备注、出库仓库/储位、交付地区与地址、发运方式、计划提车日期、接车联系人及电话、发运/出库/到达时间、计划/实际运费；移除详情内的轨迹记录表（轨迹归运输监控）
- **运输监控详情面板**：取消旧版「正常/异常线路」提示条，改为「运单 / 物料」分组展示，物料按 VIN 逐台列出车型，超时线路保留异常标识
- 物料明细多车场景按 VIN 与车型一一对应拆分展示

### V2.1（2026-10-20 ～ 10-21）状态机调整、状态回传拆分与运输监控合并

- **状态机**：明确「司机先提车、仓库后出库」，出库完成即进入在途；状态枚举统一为 `WAIT_DISPATCH / DISPATCHED / CARRIER_ACCEPTED / PICKED / OUTBOUND / IN_TRANSIT / ARRIVED / FINISHED / CANCELLED`
- **状态回传拆分**：单一状态同步接口拆为 `accept / pickup / arrive / finish` 四个承运商通用接口，补充节点时间先后校验（不得回传未来时间、不得跳步）
- **提车照片**：照片 URL 结构化写入状态日志
- **运输监控**：原「在途监控 / 历史运单 / 运输地图」三页合并为统一运输监控，异常线路（超 1 小时未上报）标识，重新上报后自动恢复正常
- **清理**：移除外部系统模拟页面及接口；状态回传不再接收实际运费/里程入参
- **契约**：`openapi.json` 补全请求体 schema 并修正状态机描述

### V2.0（2026-10-20）前端整体重构为 Vue3 工程

旧版原生 JS 前端（index.html + app.js）替换为 Vue 3.5 + Vite + TypeScript + Pinia + Naive UI 工程，目录结构按 `docs/api-contract.md` 第 8 节落地：

- **路由与布局**：8 个业务路由懒加载（工作台/承运商/司机/发运任务/在途监控/结算/电子签/外部系统模拟），侧边分组菜单 + 顶栏 + 面包屑，`/` 重定向到 `/dashboard`
- **请求层**：axios 统一信封拦截（`{code,message,data}`，`00000` 拆包，业务/HTTP 错误抛 `ApiError`），services 按契约第 5/6/7 节逐接口实现并全量 TypeScript 类型标注（`types/api.ts`）
- **公共组件**：StatusTag（任务/承运商/司机/对账/电子签状态标签）、MoneyText、PageTable（远程分页+空态+错误重试）、DetailSection、ConfirmAction（危险确认）、PhoneInput（intl-tel-input 本地 vendor 包装，输出 E.164）、ChinaMap（china-map.js 渲染器包装）
- **启动方式变化**：前端由 `node server.js`(8000) 改为 `npm run dev`(5173)，`/api` 由 Vite 代理到后端 3000；`启动STP.command` 已同步更新

### V1.2（2026-10-19）电话输入升级为 intl-tel-input（Google libphonenumber）

替换自研控件为成熟开源组件 intl-tel-input v29（前端）+ libphonenumber-js（后端），同一底层校验内核：

- **统一控件**：国旗下拉（400+ 国家/地区，中文名，支持拼音/英文/区号搜索）+ 区号 + 号码输入，输入时自动按国家格式化，占位示例随国家联动，默认中国 +86
- **校验升级**：正则 → libphonenumber 规则（isValidNumber），自动识别号码类型（手机 MOBILE / 座机 FIXED_LINE / 400 SHARED_COST / 800 TOLL_FREE）；司机手机号字段强制手机类型
- **存储统一 E.164**（如 +8613812345678）：无 + 前缀的入参按中国号码归一化，兼容旧接口调用；存量 46 条数据已迁移（脚本 `backend/scripts/migrate-phones.js`），seed.sql 同步
- **展示格式化**：表格/详情中 +8613xxxxxxxxx 显示为 138 0013 8000
- **规则变化**：座机为「区号+8 位号码」（如 0551-63612345；无区号直拨号在 E.164 体系下无法定位归属地，不再接受）；前端校验使用 isValidNumberPrecise 严格模式（v29 的 isValidNumber 为宽松位数校验，会放行 7 位座机等无效号，已弃用）
- 前端依赖本地化到 `frontend/vendor/intl-tel-input/`（无 CDN、无构建工具）

### V1.1.2（2026-10-19）电话字段升级为「国家/地区 + 号码」两段式

按测试反馈改造，支持国外号码，国内用户零成本（默认中国 +86）：

- 表单控件：国家/地区下拉（30 个常用国家/地区，国旗 + 中文名 + 区号，支持拼音/英文/区号搜索）+ 号码输入框，占位示例随所选区号联动（中国「如 13800138000」、美国「如 202-555-0123」…）
- 存储约定：国内号码存裸号（如 13800138000，与存量数据兼容），国外号码存「+区号 号码」（如 +1 202-555-0123）
- 校验规则：国内仍按手机/座机/400 校验（司机手机号严格 11 位）；国际号码按「+区号(1-3位) + 4-18位数字/空格/连字符」校验，总长 ≤24
- 生效范围：承运商联系电话、司机手机号（含三方同步接口10）、CRM 下发销售电话/接车人电话

### V1.1.1（2026-10-19）电话字段格式校验

前后端双重校验：后端 `assertPhone` 兜底（绕过前端直接调接口也会被拒），前端表单 maxlength + 提交校验 + 格式提示。

| 字段 | 规则 |
|---|---|
| 承运商联系电话 | 11 位手机号 / 座机（区号 2-3 位 + 7-8 位，可带分机，如 0551-63612345）/ 400 号码，最长 20 位 |
| 司机手机号（含三方同步接口10） | 严格 11 位大陆手机号（1[3-9] 开头） |
| CRM 下发销售电话 / 接车人电话 | 可选字段，填写时校验格式 |

### V1.1（2026-10-19）系统优化

| 优化项 | 内容 |
|---|---|
| 仓库安全 | 新增 `.gitignore`；将含数据库密码的 `backend/.env` 与 `node_modules` 从 git 跟踪移除（本地文件保留）。克隆后需 `cp .env.example .env` 并执行 `npm install` |
| 时区修复 | 任务单号 / 运费单号 / 运输单号 / 默认提车日期改用本地日期（原 UTC 计算在东八区 0–8 点会错一天） |
| 事务一致性 | CRM 下发（任务+事件）、司机到达（任务更新+运费单生成）、修改运费（金额+留痕）改为数据库事务；修改运费加 `FOR UPDATE` 行锁防并发错位 |
| 健康检查增强 | `GET /api/health` 真实探测数据库，MySQL 未启动时返回 500 |
| 冒烟脚本 | 根目录新增 `smoke-test.sh`：17 步全链路自动化冒烟（需后端已启动，`bash smoke-test.sh`） |
| 测试清单 | `docs/test-checklist.html`：73 项交互式测试关注清单（可打勾跟踪进度，浏览器本地保存） |

本轮优化后 17 步冒烟测试全部通过；仓库 `docs/openapi.json` 接口契约无变化，APIfox 导入不受影响。
