<template>
  <div class="menu-list">
    <template
      v-for="(item, i) in items"
      :key="`${depth}-${i}`"
    >
      <div
        v-if="item.type === 'separator'"
        class="menu-sep"
      />
      <div
        v-else
        class="menu-row"
        :class="{
          disabled: item.enabled === false,
          checked: item.checked && (item.type === 'checkbox' || item.type === 'radio')
        }"
        @click.stop="onRowClick(item)"
        @mouseenter="onRowHover(item, i, $event)"
      >
        <span class="menu-check">{{ isChecked(item) ? '✓' : '' }}</span>
        <span class="menu-label">{{ item.label }}</span>
        <span class="menu-hint">{{ item.children?.length ? '›' : item.hint || '' }}</span>
      </div>
      <div
        v-if="openSubIndex === i && item.children?.length"
        class="menu-dropdown submenu title-no-drag"
        :style="submenuStyle"
      >
        <menu-list
          :items="item.children"
          :depth="depth + 1"
          @action="emitAction"
          @close="emitClose"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, type CSSProperties } from 'vue'
import type { MenuItemDef } from '@/menu/types'

defineOptions({ name: 'MenuList' })

withDefaults(
  defineProps<{
    items: MenuItemDef[]
    depth?: number
  }>(),
  { depth: 0 }
)

const emit = defineEmits<{
  (e: 'action'): void
  (e: 'close'): void
}>()

const openSubIndex = ref<number | null>(null)
const submenuStyle = ref<CSSProperties>({})

const isChecked = (item: MenuItemDef): boolean =>
  item.checked === true && (item.type === 'checkbox' || item.type === 'radio')

const onRowHover = (item: MenuItemDef, index: number, event: MouseEvent): void => {
  if (item.enabled === false) return
  if (item.children?.length) {
    openSubIndex.value = index
    positionSubmenu(event.currentTarget as HTMLElement)
  } else if (openSubIndex.value !== null) {
    openSubIndex.value = null
  }
}

const positionSubmenu = async(rowEl: HTMLElement): Promise<void> => {
  const rect = rowEl.getBoundingClientRect()
  // Prefer a flyout to the right, flip to the left near the window edge.
  const left = rect.right - 3
  const fitsRight = left + 240 <= window.innerWidth
  submenuStyle.value = {
    left: `${fitsRight ? left : Math.max(4, rect.left - 237)}px`,
    top: `${Math.max(4, rect.top - 6)}px`
  }
  await nextTick()
}

const onRowClick = (item: MenuItemDef): void => {
  if (item.enabled === false) return
  if (item.children?.length) return
  item.action?.()
  emitAction()
}

const emitAction = (): void => emit('action')
const emitClose = (): void => emit('close')
</script>

<style scoped>
.menu-list {
  min-width: inherit;
}
.menu-row {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 14px 0 6px;
  white-space: nowrap;
  cursor: default;
  color: var(--floatFontColor);
}
.menu-row:hover {
  background: var(--floatHoverColor);
}
.menu-row.disabled {
  opacity: 0.35;
}
.menu-row.disabled:hover {
  background: transparent;
}
.menu-check {
  display: inline-block;
  width: 20px;
  flex: none;
  font-size: 12px;
}
.menu-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-right: 24px;
}
.menu-hint {
  flex: none;
  font-size: 12px;
  opacity: 0.55;
  margin-left: 12px;
}
.menu-sep {
  height: 1px;
  background: var(--floatBorderColor);
  margin: 5px 10px;
}
</style>
