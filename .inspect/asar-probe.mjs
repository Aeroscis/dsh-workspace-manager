import fs from 'node:fs'

const asar = 'C:/Program Files/DSH NEXT/resources/app.asar'
const fd = fs.openSync(asar, 'r')
const head = Buffer.alloc(8)
fs.readSync(fd, head, 0, 8, 0)
const pickleSize = head.readUInt32LE(4)
const headerBuf = Buffer.alloc(pickleSize)
fs.readSync(fd, headerBuf, 0, pickleSize, 8)
const jsonLen = headerBuf.readUInt32LE(4)
const json = JSON.parse(headerBuf.subarray(8, 8 + jsonLen).toString('utf8'))
const base = Math.ceil((8 + pickleSize) / 4) * 4

const hits = []
const walk = (node, path) => {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const full = path ? `${path}/${name}` : name
    if (child.files) walk(child, full)
    else hits.push({ path: full, size: child.size, offset: Number(child.offset) })
  }
}
walk(json, '')

const patterns = process.argv.slice(2)
const matched = patterns.length
  ? hits.filter((entry) => patterns.some((p) => entry.path.toLowerCase().includes(p.toLowerCase())))
  : hits
console.log(`total files: ${hits.length}, matched: ${matched.length}`)
for (const entry of matched.slice(0, 400)) console.log(`${entry.size}\t${entry.path}`)

const outDir = process.env.OUT_DIR
if (outDir) {
  fs.mkdirSync(outDir, { recursive: true })
  for (const entry of matched) {
    const outPath = `${outDir}/${entry.path.replaceAll('/', '__')}`
    const buf = Buffer.alloc(entry.size)
    fs.readSync(fd, buf, 0, entry.size, base + entry.offset)
    fs.writeFileSync(outPath, buf)
  }
  console.log(`extracted ${matched.length} files to ${outDir}`)
}
fs.closeSync(fd)
