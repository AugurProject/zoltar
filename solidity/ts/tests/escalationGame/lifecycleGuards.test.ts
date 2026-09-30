import assert from '../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { initializeGameForkCarrySnapshotAbi } from '../carrySnapshotAbis'
import { encodeDeployData, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { contractExists } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { deployEscalationGame, depositOnOutcome, getActivationTime, getBalances, getEscalationGameOutcomeState, getQuestionResolution, readEscalationGameEndDate, readCarryPeaks, readCarryLeafCount, readCarryTotal, readNullifierRoot } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { statoblast_EscalationGame_EscalationGame, statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier, test_statoblast_EscalationGameProofTestSecurityPool_EscalationGameProofTestSecurityPool as escalationGameProofTestPoolArtifact } from '../../types/contractArtifact'
import { ESCALATION_TIME_LENGTH, FRESH_FORK_RESPONSE_PERIOD, zeroHash, zeroPeakArray } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'

describe('Escalation Game: lifecycle and guards', () => {
	const fixture = useEscalationGameFixture()
	const {
		reportBond,
		nonDecisionThresholdAttoRep,
		deployEscalationGameTestSecurityPool,
		deployEscalationGameWithProofPool,
		deployProofTestSecurityPool,
		deployIncompatibleProofVerifier,
		startEscalation,
		startEscalationFromFork,
		resumeEscalationFromFork,
		fundEscalationGame,
		depositOnOutcomeViaProofTestSecurityPool,
		withdrawDepositViaProofTestSecurityPool,
		initializeSnapshotViaTestSecurityPool,
		initializeSnapshotWithResolutionBalancesViaTestSecurityPool,
		initializeSnapshotFromSourceViaTestSecurityPool,
	} = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
	})

	test('can start a game', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		assert.ok(await contractExists(client, escalationGame), 'game was deployed')
		const outcomeBalances = await getBalances(client, escalationGame)
		assert.strictEqual(outcomeBalances.yes, 0n, 'yes stake')
		assert.strictEqual(outcomeBalances.no, 0n, 'no stake')
		assert.strictEqual(outcomeBalances.invalid, 0n, 'invalid stake')

		const activationTime = await getActivationTime(client, escalationGame)
		assert.strictEqual(activationTime !== 0n, true, 'game was started')
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.No, reportBond)
		const outcomeBalancesAfterDeposit = await getBalances(client, escalationGame)
		assert.strictEqual(outcomeBalancesAfterDeposit.yes, 0n, 'yes stake')
		assert.strictEqual(outcomeBalancesAfterDeposit.no, reportBond, 'no stake')
		assert.strictEqual(outcomeBalancesAfterDeposit.invalid, 0n, 'invalid stake')
	})

	test('constructor rejects a proof verifier address without contract code', async () => {
		const testSecurityPoolAddress = await deployProofTestSecurityPool()
		await assert.rejects(
			async () =>
				await client.sendTransaction({
					data: encodeDeployData({
						abi: statoblast_EscalationGame_EscalationGame.abi,
						bytecode: `0x${statoblast_EscalationGame_EscalationGame.evm.bytecode.object}`,
						args: [testSecurityPoolAddress, getRepTokenAddress(0n), zeroAddress, getInfraContractAddresses().escalationGameClaimDelegate],
					}),
				}),
			/Proof verifier has no code/,
		)
	})

	test('constructor rejects a proof verifier address with incompatible contract code', async () => {
		const testSecurityPoolAddress = await deployProofTestSecurityPool()
		const incompatibleVerifierAddress = await deployIncompatibleProofVerifier()
		await assert.rejects(
			async () =>
				await client.sendTransaction({
					data: encodeDeployData({
						abi: statoblast_EscalationGame_EscalationGame.abi,
						bytecode: `0x${statoblast_EscalationGame_EscalationGame.evm.bytecode.object}`,
						args: [testSecurityPoolAddress, getRepTokenAddress(0n), incompatibleVerifierAddress, getInfraContractAddresses().escalationGameClaimDelegate],
					}),
				}),
			/Proof verifier invalid/,
		)
	})

	test('start and fork-resume lifecycle guards report every reachable failure reason', async () => {
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const unauthorized = await deployEscalationGameWithProofPool()
		await assert.rejects(
			attacker.writeContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: unauthorized.escalationGameAddress,
				functionName: 'start',
				args: [reportBond, nonDecisionThresholdAttoRep],
			}),
			/execution reverted/,
		)

		const thresholdTooLow = await deployEscalationGameWithProofPool()
		await assert.rejects(startEscalation(thresholdTooLow.escalationGameAddress, reportBond, reportBond), /Invalid game start/)
		const zeroBond = await deployEscalationGameWithProofPool()
		await assert.rejects(startEscalation(zeroBond.escalationGameAddress, 0n, reportBond), /Invalid game start/)
		const subRepBond = await deployEscalationGameWithProofPool()
		await startEscalation(subRepBond.escalationGameAddress, 1n, 2n)
		assert.strictEqual(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: subRepBond.escalationGameAddress,
				functionName: 'startBondAttoRep',
				args: [],
			}),
			1n,
			'a positive one-attoREP bond must remain available when live REP supply falls below one whole REP',
		)

		const alreadyStarted = await deployEscalationGameWithProofPool()
		await startEscalation(alreadyStarted.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await assert.rejects(startEscalation(alreadyStarted.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep), /Invalid game start/)
		await assert.rejects(resumeEscalationFromFork(alreadyStarted.escalationGameAddress), /No fork mode/)

		const excessiveForkTime = await deployEscalationGameWithProofPool()
		await assert.rejects(startEscalationFromFork(excessiveForkTime.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, ESCALATION_TIME_LENGTH + 1n), /execution reverted|Reverted without a reason/i)

		const fork = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(fork.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await assert.rejects(
			attacker.writeContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: fork.escalationGameAddress,
				functionName: 'resumeFromFork',
				args: [],
			}),
			/Only pool/,
		)
		await resumeEscalationFromFork(fork.escalationGameAddress)
		await assert.rejects(resumeEscalationFromFork(fork.escalationGameAddress), /Fork resumed/)
	})

	test('carry snapshot initialization guards reject wrong callers, modes, repeated snapshots, oversized counts, and bad ids', async () => {
		const normal = await deployEscalationGameTestSecurityPool()
		await assert.rejects(initializeSnapshotViaTestSecurityPool(normal.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 0n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()]), /No fork mode/)

		const unauthorized = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(unauthorized.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await assert.rejects(
			client.writeContract({
				abi: initializeGameForkCarrySnapshotAbi,
				address: unauthorized.escalationGameAddress,
				functionName: 'initializeForkCarrySnapshotWithResolutionBalances',
				args: [zeroAddress, zeroHash(), [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 0n, 0n], [0n, 0n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()]],
			}),
			/Only pool/,
		)

		const repeated = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(repeated.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		const emptySnapshot = [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()] as const
		await initializeSnapshotViaTestSecurityPool(repeated.testSecurityPoolAddress, emptySnapshot, [0n, 0n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()])
		await assert.rejects(initializeSnapshotViaTestSecurityPool(repeated.testSecurityPoolAddress, emptySnapshot, [0n, 0n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()]), /Snapshot initialized/)

		const oversized = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(oversized.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await assert.rejects(initializeSnapshotViaTestSecurityPool(oversized.testSecurityPoolAddress, emptySnapshot, [1n << 64n, 0n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()]), /Leaf count high/)

		const badId = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(badId.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await assert.rejects(initializeSnapshotFromSourceViaTestSecurityPool(badId.testSecurityPoolAddress, client.account.address, `0x${'0'.repeat(63)}1`, emptySnapshot, [0n, 0n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()]), /Snapshot id mismatch/)
	})

	test('deposit preview and recording guards cover resolved, full, zero, mismatched, oversized, and maximum-height deposits', async () => {
		const record = (testSecurityPoolAddress: Address, amountAttoRep: bigint, expectedCumulativeAmount: bigint) =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: testSecurityPoolAddress,
				functionName: 'recordDeposit',
				args: [client.account.address, QuestionOutcome.Yes, amountAttoRep, expectedCumulativeAmount],
			})

		const fresh = await deployEscalationGameTestSecurityPool()
		await assert.rejects(
			client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: fresh.escalationGameAddress,
				functionName: 'previewDepositOnOutcome',
				args: [QuestionOutcome.None, reportBond],
			}),
			/Invalid deposit preview/,
		)
		await assert.rejects(record(fresh.testSecurityPoolAddress, 0n, 0n), /Deposit zero/)
		await assert.rejects(record(fresh.testSecurityPoolAddress, reportBond, reportBond + 1n), /Preview mismatch/)
		await assert.rejects(record(fresh.testSecurityPoolAddress, nonDecisionThresholdAttoRep + 1n, nonDecisionThresholdAttoRep + 1n), /Deposit exceeds room/)

		const full = await deployEscalationGameTestSecurityPool()
		await depositOnOutcomeViaProofTestSecurityPool(full.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, nonDecisionThresholdAttoRep)
		await assert.rejects(
			client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: full.escalationGameAddress,
				functionName: 'previewDepositOnOutcome',
				args: [QuestionOutcome.Yes, reportBond],
			}),
			/Invalid deposit preview/,
		)
		await assert.rejects(record(full.testSecurityPoolAddress, reportBond, nonDecisionThresholdAttoRep + reportBond), /Outcome full/)

		const resolved = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(resolved.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, ESCALATION_TIME_LENGTH, QuestionOutcome.Yes)
		await resumeEscalationFromFork(resolved.escalationGameAddress)
		await mockWindow.advanceTime(FRESH_FORK_RESPONSE_PERIOD + 1n)
		await assert.rejects(
			client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: resolved.escalationGameAddress,
				functionName: 'previewDepositOnOutcome',
				args: [QuestionOutcome.Yes, reportBond],
			}),
			/Invalid deposit preview/,
		)
		await assert.rejects(record(resolved.testSecurityPoolAddress, reportBond, reportBond), /Question resolved/)

		const maximumHeight = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(maximumHeight.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(maximumHeight.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, (1n << 64n) - 1n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()])
		await assert.rejects(record(maximumHeight.testSecurityPoolAddress, reportBond, reportBond), /MMR too tall/)
	})

	for (const elapsed of [1n, FRESH_FORK_RESPONSE_PERIOD - 1n, FRESH_FORK_RESPONSE_PERIOD, FRESH_FORK_RESPONSE_PERIOD + 1n]) {
		test(`continuation response admission at elapsed ${elapsed} separates provisional and final resolution`, async () => {
			const parent = await deployEscalationGameTestSecurityPool()
			await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 100n * reportBond)
			const child = await deployEscalationGameWithProofPool()
			await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
			await initializeSnapshotViaTestSecurityPool(
				child.testSecurityPoolAddress,
				[zeroPeakArray(), await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes), zeroPeakArray()],
				[0n, 1n, 0n],
				[0n, 100n * reportBond, 0n],
				[zeroHash(), await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes), zeroHash()],
			)
			await fundEscalationGame(child.escalationGameAddress, 300n * reportBond)
			await resumeEscalationFromFork(child.escalationGameAddress)
			const resumedAt = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: child.escalationGameAddress, functionName: 'forkResumedAt' })
			const beforeBoundary = await mockWindow.anvilSnapshot()
			await mockWindow.setTime(resumedAt + elapsed)
			assert.strictEqual(await getQuestionResolution(client, child.escalationGameAddress), QuestionOutcome.Yes)
			const finalResolution = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: child.escalationGameAddress, functionName: 'getFinalQuestionResolution' })
			const preview = () => client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: child.escalationGameAddress, functionName: 'previewDepositOnOutcome', args: [QuestionOutcome.No, 300n * reportBond] })
			// Call recording directly as well: an execution-only guard must not diverge from preview.
			const record = () => writeContractAndWait(client, () => client.writeContract({ abi: escalationGameProofTestPoolArtifact.abi, address: child.testSecurityPoolAddress, functionName: 'recordDeposit', args: [client.account.address, QuestionOutcome.No, 300n * reportBond, 300n * reportBond] }))
			const recordAtBoundary = async () => {
				await mockWindow.anvilRevert(beforeBoundary)
				if (elapsed > 1n) await mockWindow.setTime(resumedAt + elapsed - 1n)
				return record()
			}
			if (elapsed > FRESH_FORK_RESPONSE_PERIOD) {
				assert.strictEqual(finalResolution, BigInt(QuestionOutcome.Yes))
				await assert.rejects(preview(), /Invalid deposit preview/)
				await assert.rejects(recordAtBoundary(), /Question resolved/)
				assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.No), 0n)
			} else {
				assert.strictEqual(finalResolution, BigInt(QuestionOutcome.None))
				assert.deepStrictEqual(await preview(), [300n * reportBond, 300n * reportBond])
				await recordAtBoundary()
				assert.strictEqual((await client.getBlock()).timestamp, resumedAt + elapsed, 'execution must use the exact tested timestamp')
				assert.strictEqual((await getEscalationGameOutcomeState(client, child.escalationGameAddress, QuestionOutcome.No)).balanceAttoRep, 300n * reportBond)
				assert.ok((await readEscalationGameEndDate(client, child.escalationGameAddress)) > resumedAt + FRESH_FORK_RESPONSE_PERIOD, 'the accepted challenge extends the game through its binding capital')
			}
		})
	}

	test('proof verifier public boundaries expose deterministic error reasons', async () => {
		const { proofVerifierAddress } = await deployEscalationGameWithProofPool()
		const verifierAbi = statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.abi

		await assert.rejects(client.readContract({ abi: verifierAbi, address: proofVerifierAddress, functionName: 'computeIterativeAttritionCostAttoRep', args: [1n, 2n, 0n, 2n, 1n] }), /Time too high/)
		await assert.rejects(client.readContract({ abi: verifierAbi, address: proofVerifierAddress, functionName: 'computeAcceptedDepositAmount', args: [1n, 0n, 0n, 10n, 1n, 10n, [1n, 0n, 0n]] }), /Below start bond/)
		await assert.rejects(client.readContract({ abi: verifierAbi, address: proofVerifierAddress, functionName: 'getCurrentCarryPeakForLeaf', args: [0n, 0n] }), /Carry peak absent/)
		await assert.rejects(client.readContract({ abi: verifierAbi, address: proofVerifierAddress, functionName: 'computeMerkleMountainRangeRootFromProof', args: [zeroHash(), 1n, 0n, 64n, []] }), /Bad carry peak/)
		await assert.rejects(client.readContract({ abi: verifierAbi, address: proofVerifierAddress, functionName: 'computeMerkleMountainRangeRootFromProof', args: [zeroHash(), 3n, 2n, 1n, []] }), /Bad carry peak/)
		await assert.rejects(client.readContract({ abi: verifierAbi, address: proofVerifierAddress, functionName: 'computeMerkleMountainRangeRootFromProof', args: [zeroHash(), 2n, 2n, 1n, []] }), /Bad carry leaf/)
		await assert.rejects(client.readContract({ abi: verifierAbi, address: proofVerifierAddress, functionName: 'computeMerkleMountainRangeRootFromProof', args: [zeroHash(), 2n, 0n, 1n, []] }), /Bad MMR proof length/)
	})

	test('proof verifier preserves exact power-of-two logarithm components', async () => {
		const { proofVerifierAddress } = await deployEscalationGameWithProofPool()
		const verifierAbi = statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.abi
		const lowValue = 10n ** 18n
		const ln2Scaled = 693_147n

		for (let exponent = 1n; exponent <= 8n; exponent++) {
			const highValue = lowValue << exponent
			assert.strictEqual(
				await client.readContract({
					abi: verifierAbi,
					address: proofVerifierAddress,
					functionName: 'computeLnRatioScaled',
					args: [lowValue, highValue],
				}),
				exponent * ln2Scaled,
				`exact 2^${exponent} ratio should preserve its logarithm component`,
			)
		}

		const belowBoundary = await client.readContract({
			abi: verifierAbi,
			address: proofVerifierAddress,
			functionName: 'computeLnRatioScaled',
			args: [lowValue, 2n * lowValue - 1n],
		})
		const aboveBoundary = await client.readContract({
			abi: verifierAbi,
			address: proofVerifierAddress,
			functionName: 'computeLnRatioScaled',
			args: [lowValue, 2n * lowValue + 1n],
		})
		assert.ok(belowBoundary > 0n && belowBoundary <= ln2Scaled, 'ratio immediately below two should remain positive and bounded')
		assert.ok(aboveBoundary >= ln2Scaled, 'ratio immediately above two should retain the normalized ln(2) component')
	})

	test('carried proof verification rejects a zero amount before mutating the inherited snapshot', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, ESCALATION_TIME_LENGTH, QuestionOutcome.Yes)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await resumeEscalationFromFork(child.escalationGameAddress)
		await mockWindow.advanceTime(FRESH_FORK_RESPONSE_PERIOD + 1n)
		assert.strictEqual(await getQuestionResolution(client, child.escalationGameAddress), QuestionOutcome.Yes, 'real inherited snapshot should resolve to the fixed child outcome')
		const childNullifierRootBefore = await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Yes)

		const zeroAmountProof = {
			depositor: client.account.address,
			amountAttoRep: 0n,
			parentDepositIndex: 0n,
			cumulativeAmountAttoRep: 0n,
			sourceNodeId: 0n,
			leafIndex: 0n,
			merkleMountainRangeSiblings: [],
			merkleMountainRangePeakIndex: 0n,
			nullifierSiblings: [],
		}
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, zeroAmountProof), /Proof amount zero/)
		assert.strictEqual(await readCarryLeafCount(client, child.escalationGameAddress, QuestionOutcome.Yes), parentLeafCount, 'a rejected zero-amount proof must preserve the inherited leaf count')
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), parentCarryTotal, 'a rejected zero-amount proof must preserve the inherited carry total')
		assert.strictEqual(await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Yes), childNullifierRootBefore, 'a rejected zero-amount proof must preserve the inherited nullifier root')
	})
})
