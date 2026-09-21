import { storeToRefs } from 'pinia'
import bus from '../../bus'
import notice from '@/services/notification'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { useProjectStore } from '@/store/project'
import { moveImageToFolder, uploadImage } from '@/util/fileSystem'
import { dataURLToFile } from '@/util/dataURLToFile'

// O12 step 6 part B, second cut — the image insertion family moved out of
// `editor.vue` verbatim. Everything here answers "an image is being inserted or
// edited: where does the file go, and what path goes into the document?".
// The stores are re-acquired here rather than injected, because every value this
// family reads (the five image preferences, `sourceCode`, `currentFile`,
// `projectTree`) already comes from a store.

interface ImagePathSuggestion {
  type: 'directory' | 'file' | string
  file: string
  [key: string]: unknown
}

export const useEditorImages = () => {
  const editorStore = useEditorStore()
  const projectStore = useProjectStore()
  const {
    imageInsertAction,
    imagePreferRelativeDirectory,
    imageRelativeDirectoryBase,
    imageRelativeDirectoryName,
    imageFolderPath,
    sourceCode
  } = storeToRefs(usePreferencesStore())
  const { currentFile } = storeToRefs(editorStore)
  const { projectTree } = storeToRefs(projectStore)

  const imagePathAutoComplete = async (src: string) => {
    const files = (await editorStore.ASK_FOR_IMAGE_AUTO_PATH(
      src
    )) as unknown as ImagePathSuggestion[]
    return files.map((f) => {
      const iconClass = f.type === 'directory' ? 'icon-folder' : 'icon-image'
      return Object.assign(f, { iconClass, text: f.file + (f.type === 'directory' ? '/' : '') })
    })
  }

  const imageAction = async (
    image: string | File,
    id: string | null,
    alt: string = ''
  ): Promise<string> => {
    // TODO(Refactor): Refactor this method.
    if (!currentFile.value) return ''
    const { filename, pathname: currentPathname } = currentFile.value

    // A pasted screenshot / bitmap clipboard comes in as a `data:` URL string
    // rather than a file path. `moveImageToFolder` and `uploadImage` treat any
    // string as a local path, which would silently keep the base64 inline — so
    // normalize it back into a `File` up front and let the branches below handle
    // it as binary.
    if (typeof image === 'string' && image.startsWith('data:')) {
      const file = dataURLToFile(image)
      if (file) image = file
    }

    // Figure out the current working directory.
    // Save an image relative to the file, otherwise use the project root when available.
    const isTabSavedOnDisk = !!currentPathname
    let relativeBasePath: string | null = isTabSavedOnDisk
      ? window.path.dirname(currentPathname)
      : null
    if (isTabSavedOnDisk && imageRelativeDirectoryBase.value !== 'file' && projectTree.value) {
      const { pathname: rootPath } = projectTree.value as { pathname?: string }
      if (rootPath && window.fileUtils.isChildOfDirectory(rootPath, currentPathname)) {
        // Save assets relative to root directory.
        relativeBasePath = rootPath
      }
    }

    const getResolvedImagePath = (imagePath: string) => {
      const replacement = isTabSavedOnDisk
        ? filename.replace(/\.[^/.]+$/, '') // Filename w/o extension
        : ''
      return imagePath.replace(/\${filename}/g, replacement)
    }

    const resolvedGlobalImageFolderPath = getResolvedImagePath(imageFolderPath.value)
    const resolvedImageRelativeDirectoryName = getResolvedImagePath(
      imageRelativeDirectoryName.value
    ) // assets/
    const resolvedImageRelativeFullDirectoryPath = relativeBasePath
      ? window.path.join(relativeBasePath, resolvedImageRelativeDirectoryName)
      : null // /root/dir/assets
    let destImagePath = ''
    switch (imageInsertAction.value) {
      case 'upload': {
        try {
          destImagePath = (await uploadImage(currentPathname, image)) as string
        } catch (err) {
          notice.notify({
            title: 'Upload Image',
            type: 'warning',
            message: err as string
          })
          destImagePath = (await moveImageToFolder(
            currentPathname,
            image,
            resolvedGlobalImageFolderPath
          )) as string
        }
        break
      }
      case 'folder': {
        if (isTabSavedOnDisk && imagePreferRelativeDirectory.value) {
          // `image` may be a path string (paste/drag/image-selector) — pass
          // `currentPathname` so moveImageToFolder can resolve relative paths
          // via `path.dirname(pathname)` instead of crashing on `dirname(null)`.
          destImagePath = (await moveImageToFolder(
            currentPathname,
            image,
            resolvedImageRelativeFullDirectoryPath as string,
            true,
            currentPathname
          )) as string
        } else {
          destImagePath = (await moveImageToFolder(
            currentPathname,
            image,
            resolvedGlobalImageFolderPath
          )) as string
        }
        break
      }
      case 'path': {
        if (typeof image === 'string') {
          // Input is a local path.
          destImagePath = image
        } else {
          // Save and move image to image folder if input is binary.

          // Respect user preferences if tab exists on disk.
          if (isTabSavedOnDisk && imagePreferRelativeDirectory.value) {
            destImagePath = (await moveImageToFolder(
              null as unknown as string,
              image,
              resolvedImageRelativeFullDirectoryPath as string,
              true,
              currentPathname
            )) as string
          } else {
            destImagePath = (await moveImageToFolder(
              currentPathname,
              image,
              resolvedGlobalImageFolderPath
            )) as string
          }
        }
        break
      }
    }

    if (id && sourceCode.value) {
      bus.emit('image-action', {
        id,
        result: destImagePath,
        alt
      })
    }
    return destImagePath
  }

  // Adapt the engine's `imageAction` contract (`{ src, alt, title }`) to the
  // desktop's `imageAction(image, id, alt)`. The engine handles a single inline
  // image edit (no `id` round-trip / source-mode bus event), so we pass `null`
  // for `id`.
  const muyaImageAction = (state: { src: string; alt?: string; title?: string }): Promise<string> =>
    imageAction(state.src, null, state.alt ?? '')

  const imagePathPicker = () => {
    return editorStore.ASK_FOR_IMAGE_PATH()
  }

  return { imagePathAutoComplete, imageAction, muyaImageAction, imagePathPicker }
}
