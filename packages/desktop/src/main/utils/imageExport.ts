// Document → long-image export (Typora parity: File → Export → Image).
// The renderer hands us the fully styled export HTML; we render it in a hidden
// offscreen window sized to the full document height and capture one frame.
import { BrowserWindow } from 'electron'
import { mkdtemp, unlink, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'

const MAX_IMAGE_HEIGHT = 32767 // PNG/BMP raster dimension ceiling on most platforms
const MIN_IMAGE_HEIGHT = 400
const MIN_IMAGE_WIDTH = 800
const MAX_IMAGE_WIDTH = 2560

export async function exportDocumentImage(
  html: string,
  type: 'png' | 'jpeg'
): Promise<Buffer> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'colamd-image-'))
  const tmpHtml = path.join(tmpDir, 'document.html')
  await writeFile(tmpHtml, html, 'utf8')

  let win: BrowserWindow | null = null
  try {
    win = new BrowserWindow({
      show: false,
      frame: false,
      enableLargerThanScreen: true,
      webPreferences: {
        // Offscreen rendering guarantees a composited frame for capturePage
        // without ever putting a window on screen.
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => {
      event.preventDefault()
    })

    await win.loadFile(tmpHtml)
    await win.webContents.executeJavaScript(
      'document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true'
    )

    const width = Math.min(
      MAX_IMAGE_WIDTH,
      Math.max(MIN_IMAGE_WIDTH, Number(await win.webContents.executeJavaScript(
        'Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0)'
      )) || MIN_IMAGE_WIDTH)
    )
    let height = Number(await win.webContents.executeJavaScript(
      'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)'
    ))
    if (!Number.isFinite(height)) { height = MIN_IMAGE_HEIGHT }
    height = Math.max(MIN_IMAGE_HEIGHT, Math.min(height, MAX_IMAGE_HEIGHT))

    win.setContentSize(width, height)
    // Give the compositor one paint cycle at the final size.
    await new Promise(resolve => setTimeout(resolve, 150))

    const image = await win.webContents.capturePage({ x: 0, y: 0, width, height })
    return type === 'png' ? image.toPNG() : image.toJPEG(90)
  } finally {
    await unlink(tmpHtml).catch(() => {})
    win?.destroy()
  }
}
