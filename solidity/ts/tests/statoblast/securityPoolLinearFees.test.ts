import { loadCompleteSetRedemptionQuote } from '../../../../ui/statoblastShared/ts/protocol/redemptionQuote.js'
import { describe, expect, test } from 'bun:test'
import {
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_SecurityPoolPurchase_SecurityPoolPurchase as purchaseArtifact,
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCapitalFeeStreams_SecurityPoolCapitalFeeStreams as streamArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
} from '../../types/contractArtifact'
import { loadSecurityPoolCapitalSnapshot, loadSecurityPoolClaimableEarnings } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/questionLedger'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'

describe('Statoblast: central question fees and vested capital earnings', () => {
	const fixture = useSecurityPoolFixture()
	const capital = () => ({ abi: capitalArtifact.abi, address: fixture.capitalLedger })
	const checkpoint = () => writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...capital(), functionName: 'checkpoint' }))
	const question = async () => {
		const settlement = await fixture.owner().readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const book = await fixture.owner().readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const bookId = await fixture.owner().readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [fixture.base.genesisUniverse] })
		return (await fixture.owner().readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, fixture.base.questionId] }))[0]
	}

	test('#1706 public fee schedule matches the applied rounded end', async () => {
		await fixture.prepare()
		await fixture.mint(100n * unit)
		const state = await question()
		const helper = await fixture.owner().readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'quoteHelper' })
		const [rate, stop] = await fixture.owner().readContract({ abi: purchaseArtifact.abi, address: helper, functionName: 'feeStream', args: [fixture.poolFor(fixture.base.questionId).questionLedger] })
		expect([rate, stop]).toEqual([state.feeRateAttoEthPerSecond, BigInt(state.feeEnd)])
		const settlement = await fixture.owner().readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const book = await fixture.owner().readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const discarded = await fixture.owner().readContract({ abi: bookArtifact.abi, address: book, functionName: 'normalizeFeeStream', args: [1n, 86_999n, 86_400n, 599n] })
		expect([...discarded]).toEqual([0n, 0n])
	})

	test('#1246 purchase premium quotes use the same fractional backing as minting', async () => {
		await fixture.prepare()
		await fixture.mint(300_000_000n)
		await fixture.base.mockWindow.advanceTime(300n)
		await checkpoint()
		const client = fixture.owner()
		const settlement = await client.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const book = await client.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const bookId = await client.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [fixture.base.genesisUniverse] })
		const [state] = await client.readContract({ abi: bookArtifact.abi, address: book, functionName: 'scaledQuestion', args: [bookId, fixture.base.questionId] })
		const cash = 10n ** 24n
		const shares = (cash * 1_000_000_000n * state.outcomeSupplyAttoShares) / state.units
		const principalUnits = (state.feePrincipalAttoEth * shares + state.outcomeSupplyAttoShares - 1n) / state.outcomeSupplyAttoShares
		const principal = (principalUnits + 1_000_000_000n - 1n) / 1_000_000_000n
		const denominator = 10_000n * 365n * 86_400n
		const expected = (principal * 1_000n * 52n * 86_400n + denominator - 1n) / denominator
		const [, premium] = await client.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'purchaseQuote', args: [fixture.base.genesisUniverse, fixture.base.questionId, cash] })
		expect(premium).toBe(expected)
	})

	test('#1246 low-decimal-sized principal pays holding fees over elapsed time', async () => {
		await fixture.prepare()
		await fixture.mint(300_000_000n)
		const before = await question()
		await fixture.base.mockWindow.advanceTime(300n)
		await checkpoint()
		const after = await question()
		const paid = before.units - after.units
		expect(paid).toBeGreaterThanOrEqual(280n)
		expect(paid).toBeLessThanOrEqual(300n)
	})

	test('purchase fees use the same backing-based rule on every buy and reject insufficient budgets atomically', async () => {
		await fixture.prepare()
		const target = { abi: securityPoolArtifact.abi, address: fixture.securityPool }
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
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: poolArtifact.abi, address: fixture.poolFor(fixture.base.questionId).questionLedger, functionName: 'refreshSecurityPoolFees' }))
		expect((await question()).feeRateAttoEthPerSecond).toBe(initial.feeRateAttoEthPerSecond)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...capital(), functionName: 'setCommitment', args: [0n] }))
		expect((await question()).feeRateAttoEthPerSecond).toBe(initial.feeRateAttoEthPerSecond)
		expect(initial.feeRateAttoEthPerSecond).toBe((initial.feePrincipalAttoEth * 1_000n * 1_000_000_000n) / (10_000n * 365n * 86_400n))
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
		await redeemCompleteSet(fixture.owner(), pool.questionLedger, ownShares[0])
		const after = await question()
		expect(after.outcomeSupplyAttoShares).toBe(initial.outcomeSupplyAttoShares)
		expect(after.feePrincipalAttoEth).toBeGreaterThanOrEqual(initial.feePrincipalAttoEth - 2n)
		expect(after.feePrincipalAttoEth).toBeLessThanOrEqual(initial.feePrincipalAttoEth + 2n)
	})

	test('a read-only checkpoint shows passive earnings the ledger has not credited yet, and claiming pays them', async () => {
		await fixture.prepare()
		await fixture.mint(100n * unit)
		await fixture.base.mockWindow.advanceTime(100n)
		const client = fixture.owner()
		const owner = client.account.address
		const credited = await loadSecurityPoolCapitalSnapshot({ client, owner, securityPool: fixture.securityPool })
		expect(credited.accruedFeesAttoEth).toBe(0n)
		const claimable = await loadSecurityPoolClaimableEarnings(credited, async (contracts, blockNumber) => await client.multicall({ contracts, allowFailure: false, blockNumber, multicallAddress: getInfraContractAddresses().multicall3 }))
		expect(claimable.attoEth).toBeGreaterThan(0n)
		const token = await client.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'collateralToken' })
		const collateralBefore = await getERC20Balance(client, token, owner)
		const nativeBefore = await client.getBalance({ address: owner })
		const receipt = await client.waitForTransactionReceipt({ hash: await writeContractAndWait(client, () => client.writeContract({ ...capital(), functionName: 'claimEarnings', args: [client.account.address] })) })
		if (receipt.effectiveGasPrice === undefined) throw new Error('The claim receipt has no gas price.')
		const received = (await getERC20Balance(client, token, owner)) - collateralBefore
		expect(nativeBefore - (await client.getBalance({ address: owner }))).toBe(receipt.gasUsed * receipt.effectiveGasPrice)
		// The claim runs a moment after the preview, so it can only have earned more.
		expect(received).toBeGreaterThanOrEqual(claimable.attoEth)
		expect((await loadSecurityPoolCapitalSnapshot({ client, owner, securityPool: fixture.securityPool })).accruedFeesAttoEth).toBe(0n)
	})

	test('#1332 prepaid purchase rewards remain earned by the existing backing after price expiry', async () => {
		await fixture.prepare()
		const cash = 100n * unit
		const [fee, premium] = await fixture.owner().readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'purchaseQuote', args: [fixture.base.genesisUniverse, fixture.base.questionId, cash] })
		await fixture.mint(cash)
		await fixture.base.mockWindow.advanceTime(2n * 86_400n)
		await checkpoint()
		const owner = await loadSecurityPoolCapitalSnapshot({ client: fixture.owner(), owner: fixture.owner().account.address, securityPool: fixture.securityPool })
		expect(owner.accruedFeesAttoEth).toBeGreaterThanOrEqual(fee - premium - 1n)
	})

	test('new deposits do not capture old earnings and stale time stops charging outcome holders', async () => {
		await fixture.prepare()
		await fixture.mint(100n * unit)
		await fixture.base.mockWindow.advanceTime(100n)
		await checkpoint()
		const owner = await loadSecurityPoolCapitalSnapshot({ client: fixture.owner(), owner: fixture.owner().account.address, securityPool: fixture.securityPool })
		expect(owner.accruedFeesAttoEth).toBeGreaterThan(0n)
		await fixture.deposit(100n * unit, fixture.other())
		const newcomer = await loadSecurityPoolCapitalSnapshot({ client: fixture.other(), owner: fixture.other().account.address, securityPool: fixture.securityPool })
		expect(newcomer.accruedFeesAttoEth).toBe(0n)
		await fixture.base.mockWindow.setTime(await fixture.owner().readContract({ ...capital(), functionName: 'priceValidUntil' }))
		await checkpoint()
		const demand = await fixture.owner().readContract({ ...capital(), functionName: 'demandAttoEth' })
		await fixture.base.mockWindow.advanceTime(100n)
		await checkpoint()
		expect(await fixture.owner().readContract({ ...capital(), functionName: 'demandAttoEth' })).toBe(demand)
	})

	test('#1633 native redemption accepts accrued holding fees without a collateral minimum', async () => {
		await fixture.prepare()
		const client = fixture.other()
		await fixture.mint(100n * unit)
		const pool = fixture.poolFor(fixture.base.questionId).questionLedger
		const shares = unit
		const reviewedCash = await client.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'attoSharesToAttoEth', args: [shares] })
		await fixture.base.mockWindow.advanceTime(120n)
		const saved = await fixture.base.mockWindow.anvilSnapshot()
		await fixture.base.mockWindow.advanceTime(1n)
		const publicQuote = await client.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'attoSharesToAttoEth', args: [shares] })
		const quote = await loadCompleteSetRedemptionQuote(client, pool, shares, await client.getBlockNumber())
		expect(quote.cash).toBe(publicQuote)
		expect(quote.cash).toBeLessThan(reviewedCash)
		expect(quote.cash).toBeLessThan(shares)
		const token = await client.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'collateralToken' })
		const before = await getERC20Balance(client, token, client.account.address)
		await fixture.base.mockWindow.anvilRevert(saved)
		await writeContractAndWait(client, () => client.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'redeemCompleteSet', args: [shares] }))
		expect((await getERC20Balance(client, token, client.account.address)) - before).toBe(quote.cash)
	})

	test('full complete-set redemption cancels future question fees and preserves nonrefundable vested purchase income', async () => {
		await fixture.prepare()
		await fixture.mint(100n * unit)
		const pool = fixture.poolFor(fixture.base.questionId)
		const balances = await balanceOfShares(fixture.owner(), pool.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)
		await redeemCompleteSet(fixture.other(), pool.questionLedger, balances[0])
		expect(await fixture.owner().readContract({ ...capital(), functionName: 'demandAttoEth' })).toBe(0n)
		expect((await question()).feePrincipalAttoEth).toBe(0n)
		expect(await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool.questionLedger, functionName: 'shareTokenSupplyAttoShares' })).toBe(0n)
		const streams = await fixture.owner().readContract({ ...capital(), functionName: 'feeStreams' })
		expect((await fixture.owner().readContract({ abi: streamArtifact.abi, address: streams, functionName: 'fundedOutstanding' }))[0]).toBeGreaterThan(0n)
	})
})

describe('Statoblast: security pool holding fee backing floor', () => {
	const minimumOutcomeRate = (unit * 9_999_999n) / 10_000_000n
	const fixture = useSecurityPoolFixture({ minimumOutcomeRate })
	test('capital checkpoints stop fees at the floor and purchases and redemptions remain available', async () => {
		await fixture.prepare()
		// The budget above this floor lasts about 31 seconds, and stream ends round down to the book's
		// granularity. Buy 20 seconds before a granularity boundary so the stream ends at that boundary.
		const settlement = await fixture.owner().readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const book = await fixture.owner().readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const granularity = await fixture.owner().readContract({ abi: bookArtifact.abi, address: book, functionName: 'feeEndGranularity' })
		const boundary = ((await fixture.base.mockWindow.getTime()) / granularity + 1n) * granularity + granularity
		await fixture.base.mockWindow.setTime(boundary - 700n)
		await fixture.refreshPrice()
		await fixture.base.mockWindow.setTime(boundary - 21n)
		await fixture.mint(100n * unit)
		const capital = { abi: capitalArtifact.abi, address: fixture.capitalLedger }
		const checkpoint = () => writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...capital, functionName: 'checkpoint' }))
		const demand = () => fixture.owner().readContract({ ...capital, functionName: 'demandAttoEth' })
		await fixture.base.mockWindow.advanceTime(100n)
		await checkpoint()
		const remaining = await demand()
		expect(remaining).toBeGreaterThanOrEqual(100n * minimumOutcomeRate)
		expect(remaining).toBeLessThan(100n * unit)
		await fixture.base.mockWindow.advanceTime(100n)
		await checkpoint()
		expect(await demand()).toBe(remaining)
		await fixture.mint(unit, fixture.base.questionId, { sender: fixture.owner() })
		const pool = fixture.poolFor(fixture.base.questionId)
		const ownShares = await balanceOfShares(fixture.owner(), pool.shareToken, fixture.base.genesisUniverse, fixture.owner().account.address)
		await redeemCompleteSet(fixture.owner(), pool.questionLedger, ownShares[0])
		expect(await demand()).toBeGreaterThanOrEqual(100n * minimumOutcomeRate)
	})
})

describe('Statoblast: low-rate residual exits', () => {
	// A full backing floor leaves no holding-fee budget, including for the final share.
	const fixture = useSecurityPoolFixture({ annualFeeBps: 1n, minimumOutcomeRate: unit })
	test('an exhausted residual can be redeemed even when its new fee rate rounds to zero', async () => {
		await fixture.prepare()
		await fixture.mint(unit)
		const buyer = fixture.other()
		const pool = fixture.poolFor(fixture.base.questionId)
		const [shares] = await balanceOfShares(buyer, pool.shareToken, fixture.base.genesisUniverse, buyer.account.address)
		await redeemCompleteSet(buyer, pool.questionLedger, shares - 1n)
		const settlement = await buyer.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const book = await buyer.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const bookId = await buyer.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [fixture.base.genesisUniverse] })
		const [residual] = await buyer.readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, fixture.base.questionId] })
		expect(residual.outcomeSupplyAttoShares).toBe(1n)
		expect(residual.feeRateAttoEthPerSecond).toBe(0n)
		expect(await buyer.readContract({ abi: bookArtifact.abi, address: book, functionName: 'scaledAvailableFeeBudget', args: [bookId, fixture.base.questionId] })).toBe(0n)
		await redeemCompleteSet(buyer, pool.questionLedger, 1n)
		const [closed] = await buyer.readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, fixture.base.questionId] })
		expect(closed.outcomeSupplyAttoShares).toBe(0n)
		expect((await buyer.readContract({ abi: bookArtifact.abi, address: book, functionName: 'totals', args: [bookId] })).slice(0, 2)).toEqual([0n, 0n])
	})
})
