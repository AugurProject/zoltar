import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getChromiumPath, withChromiumTestLock } from './chromiumPath.js'
import { createBrowserSmokeCommandSender, createDevToolsSession, isBrowserSmokeReady, runBrowserSmoke, terminateBrowserProcess, waitForBrowserExit, waitForDevToolsPort } from './browserSmoke.mts'

const mountedState = {
	body: 'Augur Statoblast\nSecurity Pools',
	height: 844,
	hasMain: true,
	title: 'Security Pools | Augur Statoblast',
	width: 390,
}
const viewport = { height: 844, width: 390 }

const getAvailablePort = async (): Promise<number> => {
	const server = createServer()
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => resolve())
	})
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('Expected the test server to use a TCP port')
	await new Promise<void>((resolve, reject) => server.close(error => (error === undefined ? resolve() : reject(error))))
	return address.port
}

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

test('browser launch failure removes the temporary profile', async () => {
	let profilePath: string | undefined
	await expect(
		createDevToolsSession(join(tmpdir(), `missing-chromium-${crypto.randomUUID()}`), 'http://127.0.0.1', viewport, {
			onProfileCreated: createdProfilePath => {
				profilePath = createdProfilePath
			},
			pollMilliseconds: 1,
		}),
	).rejects.toThrow(/launch Chromium|ENOENT/)
	if (profilePath === undefined) throw new Error('Expected Chromium profile creation before launch')
	expect(await Bun.file(profilePath).exists()).toBe(false)
})

test('browser profile observer failures remove the temporary profile', async () => {
	let profilePath: string | undefined
	await expect(
		createDevToolsSession(join(tmpdir(), `unused-chromium-${crypto.randomUUID()}`), 'http://127.0.0.1', viewport, {
			onProfileCreated: createdProfilePath => {
				profilePath = createdProfilePath
				throw new Error('profile observer failed')
			},
		}),
	).rejects.toThrow('profile observer failed')
	if (profilePath === undefined) throw new Error('Expected Chromium profile creation before observer failure')
	expect(await Bun.file(profilePath).exists()).toBe(false)
})

test.skipIf(process.platform === 'win32')('browser cleanup escalates when Chromium ignores SIGTERM', async () => {
	const profilePath = await mkdtemp(join(tmpdir(), 'zoltar-browser-smoke-'))
	const browser = spawn(process.execPath, ['--eval', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1_000)"])
	await new Promise<void>((resolve, reject) => {
		browser.once('error', reject)
		browser.stdout.once('data', () => resolve())
	})
	const pid = browser.pid
	if (pid === undefined) throw new Error('Expected the cleanup fixture to have a process ID')
	await expect(terminateBrowserProcess(browser, profilePath, { forceTimeoutMilliseconds: 1_000, gracefulTimeoutMilliseconds: 10 })).resolves.toBeUndefined()
	expect(() => process.kill(pid, 0)).toThrow()
	expect(await Bun.file(profilePath).exists()).toBe(false)
	await expect(withChromiumTestLock(async () => 'released', { port: await getAvailablePort() })).resolves.toBe('released')
})

test.skipIf(process.platform === 'win32')('browser cleanup escalates when sending SIGTERM emits an error', async () => {
	const profilePath = await mkdtemp(join(tmpdir(), 'zoltar-browser-smoke-'))
	const browser = spawn(process.execPath, ['--eval', "console.log('ready'); setInterval(() => {}, 1_000)"])
	await new Promise<void>((resolve, reject) => {
		browser.once('error', reject)
		browser.stdout.once('data', () => resolve())
	})
	const originalKill = browser.kill.bind(browser)
	const signals: Array<NodeJS.Signals | number | undefined> = []
	browser.kill = signal => {
		signals.push(signal)
		if (signal === 'SIGTERM') {
			queueMicrotask(() => browser.emit('error', new Error('simulated SIGTERM failure')))
			return false
		}
		return originalKill(signal)
	}
	await expect(terminateBrowserProcess(browser, profilePath, { forceTimeoutMilliseconds: 1_000, gracefulTimeoutMilliseconds: 10 })).resolves.toBeUndefined()
	expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
	expect(await Bun.file(profilePath).exists()).toBe(false)
})

test.skipIf(process.platform === 'win32')('stalled DevTools discovery times out and reaps Chromium', async () => {
	const fixtureRoot = await mkdtemp(join(tmpdir(), 'zoltar-browser-stall-fixture-'))
	const executablePath = join(fixtureRoot, 'fake-chromium')
	const pidPath = join(fixtureRoot, 'pid')
	const profilePathFile = join(fixtureRoot, 'profile-path')
	const sockets = new Set<Socket>()
	const server = createServer(socket => {
		sockets.add(socket)
		socket.once('close', () => sockets.delete(socket))
	})
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => resolve())
	})
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('Expected the DevTools stall fixture to use a TCP port')
	await writeFile(
		executablePath,
		`#!/bin/sh\nprofile=''\nfor argument in "$@"; do\n  case "$argument" in\n    --user-data-dir=*) profile="${'${argument#*=}'}" ;;\n  esac\ndone\nprintf '${address.port.toString()}\\n' > "$profile/DevToolsActivePort"\nprintf '%s\\n' "$$" > ${JSON.stringify(pidPath)}\nprintf '%s\\n' "$profile" > ${JSON.stringify(profilePathFile)}\nexec sleep 60\n`,
	)
	await chmod(executablePath, 0o755)
	try {
		await expect(createDevToolsSession(executablePath, 'http://127.0.0.1', viewport, { initializationTimeoutMilliseconds: 2_000, pollMilliseconds: 1 })).rejects.toThrow(/timed out/)
		const pid = Number((await readFile(pidPath, 'utf8')).trim())
		expect(() => process.kill(pid, 0)).toThrow()
		const profilePath = (await readFile(profilePathFile, 'utf8')).trim()
		expect(await Bun.file(profilePath).exists()).toBe(false)
	} finally {
		for (const socket of sockets) socket.destroy()
		await new Promise<void>((resolve, reject) => server.close(error => (error === undefined ? resolve() : reject(error))))
		await rm(fixtureRoot, { force: true, recursive: true })
	}
})

const createFakeDevToolsServer = (emptyTargetResponses: number) => {
	let targetRequests = 0
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch(request, bunServer) {
			if (new URL(request.url).pathname === '/ws' && bunServer.upgrade(request)) return undefined
			targetRequests += 1
			const targets = targetRequests <= emptyTargetResponses ? [] : [{ type: 'page', webSocketDebuggerUrl: `ws://127.0.0.1:${server.port.toString()}/ws` }]
			return Response.json(targets)
		},
		websocket: { message: () => undefined },
	})
	return server
}

const writeFakeChromium = async (executablePath: string, devToolsPort: number, portDelaySeconds: string) => {
	await writeFile(executablePath, `#!/bin/sh\nprofile=''\nfor argument in "$@"; do\n  case "$argument" in\n    --user-data-dir=*) profile="${'${argument#*=}'}" ;;\n  esac\ndone\nsleep ${portDelaySeconds}\nprintf '${devToolsPort.toString()}\\n' > "$profile/DevToolsActivePort"\nexec sleep 60\n`)
	await chmod(executablePath, 0o755)
}

test('default DevTools port polling continues beyond the former 300-attempt limit', async () => {
	let probes = 0
	const port = await waitForDevToolsPort({
		assertBrowserAvailable: () => undefined,
		pollMilliseconds: 0,
		readPort: async () => {
			probes += 1
			return probes === 301 ? 9222 : undefined
		},
		wait: async () => undefined,
	})
	expect(port).toBe(9222)
	expect(probes).toBe(301)
})

test.skipIf(process.platform === 'win32')('default initialization waits beyond the former page target retry limit', async () => {
	const fixtureRoot = await mkdtemp(join(tmpdir(), 'zoltar-browser-delayed-target-'))
	const executablePath = join(fixtureRoot, 'fake-chromium')
	const server = createFakeDevToolsServer(220)
	await writeFakeChromium(executablePath, server.port, '0')
	try {
		const session = await createDevToolsSession(executablePath, 'http://127.0.0.1', viewport, { initializationTimeoutMilliseconds: 5_000, pollMilliseconds: 1 })
		await session.close()
	} finally {
		server.stop(true)
		await rm(fixtureRoot, { force: true, recursive: true })
	}
})

test.skipIf(process.platform === 'win32')('page target deadline identifies the phase that timed out', async () => {
	const fixtureRoot = await mkdtemp(join(tmpdir(), 'zoltar-browser-target-timeout-'))
	const executablePath = join(fixtureRoot, 'fake-chromium')
	const server = createFakeDevToolsServer(Number.MAX_SAFE_INTEGER)
	await writeFakeChromium(executablePath, server.port, '0')
	try {
		await expect(createDevToolsSession(executablePath, 'http://127.0.0.1', viewport, { initializationTimeoutMilliseconds: 2_000, pollMilliseconds: 1 })).rejects.toThrow(/timed out while waiting for the Chromium page target/)
	} finally {
		server.stop(true)
		await rm(fixtureRoot, { force: true, recursive: true })
	}
})

test.skipIf(process.platform === 'win32')('browser initialization failure reaps Chromium and removes its profile', async () => {
	const fixtureRoot = await mkdtemp(join(tmpdir(), 'zoltar-browser-fixture-'))
	const executablePath = join(fixtureRoot, 'fake-chromium')
	const pidPath = join(fixtureRoot, 'pid')
	let profilePath: string | undefined
	await writeFile(executablePath, `#!/bin/sh\nprofile=''\nfor argument in "$@"; do\n  case "$argument" in\n    --user-data-dir=*) profile="${'${argument#*=}'}" ;;\n  esac\ndone\nprintf '9\\n' > "$profile/DevToolsActivePort"\nprintf '%s\\n' "$$" > ${JSON.stringify(pidPath)}\nexec sleep 60\n`)
	await chmod(executablePath, 0o755)
	try {
		await expect(
			createDevToolsSession(executablePath, 'http://127.0.0.1', viewport, {
				onProfileCreated: createdProfilePath => {
					profilePath = createdProfilePath
				},
				pollMilliseconds: 1,
				targetAttempts: 1,
			}),
		).rejects.toThrow(/connect/i)
		const pid = Number((await readFile(pidPath, 'utf8')).trim())
		expect(() => process.kill(pid, 0)).toThrow()
		if (profilePath === undefined) throw new Error('Expected Chromium profile creation before initialization')
		expect(await Bun.file(profilePath).exists()).toBe(false)
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
