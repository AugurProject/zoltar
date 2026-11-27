import { allocatedWinningPayout, ordinaryWinningPayout } from '../../../augurScan/src/claim-payout'
import { buildCarryMerkleMountainRangeProof, hashCarryLeaf as hashSharedCarryLeaf } from '@zoltar/core-shared/evm/carryProof'
import { beforeEach, describe, test } from 'bun:test'
import { encodeAbiParameters, keccak256, type Address } from '@zoltar/core-shared/evm/ethereum'
import assert from '../testSupport/simulator/utils/assert'
import type { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import type { WriteClient } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { getActivationTime, getBalances, getEscalationGameDeposits, readCarryTotal } from '../testSupport/simulator/utils/contracts/escalationGame'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier, statoblast_EscalationGame_EscalationGame, test_statoblast_EscalationGameProofTestQuestionLedger_EscalationGameProofTestQuestionLedger as escalationGameProofTestPoolArtifact } from '../types/contractArtifact'
import { computeEscalationCurveAttoRep, computeEscalationFinalityElapsed, ESCALATION_TIME_LENGTH, getWinningEscalationDepositClaimAmount, getWinningImportedEscalationDepositClaimAmount, projectEscalationDeposit, projectEscalationEndTime } from '@zoltar/statoblast-shared/escalationGame/escalationMath'
import { requireContractAddress } from './escalationGame/carryHelpers'
import { useEscalationGameFixture } from './escalationGame/fixture'

describe('Escalation math parity', () => {
	const fixture = useEscalationGameFixture()
	const {
		reportBond,
		nonDecisionThresholdAttoRep,
		recursiveResolutionTargetCost,
		deployEscalationGameWithProofPool,
		deployEscalationGameTestQuestionLedger,
		deployForkContinuationEscalationGame,
		readOutcomeCarrySnapshot,
		depositOnOutcomeViaTestQuestionLedger,
		initializeSnapshotViaTestQuestionLedger,
		withdrawDepositViaProofTestQuestionLedger,
		advanceForkContinuationPastStart,
		createCarryProof,
	} = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	const readBindingCapital = async (escalationGame: `0x${string}`) =>
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'getBindingCapitalAttoRep',
			args: [],
		})

	const readEscalationEndDate = async (escalationGame: `0x${string}`) =>
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'getEscalationGameEndDate',
			args: [],
		})

	const readPreviewDepositOnOutcome = async (escalationGame: `0x${string}`, outcome: QuestionOutcome, amountAttoRep: bigint) =>
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'previewDepositOnOutcome',
			args: [outcome, amountAttoRep],
		})

	const startEscalationFromFork = async (escalationGameAddress: Address, elapsedAtFork: bigint) => await fixture.startEscalationFromFork(escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, elapsedAtFork)

	const hashCarryLeaf = (depositor: Address, outcome: QuestionOutcome, amountAttoRep: bigint, parentDepositIndex: bigint, cumulativeAmountAttoRep: bigint, sourceNodeId: bigint) =>
		keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [depositor, outcome, amountAttoRep, parentDepositIndex, cumulativeAmountAttoRep, sourceNodeId]))

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
	})

	test('continuation offsets include pending activation but reject clocks outside the reporting window', async () => {
		const { escalationGameAddress } = await deployEscalationGameWithProofPool()
		await assert.rejects(startEscalationFromFork(escalationGameAddress, -3n * DAY - 1n), /Invalid fork elapsed time/)
		await assert.rejects(startEscalationFromFork(escalationGameAddress, 49n * DAY + 1n), /Invalid fork elapsed time/)
		await startEscalationFromFork(escalationGameAddress, -3n * DAY)
		assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'forkElapsedAtStart' }), -3n * DAY)
		assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'totalCostAttoRep' }), 0n)
	})

	test('scanner allocated payouts and shared carry proofs match the deployed Solidity verifier', async () => {
		const hash = await client.sendTransaction({ data: `0x${statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.evm.bytecode.object}` })
		const receipt = await client.waitForTransactionReceipt({ hash })
		const verifier = requireContractAddress(receipt.contractAddress, 'Proof verifier')
		const abi = statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.abi
		for (const [rewardAmount, rewardCumulative, binding, winningBalance, forkThreshold, nonDecisionThreshold] of [
			[33n, 75n, 100n, 160n, 500n, 1000n],
			[77n, 160n, 100n, 160n, 1000n, 1000n],
			[1n, 1000n, 0n, 1000n, 0n, 1000n],
			[7n * 10n ** 18n + 1n, 19n * 10n ** 18n + 3n, 11n * 10n ** 18n, 20n * 10n ** 18n, 713n, 1000n],
		] as const) {
			// A claim's principal is its authenticated deposit amount.
			const expected = await client.readContract({ abi, address: verifier, functionName: 'computeAllocatedWinningWithdrawal', args: [rewardAmount, rewardCumulative, binding, winningBalance, forkThreshold, nonDecisionThreshold] })
			const actual = allocatedWinningPayout({ principal: rewardAmount, rewardAmount, rewardCumulative, binding, winningBalance, forkThreshold, nonDecisionThreshold })
			assert.strictEqual(actual.payout, expected.amountToWithdrawAttoRep)
			assert.strictEqual(actual.burn, expected.burnAmountAttoRep)
			const ordinary = await client.readContract({ abi, address: verifier, functionName: 'computeOrdinaryWinningWithdrawal', args: [rewardAmount, rewardCumulative, binding, winningBalance, forkThreshold, nonDecisionThreshold] })
			const ordinaryModel = ordinaryWinningPayout({ principal: rewardAmount, rewardAmount, rewardCumulative, binding, winningBalance, forkThreshold, nonDecisionThreshold })
			assert.strictEqual(ordinaryModel.payout, ordinary.amountToWithdrawAttoRep)
			assert.strictEqual(ordinaryModel.burn, ordinary.burnAmountAttoRep)
			assert.strictEqual(
				getWinningEscalationDepositClaimAmount({
					depositAmountAttoRep: rewardAmount,
					cumulativeAmountAttoRep: rewardCumulative,
					bindingCapitalAttoRep: binding,
					winningOutcomeBalanceAttoRep: winningBalance,
					forkThresholdAttoRep: forkThreshold,
					nonDecisionThresholdAttoRep: nonDecisionThreshold,
					ordinarySettlement: true,
				}),
				ordinary.amountToWithdrawAttoRep,
			)
		}
		const leaves = Array.from({ length: 6 }, (_, index) => hashSharedCarryLeaf({ depositor: '0x1111111111111111111111111111111111111111', amountAttoRep: 17n, cumulativeAmountAttoRep: BigInt(index + 1) * 17n, parentDepositIndex: BigInt(index), sourceNodeId: BigInt(index + 1) }, 1))
		for (let index = 0; index < leaves.length; index++) {
			const leaf = leaves[index]
			if (leaf === undefined) throw new Error('Missing test leaf')
			const proof = buildCarryMerkleMountainRangeProof(leaves, index)
			const root = await client.readContract({ abi, address: verifier, functionName: 'computeMerkleMountainRangeRootFromProof', args: [leaf, 6n, proof.leafIndex, proof.merkleMountainRangePeakIndex, proof.merkleMountainRangeSiblings] })
			assert.strictEqual(root, proof.root)
		}
	})

	test('shared finality cutoffs match deployed forward-curve deadlines', async () => {
		for (const binding of [reportBond, 7n * reportBond, 11n * reportBond, nonDecisionThresholdAttoRep - 1n]) {
			const { escalationGameAddress: game, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
			await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, binding + reportBond)
			await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.No, binding)
			assert.strictEqual(await readBindingCapital(game), binding)
			const elapsed = computeEscalationFinalityElapsed(reportBond, nonDecisionThresholdAttoRep, binding)
			assert.strictEqual(await readEscalationEndDate(game), (await getActivationTime(client, game)) + elapsed)
			const curve = (time: bigint) => client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'computeIterativeAttritionCostAttoRep', args: [time] })
			assert.ok((await curve(elapsed)) <= binding, 'the scheduled second must remain unresolved')
			assert.ok((await curve(elapsed + 1n)) > binding, 'the next second must strictly cross binding capital')
		}
	})

	test('a sub-bond threshold remainder still requires an offer of the full start bond', async () => {
		const { escalationGameAddress: game, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, nonDecisionThresholdAttoRep - 1n)
		const balances = await getBalances(client, game)
		const project = (amountAttoRep: bigint) => projectEscalationDeposit({ amountAttoRep, balancesAttoRep: [balances.invalid, balances.yes, balances.no], nonDecisionThresholdAttoRep, outcome: 'yes', startBondAttoRep: reportBond })
		assert.strictEqual(project(1n), undefined)
		await assert.rejects(readPreviewDepositOnOutcome(game, QuestionOutcome.Yes, 1n), /Invalid deposit preview/)
		const [accepted, cumulative] = await readPreviewDepositOnOutcome(game, QuestionOutcome.Yes, reportBond)
		assert.strictEqual(accepted, project(reportBond)?.acceptedAmountAttoRep)
		assert.strictEqual(accepted, 1n)
		assert.strictEqual(cumulative, nonDecisionThresholdAttoRep)
	})

	test('shared deposit projection matches previewDepositOnOutcome and projected end time', async () => {
		const { escalationGameAddress: escalationGame, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 9n * reportBond)
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.No, 6n * reportBond)

		const balances = await getBalances(client, escalationGame)
		const requestedAmount = 8n * reportBond
		const projection = projectEscalationDeposit({
			amountAttoRep: requestedAmount,
			balancesAttoRep: [balances.invalid, balances.yes, balances.no],
			nonDecisionThresholdAttoRep,
			outcome: 'invalid',
			startBondAttoRep: reportBond,
		})
		assert.ok(projection !== undefined, 'shared projection should accept this deposit')
		if (projection === undefined) return

		const [acceptedAmount, resultingCumulativeAmount] = await readPreviewDepositOnOutcome(escalationGame, QuestionOutcome.Invalid, requestedAmount)
		assert.strictEqual(acceptedAmount, projection.acceptedAmountAttoRep, 'accepted amount should match previewDepositOnOutcome')
		assert.strictEqual(resultingCumulativeAmount, projection.projectedBalancesAttoRep[0], 'projected invalid balance should match preview cumulative amount')

		const activationTime = await getActivationTime(client, escalationGame)
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Invalid, acceptedAmount)
		const expectedEndTime = activationTime + computeEscalationFinalityElapsed(reportBond, nonDecisionThresholdAttoRep, await readBindingCapital(escalationGame))
		assert.strictEqual(await readEscalationEndDate(escalationGame), expectedEndTime, 'shared projected end time should match the contract after the same deposit')
	})

	test('shared projection matches the curve deadline after a change of leader and a below-curve deposit', async () => {
		const { escalationGameAddress: escalationGame, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 9n * reportBond)
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.No, 6n * reportBond)
		const activationTime = await getActivationTime(client, escalationGame)
		const project = (balances: Awaited<ReturnType<typeof getBalances>>, outcome: 'invalid' | 'no', amountAttoRep: bigint) => projectEscalationDeposit({ amountAttoRep, balancesAttoRep: [balances.invalid, balances.yes, balances.no], nonDecisionThresholdAttoRep, outcome, startBondAttoRep: reportBond })

		// No takes the lead shortly before the curve deadline its own stake set.
		await mockWindow.setTime((await readEscalationEndDate(escalationGame)) - 100n)
		const leadProjection = project(await getBalances(client, escalationGame), 'no', 4n * reportBond)
		assert.ok(leadProjection !== undefined)
		if (leadProjection === undefined) return
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.No, 4n * reportBond)
		const projectedEndTime = projectEscalationEndTime({ activationTime, balancesAttoRep: leadProjection.projectedBalancesAttoRep, nonDecisionThresholdAttoRep, startBondAttoRep: reportBond })
		assert.strictEqual(projectedEndTime, activationTime + computeEscalationFinalityElapsed(reportBond, nonDecisionThresholdAttoRep, 9n * reportBond), 'the deadline is the curve crossing of the new median')
		assert.strictEqual(await readEscalationEndDate(escalationGame), projectedEndTime, 'shared projected end time should match the contract after a change of leader')

		// Before that deadline a start-bond deposit far below the curve is accepted.
		await mockWindow.setTime(projectedEndTime - 60n)
		const balances = await getBalances(client, escalationGame)
		assert.ok(computeEscalationCurveAttoRep(reportBond, nonDecisionThresholdAttoRep, projectedEndTime - 60n - activationTime) > 2n * reportBond)
		const smallProjection = project(balances, 'invalid', reportBond)
		assert.ok(smallProjection !== undefined, 'shared projection should accept a start-bond deposit while the game is open')
		const [acceptedAmount, resultingCumulativeAmount] = await readPreviewDepositOnOutcome(escalationGame, QuestionOutcome.Invalid, reportBond)
		assert.strictEqual(acceptedAmount, smallProjection?.acceptedAmountAttoRep)
		assert.strictEqual(resultingCumulativeAmount, smallProjection?.projectedBalancesAttoRep[0])
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Invalid, reportBond)
		assert.strictEqual(await readEscalationEndDate(escalationGame), projectEscalationEndTime({ activationTime, balancesAttoRep: [reportBond, balances.yes, balances.no], nonDecisionThresholdAttoRep, startBondAttoRep: reportBond }))

		// Once the curve passes the median the game accepts no deposit.
		await mockWindow.setTime(projectedEndTime + 1n)
		await assert.rejects(readPreviewDepositOnOutcome(escalationGame, QuestionOutcome.Invalid, 8n * reportBond), /Invalid deposit preview/)
	})

	test('shared winning-withdrawal math matches local withdrawDeposit', async () => {
		const { escalationGameAddress, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 5n * reportBond)
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 5n * reportBond)
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.No, 10n * reportBond)

		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)

		const [firstWinningDeposit] = await getEscalationGameDeposits(client, escalationGameAddress, QuestionOutcome.Yes)
		assert.ok(firstWinningDeposit !== undefined, 'expected a winning deposit to claim')
		if (firstWinningDeposit === undefined) return

		const balances = await getBalances(client, escalationGameAddress)
		const sharedWithdrawal = getWinningEscalationDepositClaimAmount({
			bindingCapitalAttoRep: await readBindingCapital(escalationGameAddress),
			cumulativeAmountAttoRep: firstWinningDeposit.cumulativeAmountAttoRep,
			depositAmountAttoRep: firstWinningDeposit.amountAttoRep,
			forkThresholdAttoRep: nonDecisionThresholdAttoRep,
			nonDecisionThresholdAttoRep,
			winningOutcomeBalanceAttoRep: balances.yes,
			ordinarySettlement: true,
		})
		const preview = await client.simulateContract({
			abi: escalationGameProofTestPoolArtifact.abi,
			address: testQuestionLedgerAddress,
			functionName: 'withdrawLocalDeposit',
			args: [0n, QuestionOutcome.Yes],
		})
		const [, claimedAmount, originalDepositAmountAttoRep] = preview.result
		assert.strictEqual(originalDepositAmountAttoRep, firstWinningDeposit.amountAttoRep, 'claim preview should preserve the original winning principal size')
		assert.strictEqual(sharedWithdrawal, claimedAmount, 'shared model should match the contract winning-withdrawal amount')
	})

	test('shared imported winning-withdrawal math matches carried proof settlement at the reward-cap boundary', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		const firstWinningDepositAmount = 2n * reportBond
		const secondWinningDepositAmount = 2n * reportBond
		const losingDepositAmount = 2n * reportBond

		await depositOnOutcomeViaTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, firstWinningDepositAmount)
		await depositOnOutcomeViaTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, secondWinningDepositAmount)
		await depositOnOutcomeViaTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.No, losingDepositAmount)

		const { peaks: emptyOutcomePeaks, leafCount: emptyOutcomeLeafCount, carryTotal: emptyOutcomeCarryTotal } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const { peaks: parentYesPeaks, leafCount: parentYesLeafCount, carryTotal: parentYesCarryTotal } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const { peaks: parentNoPeaks, leafCount: parentNoLeafCount, carryTotal: parentNoCarryTotal } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.No)

		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, firstWinningDepositAmount, 0n, firstWinningDepositAmount, 1n)
		const child = await deployForkContinuationEscalationGame(0n, emptyOutcomeCarryTotal + parentYesCarryTotal + parentNoCarryTotal)
		await initializeSnapshotViaTestQuestionLedger(child.testQuestionLedgerAddress, [emptyOutcomePeaks, parentYesPeaks, parentNoPeaks], [emptyOutcomeLeafCount, parentYesLeafCount, parentNoLeafCount], [emptyOutcomeCarryTotal, parentYesCarryTotal, parentNoCarryTotal])
		const childBindingCapital = await readBindingCapital(child.escalationGameAddress)
		assert.strictEqual(childBindingCapital, losingDepositAmount, 'child fork should inherit the parent binding-capital depth for this snapshot')
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const secondProof = await createCarryProof(parent.escalationGameAddress, 1n, 1n, 1n, [firstLeafHash])
		const childBalances = await getBalances(client, child.escalationGameAddress)
		const sharedWithdrawal = getWinningImportedEscalationDepositClaimAmount({
			bindingCapitalAttoRep: childBindingCapital,
			depositAmountAttoRep: secondProof.amountAttoRep,
			forkThresholdAttoRep: nonDecisionThresholdAttoRep,
			nonDecisionThresholdAttoRep,
			postDepositCumulativeAmountAttoRep: secondProof.cumulativeAmountAttoRep,
			winningOutcomeBalanceAttoRep: childBalances.yes,
		})
		const preview = await client.simulateContract({
			abi: escalationGameProofTestPoolArtifact.abi,
			address: child.testQuestionLedgerAddress,
			functionName: 'withdrawDeposit',
			args: [QuestionOutcome.Yes, secondProof],
		})
		const [, claimedAmount, originalDepositAmountAttoRep] = preview.result
		assert.strictEqual(originalDepositAmountAttoRep, secondProof.amountAttoRep, 'proof preview should preserve the original imported winning principal size')
		assert.strictEqual(sharedWithdrawal, claimedAmount, 'shared imported model should match carried proof settlement')

		await withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, secondProof)
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), firstWinningDepositAmount, 'withdrawing the later carried proof should leave only the first winning imported principal unresolved')
	})
})
