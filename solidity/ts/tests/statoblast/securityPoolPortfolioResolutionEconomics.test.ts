import { describe, expect, test } from 'bun:test'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPoolPortfolioServices_SecurityPoolPortfolioServices as servicesArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCapitalFeeStreams_SecurityPoolCapitalFeeStreams as streamsArtifact,
	test_statoblast_PortfolioPurchaseReceiver_PortfolioPurchaseReceiver as receiverArtifact,
} from '../../types/contractArtifact'
import { portfolioEconomics, unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'
import { collateralBalance, burnedCollateralBalance, receiptBurns } from './burnEvidence'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { approveToken, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { encodeDeployData } from '@zoltar/core-shared/evm/ethereum'
import { deployContract } from '../../testSupport/deployContract'
import { applyLibraries } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { loadPortfolioCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'

describe('Statoblast: reporting and unresolved capital compensation', () => {
	const fixture = useSecurityPoolPortfolioFixture({})
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const pool = () => ({ abi: poolArtifact.abi, address: fixture.poolFor(fixture.base.questionId).securityPool })
	const service = async () => ({ abi: servicesArtifact.abi, address: await fixture.owner().readContract({ ...portfolio(), functionName: 'services' }) })
	const questionState = async () => {
		const client = fixture.owner()
		const engine = await client.readContract({ ...portfolio(), functionName: 'settlement' })
		const book = await client.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' })
		const bookId = await client.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [fixture.base.genesisUniverse] })
		return (await client.readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, fixture.base.questionId] }))[0]
	}
	const report = async (sender: WriteClient, outcome: number, amount = 100n * unit) => {
		await approveToken(sender, getRepTokenAddress(fixture.base.genesisUniverse), pool().address)
		await writeContractAndWait(sender, () => sender.writeContract({ ...pool(), functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
		return sender.readContract({ ...pool(), functionName: 'escalationGame' })
	}
	const mature = async (game: `0x${string}`) => {
		const deadline = await fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		// The inverse attrition curve rounds independently of its forward value.
		await fixture.base.mockWindow.setTime(deadline + 60n)
	}
	test('purchases pay only backing fees and resolution premium, with no reporting subsidy', async () => {
		await fixture.prepare()
		const cash = 10n * unit
		const quote = await fixture.owner().readContract({ ...portfolio(), functionName: 'purchaseQuote', args: [fixture.base.genesisUniverse, fixture.base.questionId, cash] })
		const base = await fixture.owner().readContract({ ...portfolio(), functionName: 'purchaseFee', args: [cash] })
		expect(quote[0]).toBe(base + quote[1])
		await fixture.mint(cash)
		const shares = await balanceOfShares(fixture.other(), fixture.poolFor(fixture.base.questionId).shareToken, fixture.base.genesisUniverse, fixture.other().account.address)
		expect((await questionState()).outcomeSupplyAttoShares).toBe(shares[0])
	})
	test('base purchase quotes preserve separate collateral and fee rounding at dust boundaries', async () => {
		await fixture.prepare()
		for (const minimum of [0n, 3n]) {
			const created = await fixture.deployPortfolio(undefined, { ...portfolioEconomics, purchaseFeeBps: 4_000n, annualFeeBps: 0n, minimumPurchaseFeeAttoEth: minimum }, { securityMultiplierBps: 10_002n })
			// The effective 105% backing floor rounds 2 attoETH to 3, then its 40% fee to 2.
			// One combined division would charge only 1. Minimum fees apply after both steps.
			for (const [cash, expected] of [
				[1n, 1n],
				[2n, 2n],
				[19n, 8n],
				[20n, 9n],
				[21n, 10n],
			]) {
				if (cash === undefined || expected === undefined) throw new Error('Missing rounding case')
				const expectedFee = expected > minimum ? expected : minimum
				expect(await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: created, functionName: 'purchaseFee', args: [cash] })).toBe(expectedFee)
				const quote = await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: created, functionName: 'purchaseQuote', args: [fixture.base.genesisUniverse, fixture.base.questionId, cash] })
				expect([...quote]).toEqual([expectedFee, 0n])
			}
		}
	})
	test('an unreported question keeps paying for occupied underwriting after its calendar end', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const question = await questionState()
		expect(BigInt(question.feeEnd)).toBeGreaterThan(fixture.base.questionData.endTime)
	})
	test('purchases above healthy capacity fail atomically', async () => {
		await fixture.prepare()
		const capacity = await fixture.owner().readContract({ ...portfolio(), functionName: 'availableMintCapacity', args: [fixture.base.genesisUniverse] })
		await expect(fixture.mint(capacity + 1n)).rejects.toThrow('Purchase exceeds healthy capacity')
		expect((await questionState()).outcomeSupplyAttoShares).toBe(0n)
		expect((await fixture.owner().readContract({ ...(await service()), functionName: 'questionPremium', args: [fixture.base.genesisUniverse, fixture.base.questionId] }))[1]).toBe(0n)
	})
	test('every purchase pays only its premium and the whole base fee to underwriters', async () => {
		await fixture.prepare()
		const amount = 10n * unit
		const quote = async () => {
			const [fee, premium] = await fixture.owner().readContract({ ...portfolio(), functionName: 'purchaseQuote', args: [fixture.base.genesisUniverse, fixture.base.questionId, amount] })
			return { fee, premium }
		}
		const base = await fixture.owner().readContract({ ...portfolio(), functionName: 'purchaseFee', args: [amount] })
		const streams = await fixture.owner().readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'feeStreams' })
		const outstanding = async () => (await fixture.owner().readContract({ abi: streamsArtifact.abi, address: streams, functionName: 'fundedOutstanding' }))[0]
		const paidFor = async (expected: bigint, drift = 0n) => {
			const buyer = fixture.other()
			const before = await collateralBalance(buyer, fixture.portfolio, buyer.account.address)
			const burnedBefore = await burnedCollateralBalance(buyer, fixture.portfolio)
			const outstandingBefore = await outstanding()
			const hash = await fixture.mint(amount)
			const receipt = await buyer.getTransactionReceipt({ hash })
			expect(receipt.status).toBe('success')
			const paid = before - (await collateralBalance(buyer, fixture.portfolio, buyer.account.address))
			expect(paid).toBeGreaterThanOrEqual(amount + expected)
			expect(paid).toBeLessThanOrEqual(amount + expected + drift)
			// The entire base fee vests to underwriters; no part funds a service budget or is burned.
			// Earlier streams may vest a few seconds during the purchase checkpoint.
			const funded = (await outstanding()) - outstandingBefore
			expect(funded).toBeLessThanOrEqual(base)
			expect(funded).toBeGreaterThan(base - outstandingBefore / 1_000n - 1n)
			expect(await burnedCollateralBalance(buyer, fixture.portfolio)).toBe(burnedBefore)
		}
		const first = await quote()
		expect(first.premium).toBeGreaterThan(0n)
		expect(first.fee).toBe(base + first.premium)
		await paidFor(first.fee)
		const second = await quote()
		expect(second.fee).toBe(base + second.premium)
		// Holding fees change the principal basis between the quote and mined purchase.
		await paidFor(second.fee, unit / 100_000_000n)
	})
	test('recipient callbacks observe the completed purchase premium accounting', async () => {
		await fixture.prepare()
		const services = await service()
		const receiver = await deployContract(fixture.owner(), encodeDeployData({ abi: receiverArtifact.abi, bytecode: applyLibraries(receiverArtifact.evm.bytecode.object), args: [services.address, fixture.base.genesisUniverse, fixture.base.questionId] }))
		await fixture.mint(10n * unit, fixture.base.questionId, { recipient: receiver })
		const observed = await fixture.owner().readContract({ abi: receiverArtifact.abi, address: receiver, functionName: 'observedPremium' })
		expect(observed).toBeGreaterThan(0n)
		expect(observed).toBe((await fixture.owner().readContract({ ...services, functionName: 'questionPremium', args: [fixture.base.genesisUniverse, fixture.base.questionId] }))[1])
	})
	test('returning all trader complete sets releases the premium without any question sweep', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const services = await service()
		const premiumCash = (await fixture.owner().readContract({ ...services, functionName: 'questionPremium', args: [fixture.base.genesisUniverse, fixture.base.questionId] }))[1]
		expect(premiumCash).toBeGreaterThan(0n)
		const native = fixture.poolFor(fixture.base.questionId)
		const shares = await balanceOfShares(fixture.other(), native.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)
		const burnedBefore = await burnedCollateralBalance(fixture.owner(), fixture.portfolio)
		const hash = await redeemCompleteSet(fixture.other(), native.securityPool, shares[0])
		expect((await fixture.owner().readContract({ ...services, functionName: 'questionPremium', args: [fixture.base.genesisUniverse, fixture.base.questionId] }))[1]).toBe(0n)
		// The cancelled premium has no recorded payer and is burned rather than kept by services.
		const cancelled = (await receiptBurns(fixture.owner(), hash)).service.filter(entry => entry.universeId === fixture.base.genesisUniverse).reduce((total, entry) => total + entry.amount, 0n)
		expect(cancelled).toBeGreaterThan(0n)
		expect(cancelled).toBeLessThanOrEqual(premiumCash)
		expect((await burnedCollateralBalance(fixture.owner(), fixture.portfolio)) - burnedBefore).toBeGreaterThanOrEqual(cancelled)
		const question = await questionState()
		expect(question.outcomeSupplyAttoShares).toBe(0n)
	})

	test('reporting earns its premium only until actual finality and the unearned remainder is burned', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const services = await service()
		const premium = await fixture.owner().readContract({ ...services, functionName: 'questionPremium', args: [fixture.base.genesisUniverse, fixture.base.questionId] })
		expect(premium[1]).toBeGreaterThan(0n)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		const game = await report(fixture.owner(), 1)
		expect((await fixture.owner().readContract({ ...services, functionName: 'questionPremium', args: [fixture.base.genesisUniverse, fixture.base.questionId] }))[1]).toBe(premium[1])
		expect((await questionState()).feeRateAttoEthPerSecond).toBe(0n)
		const burnedBefore = await burnedCollateralBalance(fixture.owner(), fixture.portfolio)
		const servicesCashBefore = await collateralBalance(fixture.owner(), fixture.portfolio, services.address)
		await mature(game)
		const hash = await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'checkpoint' }))
		expect((await fixture.owner().readContract({ ...services, functionName: 'questionPremium', args: [fixture.base.genesisUniverse, fixture.base.questionId] }))[1]).toBe(0n)
		const burns = await receiptBurns(fixture.owner(), hash)
		const unused = burns.service.filter(entry => entry.universeId === fixture.base.genesisUniverse).reduce((total, entry) => total + entry.amount, 0n)
		expect(unused).toBeGreaterThan(0n)
		expect(await burnedCollateralBalance(fixture.owner(), fixture.portfolio)).toBe(burnedBefore + burns.totalEth)
		// Services keep none of the unearned premium: it was either paid to capital or burned.
		expect(await collateralBalance(fixture.owner(), fixture.portfolio, services.address)).toBeLessThanOrEqual(servicesCashBefore - unused)
	})

	test('a minimum-size newcomer cannot collect a large finalized question premium tail', async () => {
		await fixture.prepare()
		await fixture.mint(100n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		const game = await report(fixture.owner(), 1)
		await mature(game)
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'checkpoint' }))
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'setCommitment', args: [0n] }))
		await fixture.refreshPrice()
		await fixture.deposit(10n * unit, fixture.other())
		await fixture.authorize(unit, fixture.other())
		await fixture.base.mockWindow.advanceTime(60n)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'checkpoint' }))
		const newcomer = await loadPortfolioCapitalSnapshot({ client: fixture.other(), owner: fixture.other().account.address, portfolio: fixture.portfolio })
		expect(newcomer.accruedFeesAttoEth).toBe(0n)
	})

	test('stale-price reporting preserves REP claims without an ETH subsidy', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		expect(await fixture.owner().readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'isPriceValid' })).toBe(false)
		const game = await report(fixture.other(), 1)
		await mature(game)
		const reporter = fixture.other()
		const rep = getRepTokenAddress(fixture.base.genesisUniverse)
		const before = await getERC20Balance(reporter, rep, reporter.account.address)
		const ethBefore = await collateralBalance(reporter, fixture.portfolio, reporter.account.address)
		const hash = await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...pool(), functionName: 'withdrawFromEscalationGame', args: [1, [0n]] }))
		expect(await getERC20Balance(reporter, rep, reporter.account.address)).toBeGreaterThan(before)
		expect(await collateralBalance(reporter, fixture.portfolio, reporter.account.address)).toBe(ethBefore)
		expect((await fixture.owner().getTransactionReceipt({ hash })).status).toBe('success')
	})

	test('a sub-bond threshold fill cannot restore an ordinary winner after a leader change', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await fixture.refreshPrice()
		const game = await report(fixture.other(), 1)
		const threshold = await fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'nonDecisionThresholdAttoRep' })
		const bond = await fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'startBondAttoRep' })
		await report(fixture.owner(), 1, threshold - 100n * unit - 1n)
		await report(fixture.owner(), 2, threshold - bond / 2n)
		await report(fixture.owner(), 2, bond)
		await report(fixture.other(), 1, bond)
		expect(await fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'hasReachedNonDecision' })).toBe(true)
	})
})
