import { describe, expect, test } from 'bun:test'
import { assertDeploymentManifestCurrent } from './check-mainnet-deployment.mts'

describe('deployment manifest freshness', () => {
	test('accepts a manifest that matches current deterministic deployment output', () => {
		expect(() => assertDeploymentManifestCurrent('sepolia', 'current manifest\n', 'current manifest\n')).not.toThrow()
	})

	test('rejects a stale manifest instead of only warning', () => {
		expect(() => assertDeploymentManifestCurrent('sepolia', 'tracked manifest\n', 'current manifest\n')).toThrow('Sepolia deployment manifest is stale. Run bun ./scripts/check-mainnet-deployment.mts --write after confirming the new values.')
	})
})
