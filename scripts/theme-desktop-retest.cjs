const puppeteer = require('puppeteer-core')
const fs = require('fs')
const path = require('path')

const shotDir = path.join(process.cwd(), 'screenshots-theme-desktop')
fs.mkdirSync(shotDir, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null,
  })
  const pages = await browser.pages()
  let page = pages.find((p) => /localhost:1420|tauri|guanmo/i.test(p.url())) || pages[0]
  if (!page) throw new Error('no page')
  console.log('PAGE', page.url())
  await wait(1500)

  // clear theme-related settings for clean baseline
  await page.evaluate(() => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (/setting|appearance|theme|guanmo/i.test(key)) localStorage.removeItem(key)
      }
    } catch {}
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await wait(2500)

  const info = await page.evaluate(() => ({
    title: document.title,
    theme: document.documentElement.dataset.theme,
    lightPalette: document.documentElement.dataset.lightPalette,
    buttons: Array.from(document.querySelectorAll('button')).map((b) => b.getAttribute('title') || '').filter(Boolean).slice(0, 20),
    isTauri: !!(window.__TAURI_INTERNALS__ || window.__TAURI__),
  }))
  console.log('INFO', JSON.stringify(info, null, 2))

  async function shot(name) {
    const file = path.join(shotDir, name)
    await page.screenshot({ path: file, fullPage: false })
    console.log('SHOT', file, fs.statSync(file).size)
  }

  async function clickTitleIncludes(text) {
    const ok = await page.evaluate((needle) => {
      const btn = Array.from(document.querySelectorAll('button')).find((el) =>
        (el.getAttribute('title') || '').includes(needle),
      )
      if (!btn) return false
      btn.click()
      return true
    }, text)
    if (!ok) throw new Error('button not found: ' + text)
  }

  async function ensureMenuOpen() {
    const open = await page.$('[role="menu"][aria-label="\u9009\u62e9\u4e3b\u9898"]')
    if (!open) {
      await clickTitleIncludes('\u5207\u6362\u4e3b\u9898')
      await wait(400)
    }
  }

  async function pickByLabel(label) {
    await ensureMenuOpen()
    const ok = await page.evaluate((needle) => {
      const menu = document.querySelector('[role="menu"][aria-label="\u9009\u62e9\u4e3b\u9898"]')
      if (!menu) return false
      const btn = Array.from(menu.querySelectorAll('button[role="menuitemradio"]')).find((el) =>
        (el.textContent || '').includes(needle),
      )
      if (!btn) return false
      btn.click()
      return true
    }, label)
    if (!ok) throw new Error('option not found: ' + label)
    await wait(800)
    const state = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      lightPalette: document.documentElement.dataset.lightPalette,
    }))
    console.log('AFTER', label, JSON.stringify(state))
    return state
  }

  await shot('01-default.png')

  await clickTitleIncludes('\u5207\u6362\u4e3b\u9898')
  await wait(400)
  await shot('02-menu-open.png')

  await pickByLabel('\u6d45\u8272')
  await shot('03-plain.png')

  await pickByLabel('GitHub')
  await shot('04-github.png')

  await pickByLabel('\u6df1\u8272')
  await shot('05-dark.png')

  await ensureMenuOpen()
  await wait(350)
  await shot('06-menu-dark.png')

  await pickByLabel('\u6696\u8272')
  await shot('07-warm.png')

  // sun/moon quick toggle
  await clickTitleIncludes('\u5207\u6362\u4e3a\u6df1\u8272\u6a21\u5f0f')
  await wait(600)
  await shot('08-toggle-dark.png')
  const afterDark = await page.evaluate(() => document.documentElement.dataset.theme)

  await clickTitleIncludes('\u5207\u6362\u4e3a\u6d45\u8272\u6a21\u5f0f')
  await wait(600)
  await shot('09-toggle-light.png')
  const afterLight = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    lightPalette: document.documentElement.dataset.lightPalette,
  }))

  console.log('TOGGLE', afterDark, JSON.stringify(afterLight))
  console.log('PASS desktop theme retest complete')
  browser.disconnect()
}

main().catch((err) => {
  console.error('FAIL', err)
  process.exit(1)
})
