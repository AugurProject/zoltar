import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getChromiumPath } from './chromiumPath.js'
import { createBrowserSmokeCommandSender, createDevToolsSession, isBrowserSmokeReady, runBrowserSmoke, waitForBrowserExit } from './browserSmoke.mts'

const mountedState = {
	body: 'Augur Statoblast\nSecurity Pools',
	height: 844,
	hasMain: true,
	title: 'Security Pools | Augur Statoblast',
	width: 390,
}
const viewport = { height: 844, width: 390 }

test('browser smoke readiness requires the selected application identity', () => {
	expect(isBrowserSmokeReady(mountedState, 'Augur Statoblast', undefined, viewport)).toBe(true)
	expect(isBrowserSmokeReady({ ...mountedState, body: 'Security Pools' }, 'Augur Statoblast', undefined, viewport)).toBe(false)
})

test('browser smoke readiness can wait for route-specific loaded content', () => {
	expect(isBrowserSmokeReady(mountedState, 'Augur Statoblast', 'Open pool', viewport)).toBe(false)
	expect(isBrowserSmokeReady({ ...mountedState, body: `${mountedState.body}\nOpen pool` }, 'Augur Statoblast', 'Open pool', viewport)).toBe(true)
})

test('an explicit route-ready marker overrides stale bootstrap copy outside the route', () => {
	const routeReadyState = { ...mountedState, body: `${mountedState.body}\nBOOTSTRAPPING\nDEPLOYMENT COMPLETE` }
	expect(isBrowserSmokeReady(routeReadyState, 'Augur Statoblast', 'Deployment complete', viewport)).toBe(true)
	expect(isBrowserSmokeReady(routeReadyState, 'Augur Statoblast', undefined, viewport)).toBe(false)
})

test('browser smoke readiness requires the exact requested CSS viewport', () => {
	expect(isBrowserSmokeReady({ ...mountedState, width: 500 }, 'Augur Statoblast', undefined, viewport)).toBe(false)
	expect(isBrowserSmokeReady({ ...mountedState, height: 701 }, 'Augur Statoblast', undefined, viewport)).toBe(false)
})

test('browser cleanup handles a Chromium process that already exited', async () => {
	const browser = spawn(process.execPath, ['--eval', ''])
	await new Promise<void>((resolve, reject) => {
		browser.once('error', reject)
		browser.once('exit', () => resolve())
	})
	await expect(waitForBrowserExit(browser)).resolves.toBeUndefined()
})

test('browser commands reject when Chromium exits after the DevTools socket opens', async () => {
	const browser = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1_000)'])
	const socket = Object.assign(new EventTarget(), { send: () => undefined })
	const send = createBrowserSmokeCommandSender(socket, browser, 1_000)
	const command = send('Runtime.evaluate')
	browser.kill()
	await expect(command).rejects.toThrow(/Chromium exited/)
	await waitForBrowserExit(browser)
})

test('browser commands reject when the DevTools socket closes', async () => {
	const browser = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1_000)'])
	const socket = Object.assign(new EventTarget(), { send: () => undefined })
	const send = createBrowserSmokeCommandSender(socket, browser, 1_000)
	const command = send('Runtime.evaluate')
	socket.dispatchEvent(new Event('close'))
	await expect(command).rejects.toThrow(/connection closed/)
	browser.kill()
	await waitForBrowserExit(browser)
})

test('browser commands bound a stalled DevTools response', async () => {
	const browser = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1_000)'])
	const socket = Object.assign(new EventTarget(), { send: () => undefined })
	const send = createBrowserSmokeCommandSender(socket, browser, 5)
	await expect(send('Runtime.evaluate')).rejects.toThrow(/did not complete within 5ms/)
	browser.kill()
	await waitForBrowserExit(browser)
})

test.skipIf(process.platform === 'win32')('browser initialization failure reaps Chromium and removes its profile', async () => {
	const fixtureRoot = await mkdtemp(join(tmpdir(), 'zoltar-browser-fixture-'))
	const executablePath = join(fixtureRoot, 'fake-chromium')
	const pidPath = join(fixtureRoot, 'pid')
	const profilesBefore = new Set((await readdir(tmpdir())).filter(entry => entry.startsWith('zoltar-browser-smoke-')))
	await writeFile(executablePath, `#!/bin/sh\nprofile=''\nfor argument in "$@"; do\n  case "$argument" in\n    --user-data-dir=*) profile="${'${argument#*=}'}" ;;\n  esac\ndone\nprintf '9\\n' > "$profile/DevToolsActivePort"\nprintf '%s\\n' "$$" > ${JSON.stringify(pidPath)}\nexec sleep 60\n`)
	await chmod(executablePath, 0o755)
	try {
		await expect(createDevToolsSession(executablePath, 'http://127.0.0.1', viewport, { pollMilliseconds: 1, targetAttempts: 1 })).rejects.toThrow(/connect/i)
		const pid = Number((await readFile(pidPath, 'utf8')).trim())
		expect(() => process.kill(pid, 0)).toThrow()
		const profilesAfter = (await readdir(tmpdir())).filter(entry => entry.startsWith('zoltar-browser-smoke-'))
		expect(profilesAfter.filter(entry => !profilesBefore.has(entry))).toEqual([])
	} finally {
		await rm(fixtureRoot, { force: true, recursive: true })
	}
})

const chromiumPath = getChromiumPath()

describe.skipIf(chromiumPath === undefined)('browser smoke failure integration', () => {
	let fixture: ReturnType<typeof Bun.serve>
	let mode: 'import-map' | 'module' | 'worker' = 'import-map'

	beforeAll(() => {
		fixture = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch(request) {
				const pathname = new URL(request.url).pathname
				if (pathname === '/working-worker.js') return new Response('self.postMessage("ready")', { headers: { 'Content-Type': 'text/javascript' } })
				if (pathname === '/missing-module.js' || pathname === '/missing-worker.js') return new Response('missing', { status: 404 })
				const workerScript = mode === 'worker' ? '/missing-worker.js' : '/working-worker.js'
				const importMap = mode === 'import-map' ? '<script type="importmap">{"broken":"/one.js" "missingComma":"/two.js"}</script>' : ''
				const missingModule = mode === 'module' ? '<script type="module" src="/missing-module.js"></script>' : ''
				return new Response(`<!doctype html><title>Zoltar</title><main>Zoltar</main>${importMap}<script type="module">new Worker(${JSON.stringify(workerScript)}, { type: 'module' })</script>${missingModule}`, { headers: { 'Content-Type': 'text/html' } })
			},
		})
	})

	afterAll(() => fixture.stop(true))

	test('reports malformed import maps', async () => {
		mode = 'import-map'
		await expect(runBrowserSmoke('zoltar', fixture.url.origin, { mountTimeoutMilliseconds: 5_000 })).rejects.toThrow(/\[import-map\]/)
	})

	test('reports HTTP failures for application modules', async () => {
		mode = 'module'
		await expect(runBrowserSmoke('zoltar', fixture.url.origin, { mountTimeoutMilliseconds: 5_000 })).rejects.toThrow(/\[request-failed\].*404.*missing-module\.js/s)
	})

	test('reports HTTP failures for worker entry points', async () => {
		mode = 'worker'
		await expect(runBrowserSmoke('zoltar', fixture.url.origin, { mountTimeoutMilliseconds: 5_000 })).rejects.toThrow(/\[(?:request-failed|worker)\].*missing-worker\.js/s)
	})
})
