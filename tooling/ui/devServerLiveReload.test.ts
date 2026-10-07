import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import * as http from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createDevServerLiveReload } from './devServerLiveReload.mts'

const findFreePort = async () => {
	const server = http.createServer()
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('Test server port is unavailable')
	await new Promise<void>((resolve, reject) => server.close(error => (error === undefined ? resolve() : reject(error))))
	return address.port
}

test('live reload follows a restarted server to its new ephemeral port', async () => {
	const liveReload = createDevServerLiveReload()
	const stop = new AbortController()
	const children: ReturnType<typeof spawn>[] = []
	try {
		for (const reason of ['first server', 'restarted server']) {
			const child = spawn(process.execPath, [fileURLToPath(new URL('./dev-server.ts', import.meta.url)), 'zoltar'], {
				env: { ...process.env, UI_DEV_SERVER_PORT: '0' },
				stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
			})
			children.push(child)
			const endpoint = await liveReload.connect(child)
			if (endpoint === undefined) throw new Error('Live reload endpoint was discarded')
			const subscription = await fetch(endpoint, { signal: stop.signal })
			const reader = subscription.body?.getReader()
			if (reader === undefined) throw new Error('Live reload event stream is unavailable')
			await reader.read()
			liveReload.queue(reason)
			expect(new TextDecoder().decode((await reader.read()).value)).toContain(JSON.stringify({ reason }))
		}
	} finally {
		liveReload.stop()
		stop.abort()
		for (const child of children) {
			if (child.exitCode !== null || child.signalCode !== null) continue
			const exited = once(child, 'exit')
			child.kill('SIGTERM')
			await exited
		}
	}
})

for (const portKind of ['custom', 'ephemeral'] as const) {
	test(`development server reports its actual ${portKind} port for live reload`, async () => {
		const requestedPort = portKind === 'ephemeral' ? 0 : await findFreePort()
		const child = spawn(process.execPath, [fileURLToPath(new URL('./dev-server.ts', import.meta.url)), 'zoltar'], {
			env: { ...process.env, UI_DEV_SERVER_PORT: String(requestedPort) },
			stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
		})
		const stop = new AbortController()
		const liveReload = createDevServerLiveReload()
		let timeout: ReturnType<typeof setTimeout> | undefined
		try {
			const endpoint = await Promise.race([
				liveReload.connect(child),
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error('Development server never reported its listening port to the watcher')), 2_000)
				}),
			])
			if (endpoint === undefined) throw new Error('Live reload endpoint was discarded')
			const port = Number(new URL(endpoint).port)
			expect(port).toBeGreaterThan(0)
			if (requestedPort !== 0) expect(port).toBe(requestedPort)
			const subscription = await fetch(endpoint, { signal: stop.signal })
			const reader = subscription.body?.getReader()
			if (reader === undefined) throw new Error('Live reload event stream is unavailable')
			expect(new TextDecoder().decode((await reader.read()).value)).toContain('retry: 1000')
			const reason = 'css/app.css changed'
			liveReload.queue(reason)
			expect(new TextDecoder().decode((await reader.read()).value)).toContain(`event: reload\ndata: ${JSON.stringify({ reason })}`)
		} finally {
			clearTimeout(timeout)
			liveReload.stop()
			stop.abort()
			if (child.exitCode === null && child.signalCode === null) {
				const exited = once(child, 'exit')
				child.kill('SIGTERM')
				await exited
			}
		}
	})
}
