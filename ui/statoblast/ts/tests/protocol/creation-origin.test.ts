import { expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createMockReadClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { isUniverseForked } from '@zoltar/ui-statoblast-shared/protocol/securityPool.js'
import { owner } from '../features/security-pools/capitalFixture.js'

test('unknown origin is rejected even when fork time is zero (#1732)', async () => {
	const client = createMockReadClient(async request => (request.functionName === 'getRepToken' ? zeroAddress : 0n))
	await expect(isUniverseForked(client, 999n)).rejects.toThrow('does not exist')
})

test('deployment rejects an origin that cannot admit any question (#1730)', async () => {
	let threshold = 10n ** 18n
	const client = createMockReadClient(async request => {
		if (request.functionName === 'getRepToken') return owner
		if (request.functionName === 'getForkTime') return 0n
		if (request.functionName === 'getNonDecisionThresholdAttoRep') return threshold
		if (request.functionName === 'getUniverseTheoreticalSupplyAttoRep') return 40n * 10n ** 18n
		throw new Error(`Unexpected ${request.functionName}`)
	})
	await expect(isUniverseForked(client, 1n)).rejects.toThrow('too low')
	threshold++
	expect(await isUniverseForked(client, 1n)).toBe(false)
})
