import assert from '../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { decodeEventLog, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { getActivationTime, getEscalationGameOutcomeState, getEscrowedRepByVault, getTotalEscrowedRep, readCarryPeaks, readCarryLeafCount, readCarryTotal, readNullifierRoot, readCarryLeafPage } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { ensureDefined } from '../../testSupport/simulator/utils/testUtils'
import { statoblast_EscalationGame_EscalationGame, test_statoblast_EscalationGameProofTestSecurityPool_EscalationGameProofTestSecurityPool as escalationGameProofTestPoolArtifact } from '../../types/contractArtifact'
import { isIgnorableLogDecodeError } from '../logDecodeErrors'
import { hashCarryLeaf, SparseNullifierTree } from '../carryProofHelpers'
import { ESCALATION_TIME_LENGTH, createDeterministicRng, zeroHash, zeroPeakArray, type LocalAccountingDeposit } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'

describe('Escalation Game: local accounting and exports', () => {
	const fixture = useEscalationGameFixture()
	const {
		reportBond,
		nonDecisionThresholdAttoRep,
		recursiveResolutionTargetCost,
		deployEscalationGameTestSecurityPool,
		deployEscalationGameWithProofPool,
		startEscalation,
		startEscalationFromFork,
		advanceForkContinuationPastStart,
		depositOnOutcomeViaProofTestSecurityPool,
		assertEscrowAccounting,
		assertLocalYesAccountingModel,
		withdrawDepositViaProofTestSecurityPool,
		claimDepositForWinningViaTestSecurityPool,
		createCarryProof,
		assertOutcomeCarryTotalsMatchComponents,
		initializeSnapshotViaTestSecurityPool,
		getEscalationReplayLogs,
	} = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
	})

	test('proof-backed withdrawDeposit reverts before question finalization', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)

		const parentLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof), /Question not final/)
	})

	test('vault unresolved export moves aggregate totals once without scanning deposit history', async () => {
		const deployment = await deployEscalationGameWithProofPool()
		await startEscalation(deployment.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		const depositCount = 65
		for (let index = 0; index < depositCount; index += 1) {
			await depositOnOutcomeViaProofTestSecurityPool(deployment.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		}
		await assertEscrowAccounting(deployment.escalationGameAddress, BigInt(depositCount) * reportBond)
		await assertOutcomeCarryTotalsMatchComponents(deployment.escalationGameAddress)

		const receiver = client.account.address
		const repToken = getRepTokenAddress(0n)
		const receiverBalanceBefore = await getERC20Balance(client, repToken, receiver)
		const carryTotalBeforeExport = await readCarryTotal(client, deployment.escalationGameAddress, QuestionOutcome.Yes)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: deployment.testSecurityPoolAddress,
				functionName: 'exportVaultUnresolvedDeposits',
				args: [client.account.address, receiver],
			}),
		)
		const receiverBalanceAfterExport = await getERC20Balance(client, repToken, receiver)
		const localPrincipalAfterExport = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: deployment.escalationGameAddress,
			functionName: 'getLocalUnresolvedPrincipalByVaultAndOutcome',
			args: [client.account.address, QuestionOutcome.Yes],
		})
		await assertEscrowAccounting(deployment.escalationGameAddress, 0n)
		await assert.rejects(
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: deployment.testSecurityPoolAddress,
				functionName: 'exportVaultUnresolvedDeposits',
				args: [client.account.address, receiver],
			}),
			/Vault totals exported/,
		)
		assert.strictEqual(receiverBalanceAfterExport - receiverBalanceBefore, BigInt(depositCount) * reportBond, 'one export should transfer the complete aggregate vault principal')
		assert.strictEqual(localPrincipalAfterExport, 0n, 'aggregate export should clear the vault outcome total')
		assert.strictEqual(await readCarryTotal(client, deployment.escalationGameAddress, QuestionOutcome.Yes), carryTotalBeforeExport, 'aggregate export should leave the immutable parent carry commitment unchanged')
	})

	test('local unresolved export by deposit index consumes only the selected local deposit', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameWithProofPool()
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)
		await assertEscrowAccounting(escalationGameAddress, 3n * reportBond)

		const preview = await client.simulateContract({
			abi: escalationGameProofTestPoolArtifact.abi,
			address: testSecurityPoolAddress,
			functionName: 'exportLocalUnresolvedDeposit',
			args: [0n, QuestionOutcome.Yes],
		})
		assert.deepStrictEqual(preview.result, [client.account.address, reportBond, 0n], 'local export should return the selected depositor, amount, and stable parent index')

		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: testSecurityPoolAddress,
				functionName: 'exportLocalUnresolvedDeposit',
				args: [0n, QuestionOutcome.Yes],
			}),
		)
		await assertEscrowAccounting(escalationGameAddress, 2n * reportBond)
		await assertOutcomeCarryTotalsMatchComponents(escalationGameAddress)
		const [carryPage] = await readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Yes, 0n, 2n)
		assert.deepStrictEqual(
			carryPage.map(leaf => ({
				depositor: leaf.depositor,
				amountAttoRep: leaf.amountAttoRep,
				parentDepositIndex: leaf.parentDepositIndex,
			})),
			[
				{
					depositor: client.account.address,
					amountAttoRep: 2n * reportBond,
					parentDepositIndex: 1n,
				},
			],
			'exporting one local deposit should leave only the unresolved sibling deposit in newest-first paging',
		)
	})

	test('stateful local accounting model stays balanced across randomized deposits, exports, and claims', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameWithProofPool()
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		const firstVault = client.account.address
		const secondVault = addressString(TEST_ADDRESSES[1])
		const vaults = [firstVault, secondVault, addressString(TEST_ADDRESSES[2])]
		const deposits: LocalAccountingDeposit[] = []
		const nextRandom = createDeterministicRng(0x5eedn)

		const exportVault = async (vault: Address) => {
			await writeContractAndWait(client, async () =>
				client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: testSecurityPoolAddress,
					functionName: 'exportVaultUnresolvedDeposits',
					args: [vault, client.account.address],
				}),
			)

			for (const deposit of deposits) {
				if (deposit.vault === vault) deposit.escrowed = false
			}
		}

		for (let depositIndex = 0; depositIndex < 18; depositIndex += 1) {
			const vault = ensureDefined(vaults[nextRandom() % vaults.length], 'random vault index is out of range')
			const amountAttoRep = BigInt((nextRandom() % 5) + 1) * reportBond
			await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, vault, QuestionOutcome.Yes, amountAttoRep)
			deposits.push({ vault, amountAttoRep, depositIndex: BigInt(depositIndex), carryActive: true, escrowed: true })
			await assertLocalYesAccountingModel(escalationGameAddress, vaults, deposits)
		}
		await exportVault(firstVault)
		await assertLocalYesAccountingModel(escalationGameAddress, vaults, deposits)
		await exportVault(secondVault)
		await assertLocalYesAccountingModel(escalationGameAddress, vaults, deposits)

		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		const activeClaimOrder = deposits.filter(deposit => deposit.escrowed).sort((left, right) => Number.parseInt(((left.depositIndex * 17n) % 31n).toString(), 10) - Number.parseInt(((right.depositIndex * 17n) % 31n).toString(), 10))

		for (const deposit of activeClaimOrder) {
			await claimDepositForWinningViaTestSecurityPool(testSecurityPoolAddress, deposit.depositIndex, QuestionOutcome.Yes)
			deposit.carryActive = false
			deposit.escrowed = false
			await assertLocalYesAccountingModel(escalationGameAddress, vaults, deposits)
		}
	})

	test('deposit events expose updated local escrow totals', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		const vault = client.account.address
		const amount = 3n * reportBond
		const depositHash = await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, vault, QuestionOutcome.Yes, amount)
		const depositReceipt = await client.waitForTransactionReceipt({ hash: depositHash })
		const depositLog = depositReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: statoblast_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.find(log => log?.eventName === 'DepositOnOutcome')
		if (depositLog === undefined) throw new Error('missing DepositOnOutcome log')

		const vaultEscrow = await getEscrowedRepByVault(client, escalationGameAddress, vault)
		const totalEscrow = await getTotalEscrowedRep(client, escalationGameAddress)
		const yesState = await getEscalationGameOutcomeState(client, escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(depositLog.args.depositor, vault, 'deposit log should identify the depositing vault')
		assert.strictEqual(depositLog.args.outcome, BigInt(QuestionOutcome.Yes), 'deposit log should identify the outcome')
		assert.strictEqual(depositLog.args.attoRepAmount, amount, 'deposit log should expose the requested amount')
		assert.strictEqual(depositLog.args.depositIndex, 0n, 'deposit log should expose the new deposit index')
		assert.strictEqual(depositLog.args.cumulativeRepAmountAttoRep, yesState.balanceAttoRep, 'deposit log should expose the updated outcome balance')
		assert.strictEqual(depositLog.args.resultingVaultDisputeStakedAttoRep, vaultEscrow, 'deposit log should expose the updated vault escrow')
		assert.strictEqual(depositLog.args.resultingTotalDisputeStakedAttoRep, totalEscrow, 'deposit log should expose the updated total escrow')
	})

	test('aggregate-backed winner payout is sent to the authenticated wallet', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		const genRepToken = getRepTokenAddress(0n)
		const walletBalanceBefore = await getERC20Balance(client, genRepToken, client.account.address)
		const withdrawalHash = await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		const replayLogs = await getEscalationReplayLogs([withdrawalHash], new Set([child.escalationGameAddress.toLowerCase()]))
		const consumptionLog = replayLogs.find(log => log.eventName === 'CarryDepositConsumed')
		const walletBalanceAfter = await getERC20Balance(client, genRepToken, client.account.address)
		assert.strictEqual(consumptionLog?.args['reason'], 0n, 'aggregate-backed proof consumption should be a winning claim')
		assert.strictEqual(walletBalanceAfter - walletBalanceBefore, proof.amountAttoRep, 'the winning proof should transfer REP to its authenticated beneficiary')
		assert.strictEqual(await getEscrowedRepByVault(client, child.escalationGameAddress, client.account.address), 0n, 'proof-only claims should not create vault escrow')
	})

	test('aggregate-backed winner payouts consume multiple carried proofs independently', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)

		const parentLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, 0n, reportBond, 1n)
		const secondLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 2n * reportBond, 1n, 3n * reportBond, 2n)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		const repToken = getRepTokenAddress(0n)
		const nullifierTree = new SparseNullifierTree()
		const firstProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [secondLeafHash], nullifierTree.getProof(0n))
		const walletBalanceBefore = await getERC20Balance(client, repToken, client.account.address)
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, firstProof)
		nullifierTree.consume(0n)
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), 2n * reportBond, 'the first proof should leave only the second winning principal unresolved')

		const secondProof = await createCarryProof(parent.escalationGameAddress, 1n, 1n, 1n, [firstLeafHash], nullifierTree.getProof(1n))
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, secondProof)
		const walletBalanceAfter = await getERC20Balance(client, repToken, client.account.address)
		assert.strictEqual(walletBalanceAfter - walletBalanceBefore, parentCarryTotal, 'both winning proofs should eventually release their aggregate principal')
		assert.strictEqual(await getEscrowedRepByVault(client, child.escalationGameAddress, client.account.address), 0n, 'aggregate-backed claims should never create vault escrow')
	})
})
