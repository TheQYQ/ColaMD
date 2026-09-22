// Renderer-safe UTF-8 byte length. `Buffer.byteLength()` must not be used here:
// the renderer runs with `nodeIntegration: false` and context isolation on, so
// `Buffer` is undefined (asserted by test/e2e/context-isolation.spec.ts). Using
// it threw `Buffer is not defined` inside SAVE_VERSION_SNAPSHOT — which FILE_SAVE
// runs BEFORE sending `mt::response-file-save` — silently aborting every manual
// and auto save in the production build (the unsaved dot never cleared).
// `TextEncoder.encode().length` is byte-identical to `Buffer.byteLength(s, 'utf8')`.
const utf8Encoder = new TextEncoder()

export const byteLengthUtf8 = (text: string): number => utf8Encoder.encode(text).length
