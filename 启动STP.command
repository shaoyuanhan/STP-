#!/bin/bash
#  智能运输管理平台 STP · 一键启动器
#  双击启动整个系统；关闭本窗口即停止前后端
PROJECT="$(cd "$(dirname "$0")" && pwd)"

echo "正在启动 智能运输管理平台 STP ..."
echo "项目目录: $PROJECT"
echo ""

brew services start mysql >/dev/null 2>&1

i=1
while [ $i -le 20 ]; do
  nc -z 127.0.0.1 3306 >/dev/null 2>&1 && break
  sleep 1
  i=$((i+1))
done

cd "$PROJECT/backend"  && npm start      > /tmp/stp-backend.log  2>&1 &
cd "$PROJECT/frontend" && node server.js > /tmp/stp-frontend.log 2>&1 &

sleep 2
echo "后端 API : http://localhost:3000              (日志 /tmp/stp-backend.log)"
echo "前端页面 : http://localhost:8000/index.html   (日志 /tmp/stp-frontend.log)"
echo ""
open "http://localhost:8000/index.html"
echo "已自动打开浏览器。保持本窗口开着；关闭本窗口即停止前后端服务"
wait
