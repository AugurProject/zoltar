import { describe, expect, test } from 'bun:test'
import { createPublicClient, createWalletClient, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { useSecurityPoolPortfolioFixture, unit } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioFixture'
import { getInfraContractAddresses } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast'
import { getZoltarAddress } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { loadPortfolioObservation } from '../../src/monitoring/portfolio-monitor.ts'
import { executePortfolioTakeover } from '../../src/execution/portfolio-executor.ts'
import { portfolioSettings } from '../support/portfolio-observation.ts'
import { serveMockChainRpc } from '../support/mock-chain-rpc.ts'
import { securityPoolCapitalLedgerAbi, erc20Abi } from '@zoltar/bot-shared/contracts/abi'
import { writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients'
import { getRepTokenAddress } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'

describe('liquidator stale price integration', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	test('the production executor funds and fills a started auction after price expiry without sponsoring a report', async () => {
		await fixture.prepare(700n * unit, 100n * unit)
		await fixture.mint(100n * unit)
		await fixture.refreshPrice(fixture.base.questionId, 4n * unit)
		const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
		await fixture.base.mockWindow.setBalance(account.address, 100n * unit)
		const reader = createPublicClient({ chain: mainnet, transport: custom(fixture.base.mockWindow) })
		const wallet = createWalletClient({ account, chain: mainnet, transport: custom(fixture.base.mockWindow) })
		await fixture.base.mockWindow.impersonateAccount(account.address)
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: erc20Abi, address: getRepTokenAddress(fixture.base.genesisUniverse), functionName: 'transfer', args: [account.address, 2000n * unit] }))
		await reader.waitForTransactionReceipt({ hash: await wallet.writeContract({ abi: securityPoolCapitalLedgerAbi, address: fixture.capitalLedger, functionName: 'setHealthTarget', args: [15_000n] }) })
		await fixture.base.mockWindow.advanceTime(3601n)
		const settings = portfolioSettings()
		settings.deployment.securityPoolFactory = getInfraContractAddresses().securityPoolFactory
		settings.deployment.zoltar = getZoltarAddress()
		const scope = { address: fixture.portfolio, universeId: fixture.base.genesisUniverse, nextPositionId: 1n, sweepEnd: 0n }
		settings.selectedPortfolios = [scope]
		settings.approvedUniverses = [scope.universeId]
		settings.portfolioPolicy.maximumOwnFundingAttoRep = 2000n * unit
		settings.portfolioPolicy.maximumPrincipalAttoRep = 20_000n * unit
		settings.portfolioPolicy.maximumTotalPrincipalAttoRep = 30_000n * unit
		settings.strategy.maximumGasCostAttoEth = unit / 10n
		const { pool, state, stop } = await serveMockChainRpc(fixture.base.mockWindow, settings, account.address, scope)
		const observe = async () => loadPortfolioObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
		try {
			const observation = await observe()
			const target = observation.positions.find(position => position.owner === fixture.owner().account.address)
			if (target === undefined) throw new Error('Source missing')
			expect(observation.snapshot.priceValid).toBe(false)
			expect(target.liquidationStarted).toBeGreaterThan(0n)
			// Approval, owner funding and takeover each execute in their own rescreened cycle.
			for (let cycle = 0; cycle < 3; cycle++) await executePortfolioTakeover(wallet, settings, state, pool, await observe(), target.id, async () => true)
			expect(state.pendingTransactions).toHaveLength(0)
			expect(state.activities.some(activity => activity.status === 'confirmed')).toBe(true)
			const after = await observe()
			expect(after.snapshot.ownerPrincipalAttoRep).toBeGreaterThan(700n * unit)
			expect(after.snapshot.ownerCommitmentAttoEth).toBe(100n * unit)
			expect(after.snapshot.priceValid).toBe(false)
			expect(after.acceptedPriceEpoch).toBe(observation.acceptedPriceEpoch)
			expect(after.pendingOperationReport).toBeUndefined()
		} finally {
			await stop()
		}
	})
})
