#!/usr/bin/env node
/**
 * i18n integrity check — makes the "every t() key resolves in both catalogs" claim real.
 *
 * Two checks, both fail the process (exit 1) on any problem:
 *   1. STRUCTURAL PARITY — messages/en.json and messages/fr.json must have the exact
 *      same set of `namespace.key` pairs. A key added to one catalog but not the other
 *      renders as its dotted fallback path in the missing locale (see i18n-provider).
 *   2. USAGE RESOLUTION — every static `t("key")` call whose `t` came from a
 *      `const t = useT("ns")` in the same file must resolve to a real `ns.key` in the
 *      catalogs. Catches typos and renamed/removed keys. Dynamic calls (template
 *      literals, variables) are skipped and counted, not flagged.
 *
 * The catalog is two levels deep: messages[namespace][key] = string (see i18n-provider).
 *
 * Run: `node scripts/check-i18n.mjs` (wired as `pnpm check:i18n`).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))

const en = read('messages/en.json')
const fr = read('messages/fr.json')

/** Flatten a 2-level catalog to a Set of "namespace.key". Records non-string leaves as errors. */
function flatten(catalog, label, problems) {
  const keys = new Set()
  for (const [ns, val] of Object.entries(catalog)) {
    if (!val || typeof val !== 'object' || Array.isArray(val)) {
      problems.push(`${label}: namespace "${ns}" is not an object of strings`)
      continue
    }
    for (const [k, v] of Object.entries(val)) {
      if (typeof v !== 'string') {
        problems.push(`${label}: "${ns}.${k}" is not a string (nested values are unreachable by t())`)
        continue
      }
      keys.add(`${ns}.${k}`)
    }
  }
  return keys
}

const problems = []
const enKeys = flatten(en, 'en.json', problems)
const frKeys = flatten(fr, 'fr.json', problems)

// --- Check 1: structural parity ---
const enOnly = [...enKeys].filter((k) => !frKeys.has(k)).sort()
const frOnly = [...frKeys].filter((k) => !enKeys.has(k)).sort()
if (enOnly.length) problems.push(`In en.json but missing from fr.json (${enOnly.length}):\n    ${enOnly.join('\n    ')}`)
if (frOnly.length) problems.push(`In fr.json but missing from en.json (${frOnly.length}):\n    ${frOnly.join('\n    ')}`)

// --- Check 2: usage resolution ---
const SRC_DIRS = ['app', 'components', 'lib', 'hooks']
const exts = new Set(['.ts', '.tsx'])

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      walk(full, out)
    } else if (exts.has(path.extname(entry.name))) {
      out.push(full)
    }
  }
}

const files = []
for (const d of SRC_DIRS) {
  const abs = path.join(root, d)
  if (fs.existsSync(abs)) walk(abs, files)
}

// A key exists if EITHER catalog has it (parity is checked separately; here we only
// care that the call resolves to a defined string rather than a dotted fallback).
const knownKeys = new Set([...enKeys, ...frKeys])

const declRe = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*useT\(\s*["'`]([^"'`]+)["'`]\s*\)/g
let dynamicSkipped = 0
const dangling = []

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  if (!src.includes('useT(')) continue

  // Map translator variable -> namespace (usually `const t = useT("ns")`).
  const varToNs = new Map()
  for (const m of src.matchAll(declRe)) varToNs.set(m[1], m[2])
  if (varToNs.size === 0) continue

  for (const [varName, ns] of varToNs) {
    // Match `<varName>("literal"` — the first string-literal arg is the key.
    const callRe = new RegExp(`\\b${varName}\\(\\s*(["'\`])([^"'\`]+)\\1`, 'g')
    // Also count dynamic calls `<varName>(` not followed by a string literal.
    const dynRe = new RegExp(`\\b${varName}\\(\\s*[^"'\`\\s)]`, 'g')
    for (const m of src.matchAll(callRe)) {
      const key = `${ns}.${m[2]}`
      if (!knownKeys.has(key)) dangling.push(`${path.relative(root, file)}: t("${m[2]}") → "${key}" not in catalogs`)
    }
    for (const _ of src.matchAll(dynRe)) dynamicSkipped++
  }
}

if (dangling.length) problems.push(`Dangling t() keys (${dangling.length}):\n    ${dangling.join('\n    ')}`)

// --- Report ---
console.log(`i18n check: ${enKeys.size} en keys, ${frKeys.size} fr keys, ${files.length} source files scanned, ${dynamicSkipped} dynamic t() calls skipped.`)
if (problems.length) {
  console.error(`\n✖ i18n check failed (${problems.length} problem${problems.length > 1 ? 's' : ''}):\n`)
  for (const p of problems) console.error('  • ' + p + '\n')
  process.exit(1)
}
console.log('✓ en/fr catalogs are in parity and every static t() key resolves.')
