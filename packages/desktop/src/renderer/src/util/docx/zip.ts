/**
 * Minimal STORE-only ZIP writer for building .docx (OOXML) packages in the
 * renderer, with zero dependencies (M4.2).
 *
 * A .docx is a ZIP of XML parts. ZIP permits STORED (uncompressed) entries,
 * so no inflate/deflate implementation is needed — Word/LibreOffice open
 * uncompressed packages fine, and our exports are text-dominated where
 * compression matters little.
 *
 * Layout written (little-endian per the ZIP spec):
 *   local file header  + data      (per entry, in order)
 *   central directory header      (per entry)
 *   end of central directory record
 */

const CRC32_TABLE = buildCrc32Table()

function buildCrc32Table(): Uint32Array {
  // IEEE 802.3 CRC-32 (the ZIP polynomial 0xEDB88320, reflected).
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
}

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c = CRC32_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  /** Part name inside the archive, e.g. `word/document.xml` (no leading slash). */
  name: string
  data: Uint8Array
}

function dosDateTime(date: Date): { time: number; date: number } {
  // ZIP stores local DOS time; 2-second granularity for time, 1s for date.
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f)
  const dateVal = ((Math.max(0, date.getFullYear() - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: dateVal }
}

class ByteWriter {
  private readonly chunks: Uint8Array[] = []
  private length = 0

  u16(value: number): void {
    this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]))
  }

  u32(value: number): void {
    this.push(
      new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])
    )
  }

  bytes(data: Uint8Array): void {
    this.push(data)
  }

  get offset(): number {
    return this.length
  }

  private push(b: Uint8Array): void {
    this.chunks.push(b)
    this.length += b.length
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.length)
    let offset = 0
    for (const chunk of this.chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }
}

/** Encode a part name as the single-byte (CP437/ASCII) ZIP filename field. */
function nameBytes(name: string): Uint8Array {
  const out = new Uint8Array(name.length)
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    if (code > 0xff) throw new Error(`zip: non-ASCII entry name not supported: ${name}`)
    out[i] = code
  }
  return out
}

/**
 * Build a STORE-only ZIP archive from the given parts.
 * Entry order is preserved; names must be unique and ASCII.
 */
export function createZip(entries: ZipEntry[], timestamp: Date = new Date()): Uint8Array {
  const out = new ByteWriter()
  const { time, date } = dosDateTime(timestamp)
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = []

  for (const entry of entries) {
    const name = nameBytes(entry.name)
    const crc = crc32(entry.data)
    const offset = out.offset

    // Local file header: signature, versions, flags, method(0=store),
    // timestamps, CRC, sizes, name length, extra length (0), name, data.
    out.u32(0x04034b50)
    out.u16(20) // version needed
    out.u16(0) // flags
    out.u16(0) // method: store
    out.u16(time)
    out.u16(date)
    out.u32(crc)
    out.u32(entry.data.length) // compressed
    out.u32(entry.data.length) // uncompressed
    out.u16(name.length)
    out.u16(0) // extra field length
    out.bytes(name)
    out.bytes(entry.data)

    central.push({ name, crc, size: entry.data.length, offset })
  }

  const centralStart = out.offset
  for (const entry of central) {
    out.u32(0x02014b50)
    out.u16(20) // version made by
    out.u16(20) // version needed
    out.u16(0) // flags
    out.u16(0) // method: store
    out.u16(time)
    out.u16(date)
    out.u32(entry.crc)
    out.u32(entry.size)
    out.u32(entry.size)
    out.u16(entry.name.length)
    out.u16(0) // extra
    out.u16(0) // comment
    out.u16(0) // disk number
    out.u16(0) // internal attrs
    out.u32(0) // external attrs
    out.u32(entry.offset)
    out.bytes(entry.name)
  }
  const centralSize = out.offset - centralStart

  // End of central directory.
  out.u32(0x06054b50)
  out.u16(0) // disk number
  out.u16(0) // central dir disk
  out.u16(central.length)
  out.u16(central.length)
  out.u32(centralSize)
  out.u32(centralStart)
  out.u16(0) // comment length

  return out.toUint8Array()
}

// -- Test-only helpers -------------------------------------------------------

function findEocd(data: Uint8Array): number {
  for (let i = data.length - 22; i >= 0; i--) {
    const sig =
      (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)) >>> 0
    if (sig === 0x06054b50) return i
  }
  throw new Error('zip: end of central directory not found')
}

/** List entry names by walking the central directory (unit-test helper). */
export function listZipEntryNames(data: Uint8Array): string[] {
  const eocd = findEocd(data)
  const count = data[eocd + 10] | (data[eocd + 11] << 8)
  let offset =
    data[eocd + 16] | (data[eocd + 17] << 8) | (data[eocd + 18] << 16) | (data[eocd + 19] << 24)
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    const sig =
      (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
    if (sig !== 0x02014b50) throw new Error('zip: bad central directory entry')
    const nameLen = data[offset + 28] | (data[offset + 29] << 8)
    const extraLen = data[offset + 30] | (data[offset + 31] << 8)
    const commentLen = data[offset + 32] | (data[offset + 33] << 8)
    names.push(new TextDecoder().decode(data.subarray(offset + 46, offset + 46 + nameLen)))
    offset += 46 + nameLen + extraLen + commentLen
  }
  return names
}

/** Extract one STORED entry's bytes via its central directory record (tests). */
export function readZipEntry(data: Uint8Array, entryName: string): Uint8Array {
  const eocd = findEocd(data)
  const count = data[eocd + 10] | (data[eocd + 11] << 8)
  let offset =
    data[eocd + 16] | (data[eocd + 17] << 8) | (data[eocd + 18] << 16) | (data[eocd + 19] << 24)
  for (let i = 0; i < count; i++) {
    const nameLen = data[offset + 28] | (data[offset + 29] << 8)
    const extraLen = data[offset + 30] | (data[offset + 31] << 8)
    const commentLen = data[offset + 32] | (data[offset + 33] << 8)
    const name = new TextDecoder().decode(data.subarray(offset + 46, offset + 46 + nameLen))
    if (name === entryName) {
      const localOffset =
        data[offset + 42] |
        (data[offset + 43] << 8) |
        (data[offset + 44] << 16) |
        (data[offset + 45] << 24)
      const size =
        data[offset + 24] |
        (data[offset + 25] << 8) |
        (data[offset + 26] << 16) |
        (data[offset + 27] << 24)
      const localNameLen = data[localOffset + 26] | (data[localOffset + 27] << 8)
      const localExtraLen = data[localOffset + 28] | (data[localOffset + 29] << 8)
      const dataStart = localOffset + 30 + localNameLen + localExtraLen
      return data.subarray(dataStart, dataStart + size)
    }
    offset += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`zip: entry not found: ${entryName}`)
}
