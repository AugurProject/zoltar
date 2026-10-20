import { expect, test } from 'bun:test'
import { zeroAddress, zeroHash } from '@zoltar/core-shared/evm/ethereum'
import { loadPortfolioSourceRecovery } from '@zoltar/ui-statoblast-shared/protocol/securityPoolSharedFork.js'
import { createMockReadClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { capitalClient } from '../features/portfolios/capitalClient.js'
import { owner, portfolio, token, capital } from '../features/portfolios/capitalFixture.js'

test('a missing source namespace can be prepared without calling the reverting root pool getter', async () => {
	const source = capitalClient()
	const reads: { name: string; block: bigint | undefined }[] = []
	const client = source.client.extend(() =>
		createMockReadClient(async request => {
			reads.push({ name: request.functionName, block: request.blockNumber })
			switch (request.functionName) {
				case 'factory':
					return capital
				case 'questionOriginIds':
					return `0x${'11'.repeat(32)}`
				case 'originUniverseId':
					return 0n
				case 'sourceGame':
					return zeroAddress
				case 'getSecurityPool':
					return zeroAddress
				case 'getPool':
					expect(request.args).toEqual([7n, 0n])
					return token
				case 'shareToken':
					return capital
				case 'balanceOfShares':
					return [100n, 80n, 120n]
				case 'recoveredCompleteSetShares':
					return 30n
				default:
					throw new Error(`Unexpected read ${request.functionName}`)
			}
		}),
	)
	const snapshot = { portfolio, owner, universeId: 42n, blockNumber: 10n, blockHash: zeroHash }
	expect(await loadPortfolioSourceRecovery(client, snapshot, 7n)).toEqual({ pool: zeroAddress, source: token, shareToken: capital, availableShares: 50n })
	expect(new Set(reads.map(read => read.block))).toEqual(new Set([10n]))
	expect(reads.length).toBeLessThan(12)
})
