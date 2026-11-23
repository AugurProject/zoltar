import { describe, expect, test } from 'bun:test'
import { zeroHash, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate as depositDelegateArtifact, statoblast_factories_EscalationGameFactory_EscalationGameFactory as factoryArtifact, statoblast_QuestionLedger_QuestionLedger as poolArtifact } from '../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { BRANCH_GAS, createE2E, INVALID, median, NO, YES } from './auditE2EHarness'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

// Removed public selectors must remain unreachable through the signed-deposit fallback.
const claimDelegateArtifact = {
	abi: [
		{ type: 'function', name: 'initializeForkClaimCheckpoint', stateMutability: 'nonpayable', inputs: [{ name: 'source', type: 'address' }], outputs: [] },
		{
			type: 'function',
			name: 'processClaimCheckpoint',
			stateMutability: 'nonpayable',
			inputs: [
				{ name: 'outcome', type: 'uint8' },
				{ name: 'amount', type: 'uint256' },
				{ name: 'cumulative', type: 'uint256' },
				{ name: 'leaf', type: 'uint256' },
				{ name: 'steps', type: 'uint256' },
				{ name: 'base', type: 'bytes32' },
				{ name: 'transforms', type: 'tuple[]', components: [{ name: 'consumedBeforeAttoRep', type: 'uint256' }] },
			],
			outputs: [{ name: '', type: 'bool' }],
		},
	] as const,
}

const K = 1_000n * unit

// The checkpoint, export and forked-escrow selectors are absent from production. No privileged
// or delegate entry point can be reached by an outside caller to move REP or change a payout, in
// a frozen parent game or in a live continuation, whether called on the game, through its
// fallback, or on a shared delegate.
describe('audit4: privileged and claim-checkpoint entry points are inert', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const e2e = createE2E(fixture)

	test('no outside caller can move REP or change a claim through a legacy path', async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const U0 = base.genesisUniverse
		const source = fixture.poolFor(base.questionId).questionLedger
		const [r2, r3, r4, r5, r6] = [e2e.account(2), e2e.account(3), e2e.account(4), e2e.account(5), e2e.account(6)]
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const ledger = await e2e.reporterLedger(U0)
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		const plan: readonly (readonly [WriteClient, number, bigint])[] = [
			[r2, YES, 30n * K],
			[r3, NO, 25n * K],
			[r3, YES, 40n * K],
			[r5, NO, 25n * K],
			[r4, INVALID, 5n * K],
		]
		for (const [sender, outcome, amount] of plan) await e2e.deposit(sender, source, outcome, amount)
		const game0 = await e2e.gameOf(source)
		await e2e.forkOn(r6, U0, await e2e.unrelatedQuestion('audit4 legacy: unrelated fork'))
		await e2e.choose(owner, U0, YES)
		const A = await e2e.activateBranch(U0, YES)
		const child = await e2e.materialize(source, A)
		for (const reporter of [r2, r3, r4, r5, r6]) await e2e.migrateWalletRep(reporter, U0, 200n * K, [YES])
		expect(await e2e.deposit(r5, child.pool, NO, 30n * K)).toBe(30n * K)
		expect(await e2e.deposit(r2, child.pool, YES, 20n * K)).toBe(20n * K)
		const backing = 170n * K
		const infra = getInfraContractAddresses()
		const factory = await owner.readContract({ abi: poolArtifact.abi, address: source, functionName: 'escalationGameFactory' })
		const verifier = await owner.readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'proofVerifier' })
		const leaves = await e2e.lineageLeaves([game0], YES)
		const [firstLeaf] = leaves
		if (firstLeaf === undefined) throw new Error('Missing carried leaf')

		const { currentPeaks: peaks } = await owner.readContract({ ...e2e.game(child.game), functionName: 'getOutcomeState', args: [YES] })
		const state = async (game: Address) => ({
			custody: await e2e.gameBalance(game),
			staked: await owner.readContract({ ...e2e.game(game), functionName: 'totalDisputeStakedAttoRep' }),
			balances: await e2e.balances(game),
			vault: await owner.readContract({ ...e2e.game(game), functionName: 'disputeStakedRepByVaultAttoRep', args: [r2.account.address] }),
			yes: await owner.readContract({ ...e2e.game(game), functionName: 'getOutcomeState', args: [YES] }),
			ledgerRep: await e2e.rep(A, ledger),
			attacker: await e2e.rep(A, r6.account.address),
			victim: await e2e.rep(A, r2.account.address),
		})

		/** Every legacy or privileged entry point, tried by an outsider and by a real depositor. */
		const probe = async (game: Address, phase: string) => {
			const before = await state(game)
			for (const caller of [r6, r2]) {
				const g = { ...e2e.game(game), account: caller.account.address }
				const viaClaim = { abi: claimDelegateArtifact.abi, address: game }
				const viaDeposit = { abi: depositDelegateArtifact.abi, address: game }
				const attempts: readonly (readonly [string, () => Promise<unknown>])[] = [
					['claimDepositForWinning', () => caller.simulateContract({ ...g, functionName: 'claimDepositForWinning', args: [0n, YES] })],
					['start', () => caller.simulateContract({ ...g, functionName: 'start', args: [1n, 2n] })],
					['startFromFork', () => caller.simulateContract({ ...g, functionName: 'startFromFork', args: [1n, 2n, 0n, YES, false, 0n] })],
					['resumeFromFork', () => caller.simulateContract({ ...g, functionName: 'resumeFromFork' })],
					['initializeForkCarryOutcome', () => caller.simulateContract({ ...g, functionName: 'initializeForkCarryOutcome', args: [game0, zeroHash, peaks, 0n, 0n, 0n, zeroHash] })],
					['recordDepositFromQuestionLedger', () => caller.simulateContract({ ...g, functionName: 'recordDepositFromQuestionLedger', args: [caller.account.address, YES, K, 1_000n * K] })],
					// Selectors that exist only on the deposit delegate never reach it through the game's fallback.
					['fallback transferReporterRep', () => caller.simulateContract({ ...viaDeposit, functionName: 'transferReporterRep', args: [caller.account.address, K] })],
					['fallback creditClaimOwners', () => caller.simulateContract({ ...viaDeposit, functionName: 'creditClaimOwners', args: [caller.account.address, K] })],
					['fallback creditExternalClaimOwners', () => caller.simulateContract({ ...viaDeposit, functionName: 'creditExternalClaimOwners', args: [game0, caller.account.address, 0n, K, 0n] })],
					['fallback consumeCarriedDeposit', () => caller.simulateContract({ ...viaDeposit, functionName: 'consumeCarriedDeposit', args: [YES, firstLeaf.parentDepositIndex, firstLeaf.amount, 1_000n * K] })],
					['fallback consumeUnresolvedRepForClaimOwners', () => caller.simulateContract({ ...viaDeposit, functionName: 'consumeUnresolvedRepForClaimOwners', args: [r2.account.address, YES, K] })],
					['fallback recordDeposit', () => caller.simulateContract({ ...viaDeposit, functionName: 'recordDeposit', args: [caller.account.address, YES, K, 1_000n * K] })],
					['fallback settleOrdinaryGame', () => caller.simulateContract({ ...viaDeposit, functionName: 'settleOrdinaryGame', args: [verifier, true] })],
					['fallback initializeForkClaimCheckpoint', () => caller.simulateContract({ ...viaClaim, functionName: 'initializeForkClaimCheckpoint', args: [game0] })],
					// The shared delegates hold no game state of their own.
					['delegate transferReporterRep', () => caller.simulateContract({ abi: depositDelegateArtifact.abi, address: infra.escalationGameDepositDelegate, functionName: 'transferReporterRep', args: [caller.account.address, K] })],
					['delegate creditClaimOwners', () => caller.simulateContract({ abi: depositDelegateArtifact.abi, address: infra.escalationGameDepositDelegate, functionName: 'creditClaimOwners', args: [caller.account.address, K] })],
					['delegate recordDeposit', () => caller.simulateContract({ abi: depositDelegateArtifact.abi, address: infra.escalationGameDepositDelegate, functionName: 'recordDeposit', args: [caller.account.address, YES, K, K] })],
					['delegate resumeFromFork', () => caller.simulateContract({ abi: depositDelegateArtifact.abi, address: infra.escalationGameDepositDelegate, functionName: 'resumeFromFork' })],
				]
				for (const [label, attempt] of attempts) await expect(attempt(), `${phase}: ${label} by ${caller.account.address}`).rejects.toThrow()
			}
			expect(await state(game), phase).toEqual(before)
		}

		await probe(game0, 'frozen parent')
		await probe(child.game, 'live continuation')
		for (const delegate of [infra.escalationGameDepositDelegate]) for (const universe of [U0, A]) expect(await e2e.rep(universe, delegate)).toBe(0n)

		// Removed checkpoint mutations reject both real and invented claim coordinates.
		const checkpoint = (game: Address, amount: bigint, cumulative: bigint, leafIndex: bigint) => writeContractAndWait(r6, () => r6.writeContract({ abi: claimDelegateArtifact.abi, address: game, functionName: 'processClaimCheckpoint', args: [YES, amount, cumulative, leafIndex, 8n, zeroHash, []], gas: BRANCH_GAS }))
		const beforeCheckpoint = await state(child.game)
		for (const leaf of leaves) await expect(checkpoint(child.game, leaf.amount, leaf.cumulative, leaf.leafIndex)).rejects.toThrow()
		// An invented claim that would start the first deposit's reward coordinates at zero with ten times its size.
		await expect(checkpoint(child.game, firstLeaf.amount * 10n, firstLeaf.amount * 10n, firstLeaf.leafIndex)).rejects.toThrow()
		await expect(checkpoint(child.game, 1n, 1_000_000n * K, 5n)).rejects.toThrow()
		await expect(checkpoint(game0, firstLeaf.amount, firstLeaf.cumulative, firstLeaf.leafIndex)).rejects.toThrow()
		expect(await state(child.game)).toEqual(beforeCheckpoint)

		// ---- the game then settles exactly as if nothing had been tried ----
		const g = e2e.game(child.game)
		const end = await owner.readContract({ ...g, functionName: 'getEscalationGameEndDate' })
		await base.mockWindow.setTime(end + 1n)
		expect(await owner.readContract({ ...g, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(YES))
		await probe(child.game, 'final continuation')
		const balances = await e2e.balances(child.game)
		expect(balances).toEqual([5n * K, 90n * K, 80n * K])
		const settled = await e2e.claimEveryWinner(r6, child.pool, YES, leaves, median(balances), balances[YES])
		const localPaid = await e2e.claimLocal(r6, child.pool, YES, [0n], r2.account.address)
		expect(90n * K + 48n * K - settled.paid - localPaid).toBeLessThanOrEqual(4n)
		await probe(child.game, 'partly settled continuation')
		expect(await e2e.claimLocal(r6, child.pool, NO, [0n], r5.account.address)).toBe(0n)
		const residual = await e2e.gameBalance(child.game)
		expect(backing - settled.paid - localPaid - residual).toBeLessThanOrEqual(32n * K)
		await e2e.sweep(r6, child.game)
		expect(await e2e.rep(A, ledger)).toBe(0n)
		await probe(child.game, 'swept continuation')
	})
})
