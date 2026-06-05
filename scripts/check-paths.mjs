#!/usr/bin/env node

/**
 * 资源路径检查脚本
 * 检查项目中可能存在的相对路径引用，避免开发版与 exe 差异问题
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'

const SRC_DIR = 'src'
const CHECK_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.css', '.less']
const IGNORE_DIRS = ['node_modules', 'dist', '.git', 'vendor']

// 相对路径模式
const RELATIVE_PATH_PATTERNS = [
  /['"]\.\/[^'"]*\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)['"]/gi,
  /['"]\.\.\/[^'"]*\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)['"]/gi,
  /url\(\s*['"]?\.\//gi,
]

// 需要检查的文件类型
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico']
const FONT_EXTENSIONS = ['.woff', '.woff2', '.ttf', '.eot']

let warnings = []
let errors = []

function getAllFiles(dir, files = []) {
  const entries = readdirSync(dir)

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      if (!IGNORE_DIRS.includes(entry)) {
        getAllFiles(fullPath, files)
      }
    } else {
      const ext = extname(entry)
      if (CHECK_EXTENSIONS.includes(ext)) {
        files.push(fullPath)
      }
    }
  }

  return files
}

function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf8')
  const lines = content.split('\n')

  lines.forEach((line, index) => {
    const lineNum = index + 1

    // 检查相对路径引用
    RELATIVE_PATH_PATTERNS.forEach(pattern => {
      const matches = line.match(pattern)
      if (matches) {
        matches.forEach(match => {
          // 排除 import 语句中的相对路径（这是正常的）
          if (line.trim().startsWith('import ') || line.trim().startsWith('from ')) {
            return
          }

          warnings.push({
            file: filePath,
            line: lineNum,
            message: `发现相对路径引用: ${match}`,
            suggestion: '建议使用绝对路径（以 / 开头）或 Vite 资源导入'
          })
        })
      }
    })

    // 检查可能的资源加载问题
    if (line.includes('?inline') && !line.includes('import')) {
      warnings.push({
        file: filePath,
        line: lineNum,
        message: '发现 ?inline 标记，但不是 import 语句',
        suggestion: '确保资源导入方式正确'
      })
    }
  })
}

function main() {
  console.log('🔍 检查资源路径引用...\n')

  const files = getAllFiles(SRC_DIR)
  console.log(`📁 扫描 ${files.length} 个文件\n`)

  files.forEach(checkFile)

  // 输出结果
  if (warnings.length > 0) {
    console.log(`⚠️  发现 ${warnings.length} 个警告:\n`)
    warnings.forEach(w => {
      console.log(`  📄 ${w.file}:${w.line}`)
      console.log(`     ${w.message}`)
      console.log(`     💡 ${w.suggestion}\n`)
    })
  }

  if (errors.length > 0) {
    console.log(`❌ 发现 ${errors.length} 个错误:\n`)
    errors.forEach(e => {
      console.log(`  📄 ${e.file}:${e.line}`)
      console.log(`     ${e.message}\n`)
    })
  }

  if (warnings.length === 0 && errors.length === 0) {
    console.log('✅ 未发现路径问题！')
  }

  // 返回退出码
  if (errors.length > 0) {
    process.exit(1)
  }
}

main()
