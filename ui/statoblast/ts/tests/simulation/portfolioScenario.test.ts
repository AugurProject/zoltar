import { expect, test } from 'bun:test'
import { parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createBootstrappedSimulationBackendWithRetry, simulationSetupTimeoutMs } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { loadAllSecurityPools } from '@zoltar/ui-statoblast-shared/protocol/securityPools.js'

const abi = parseAbi([
	'function portfolioCustody() view returns (address)',
	'function priceFeed() view returns (address)',
	'function totals() view returns (uint256 rep,uint256 commitment,uint256 healthy)',
	'function aggregateExposureAttoEth() view returns (uint256)',
	'function acceptedExposureLimitAttoEth() view returns (uint256)',
])

test(
	'portfolio simulation funds accepted oracle capacity before authorizing and minting both questions',
	async () => {
		const backend = await createBootstrappedSimulationBackendWithRetry('portfolio', 1, 'statoblast')
		try {
			const client = backend.createReadClient()
			const pools = await loadAllSecurityPools(client)
			let portfolioQuestions = 0
			for (const pool of pools) {
				const capital = await client.readContract({ address: pool.securityPoolAddress, abi, functionName: 'portfolioCustody' })
				if (capital === zeroAddress) continue
				portfolioQuestions++
				const [, commitment] = await client.readContract({ address: capital, abi, functionName: 'totals' })
				const feed = await client.readContract({ address: pool.managerAddress, abi, functionName: 'priceFeed' })
				const limit = await client.readContract({ address: feed, abi, functionName: 'acceptedExposureLimitAttoEth' })
				const exposure = await client.readContract({ address: feed, abi, functionName: 'aggregateExposureAttoEth' })
				expect(commitment).toBe(10n * 10n ** 18n)
				expect(limit).toBeGreaterThanOrEqual(commitment)
				expect(exposure).toBeLessThanOrEqual(limit)
				expect(pool.shareTokenSupplyAttoShares).toBeGreaterThan(0n)
			}
			expect(portfolioQuestions).toBe(2)
		} finally {
			await backend.dispose()
			resetActiveEnvironmentForTesting()
		}
	},
	simulationSetupTimeoutMs,
)
