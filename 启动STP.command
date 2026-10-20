#!/bin/bash
#  智能运输管理平台 STP · 一键启动器
#  双击启动整个系统；关闭本窗口即停止前后端
#  前端为 Vue3 + Vite 工程（frontend/，端口 5173），后端 Express（backend/，端口 3000）
PROJECT="$(cd "$(dirname "$0")" && pwd)"

echo "正在启动 智能运输管理平台 STP ..."
echo "项目目录: $PROJECT"
echo ""

# MySQL 就绪探测（最多等 20 秒）
brew services start mysql >/dev/null 2>&1

i=1
while [ $i -le 20 ]; do
  nc -z 127.0.0.1 3306 >/dev/null 2>&1 && break
  sleep 1
  i=$((i+1))
done

# 1) 启动后端（端口 3000）
cd "$PROJECT/backend"  && npm start      > /tmp/stp-backend.log  2>&1 &

# 2) 启动前端 dev server（端口 5173，/api 由 vite 代理到 3000）
cd "$PROJECT/frontend" && npm run dev    > /tmp/stp-frontend.log 2>&1 &

# 3) 等待前端 dev server 就绪（最多 30 秒）再打开浏览器
i=1
while [ $i -le 30 ]; do
  curl -s -o /dev/null http://localhost:5173 && break
  sleep 1
  i=$((i+1))
done

echo "后端 API : http://localhost:3000              (日志 /tmp/stp-backend.log)"
echo "前端页面 : http://localhost:5173              (日志 /tmp/stp-frontend.log)"
echo ""
open "http://localhost:5173"
echo "已自动打开浏览器。保持本窗口开着；关闭本窗口即停止前后端服务"
wait
