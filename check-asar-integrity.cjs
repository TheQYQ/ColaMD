const asar = require('@electron/asar')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const asarPath = process.argv[2] || path.join(__dirname, 'dist/win-unpacked/resources/app.asar')
const { headerSize, header } = asar.getRawHeader(asarPath)
const buf = fs.readFileSync(asarPath)
const base = 8 + headerSize

let total = 0
const bad = []
function walk (node, prefix) {
  for (const [name, child] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + '\\' + name : name
    if (child.files) { walk(child, p); continue }
    if (child.offset === undefined || child.size === 0) continue
    total++
    const off = base + parseInt(child.offset)
    const data = buf.slice(off, off + child.size)
    let ok = true
    if (child.integrity) {
      const h = crypto.createHash('sha256').update(data).digest('hex')
      ok = h === child.integrity.hash
    }
    if (!ok) bad.push(p)
  }
}
walk(header, '')
console.log('total files:', total)
console.log('integrity mismatches:', bad.length)
console.log(bad.slice(0, 20))
