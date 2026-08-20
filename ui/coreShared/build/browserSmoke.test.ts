import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { getChromiumPath } from './chromiumPath.js'
import { isBrowserSmokeReady, runBrowserSmoke } from './browserSmoke.mts'

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
