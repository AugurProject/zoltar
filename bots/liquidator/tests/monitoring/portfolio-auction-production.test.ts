import { PORTFOLIO_CHECKPOINT_GAS_RESERVE } from '../../src/execution/gas-estimate.ts'
import { describe, expect, test } from 'bun:test'
import { paddedTransactionGas } from '@zoltar/bot-shared/execution/transaction-submission'
import { securityPoolCapitalLedgerAbi as capitalAbi } from '@zoltar/bot-shared/contracts/abi'
import { useSecurityPoolPortfolioFixture, unit } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioFixture'
import { preparePortfolioCollateralRepairAuction } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioCollateralRepairAuctionFixture'
import { loadPortfolioObservation } from '../../src/monitoring/portfolio-monitor.ts'
import { portfolioTarget } from '../../src/monitoring/portfolio-auction.ts'
import { executePortfolioTakeover } from '../../src/execution/portfolio-executor.ts'
import { distressedSecondWinner, repairAuctionKeeper } from '../support/collateral-repair-auction.ts'
import { serveMockChainRpc } from '../support/mock-chain-rpc.ts'

describe('portfolio operator funded auction capital integration', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	test('a keeper authenticates lazy winners and acquires a distressed winner with bounded gas', async () => {
		const context = await preparePortfolioCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		// Set purchased collateral explicitly so the later price makes these
		// positions distressed, independently of the shared bidding helper default.
		const first = await context.bid(context.owner, 2n, (35n * unit) / 10n)
		const second = await context.bid(context.other, 3n, (35n * unit) / 10n)
		await context.closingQuote()
		await context.finalize()
		const keeperOperator = repairAuctionKeeper(fixture, context)
		const { account, reader, scope, settings, wallet } = keeperOperator
		await context.mock.setBalance(account.address, unit / 50n)
		const ownerExposure = await loadPortfolioObservation(reader, settings, context.owner.account.address, scope, await reader.getBlockNumber())
		expect(ownerExposure.ownedVaults?.map(vault => vault.owner)).toContain(first.vault)
		expect(ownerExposure.managedPrincipalAttoRep).toBeGreaterThan(ownerExposure.snapshot.ownerPrincipalAttoRep)
		expect(ownerExposure.nextScope.managedVaults).toContain(first.vault)
		const initial = await loadPortfolioObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
		const virtual = initial.positions.filter(position => position.auctionTarget !== undefined)
		expect(virtual.map(position => position.auctionTarget?.bidId)).toEqual([first.id, second.id])
		const cohort = await context.owner.readContract({ address: context.capital, abi: capitalAbi, functionName: 'auctionCohort' })
		expect(initial.positions.filter(position => position.auctionTarget === undefined).some(position => position.id === cohort[1])).toBe(false)
		expect(virtual[0]).toMatchObject({ rep: (await context.owner.readContract({ address: context.capital, abi: capitalAbi, functionName: 'auctionPosition', args: [first.id] })).principal })
		await context.report(3n * unit)
		const observation = await loadPortfolioObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
		const target = observation.positions.find(position => position.auctionTarget?.bidId === first.id)
		if (target === undefined) throw new Error('Missing authenticated auction target')
		expect(target.maxHealthyPrice).toBeLessThan(observation.snapshot.liquidationPrice)
		const estimates: bigint[] = []
		settings.portfolioPolicy.minimumNetRewardAttoEth = 0n
		const { pool, state, stop } = await serveMockChainRpc(context.mock, settings, account.address, scope, (method, result) => {
			if (method === 'eth_estimateGas' && typeof result === 'string') estimates.push(BigInt(result))
		})
		try {
			// Cures are unpaid, so the keeper never cures standalone and both winners stay virtual until a funded acquisition.
			expect((await reader.readContract({ address: context.capital, abi: capitalAbi, functionName: 'auctionPosition', args: [first.id] })).materialized).toBe(false)
			await context.mock.setBalance(account.address, 100n * unit)
			const { next, winner } = await distressedSecondWinner(context, keeperOperator, second.id)
			for (let step = 0; step < 3; step++) {
				const before = state.activities.filter(activity => activity.status === 'confirmed').length
				await executePortfolioTakeover(wallet, settings, state, pool, next, portfolioTarget(winner), async () => true)
				expect(state.activities.filter(activity => activity.status === 'confirmed')).toHaveLength(before + 1)
				const after = await reader.readContract({ address: context.capital, abi: capitalAbi, functionName: 'auctionPosition', args: [second.id] })
				expect(after.materialized).toBe(step === 2)
			}
			const taken = await reader.readContract({ address: context.capital, abi: capitalAbi, functionName: 'ownerCollateral', args: [account.address] })
			expect(taken[1]).toBe(3n * unit)
			const acquisition = state.activities.find(activity => activity.status === 'confirmed')
			if (acquisition?.hash === undefined) throw new Error('Takeover was not confirmed')
			const acquiredTransaction = await reader.getTransaction({ hash: acquisition.hash })
			const acquiredReceipt = await reader.waitForTransactionReceipt({ hash: acquisition.hash })
			const acquisitionEstimate = estimates.at(-1)
			if (acquisitionEstimate === undefined) throw new Error('Takeover gas estimate missing')
			expect(acquiredTransaction.gas).toBe(paddedTransactionGas(acquisitionEstimate + PORTFOLIO_CHECKPOINT_GAS_RESERVE))
			expect(acquiredTransaction.gas).toBeLessThanOrEqual(16_777_216n)
			expect(acquiredReceipt.status).toBe('success')
			if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ auctionKeeperTakeoverGas: { estimate: estimates.at(-1), signed: acquiredTransaction.gas, used: acquiredReceipt.gasUsed } })
		} finally {
			await stop()
		}
	})
})
