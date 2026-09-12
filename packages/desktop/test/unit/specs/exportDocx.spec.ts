import { describe, it, expect } from 'vitest'
import { crc32, createZip, listZipEntryNames, readZipEntry } from '@/util/docx/zip'
import { exportDocx } from '@/util/exportDocx'

// M4.2 — the DOCX export pipeline: a zero-dependency STORE-only ZIP writer
// plus an HTML → WordprocessingML converter over the styled export. The
// tests assert the OOXML package structure and the document.xml fragments
// Word will consume (the true end-to-end check is opening the file in Word).

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
const latin1 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

describe('docx/zip — STORE-only writer', () => {
  it('computes the IEEE CRC-32 of a known vector', () => {
    // Canonical check value for "123456789".
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926)
  })

  it('round-trips entries through the central directory', () => {
    const entries = [
      { name: '[Content_Types].xml', data: utf8('<Types/>') },
      { name: 'word/document.xml', data: utf8('<w:document/>') }
    ]
    const zip = createZip(entries)

    expect(listZipEntryNames(zip)).toEqual(['[Content_Types].xml', 'word/document.xml'])
    expect(latin1(readZipEntry(zip, 'word/document.xml'))).toBe('<w:document/>')
    expect(latin1(readZipEntry(zip, '[Content_Types].xml'))).toBe('<Types/>')
  })

  it('stores binary data verbatim (method=0, no compression artifacts)', () => {
    const binary = new Uint8Array(256)
    for (let i = 0; i < binary.length; i++) binary[i] = i
    const zip = createZip([{ name: 'word/media/image1.png', data: binary }])
    const out = readZipEntry(zip, 'word/media/image1.png')
    expect(Array.from(out)).toEqual(Array.from(binary))
  })
})

describe('docx/exportDocx — HTML to WordprocessingML package', () => {
  const buildHtml = (article: string): string =>
    `<!doctype html><html><head><title>Styled</title></head><body><article class="markdown-body">${article}</article></body></html>`

  it('emits the mandatory OOXML parts and the title metadata', () => {
    const bytes = exportDocx(buildHtml('<p>hello</p>'), 'My Doc')

    const names = listZipEntryNames(bytes)
    expect(names).toContain('[Content_Types].xml')
    expect(names).toContain('_rels/.rels')
    expect(names).toContain('word/document.xml')
    expect(names).toContain('word/styles.xml')
    expect(names).toContain('docProps/core.xml')

    const core = latin1(readZipEntry(bytes, 'docProps/core.xml'))
    expect(core).toContain('<dc:title>My Doc</dc:title>')
    expect(core).toContain('<dc:creator>ColaMD</dc:creator>')

    const document = latin1(readZipEntry(bytes, 'word/document.xml'))
    expect(document).toContain('<w:t xml:space="preserve">hello</w:t>')
  })

  it('maps headings to Heading1-6 styles (Word navigation pane)', () => {
    const bytes = exportDocx(
      buildHtml('<h1>Title</h1><h2>Section</h2><h3>Sub</h3>'),
      't'
    )
    const document = latin1(readZipEntry(bytes, 'word/document.xml'))
    expect(document).toContain('<w:pStyle w:val="Heading1"/>')
    expect(document).toContain('<w:pStyle w:val="Heading2"/>')
    expect(document).toContain('<w:pStyle w:val="Heading3"/>')

    const styles = latin1(readZipEntry(bytes, 'word/styles.xml'))
    expect(styles).toContain('w:styleId="Heading1"')
    expect(styles).toContain('<w:outlineLvl w:val="0"/>')
  })

  it('maps inline formatting to run properties and hyperlinks to relationships', () => {
    const bytes = exportDocx(
      buildHtml(
        '<p><strong>bold</strong> <em>italic</em> <code>x = 1</code> <a href="https://example.com">link</a></p>'
      ),
      't'
    )
    const document = latin1(readZipEntry(bytes, 'word/document.xml'))
    expect(document).toContain('<w:b/>')
    expect(document).toContain('<w:i/>')
    expect(document).toContain('<w:rFonts w:ascii="Courier New"')
    expect(document).toContain('<w:hyperlink r:id="rId')

    const rels = latin1(readZipEntry(bytes, 'word/_rels/document.xml.rels'))
    expect(rels).toContain('Target="https://example.com"')
    expect(rels).toContain('TargetMode="External"')
  })

  it('converts lists via numbering.xml with independent numIds', () => {
    const bytes = exportDocx(
      buildHtml('<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>'),
      't'
    )

    const names = listZipEntryNames(bytes)
    expect(names).toContain('word/numbering.xml')

    const document = latin1(readZipEntry(bytes, 'word/document.xml'))
    expect(document).toContain('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>')
    expect(document).toContain('<w:numPr><w:ilvl w:val="1"/><w:numId w:val="3"/></w:numPr>')

    const numbering = latin1(readZipEntry(bytes, 'word/numbering.xml'))
    // All abstractNum elements precede all num elements (OOXML schema order).
    expect(numbering.indexOf('<w:abstractNum')).toBeLessThan(numbering.indexOf('<w:num '))
    expect(numbering).toContain('<w:numFmt w:val="bullet"/>')
  })

  it('renders tables with borders and bold header rows', () => {
    const bytes = exportDocx(
      buildHtml('<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>'),
      't'
    )
    const document = latin1(readZipEntry(bytes, 'word/document.xml'))
    expect(document).toContain('<w:tbl>')
    expect(document).toContain('<w:tblBorders>')
    expect(document).toContain('<w:b/>')
  })

  it('embeds data-URI images and drops local-path images (v1 limitation)', () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const bytes = exportDocx(
      buildHtml(`<p><img src="${png}">kept</p><p><img src="./local.png">dropped</p>`),
      't'
    )

    const names = listZipEntryNames(bytes)
    expect(names).toContain('word/media/image1.png')

    const document = latin1(readZipEntry(bytes, 'word/document.xml'))
    expect(document).toContain('<a:blip r:embed=')
    expect(document).toContain('<w:t xml:space="preserve">kept</w:t>')
    expect(document).toContain('<w:t xml:space="preserve">dropped</w:t>')

    const contentTypes = latin1(readZipEntry(bytes, '[Content_Types].xml'))
    expect(contentTypes).toContain('<Default Extension="png" ContentType="image/png"/>')
  })

  it('preserves line breaks in pre blocks as compact mono paragraphs', () => {
    const bytes = exportDocx(buildHtml('<pre><code>const a = 1\nconst b = 2</code></pre>'), 't')
    const document = latin1(readZipEntry(bytes, 'word/document.xml'))
    expect(document.match(/w:ascii="Courier New"/g)?.length).toBeGreaterThanOrEqual(2)
    expect(document).toContain('w:before="0" w:after="0"')
  })

  it('skips script/style wrappers and never emits them as content', () => {
    const bytes = exportDocx(
      buildHtml('<p>fine</p><script>alert(1)</script><style>.x{}</style>'),
      't'
    )
    const document = latin1(readZipEntry(bytes, 'word/document.xml'))
    expect(document).not.toContain('alert(1)')
    expect(document).toContain('fine')
  })
})
