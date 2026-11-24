import { expect, test } from 'bun:test'
import { parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { loadAllQuestionLedgers } from '@zoltar/ui-statoblast-shared/protocol/questionLedgers.js'
import { createBootstrappedSimulationBackendWithRetry, simulationSetupTimeoutMs } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'

const abi = parseAbi(['function securityPoolCustody() view returns (address)', 'function totals() view returns (uint256 rep,uint256 commitment,uint256 healthy)'])
for (const [scenario, count] of [
	['security-pool', 1],
	['securitypoolx2', 2],
] as const) {
	test(
		`${scenario} seeds ${count} questions sharing funded security pool capital`,
		async () => {
			const backend = await createBootstrappedSimulationBackendWithRetry(scenario, 1, 'statoblast')
			try {
				const client = backend.createReadClient()
				const pools = await loadAllQuestionLedgers(client)
				expect(pools).toHaveLength(count)
				const capitals = await Promise.all(pools.map(pool => client.readContract({ address: pool.questionLedgerAddress, abi, functionName: 'securityPoolCustody' })))
				expect(new Set(capitals).size).toBe(1)
				const capital = capitals[0]
				if (typeof capital !== 'string' || !capital.startsWith('0x') || capital === zeroAddress) throw new Error('Missing shared security pool capital')
				const totals = await client.readContract({ address: `0x${capital.slice(2)}`, abi, functionName: 'totals' })
				if (!Array.isArray(totals)) throw new Error('Missing capital totals')
				const [rep, commitment] = totals
				expect(rep).toBe(5000n * 10n ** 18n)
				expect(commitment).toBe(10n * 10n ** 18n)
				for (const pool of pools) expect(pool.shareTokenSupplyAttoShares).toBeGreaterThan(0n)
			} finally {
				await backend.dispose()
				resetActiveEnvironmentForTesting()
			}
		},
		simulationSetupTimeoutMs,
	)
}
