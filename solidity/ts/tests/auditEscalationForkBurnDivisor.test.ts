import { overrideGenesisTheoreticalSupply } from '../testSupport/simulator/utils/utilities'
import { encodeDeployData, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { initializeForkCarrySnapshotWithResolutionBalancesAbi } from './carrySnapshotAbis'
import { beforeEach, describe, test } from 'bun:test'
import { deployContract } from '../testSupport/deployContract'
import type { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import assert from '../testSupport/simulator/utils/assert'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, MAX_UINT256 } from '../testSupport/simulator/utils/constants'
import { drainEscalationGameRepForTest } from '../testSupport/simulator/utils/contracts/escalationGame'
import { ensureZoltarDeployed, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { getERC20Balance, setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import {
	test_statoblast_EscalationGameProofTestQuestionLedger_EscalationGameProofTestQuestionLedger as proofTestPoolArtifact,
	ReputationToken_ReputationToken,
	statoblast_EscalationGame_EscalationGame,
	statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate,
	statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier,
	Zoltar_Zoltar,
} from '../types/contractArtifact'
import { hashCarryLeaf, SparseNullifierTree } from './carryProofHelpers'

const ESCALATION_TIME_LENGTH = 4_233_600n
const FORK_THRESHOLD = 20n * 10n ** 18n
const NON_DECISION_THRESHOLD = FORK_THRESHOLD / 2n
const START_BOND = 1n * 10n ** 18n

describe('Audit regression: escalation fork burn divisor solvency', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let depositDelegate: Address
	const repTokenAddress = addressString(GENESIS_REPUTATION_TOKEN)
	const zeroHash = `0x${'0'.repeat(64)}` as Hex

	const zeroPeaks = () => Array.from({ length: 64 }, () => zeroHash)

	type StartFromForkArgs = readonly [startBondAttoRep: bigint, nonDecisionThresholdAttoRep: bigint, elapsedAtFork: bigint, fixedQuestionOutcome: QuestionOutcome, winnerHaircutPaidByFork: boolean, forkCarryInitialBackingAttoRep: bigint]

	const deployStartedForkContinuation = async (zoltar: Address, proofVerifier: Address, startFromForkArgs: StartFromForkArgs) => {
		const questionLedger = await deployContract(
			client,
			encodeDeployData({
				abi: proofTestPoolArtifact.abi,
				bytecode: `0x${proofTestPoolArtifact.evm.bytecode.object}`,
				args: [zoltar, 0n, zeroAddress],
			}),
		)
		const escalationGame = await deployContract(
			client,
			encodeDeployData({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				bytecode: `0x${statoblast_EscalationGame_EscalationGame.evm.bytecode.object}`,
				args: [questionLedger, repTokenAddress, proofVerifier, depositDelegate],
			}),
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: proofTestPoolArtifact.abi,
				address: questionLedger,
				functionName: 'setEscalationGame',
				args: [escalationGame],
			}),
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: ReputationToken_ReputationToken.abi,
				address: repTokenAddress,
				functionName: 'approve',
				args: [questionLedger, MAX_UINT256],
			}),
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'startFromFork',
				args: startFromForkArgs,
			}),
		)
		return { escalationGame, questionLedger }
	}

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
		await setupTestAccounts(mockWindow)
		depositDelegate = await deployContract(client, encodeDeployData({ abi: statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.abi, bytecode: `0x${statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.evm.bytecode.object}`, args: [] }))
		await ensureZoltarDeployed(client)
	})

	for (const ownFork of [false, true])
		test(`funds three-outcome carry from the exact escrow remaining after irrevocable surplus (${ownFork ? 'own fork' : 'unrelated fork'})`, async () => {
			const proofVerifier = await deployContract(client, encodeDeployData({ abi: statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.abi, bytecode: `0x${statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.evm.bytecode.object}` }))
			const lowStake = NON_DECISION_THRESHOLD - START_BOND
			const childBacking = FORK_THRESHOLD - (ownFork ? FORK_THRESHOLD / 5n : 0n)
			const { escalationGame, questionLedger } = await deployStartedForkContinuation(getZoltarAddress(), proofVerifier, [START_BOND, NON_DECISION_THRESHOLD, ESCALATION_TIME_LENGTH, QuestionOutcome.Yes, ownFork, childBacking])
			const balances = [lowStake, NON_DECISION_THRESHOLD, NON_DECISION_THRESHOLD] as const
			const peaks = [zeroPeaks(), zeroPeaks(), zeroPeaks()] as const
			for (const outcome of [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No] as const) {
				peaks[outcome][0] = hashCarryLeaf(client.account.address, outcome, balances[outcome], BigInt(outcome), balances[outcome], BigInt(outcome + 1))
			}
			for (let outcome = 0; outcome < 3; outcome++) {
				await writeContractAndWait(client, () => client.writeContract({ abi: initializeForkCarrySnapshotWithResolutionBalancesAbi, address: questionLedger, functionName: 'initializeForkCarrySnapshotWithResolutionBalances', args: [peaks, [1n, 1n, 1n], balances, balances, [zeroHash, zeroHash, zeroHash]] }))
			}
			await drainEscalationGameRepForTest(mockWindow, repTokenAddress, escalationGame, client.account.address)
			await writeContractAndWait(client, () => client.writeContract({ abi: ReputationToken_ReputationToken.abi, address: repTokenAddress, functionName: 'transfer', args: [escalationGame, childBacking] }))
			assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'isForkCarryFundingComplete' }), true, 'mutually exclusive reporter claims must use the actual remaining escrow, not sum of all original principal')
			await writeContractAndWait(client, () => client.writeContract({ abi: proofTestPoolArtifact.abi, address: questionLedger, functionName: 'resumeEscalationGameFromFork' }))
			const resumedAt = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'forkResumedAt' })
			await mockWindow.setTime(resumedAt + 3n * 24n * 60n * 60n + 1n)
			const walletBefore = await getERC20Balance(client, repTokenAddress, client.account.address)
			const proof = {
				depositor: client.account.address,
				amountAttoRep: NON_DECISION_THRESHOLD,
				parentDepositIndex: 1n,
				cumulativeAmountAttoRep: NON_DECISION_THRESHOLD,
				sourceNodeId: 2n,
				leafIndex: 0n,
				merkleMountainRangeSiblings: [] as readonly Hex[],
				merkleMountainRangePeakIndex: 0n,
				nullifierSiblings: new SparseNullifierTree().getProof(1n),
			}
			await writeContractAndWait(client, () => client.writeContract({ abi: proofTestPoolArtifact.abi, address: questionLedger, functionName: 'withdrawDeposit', args: [QuestionOutcome.Yes, proof] }))
			assert.strictEqual((await getERC20Balance(client, repTokenAddress, client.account.address)) - walletBefore, NON_DECISION_THRESHOLD + (NON_DECISION_THRESHOLD * 3n) / 5n, 'the full original winning payout must remain funded after the surplus is removed')
			assert.strictEqual(await getERC20Balance(client, repTokenAddress, escalationGame), 0n)
		})

	test('requires the full authenticated backing snapshot even for a small nominal source', async () => {
		const proofVerifier = await deployContract(
			client,
			encodeDeployData({
				abi: statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.abi,
				bytecode: `0x${statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.evm.bytecode.object}`,
			}),
		)
		const sourcePrincipalAtFork = 6n
		const exactMinimumBacking = sourcePrincipalAtFork

		const deployContinuation = async (initialBacking: bigint) => {
			const { escalationGame, questionLedger } = await deployStartedForkContinuation(getZoltarAddress(), proofVerifier, [1n, 10n, 0n, QuestionOutcome.Yes, true, initialBacking])

			const invalidPeaks = zeroPeaks()
			const yesPeaks = zeroPeaks()
			const noPeaks = zeroPeaks()
			yesPeaks[0] = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, sourcePrincipalAtFork, 1n, sourcePrincipalAtFork, 1n)
			for (let outcome = 0; outcome < 3; outcome++) {
				await writeContractAndWait(client, () =>
					client.writeContract({
						abi: initializeForkCarrySnapshotWithResolutionBalancesAbi,
						address: questionLedger,
						functionName: 'initializeForkCarrySnapshotWithResolutionBalances',
						args: [
							[invalidPeaks, yesPeaks, noPeaks],
							[0n, 1n, 0n],
							[0n, sourcePrincipalAtFork, 0n],
							[0n, sourcePrincipalAtFork, 0n],
							[zeroHash, zeroHash, zeroHash],
						],
					}),
				)
			}
			return { escalationGame, questionLedger }
		}

		const { escalationGame: underfundedGame, questionLedger: underfundedPool } = await deployContinuation(exactMinimumBacking)
		await drainEscalationGameRepForTest(mockWindow, repTokenAddress, underfundedGame, client.account.address)
		await writeContractAndWait(client, () => client.writeContract({ abi: ReputationToken_ReputationToken.abi, address: repTokenAddress, functionName: 'transfer', args: [underfundedGame, exactMinimumBacking - 1n] }))
		assert.strictEqual(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: underfundedGame,
				functionName: 'isForkCarryFundingComplete',
				args: [],
			}),
			false,
			'a one-unit shortfall from the authenticated inventory must block resumption',
		)
		await assert.rejects(
			client.writeContract({
				abi: proofTestPoolArtifact.abi,
				address: underfundedPool,
				functionName: 'resumeEscalationGameFromFork',
				args: [],
			}),
			/Fork carry underfunded/,
		)

		const { escalationGame: exactlyFundedGame, questionLedger: exactlyFundedPool } = await deployContinuation(exactMinimumBacking)
		assert.strictEqual(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: exactlyFundedGame,
				functionName: 'isForkCarryFundingComplete',
				args: [],
			}),
			true,
			'the exact authenticated source inventory must permit resumption',
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: proofTestPoolArtifact.abi,
				address: exactlyFundedPool,
				functionName: 'resumeEscalationGameFromFork',
				args: [],
			}),
		)
		assert.ok(
			(await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: exactlyFundedGame,
				functionName: 'forkResumedAt',
				args: [],
			})) > 0n,
			'exactly funded continuation must resume',
		)
	})

	for (const forkBurnDivisor of [5n, 7n, 100n]) {
		test(`below-threshold inherited ties preserve game thresholds with burn divisor ${forkBurnDivisor}`, async () => {
			const canonicalQuestionData = await client.readContract({ abi: Zoltar_Zoltar.abi, address: getZoltarAddress(), functionName: 'zoltarQuestionData' })
			const zoltar = await deployContract(client, encodeDeployData({ abi: Zoltar_Zoltar.abi, bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`, args: [canonicalQuestionData, repTokenAddress, 20n, forkBurnDivisor] }))
			await overrideGenesisTheoreticalSupply(mockWindow, client, repTokenAddress, FORK_THRESHOLD * 20n)
			const proofVerifier = await deployContract(client, encodeDeployData({ abi: statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.abi, bytecode: `0x${statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.evm.bytecode.object}` }))
			const { escalationGame, questionLedger } = await deployStartedForkContinuation(zoltar, proofVerifier, [START_BOND, NON_DECISION_THRESHOLD, ESCALATION_TIME_LENGTH, QuestionOutcome.None, false, FORK_THRESHOLD])
			const inheritedBalance = NON_DECISION_THRESHOLD / (2n * forkBurnDivisor)
			for (let outcome = 0; outcome < 3; outcome++) {
				await writeContractAndWait(client, () =>
					client.writeContract({
						abi: initializeForkCarrySnapshotWithResolutionBalancesAbi,
						address: questionLedger,
						functionName: 'initializeForkCarrySnapshotWithResolutionBalances',
						args: [
							[zeroPeaks(), zeroPeaks(), zeroPeaks()],
							[0n, 1n, 1n],
							[0n, NON_DECISION_THRESHOLD, NON_DECISION_THRESHOLD],
							[0n, inheritedBalance, inheritedBalance],
							[zeroHash, zeroHash, zeroHash],
						],
					}),
				)
			}
			const backing = await getERC20Balance(client, repTokenAddress, escalationGame)
			await writeContractAndWait(client, () => client.writeContract({ abi: ReputationToken_ReputationToken.abi, address: repTokenAddress, functionName: 'transfer', args: [escalationGame, FORK_THRESHOLD - backing] }))
			assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'canTriggerOwnFork' }), false)
			await writeContractAndWait(client, () => client.writeContract({ abi: proofTestPoolArtifact.abi, address: questionLedger, functionName: 'resumeEscalationGameFromFork' }))
			// A real REP burn lowers the universe threshold without changing this game's
			// inherited threshold. A new report must use the game threshold consistently.
			await writeContractAndWait(client, () => client.writeContract({ abi: ReputationToken_ReputationToken.abi, address: repTokenAddress, functionName: 'approve', args: [zoltar, MAX_UINT256] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: Zoltar_Zoltar.abi, address: zoltar, functionName: 'burnRep', args: [0n, FORK_THRESHOLD * 10n] }))
			const liveThreshold = await client.readContract({ abi: Zoltar_Zoltar.abi, address: zoltar, functionName: 'getForkThresholdAttoRep', args: [0n] })
			assert.strictEqual(liveThreshold, FORK_THRESHOLD / 2n)
			const preview = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'previewDepositOnOutcome', args: [QuestionOutcome.Yes, NON_DECISION_THRESHOLD] })
			await writeContractAndWait(client, () => client.writeContract({ abi: proofTestPoolArtifact.abi, address: questionLedger, functionName: 'depositOnOutcome', args: [client.account.address, QuestionOutcome.Yes, NON_DECISION_THRESHOLD] }))
			assert.strictEqual(preview[1], NON_DECISION_THRESHOLD)
			assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'nonDecisionState' }), 0n, 'a strict winning report must not fabricate a local non-decision')
			assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'canTriggerOwnFork' }), false)
			const endDate = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'getEscalationGameEndDate' })
			if ((await mockWindow.getTime()) <= endDate) await mockWindow.setTime(endDate + 1n)
			assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'getFinalQuestionResolution' }), BigInt(QuestionOutcome.Yes))
		})
	}

	test('rejects unsafe divisors and blocks fork resume until the maximum-bonus winner is fully backed', async () => {
		const canonicalQuestionData = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			address: getZoltarAddress(),
			functionName: 'zoltarQuestionData',
			args: [],
		})
		const proofVerifier = await deployContract(
			client,
			encodeDeployData({
				abi: statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.abi,
				bytecode: `0x${statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.evm.bytecode.object}`,
			}),
		)
		const expectedWinningPayout = NON_DECISION_THRESHOLD + (NON_DECISION_THRESHOLD * 3n) / 5n

		for (const unsafeForkBurnDivisor of [2n, 3n, 4n]) {
			await assert.rejects(
				deployContract(
					client,
					encodeDeployData({
						abi: Zoltar_Zoltar.abi,
						bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
						args: [canonicalQuestionData, repTokenAddress, 20n, unsafeForkBurnDivisor],
					}),
				),
				/Zoltar fork burn divisor must be at least five/,
			)
		}

		const forkBurnDivisor = 5n
		const zoltar = await deployContract(
			client,
			encodeDeployData({
				abi: Zoltar_Zoltar.abi,
				bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
				args: [canonicalQuestionData, repTokenAddress, 20n, forkBurnDivisor],
			}),
		)
		await overrideGenesisTheoreticalSupply(mockWindow, client, repTokenAddress, FORK_THRESHOLD * 20n)
		assert.strictEqual(
			await client.readContract({
				abi: Zoltar_Zoltar.abi,
				address: zoltar,
				functionName: 'getForkThresholdAttoRep',
				args: [0n],
			}),
			FORK_THRESHOLD,
			'the isolated Zoltar deployment must use the intended fork threshold',
		)

		const childBacking = FORK_THRESHOLD - FORK_THRESHOLD / forkBurnDivisor
		const { escalationGame, questionLedger } = await deployStartedForkContinuation(zoltar, proofVerifier, [START_BOND, NON_DECISION_THRESHOLD, ESCALATION_TIME_LENGTH, QuestionOutcome.Yes, true, childBacking])

		const yesParentDepositIndex = 1_001n + forkBurnDivisor
		const noParentDepositIndex = 2_001n + forkBurnDivisor
		const yesSourceNodeId = 1n
		const noSourceNodeId = 2n
		const invalidPeaks = zeroPeaks()
		const yesPeaks = zeroPeaks()
		const noPeaks = zeroPeaks()
		yesPeaks[0] = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, NON_DECISION_THRESHOLD, yesParentDepositIndex, NON_DECISION_THRESHOLD, yesSourceNodeId)
		noPeaks[0] = hashCarryLeaf(client.account.address, QuestionOutcome.No, NON_DECISION_THRESHOLD, noParentDepositIndex, NON_DECISION_THRESHOLD, noSourceNodeId)
		for (let outcome = 0; outcome < 3; outcome++) {
			await writeContractAndWait(client, () =>
				client.writeContract({
					abi: initializeForkCarrySnapshotWithResolutionBalancesAbi,
					address: questionLedger,
					functionName: 'initializeForkCarrySnapshotWithResolutionBalances',
					args: [
						[invalidPeaks, yesPeaks, noPeaks],
						[0n, 1n, 1n],
						[0n, NON_DECISION_THRESHOLD, NON_DECISION_THRESHOLD],
						[0n, NON_DECISION_THRESHOLD, NON_DECISION_THRESHOLD],
						[zeroHash, zeroHash, zeroHash],
					],
				}),
			)
		}

		// Snapshot initialization transfers the full parent REP principal. Replacing it
		// with one attoREP less than the exact post-fork backing tests both the view gate and
		// the state-changing resume guard at the solvency boundary.
		await drainEscalationGameRepForTest(mockWindow, repTokenAddress, escalationGame, client.account.address)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: ReputationToken_ReputationToken.abi,
				address: repTokenAddress,
				functionName: 'transfer',
				args: [escalationGame, childBacking - 1n],
			}),
		)
		assert.strictEqual(await getERC20Balance(client, repTokenAddress, escalationGame), childBacking - 1n, 'child game must begin one attoREP below the safe post-fork backing')
		assert.strictEqual(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'isForkCarryFundingComplete',
				args: [],
			}),
			false,
			'the funding view must reject a one-attoETH shortfall',
		)
		await assert.rejects(
			client.writeContract({
				abi: proofTestPoolArtifact.abi,
				address: questionLedger,
				functionName: 'resumeEscalationGameFromFork',
				args: [],
			}),
			/Fork carry underfunded/,
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: ReputationToken_ReputationToken.abi,
				address: repTokenAddress,
				functionName: 'transfer',
				args: [escalationGame, 1n],
			}),
		)
		assert.strictEqual(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'isForkCarryFundingComplete',
				args: [],
			}),
			true,
			'the funding view must accept the exact divisor-five backing',
		)

		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: proofTestPoolArtifact.abi,
				address: questionLedger,
				functionName: 'resumeEscalationGameFromFork',
				args: [],
			}),
		)
		const forkResumedAt = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'forkResumedAt',
			args: [],
		})
		await mockWindow.setTime(forkResumedAt + 3n * 24n * 60n * 60n + 1n)
		assert.strictEqual(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'getFinalQuestionResolution',
				args: [],
			}),
			BigInt(QuestionOutcome.Yes),
			'the inherited fixed outcome must be final before settlement',
		)

		const proof = {
			depositor: client.account.address,
			amountAttoRep: NON_DECISION_THRESHOLD,
			parentDepositIndex: yesParentDepositIndex,
			cumulativeAmountAttoRep: NON_DECISION_THRESHOLD,
			sourceNodeId: yesSourceNodeId,
			leafIndex: 0n,
			merkleMountainRangeSiblings: [] as readonly Hex[],
			merkleMountainRangePeakIndex: 0n,
			nullifierSiblings: new SparseNullifierTree().getProof(0n),
		}
		const walletRepBeforeClaim = await getERC20Balance(client, repTokenAddress, client.account.address)

		assert.strictEqual(childBacking, expectedWinningPayout, 'divisor 5 must leave exactly enough REP for the maximum-bonus winner')
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: proofTestPoolArtifact.abi,
				address: questionLedger,
				functionName: 'withdrawDeposit',
				args: [QuestionOutcome.Yes, proof],
			}),
		)
		assert.strictEqual((await getERC20Balance(client, repTokenAddress, client.account.address)) - walletRepBeforeClaim, expectedWinningPayout, 'the backed winner must receive the full payout')
		assert.strictEqual(await getERC20Balance(client, repTokenAddress, escalationGame), 0n, 'the exactly backed game should settle with no residual REP')
	})
})
