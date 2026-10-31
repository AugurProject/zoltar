import { describe, expect, test } from 'bun:test'
import {
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCapitalFeeStreams_SecurityPoolCapitalFeeStreams as streamArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
} from '../../types/contractArtifact'
import { loadPortfolioCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: central question fees and vested capital earnings', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const capital = () => ({ abi: capitalArtifact.abi, address: fixture.capitalLedger })
	const checkpoint = () => writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...capital(), functionName: 'checkpoint' }))
	const question = async () => {
		const settlement = await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'settlement' })
		const book = await fixture.owner().readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const bookId = await fixture.owner().readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [fixture.base.genesisUniverse] })
		return (await fixture.owner().readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, fixture.base.questionId] }))[0]
	}

	test('purchase fees use the same backing-based rule on every buy and reject insufficient budgets atomically', async () => {
		await fixture.prepare()
		const target = { abi: portfolioArtifact.abi, address: fixture.portfolio }
		const fee = await fixture.owner().readContract({ ...target, functionName: 'purchaseFee', args: [10n * unit] })
		expect(fee).toBe((200n * unit) / 1_000n)
		expect(await fixture.owner().readContract({ ...target, functionName: 'purchaseFee', args: [1n] })).toBe(unit / 1_000n)
		await expect(fixture.mint(10n * unit, fixture.base.questionId, { budget: fee - 1n })).rejects.toThrow('Purchase fee exceeds budget')
		expect(await fixture.owner().readContract({ ...capital(), functionName: 'demandAttoEth' })).toBe(0n)
		await fixture.mint(10n * unit)
		expect(await fixture.owner().readContract({ ...target, functionName: 'purchaseFee', args: [10n * unit] })).toBe(fee)
		const streams = await fixture.owner().readContract({ ...capital(), functionName: 'feeStreams' })
		expect((await fixture.owner().readContract({ abi: streamArtifact.abi, address: streams, functionName: 'fundedOutstanding' }))[0]).toBeGreaterThan(0n)
	})

	test('temporary capacity cannot lower a question fee or leave a discounted stream after retiring', async () => {
		await fixture.prepare()
		await fixture.mint(100n * unit)
		const initial = await question()
		await fixture.deposit(500n * unit, fixture.other())
		await fixture.authorize(200n * unit, fixture.other())
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: poolArtifact.abi, address: fixture.poolFor(fixture.base.questionId).securityPool, functionName: 'refreshPortfolioFees' }))
		expect((await question()).feeRateAttoEthPerSecond).toBe(initial.feeRateAttoEthPerSecond)
		const temporary = await fixture.other().readContract({ ...capital(), functionName: 'ownerAccount', args: [fixture.other().account.address] })
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...capital(), functionName: 'requestRetirement', args: [temporary.positionId, 0n] }))
		expect((await question()).feeRateAttoEthPerSecond).toBe(initial.feeRateAttoEthPerSecond)
		expect(initial.feeRateAttoEthPerSecond).toBe((initial.feePrincipalAttoEth * 1_000n) / (10_000n * 365n * 86_400n))
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...capital(), functionName: 'withdrawPrincipal', args: [500n * unit, fixture.other().account.address] }))
	})

	test('checkpointing does not rebase fee principal, and a round trip preserves the old shares fee basis', async () => {
		await fixture.prepare()
		await fixture.mint(100n * unit)
		const initial = await question()
		expect(initial.feePrincipalAttoEth).toBe(100n * unit)
		expect(initial.feeRateAttoEthPerSecond).toBeGreaterThan(0n)
		await fixture.base.mockWindow.advanceTime(30n)
		await checkpoint()
		expect((await question()).feePrincipalAttoEth).toBe(initial.feePrincipalAttoEth)
		await fixture.mint(10n * unit, fixture.base.questionId, { sender: fixture.owner() })
		const pool = fixture.poolFor(fixture.base.questionId)
		const ownShares = await balanceOfShares(fixture.owner(), pool.shareToken, fixture.base.genesisUniverse, fixture.owner().account.address)
		await redeemCompleteSet(fixture.owner(), pool.securityPool, ownShares[0])
		const after = await question()
		expect(after.outcomeSupplyAttoShares).toBe(initial.outcomeSupplyAttoShares)
		expect(after.feePrincipalAttoEth).toBeGreaterThanOrEqual(initial.feePrincipalAttoEth - 2n)
		expect(after.feePrincipalAttoEth).toBeLessThanOrEqual(initial.feePrincipalAttoEth + 2n)
	})

	test('new deposits do not capture old earnings and stale time stops charging outcome holders', async () => {
		await fixture.prepare()
		await fixture.mint(100n * unit)
		await fixture.base.mockWindow.advanceTime(100n)
		await checkpoint()
		const owner = await loadPortfolioCapitalSnapshot({ client: fixture.owner(), owner: fixture.owner().account.address, portfolio: fixture.portfolio })
		expect(owner.accruedFeesAttoEth).toBeGreaterThan(0n)
		await fixture.deposit(100n * unit, fixture.other())
		const newcomer = await loadPortfolioCapitalSnapshot({ client: fixture.other(), owner: fixture.other().account.address, portfolio: fixture.portfolio })
		expect(newcomer.accruedFeesAttoEth).toBe(0n)
		await fixture.base.mockWindow.setTime(await fixture.owner().readContract({ ...capital(), functionName: 'priceValidUntil' }))
		await checkpoint()
		const demand = await fixture.owner().readContract({ ...capital(), functionName: 'demandAttoEth' })
		await fixture.base.mockWindow.advanceTime(100n)
		await checkpoint()
		expect(await fixture.owner().readContract({ ...capital(), functionName: 'demandAttoEth' })).toBe(demand)
	})

	test('full complete-set redemption cancels future question fees and preserves nonrefundable vested purchase income', async () => {
		await fixture.prepare()
		await fixture.mint(100n * unit)
		const pool = fixture.poolFor(fixture.base.questionId)
		const balances = await balanceOfShares(fixture.owner(), pool.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)
		await redeemCompleteSet(fixture.other(), pool.securityPool, balances[0])
		expect(await fixture.owner().readContract({ ...capital(), functionName: 'demandAttoEth' })).toBe(0n)
		expect((await question()).feePrincipalAttoEth).toBe(0n)
		expect(await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool.securityPool, functionName: 'shareTokenSupplyAttoShares' })).toBe(0n)
		const streams = await fixture.owner().readContract({ ...capital(), functionName: 'feeStreams' })
		expect((await fixture.owner().readContract({ abi: streamArtifact.abi, address: streams, functionName: 'fundedOutstanding' }))[0]).toBeGreaterThan(0n)
	})
})
