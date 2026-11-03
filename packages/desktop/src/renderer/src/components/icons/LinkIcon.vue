<template>
  <span
    :role="label ? 'button' : undefined"
    :tabindex="label ? 0 : undefined"
    :aria-label="label || undefined"
    @keydown="onKeydown"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      :width="size"
      :height="size"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  </span>
</template>

<script setup lang="ts">
// A11Y-07 (#GUI-B8): the icon used to be hard-aria-hidden while carrying the
// consumer's click entry — invisible to screen readers and unreachable by
// keyboard. Pass `label` to render it as a keyboard-operable button (the
// consumer's click still arrives via attribute fallthrough); without `label`
// it stays purely decorative.
import { activateOnEnterOrSpace } from '@/util/keyboardActivate'

withDefaults(defineProps<{ size?: number | string; label?: string }>(), {
  size: 16,
  label: undefined
})

const onKeydown = (event: KeyboardEvent): void => {
  const target = event.currentTarget
  if (target instanceof HTMLElement && target.getAttribute('role') === 'button') {
    activateOnEnterOrSpace(event)
  }
}
</script>
