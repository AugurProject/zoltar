import { beforeEach, describe, test } from 'bun:test'
import { initializeForkCarrySnapshotFromSourceAbi } from './carrySnapshotAbis'
import { encodeDeployData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { deployContract } from '../testSupport/deployContract'
import type { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import assert from '../testSupport/simulator/utils/assert'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES, MAX_UINT256 } from '../testSupport/simulator/utils/constants'
import { ensureInfraDeployed, getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { ensureZoltarDeployed, getRepTokenAddress, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { getERC20Balance, setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { ReputationToken_ReputationToken, statoblast_EscalationGame_EscalationGame, statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier, test_statoblast_EscalationGameProofTestQuestionLedger_EscalationGameProofTestQuestionLedger as proofTestPoolArtifact } from '../types/contractArtifact'
import { computeForkContinuationParentDepositIndex, createCarryProof, hashParent, readCarryLeafHash } from './carryProofHelpers'

const REPORT_BOND = 10n ** 18n
const NON_DECISION_THRESHOLD = 1000n * REPORT_BOND
const FRESH_FORK_RESPONSE_PERIOD = 3n * 24n * 60n * 60n
const zeroHash: Hex = `0x${'0'.repeat(64)}`
const zeroPeaks = () => Array.from({ length: 64 }, () => zeroHash)

type Game = { escalationGame: Address; questionLedger: Address }

describe('Audit regression: escalation carry proofs use global MMR leaf positions', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const repToken = getRepTokenAddress(0n)

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
	})

	const depositYes = async (questionLedger: Address, depositor: Address, amountAttoRep: bigint) => await writeContractAndWait(client, () => client.writeContract({ abi: proofTestPoolArtifact.abi, address: questionLedger, functionName: 'depositOnOutcome', args: [depositor, QuestionOutcome.Yes, amountAttoRep] }))

	const deployGame = async (): Promise<Game> => {
		const questionLedger = await deployContract(client, encodeDeployData({ abi: proofTestPoolArtifact.abi, bytecode: `0x${proofTestPoolArtifact.evm.bytecode.object}`, args: [getZoltarAddress(), 0n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: ReputationToken_ReputationToken.abi, address: repToken, functionName: 'approve', args: [questionLedger, MAX_UINT256] }))
		const proofVerifier = await deployContract(client, encodeDeployData({ abi: statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.abi, bytecode: `0x${statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.evm.bytecode.object}` }))
		const escalationGame = await deployContract(
			client,
			encodeDeployData({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				bytecode: `0x${statoblast_EscalationGame_EscalationGame.evm.bytecode.object}`,
				args: [questionLedger, repToken, proofVerifier, getInfraContractAddresses().escalationGameDepositDelegate],
			}),
		)
		await writeContractAndWait(client, () => client.writeContract({ abi: proofTestPoolArtifact.abi, address: questionLedger, functionName: 'setEscalationGame', args: [escalationGame] }))
		return { escalationGame, questionLedger }
	}

	const readYesState = async (escalationGame: Address) => await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'getOutcomeState', args: [QuestionOutcome.Yes] })

	const deployContinuation = async (source: Address) => {
		const continuation = await deployGame()
		const sourceYes = await readYesState(source)
		// The inherited backing is the source's reporter escrow, here exactly its Yes carry.
		await writeContractAndWait(client, () =>
			client.writeContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: continuation.escalationGame, functionName: 'startFromFork', args: [REPORT_BOND, NON_DECISION_THRESHOLD, -FRESH_FORK_RESPONSE_PERIOD, QuestionOutcome.None, false, sourceYes.currentCarryTotalAttoRep] }),
		)
		const yesPeaks = [...sourceYes.currentPeaks]
		for (let outcome = 0; outcome < 3; outcome++) {
			await writeContractAndWait(client, () =>
				client.writeContract({
					abi: initializeForkCarrySnapshotFromSourceAbi,
					address: continuation.questionLedger,
					functionName: 'initializeForkCarrySnapshotFromSource',
					args: [source, zeroHash, [zeroPeaks(), yesPeaks, zeroPeaks()], [0n, sourceYes.currentLeafCount, 0n], [0n, sourceYes.currentCarryTotalAttoRep, 0n]],
				}),
			)
		}
		// Preserve the inherited activation delay, then open local reporting through the real resume gate.
		await writeContractAndWait(client, () => client.writeContract({ abi: proofTestPoolArtifact.abi, address: continuation.questionLedger, functionName: 'resumeEscalationGameFromFork', args: [] }))
		return continuation
	}

	const finalizeContinuation = async ({ escalationGame }: Game) => {
		const forkResumedAt = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'forkResumedAt' })
		const endDate = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'getEscalationGameEndDate' })
		await mockWindow.setTime((endDate > forkResumedAt + FRESH_FORK_RESPONSE_PERIOD ? endDate : forkResumedAt + FRESH_FORK_RESPONSE_PERIOD) + 1n)
		assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'getFinalQuestionResolution' }), BigInt(QuestionOutcome.Yes))
	}

	test('a child-local deposit in a lower MMR peak keeps its original interval in a grandchild claim', async () => {
		const childDepositorA = addressString(TEST_ADDRESSES[1])
		const childDepositorB = addressString(TEST_ADDRESSES[2])

		// Root game: one YES leaf (global index 0).
		const root = await deployGame()
		await writeContractAndWait(client, () => client.writeContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: root.escalationGame, functionName: 'start', args: [REPORT_BOND, NON_DECISION_THRESHOLD] }))
		await depositYes(root.questionLedger, client.account.address, 4n * REPORT_BOND)

		// Child continuation inherits leaf 0 and appends
		// two local YES leaves (global indexes 1 and 2). Leaf 2 is alone in the height-0 peak.
		const child = await deployContinuation(root.escalationGame)
		await depositYes(child.questionLedger, childDepositorA, REPORT_BOND)
		await depositYes(child.questionLedger, childDepositorB, 2n * REPORT_BOND)
		const childYes = await readYesState(child.escalationGame)
		assert.strictEqual(childYes.snapshotLeafCount, 1n)
		assert.strictEqual(childYes.currentLeafCount, 3n)
		assert.strictEqual(childYes.currentCarryTotalAttoRep, 4n * REPORT_BOND + 3n * REPORT_BOND, 'child carry preserves inherited plus local reporter principal')

		const grandchild = await deployContinuation(child.escalationGame)
		await finalizeContinuation(grandchild)

		const rootLeaf = await readCarryLeafHash(client, root.escalationGame, 1n)
		const childLeafA = await readCarryLeafHash(client, child.escalationGame, 1n)
		const childLeafB = await readCarryLeafHash(client, child.escalationGame, 2n)
		const childLocalParentDepositIndex = computeForkContinuationParentDepositIndex(child.escalationGame, QuestionOutcome.Yes, 1n)
		const lowerPeakProof = await createCarryProof(client, child.escalationGame, {
			expectedOutcome: QuestionOutcome.Yes,
			parentDepositIndex: childLocalParentDepositIndex,
			sourceNodeId: 2n,
			leafIndex: 2n,
			merkleMountainRangePeakIndex: 0n,
			merkleMountainRangeSiblings: [hashParent(rootLeaf, childLeafA)],
		})
		// The offset inside the height-0 peak (0) would alias global leaf 0, which the
		// child inherited from the root. It must not verify.
		await assert.rejects(client.writeContract({ abi: proofTestPoolArtifact.abi, address: grandchild.questionLedger, functionName: 'withdrawDeposit', args: [QuestionOutcome.Yes, { ...lowerPeakProof, leafIndex: 0n }] }), /Bad carry peak/)
		const balanceBefore = await getERC20Balance(client, repToken, childDepositorB)
		await writeContractAndWait(client, () => client.writeContract({ abi: proofTestPoolArtifact.abi, address: grandchild.questionLedger, functionName: 'withdrawDeposit', args: [QuestionOutcome.Yes, lowerPeakProof] }))
		const payout = (await getERC20Balance(client, repToken, childDepositorB)) - balanceBefore
		assert.strictEqual(payout, 2n * REPORT_BOND, 'the authenticated child-local depositor receives its complete original stake')

		// Settle the remaining leaves; the inherited aggregate must reconcile exactly.
		const rootProof = await createCarryProof(client, root.escalationGame, {
			expectedOutcome: QuestionOutcome.Yes,
			parentDepositIndex: 0n,
			sourceNodeId: 1n,
			leafIndex: 0n,
			merkleMountainRangePeakIndex: 1n,
			merkleMountainRangeSiblings: [childLeafA, childLeafB],
		})
		await writeContractAndWait(client, () => client.writeContract({ abi: proofTestPoolArtifact.abi, address: grandchild.questionLedger, functionName: 'withdrawDeposit', args: [QuestionOutcome.Yes, rootProof] }))
		const firstChildParentDepositIndex = computeForkContinuationParentDepositIndex(child.escalationGame, QuestionOutcome.Yes, 0n)
		const firstChildProof = await createCarryProof(client, child.escalationGame, {
			expectedOutcome: QuestionOutcome.Yes,
			parentDepositIndex: firstChildParentDepositIndex,
			sourceNodeId: 1n,
			leafIndex: 1n,
			merkleMountainRangePeakIndex: 1n,
			merkleMountainRangeSiblings: [rootLeaf, childLeafB],
		})
		await writeContractAndWait(client, () => client.writeContract({ abi: proofTestPoolArtifact.abi, address: grandchild.questionLedger, functionName: 'withdrawDeposit', args: [QuestionOutcome.Yes, firstChildProof] }))
		assert.strictEqual((await readYesState(grandchild.escalationGame)).currentCarryTotalAttoRep, 0n, 'every inherited leaf settled, so no inherited principal may remain')
	})
})
