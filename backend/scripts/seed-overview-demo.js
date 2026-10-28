/**
 * 全国态势演示数据生成器
 *
 * 生成一批覆盖全国主要城市的在途 / 已完结运单及轨迹点，用于查看地图配色、
 * 聚合气泡与省份热力的真实效果。数据以 remark = DEMO_OVERVIEW_SEED 标记，
 * 脚本可重复执行：每次先清掉上一批演示数据再重新生成。
 *
 * 执行：node scripts/seed-overview-demo.js
 */
const fs = require('fs');
const path = require('path');
const { pool, withTransaction } = require('../src/db');

const MARK = 'DEMO_OVERVIEW_SEED';
const ORIGIN = { city: '合肥', addr: '合肥市包河区上海路88号' };

// ---------------------------------------------------------------------------
// 城市 → 省份 / 大区
// ---------------------------------------------------------------------------
const PROVINCE_CITIES = {
  上海: ['上海'], 江苏: ['南京', '苏州', '无锡', '常州', '徐州', '南通'], 浙江: ['杭州', '宁波', '温州', '嘉兴', '绍兴', '金华', '台州'],
  安徽: ['合肥', '芜湖', '蚌埠', '阜阳'], 福建: ['福州', '厦门'], 江西: ['南昌', '九江'], 山东: ['济南', '青岛', '烟台', '临沂', '济宁', '淄博'],
  河南: ['郑州', '洛阳', '开封'], 湖北: ['武汉', '宜昌', '襄阳'], 湖南: ['长沙', '株洲'],
  北京: ['北京'], 天津: ['天津'], 河北: ['石家庄', '唐山', '保定'], 山西: ['太原'], 内蒙古: ['呼和浩特', '包头'],
  广东: ['广州', '深圳', '东莞', '佛山'], 广西: ['南宁'], 海南: ['海口', '三亚'],
  重庆: ['重庆'], 四川: ['成都'], 贵州: ['贵阳'], 云南: ['昆明'], 西藏: ['拉萨'],
  陕西: ['西安'], 甘肃: ['兰州'], 青海: ['西宁'], 宁夏: ['银川'], 新疆: ['乌鲁木齐', '吐鲁番', '喀什'],
  辽宁: ['沈阳', '大连'], 吉林: ['长春'], 黑龙江: ['哈尔滨'],
};
const PROVINCE_REGION = {
  上海: '华东', 江苏: '华东', 浙江: '华东', 安徽: '华东', 福建: '华东', 江西: '华东', 山东: '华东',
  河南: '华中', 湖北: '华中', 湖南: '华中',
  北京: '华北', 天津: '华北', 河北: '华北', 山西: '华北', 内蒙古: '华北',
  广东: '华南', 广西: '华南', 海南: '华南',
  重庆: '西南', 四川: '西南', 贵州: '西南', 云南: '西南', 西藏: '西南',
  陕西: '西北', 甘肃: '西北', 青海: '西北', 宁夏: '西北', 新疆: '西北',
  辽宁: '东北', 吉林: '东北', 黑龙江: '东北',
};
const CITY_PROV = {};
const CITY_REGION = {};
for (const [prov, cities] of Object.entries(PROVINCE_CITIES)) {
  for (const city of cities) {
    CITY_PROV[city] = prov;
    CITY_REGION[city] = PROVINCE_REGION[prov];
  }
}

// 城市坐标直接从地图库提取，保证与前端解析一致
const CITY_GEO = (() => {
  const file = path.join(__dirname, '../../frontend/src/lib/china-map.js');
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('const CITY_GEO = {');
  const end = src.indexOf('\n};', start);
  const body = src.slice(start, end);
  const geo = {};
  const re = /'([^']+)'\s*:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/g;
  let m;
  while ((m = re.exec(body))) geo[m[1]] = [Number(m[2]), Number(m[3])];
  return geo;
})();
const GEO_LIST = Object.entries(CITY_GEO).map(([city, [lng, lat]]) => ({ city, lng, lat }));

// ---------------------------------------------------------------------------
// 路线清单（dest 为交付城市；from 为空表示合肥工厂发车）
// ---------------------------------------------------------------------------
const ROUTES = [
  // 在途：华东加密，便于观察同城聚合气泡
  ['上海', '上海市浦东新区沪南公路2000号'],
  ['上海', '上海市青浦区华新镇嘉松中路4588号'],
  ['杭州', '杭州市萧山区宁围街道鸿宁路1899号'],
  ['杭州', '杭州市余杭区仓前街道文一西路969号'],
  ['南京', '南京市江宁区秣陵街道诚信大道2111号'],
  ['南京', '南京市栖霞区尧化街道仙新路8号'],
  ['苏州', '苏州市相城区太阳路国际汽车城'],
  ['无锡', '无锡市惠山区堰桥街道惠山大道108号'],
  ['常州', '常州市武进区湖塘镇延政中大道9号'],
  ['武汉', '武汉市东西湖区金北一路特1号'],
  ['广州', '广州市黄埔区开发大道东1号'],
  ['广州', '广州市白云区机场路1630号'],
  ['深圳', '深圳市龙岗区坂田街道五和大道1号'],
  ['深圳', '深圳市宝安区福永街道怀德路88号'],
  ['成都', '成都市龙泉驿区成龙大道二段1666号'],
  ['成都', '成都市新都区大丰街道蓉北路一段8号'],
  ['西安', '西安市未央区凤城四路1号'],
  ['西安', '西安市灞桥区港务大道99号'],
  ['北京', '北京市顺义区顺平路566号'],
  ['天津', '天津市滨海新区海河下游南岸物流园'],
  ['石家庄', '石家庄市栾城区窦妪镇装备制造基地'],
  ['太原', '太原市小店区学府街123号'],
  ['呼和浩特', '呼和浩特市赛罕区金桥开发区世纪五路'],
  ['沈阳', '沈阳市浑南区全运路109号'],
  ['长春', '长春市汽车经济技术开发区东风大街2259号'],
  ['哈尔滨', '哈尔滨市道里区机场路8号'],
  ['济南', '济南市历城区郭店街道临港路1号'],
  ['青岛', '青岛市城阳区流亭街道赵红路28号'],
  ['郑州', '郑州市管城回族区经开第十七大街58号'],
  ['长沙', '长沙市长沙县黄花镇大路村物流园'],
  ['南昌', '南昌市青山湖区高新南大道1188号'],
  ['福州', '福州市仓山区金山大道618号'],
  ['厦门', '厦门市集美区杏林湾路466号'],
  ['重庆', '重庆市渝北区龙兴镇两江大道9号'],
  ['昆明', '昆明市官渡区彩云北路5001号'],
  ['贵阳', '贵阳市观山湖区林城西路8号'],
  ['南宁', '南宁市西乡塘区安吉大道66号'],
  ['海口', '海口市秀英区海盛路88号'],
  ['兰州', '兰州市安宁区北滨河西路588号'],
  ['西宁', '西宁市城东区昆仑东路18号'],
  ['银川', '银川市西夏区文昌南街12号'],
  ['乌鲁木齐', '乌鲁木齐市头屯河区金桥路66号'],
  ['拉萨', '拉萨市堆龙德庆区工业园区1号'],
  // 已完结：覆盖多省，撑起历史热力
  ['上海', '上海市嘉定区安亭镇墨玉南路888号', 'FINISHED'],
  ['上海', '上海市宝山区潘泾路2699号', 'FINISHED'],
  ['苏州', '苏州市吴中区木渎镇金枫路216号', 'FINISHED'],
  ['苏州', '苏州市工业园区星湖街328号', 'FINISHED'],
  ['武汉', '武汉市洪山区珞喻路100号', 'FINISHED'],
  ['北京', '北京市通州区马驹桥镇物流基地', 'FINISHED'],
  ['北京', '北京市大兴区亦庄经济技术开发区科创五街', 'FINISHED'],
  ['西安', '西安市雁塔区科技路48号', 'FINISHED'],
  ['成都', '成都市双流区西航港大道中四段', 'FINISHED'],
  ['广州', '广州市番禺区迎宾大道688号', 'FINISHED'],
  ['杭州', '杭州市滨江区江陵路1760号', 'FINISHED'],
  ['长沙', '长沙市岳麓区麓谷大道658号', 'FINISHED'],
  ['郑州', '郑州市金水区农业路111号', 'FINISHED'],
  ['青岛', '青岛市黄岛区长江中路519号', 'FINISHED'],
  ['昆明', '昆明市呈贡区春融街779号', 'FINISHED'],
  ['合肥', '合肥市肥西县桃花工业园繁华大道', 'FINISHED'],
  // 返程：起点不在合肥，让链路方向更真实
  ['合肥', '合肥市包河区上海路88号', 'FINISHED', '上海', '上海市闵行区申长路988号'],
  ['合肥', '合肥市包河区上海路88号', 'IN_TRANSIT', '北京', '北京市朝阳区金盏乡东窑村'],
  ['合肥', '合肥市包河区上海路88号', 'FINISHED', '广州', '广州市增城区新塘镇荔新公路'],
  ['合肥', '合肥市包河区上海路88号', 'IN_TRANSIT', '成都', '成都市青白江区香岛大道1509号'],
];

const CUSTOMERS = [
  '上海鸿运物流有限公司', '杭州启达供应链有限公司', '南京远成汽车贸易有限公司', '苏州优途物流有限公司',
  '武汉恒信汽车销售有限公司', '广州粤运汽车贸易有限公司', '深圳鹏程物流有限公司', '成都蜀道汽车销售有限公司',
  '西安秦驰汽车贸易有限公司', '北京中恒汽车销售有限公司', '天津津运物流有限公司', '石家庄冀通汽车销售有限公司',
  '沈阳盛达汽车贸易有限公司', '青岛海联物流有限公司', '郑州中远汽车贸易有限公司', '长沙恒通汽车销售有限公司',
  '重庆渝新汽车贸易有限公司', '昆明滇运物流有限公司', '乌鲁木齐西域汽车销售有限公司', '拉萨高原物流有限公司',
];
const SALES = [
  ['吴敏', '+8613900000001'], ['张倩', '+8613900000002'], ['李锐', '+8613900000003'], ['周航', '+8613900000004'],
];
const RECEIVERS = ['王建国', '李海涛', '陈志强', '刘文博', '赵明辉', '孙立军'];
const MODELS = [
  ['星辰重卡H9', '潍柴WP13H', '高顶双卧'],
  ['星辰重卡H7', '康明斯X13', '平顶排半'],
  ['星辰重卡H6', '潍柴WP12', '高顶单卧'],
];
const HIGHWAYS = ['G3京台', 'G4京港澳', 'G15沈海', 'G25长深', 'G30连霍', 'G35济广', 'G40沪陕', 'G42沪蓉', 'G45大广', 'G50沪渝', 'G55二广', 'G60沪昆', 'G65包茂', 'G70福银', 'G75兰海', 'G80广昆'];

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
const pad = (n, len = 2) => String(n).padStart(len, '0');
const fmt = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const dateOnly = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayCode = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const addHours = (d, h) => new Date(d.getTime() + h * 3600 * 1000);
const addDays = (d, n) => new Date(d.getTime() + n * 86400 * 1000);

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** 带弧度的路径插值：避免所有线路都是直线 */
function pointAt(a, b, t) {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const bend = Math.sin(Math.PI * t) * 0.12;
  return { lng: a.lng + dx * t - dy * bend, lat: a.lat + dy * t + dx * bend };
}

function nearestCity(lng, lat) {
  let best = GEO_LIST[0];
  let bestD = Infinity;
  for (const c of GEO_LIST) {
    const d = (c.lng - lng) ** 2 + (c.lat - lat) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best.city;
}

const geoOf = (city) => {
  const [lng, lat] = CITY_GEO[city] || CITY_GEO['合肥'];
  return { lng, lat };
};

/** 交付地区：上海市 / 江苏省苏州市 / 内蒙古自治区呼和浩特市 */
function cityArea(province, city) {
  if (['上海', '北京', '天津', '重庆'].includes(province)) return `${province}市`;
  const selfRule = {
    内蒙古: '内蒙古自治区', 西藏: '西藏自治区', 新疆: '新疆维吾尔自治区',
    宁夏: '宁夏回族自治区', 广西: '广西壮族自治区',
  };
  if (selfRule[province]) return `${selfRule[province]}${city}市`;
  return `${province}省${city}市`;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  const now = new Date();
  const created = [];
  let seq = 1;

  await withTransaction(async (conn) => {
    // 清理上一批演示数据
    const [demoTasks] = await conn.query('SELECT id FROM shipping_task WHERE remark = ?', [MARK]);
    if (demoTasks.length) {
      const ids = demoTasks.map((t) => t.id);
      const inSql = ids.map(() => '?').join(',');
      for (const table of ['transport_track', 'shipping_task_vehicle', 'task_status_log', 'dispatch_record', 'freight_bill']) {
        await conn.query(`DELETE FROM ${table} WHERE task_id IN (${inSql})`, ids);
      }
      await conn.query(`DELETE FROM shipping_task WHERE id IN (${inSql})`, ids);
    }
    console.log(`[seed] 已清理旧演示运单 ${demoTasks.length} 条`);

    // 当日已存在的任务单号，避免唯一键冲突
    const [existRows] = await conn.query('SELECT task_no FROM shipping_task');
    const existNos = new Set(existRows.map((r) => r.task_no));

    for (let i = 0; i < ROUTES.length; i++) {
      const [destCity, destAddr, status = 'IN_TRANSIT', fromCity, fromAddr] = ROUTES[i];
      const from = fromCity ? { city: fromCity, addr: fromAddr } : ORIGIN;
      const fromGeo = geoOf(from.city);
      const destGeo = geoOf(destCity);
      const km = Math.max(80, distanceKm(fromGeo, destGeo));
      const travelHours = km / 65 + 3;
      const isFinished = status === 'FINISHED';
      const region = CITY_REGION[destCity] || '华东';
      const province = CITY_PROV[destCity] || '安徽';
      const deliveryArea = cityArea(province, destCity);
      const [salesPerson, salesPhone] = SALES[i % SALES.length];
      const carrierId = (i % 3) + 1;
      const driverId = [1, 2, 3, 4, 5, 6][i % 6];
      const planFreight = Math.max(1800, Math.round((km * 2.4 + 1200) / 100) * 100);
      // 演示数据统一一车一单：运单量与运输车辆数一一对应
      const vehicleCount = 1;

      // 时间线
      let createTime;
      let shipTime;
      let progress;
      let lastReport;
      if (isFinished) {
        createTime = addDays(now, -(5 + (i % 7)));
        shipTime = addHours(createTime, 8 + (i % 6));
        progress = 1;
        lastReport = addHours(shipTime, travelHours);
      } else {
        progress = 0.22 + (i % 7) * 0.09;
        // 大多数运单 5~55 分钟前上报；每 9 单留 1 单超 1 小时未上报，用于演示异常线路
        const staleMinutes = i % 9 === 4 ? 75 + (i % 4) * 20 : 5 + ((i * 7) % 50);
        lastReport = addHours(now, -(staleMinutes / 60));
        shipTime = addHours(lastReport, -travelHours * progress);
        createTime = addHours(shipTime, -((6 + (i % 5))));
      }
      const arriveTime = isFinished ? lastReport : null;
      const finishTime = isFinished ? addHours(lastReport, 1 + (i % 4)) : null;

      // 任务单号：FY + 创建日期 + 4 位序列
      let taskNo;
      let n = 200 + seq;
      do {
        taskNo = `FY${dayCode(createTime)}${pad(n, 4)}`;
        n += 1;
      } while (existNos.has(taskNo));
      seq += 1;
      existNos.add(taskNo);

      const applyNo = `CRM-DEMO${dayCode(createTime)}${pad(i + 1, 4)}`;
      const orderNo = `SO-26${pad(createTime.getMonth() + 1)}${pad(createTime.getDate())}-${pad(i + 1, 4)}`;
      const outboundTime = addHours(shipTime, -3);
      const planPickup = dateOnly(addDays(shipTime, -1));

      const [taskResult] = await conn.query(
        `INSERT INTO shipping_task
        (task_no, apply_no, order_no, customer_name, region, sales_person, sales_phone, delivery_area, delivery_address,
         receiver_name, receiver_phone, factory, storage_location, ship_method, ship_location, plan_pickup_date, outbound_date,
         ship_time, arrive_time, finish_time, carrier_id, driver_id, plan_freight, mileage, actual_freight, status,
         remark, create_name, create_time)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          taskNo, applyNo, orderNo, CUSTOMERS[i % CUSTOMERS.length], region, salesPerson, salesPhone,
          deliveryArea, destAddr, RECEIVERS[i % RECEIVERS.length], `+86139${pad(50000000 + i * 137, 8)}`,
          '合肥工厂', '合肥成品库', '送车', from.addr,
          planPickup, fmt(outboundTime), fmt(shipTime), arriveTime ? fmt(arriveTime) : null,
          finishTime ? fmt(finishTime) : null, carrierId, driverId, planFreight.toFixed(2), km.toFixed(2),
          isFinished ? Math.max(0, planFreight - ((i * 37) % 400)).toFixed(2) : null, status,
          MARK, '演示数据生成器', fmt(createTime),
        ],
      );
      const taskId = taskResult.insertId;

      // 车辆明细
      for (let v = 0; v < vehicleCount; v++) {
        const [model, engine, cabin] = MODELS[(i + v) % MODELS.length];
        const vin = `LZXBCGH48P2D${pad(30000 + i * 2 + v, 5)}`;
        await conn.query(
          `INSERT INTO shipping_task_vehicle
           (task_id, task_no, vin, order_no, report_no, plan_freight, actual_freight, ship_location,
            vehicle_model, engine_config, cabin_type, create_name, create_time)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            taskId, taskNo, vin, orderNo,
            `BD-26${pad(createTime.getMonth() + 1)}${pad(createTime.getDate())}-${pad(i + 1, 4)}`,
            (planFreight / vehicleCount).toFixed(2), isFinished ? (planFreight / vehicleCount).toFixed(2) : null,
            from.addr, model, engine, cabin, '演示数据生成器', fmt(createTime),
          ],
        );
      }

      // 轨迹：按进度生成带弧度的折线，间隔约 1-2 小时
      const pointCount = Math.max(5, Math.min(14, Math.round(km / 180) + 4));
      const endTime = isFinished ? arriveTime : lastReport;
      const rows = [];
      for (let p = 0; p < pointCount; p++) {
        const t = (progress * p) / (pointCount - 1);
        const point = pointAt(fromGeo, destGeo, t);
        const time = new Date(shipTime.getTime() + ((endTime.getTime() - shipTime.getTime()) * p) / (pointCount - 1));
        let desc;
        let speed;
        if (p === 0) {
          desc = `${from.addr} 发车`;
          speed = 0;
        } else if (p === pointCount - 1) {
          desc = isFinished
            ? `${destAddr} 已到达`
            : `${nearestCity(point.lng, point.lat)}附近 · ${HIGHWAYS[(i + p) % HIGHWAYS.length]}高速`;
          speed = isFinished ? 0 : 62 + ((i * 7 + p * 11) % 26);
        } else {
          const hw = HIGHWAYS[(i + p) % HIGHWAYS.length];
          desc = `${hw}高速 ${nearestCity(point.lng, point.lat)}段`;
          speed = 62 + ((i * 7 + p * 11) % 26);
        }
        rows.push([
          taskId, taskNo, `SQ${dayCode(shipTime)}${pad(taskId, 4)}`,
          point.lng.toFixed(6), point.lat.toFixed(6), desc, speed.toFixed(2), fmt(time),
        ]);
      }
      await conn.query(
        `INSERT INTO transport_track
         (task_id, task_no, transport_no, longitude, latitude, location_desc, speed, report_time, create_name)
         VALUES ?`,
        [rows.map((r) => [...r, 'JOB'])],
      );

      created.push({ taskNo, status, destCity, km: Math.round(km), points: rows.length });
    }
  });

  const transit = created.filter((c) => c.status === 'IN_TRANSIT');
  const finished = created.filter((c) => c.status === 'FINISHED');
  console.log(`[seed] 新增在途 ${transit.length} 单 / 已完结 ${finished.length} 单，共 ${created.length} 单`);
  console.log(`[seed] 覆盖交付城市：${[...new Set(created.map((c) => c.destCity))].join('、')}`);
  await pool.end();
}

main().catch(async (e) => {
  console.error('[seed] 生成失败：', e);
  await pool.end();
  process.exit(1);
});
