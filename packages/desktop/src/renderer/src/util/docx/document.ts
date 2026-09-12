/**
 * HTML → WordprocessingML (.docx package) converter for the DOCX export
 * (M4.2, M4). Zero dependencies: the styled HTML produced by
 * `exportStyledHTML` is parsed with the renderer's DOMParser and mapped to
 * OOXML parts, which `zip.ts` packages into the final .docx bytes.
 *
 * Mapping (v1):
 *   h1-h6        → Heading1-6 paragraph styles (Word navigation pane works)
 *   p            → normal paragraph
 *   ul/ol (nested) → proper numbering.xml (one abstractNum per list instance)
 *   blockquote   → indented, muted paragraph
 *   pre          → Courier New paragraphs, line breaks preserved
 *   table        → w:tbl with borders (header row bold)
 *   hr           → paragraph with bottom border
 *   strong/b, em/i, u, s/strike/del, code, br, a (hyperlink) → run formatting
 *   img[data:]   → embedded via word/media + relationship (best effort)
 *   img[other]   → dropped (local file paths are not readable renderer-side;
 *                  documented limitation)
 *
 * Word is forgiving about omitted OOXML detail; we emit the minimum it
 * requires: [Content_Types].xml, the root rels, document.xml, and — only when
 * the content needs them — styles.xml, numbering.xml, document rels and media
 * parts.
 */
import { createZip, type ZipEntry } from './zip'

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function xmlPart(declaration: string, body: string): Uint8Array {
  return new TextEncoder().encode(`${declaration}${body}`)
}

// ---------------------------------------------------------------------------
// Package context: relationships, media, numbering
// ---------------------------------------------------------------------------

interface Relationship {
  id: string
  type: string
  target: string
  /** External URLs get TargetMode="External" (hyperlinks). */
  external?: boolean
}

class PackageContext {
  readonly relationships: Relationship[] = []
  readonly media: ZipEntry[] = []
  private nextRid = 1
  private nextMediaIndex = 1
  /** Per-list-instance numbering definitions (index = numId - 1). */
  readonly numberingFormats: NumberingFormat[] = []

  addRelationship(type: string, target: string, external = false): string {
    const id = `rId${this.nextRid++}`
    this.relationships.push({ id, type, target, external })
    return id
  }

  /** Embed a data-URI image; returns its relationship id or null if unsupported. */
  addImage(dataUri: string): string | null {
    const match = /^data:image\/(png|jpeg|jpg|gif|bmp);base64,(.+)$/i.exec(dataUri)
    if (!match) return null
    const ext = match[1] === 'jpeg' ? 'jpeg' : match[1] === 'jpg' ? 'jpeg' : match[1]
    const bytes = base64ToBytes(match[2])
    const name = `image${this.nextMediaIndex++}.${ext}`
    this.media.push({ name: `word/media/${name}`, data: bytes })
    return this.addRelationship(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
      `media/${name}`
    )
  }

  /** Register a list instance; returns the w:numId to reference. */
  addNumbering(ordered: boolean): number {
    // numId 1 is reserved as the fallback bullet format; instances start at 2
    // so every list nests/counts independently.
    this.numberingFormats.push({ ordered })
    return this.numberingFormats.length + 1
  }
}

interface NumberingFormat {
  ordered: boolean
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

// ---------------------------------------------------------------------------
// Run / paragraph emission
// ---------------------------------------------------------------------------

interface RunFormat {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
  href?: string
}

const MONO_FONT = 'Courier New'
const BODY_FONT = 'Calibri'

function runProperties(format: RunFormat): string {
  let props = ''
  if (format.code) {
    props += `<w:rFonts w:ascii="${MONO_FONT}" w:hAnsi="${MONO_FONT}" w:cs="${MONO_FONT}"/>`
  }
  if (format.bold) props += '<w:b/>'
  if (format.italic) props += '<w:i/>'
  if (format.strike) props += '<w:strike/>'
  if (format.underline) props += '<w:u w:val="single"/>'
  return props ? `<w:rPr>${props}</w:rPr>` : ''
}

function textRun(text: string, format: RunFormat): string {
  return `<w:r>${runProperties(format)}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
}

function breakRun(format: RunFormat): string {
  return `<w:r>${runProperties(format)}<w:br/></w:r>`
}

interface ParagraphOptions {
  styleId?: string
  /** Indentation in twips (left, then hanging-first-line for blockquote). */
  indentLeft?: number
  /** `w:jc` — left/center/right (HR/alignment use). */
  alignment?: 'left' | 'center' | 'right'
  /** Bottom border only (thematic break). */
  bottomBorder?: boolean
  /** Skip spacing between paragraphs (preformatted code lines). */
  compact?: boolean
  numbering?: { numId: number; ilvl: number }
}

function paragraph(runsXml: string, options: ParagraphOptions = {}): string {
  let props = ''
  if (options.styleId) props += `<w:pStyle w:val="${options.styleId}"/>`
  if (options.numbering) {
    const { numId, ilvl } = options.numbering
    props += `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`
  }
  if (options.indentLeft || options.bottomBorder) {
    let indent = ''
    if (options.indentLeft) indent += `<w:left w:val="${options.indentLeft}"/>`
    props += `<w:ind ${indent}/>`
  }
  if (options.bottomBorder) {
    props +=
      '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>'
  }
  if (options.compact) {
    props += '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
  }
  if (options.alignment && options.alignment !== 'left') {
    props += `<w:jc w:val="${options.alignment}"/>`
  }
  const pPr = props ? `<w:pPr>${props}</w:pPr>` : ''
  return `<w:p>${pPr}${runsXml}</w:p>`
}

// ---------------------------------------------------------------------------
// Block-level DOM walking
// ---------------------------------------------------------------------------

const HEADING_TAGS: Record<string, string> = {
  h1: 'Heading1',
  h2: 'Heading2',
  h3: 'Heading3',
  h4: 'Heading4',
  h5: 'Heading5',
  h6: 'Heading6'
}

const BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'blockquote',
  'pre',
  'table',
  'hr',
  'div'
])

export class DocxBuilder {
  private readonly ctx = new PackageContext()
  private readonly paragraphs: string[] = []

  constructor(private readonly title: string) {}

  /** Convert one top-level element (or a whole document body) into paragraphs. */
  appendBlock(element: Element, listContext: { numId: number; ilvl: number } | null = null): void {
    const tag = element.tagName.toLowerCase()

    if (tag === 'ul' || tag === 'ol') {
      const numId = this.ctx.addNumbering(tag === 'ol')
      const ilvl = listContext ? listContext.ilvl + 1 : 0
      for (const li of Array.from(element.children)) {
        if (li.tagName.toLowerCase() !== 'li') continue
        this.appendListItem(li, { numId, ilvl })
      }
      return
    }

    if (tag === 'table') {
      this.appendTable(element)
      return
    }

    if (tag === 'hr') {
      this.paragraphs.push(paragraph('', { bottomBorder: true }))
      return
    }

    if (tag === 'pre') {
      this.appendPre(element)
      return
    }

    if (tag === 'blockquote') {
      const inner = Array.from(element.children).filter((c) => BLOCK_TAGS.has(c.tagName.toLowerCase()))
      if (inner.length) {
        for (const child of inner) this.appendBlock(child, listContext)
      } else {
        const runs = this.collectRuns(element, {})
        this.paragraphs.push(paragraph(runs, { indentLeft: 720 }))
      }
      return
    }

    if (tag === 'div') {
      // Generic container (TOC wrapper, katex display spans…): recurse so its
      // blocks still become real paragraphs.
      for (const child of Array.from(element.children)) this.appendBlock(child, listContext)
      return
    }

    if (HEADING_TAGS[tag]) {
      const runs = this.collectRuns(element, {})
      this.paragraphs.push(paragraph(runs, { styleId: HEADING_TAGS[tag] }))
      return
    }

    // Paragraphs and anything unstructured with text content.
    const runs = this.collectRuns(element, {})
    if (runs.length === 0 && !element.textContent?.trim()) return
    this.paragraphs.push(paragraph(runs))
  }

  private appendListItem(li: Element, list: { numId: number; ilvl: number }): void {
    // A list item's direct content: inline runs plus nested block children
    // (nested lists/paragraphs). The item marker comes from w:numPr.
    const runs = this.collectRuns(li, {}, (el) => {
      const t = el.tagName.toLowerCase()
      return !(t === 'ul' || t === 'ol' || (t === 'p' && list.ilvl >= 0 && el.children.length === 0))
    })
    this.paragraphs.push(paragraph(runs, { numbering: list }))

    for (const child of Array.from(li.children)) {
      const t = child.tagName.toLowerCase()
      if (t === 'ul' || t === 'ol') {
        this.appendBlock(child, list)
      } else if (t === 'p') {
        const childRuns = this.collectRuns(child, {})
        this.paragraphs.push(paragraph(childRuns))
      }
    }
  }

  private appendPre(pre: Element): void {
    // Render each line as a compact mono paragraph; <br> and newlines both
    // split lines.
    const raw = pre.textContent ?? ''
    const lines = raw.replace(/\r/g, '').split('\n')
    for (const line of lines) {
      this.paragraphs.push(paragraph(textRun(line, { code: true }), { compact: true }))
    }
  }

  private appendTable(table: Element): void {
    const rows = Array.from(table.querySelectorAll('tr'))
    if (!rows.length) return

    const cellXml = (cell: Element, isHeader: boolean): string => {
      const runs = this.collectRuns(cell, isHeader ? { bold: true } : {})
      return `<w:tc><w:tcPr/><w:p>${runs}</w:p></w:tc>`
    }

    const rowXml = rows
      .map((row, rowIndex) => {
        const cells = Array.from(row.children).filter((c) => {
          const t = c.tagName.toLowerCase()
          return t === 'td' || t === 'th'
        })
        const isHeader = rowIndex === 0 || cells.every((c) => c.tagName.toLowerCase() === 'th')
        return `<w:tr>${cells.map((c) => cellXml(c, isHeader)).join('')}</w:tr>`
      })
      .join('')

    const borders =
      '<w:tblBorders>' +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`)
        .join('') +
      '</w:tblBorders>'

    this.paragraphs.push(
      `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}</w:tblPr>${rowXml}</w:tbl>`
    )
  }

  /**
   * Walk inline content into run XML. `skipFilter` lets list items exclude
   * nested block elements they don't handle themselves.
   */
  private collectRuns(
    root: Element,
    format: RunFormat,
    skipFilter?: (element: Element) => boolean
  ): string {
    let runs = ''
    const walk = (node: Node, current: RunFormat): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? ''
        if (text) runs += textRun(text, current)
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const el = node as Element
      if (skipFilter?.(el)) return
      const tag = el.tagName.toLowerCase()

      switch (tag) {
        case 'br':
          runs += breakRun(current)
          return
        case 'strong':
        case 'b':
          for (const child of Array.from(el.childNodes)) walk(child, { ...current, bold: true })
          return
        case 'em':
        case 'i':
          for (const child of Array.from(el.childNodes)) walk(child, { ...current, italic: true })
          return
        case 'u':
          for (const child of Array.from(el.childNodes)) walk(child, { ...current, underline: true })
          return
        case 's':
        case 'strike':
        case 'del':
          for (const child of Array.from(el.childNodes)) walk(child, { ...current, strike: true })
          return
        case 'code':
          for (const child of Array.from(el.childNodes)) walk(child, { ...current, code: true })
          return
        case 'a': {
          const href = el.getAttribute('href') ?? ''
          if (/^https?:\/\//i.test(href)) {
            const rId = this.ctx.addRelationship(
              'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
              href,
              true
            )
            const inner = this.collectRuns(el, { ...current, underline: true })
            runs += `<w:hyperlink r:id="${rId}">${inner}</w:hyperlink>`
          } else {
            for (const child of Array.from(el.childNodes)) walk(child, current)
          }
          return
        }
        case 'img': {
          const src = el.getAttribute('src') ?? ''
          const rId = this.ctx.addImage(src)
          if (rId) runs += this.imageRun(rId, el)
          return
        }
        case 'span':
        case 'sup':
        case 'sub':
        case 'mark':
          // Inline containers: recurse transparently.
          for (const child of Array.from(el.childNodes)) walk(child, current)
          return
        case 'input':
          // GFM task checkboxes are rendered as meta upstream; skip them here.
          return
        default: {
          // Unknown inline element with only text (e.g. kbd): recurse.
          for (const child of Array.from(el.childNodes)) walk(child, current)
        }
      }
    }

    for (const child of Array.from(root.childNodes)) walk(child, format)
    return runs
  }

  private imageRun(rId: string, img: Element): string {
    // Fixed 6" width cap, preserving the intrinsic aspect ratio when the HTML
    // declares it; Word scales the drawing via EMU (914400 per inch).
    const EMU_PER_INCH = 914400
    const maxWidthInches = 6
    const widthAttr = Number(img.getAttribute('width') ?? '')
    const heightAttr = Number(img.getAttribute('height') ?? '')
    let widthEmu = Math.round(maxWidthInches * EMU_PER_INCH)
    let heightEmu = Math.round(3 * EMU_PER_INCH)
    if (Number.isFinite(widthAttr) && widthAttr > 0) {
      // width attribute is CSS pixels; 96 px per inch.
      const inches = Math.min(widthAttr / 96, maxWidthInches)
      widthEmu = Math.round(inches * EMU_PER_INCH)
      if (Number.isFinite(heightAttr) && heightAttr > 0) {
        heightEmu = Math.round((heightAttr / 96) * EMU_PER_INCH)
      }
    }
    const docPrId = this.ctx.media.length + 1
    return (
      '<w:r><w:rPr/><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"' +
      ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
      `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/>` +
      `<wp:docPr id="${docPrId}" name="Image ${docPrId}"/>` +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="Image ${docPrId}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
    )
  }

  /** Assemble the final .docx package bytes. */
  build(): Uint8Array {
    const now = new Date()
    const entries: ZipEntry[] = []
    const hasImages = this.ctx.media.length > 0
    const hasLists = this.ctx.numberingFormats.length > 0
    const needsRels =
      this.ctx.relationships.length > 0

    // -- [Content_Types].xml ----------------------------------------------
    const imageDefaults = ['png', 'jpeg', 'gif', 'bmp']
      .filter((ext) => this.ctx.media.some((m) => m.name.endsWith(`.${ext}`)))
      .map(
        (ext) =>
          `<Default Extension="${ext}" ContentType="image/${ext}"/>`
      )
      .join('')
    entries.push({
      name: '[Content_Types].xml',
      data: xmlPart(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          imageDefaults +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          (needsRels
            ? '<Override PartName="/word/_rels/document.xml.rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            : '') +
          (hasLists
            ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
            : '') +
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
          '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
          '</Types>'
      )
    })

    // -- _rels/.rels --------------------------------------------------------
    entries.push({
      name: '_rels/.rels',
      data: xmlPart(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
          '</Relationships>'
      )
    })

    // -- docProps/core.xml --------------------------------------------------
    entries.push({
      name: 'docProps/core.xml',
      data: xmlPart(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
          `<dc:title>${escapeXml(this.title)}</dc:title>` +
          '<dc:creator>ColaMD</dc:creator>' +
          `<dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created>` +
          '</cp:coreProperties>'
      )
    })

    // -- word/styles.xml ----------------------------------------------------
    entries.push({ name: 'word/styles.xml', data: xmlPart(XML_DECL, buildStylesXml(BODY_FONT)) })

    // -- word/numbering.xml -------------------------------------------------
    if (hasLists) {
      entries.push({ name: 'word/numbering.xml', data: xmlPart(XML_DECL, buildNumberingXml(this.ctx.numberingFormats)) })
    }

    // -- word/_rels/document.xml.rels ---------------------------------------
    if (needsRels) {
      const rels = this.ctx.relationships
        .map(
          (r) =>
            `<Relationship Id="${r.id}" Type="${r.type}" Target="${escapeXml(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`
        )
        .join('')
      entries.push({
        name: 'word/_rels/document.xml.rels',
        data: xmlPart(XML_DECL, `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`)
      })
    }

    // -- word/document.xml --------------------------------------------------
    const body = this.paragraphs.join('')
    const namespaces =
      '<w:document ' +
      'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
      (hasImages ? ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"' : '') +
      '>'
    entries.push({
      name: 'word/document.xml',
      data: xmlPart(
        XML_DECL,
        `${namespaces}<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr></w:body></w:document>`
      )
    })

    // -- word/media/* -------------------------------------------------------
    entries.push(...this.ctx.media)

    return createZip(entries, now)
  }
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

// ---------------------------------------------------------------------------
// styles.xml / numbering.xml builders
// ---------------------------------------------------------------------------

function buildStylesXml(bodyFont: string): string {
  const heading = (level: number): string => {
    const sizes = ['32', '28', '24', '22', '20', '20'] // half-points
    return (
      `<w:style w:type="paragraph" w:styleId="Heading${level}">` +
      `<w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:qFormat/>` +
      '<w:pPr><w:keepNext/><w:outlineLvl w:val="' +
      String(level - 1) +
      '"/><w:spacing w:before="240" w:after="120"/></w:pPr>' +
      `<w:rPr><w:b/><w:sz w:val="${sizes[level - 1]}"/></w:rPr>` +
      '</w:style>'
    )
  }

  return (
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    `<w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:eastAsia="${bodyFont}" w:cs="${bodyFont}"/>` +
    '<w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    heading(1) +
    heading(2) +
    heading(3) +
    heading(4) +
    heading(5) +
    heading(6) +
    '</w:styles>'
  )
}

function buildNumberingXml(formats: NumberingFormat[]): string {
  // Word requires every abstractNum to appear before any num. abstractNumId 0
  // backs the mandatory numId 1 (the default bullet list style); list
  // instances get their own abstractNum so nested/counting state is isolated.
  const defaultAbstract =
    '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' +
    [0, 1, 2]
      .map(
        (ilvl) =>
          `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="bullet"/>` +
          '<w:lvlText w:val="•"/><w:lvlJc w:val="left"/>' +
          `<w:pPr><w:ind w:left="${720 + ilvl * 720}" w:hanging="360"/></w:pPr></w:lvl>`
      )
      .join('') +
    '</w:abstractNum>'

  const abstractNums = formats
    .map((format, index) => {
      const abstractId = index + 1
      const levels = [0, 1, 2]
        .map((ilvl) => {
          const fmt = format.ordered ? 'decimal' : 'bullet'
          const text = format.ordered ? `%${ilvl + 1}.` : '•'
          const indent = 720 + ilvl * 720
          return (
            `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/>` +
            `<w:lvlText w:val="${escapeXml(text)}"/><w:lvlJc w:val="left"/>` +
            `<w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr></w:lvl>`
          )
        })
        .join('')
      return `<w:abstractNum w:abstractNumId="${abstractId}"><w:multiLevelType w:val="hybridMultilevel"/>${levels}</w:abstractNum>`
    })
    .join('')

  const nums =
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    formats
      .map((_, index) => `<w:num w:numId="${index + 2}"><w:abstractNumId w:val="${index + 1}"/></w:num>`)
      .join('')

  return (
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    defaultAbstract +
    abstractNums +
    nums +
    '</w:numbering>'
  )
}
