import { afterEach, describe, expect, test } from 'bun:test'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'

const servers: ReturnType<typeof startDashboardServer>[] = []

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true)
})

describe('liquidator dashboard server', () => {
	test('serves the dashboard and protects configuration mutations by origin', async () => {
		let paused = false
		const server = startDashboardServer(0, {
			getConfiguration: () => ({ selectedPools: [], strategy: {} }),
			getState: () => ({ paused }),
			hostname: '127.0.0.1',
			setApprovedUniverses: value => value,
			setPaused: value => {
				paused = Reflect.get(value as object, 'paused') === true
				return { paused }
			},
			setSelectedPools: value => value,
			setSigner: value => value,
			setStrategy: value => value,
		})
		servers.push(server)
		const page = await fetch(server.url)
		expect(page.status).toBe(200)
		expect(await page.text()).toContain('Pool liquidator')
		const rejected = await fetch(new URL('/api/paused', server.url), {
			body: JSON.stringify({ paused: true }),
			headers: {
				'content-type': 'application/json',
				origin: 'https://attacker.example',
			},
			method: 'PUT',
		})
		expect(rejected.status).toBe(403)
		const accepted = await fetch(new URL('/api/paused', server.url), {
			body: JSON.stringify({ paused: true }),
			headers: {
				'content-type': 'application/json',
				origin: server.url.origin,
			},
			method: 'PUT',
		})
		expect(accepted.status).toBe(200)
		expect(paused).toBe(true)
	})

	test('accepts loopback browser requests when bound to all interfaces', async () => {
		let paused = false
		const server = startDashboardServer(0, {
			getConfiguration: () => ({}),
			getState: () => ({ paused }),
			hostname: '0.0.0.0',
			setApprovedUniverses: value => value,
			setPaused: value => {
				paused = Reflect.get(value as object, 'paused') === true
				return { paused }
			},
			setSelectedPools: value => value,
			setSigner: value => value,
			setStrategy: value => value,
		})
		servers.push(server)
		const origin = `http://127.0.0.1:${server.port}`
		const page = await fetch(origin)
		expect(page.status).toBe(200)
		const mutation = await fetch(`${origin}/api/paused`, {
			body: JSON.stringify({ paused: true }),
			headers: {
				'content-type': 'application/json',
				origin,
			},
			method: 'PUT',
		})
		expect(mutation.status).toBe(200)
		expect(paused).toBe(true)
	})
})
