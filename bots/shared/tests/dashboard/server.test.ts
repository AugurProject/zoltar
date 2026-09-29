import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startBotDashboardServer, type BotDashboardServerOptions } from '../../src/dashboard/server.ts'

const directories: string[] = []
const servers: { stop: (closeActiveConnections?: boolean) => Promise<void> }[] = []

afterEach(async () => {
	await Promise.all(servers.splice(0).map(server => server.stop(true)))
	await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function dashboardDirectory() {
	const directory = await mkdtemp(join(tmpdir(), 'bot-dashboard-server-'))
	directories.push(directory)
	await writeFile(join(directory, 'index.html'), '<html><body><!-- operator-header --><main><!-- settings-page --></main></body></html>')
	await writeFile(join(directory, 'styles.css'), 'main { color: black; }')
	await writeFile(join(directory, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
	return directory
}

async function startServer(overrides: Partial<BotDashboardServerOptions> = {}) {
	const server = startBotDashboardServer({
		directory: await dashboardDirectory(),
		exposure: { password: undefined, publicAuthority: undefined },
		hostname: '127.0.0.1',
		loopbackPublished: undefined,
		pages: ['overview', 'settings'],
		pageSlots: [
			['<!-- operator-header -->', '<header>Operator</header>'],
			['<!-- settings-page -->', () => '<section>Settings</section>'],
		],
		port: 0,
		route: async (request, { url }) => (request.method === 'GET' && url.pathname === '/api/state' ? Response.json({ ok: true }) : undefined),
		...overrides,
	})
	servers.push(server)
	return server
}

describe('bot dashboard server', () => {
	test('fills page slots and marks the requested page, defaulting to the first page', async () => {
		const server = await startServer()
		const overview = await fetch(`http://127.0.0.1:${server.port}/`)
		expect(overview.headers.get('content-type')).toBe('text/html; charset=utf-8')
		expect(await overview.text()).toBe('<html><body data-page="overview"><header>Operator</header><main><section>Settings</section></main></body></html>')
		expect(await (await fetch(`http://127.0.0.1:${server.port}/settings`)).text()).toContain('<body data-page="settings">')
		expect(await (await fetch(`http://127.0.0.1:${server.port}/dashboard.css`)).text()).toBe('main { color: black; }')
		expect((await fetch(`http://127.0.0.1:${server.port}/favicon.svg`)).headers.get('content-type')).toBe('image/svg+xml')
	})

	test('delegates bot routes and answers unclaimed paths with the configured not-found response', async () => {
		const jsonNotFound = await startServer()
		expect(await (await fetch(`http://127.0.0.1:${jsonNotFound.port}/api/state`)).json()).toEqual({ ok: true })
		const missing = await fetch(`http://127.0.0.1:${jsonNotFound.port}/missing`)
		expect(missing.status).toBe(404)
		expect(await missing.json()).toEqual({ error: 'Not found' })

		const plainNotFound = await startServer({ notFound: () => new Response('Not found', { status: 404 }) })
		expect(await (await fetch(`http://127.0.0.1:${plainNotFound.port}/missing`)).text()).toBe('Not found')
	})

	test('rejects unexpected host authorities before health, authentication, or routes', async () => {
		const server = await startServer({ exposure: { password: 'correct horse battery staple', publicAuthority: undefined } })
		const foreign = await fetch(`http://127.0.0.1:${server.port}/healthz`, { headers: { host: 'attacker.example' } })
		expect(foreign.status).toBe(403)
		expect(await foreign.json()).toEqual({ error: 'Request authority is not accepted' })
		expect(await (await fetch(`http://127.0.0.1:${server.port}/healthz`)).text()).toBe('ok')
	})

	test('requires Basic authentication for everything except health when a password is configured', async () => {
		const password = 'correct horse battery staple'
		const server = await startServer({ exposure: { password, publicAuthority: undefined } })
		const unauthenticated = await fetch(`http://127.0.0.1:${server.port}/api/state`)
		expect(unauthenticated.status).toBe(401)
		expect(unauthenticated.headers.get('www-authenticate')).toBe('Basic realm="Zoltar bot", charset="UTF-8"')
		const authenticated = await fetch(`http://127.0.0.1:${server.port}/api/state`, { headers: { authorization: `Basic ${Buffer.from(`operator:${password}`).toString('base64')}` } })
		expect(await authenticated.json()).toEqual({ ok: true })
	})

	test('allows passwordless access through an explicitly loopback-published container port', async () => {
		const authenticated = await startServer({ hostname: '0.0.0.0', loopbackPublished: true })
		expect((await fetch(`http://127.0.0.1:${authenticated.port}`)).status).toBe(200)
		const passwordless = await startServer({ exposure: { passwordlessExposureError: 'Loopback only' }, hostname: '0.0.0.0', loopbackPublished: true })
		expect((await fetch(`http://127.0.0.1:${passwordless.port}`)).status).toBe(200)
	})

	test('refuses unpublished network exposure', async () => {
		const directory = await dashboardDirectory()
		const options = { directory, pages: ['overview'], pageSlots: [], port: 0, route: async () => undefined, hostname: '0.0.0.0', loopbackPublished: false } as const
		expect(() => startBotDashboardServer({ ...options, exposure: { passwordlessExposureError: 'Loopback only' } })).toThrow('Loopback only')
		expect(() => startBotDashboardServer({ ...options, exposure: { password: undefined, publicAuthority: undefined } })).toThrow('ZOLTAR_BOT_DASHBOARD_PASSWORD must contain at least 16 characters')
	})
})
