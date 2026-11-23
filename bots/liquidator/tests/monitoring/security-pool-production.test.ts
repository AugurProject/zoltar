import { describe, expect, test } from 'bun:test'
import { createPublicClient } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { securityPoolFactoryAbi } from '@zoltar/bot-shared/contracts/abi'
import { useSecurityPoolFixture } from '../../../../solidity/ts/tests/statoblast/securityPoolFixture'
import { getInfraContractAddresses } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast'
import { getZoltarAddress } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { loadSecurityPoolObservation } from '../../src/monitoring/security-pool-monitor.ts'
import { parseSettings } from '../../src/config/settings.ts'
import example from '../../config/operator.example.json'

describe('security pool operator production integration', () => {
	const fixture = useSecurityPoolFixture()
	test('authenticates actual deployed modules and monitors security pool capital without a standalone seed', async () => {
		const client = createPublicClient({ chain: mainnet, transport: custom(fixture.base.mockWindow) })
		const settings = parseSettings(example)
		settings.deployment.securityPoolFactory = getInfraContractAddresses().securityPoolFactory
		settings.deployment.zoltar = getZoltarAddress()
		const scope = { address: fixture.securityPool, universeId: fixture.base.genesisUniverse, nextPositionId: 1n, sweepEnd: 0n }
		settings.selectedSecurityPools = [scope]
		settings.approvedUniverses = [scope.universeId]
		expect(await client.readContract({ address: settings.deployment.securityPoolFactory, abi: securityPoolFactoryAbi, functionName: 'securityPoolOf', args: [fixture.poolFor(fixture.base.questionId).questionLedger] })).toBe(fixture.securityPool)
		const initial = await loadSecurityPoolObservation(client, settings, fixture.owner().account.address, scope, await client.getBlockNumber())
		expect(initial.snapshot.capitalLedger).toBe(fixture.capitalLedger)
		expect(initial.positions).toHaveLength(0)
		await fixture.prepare()
		const funded = await loadSecurityPoolObservation(client, settings, fixture.owner().account.address, scope, await client.getBlockNumber())
		expect(funded.snapshot.priceValid).toBe(true)
		expect(funded.snapshot.ownerPrincipalAttoRep).toBe(1000n * 10n ** 18n)
		expect(funded.positions).toHaveLength(1)
	})
})
