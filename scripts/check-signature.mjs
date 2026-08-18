/**
 * Minimal Authenticode presence check for Windows PE executables.
 *
 * Does not verify the trust chain (that requires signtool / Get-AuthenticodeSignature),
 * but reports whether a PE binary carries a certificate table entry — i.e. whether it
 * was signed at all. Unsigned builds trigger SmartScreen; this lets a maintainer or CI
 * confirm a binary is signed before shipping.
 *
 * Usage:
 *   node scripts/check-signature.mjs path/to/my-dsh-Setup-*.exe [more.exe ...]
 */
import { readFileSync } from 'node:fs'

function hasAuthenticodeTable(filePath) {
  const buf = readFileSync(filePath)
  if (buf.length < 0x40) return false
  const peOffset = buf.readUInt32LE(0x3c)
  if (peOffset + 24 > buf.length) return false
  if (buf.toString('latin1', peOffset, peOffset + 4) !== 'PE\0\0') return false

  const coffOffset = peOffset + 4
  const magic = buf.readUInt16LE(coffOffset + 24)
  const isPe32Plus = magic === 0x20b
  const optionalStart = coffOffset + 20
  // Data directories start after the fixed optional-header fields.
  const dataDirStart = optionalStart + (isPe32Plus ? 112 : 96)
  const certEntry = dataDirStart + 4 * 8 // index 4 = certificate table
  if (certEntry + 8 > buf.length) return false
  const certAddr = buf.readUInt32LE(certEntry)
  const certSize = buf.readUInt32LE(certEntry + 4)
  return certAddr > 0 && certSize > 0
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node scripts/check-signature.mjs <exe...>')
  process.exit(2)
}

let failed = false
for (const file of files) {
  try {
    const signed = hasAuthenticodeTable(file)
    console.log(`${signed ? 'SIGNED  ' : 'UNSIGNED'} ${file}`)
    if (!signed) failed = true
  } catch (error) {
    console.error(`ERROR ${file}: ${error instanceof Error ? error.message : error}`)
    failed = true
  }
}
process.exit(failed ? 1 : 0)
