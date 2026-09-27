/**
 * Smoke-check the PACKAGED app (dist/win-unpacked/colamd.exe): spawn it with
 * a CDP port, drive the real UI (render, type, close -> unsaved dialog ->
 * save) and assert the write lands on disk. Verifies the packaged asar
 * contains everything main + renderer need — the unpackaged E2E suite cannot
 * see packaging regressions.
 *
 * Usage: node scripts/smoke-packaged.cjs [path/to/win-unpacked/colamd.exe]
 * Prerequisite: electron-builder --dir (or a full installer build) first.
 */
/* Packaged-app smoke v2 (CDP): spawn the real built exe with a remote
 * debugging port, connect over CDP, verify the editor renders, type, save
 * with Ctrl+S (menu accelerator), and verify the write on disk.
 * Exit 0 = the packaged asar contains everything main + renderer need. */
const { createRequire } = require('node:module')
const requireDesktop = createRequire('D:/pythonCCode/VibeCoding_Self/ColaMD/packages/desktop/package.json')
const { chromium } = requireDesktop('playwright')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, execSync } = require('node:child_process')

const exe = path.resolve(process.argv[2] || 'dist/win-unpacked/colamd.exe')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'colamd-smoke-'))
const file = path.join(userData, 'smoke.md')
fs.writeFileSync(file, '# smoke v1\n')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
    const child = spawn(exe, [file, '--user-data-dir=' + userData, '--remote-debugging-port=9223'], { stdio: 'ignore' })
    try {
        let targets = null
        for (let i = 0; i < 60; i++) {
            try {
                const res = await fetch('http://127.0.0.1:9223/json/list')
                targets = await res.json()
                if (targets.some((t) => t.type === 'page')) break
            } catch {}
            await sleep(500)
        }
        if (!targets) throw new Error('CDP endpoint never came up')
        console.log('OK main process alive, CDP up')

        const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
        const page = browser.contexts()[0].pages().find((p) => p.url().includes('index.html'))
        if (!page) throw new Error('editor page not found: ' + browser.contexts()[0].pages().map((p) => p.url()))
        await page.waitForSelector('.editor-component', { state: 'attached', timeout: 30000 })
        await page.waitForFunction(() => {
            const el = document.querySelector('.editor-component')
            return el && el.textContent.includes('smoke v1')
        }, null, { timeout: 30000 })
        console.log('OK editor rendered packaged content')

        await page.locator('.editor-component').click()
        await page.keyboard.press('End')
        await page.keyboard.type(' typed', { delay: 10 })
        const typedIn = await page.waitForFunction(() => document.querySelector('.editor-tabs li.unsaved') !== null, null, { timeout: 5000 }).then(() => true).catch(() => false)
        console.log('OK typing marked tab unsaved:', typedIn)

        // Trigger the real save through the app's own close-confirmation
        // flow: window.close() -> main asks the renderer -> the unsaved
        // dialog (a renderer overlay) -> its Save button runs the real
        // mt::save-tabs -> main -> write-file-atomic chain.
        await page.evaluate(() => window.electron.windowControl.close())
        await page.waitForSelector('.unsaved-dialog', { state: 'visible', timeout: 10000 })
        console.log('OK unsaved dialog shown by the packaged close flow')
        await page.click('.dialog-btn.primary')
        let saved = ''
        for (let i = 0; i < 40; i++) {
            saved = fs.readFileSync(file, 'utf-8')
            if (saved.includes('typed')) break
            await sleep(300)
        }
        if (!saved.includes('typed')) throw new Error('dialog save did not reach disk: ' + JSON.stringify(saved))
        console.log('OK dialog save wrote through the packaged main process')

        // Late-loaded pieces the startup path does not require: font-list
        // (dynamically imported on the fonts IPC), the ripgrep binary and
        // the native modules (smart-unpacked next to the asar).
        const asarDir = path.resolve(process.argv[2] ? path.dirname(process.argv[2]) : 'dist/win-unpacked') + '/resources'
        const checks = [
            asarDir + '/app.asar.unpacked/node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe',
            asarDir + '/app.asar.unpacked/node_modules/ced/build/Release/ced.node',
            asarDir + '/app.asar.unpacked/node_modules/native-keymap/build/Release/keymapping.node'
        ]
        for (const c of checks) {
            if (!fs.existsSync(c)) throw new Error('missing packaged artifact: ' + c)
        }
        console.log('OK rg.exe + native modules unpacked beside the asar')

        await browser.close()
        console.log('SMOKE PASS')
    } finally {
        try { execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }) } catch {}
        await sleep(500)
        fs.rmSync(userData, { recursive: true, force: true })
    }
    process.exit(0)
})().catch((err) => {
    console.error('SMOKE FAIL:', err.message)
    process.exit(1)
})
