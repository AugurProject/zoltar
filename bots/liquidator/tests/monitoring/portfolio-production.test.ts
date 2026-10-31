import { describe, expect, test } from 'bun:test'
import { createPublicClient } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { securityPoolFactoryAbi } from '@zoltar/bot-shared/contracts/abi'
import { useSecurityPoolPortfolioFixture } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioFixture'
import { getInfraContractAddresses } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast'
import { getZoltarAddress } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { loadPortfolioObservation } from '../../src/monitoring/portfolio-monitor.ts'
import { parseSettings } from '../../src/config/settings.ts'
import example from '../../config/operator.example.json'

describe('portfolio operator production integration', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	test('authenticates actual deployed modules and monitors fresh standalone-seeded portfolio capital', async () => {
		const client = createPublicClient({ chain: mainnet, transport: custom(fixture.base.mockWindow) })
		const settings = parseSettings(example)
		settings.deployment.securityPoolFactory = getInfraContractAddresses().securityPoolFactory
		settings.deployment.zoltar = getZoltarAddress()
		const scope = { address: fixture.portfolio, universeId: fixture.base.genesisUniverse, nextPositionId: 1n, sweepEnd: 0n }
		settings.selectedPortfolios = [scope]
		settings.approvedUniverses = [scope.universeId]
		expect(await client.readContract({ address: settings.deployment.securityPoolFactory, abi: securityPoolFactoryAbi, functionName: 'getSecurityPoolPortfolio', args: [fixture.base.securityPoolAddresses.securityPool] })).toBe(zeroAddress)
		const initial = await loadPortfolioObservation(client, settings, fixture.owner().account.address, scope, await client.getBlockNumber())
		expect(initial.snapshot.capitalLedger).toBe(fixture.capitalLedger)
		expect(initial.positions).toHaveLength(0)
		await fixture.prepare()
		const funded = await loadPortfolioObservation(client, settings, fixture.owner().account.address, scope, await client.getBlockNumber())
		expect(funded.snapshot.priceValid).toBe(true)
		expect(funded.snapshot.ownerPrincipalAttoRep).toBe(1000n * 10n ** 18n)
		expect(funded.positions).toHaveLength(1)
	})
})
