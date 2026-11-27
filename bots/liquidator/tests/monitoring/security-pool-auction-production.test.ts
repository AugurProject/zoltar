import { SECURITY_POOL_CHECKPOINT_GAS_RESERVE } from '../../src/execution/gas-estimate.ts'
import { describe, expect, test } from 'bun:test'
import { paddedTransactionGas } from '@zoltar/bot-shared/execution/transaction-submission'
import { securityPoolCapitalLedgerAbi as capitalAbi } from '@zoltar/bot-shared/contracts/abi'
import type { Address } from '@zoltar/bot-shared/ethereum'
import { useSecurityPoolFixture, unit } from '../../../../solidity/ts/tests/statoblast/securityPoolFixture'
import { loadSecurityPoolObservation } from '../../src/monitoring/security-pool-monitor.ts'
import { securityPoolTarget } from '../../src/monitoring/security-pool-auction.ts'
import { executeSecurityPoolTakeover } from '../../src/execution/security-pool-executor.ts'
import { distressedSecondWinner, repairAuctionKeeper, repairAuctionTerms, prepareKeeperCollateralRepairAuction } from '../support/collateral-repair-auction.ts'
import { serveMockChainRpc } from '../support/mock-chain-rpc.ts'

async function bidPosition(reader: Parameters<typeof loadSecurityPoolObservation>[0], capital: Address, bidId: bigint) {
	const [position] = await reader.readContract({ address: capital, abi: capitalAbi, functionName: 'repairAuctionPositions', args: [[bidId]] })
	if (position === undefined) throw new Error('Missing auction bid position')
	return position
}

describe('security pool operator funded auction capital integration', () => {
	// 1,971 bps makes per-second fees on whole ETH exact (year * 10,000 / 1,971 = 160,000,000),
	// preserving multiple equal lots while retaining profitable holding-fee income.
	const fixture = useSecurityPoolFixture({ annualFeeBps: 1971n })
	test('a keeper authenticates lazy winners and acquires a distressed winner with bounded gas', async () => {
		const context = await prepareKeeperCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		const terms = await repairAuctionTerms(context)
		// Divide the actual target between two winners; both must remain virtual
		// and the second must retain enough commitment for a partial repair.
		const first = await context.bid(context.owner, 1n, terms.repPerLot)
		const second = await context.bid(context.other, terms.lotCount - 1n, terms.repPerLot)
		await context.closingQuote()
		await context.finalize()
		const keeperOperator = repairAuctionKeeper(fixture, context)
		const { account, reader, scope, settings, wallet } = keeperOperator
		await context.mock.setBalance(account.address, unit / 50n)
		const ownerExposure = await loadSecurityPoolObservation(reader, settings, context.owner.account.address, scope, await reader.getBlockNumber())
		// Unclaimed winning lots are outside the account view, so exposure adds them per bid; no open bid needs a reserve.
		const firstLots = await bidPosition(reader, context.capital, first.id)
		expect(firstLots.claimed).toBe(false)
		expect(firstLots.materialized).toBe(false)
		expect(ownerExposure.snapshot.unclaimedRepairAuctionBids).toBe(1n)
		expect(ownerExposure.managedPrincipalAttoRep).toBe(ownerExposure.snapshot.ownerPrincipalAttoRep + firstLots.principal)
		expect(ownerExposure.managedCommitmentAttoEth).toBe(ownerExposure.snapshot.ownerCommitmentAttoEth + firstLots.commitment)
		expect(ownerExposure.pendingAuction).toBeUndefined()
		const initial = await loadSecurityPoolObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
		const virtual = initial.positions.filter(position => position.auctionTarget !== undefined)
		expect(virtual.map(position => position.auctionTarget?.bidId)).toEqual([first.id, second.id])
		const cohort = await context.owner.readContract({ address: context.capital, abi: capitalAbi, functionName: 'repairAuctionCohort' })
		expect(initial.positions.filter(position => position.auctionTarget === undefined).some(position => position.id === cohort[1])).toBe(false)
		// Each target is its bidder's whole position after that one bid is claimed into it.
		expect(virtual.map(position => position.owner)).toEqual([first.bidder, second.bidder])
		expect(virtual[0]?.rep).toBeGreaterThanOrEqual(firstLots.principal)
		expect(virtual[0]?.commitment).toBeGreaterThanOrEqual(firstLots.commitment)
		await context.report(3n * unit)
		const observation = await loadSecurityPoolObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
		const target = observation.positions.find(position => position.auctionTarget?.bidId === first.id)
		if (target === undefined) throw new Error('Missing authenticated auction target')
		expect(target.maxHealthyPrice).toBeLessThan(observation.snapshot.liquidationPrice)
		const estimates: bigint[] = []
		settings.securityPoolPolicy.minimumNetRewardAttoEth = 0n
		const { pool, state, stop } = await serveMockChainRpc(context.mock, settings, account.address, scope, (method, result) => {
			if (method === 'eth_estimateGas' && typeof result === 'string') estimates.push(BigInt(result))
		})
		try {
			// Cures are unpaid, so the keeper never cures standalone and both winners stay virtual until a funded acquisition.
			expect((await bidPosition(reader, context.capital, first.id)).materialized).toBe(false)
			await context.mock.setBalance(account.address, 100n * unit)
			const { next, winner } = await distressedSecondWinner(context, keeperOperator, second.id)
			for (let step = 0; step < 3; step++) {
				const before = state.activities.filter(activity => activity.status === 'confirmed').length
				await executeSecurityPoolTakeover(wallet, settings, state, pool, next, securityPoolTarget(winner), async () => true)
				expect(state.activities.filter(activity => activity.status === 'confirmed')).toHaveLength(before + 1)
				const after = await bidPosition(reader, context.capital, second.id)
				expect(after.materialized).toBe(step === 2)
				expect(after.claimed).toBe(step === 2)
			}
			const taken = await reader.readContract({ address: context.capital, abi: capitalAbi, functionName: 'ownerCollateral', args: [account.address] })
			expect(taken[1]).toBeGreaterThan(unit)
			expect(taken[1]).toBeLessThan(winner.commitment)
			const acquisition = state.activities.find(activity => activity.status === 'confirmed')
			if (acquisition?.hash === undefined) throw new Error('Takeover was not confirmed')
			const acquiredTransaction = await reader.getTransaction({ hash: acquisition.hash })
			const acquiredReceipt = await reader.waitForTransactionReceipt({ hash: acquisition.hash })
			const acquisitionEstimate = estimates.at(-1)
			if (acquisitionEstimate === undefined) throw new Error('Takeover gas estimate missing')
			expect(acquiredTransaction.gas).toBe(paddedTransactionGas(acquisitionEstimate + SECURITY_POOL_CHECKPOINT_GAS_RESERVE))
			expect(acquiredTransaction.gas).toBeLessThanOrEqual(16_777_216n)
			expect(acquiredReceipt.status).toBe('success')
			if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ auctionKeeperTakeoverGas: { estimate: estimates.at(-1), signed: acquiredTransaction.gas, used: acquiredReceipt.gasUsed } })
		} finally {
			await stop()
		}
	})
})
