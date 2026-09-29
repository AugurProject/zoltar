import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { access, chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getChromiumPath, withChromiumTestLock } from './chromiumPath.js'
import { createDevToolsSession, isBrowserSmokeReady, runBrowserSmoke } from './browserSmoke.mts'
import { createChromiumCommandSender, terminateBrowserProcess, waitForBrowserExit, waitForChromiumDevToolsPort } from './chromiumDevTools.mts'

const mountedState = {
	body: 'Augur Statoblast\nSecurity pools',
	height: 844,
	hasMain: true,
	readyState: 'complete' as const,
	title: 'Security pools | Augur Statoblast',
	width: 390,
}
const viewport = { height: 844, width: 390 }

const listenOnLoopback = async (server: Server) => {
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => resolve())
	})
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('Expected the test server to use a TCP port')
	return address.port
}

const closeServer = (server: Server) => new Promise<void>((resolve, reject) => server.close(error => (error === undefined ? resolve() : reject(error))))

const getAvailablePort = async (): Promise<number> => {
	const server = createServer()
	const port = await listenOnLoopback(server)
	await closeServer(server)
	return port
}

test('browser smoke readiness requires the selected application identity', () => {
	expect(isBrowserSmokeReady(mountedState, 'Augur Statoblast', undefined, viewport)).toBe(true)
	expect(isBrowserSmokeReady({ ...mountedState, body: 'Security pools' }, 'Augur Statoblast', undefined, viewport)).toBe(false)
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

test('browser smoke readiness waits for the document load lifecycle', () => {
	expect(isBrowserSmokeReady({ ...mountedState, readyState: 'interactive' }, 'Augur Statoblast', undefined, viewport)).toBe(false)
})

test('browser cleanup handles a Chromium process that already exited', async () => {
	const browser = spawn(process.execPath, ['--eval', ''])
	await new Promise<void>((resolve, reject) => {
		browser.once('error', reject)
		browser.once('exit', () => resolve())
	})
	await expect(waitForBrowserExit(browser)).resolves.toBeUndefined()
})

const createIdleBrowserCommandSender = (timeoutMilliseconds: number) => {
	const browser = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1_000)'])
	const socket = Object.assign(new EventTarget(), { send: () => undefined })
	return { browser, send: createChromiumCommandSender(socket, browser, timeoutMilliseconds), socket }
}

test('browser commands reject when Chromium exits after the DevTools socket opens', async () => {
	const { browser, send } = createIdleBrowserCommandSender(1_000)
	const command = send('Runtime.evaluate')
	browser.kill()
	await expect(command).rejects.toThrow(/Chromium exited/)
	await waitForBrowserExit(browser)
})

test('browser commands reject when the DevTools socket closes', async () => {
	const { browser, send, socket } = createIdleBrowserCommandSender(1_000)
	const command = send('Runtime.evaluate')
	socket.dispatchEvent(new Event('close'))
	await expect(command).rejects.toThrow(/connection closed/)
	browser.kill()
	await waitForBrowserExit(browser)
})

test('browser commands bound a stalled DevTools response', async () => {
	const { browser, send } = createIdleBrowserCommandSender(5)
	await expect(send('Runtime.evaluate')).rejects.toThrow(/did not complete within 5ms/)
	browser.kill()
	await waitForBrowserExit(browser)
})

const listBrowserProfiles = async (profileParentPath: string) => (await readdir(profileParentPath)).filter(entry => entry.startsWith('zoltar-browser-smoke-'))

test('browser launch failure removes the temporary profile', async () => {
	const fixtureRoot = await mkdtemp(join(tmpdir(), 'zoltar-browser-launch-failure-'))
	const unrelatedProfilePath = await mkdtemp(join(tmpdir(), 'zoltar-browser-smoke-'))
	try {
		await expect(createDevToolsSession(join(tmpdir(), `missing-chromium-${crypto.randomUUID()}`), 'http://127.0.0.1', viewport, { pollMilliseconds: 1, profileParentPath: fixtureRoot })).rejects.toThrow(/launch Chromium|ENOENT/)
		expect(await listBrowserProfiles(fixtureRoot)).toEqual([])
		await access(unrelatedProfilePath)
	} finally {
		await Promise.all([rm(fixtureRoot, { force: true, recursive: true }), rm(unrelatedProfilePath, { force: true, recursive: true })])
	}
})

const spawnReadyProcess = async (script: string) => {
	const browser = spawn(process.execPath, ['--eval', `${script}console.log('ready'); setInterval(() => {}, 1_000)`])
	await new Promise<void>((resolve, reject) => {
		browser.once('error', reject)
		browser.stdout.once('data', () => resolve())
	})
	return browser
}

test.skipIf(process.platform === 'win32')('browser cleanup escalates when Chromium ignores SIGTERM', async () => {
	const profilePath = await mkdtemp(join(tmpdir(), 'zoltar-browser-smoke-'))
	const browser = await spawnReadyProcess("process.on('SIGTERM', () => {}); ")
	const pid = browser.pid
	if (pid === undefined) throw new Error('Expected the cleanup fixture to have a process ID')
	await expect(terminateBrowserProcess(browser, profilePath, { forceTimeoutMilliseconds: 1_000, gracefulTimeoutMilliseconds: 10 })).resolves.toBeUndefined()
	expect(() => process.kill(pid, 0)).toThrow()
	expect(await Bun.file(profilePath).exists()).toBe(false)
	await expect(withChromiumTestLock(async () => 'released', { port: await getAvailablePort() })).resolves.toBe('released')
})

test.skipIf(process.platform === 'win32')('browser cleanup escalates when sending SIGTERM emits an error', async () => {
	const profilePath = await mkdtemp(join(tmpdir(), 'zoltar-browser-smoke-'))
	const browser = await spawnReadyProcess('')
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

type FakeChromiumOptions = { devToolsPort: number; pidPath?: string }

const writeFakeChromium = async (executablePath: string, { devToolsPort, pidPath }: FakeChromiumOptions) => {
	const recordPid = pidPath === undefined ? '' : `printf '%s\\n' "$$" > ${JSON.stringify(pidPath)}\n`
	await writeFile(executablePath, `#!/bin/sh\nprofile=''\nfor argument in "$@"; do\n  case "$argument" in\n    --user-data-dir=*) profile="${'${argument#*=}'}" ;;\n  esac\ndone\nprintf '${devToolsPort.toString()}\\n' > "$profile/DevToolsActivePort"\n${recordPid}exec sleep 60\n`)
	await chmod(executablePath, 0o755)
}

const withFakeChromiumFixture = async (prefix: string, run: (fixture: { executablePath: string; fixtureRoot: string; pidPath: string }) => Promise<void>) => {
	const fixtureRoot = await mkdtemp(join(tmpdir(), prefix))
	try {
		await run({ executablePath: join(fixtureRoot, 'fake-chromium'), fixtureRoot, pidPath: join(fixtureRoot, 'pid') })
	} finally {
		await rm(fixtureRoot, { force: true, recursive: true })
	}
}

const expectRecordedProcessReaped = async (pidPath: string) => {
	const pid = Number((await readFile(pidPath, 'utf8')).trim())
	expect(() => process.kill(pid, 0)).toThrow()
}

test.skipIf(process.platform === 'win32')('stalled DevTools discovery times out and reaps Chromium', async () => {
	await withFakeChromiumFixture('zoltar-browser-stall-fixture-', async ({ executablePath, fixtureRoot, pidPath }) => {
		const sockets = new Set<Socket>()
		const server = createServer(socket => {
			sockets.add(socket)
			socket.once('close', () => sockets.delete(socket))
		})
		const devToolsPort = await listenOnLoopback(server)
		await writeFakeChromium(executablePath, { devToolsPort, pidPath })
		try {
			await expect(createDevToolsSession(executablePath, 'http://127.0.0.1', viewport, { initializationTimeoutMilliseconds: 2_000, pollMilliseconds: 1, profileParentPath: fixtureRoot })).rejects.toThrow(/timed out/)
			await expectRecordedProcessReaped(pidPath)
			expect(await listBrowserProfiles(fixtureRoot)).toEqual([])
		} finally {
			for (const socket of sockets) socket.destroy()
			await closeServer(server)
		}
	})
})

const createFakeDevToolsServer = (emptyTargetResponses: number) => {
	let targetRequests = 0
	let port = 0
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch(request, bunServer): Response | undefined {
			if (new URL(request.url).pathname === '/ws' && bunServer.upgrade(request)) return undefined
			targetRequests += 1
			const targets = targetRequests <= emptyTargetResponses ? [] : [pageTarget(port)]
			return Response.json(targets)
		},
		websocket: { message: () => undefined },
	})
	if (server.port === undefined) throw new Error('Expected the fake DevTools server to use a TCP port')
	port = server.port
	return { port, stop: () => server.stop(true) }
}

const pageTarget = (port: number) => ({ type: 'page', webSocketDebuggerUrl: `ws://127.0.0.1:${port.toString()}/ws` })

const withFakeDevToolsBrowser = async (prefix: string, emptyTargetResponses: number, run: (fixture: { executablePath: string; fixtureRoot: string; server: ReturnType<typeof createFakeDevToolsServer> }) => Promise<void>) => {
	const server = createFakeDevToolsServer(emptyTargetResponses)
	try {
		await withFakeChromiumFixture(prefix, async ({ executablePath, fixtureRoot }) => {
			await writeFakeChromium(executablePath, { devToolsPort: server.port })
			await run({ executablePath, fixtureRoot, server })
		})
	} finally {
		server.stop()
	}
}

test('default DevTools port polling continues beyond the former 300-attempt limit', async () => {
	let probes = 0
	const port = await waitForChromiumDevToolsPort({
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
	await withFakeDevToolsBrowser('zoltar-browser-delayed-target-', 0, async ({ executablePath, server }) => {
		let targetListRequests = 0
		const session = await createDevToolsSession(executablePath, 'http://127.0.0.1', viewport, {
			initializationTimeoutMilliseconds: 5_000,
			pollMilliseconds: 0,
			targetListRequest: async () => {
				targetListRequests += 1
				return targetListRequests <= 220 ? [] : [pageTarget(server.port)]
			},
		})
		await session.close()
		expect(targetListRequests).toBe(221)
	})
})

test.skipIf(process.platform === 'win32')('DevTools discovery accepts Chromium stderr without a profile port file', async () => {
	const server = createFakeDevToolsServer(0)
	try {
		await withFakeChromiumFixture('zoltar-browser-stderr-port-', async ({ executablePath, fixtureRoot }) => {
			await writeFile(executablePath, `#!/bin/sh\nprintf 'DevTools listening on ws://127.0.0.1:' >&2\nsleep 0.05\nprintf '${server.port.toString()}/devtools/browser/example\\n' >&2\nexec sleep 60\n`)
			await chmod(executablePath, 0o755)
			const session = await createDevToolsSession(executablePath, 'http://127.0.0.1', viewport, { initializationTimeoutMilliseconds: 5_000, pollMilliseconds: 1, profileParentPath: fixtureRoot })
			await session.close()
		})
	} finally {
		server.stop()
	}
})

test.skipIf(process.platform === 'win32').each([
	{ name: 'a transient refused connection', prefix: 'zoltar-browser-transient-connection-', createError: () => Object.assign(new Error('Unable to connect. Is the computer able to access the url?'), { code: 'ConnectionRefused' }) },
	{ name: 'a nested standard connection reset', prefix: 'zoltar-browser-nested-connection-error-', createError: () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }) }) },
])('page target discovery retries $name', async ({ prefix, createError }) => {
	await withFakeDevToolsBrowser(prefix, 0, async ({ executablePath, server }) => {
		let targetListRequests = 0
		const session = await createDevToolsSession(executablePath, 'http://127.0.0.1', viewport, {
			initializationTimeoutMilliseconds: 5_000,
			pollMilliseconds: 1,
			targetListRequest: async () => {
				targetListRequests += 1
				if (targetListRequests === 1) throw createError()
				return [pageTarget(server.port)]
			},
		})
		await session.close()
		expect(targetListRequests).toBe(2)
	})
})

test.skipIf(process.platform === 'win32')('page target discovery rejects an unexpected TypeError without retrying', async () => {
	await withFakeChromiumFixture('zoltar-browser-unexpected-target-error-', async ({ executablePath }) => {
		await writeFakeChromium(executablePath, { devToolsPort: await getAvailablePort() })
		let targetListRequests = 0
		await expect(
			createDevToolsSession(executablePath, 'http://127.0.0.1', viewport, {
				pollMilliseconds: 1,
				targetAttempts: 2,
				targetListRequest: async () => {
					targetListRequests += 1
					throw new TypeError('Unexpected target-list failure')
				},
			}),
		).rejects.toThrow('Unexpected target-list failure')
		expect(targetListRequests).toBe(1)
	})
})

test.skipIf(process.platform === 'win32')('page target discovery deadline identifies the phase that timed out', async () => {
	await withFakeDevToolsBrowser('zoltar-browser-target-timeout-', Number.MAX_SAFE_INTEGER, async ({ executablePath }) => {
		await expect(createDevToolsSession(executablePath, 'http://127.0.0.1', viewport, { initializationTimeoutMilliseconds: 2_000, pollMilliseconds: 1 })).rejects.toThrow(/timed out while (waiting for the Chromium page target|requesting the DevTools target list)/)
	})
})

test.skipIf(process.platform === 'win32')('browser initialization failure reaps Chromium and removes its profile', async () => {
	await withFakeChromiumFixture('zoltar-browser-fixture-', async ({ executablePath, fixtureRoot, pidPath }) => {
		await writeFakeChromium(executablePath, { devToolsPort: 9, pidPath })
		await expect(createDevToolsSession(executablePath, 'http://127.0.0.1', viewport, { pollMilliseconds: 1, profileParentPath: fixtureRoot, targetAttempts: 1 })).rejects.toThrow(/connect/i)
		await expectRecordedProcessReaped(pidPath)
		expect(await listBrowserProfiles(fixtureRoot)).toEqual([])
	})
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
