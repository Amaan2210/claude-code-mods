// Works out which named functions / exported names an edit changes.
// Pure text work: no `$`, so it is tested on its own. It reads source the way
// a quick scan can (declaration lines and bracket matching), not a parser.

export type Decl = {
  name: string
  /** Offset of the start of the declaration's line. */
  start: number
  indent: number
  isExported: boolean
  isMember: boolean
}

export const CODE_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'py', 'go', 'rs',
  'java', 'kt', 'swift', 'rb', 'php', 'cs', 'c', 'cc', 'cpp', 'h', 'hpp',
  'scala', 'dart', 'lua', 'vue', 'svelte',
]
const JS_FAMILY = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte']

// Names so common that "used in N places" would mean nothing.
const COMMON = new Set([
  'main', 'init', 'run', 'get', 'set', 'add', 'map', 'test', 'setup', 'start',
  'stop', 'render', 'update', 'handler', 'default', 'index', 'name', 'data',
  'value', 'type', 'item', 'items', 'list', 'file', 'path', 'node', 'args',
  'options', 'config', 'props', 'state', 'result', 'error', 'close', 'open',
  'read', 'write', 'load', 'save', 'build', 'parse', 'format', 'create',
  'delete', 'remove', 'reset', 'clear', 'next', 'then', 'call', 'apply',
  'constructor', 'toString', 'equals', 'hash', 'size', 'length', 'copy',
  'describe', 'expect', 'handle', 'process', 'execute', 'helper', 'util',
])
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'function', 'do',
  'try', 'await', 'new', 'typeof', 'super', 'with', 'when', 'match', 'fn',
  'func', 'def', 'class', 'import', 'export', 'delete', 'void', 'throw',
])

const MODS =
  '(?:(?:export|default|pub|public|private|protected|static|async|abstract|final|override|open|internal|unsafe|extern|inline|suspend|declare|readonly)(?:\\([^)]*\\))?\\s+)*'
const ID = '[A-Za-z_$][\\w$]*'
const RX_FUNC = new RegExp(`^(\\s*)(${MODS})(?:function|def|fn|func|fun)\\b\\s*\\*?\\s*(?:\\([^)]*\\)\\s*)?(${ID})`)
const RX_TYPE = new RegExp(`^(\\s*)(${MODS})(?:class|interface|enum|struct|trait|object|type)\\b\\s+(${ID})`)
const RX_FUNC_CONST = new RegExp(
  `^(\\s*)(${MODS})(?:const|let|var)\\s+(${ID})\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*(?::\\s*[^=]+)?=>|${ID}\\s*=>)`,
)
const RX_EXPORT_CONST = new RegExp(`^(\\s*)(export\\s+(?:declare\\s+)?)(?:const|let|var)\\s+(${ID})`)
const RX_METHOD = new RegExp(
  `^(\\s+)((?:(?:public|private|protected|static|async|override|abstract|readonly|get|set)\\s+)*)(${ID})\\s*(?:<[^>]*>)?\\s*\\([^;]*\\)\\s*(?::\\s*[^{;=]+)?\\s*\\{\\s*$`,
)

export function extensionOf(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path)

  return m ? m[1]!.toLowerCase() : ''
}

export function isCodeFile(path: string): boolean {
  return CODE_EXTENSIONS.includes(extensionOf(path))
}

/** The declaration on one line, or undefined. */
export function declOfLine(line: string): Omit<Decl, 'start'> | undefined {
  let m = RX_FUNC.exec(line) ?? RX_TYPE.exec(line) ?? RX_FUNC_CONST.exec(line) ?? RX_EXPORT_CONST.exec(line)
  if (m) {
    const mods = m[2] ?? ''

    return {
      name: m[3]!,
      indent: m[1]!.length,
      isExported: /\b(export|pub|public)\b/.test(mods),
      isMember: false,
    }
  }
  m = RX_METHOD.exec(line)
  if (m && !KEYWORDS.has(m[3]!)) {
    return { name: m[3]!, indent: m[1]!.length, isExported: true, isMember: true }
  }

  return undefined
}

export function scanDecls(text: string): Decl[] {
  const out: Decl[] = []
  let offset = 0
  for (const line of text.split('\n')) {
    const d = declOfLine(line)
    if (d) out.push({ ...d, start: offset })
    offset += line.length + 1
  }

  return out
}

/** Offset just past a declaration's body. */
export function scopeEnd(text: string, d: Decl, ext: string): number {
  if (ext === 'py' || ext === 'rb') {
    let offset = d.start
    let first = true
    for (const line of text.slice(d.start).split('\n')) {
      if (!first && line.trim() !== '') {
        const indent = line.length - line.trimStart().length
        if (indent <= d.indent && !(ext === 'rb' && line.trim() === 'end')) return offset
        if (ext === 'rb' && indent === d.indent && line.trim() === 'end') return offset + line.length
      }
      first = false
      offset += line.length + 1
    }

    return text.length
  }
  let depth = 0
  let sawBrace = false
  let i = d.start
  let quote = ''
  const firstEol = text.indexOf('\n', d.start)
  while (i < text.length) {
    const c = text[i]!
    if (quote) {
      if (c === '\\') i += 1
      else if (c === quote) quote = ''
    } else if (c === '/' && text[i + 1] === '/') {
      const eol = text.indexOf('\n', i)
      i = eol < 0 ? text.length : eol
      continue
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      i = close < 0 ? text.length : close + 2
      continue
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c
    } else if (c === '{' || c === '(' || c === '[') {
      depth += 1
      if (c === '{') sawBrace = true
    } else if (c === '}' || c === ')' || c === ']') {
      depth -= 1
      if (c === '}' && sawBrace && depth <= 0) return i + 1
    } else if (c === '\n' && !sawBrace && depth <= 0 && i >= (firstEol < 0 ? text.length : firstEol)) {
      // A declaration with no braces (an arrow expression, a type alias)
      // ends with its line unless the line ends mid-expression.
      const before = text.slice(d.start, i).trimEnd()
      if (!/(=>|=|,|\(|\+|&&|\|\||\?|:|\|)$/.test(before)) return i
    }
    i += 1
  }

  return text.length
}

function isVisible(d: Decl, text: string, ext: string): boolean {
  if (JS_FAMILY.includes(ext)) {
    if (d.isExported || d.isMember) return true
    const re = new RegExp(`(?:export\\s*\\{[^}]*\\b${d.name.replace(/\$/g, '\\$')}\\b|exports\\.${d.name.replace(/\$/g, '\\$')}\\b|module\\.exports)`)

    return re.test(text)
  }
  if (ext === 'py') return !d.name.startsWith('_') || d.name.startsWith('__')

  return true
}

export function isUsableName(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name) && name.length >= 4 && !COMMON.has(name) && !KEYWORDS.has(name)
}

/** The innermost declaration that holds the offset, if any. */
function enclosing(text: string, decls: Decl[], at: number, ext: string): Decl | undefined {
  let tried = 0
  for (let i = decls.length - 1; i >= 0 && tried < 80; i -= 1) {
    const d = decls[i]!
    if (d.start > at) continue
    tried += 1
    if (at < scopeEnd(text, d, ext)) return d
  }

  return undefined
}

export type EditPart = { old: string; new: string }

function keep(list: Decl[], text: string, ext: string): string[] {
  const names: string[] = []
  for (const d of list) {
    if (isUsableName(d.name) && isVisible(d, text, ext) && !names.includes(d.name)) names.push(d.name)
  }

  return names
}

/**
 * The names an edit changes, from the file as it was before the edit:
 * declarations whose lines the edit touches, and the declaration around it.
 * Names the edit only adds have no users yet and are left out.
 */
export function namesChangedByEdit(path: string, before: string, edits: readonly EditPart[]): string[] {
  const ext = extensionOf(path)
  if (!before) return []
  const decls = scanDecls(before)
  const hit: Decl[] = []
  for (const edit of edits) {
    if (!edit.old) continue
    const at = before.indexOf(edit.old)
    if (at < 0) continue
    const end = at + edit.old.length
    for (const d of decls) if (d.start >= at && d.start < end) hit.push(d)
    const around = enclosing(before, decls, at, ext)
    if (around) hit.push(around)
  }

  return keep(hit, before, ext)
}

/**
 * The names a whole-file write changes: declared before, and either gone or
 * with a different body after. A new file changes nothing anyone uses yet.
 */
export function namesChangedByWrite(path: string, before: string, after: string): string[] {
  const ext = extensionOf(path)
  if (!before || before === after) return []
  const bodies = (text: string) => {
    const map = new Map<string, string>()
    for (const d of scanDecls(text)) map.set(d.name, text.slice(d.start, scopeEnd(text, d, ext)))

    return map
  }
  const was = bodies(before)
  const now = bodies(after)
  const hit: Decl[] = []
  for (const d of scanDecls(before)) {
    if (was.get(d.name) !== now.get(d.name)) hit.push(d)
  }

  return keep(hit, before, ext)
}
