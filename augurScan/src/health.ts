import { indexerHealthUnavailableResponse } from './http.ts'
import { createConcurrencyGate } from './limits.ts'

/** Concurrent probes per health route; each route has its own gate so neither can starve the other. */
const HEALTH_CONCURRENCY_LIMIT = 2

type HealthRouteDependencies = {
	/** Cheap liveness query; the server gives it a dedicated database connection. */
	readonly checkReadiness: () => Promise<unknown>
	readonly readIndexerHealth: () => Promise<{ readonly status: 'healthy' | 'degraded' }>
	readonly networks: readonly { readonly id: string }[]
	readonly securityHeaders: Readonly<Record<string, string>>
}

export const createHealthRoutes = ({ checkReadiness, readIndexerHealth, networks, securityHeaders }: HealthRouteDependencies) => {
	const busy = () => Response.json({ status: 'busy' }, { status: 503, headers: { ...securityHeaders, 'retry-after': '2' } })
	const readinessGate = createConcurrencyGate(HEALTH_CONCURRENCY_LIMIT, busy)
	const indexerHealthGate = createConcurrencyGate(HEALTH_CONCURRENCY_LIMIT, busy)
	return {
		ready: () =>
			readinessGate(async () => {
				try {
					await checkReadiness()
					return Response.json({ status: 'ready' })
				} catch (error) {
					console.error(`augurScan readiness check failed (${error instanceof Error ? error.name : typeof error})`)
					return Response.json({ status: 'not-ready' }, { status: 503 })
				}
			}),
		indexers: () =>
			indexerHealthGate(async () => {
				try {
					const snapshot = await readIndexerHealth()
					return Response.json(snapshot, { status: snapshot.status === 'healthy' ? 200 : 503 })
				} catch (error) {
					console.error(`augurScan indexer health check failed (${error instanceof Error ? error.name : typeof error})`)
					return indexerHealthUnavailableResponse(networks.map(network => ({ networkId: network.id, state: 'unknown' })))
				}
			}),
	}
}
