<script setup lang="ts">
/**
 * 工作台首页。使用深向卡车原图，上方欢迎语。
 */
import truck from '@/assets/login-truck-photo.jpg'
</script>

<template>
  <div class="home">
    <img class="home__photo" :src="truck" alt="" />
    <p class="home__title">欢迎使用DEEPWAY智能运输管理平台</p>
  </div>
</template>

<style scoped>
.home {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: #d7e6f2;
}
.home__photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 42%;
  display: block;
}
.home__title {
  position: absolute;
  left: 50%;
  top: 14%;
  transform: translateX(-50%);
  margin: 0;
  padding: 10px 28px;
  color: #fff;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 1px;
  line-height: 1.3;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(15, 40, 80, 0.25);
}
@media (max-width: 1100px) {
  .home__title { font-size: 24px; padding: 8px 16px; }
}
</style>
