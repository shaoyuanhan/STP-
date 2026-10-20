# STP 重构统一契约 v2（前后端并行开发依据）

> 依据：《STP 智能运输管理平台 后端技术方案》《STP 智能运输管理平台 前端技术方案》《TMS-整车发运系统PRD》。
> 本文件是本次重构的**唯一接口契约**，与旧实现冲突时以本文件为准。

## 1. 总览

- 后端：Node.js + Express + MySQL（库名 `tms_vehicle`），端口 **3000**
- 前端：Vue3 + Vite + TypeScript + Pinia + Naive UI + Axios，dev 端口 **5173**，`/api` 代理到 `http://localhost:3000`
- 字段命名：**内部管理接口用 snake_case**（与数据库一致）；**外部接口 `/api/external/*` 用 camelCase**（按后端技术方案 3.1 示例）
- 金额：DECIMAL(12,2)，mysql2 可能以字符串返回，前端展示/计算前 `Number()`

## 2. 统一响应与错误码

所有接口（含外部接口）返回：

```json
{ "code": "00000", "message": "success", "data": { } }
```

| code | 含义 | HTTP |
| --- | --- | --- |
| 00000 | 成功 | 200 |
| A0001 | 参数校验失败 | 400 |
| A0002 | 业务校验失败（重名、VIN 不匹配等） | 400 |
| B0001 | 系统内部异常 | 500 |
| C0001 | 重复请求（幂等拦截） | 409 |
| D0001 | 状态不允许该操作 / 版本冲突 | 409 |
| D0002 | 数据不存在 | 404 |

分页请求 `?page=1&size=10`，`data` 为 `{ list, total, page, size }`。

## 3. 状态机与核心业务规则

### 3.1 任务状态（shipping_task.status）

```
WAIT_DISPATCH 待派单 → DISPATCHED 已派单 → CARRIER_ACCEPTED 承运商已接单 → OUTBOUND 已出库
→ PICKED 已提车 → IN_TRANSIT 在途 → ARRIVED 已到达 → FINISHED 已完结
WAIT_DISPATCH → CANCELLED 已取消（CRM 取消）
DISPATCHED → WAIT_DISPATCH（取消派单）；DISPATCHED → DISPATCHED（改派换承运商）
```

**已确认：WMS 出库在前、司机确认提车（发运）在后（线性主链），必须逐步流转。**

转换触发：
- 派单（STP）：WAIT_DISPATCH→DISPATCHED，写 dispatch_record(DISPATCH) + status_log
- 接单（狮桥 #12 ACCEPT）：DISPATCHED→CARRIER_ACCEPTED，回填 driver_id、plan_pickup_date
- 出库（WMS #8）：CARRIER_ACCEPTED→OUTBOUND，回填 outbound_date（出库后方可提车）
- 提车（#12 PICKUP，=发运）：OUTBOUND→PICKED，回填 ship_time（实际提车日期=发运时间，不得早于出库日期，允许早于计划提车日期）；照片 URL 写 status_log.remark
- 位置（模拟 #15 拉取结果）：仅 PICKED 首次回传→IN_TRANSIT；已出库未提车仅记轨迹
- 到达（#12 ARRIVE）：→ARRIVED，回填 arrive_time；实际运费/里程不在本接口回传（运费相关功能暂未开放）
- 完结（#12 FINISH）：ARRIVED→FINISHED，回填 finish_time，同步运费单 finish_time

**幂等**：各状态重复回传仅补记日志，不回退已推进状态；不允许跳步（如未出库直接提车返回 D0001）。

**CRM 取消规则（#3 查询 / #6 取消）**：
- WAIT_DISPATCH：可取消
- DISPATCHED：不可，提示"请先在 STP 取消派单"
- CARRIER_ACCEPTED：不可，提示"需联系承运商取消接单"
- OUTBOUND 及之后：不可，"车辆已出库发运，不可取消"
- 取消时：任务置 CANCELLED（cancel_reason/cancel_time），关联待签署电子签置 CANCELLED

**取消派单（STP 内部）**：仅 DISPATCHED（司机未接单）→ WAIT_DISPATCH；原因枚举：承运商无法履约/调度调整/其他 + 补充说明（非必填）；清空 carrier_id/driver_id，保留 CRM 下发的 plan_pickup_date。

**版本控制（多人冲突）**：shipping_task.version，每次 UPDATE +1。派单/取消派单/改派请求必须携带 `version`，不匹配返回 D0001"任务状态已变化，请刷新后重试"。列表/详情返回 version。allowedActions 由状态计算：
- WAIT_DISPATCH：`["DISPATCH","BATCH_DISPATCH"]`
- DISPATCHED：`["CANCEL_DISPATCH","REASSIGN"]`
- 其余：`[]`

### 3.2 单号规则（sys_sequences，均按日重置除 CAR）

| 单号 | 规则 | 示例 |
| --- | --- | --- |
| 任务单号 | FY+yyyyMMdd+4 位 | FY202610190001 |
| 运费单号 | YF+yyyyMMdd+4 位 | YF202610190001 |
| 承运商编码 | CAR-3 位（全局） | CAR-001 |
| 批量派单批次号 | PD+yyyyMMdd+4 位 | PD202610190001 |

**任务单号由 STP 自动生成，CRM 不传**（既有需求）。

## 4. 数据库（后端技术方案 2.4 全量落地）

11 张业务表 + sys_sequences，**所有表统一含审计字段**：`id, create_id, create_name, create_time, update_id, update_name, update_time, deleted(0/1)`。所有查询过滤 `deleted=0`。系统触发时 create_name/update_name 记来源：CRM 系统/狮桥物流/WMS 系统/系统管理员。

| 表 | 关键字段（业务） | 说明 |
| --- | --- | --- |
| carrier | carrier_code(uk), carrier_name(uk), contact_person, contact_phone, cooperation_routes, remark, status **tinyint 1 合作中/0 已停用** | |
| driver | driver_name, phone, id_card(uk), license_no, license_type, license_valid_from, license_valid_to, source **tinyint 1 自建/2 狮桥同步**, status tinyint 1/0 | 姓名身份证不可改 |
| carrier_driver | carrier_id, driver_id (uk 两列) | **司机-承运商多对多**，司机无 carrier_id 字段 |
| shipping_task | task_no(uk), apply_no(uk), customer_name, region, sales_person, sales_phone, delivery_area, **delivery_address**(PRD 要求补), receiver_phone, factory, storage_location, ship_method, ship_location, plan_pickup_date, outbound_date, ship_time, arrive_time, finish_time, carrier_id, driver_id, plan_freight, actual_freight, status, cancel_reason, cancel_time, remark, **version** | head 表，VIN 明细下沉 |
| shipping_task_vehicle | task_id, task_no(冗余), vin, order_no, report_no, plan_freight(单台), actual_freight, ship_location, vehicle_model, engine_config, cabin_type | **一任务多车**；head.plan_freight=各车之和 |
| dispatch_record | task_id, task_no, action(DISPATCH/REASSIGN/CANCEL_DISPATCH), carrier_id, driver_id, batch_no, dispatch_person, dispatch_time, cancel_reason, remark | 派单备注存此表 remark |
| task_status_log | task_id, task_no, from_status(初始 null), to_status, source(STP/CRM/SQ狮桥/CARRIER承运商通用回传/WMS), operator, remark | 每次状态流转一条；提车照片 URL 写 remark |
| transport_track | task_id, task_no, transport_no(狮桥 SQ+日期+任务补零), longitude, latitude, location_desc, speed, report_time | |
| freight_bill | freight_no(uk), task_id, task_no, carrier_id, driver_id, start_location, end_location, mileage, plan_freight, actual_freight, finish_time, reconcile_status tinyint 0 待对账/1 已对账, reconcile_time, reconciler | 到达时生成 |
| freight_adjust_log | freight_bill_id, freight_no, before_freight, after_freight, adjust_reason, operator | 每次修改一条 |
| esign_record | esign_id(uk), task_id, task_no, vin, apply_no, sign_type, trigger_node, sign_party, initiate_time, sign_status **WAIT_SIGN/SIGNED/CANCELLED**, sign_time | 按 VIN+applyNo 匹配任务（vin 查 vehicle 表） |

## 5. 内部管理接口（/api，snake_case）

### 5.1 通用
- `GET /api/health` → `{ok:true}`
- `GET /api/stats` → 工作台统计：各状态任务数、今日新增、待对账笔数/金额、在途数、电子签待签署数（结构自定，前端适配）
- `GET /api/dictionaries` → `{ taskStatus:[{value,label}], carrierStatus:[{value:1,label:'合作中'},{value:0,label:'已停用'}], driverStatus:[...], driverSource:[{value:1,label:'自建'},{value:2,label:'狮桥同步'}], reconcileStatus:[{value:0,label:'待对账'},{value:1,label:'已对账'}], esignStatus:[{value:'WAIT_SIGN',label:'待签署'},...], cancelReasons:['承运商无法履约','调度调整','其他'] }`

### 5.2 承运商
- `GET /api/carriers?keyword=&status=&page=&size=` → list 含 driver_count（关联启用司机数）
- `POST /api/carriers` `{carrier_name*, contact_person*, contact_phone*, cooperation_routes, remark}` → 编码自动生成，名称去重(A0002)
- `PUT /api/carriers/:id` 同上字段（编码只读；名称改名校验去重）
- `PUT /api/carriers/:id/status` `{status: 1|0}` 停用后不可被派单、在途不受影响

### 5.3 司机
- `GET /api/drivers?keyword=&carrier_id=&status=&page=&size=` → list 含 carriers（所属承运商名，逗号连接字符串或数组）
- `POST /api/drivers` `{name*, phone*, id_card*, license_no, license_type, license_valid_from*, license_valid_to*, carrier_ids:[], remark}` source=1
- `PUT /api/drivers/:id` 姓名/身份证不可改（A0002），carrier_ids 全量替换 carrier_driver
- `PUT /api/drivers/:id/status` `{status:1|0}` 停用后不可分派、不影响在途
- `GET /api/drivers/options?carrier_id=` → 该承运商关联且启用的司机 `[{id,name,phone,license_type}]`（狮桥接单模拟用）

### 5.4 发运任务
- `GET /api/shipping-tasks?task_no=&apply_no=&vin=&customer_name=&status=&carrier_id=&start_date=&end_date=&page=&size=`
  list 行：`id, task_no, apply_no, customer_name, vins(GROUP_CONCAT 顿号), vehicle_models, ship_location, delivery_address, carrier_name, driver_name, plan_pickup_date, outbound_date, ship_time, arrive_time, status, create_time, version`
- `GET /api/shipping-tasks/:id` → `{ task(head 全字段+carrier_name/driver_name/driver_phone), vehicles:[], dispatchRecords:[], statusLogs:[], tracks:[], esigns:[], allowedActions:[] }`
- `POST /api/shipping-tasks/dispatch` `{task_id*, carrier_id*, remark, version*}` → 狮桥同步模拟（返回同步说明文案）
- `POST /api/shipping-tasks/dispatch/cancel` `{task_id*, reason*, remark, version*}`
- `POST /api/shipping-tasks/dispatch/reassign` `{task_id*, carrier_id*, remark, version*}`（仅 DISPATCHED）
- `POST /api/shipping-tasks/batch-dispatch` `{task_ids*:[], carrier_id*, remark}` → `{ dispatched:n, total_freight:成功单计划运费合计, skipped:[{task_id, task_no, reason}] }`，每单写 dispatch_record（batch_no 同批相同）

### 5.5 在途监控
- `GET /api/tracking/tasks?task_no=&transport_no=&page=&size=` → 未终态任务（不含 FINISHED/CANCELLED），IN_TRANSIT 最优先，含最近一条位置（transport_no/location_desc/longitude/latitude/speed/report_time）
- `GET /api/tracking/tasks/:id` → `{ task, statusLogs, tracks(时间升序) }`

### 5.6 结算管理
- `GET /api/freight-bills?freight_no=&task_no=&carrier_id=&reconcile_status=&page=&size=` → 含合计 amount
- `GET /api/freight-bills/:id/detail` → `{ bill, adjustLogs:[] }`（无修改则空数组）
- `PUT /api/freight-bills/:id/freight` `{actual_freight*, reason*}` → 仅待对账可改（已对账 A0002），写调整记录
- `POST /api/freight-bills/:id/reconcile` → 0→1，reconciler=系统管理员

### 5.7 电子签台账
- `GET /api/esign-records?esign_id=&task_no=&vin=&apply_no=&sign_status=&page=&size=`

## 6. 外部接口（/api/external，camelCase，均幂等）

**统一定位**：优先 `applyNo`（发运申请号，CRM 业务主键），兼容 `taskNo`；都无 → A0001（**既有需求**）。

| # | 方法 路径 | 调用方 | 请求（关键字段） | 响应 data |
| --- | --- | --- | --- | --- |
| 1 | POST /shipping-tasks/receive | CRM | applyNo*, customerName*, vehicles*:[{vin*, orderNo, reportNo, planFreight, shipLocation*（或顶层统一提供）, vehicleModel, engineConfig, cabinType}], region, salesPerson, salesPhone, deliveryArea, deliveryAddress*, receiverPhone, factory*, storageLocation*, shipMethod, planPickupDate*（CRM 随申请下发）, remark | `{taskNo}`（自动生成）；applyNo 重复 → C0001 |
| 2 | POST /esign/sync | CRM | esignId*, vin*, applyNo*（VIN+申请号匹配任务，vin 查车辆明细）, signType='物流电子签', triggerNode, signParty | `{}`；esignId 重复 → C0001 |
| 3 | GET /shipping-tasks/cancel-check?applyNo= | CRM | - | `{taskNo, status, cancellable, message}` |
| 4 | POST /esign/receipt-sync | 狮桥 | esignId* | `{esignId, signStatus}`（回执确认，幂等） |
| 6 | POST /shipping-tasks/cancel | CRM | applyNo*, cancelReason | 按取消规则校验；关联待签署电子签置 CANCELLED |
| 8 | POST /wms/outbound-status | WMS | applyNo/taskNo, outboundTime? | CARRIER_ACCEPTED→OUTBOUND（出库在前、司机提车在后），回填 outbound_date；重复回传仅补记日志（幂等） |
| 10 | POST /drivers/sync | 狮桥 | driverName*, phone*, idCard*, licenseNo, licenseType, licenseValidFrom, licenseValidTo, carrierId? | 身份证号 UPSERT（source=2）+carrier_driver 维护 |
| 12 | POST /shipping-tasks/status-sync | 承运商通用（狮桥/任意三方物流） | action*:`ACCEPT|PICKUP|ARRIVE|FINISH`, applyNo/taskNo, carrierName?（回传承运商，须与任务承运商一致；不传按狮桥留痕）, driverId?(ACCEPT), planPickupDate?(ACCEPT 可选调整，不传保持 CRM 下发值), actualPickupDate?(PICKUP 实际提车日期=发运时间，不得早于出库日期，允许早于计划提车日期), photos?:[](PICKUP 提车照片) | 按状态机校验推进；PICKUP 仅 OUTBOUND（已出库）可确认，回填 ship_time；ARRIVE 回填 arrive_time（实际运费/里程不在本接口回传，运费功能暂未开放）；日志 source=carrierName 传时记 CARRIER |
| 14 | POST /esign/sign-status | 狮桥 | esignId*, signStatus:`SIGNED|CANCELLED` | WAIT_SIGN→SIGNED(回填 sign_time)/CANCELLED |

## 7. 前端工程结构与分工

```
frontend/
  package.json  vite.config.ts(代理/api→3000)  tsconfig.json  index.html(引 public/vendor/intl-tel-input)
  public/vendor/intl-tel-input/  (从旧 vendor 拷贝)
  src/
    main.ts  App.vue
    router/index.ts        # 全部路由+懒加载占位，页面阶段不改
    layouts/BasicLayout.vue # 侧边菜单+顶栏+面包屑
    stores/dictionary.ts session.ts
    services/http.ts carriers.ts drivers.ts tasks.ts tracking.ts freight.ts esigns.ts external.ts stats.ts
    types/api.ts
    components/  # StatusTag MoneyText PageTable DetailSection ConfirmAction PhoneInput(vendor包装) ChinaMap
    lib/china-map.js      # 旧文件原样拷贝，在途监控用
    utils/format.ts       # money/date/phone
    views/
      dashboard/          # 工作台       【页面组B】
      base/carriers/      # 承运商       【页面组A】
      base/drivers/       # 司机         【页面组A】
      dispatch/tasks/     # 发运任务     【页面组A】
      dispatch/tracking/  # 在途监控     【页面组B】
      settlement/freight/ # 结算管理     【页面组B】
      signatures/esigns/  # 电子签台账   【页面组B】
      simulator/          # 外部系统模拟 【页面组B】
```

菜单分组：工作台 / 基础数据（承运商、司机）/ 运输调度（发运任务、在途监控）/ 应付运费（结算管理）/ 电子签章（电子签台账）/ 演示（外部系统模拟）。

## 9. 必须保留的既有需求（用户已确认验收过的）

1. 任务单号系统自动生成（FY+yyyyMMdd+XXXX），CRM 下发不传
2. 派单弹窗：**线路参考价只读**（=计划运费，CRM 同步不可改）+ 派单备注（≤500 字，存 dispatch_record.remark）
3. 批量派单确认界面：任务清单（单号/客户/VIN/参考价）+ **参考价合计** + 批量备注 + 逐项成功/失败结果
4. 外部回调统一定位：apply_no 优先、task_no 兼容
5. 取消派单弹窗按 PRD 设计稿：标题带任务单号、当前状态快照、校验结果（绿✓/红✕）、取消原因下拉、补充说明、红字规则提示、红色警示按钮
6. 发运任务列表：发运地点/交付地址两列 + 计划提车日期/出库日期/发运时间/到达日期四列 + 承运商司机合并列 + 操作竖排
7. CRM 下发支持 remark 备注（≤500 字）落任务
8. 电子签按 VIN+发运申请号匹配任务
9. 承运商编码 CAR-XXX 自动生成、名称去重、停用拦截新派单
10. 司机姓名/身份证不可改；停用拦截新分派
