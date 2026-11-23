import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_QuestionLedger_QuestionLedger as poolArtifact, statoblast_QuestionForker_QuestionForker as forkerArtifact } from '../types/contractArtifact'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { SparseNullifierTree } from './carryProofHelpers'
import { BRANCH_GAS, createE2E, INVALID, median, NO, NONE, OUTCOMES, YES } from './auditE2EHarness'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

type Variant = 'own-fork' | 'third-party-fork-in-non-decision' | 'third-party-fork-while-contested'

// Scenario 1: the universe forks on the portfolio question itself.
describe('auditE2E: fork on the escalated question conserves reporter REP and settlement cash', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const e2e = createE2E(fixture)

	const run = async (variant: Variant) => {
		const { base } = fixture
		const owner = fixture.owner()
		const trader = fixture.other()
		const U0 = base.genesisUniverse
		const q = base.questionId
		const source = fixture.poolFor(q).questionLedger
		const reporters = [e2e.account(2), e2e.account(3), e2e.account(4), e2e.account(5)] as const
		const [r2, r3, r4, r5] = reporters
		const thirdParty = e2e.account(6)
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const ledger = await e2e.reporterLedger(U0)
		const capital0 = await e2e.capital(U0)
		const engine = await e2e.settlement()
		const coordinator = (await e2e.coordinator()).address
		const sealedCash = await e2e.cash(engine)

		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		const F = await owner.readContract({ ...e2e.zoltar(), functionName: 'getForkThresholdAttoRep', args: [U0] })
		const N = await owner.readContract({ ...e2e.zoltar(), functionName: 'getNonDecisionThresholdAttoRep', args: [U0] })
		const burnDivisor = await owner.readContract({ ...e2e.zoltar(), functionName: 'forkBurnDivisor' })
		const walletStart = new Map<Address, bigint>()
		for (const reporter of [...reporters, thirdParty]) walletStart.set(reporter.account.address, await e2e.rep(U0, reporter.account.address))
		const burnedStart = await e2e.burned()
		const capitalStart = await e2e.rep(U0, capital0)

		// All deposits land inside the three-day activation delay, where the curve is still zero.
		const plan: readonly (readonly [typeof r2, number, bigint])[] =
			variant === 'third-party-fork-while-contested'
				? [
						[r2, YES, 30_000n * unit],
						[r3, NO, 25_000n * unit],
						[r3, YES, 40_000n * unit],
						[r5, NO, 25_000n * unit],
						[r2, YES, 20_000n * unit],
						[r4, YES, 10_000n * unit],
					]
				: [
						[r5, INVALID, N / 10n],
						[r2, YES, N / 4n],
						[r3, NO, N / 3n],
						[r4, INVALID, N / 20n],
						[r3, YES, N / 8n],
						[r5, NO, N / 3n],
						[r2, YES, N / 4n],
						[r4, YES, N],
						[r3, NO, N],
					]
		const paidIn = new Map<Address, bigint>()
		for (const [sender, outcome, amount] of plan) paidIn.set(sender.account.address, (paidIn.get(sender.account.address) ?? 0n) + (await e2e.deposit(sender, source, outcome, amount)))
		const game0 = await e2e.gameOf(source)
		const balances = await e2e.balances(game0)
		const totalDeposited = balances[0] + balances[1] + balances[2]
		const minimum = [...balances].sort((left, right) => (left < right ? -1 : 1))[0] ?? 0n
		const binding = median(balances)
		expect([...paidIn.values()].reduce((sum, value) => sum + value, 0n)).toBe(totalDeposited)
		const nonDecision = variant !== 'third-party-fork-while-contested'
		expect(await owner.readContract({ ...e2e.game(game0), functionName: 'canTriggerOwnFork' })).toBe(nonDecision)
		if (nonDecision) expect(balances[YES]).toBe(N)
		if (nonDecision) expect(balances[NO]).toBe(N)
		// The smallest outcome balance is irrevocable surplus and already left reporter custody.
		expect(await e2e.gameBalance(game0)).toBe(totalDeposited - minimum)
		expect(await e2e.rep(U0, ledger)).toBe(totalDeposited - minimum)
		// The surplus reached the capital ledger as a vesting fee stream. The fixture's price is stale by
		// now, so the part that already vested belongs to no underwriter and the ledger burned it.
		expect((await e2e.rep(U0, capital0)) - capitalStart + (await e2e.burned()) - burnedStart).toBe(minimum)

		// ---- the fork ----
		const supplyBefore = await e2e.supply(U0)
		const liveBefore = totalDeposited - minimum
		const burnedBeforeFork = await e2e.burned()
		const capitalBeforeFork = await e2e.rep(U0, capital0)
		// Burned surplus shrank the theoretical supply, so the live fork threshold is slightly below the game's.
		const forkThreshold = await owner.readContract({ ...e2e.zoltar(), functionName: 'getForkThresholdAttoRep', args: [U0] })
		expect(forkThreshold).toBeLessThanOrEqual(F)
		let haircut = 0n
		if (variant === 'own-fork') {
			// Before non-decision nobody can fork through the game; after it anyone can.
			await writeContractAndWait(thirdParty, () => thirdParty.writeContract({ abi: forkerArtifact.abi, address: e2e.forker().address, functionName: 'forkZoltarWithOwnEscalationGame', args: [source], gas: BRANCH_GAS }))
			haircut = forkThreshold / burnDivisor
			expect(await e2e.rep(U0, thirdParty.account.address)).toBe(walletStart.get(thirdParty.account.address) ?? 0n)
			// Zoltar burned the threshold and credited threshold - haircut; the rest of live custody joined migration 1:1.
			expect(await e2e.rep(U0, ledger)).toBe(0n)
			const capitalBurn = capitalBeforeFork - (await e2e.rep(U0, capital0))
			expect((await e2e.burned()) - burnedBeforeFork).toBe(liveBefore + capitalBurn)
			expect(supplyBefore - (await e2e.supply(U0))).toBe(liveBefore + capitalBurn)
			expect(await owner.readContract({ ...e2e.zoltar(), functionName: 'getMigrationRepBalanceAttoRep', args: [ledger, U0] })).toBe(liveBefore - haircut)
		} else {
			if (variant === 'third-party-fork-while-contested') await base.mockWindow.advanceTime(4n * DAY)
			// A contested game cannot fork through its own escrow; only a wallet-funded native fork can.
			if (!nonDecision) await expect(thirdParty.simulateContract({ abi: forkerArtifact.abi, address: e2e.forker().address, functionName: 'forkZoltarWithOwnEscalationGame', args: [source] })).rejects.toThrow('Reporter game cannot fork')
			await e2e.forkOn(thirdParty, U0, q)
			expect((walletStart.get(thirdParty.account.address) ?? 0n) - (await e2e.rep(U0, thirdParty.account.address))).toBe(forkThreshold)
			await e2e.freeze(U0)
			expect(await e2e.rep(U0, ledger)).toBe(0n)
			expect(await owner.readContract({ ...e2e.zoltar(), functionName: 'getMigrationRepBalanceAttoRep', args: [ledger, U0] })).toBe(liveBefore)
		}
		const [state0] = await e2e.ledgerQuestion(U0, q)
		expect(state0.balanceAttoRep).toBe(liveBefore - haircut)
		expect(state0.winnerHaircutPaidByFork).toBe(variant === 'own-fork')
		expect((await e2e.ledgerBook(U0)).isSealed).toBe(true)

		// The parent pays nothing after its universe forked.
		const parentLeaves = { [INVALID]: await e2e.lineageLeaves([game0], INVALID), [YES]: await e2e.lineageLeaves([game0], YES), [NO]: await e2e.lineageLeaves([game0], NO) }
		for (const outcome of OUTCOMES) {
			const first = parentLeaves[outcome]?.[0]
			if (first === undefined) continue
			await expect(owner.simulateContract({ abi: poolArtifact.abi, address: source, functionName: 'withdrawFromEscalationGame', args: [outcome, [0n]] })).rejects.toThrow()
		}
		await expect(owner.simulateContract({ ...e2e.game(game0), functionName: 'sweepResidualRepToQuestionLedger' })).rejects.toThrow()

		// The only capital owner follows the Yes branch.
		await e2e.choose(owner, U0, YES)
		const children = []
		for (const outcome of OUTCOMES) {
			const child = await e2e.activateBranch(U0, outcome)
			expect(await e2e.rep(child, ledger)).toBe(liveBefore - haircut)
			children.push({ outcome, child, ...(await e2e.materialize(source, child)) })
		}
		let claimedTotal = 0n
		const table: Record<string, unknown>[] = []
		for (const { outcome, child, pool, game } of children) {
			const resumedAt = await e2e.activationTime(child)
			const g = e2e.game(game)
			expect(await owner.readContract({ ...g, functionName: 'fixedQuestionOutcome' })).toBe(BigInt(outcome))
			expect(await owner.readContract({ ...g, functionName: 'winnerHaircutPaidByFork' })).toBe(variant === 'own-fork')
			expect(await owner.readContract({ ...g, functionName: 'forkResumedAt' })).toBe(resumedAt)
			expect(await owner.readContract({ ...g, functionName: 'getEscalationGameEndDate' })).toBe(resumedAt + 3n * DAY)
			expect(await owner.readContract({ ...g, functionName: 'getOutcomeBalancesAttoRep' })).toEqual(balances)
			expect(await e2e.gameBalance(game)).toBe(liveBefore - haircut)
			// New reports are impossible in a child whose outcome the fork fixed.
			await expect(r2.simulateContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, N / 10n] })).rejects.toThrow()
			const leaves = parentLeaves[outcome] ?? []
			const tree = new SparseNullifierTree()
			const firstLeaf = leaves[0]
			// The response period runs for three days from the fixed anchor: nothing is claimable at its last second.
			if ((await base.mockWindow.getTime()) < resumedAt + 3n * DAY) {
				await base.mockWindow.setTime(resumedAt + 3n * DAY)
				expect(await owner.readContract({ ...g, functionName: 'getFinalQuestionResolution' })).toBe(NONE)
				if (firstLeaf !== undefined) await expect(e2e.simulateInheritedClaim(owner, pool, outcome, leaves, firstLeaf, tree)).rejects.toThrow('Question not final')
				await base.mockWindow.setTime(resumedAt + 3n * DAY + 1n)
			}
			expect(await owner.readContract({ ...g, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(outcome))
			// Losers cannot claim in this child.
			for (const losing of OUTCOMES) {
				const loser = parentLeaves[losing]?.[0]
				if (losing === outcome || loser === undefined) continue
				await expect(e2e.simulateInheritedClaim(owner, pool, losing, parentLeaves[losing] ?? [], loser, new SparseNullifierTree())).rejects.toThrow('Not winning outcome')
			}
			const supplyChild = await e2e.supply(child)
			const winning = balances[outcome] ?? 0n
			const { paid, burn } = await e2e.claimEveryWinner(thirdParty, pool, outcome, leaves, binding, winning, tree)
			claimedTotal += paid
			const burnedByClaims = supplyChild - (await e2e.supply(child))
			expect(burnedByClaims).toBe(variant === 'own-fork' ? 0n : burn)
			const residual = await e2e.gameBalance(game)
			expect(residual).toBe(liveBefore - haircut - paid - burnedByClaims)
			if (residual === 0n) await expect(owner.simulateContract({ ...g, functionName: 'sweepResidualRepToQuestionLedger' })).rejects.toThrow('No sweepable REP')
			else await e2e.sweep(thirdParty, game)
			expect(await e2e.gameBalance(game)).toBe(0n)
			expect(await e2e.rep(child, ledger)).toBe(0n)
			expect(await e2e.rep(child, pool)).toBe(0n)
			expect(supplyChild - (await e2e.supply(child))).toBe(burnedByClaims + residual)
			expect(await owner.readContract({ ...g, functionName: 'totalDisputeStakedAttoRep' })).toBe(0n)
			await expect(owner.simulateContract({ ...g, functionName: 'sweepResidualRepToQuestionLedger' })).rejects.toThrow()
			table.push({ child: ['Invalid', 'Yes', 'No'][outcome], winning, paid, burnedByClaims, residualBurned: residual, backing: liveBefore - haircut })
		}
		// Reporter wallets: only child REP moved; genesis REP was spent exactly once.
		for (const reporter of reporters) expect((walletStart.get(reporter.account.address) ?? 0n) - (await e2e.rep(U0, reporter.account.address))).toBe(paidIn.get(reporter.account.address) ?? 0n)
		expect(claimedTotal).toBeGreaterThan(0n)

		// ---- shares and collateral ----
		const cashTable: Record<string, unknown>[] = []
		for (const outcome of OUTCOMES) await e2e.migrateShares(trader, U0, outcome, [INVALID, YES, NO])
		let cashOut = 0n
		for (const { outcome, child, pool } of children) {
			for (const held of OUTCOMES) expect(await e2e.shareBalance(trader.account.address, child, held)).toBe(10n * unit)
			const quoteCash = await owner.readContract({ ...e2e.portfolio(), functionName: 'quoteQuestionSettlement', args: [pool, 10n * unit] })
			const quoteRep = await owner.readContract({ ...e2e.portfolio(), functionName: 'quoteQuestionRecoveryRep', args: [pool, 10n * unit] })
			const custodyRep = await e2e.rep(child, engine)
			const got = await e2e.redeemShares(trader, pool)
			expect(got.cash).toBe(quoteCash)
			expect(got.rep).toBe(quoteRep)
			expect(await e2e.shareBalance(trader.account.address, child, outcome)).toBe(0n)
			expect(await e2e.redeemShares(trader, pool)).toEqual({ cash: 0n, rep: 0n })
			cashOut += got.cash
			cashTable.push({
				child: ['Invalid', 'Yes', 'No'][outcome],
				cash: got.cash,
				recoveryRep: got.rep,
				custodyRepBefore: custodyRep,
				custodyRepAfter: await e2e.rep(child, engine),
				capitalRep: await e2e.rep(child, await e2e.capital(child)),
				coordinatorRep: await e2e.rep(child, coordinator),
				auctionRep: await auctionRep(child),
			})
		}
		expect(cashOut + (await e2e.cash(engine)) + (await e2e.cash(coordinator))).toBe(sealedCash)
		return { table, cashTable }
	}
	const auctionRep = async (child: bigint) => {
		const target = await e2e.coordinator()
		const auction = await fixture.owner().readContract({ ...target, functionName: 'auctions', args: [child] })
		return { auction, rep: await e2e.rep(child, auction) }
	}

	test('own-question fork: haircut once, every carried deposit claims, residual burns, parent pays nothing', async () => {
		await run('own-fork')
	})
	test('a third party forks the universe on the question while the game is in local non-decision', async () => {
		await run('third-party-fork-in-non-decision')
	})
	test('the universe forks on the question while the game is still contested (reward cap coordinates)', async () => {
		await run('third-party-fork-while-contested')
	})
})
