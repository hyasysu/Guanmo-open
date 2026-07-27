const puppeteer = require('puppeteer-core')
const path = require('path')
const fs = require('fs')

const shotDir = process.argv[2] || path.join(process.cwd(), 'screenshots-theme')
fs.mkdirSync(shotDir, { recursive: true })

const chromePath =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  })

  const page = await browser.newPage()
  page.setDefaultTimeout(25000)

  await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle0' })
  await page.evaluate(() => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (/setting|appearance|theme|guanmo/i.test(key)) {
          localStorage.removeItem(key)
        }
      }
    } catch {}
  })
  await page.reload({ waitUntil: 'networkidle0' })
  await wait(1500)

  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('button')).some((btn) =>
      (btn.getAttribute('title') || '').includes('\u5207\u6362\u4e3b\u9898'),
    )
  })

  const shots = []
  async function shot(name) {
    const file = path.join(shotDir, name)
    await page.screenshot({ path: file, fullPage: false })
    shots.push(file)
    console.log('SHOT', file)
  }

  async function clickTitleIncludes(text) {
    const clicked = await page.evaluate((needle) => {
      const btn = Array.from(document.querySelectorAll('button')).find((el) =>
        (el.getAttribute('title') || '').includes(needle),
      )
      if (!btn) return false
      btn.click()
      return true
    }, text)
    if (!clicked) throw new Error('button not found: ' + text)
  }

  async function ensureMenuOpen() {
    const open = await page.$('[role="menu"][aria-label="\u9009\u62e9\u4e3b\u9898"]')
    if (!open) {
      await clickTitleIncludes('\u5207\u6362\u4e3b\u9898')
      await wait(350)
    }
  }

  async function pickByLabel(label) {
    await ensureMenuOpen()
    const picked = await page.evaluate((needle) => {
      const menu = document.querySelector('[role="menu"][aria-label="\u9009\u62e9\u4e3b\u9898"]')
      if (!menu) return false
      const btn = Array.from(menu.querySelectorAll('button[role="menuitemradio"]')).find((el) =>
        (el.textContent || '').includes(needle),
      )
      if (!btn) return false
      btn.click()
      return true
    }, label)
    if (!picked) throw new Error('option not found: ' + label)
    await wait(700)
  }

  await shot('01-default.png')

  await clickTitleIncludes('\u5207\u6362\u4e3b\u9898')
  await wait(400)
  await shot('02-menu-open.png')

  await pickByLabel('\u6d45\u8272')
  await shot('03-theme-plain.png')

  await pickByLabel('GitHub')
  await shot('04-theme-github.png')

  await pickByLabel('\u6df1\u8272')
  await shot('05-theme-dark.png')

  await ensureMenuOpen()
  await wait(350)
  await shot('06-menu-open-dark.png')

  await pickByLabel('\u6696\u8272')
  await shot('07-theme-warm.png')

  await clickTitleIncludes('\u5207\u6362\u4e3a\u6df1\u8272\u6a21\u5f0f')
  await wait(500)
  await shot('08-toggle-dark.png')

  await clickTitleIncludes('\u5207\u6362\u4e3a\u6d45\u8272\u6a21\u5f0f')
  await wait(500)
  await shot('09-toggle-light.png')

  const state = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    lightPalette: document.documentElement.dataset.lightPalette,
  }))
  console.log('STATE', JSON.stringify(state))
  console.log('DONE', shots.length)

  await browser.close()
}

main().catch((err) => {
  console.error('FAIL', err)
  process.exit(1)
})
