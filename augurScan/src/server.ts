import path from 'node:path'
import { handleApi } from './api.ts'
import { loadNetworks, runtimeConfig } from './config.ts'
import { ScannerDatabase } from './database.ts'
import { startIndexers } from './indexer.ts'
import { LiveBus, startHeartbeat } from './live.ts'
import { migrate } from './migrate.ts'

const database = new ScannerDatabase(runtimeConfig.postgresUrl)
await migrate(database.sql)
const networks = await loadNetworks()
if (runtimeConfig.disableIndexer) for (const network of networks) await database.seedNetwork(network)

const bus = new LiveBus()
const stopHeartbeat = startHeartbeat(bus)
const abortController = new AbortController()
const indexers = runtimeConfig.disableIndexer ? [] : startIndexers(networks, database, bus, abortController.signal)
const publicRoot = path.resolve(import.meta.dir, '../public')

const contentType = (pathname: string): string => {
	if (pathname.endsWith('.css')) return 'text/css; charset=utf-8'
	if (pathname.endsWith('.js')) return 'text/javascript; charset=utf-8'
	if (pathname.endsWith('.svg')) return 'image/svg+xml'
	return 'text/html; charset=utf-8'
}

const securityHeaders = {
	'content-security-policy':
		"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
	'referrer-policy': 'no-referrer',
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
}

const server = Bun.serve({
	port: runtimeConfig.port,
	async fetch(request) {
		const url = new URL(request.url)
		if (url.pathname === '/health/live') return Response.json({ status: 'ok' })
		if (url.pathname === '/health/ready') {
			try {
				await database.sql`SELECT 1`
				return Response.json({ status: 'ready' })
			} catch (error) {
				console.error(`augurScan readiness check failed (${error instanceof Error ? error.name : typeof error})`)
				return Response.json({ status: 'not-ready' }, { status: 503 })
			}
		}
		if (url.pathname === '/api/v1/stream') {
			return new Response(bus.stream(), {
				headers: { ...securityHeaders, 'cache-control': 'no-cache', connection: 'keep-alive', 'content-type': 'text/event-stream' },
			})
		}
		if (url.pathname.startsWith('/api/')) {
			const response = await handleApi(request, database.sql)
			if (response !== undefined) {
				for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, String(value))
				return response
			}
			return Response.json({ error: 'Not found' }, { status: 404, headers: securityHeaders })
		}

		const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
		if (requested.includes('..')) return new Response('Not found', { status: 404 })
		const file = Bun.file(path.join(publicRoot, requested))
		if (!(await file.exists())) {
			if (!requested.includes('.'))
				return new Response(Bun.file(path.join(publicRoot, 'index.html')), { headers: { ...securityHeaders, 'content-type': 'text/html; charset=utf-8' } })
			return new Response('Not found', { status: 404, headers: securityHeaders })
		}
		return new Response(file, {
			headers: { ...securityHeaders, 'cache-control': requested === 'index.html' ? 'no-cache' : 'public, max-age=300', 'content-type': contentType(requested) },
		})
	},
})

console.log(`augurScan listening on http://localhost:${server.port}`)

let shutdownPromise: Promise<void> | undefined
const shutdown = (): Promise<void> => {
	shutdownPromise ??= (async () => {
		abortController.abort()
		stopHeartbeat()
		bus.close()
		await server.stop(true)
		await Promise.allSettled(indexers)
		await database.close()
	})()
	return shutdownPromise
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
