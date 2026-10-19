# 智能运输管理平台

**Smart Transport Management Platform（简称 STP）**

基于《TMS-整车发运系统 PRD》实现的**前后端分离**企业级运输管理系统，覆盖承运商/司机基础数据、发运任务派单调度、在途监控、应付运费对账、电子签台账，并内置 CRM / WMS / 狮桥物流 / 司机端的外部系统模拟接口，支持完整业务流程端到端演示。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 原生 HTML + CSS + JS（零依赖 SPA，双击 index.html 即可用） |
| 后端 | Node.js 18+ / Express 4 |
| 数据库 | MySQL 5.7+（或 MariaDB 10.x），InnoDB + utf8mb4 |

## 目录结构

```
tms-vehicle-shipping/
├── database/
│   ├── schema.sql          # 建表语句
│   ├── seed.sql            # 演示种子数据
├── docs/
│   └── openapi.json        # OpenAPI 3.0 接口文档（37 个接口，可导入 APIfox）
├── backend/
│   ├── package.json
│   ├── .env.example        # 配置模板（复制为 .env 按需修改）
│   └── src/
│       ├── server.js       # 应用入口
│       ├── db.js           # 连接池 + 单据序列号引擎
│       ├── helpers.js      # 统一错误/分页工具
│       └── routes/
│           ├── stats.js     # 工作台统计
│           ├── carriers.js  # 承运商管理
│           ├── drivers.js   # 司机管理
│           ├── shipTasks.js # 发运任务
│           ├── tracking.js  # 在途监控
│           ├── freight.js   # 应付运费对账
│           ├── esigns.js    # 电子签台账
│           └── mock.js      # 外部系统模拟接口
└── frontend/
    ├── index.html          # 入口（含全部样式）
    ├── app.js              # SPA 路由 + 页面逻辑
    ├── china-map.js        # 中国地图数据与渲染器（内嵌，零依赖离线可用）
    └── server.js           # 零依赖静态服务器 + API 代理（推荐启动方式）
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

### 3. 启动前端

前端是纯静态文件，三种方式任选：

```bash
# 方式 A（推荐）：自带 API 代理的静态服务器，同源访问免跨域
cd frontend
node server.js          # 默认 8000，可传端口参数：node server.js 8080
# 浏览器访问 http://localhost:8000/index.html
# API 代理地址可用环境变量覆盖：BACKEND_HOST / BACKEND_PORT

# 方式 B：任意静态服务器（python 等），页面会自动探测并回退到 http://localhost:3000
cd frontend
python3 -m http.server 8000

# 方式 C：直接双击 index.html（file:// 打开时自动请求 http://localhost:3000）
```

后端已开启 CORS，前后端可分开部署到不同域名/端口；生产环境建议用 Nginx 把 `/api` 反代到后端，前端会自动使用同源相对路径。

## 功能模块

| 模块 | 能力 |
|---|---|
| 工作台 | 待办统计卡、任务状态分布、最新任务列表 |
| 承运商管理 | 新增/编辑、自动编码（CAR-001）、名称去重、启用/停用 |
| 司机管理 | 新增/编辑、身份证/手机号校验去重、驾驶证有效期、启用/停用 |
| 发运任务 | 多条件筛选、派单/取消派单/改派/批量派单、任务详情时间轴、外部系统操作面板 |
| 在途监控 | 在途运单列表、运输进度、节点时间轴、位置回传记录、运输地图（整体路径放大界面 + 中国地图展示起始地/目的地/位置点/路径动画） |
| 应付运费对账 | 筛选、合计金额、费用明细、修改运费（留痕原因与前后金额）、确认对账 |
| 电子签台账 | 多条件筛选、按任务跳转详情 |

## 业务状态机

```
待派单 PENDING
  └─ 派单 → 已派单 DISPATCHED
       ├─ 承运商接单（分配司机）→ ACCEPTED
       │    ├─ WMS 出库回传 → OUT_BOUND
       │    └─ 司机提车发运 → PICKED_UP
       │         └─ 位置回传（首条自动置在途）→ IN_TRANSIT
       │              └─ 司机到达（生成运费单）→ ARRIVED
       │                   └─ 司机完结 → FINISHED
       └─ 取消派单 → 回到 PENDING
  └─ CRM 同步取消（仅待派单可取消）→ CANCELLED
```

任务完结后自动生成运费单（状态 `待对账`），确认对账后置为 `已对账`。

## 核心接口一览

完整接口定义见 `docs/openapi.json`（OpenAPI 3.0，可直接导入 APIfox / Postman / Apifox），含全部 37 个接口的参数、请求体结构与响应示例。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/stats` | 工作台统计 |
| GET/POST | `/api/carriers` | 承运商列表/新增 |
| PUT | `/api/carriers/:id` | 编辑承运商 |
| PUT | `/api/carriers/:id/status` | 启用/停用（body: `{"status":"COOPERATING"}` 或 `"DISABLED"`） |
| GET/POST | `/api/drivers` | 司机列表/新增 |
| PUT | `/api/drivers/:id` | 编辑司机 |
| PUT | `/api/drivers/:id/status` | 启用/停用（body: `{"status":"ENABLED"}` 或 `"DISABLED"`） |
| GET | `/api/drivers/options` | 可选司机（启用中） |
| GET | `/api/ship-tasks` | 任务列表（筛选/分页） |
| GET | `/api/ship-tasks/:id` | 任务详情 + 节点时间轴 |
| POST | `/api/ship-tasks/:id/dispatch` | 派单 |
| POST | `/api/ship-tasks/:id/cancel-dispatch` | 取消派单 |
| POST | `/api/ship-tasks/:id/reassign` | 改派 |
| POST | `/api/ship-tasks/dispatch-batch` | 批量派单 |
| GET | `/api/tracking` | 在途运单列表 |
| GET | `/api/tracking/:taskId` | 运单详情（进度/时间轴/位置） |
| GET | `/api/freight-orders` | 运费单列表（含合计） |
| GET | `/api/freight-orders/:id` | 费用明细 + 修改记录 |
| POST | `/api/freight-orders/:id/adjust` | 修改运费 |
| POST | `/api/freight-orders/:id/recon` | 确认对账 |
| GET | `/api/esigns` | 电子签台账 |

## 外部系统模拟接口（演示用）

对应 PRD 系统交互协议，前端"发运任务-任务详情-外部系统操作"面板可直接触发完整链路：

| 方法 | 路径 | 对应 PRD 接口 |
|---|---|---|
| POST | `/api/mock/crm/apply` | 接口1 CRM 下发发运申请（自动生成待派单任务） |
| POST | `/api/mock/esign/init` | 接口2 CRM 同步物流电子签发起 |
| GET | `/api/mock/crm/cancel-query` | 接口3 CRM 取消前查询 |
| POST | `/api/mock/crm/cancel` | 接口6 CRM 同步取消 |
| POST | `/api/mock/driver/sync` | 接口10 司机信息三方同步（按身份证幂等） |
| POST | `/api/mock/shiqiao/accept` | 接口12 狮桥接单（分配司机） |
| POST | `/api/mock/shiqiao/pickup` | 接口12 司机提车发运 |
| POST | `/api/mock/wms/outbound` | 接口13 WMS 出库回传 |
| POST | `/api/mock/esign/status` | 接口14 狮桥电子签状态回传 |
| POST | `/api/mock/esign/sign-task` | 辅助：按任务号签收当前待签署电子签 |
| POST | `/api/mock/shiqiao/track` | 接口15 狮桥位置回传（每小时） |
| POST | `/api/mock/shiqiao/arrive` | 司机到达（回填运费/里程，生成运费单） |
| POST | `/api/mock/shiqiao/finish` | 司机完结 |

## 关键设计

- **编号规则引擎**：承运商 `CAR-001`；任务单号 `FY+YYYYMMDD+4位序列`；运费单号 `YF+YYYYMMDD+4位序列`。基于 `UPDATE ... SET seq_val = LAST_INSERT_ID(seq_val + 1)` 的原子机制，多连接并发下不重号，任务/运费序列按日重置。
- **统一响应与错误**：业务错误返回 `{ message }` + 对应 HTTP 状态码；所有列表接口支持 `page/size` 分页。
- **幂等与去重**：发运申请号、电子签 ID、司机身份证号均做唯一性校验，重复下发会被拒绝或安全更新。
- **留痕**：任务每次状态流转写入 `task_events` 时间轴；运费修改写入 `freight_adjustments`（前后金额 + 原因）。

## 验证状态

已完成 21 步全链路测试与浏览器全页面验证：CRM 下发 → 派单 → 接单 → 出库 → 提车 → 在途回传 → 到达 → 完结 → 运费修改/对账，以及取消链路，全部通过。

## 更新记录

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
