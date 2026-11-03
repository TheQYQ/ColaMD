// Stable DOM id for a tree row, shared by `tree.vue` (aria-activedescendant)
// and the row components (id). The pathname is percent-encoded so separators
// and spaces cannot break the id, and distinct pathnames cannot collide.
export const treeRowId = (pathname: string): string => `tree-row-${encodeURIComponent(pathname)}`
