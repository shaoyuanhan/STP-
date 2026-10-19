#!/bin/bash
# STP 优化后全链路冒烟测试
B=http://localhost:3000/api
TS=$(date +%H%M%S)
APPLY="SMOKE-$TS"
echo "== 1. CRM 下发（事务+本地日期单号） =="
curl -s -X POST $B/mock/crm/apply -H 'Content-Type: application/json' -d "{
  \"apply_no\":\"$APPLY\",\"customer_name\":\"冒烟测试客户\",\"vin\":\"LSVTEST$TS\",
  \"dest_region\":\"上海市\",\"dest_address\":\"上海市浦东新区测试路1号\",\"plan_freight\":2500}" | head -c 120
echo ""
TASK_JSON=$(curl -s "$B/ship-tasks?apply_no=$APPLY&size=1")
TASK_NO=$(echo "$TASK_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).list[0].task_no))")
TASK_ID=$(echo "$TASK_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).list[0].id))")
echo "任务单号: $TASK_NO (今日应为 FY20261019*)"

echo "== 2. 重复下发应被拒(409) =="
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST $B/mock/crm/apply -H 'Content-Type: application/json' -d "{\"apply_no\":\"$APPLY\",\"customer_name\":\"x\",\"vin\":\"x\",\"dest_address\":\"x\",\"plan_freight\":1}"

echo "== 3. 派单 =="
curl -s -X POST $B/ship-tasks/$TASK_ID/dispatch -H 'Content-Type: application/json' -d '{"carrier_id":1}'

echo -e "\n== 4. 接单（司机1，默认提车日期应为本地明天） =="
curl -s -X POST $B/mock/shiqiao/accept -H 'Content-Type: application/json' -d "{\"task_no\":\"$TASK_NO\",\"driver_id\":1}"

echo -e "\n== 5. 出库 =="
curl -s -X POST $B/mock/wms/outbound -H 'Content-Type: application/json' -d "{\"task_no\":\"$TASK_NO\"}"

echo -e "\n== 6. 提车 =="
curl -s -X POST $B/mock/shiqiao/pickup -H 'Content-Type: application/json' -d "{\"task_no\":\"$TASK_NO\"}"

echo -e "\n== 7. 位置回传（transport_no 本地日期） =="
curl -s -X POST $B/mock/shiqiao/track -H 'Content-Type: application/json' -d "{\"task_no\":\"$TASK_NO\",\"position_desc\":\"G40沪陕高速\",\"lng\":118.79,\"lat\":32.06,\"speed\":86}"

echo -e "\n== 8. 到达（事务：任务更新+运费单生成） =="
curl -s -X POST $B/mock/shiqiao/arrive -H 'Content-Type: application/json' -d "{\"task_no\":\"$TASK_NO\",\"actual_freight\":2800,\"mileage\":462}"

echo -e "\n== 9. 完结 =="
curl -s -X POST $B/mock/shiqiao/finish -H 'Content-Type: application/json' -d "{\"task_no\":\"$TASK_NO\"}"

echo -e "\n== 10. 运费单校验 =="
curl -s "$B/freight-orders?task_no=$TASK_NO&size=1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const l=JSON.parse(d).list[0];console.log('id='+l.id+' 金额:'+l.actual_freight+' 状态:'+l.status)})"
FO_ID=$(curl -s "$B/freight-orders?task_no=$TASK_NO&size=1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).list[0].id))")

echo "== 11. 修改运费（事务+留痕） =="
curl -s -X POST $B/freight-orders/$FO_ID/adjust -H 'Content-Type: application/json' -d '{"amount":2750,"reason":"冒烟测试调整"}'

echo -e "\n== 12. 缺原因应被拒(400) =="
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST $B/freight-orders/$FO_ID/adjust -H 'Content-Type: application/json' -d '{"amount":2600}'

echo "== 13. 确认对账 =="
curl -s -X POST $B/freight-orders/$FO_ID/recon

echo -e "\n== 14. 任务详情（时间轴完整性） =="
curl -s $B/ship-tasks/$TASK_ID | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d);console.log('状态:'+t.task.status+' 事件数:'+t.events.length+' 实际运费:'+t.task.actual_freight+' 里程:'+t.task.mileage)})"

echo "== 15. 取消链路（仅待派单可取消+电子签联动） =="
APPLY2="SMOKE-C-$TS"
curl -s -X POST $B/mock/crm/apply -H 'Content-Type: application/json' -d "{
  \"apply_no\":\"$APPLY2\",\"customer_name\":\"取消测试\",\"vin\":\"LSVCXL$TS\",
  \"dest_region\":\"杭州市\",\"dest_address\":\"杭州市西湖区测试路2号\",\"plan_freight\":1800}" >/dev/null
curl -s -X POST $B/mock/esign/init -H 'Content-Type: application/json' -d "{\"esign_id\":\"ES-SMOKE-$TS\",\"vin\":\"LSVCXL$TS\",\"apply_no\":\"$APPLY2\"}" >/dev/null
echo -n "取消前查询: "
curl -s "$B/mock/crm/cancel-query?apply_no=$APPLY2"
echo -n "
取消结果: "
curl -s -X POST $B/mock/crm/cancel -H 'Content-Type: application/json' -d "{\"apply_no\":\"$APPLY2\",\"cancel_reason\":\"冒烟测试取消\"}"
echo -n "
电子签联动: "
curl -s "$B/esigns?esign_id=ES-SMOKE-$TS&size=1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('esign状态:'+JSON.parse(d).list[0].status))"

echo -e "\n== 16. 分页边界 =="
curl -s -o /dev/null -w "page=0&size=500 → HTTP %{http_code}\n" "$B/ship-tasks?page=0&size=500"

echo "== 17. 统计一致性 =="
curl -s $B/stats | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d);console.log('任务总数:'+s.task.total+' 完结:'+s.task.finished+' 取消:'+s.task.cancelled+' 待对账:'+s.freightPending.count)})"
echo "冒烟测试完成: $TASK_NO / $APPLY2"
