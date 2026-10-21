<script setup lang="ts">
/**
 * 照片上传：本地压缩 -> base64 上传 -> 返回可访问 URL
 * 用于司机端提车/到达/结单与承运商端异常留证
 */
import { ref } from 'vue'
import { useMessage } from 'naive-ui'
import { fileToCompressedDataUrl, uploadImage } from '@/services/portal'

const props = withDefaults(defineProps<{
  modelValue: string[]
  min?: number
  max?: number
  hint?: string
}>(), {
  min: 0,
  max: 6,
  hint: '',
})

const emit = defineEmits<{ (e: 'update:modelValue', value: string[]): void }>()
const message = useMessage()
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

function pick() {
  if (uploading.value) return
  fileInput.value?.click()
}

async function onChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  uploading.value = true
  try {
    const next = [...props.modelValue]
    for (const file of files) {
      if (next.length >= props.max) {
        message.warning(`最多上传 ${props.max} 张照片`)
        break
      }
      const dataUrl = await fileToCompressedDataUrl(file)
      const result = await uploadImage(dataUrl)
      next.push(result.url)
    }
    emit('update:modelValue', next)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '照片上传失败')
  } finally {
    uploading.value = false
  }
}

function remove(index: number) {
  const next = [...props.modelValue]
  next.splice(index, 1)
  emit('update:modelValue', next)
}

function preview(url: string) {
  window.open(url, '_blank')
}
</script>

<template>
  <div class="uploader">
    <div class="uploader__grid">
      <div v-for="(url, index) in modelValue" :key="url" class="uploader__item" @click="preview(url)">
        <img :src="url" alt="照片" />
        <button type="button" class="uploader__remove" @click.stop="remove(index)">×</button>
      </div>
      <button
        v-if="modelValue.length < max"
        type="button"
        class="uploader__add"
        :disabled="uploading"
        @click="pick"
      >
        <span class="uploader__plus">{{ uploading ? '…' : '+' }}</span>
        <span>{{ uploading ? '上传中' : '拍照/上传' }}</span>
      </button>
    </div>
    <div class="uploader__hint">
      {{ hint || `已上传 ${modelValue.length} 张${min ? `，至少 ${min} 张` : ''}` }}
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      capture="environment"
      multiple
      class="uploader__input"
      @change="onChange"
    />
  </div>
</template>

<style scoped>
.uploader__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(86px, 1fr));
  gap: 8px;
}
.uploader__item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 4px;
  overflow: hidden;
  background: #fafafa;
  border: 1px solid #f0f0f0;
  cursor: zoom-in;
}
.uploader__item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.uploader__remove {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.uploader__add {
  aspect-ratio: 1;
  border: 1px dashed #d9d9d9;
  border-radius: 4px;
  background: #fafafa;
  color: #8c8c8c;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
}
.uploader__add:hover {
  border-color: #1677ff;
  color: #1677ff;
}
.uploader__add:disabled {
  cursor: wait;
  opacity: 0.7;
}
.uploader__plus {
  font-size: 22px;
  line-height: 1;
  font-weight: 300;
}
.uploader__hint {
  margin-top: 6px;
  font-size: 12px;
  color: #8c8c8c;
}
.uploader__input {
  display: none;
}
</style>
