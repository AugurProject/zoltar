import path from 'node:path'
import { handleApi } from './api.ts'
import { loadNetworks, runtimeConfig } from './config.ts'
import { ScannerDatabase } from './database.ts'
import {
	createFixedWindowRateLimiter,
	createRequestMetrics,
	indexerHealthUnavailableResponse,
	liveStreamResponse,
	metricRoute,
	requestAccessGuard,
	staticAssetResponse,
} from './http.ts'
import { indexerOwnershipStatuses, startIndexers } from './indexer.ts'
import { createConcurrencyGate } from './limits.ts'
import { LiveBus } from './live.ts'
import { installConsoleTimestamps } from './logging.ts'
import { abiSourceHash } from './metadata.ts'
import { sourceProvenance } from './provenance.ts'
import { CURRENT_SCHEMA_VERSION, initializeSchema } from './schema.ts'

installConsoleTimestamps()

const database = new ScannerDatabase(runtimeConfig.postgresUrl)
await initializeSchema(database.sql)
const API_DATABASE_CONNECTIONS = 10
const healthDatabase = new ScannerDatabase(runtimeConfig.postgresUrl, 2)
const apiDatabase = new ScannerDatabase(runtimeConfig.postgresUrl, API_DATABASE_CONNECTIONS, 1)
const liveDatabase = new ScannerDatabase(runtimeConfig.postgresUrl, 2, 1)
const networks = await loadNetworks()
const packageMetadata = (await Bun.file(path.resolve(import.meta.dir, '../package.json')).json()) as { readonly version?: unknown }
if (typeof packageMetadata.version !== 'string') throw new Error('augurScan package version is missing')
const sourceHashes = await sourceProvenance()
const networkConfiguration = networks.map((network) => ({
	id: network.id,
	chainId: network.chainId,
	startBlock: network.startBlock.toString(),
	confirmationDepth: network.confirmationDepth.toString(),
	contracts: network.contracts.map(([address, label, kind, deploymentBlock]) => ({
		address,
		label,
		kind,
		...(deploymentBlock === undefined ? {} : { deploymentBlock: deploymentBlock.toString() }),
	})),
}))
const runRows = await database.sql`
	INSERT INTO indexer_runs
		(schema_version, app_version, abi_source_hash, application_source_hash, projection_source_hash, indexer_enabled, network_configuration)
	VALUES (${CURRENT_SCHEMA_VERSION}, ${packageMetadata.version}, ${abiSourceHash}, ${sourceHashes.applicationSourceHash},
		${sourceHashes.projectionSourceHash}, ${!runtimeConfig.disableIndexer}, ${JSON.stringify(networkConfiguration)}::jsonb)
	RETURNING id::text
`
const indexerRunId = runRows[0]?.['id']
if (typeof indexerRunId !== 'string' || !/^\d+$/.test(indexerRunId)) throw new Error('Unable to record augurScan indexer-run provenance')
const evidenceProvenance = {
	indexerRunId,
	abiSourceHash,
	applicationSourceHash: sourceHashes.applicationSourceHash,
	projectionSourceHash: sourceHashes.projectionSourceHash,
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
const indexers = runtimeConfig.disableIndexer ? [] : startIndexers(networks, database, abortController.signal, { provenance: evidenceProvenance })
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
const apiRateLimit = createFixedWindowRateLimiter(runtimeConfig.apiRateLimitPerMinute, 60_000)
const requestMetrics = createRequestMetrics()

const unixSeconds = (value: unknown): number => {
	if (value === null || value === undefined) return 0
	const milliseconds = new Date(String(value)).getTime()
	return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1_000) : 0
}

const prometheusNetworkMetrics = async (): Promise<readonly string[]> => {
	const rows = await healthDatabase.read(
		async (sql) => await sql`SELECT chain_id, indexed_block, observed_block, last_success_at, consecutive_failures FROM networks ORDER BY chain_id`,
		3_000,
	)
	const lines = [
		'# HELP augurscan_indexer_lag_blocks Observed chain head minus the durable indexed checkpoint.',
		'# TYPE augurscan_indexer_lag_blocks gauge',
		'# HELP augurscan_indexer_last_success_unixtime_seconds Unix time of the last successful indexing pass.',
		'# TYPE augurscan_indexer_last_success_unixtime_seconds gauge',
		'# HELP augurscan_indexer_consecutive_failures Current consecutive indexing failures.',
		'# TYPE augurscan_indexer_consecutive_failures gauge',
	]
	for (const row of rows) {
		const chain = String(row['chain_id'])
		const observed = BigInt(String(row['observed_block'] ?? 0))
		const indexed = BigInt(String(row['indexed_block'] ?? 0))
		const lastSuccess = unixSeconds(row['last_success_at'])
		lines.push(`augurscan_indexer_lag_blocks{chain_id="${chain}"} ${(observed > indexed ? observed - indexed : 0n).toString()}`)
		lines.push(`augurscan_indexer_last_success_unixtime_seconds{chain_id="${chain}"} ${lastSuccess}`)
		lines.push(`augurscan_indexer_consecutive_failures{chain_id="${chain}"} ${Number(row['consecutive_failures'] ?? 0)}`)
	}
	return lines
}

const server = Bun.serve({
	port: runtimeConfig.port,
	async fetch(request, server) {
		const url = new URL(request.url)
		const route = metricRoute(url.pathname)
		const startedAt = performance.now()
		const respond = (response: Response): Response => {
			requestMetrics.observe(route, response, (performance.now() - startedAt) / 1_000)
			return response
		}
		if (url.pathname === '/health/live') return respond(Response.json({ status: 'ok' }))
		if (url.pathname === '/health/ready') {
			return respond(
				await healthCheck(async () => {
					try {
						await healthDatabase.read(async (sql) => await sql`SELECT 1`, 3_000)
						return Response.json({ status: 'ready' })
					} catch (error) {
						console.error(`augurScan readiness check failed (${error instanceof Error ? error.name : typeof error})`)
						return Response.json({ status: 'not-ready' }, { status: 503 })
					}
				}),
			)
		}
		const accessGuard = requestAccessGuard(
			request,
			url.pathname,
			server.requestIP(request)?.address ?? 'unknown',
			runtimeConfig.accessCredentials,
			apiRateLimit,
			securityHeaders,
		)
		if (accessGuard !== undefined) {
			if (accessGuard.reason === 'rate-limit') requestMetrics.recordRateLimitRejection()
			return respond(accessGuard.response)
		}
		if (url.pathname === '/metrics') {
			try {
				return respond(
					new Response(requestMetrics.serialize(await prometheusNetworkMetrics()), {
						headers: { ...securityHeaders, 'cache-control': 'no-store', 'content-type': 'text/plain; version=0.0.4; charset=utf-8' },
					}),
				)
			} catch (error) {
				console.error(`augurScan metrics query failed (${error instanceof Error ? error.name : typeof error})`)
				return respond(Response.json({ error: 'Metrics unavailable' }, { status: 503, headers: securityHeaders }))
			}
		}
		if (url.pathname === '/health/indexers') {
			return respond(
				await healthCheck(async () => {
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
				}),
			)
		}
		if (url.pathname === '/api/v1/stream') {
			const header = request.headers.get('last-event-id')
			const parsedEventId = header !== null && /^\d+$/.test(header) ? Number(header) : undefined
			const lastEventId = parsedEventId !== undefined && Number.isSafeInteger(parsedEventId) ? parsedEventId : undefined
			const stream = bus.stream(lastEventId)
			if (stream === undefined)
				return respond(
					Response.json({ error: 'Live stream capacity reached; retry shortly' }, { status: 503, headers: { ...securityHeaders, 'retry-after': '2' } }),
				)
			return respond(liveStreamResponse(stream, request, server, securityHeaders))
		}
		if (url.pathname.startsWith('/api/')) {
			return respond(
				await apiRequest(async () => {
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
				}),
			)
		}

		const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
		if (requested.includes('..')) return respond(new Response('Not found', { status: 404 }))
		const file = Bun.file(path.join(publicRoot, requested))
		if (!(await file.exists())) {
			if (!requested.includes('.'))
				return respond(staticAssetResponse(Bun.file(path.join(publicRoot, 'index.html')), securityHeaders, 'text/html; charset=utf-8'))
			return respond(new Response('Not found', { status: 404, headers: securityHeaders }))
		}
		return respond(staticAssetResponse(file, securityHeaders, contentType(requested)))
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
		try {
			await database.sql`UPDATE indexer_runs SET stopped_at = now() WHERE id = ${indexerRunId}`
		} catch (error) {
			console.error(`Unable to record indexer-run shutdown (${error instanceof Error ? error.name : typeof error})`)
		}
		await liveDatabase.close()
		await apiDatabase.close()
		await healthDatabase.close()
		await database.close()
	})()
	return shutdownPromise
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
