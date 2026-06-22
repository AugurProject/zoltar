import { expect, test } from 'bun:test'
import { assertMainnetDeploymentManifestFresh } from './check-mainnet-deployment.mts'

test('mainnet deployment manifest matches the current deterministic deployment calculation', async () => {
	await expect(assertMainnetDeploymentManifestFresh()).resolves.toBeUndefined()
})
