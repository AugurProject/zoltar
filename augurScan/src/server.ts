import path from 'node:path'
import { handleApi } from './api.ts'
import { loadNetworks, runtimeConfig } from './config.ts'
import { ScannerDatabase } from './database.ts'
import { indexerHealthUnavailableResponse, liveStreamResponse, staticAssetResponse } from './http.ts'
import { indexerOwnershipStatuses, startIndexers } from './indexer.ts'
import { createConcurrencyGate } from './limits.ts'
import { LiveBus } from './live.ts'
import { migrate } from './migrate.ts'

const database = new ScannerDatabase(runtimeConfig.postgresUrl)
await migrate(database.sql)
const API_DATABASE_CONNECTIONS = 10
const healthDatabase = new ScannerDatabase(runtimeConfig.postgresUrl, 2)
const apiDatabase = new ScannerDatabase(runtimeConfig.postgresUrl, API_DATABASE_CONNECTIONS, 1)
const liveDatabase = new ScannerDatabase(runtimeConfig.postgresUrl, 2, 1)
const networks = await loadNetworks()
if (runtimeConfig.disableIndexer)
	for (const network of networks) {
		if ((await database.networkStartBlock(network.chainId)) === undefined) await database.seedNetwork(network)
	}

const bus = new LiveBus(liveDatabase)
let prunePromise: Promise<void> | undefined
const pruneLiveEvents = (): Promise<void> => {
	prunePromise ??= database
		.pruneLiveEvents()
		.catch((error) => console.error(`Unable to prune expired live events (${error instanceof Error ? error.name : typeof error})`))
		.finally(() => {
			prunePromise = undefined
		})
	return prunePromise
}
void pruneLiveEvents()
const pruneTimer = setInterval(() => void pruneLiveEvents(), 60 * 60 * 1_000)
const abortController = new AbortController()
const indexers = runtimeConfig.disableIndexer ? [] : startIndexers(networks, database, abortController.signal)
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

const API_TRANSACTION_TIMEOUT_MS = 8_000
const HEALTH_CONCURRENCY_LIMIT = 2
const freshnessThresholdMs = Math.max(runtimeConfig.pollIntervalMs * 4, 45_000)
const apiRequest = createConcurrencyGate(API_DATABASE_CONNECTIONS, () =>
	Response.json({ error: 'Server is busy; retry shortly' }, { status: 503, headers: { ...securityHeaders, 'retry-after': '2' } }),
)
const healthCheck = createConcurrencyGate(HEALTH_CONCURRENCY_LIMIT, () =>
	Response.json({ status: 'busy' }, { status: 503, headers: { ...securityHeaders, 'retry-after': '2' } }),
)

const server = Bun.serve({
	port: runtimeConfig.port,
	async fetch(request, server) {
		const url = new URL(request.url)
		if (url.pathname === '/health/live') return Response.json({ status: 'ok' })
		if (url.pathname === '/health/ready') {
			return await healthCheck(async () => {
				try {
					await healthDatabase.read(async (sql) => await sql`SELECT 1`, 3_000)
					return Response.json({ status: 'ready' })
				} catch (error) {
					console.error(`augurScan readiness check failed (${error instanceof Error ? error.name : typeof error})`)
					return Response.json({ status: 'not-ready' }, { status: 503 })
				}
			})
		}
		if (url.pathname === '/health/indexers') {
			return await healthCheck(async () => {
				try {
					const { rows, issues } = await healthDatabase.read(async (sql) => {
						const rows =
							await sql`SELECT chain_id, id, phase, last_poll_at, last_success_at, consecutive_failures, next_retry_at, last_error FROM networks ORDER BY chain_id`
						return { rows, issues: await healthDatabase.auditIntegrity(sql) }
					}, 3_000)
					const staleBefore = Date.now() - freshnessThresholdMs
					const stale = rows.filter(
						(row: Record<string, unknown>) => row['last_success_at'] === null || new Date(String(row['last_success_at'])).getTime() < staleBefore,
					)
					const healthy = issues.length === 0 && stale.length === 0
					return Response.json(
						{
							status: healthy ? 'healthy' : 'degraded',
							networks: rows,
							ownership: indexerOwnershipStatuses(),
							staleChainIds: stale.map((row: Record<string, unknown>) => Number(row['chain_id'])),
							integrityIssues: issues,
						},
						{ status: healthy ? 200 : 503 },
					)
				} catch (error) {
					console.error(`augurScan indexer health check failed (${error instanceof Error ? error.name : typeof error})`)
					return indexerHealthUnavailableResponse(indexerOwnershipStatuses())
				}
			})
		}
		if (url.pathname === '/api/v1/stream') {
			const header = request.headers.get('last-event-id')
			const parsedEventId = header !== null && /^\d+$/.test(header) ? Number(header) : undefined
			const lastEventId = parsedEventId !== undefined && Number.isSafeInteger(parsedEventId) ? parsedEventId : undefined
			const stream = bus.stream(lastEventId)
			if (stream === undefined)
				return Response.json({ error: 'Live stream capacity reached; retry shortly' }, { status: 503, headers: { ...securityHeaders, 'retry-after': '2' } })
			return liveStreamResponse(stream, request, server, securityHeaders)
		}
		if (url.pathname.startsWith('/api/')) {
			return await apiRequest(async () => {
				try {
					const response = await apiDatabase.read((sql) => handleApi(request, sql, freshnessThresholdMs), API_TRANSACTION_TIMEOUT_MS)
					if (response !== undefined) {
						for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, String(value))
						return response
					}
					return Response.json({ error: 'Not found' }, { status: 404, headers: securityHeaders })
				} catch (error) {
					console.error(`augurScan API transaction failed (${error instanceof Error ? error.name : typeof error})`)
					return Response.json({ error: 'Internal server error' }, { status: 500, headers: securityHeaders })
				}
			})
		}

		const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
		if (requested.includes('..')) return new Response('Not found', { status: 404 })
		const file = Bun.file(path.join(publicRoot, requested))
		if (!(await file.exists())) {
			if (!requested.includes('.')) return staticAssetResponse(Bun.file(path.join(publicRoot, 'index.html')), securityHeaders, 'text/html; charset=utf-8')
			return new Response('Not found', { status: 404, headers: securityHeaders })
		}
		return staticAssetResponse(file, securityHeaders, contentType(requested))
	},
})

console.log(`augurScan listening on http://localhost:${server.port}`)

let shutdownPromise: Promise<void> | undefined
const shutdown = (): Promise<void> => {
	shutdownPromise ??= (async () => {
		abortController.abort()
		clearInterval(pruneTimer)
		await prunePromise
		await bus.close()
		await server.stop()
		await Promise.allSettled(indexers)
		await liveDatabase.close()
		await apiDatabase.close()
		await healthDatabase.close()
		await database.close()
	})()
	return shutdownPromise
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
