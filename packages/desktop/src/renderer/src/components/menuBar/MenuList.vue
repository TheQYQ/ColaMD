<template>
  <div
    ref="listEl"
    class="menu-list"
    role="menu"
    @keydown="onListKeydown"
  >
    <template
      v-for="(item, i) in items"
      :key="`${depth}-${i}`"
    >
      <div
        v-if="item.type === 'separator'"
        class="menu-sep"
        role="separator"
        aria-orientation="horizontal"
      />
      <div
        v-else
        class="menu-row"
        :class="{
          disabled: item.enabled === false,
          checked: item.checked && (item.type === 'checkbox' || item.type === 'radio')
        }"
        :role="
          item.type === 'checkbox'
            ? 'menuitemcheckbox'
            : item.type === 'radio'
              ? 'menuitemradio'
              : 'menuitem'
        "
        :aria-checked="
          item.type === 'checkbox' || item.type === 'radio' ? isChecked(item) : undefined
        "
        :aria-disabled="item.enabled === false ? 'true' : undefined"
        :data-menu-index="i"
        tabindex="-1"
        @click.stop="onRowClick(item)"
        @mouseenter="onRowHover(item, i, $event)"
      >
        <span
          class="menu-check"
          aria-hidden="true"
        >{{ isChecked(item) ? '✓' : '' }}</span>
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
import { firstFocusableIndex, lastFocusableIndex, nextFocusableIndex } from './menuFocus'

defineOptions({ name: 'MenuList' })

const props = withDefaults(
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

const listEl = ref<HTMLElement | null>(null)
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

const positionSubmenu = async (rowEl: HTMLElement): Promise<void> => {
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

/** Index of the row holding focus in THIS list, or -1 when focus is elsewhere. */
const focusedIndex = (): number => {
  const active = document.activeElement as HTMLElement | null
  if (!active || !listEl.value?.contains(active)) return -1
  const raw = active.dataset.menuIndex
  return raw === undefined ? -1 : Number(raw)
}

const focusRow = (index: number): void => {
  if (index < 0) return
  listEl.value?.querySelector<HTMLElement>(`[data-menu-index="${index}"]`)?.focus()
}

const onListKeydown = (event: KeyboardEvent): void => {
  const items = props.items
  const from = focusedIndex()
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    // A nested list handles its own arrows first; without this the parent would
    // also run and yank focus back to its own first row.
    event.stopPropagation()
    const delta = event.key === 'ArrowDown' ? 1 : -1
    // Entering the menu from no known row lands on the end of the direction,
    // not on whatever `nextFocusableIndex` would compute from a bogus index.
    focusRow(
      from < 0
        ? delta === 1
          ? firstFocusableIndex(items)
          : lastFocusableIndex(items)
        : nextFocusableIndex(items, from, delta)
    )
  }
}
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
