import { describe, expect, test } from 'bun:test'
import { assertDeploymentManifestCurrent, ensureDeploymentRuntimeDependencies } from './check-mainnet-deployment.mts'

describe('deployment manifest freshness', () => {
	test('builds missing UI runtime dependencies before loading deployment sources', async () => {
		let checks = 0
		let builds = 0
		await ensureDeploymentRuntimeDependencies(
			async () => {
				checks += 1
				return checks > 1
			},
			async () => {
				builds += 1
			},
		)
		expect(builds).toBe(1)
	})

	test('does not rebuild available UI runtime dependencies', async () => {
		let builds = 0
		await ensureDeploymentRuntimeDependencies(
			async () => true,
			async () => {
				builds += 1
			},
		)
		expect(builds).toBe(0)
	})

	test('accepts a manifest that matches current deterministic deployment output', () => {
		expect(() => assertDeploymentManifestCurrent('sepolia', 'current manifest\n', 'current manifest\n')).not.toThrow()
	})

	test('rejects a stale manifest instead of only warning', () => {
		expect(() => assertDeploymentManifestCurrent('sepolia', 'tracked manifest\n', 'current manifest\n')).toThrow('Sepolia deployment manifest is stale. Run bun ./scripts/check-mainnet-deployment.mts --write after confirming the new values.')
	})
})
