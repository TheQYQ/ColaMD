// GUI-SA: the patch blocks that every built-in theme file used to carry
// verbatim (32 copies, all `!important`), hoisted into one shared layer that
// `addThemeStyle` injects as part of the active theme sheet. Colors come from
// each theme's `:root` table via `var()`; the three values that were
// per-theme hardcodes (titlebar icon fill, titlebar hover wash, chrome
// border) ride on alias variables defined per theme, with component-default
// fallbacks in index.css so themes that never carried the patches (light,
// custom manifests) keep rendering exactly as before.
//
// Cascade contract (see util/theme.ts): the sheet is assembled as
// [prism css] -> [this layer] -> [theme :root + per-theme appendix]. Shared
// rules therefore beat the bundled component/muya styles by position at equal
// specificity, and a per-theme appendix beats this layer — which is why the
// rules below carry no `!important`. The two rules that must outrun scoped
// component selectors (`.side-bar[data-v]`, tab `<li>`s) use real ancestors
// (`:root body`, `.editor-tabs`) instead of specificity bumps.

// The kebab-case mirror block: byte-identical in all 32 theme files before
// the hoist. Light never carried it (its muya-side kebab consumers read
// muya's own defaults), so it is injected only for file-based themes.
export const SHARED_KEBAB_ALIASES = `:root {
  /* @muyajs/core (kebab-case) editor variables
     Additive prep for the muyajs -> @muyajs/core editor swap. These
     mirror the camelCase vars above; the legacy editor ignores them.
     Do NOT remove the camelCase vars — they still drive the current
     editor until editor.vue switches engines. */
  --theme-color: var(--themeColor);
  --highlight-color: var(--highlightColor);
  --selection-color: var(--selectionColor);
  --editor-color: var(--editorColor);
  --editor-color-80: var(--editorColor80);
  --editor-color-50: var(--editorColor50);
  --editor-color-30: var(--editorColor30);
  --editor-color-10: var(--editorColor10);
  --editor-color-04: var(--editorColor04);
  --editor-bg-color: var(--editorBgColor);
  --editor-area-width: var(--editorAreaWidth);
  --delete-color: var(--deleteColor);
  --icon-color: var(--iconColor);
  --code-block-bg-color: var(--codeBlockBgColor);
  --table-border-color: var(--tableBorderColor);
  --input-bg-color: var(--inputBgColor);
  --button-font-color: var(--buttonFontColor);
  --button-bg-color: var(--buttonBgColor);
  --button-border: var(--buttonBorder);
  --button-bg-color-hover: var(--buttonBgColorHover);
  --button-border-hover: var(--buttonBorderHover);
  --button-bg-color-active: var(--buttonBgColorActive);
  --button-border-active: var(--buttonBorderActive);
  --button-border-focus: var(--button-border);
  --float-bg-color: var(--floatBgColor);
  --float-hover-color: var(--floatHoverColor);
  --float-border-color: var(--floatBorderColor);
  --float-shadow: rgb(15 15 15 / 3%) 0 0 0 1px, rgb(15 15 15 / 4%) 0 3px 6px, rgb(15 15 15 / 5%) 0 9px 24px;
  --link-color: var(--linkColor);
  --h1-color: var(--h1Color);
  --h2-color: var(--h2Color);
  --h3-color: var(--h3Color);
  --h4-color: var(--h4Color);
  --h5-color: var(--h5Color);
  --h6-color: var(--h6Color);
  --blockquote-text-color: var(--blockquoteTextColor);
  --blockquote-border-color: var(--blockquoteBorderColor);
  --strong-color: var(--strongColor);
  --em-color: var(--emColor);
  --list-marker-color: var(--listMarkerColor);
  --hr-color: var(--hrColor);
}`

export const SHARED_THEME_PATCHES = `::-webkit-scrollbar {
  background: var(--editorBgColor);
}

.mu-front-menu,
.mu-float-wrapper {
  box-shadow: 0 4px 8px 0 var(--floatShadow);
}

.title-bar .frameless-titlebar-button > div > svg {
  fill: var(--titleBarIconColor);
}
.title-bar .frameless-titlebar-minimize:hover,
.title-bar .frameless-titlebar-toggle:hover {
  background-color: var(--titleBarHoverBgColor);
}

/* ":root body" outruns the scoped ".side-bar[data-v]" border rule without
   relying on !important. */
:root body .side-bar {
  border-right: 1px solid var(--sideBarBorderColor);
}

.recent-files-projects a,
.open-project a {
  box-shadow: none;
}
.open-project button,
.recent-files-projects button {
  box-shadow: none;
}

.editor-tabs:after {
  position: absolute;
  content: '';
  border-bottom: 1px solid var(--sideBarBorderColor);
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1;
}
.editor-tabs ul.tabs-container:after {
  position: absolute;
  content: '';
  border-bottom: 1px solid var(--sideBarBorderColor);
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 2;
}

/* ".editor-tabs" ties the scoped component selector and wins on sheet order. */
.editor-tabs .tabs-container > li,
.editor-tabs .tabs-container > li.active {
  background: var(--editorBgColor);
}

:not(pre) > code[class*='language-'],
pre:not(.CodeMirror-line),
pre[class*='language-'],
pre.mu-code-block {
  background: var(--codeBlockBgColor);
  border: none;
}
.mu-thematic-break:not(.mu-active)::before {
  border-top: 2px dashed var(--editorColor10);
  background: none;
}
figure.mu-active.mu-math-block > div.mu-math-preview,
figure.mu-active.mu-diagram-block > div.mu-diagram-preview {
  box-shadow: 0 3px 8px 0 var(--floatShadow);
}`
