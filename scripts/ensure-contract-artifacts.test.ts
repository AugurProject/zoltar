import { expect, test } from 'bun:test'
import { getRequiredSharedOutputRelativePaths } from './ensure-contract-artifacts.mts'

test('ensure-contract-artifacts requires shared package testing helper outputs', async () => {
	const requiredSharedOutputs = await getRequiredSharedOutputRelativePaths()

	expect(requiredSharedOutputs).toContain('shared/js/testing/pickFixtureProperties.js')
	expect(requiredSharedOutputs).toContain('shared/js/testing/pickFixtureProperties.d.ts')
})
