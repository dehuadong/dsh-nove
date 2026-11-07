#!/usr/bin/env node
/**
 * Capability-level note lifecycle: verified capabilities need an implemented
 * Note and must not still carry a proposed one.
 */
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NOTES = join(ROOT, '.agents', 'notes')
const errors = []

function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')
}

function topics(lifecycle) {
  const found = new Map()
  const dir = join(NOTES, lifecycle)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const nested of readdirSync(join(dir, entry.name), { withFileTypes: true })) {
      if (!nested.isFile() || !nested.name.endsWith('.md')) continue
      const topic = normalize(nested.name.replace(/^\d{4}-\d{2}-\d{2}-/u, '').replace(/\.md$/u, '').replace(/-implemented$/u, ''))
      const list = found.get(topic) ?? []
      list.push(join(lifecycle, entry.name, nested.name))
      found.set(topic, list)
    }
  }
  return found
}

const implemented = topics('implemented')
const proposed = topics('proposed')
const capabilities = YAML.parse(await import('node:fs').then(fs => fs.readFileSync(join(ROOT, 'capabilities.yaml'), 'utf8'))).capabilities

for (const capability of capabilities) {
  if (capability.status !== 'verified') continue
  const topic = normalize(capability.id)
  if (!implemented.has(topic)) errors.push(`${capability.id}: verified 但没有 implemented topic ${topic}`)
  if (proposed.has(topic)) errors.push(`${capability.id}: verified 仍保留 proposed Note ${proposed.get(topic).join(', ')}`)
}

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL ${error}`)
  process.exit(1)
}
console.log(`ok: ${capabilities.filter(capability => capability.status === 'verified').length} verified capabilities have implemented notes`)
