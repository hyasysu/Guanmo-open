import fs from 'node:fs'
import path from 'node:path'

function collectSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(target)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : []
  })
}

const violations = []
for (const file of collectSourceFiles(path.resolve('src'))) {
  const source = fs.readFileSync(file, 'utf8')
  const relative = path.relative(process.cwd(), file)
  if (/use[A-Za-z0-9]+Store\.setState\s*\(/.test(source)) {
    violations.push(`${relative}: direct Store.setState`)
  }
  if (
    relative.startsWith(`src${path.sep}stores${path.sep}`)
    && /import\s+\{?\s*use[A-Za-z0-9]+Store[^'"\n]*from\s+['"]/.test(source)
  ) {
    violations.push(`${relative}: store imports another store`)
  }
}

if (violations.length > 0) {
  throw new Error(`Store boundary violations:\n${violations.join('\n')}`)
}

console.log('store boundary checks passed')
