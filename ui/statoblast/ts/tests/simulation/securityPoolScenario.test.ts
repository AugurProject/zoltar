import { expect, test } from 'bun:test'
import { parseAbi, zeroAddress, getAddress } from '@zoltar/core-shared/evm/ethereum'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createBootstrappedSimulationBackendWithRetry, simulationSetupTimeoutMs } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { loadQuestionLedgerListing } from '@zoltar/ui-statoblast-shared/protocol/questionLedgers.js'

const abi = parseAbi([
	'function securityPoolCustody() view returns (address)',
	'function priceFeed() view returns (address)',
	'function openOraclePriceCoordinator() view returns (address)',
	'function totals() view returns (uint256 rep,uint256 commitment,uint256 healthy)',
	'function aggregateExposureAttoEth() view returns (uint256)',
	'function acceptedExposureLimitAttoEth() view returns (uint256)',
])

test(
	'security pool simulation funds accepted oracle capacity before authorizing and minting both questions',
	async () => {
		const backend = await createBootstrappedSimulationBackendWithRetry('securitypoolx2', 1, 'statoblast')
		try {
			const client = backend.createReadClient()
			const { pools } = await loadQuestionLedgerListing(client)
			let securityPoolQuestions = 0
			for (const pool of pools) {
				const capitalValue = await client.readContract({ address: pool.questionLedgerAddress, abi, functionName: 'securityPoolCustody' })
				if (typeof capitalValue !== 'string') throw new Error('Missing capital address')
				const capital = getAddress(capitalValue)
				if (capital === zeroAddress) continue
				securityPoolQuestions++
				const totals = await client.readContract({ address: capital, abi, functionName: 'totals' })
				if (!Array.isArray(totals) || typeof totals[1] !== 'bigint') throw new Error('Invalid capital totals')
				const commitment = totals[1]
				const manager = getAddress(String(await client.readContract({ address: pool.questionLedgerAddress, abi, functionName: 'openOraclePriceCoordinator' })))
				const feedValue = await client.readContract({ address: manager, abi, functionName: 'priceFeed' })
				if (typeof feedValue !== 'string') throw new Error('Missing feed address')
				const feed = getAddress(feedValue)
				const limit = await client.readContract({ address: feed, abi, functionName: 'acceptedExposureLimitAttoEth' })
				const exposure = await client.readContract({ address: feed, abi, functionName: 'aggregateExposureAttoEth' })
				if (typeof limit !== 'bigint' || typeof exposure !== 'bigint') throw new Error('Invalid feed exposure')
				expect(commitment).toBe(10n * 10n ** 18n)
				expect(limit).toBeGreaterThanOrEqual(commitment)
				expect(exposure).toBeLessThanOrEqual(limit)
				expect(pool.shareTokenSupplyAttoShares).toBeGreaterThan(0n)
			}
			expect(securityPoolQuestions).toBe(2)
		} finally {
			await backend.dispose()
			resetActiveEnvironmentForTesting()
		}
	},
	simulationSetupTimeoutMs,
)
