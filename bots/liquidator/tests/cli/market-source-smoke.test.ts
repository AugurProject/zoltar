import { afterEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import { dashboardRequestIsAuthenticated } from '@zoltar/bot-shared/dashboard/security'

const script = join(import.meta.dir, '..', '..', 'scripts', 'check-market-sources.mts')
const password = 'correct horse battery staple'
const servers: { stop: (force?: boolean) => unknown }[] = []

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true)
})

function protectedDashboard() {
	const server = Bun.serve({
		fetch: request => {
			if (!dashboardRequestIsAuthenticated(request, password)) return Response.json({ error: 'Dashboard authentication is required.' }, { status: 401 })
			return Response.json({ assets: [{ assetId: 'rep', sources: [{ id: 'kraken', status: 'observed' }] }], blockNumber: '1' })
		},
		hostname: '127.0.0.1',
		port: 0,
	})
	servers.push(server)
	if (server.port === undefined) throw new Error('Test server did not expose a port')
	return `http://127.0.0.1:${server.port.toString()}`
}

async function runSmoke(url: string, environment: Record<string, string | undefined>) {
	const child = Bun.spawn([process.execPath, script, url], { env: { ...process.env, ZOLTAR_BOT_DASHBOARD_PASSWORD: undefined, ...environment }, stderr: 'pipe', stdout: 'pipe' })
	const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
	return { exitCode, stderr }
}

test('the market-source smoke check authenticates to a password-protected dashboard', async () => {
	const url = protectedDashboard()
	const anonymous = await runSmoke(url, {})
	expect(anonymous.exitCode).not.toBe(0)
	expect(anonymous.stderr).toContain('Dashboard authentication is required.')
	expect(await runSmoke(url, { ZOLTAR_BOT_DASHBOARD_PASSWORD: password })).toMatchObject({ exitCode: 0 })
})
