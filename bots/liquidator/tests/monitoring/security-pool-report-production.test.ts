import { describe, expect, test } from 'bun:test'
import { createPublicClient, createWalletClient, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { useSecurityPoolFixture, unit } from '../../../../solidity/ts/tests/statoblast/securityPoolFixture'
import { getInfraContractAddresses } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast'
import { getZoltarAddress } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { loadSecurityPoolObservation } from '../../src/monitoring/security-pool-monitor.ts'
import { executeSecurityPoolTakeover } from '../../src/execution/security-pool-executor.ts'
import { securityPoolSettings } from '../support/security-pool-observation.ts'
import { serveMockChainRpc } from '../support/mock-chain-rpc.ts'

describe('liquidator stale price integration', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	test('#1253 #1461 the production executor neither funds a takeover nor sponsors a report on a stale price', async () => {
		await fixture.prepare(700n * unit, 100n * unit)
		await fixture.mint(100n * unit)
		await fixture.refreshPrice(fixture.base.questionId, 4n * unit)
		await fixture.base.mockWindow.advanceTime(3601n)
		const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
		await fixture.base.mockWindow.setBalance(account.address, 100n * unit)
		const reader = createPublicClient({ chain: mainnet, transport: custom(fixture.base.mockWindow) })
		const wallet = createWalletClient({ account, chain: mainnet, transport: custom(fixture.base.mockWindow) })
		await fixture.base.mockWindow.impersonateAccount(account.address)
		const settings = securityPoolSettings()
		settings.deployment.securityPoolFactory = getInfraContractAddresses().securityPoolFactory
		settings.deployment.zoltar = getZoltarAddress()
		const scope = { address: fixture.securityPool, universeId: fixture.base.genesisUniverse, nextPositionId: 1n, sweepEnd: 0n }
		settings.selectedSecurityPools = [scope]
		settings.approvedUniverses = [scope.universeId]
		settings.securityPoolPolicy.maximumOwnFundingAttoRep = 2000n * unit
		settings.securityPoolPolicy.maximumPrincipalAttoRep = 20_000n * unit
		settings.securityPoolPolicy.maximumTotalPrincipalAttoRep = 30_000n * unit
		settings.strategy.maximumGasCostAttoEth = unit / 10n
		const { pool, state, stop } = await serveMockChainRpc(fixture.base.mockWindow, settings, account.address, scope)
		const observe = async () => loadSecurityPoolObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
		try {
			const observation = await observe()
			const target = observation.positions.find(position => position.owner === fixture.owner().account.address)
			if (target === undefined) throw new Error('Source missing')
			expect(observation.snapshot.priceValid).toBe(false)
			await expect(executeSecurityPoolTakeover(wallet, settings, state, pool, observation, target.id, async () => true)).rejects.toThrow('Security pool capital is inactive or its price has expired')
			expect(state.pendingTransactions).toHaveLength(0)
			expect(state.activities.some(activity => activity.status === 'confirmed')).toBe(false)
			const after = await observe()
			expect(after.snapshot.ownerPrincipalAttoRep).toBe(0n)
			expect(after.pendingOperationReport).toBeUndefined()
		} finally {
			await stop()
		}
	})
})
