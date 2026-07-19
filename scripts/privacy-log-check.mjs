import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const SOURCE_ROOT = path.resolve('src')
const LOG_METHODS = new Set([
  'debug',
  'error',
  'group',
  'groupCollapsed',
  'info',
  'log',
  'table',
  'trace',
  'warn',
])
const SENSITIVE_NAMES = new Set([
  'content',
  'contextSummary',
  'fileContent',
  'filePath',
  'preview',
  'previewContent',
  'prompt',
  'selectedText',
  'selectionPreview',
  'selectionText',
  'systemPrompt',
  'userPrompt',
])

function collectSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(target)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : []
  })
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text
  return undefined
}

function findSensitiveReference(node) {
  if (
    ts.isPropertyAccessExpression(node)
    && node.name.text === 'length'
    && ts.isPropertyAccessExpression(node.expression)
    && SENSITIVE_NAMES.has(node.expression.name.text)
  ) {
    return undefined
  }
  if (ts.isIdentifier(node) && SENSITIVE_NAMES.has(node.text)) return node.text
  if (ts.isPropertyAccessExpression(node) && SENSITIVE_NAMES.has(node.name.text)) return node.name.text
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) {
    if (SENSITIVE_NAMES.has(node.argumentExpression.text)) return node.argumentExpression.text
  }
  if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
    const name = propertyName(node.name)
    if (name && SENSITIVE_NAMES.has(name)) return name
  }

  let found
  ts.forEachChild(node, (child) => {
    if (!found) found = findSensitiveReference(child)
  })
  return found
}

const violations = []
for (const file of collectSourceFiles(SOURCE_ROOT)) {
  const sourceText = fs.readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'console'
      && LOG_METHODS.has(node.expression.name.text)
    ) {
      for (const argument of node.arguments) {
        const sensitiveName = findSensitiveReference(argument)
        if (!sensitiveName) continue
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(argument.getStart(sourceFile))
        violations.push(`${path.relative(process.cwd(), file)}:${line + 1}:${character + 1} logs ${sensitiveName}`)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

if (violations.length > 0) {
  throw new Error(`Sensitive values must not be passed to console calls:\n${violations.join('\n')}`)
}

console.log('privacy log checks passed')
