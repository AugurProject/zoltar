import { describe, expect, test } from 'bun:test'
import { createHealthRoutes } from '../../src/health.ts'

const networks = [{ id: 'mainnet' }]
const healthySnapshot = { status: 'healthy' as const }
const never = <T>(): Promise<T> => new Promise<T>(() => undefined)

describe('health routes', () => {
	test('readiness still answers while every indexer-health slot is held by an unresolved query', async () => {
		let indexerQueries = 0
		const routes = createHealthRoutes({
			checkReadiness: async () => undefined,
			readIndexerHealth: () => {
				indexerQueries++
				return never()
			},
			networks,
			securityHeaders: {},
		})
		const held = [routes.indexers(), routes.indexers()]
		expect(indexerQueries).toBe(2)
		const busy = await routes.indexers()
		expect(busy.status).toBe(503)
		expect(await busy.json()).toEqual({ status: 'busy' })
		expect(indexerQueries).toBe(2)

		const ready = await routes.ready()
		expect(ready.status).toBe(200)
		expect(await ready.json()).toEqual({ status: 'ready' })
		expect(held).toHaveLength(2)
	})

	test('indexer health still answers while readiness probes are held', async () => {
		const routes = createHealthRoutes({
			checkReadiness: never,
			readIndexerHealth: async () => healthySnapshot,
			networks,
			securityHeaders: {},
		})
		void routes.ready()
		void routes.ready()
		expect((await routes.ready()).status).toBe(503)
		expect((await routes.indexers()).status).toBe(200)
	})

	test('reports not-ready when the readiness query fails', async () => {
		const routes = createHealthRoutes({
			checkReadiness: async () => {
				throw new Error('connection refused')
			},
			readIndexerHealth: async () => healthySnapshot,
			networks,
			securityHeaders: {},
		})
		const response = await routes.ready()
		expect(response.status).toBe(503)
		expect(await response.json()).toEqual({ status: 'not-ready' })
	})

	test('reports degraded and unavailable indexer health with 503', async () => {
		const degraded = createHealthRoutes({ checkReadiness: async () => undefined, readIndexerHealth: async () => ({ status: 'degraded' as const }), networks, securityHeaders: {} })
		expect((await degraded.indexers()).status).toBe(503)
		const unavailable = createHealthRoutes({
			checkReadiness: async () => undefined,
			readIndexerHealth: async () => {
				throw new Error('timeout')
			},
			networks,
			securityHeaders: {},
		})
		const response = await unavailable.indexers()
		expect(response.status).toBe(503)
		expect(await response.json()).toEqual({ status: 'unknown', ownership: [{ networkId: 'mainnet', state: 'unknown' }] })
	})
})
