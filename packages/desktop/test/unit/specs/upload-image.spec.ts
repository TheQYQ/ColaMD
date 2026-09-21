import { describe, it, expect, beforeEach, vi } from 'vitest'
import { uploadImage } from '@/util/fileSystem'

// uploadImage forwards to the preload contextBridge surface
// (window.uploader.uploadImage). The payload carries only *which image* to
// upload: which uploader runs, and which script it executes, are main's own
// settings. `cliScript` used to ride along here, which made the channel a way
// for the renderer to name the program the main process runs.

const uploadImageFn = vi.fn((_payload?: unknown) => Promise.resolve('https://cdn/x.png'))

const win = window as unknown as {
  uploader: { uploadImage: typeof uploadImageFn }
}

beforeEach(() => {
  uploadImageFn.mockClear()
  win.uploader = { uploadImage: uploadImageFn }
})

const sentPayload = (): Record<string, unknown> =>
  uploadImageFn.mock.calls[0][0] as Record<string, unknown>

describe('uploadImage IPC payload shape', () => {
  const docPath = '/tmp/notes/a.md'

  it('forwards a local path string with isPath:true', async () => {
    const source = '/Users/someone/pictures/pic.png'
    const result = await uploadImage(docPath, source)

    expect(uploadImageFn).toHaveBeenCalledTimes(1)
    expect(sentPayload().pathname).toBe(docPath)
    expect(sentPayload().image).toBe(source)
    expect(sentPayload().isPath).toBe(true)
    expect(result).toBe('https://cdn/x.png')
  })

  it('forwards a binary File with isPath:false and a Uint8Array + name', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' })
    await uploadImage(docPath, file)

    expect(uploadImageFn).toHaveBeenCalledTimes(1)
    const image = sentPayload().image as { data: Uint8Array; name: string }
    expect(sentPayload().pathname).toBe(docPath)
    expect(sentPayload().isPath).toBe(false)
    expect(image.name).toBe('pic.png')
    expect(image.data).toBeInstanceOf(Uint8Array)
    expect(Array.from(image.data)).toEqual([1, 2, 3])
  })

  // The point of the channel's shape: nothing that selects code to run crosses
  // the boundary, under any key name.
  it('sends exactly the three owned fields and no uploader settings', async () => {
    await uploadImage(docPath, '/x/y.png')

    expect(Object.keys(sentPayload()).sort()).toEqual(['image', 'isPath', 'pathname'])
    expect(sentPayload().preferences).toBeUndefined()
    expect(sentPayload().cliScript).toBeUndefined()
    expect(JSON.stringify(sentPayload())).not.toContain('cliScript')
  })

  it('returns the uploader-provided URL', async () => {
    uploadImageFn.mockResolvedValueOnce('https://cdn/custom.png')
    const result = await uploadImage(docPath, '/x/y.png')
    expect(result).toBe('https://cdn/custom.png')
  })
})
