import assert from '../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { decodeEventLog } from '@zoltar/core-shared/evm/ethereum'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { getActivationTime, getEscalationGameOutcomeState, getEscrowedRepByVault, getTotalEscrowedRep, readCarryTotal, drainEscalationGameRepForTest } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { ensureDefined } from '../../testSupport/simulator/utils/testUtils'
import { statoblast_EscalationGame_EscalationGame } from '../../types/contractArtifact'
import { isIgnorableLogDecodeError } from '../logDecodeErrors'
import { hashCarryLeaf } from '../carryProofHelpers'
import { ESCALATION_TIME_LENGTH, createDeterministicRng, zeroPeakArray, type LocalAccountingDeposit } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'

describe('Escalation Game: local accounting', () => {
	const fixture = useEscalationGameFixture()
	const {
		reportBond,
		recursiveResolutionTargetCost,
		deployEscalationGameTestQuestionLedger,
		advanceForkContinuationPastStart,
		depositOnOutcomeViaProofTestQuestionLedger,
		assertEscrowAccounting,
		assertLocalYesAccountingModel,
		withdrawDepositViaProofTestQuestionLedger,
		withdrawLocalDepositViaTestQuestionLedger,
		createCarryProof,
		initializeSnapshotViaTestQuestionLedger,
		getEscalationReplayLogs,
		deployForkContinuationEscalationGame,
		readOutcomeCarrySnapshot,
	} = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
	})

	test('ordinary surplus preserves reporter principal and conserves actual game inventory', async () => {
		const { escalationGameAddress, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		const yesReporter = client.account.address
		const noReporter = addressString(TEST_ADDRESSES[1])
		const invalidReporter = addressString(TEST_ADDRESSES[2])
		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, yesReporter, QuestionOutcome.Yes, 30n * reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, noReporter, QuestionOutcome.No, 20n * reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, invalidReporter, QuestionOutcome.Invalid, 10n * reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, invalidReporter, QuestionOutcome.Invalid, 15n * reportBond)
		assert.strictEqual(await getEscrowedRepByVault(client, escalationGameAddress, yesReporter), 30n * reportBond)
		assert.strictEqual(await getEscrowedRepByVault(client, escalationGameAddress, noReporter), 20n * reportBond)
		assert.strictEqual(await getEscrowedRepByVault(client, escalationGameAddress, invalidReporter), 25n * reportBond)
		assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'creditedSurplusAttoRep' }), 20n * reportBond)
		assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'getDisputeBackingAttoRep' }), 55n * reportBond)
	})

	test('ordinary finality retires losing principal while retaining winner claims', async () => {
		const { escalationGameAddress, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.No, 2n * reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Invalid, reportBond)
		await mockWindow.setTime((await getActivationTime(client, escalationGameAddress)) + ESCALATION_TIME_LENGTH + 1n)
		await writeContractAndWait(client, () => client.writeContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'settleOrdinaryGame' }))
		await assertEscrowAccounting(escalationGameAddress, 3n * reportBond)
		await withdrawLocalDepositViaTestQuestionLedger(testQuestionLedgerAddress, 0n, QuestionOutcome.Yes)
		await assertEscrowAccounting(escalationGameAddress, 0n)
		assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'getDisputeBackingAttoRep' }), 0n, 'winner liabilities must remain completely payable after surplus recovery')
	})

	test('proof-backed withdrawDeposit reverts before question finalization', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)

		const { peaks: parentYesPeaks, leafCount: parentLeafCount, carryTotal: parentCarryTotal } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployForkContinuationEscalationGame(0n, parentCarryTotal)
		await initializeSnapshotViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n])

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [])
		await assert.rejects(withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, proof), /Question not final/)
	})

	for (const underfunded of [false, true])
		test(`stateful local accounting remains balanced across randomized deposits and ${underfunded ? 'rejects underfunded ordinary settlement' : 'ordinary claims'}`, async () => {
			const { escalationGameAddress, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
			const firstVault = client.account.address
			const secondVault = addressString(TEST_ADDRESSES[1])
			const vaults = [firstVault, secondVault, addressString(TEST_ADDRESSES[2])]
			const deposits: LocalAccountingDeposit[] = []
			const nextRandom = createDeterministicRng(0x5eedn)

			for (let depositIndex = 0; depositIndex < 18; depositIndex += 1) {
				const vault = ensureDefined(vaults[nextRandom() % vaults.length], 'random vault index is out of range')
				const amountAttoRep = BigInt((nextRandom() % 5) + 1) * reportBond
				await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, vault, QuestionOutcome.Yes, amountAttoRep)
				deposits.push({ vault, amountAttoRep, depositIndex: BigInt(depositIndex), carryActive: true, escrowed: true })
				await assertLocalYesAccountingModel(escalationGameAddress, vaults, deposits)
			}

			const activationTime = await getActivationTime(client, escalationGameAddress)
			await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
			if (underfunded) {
				await drainEscalationGameRepForTest(mockWindow, escalationGameAddress, client.account.address)
				await assert.rejects(client.writeContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'settleOrdinaryGame' }), /Winner reserve underfunded/)
				await assertLocalYesAccountingModel(escalationGameAddress, vaults, deposits)
				return
			}
			const activeClaimOrder = deposits.filter(deposit => deposit.escrowed).sort((left, right) => Number.parseInt(((left.depositIndex * 17n) % 31n).toString(), 10) - Number.parseInt(((right.depositIndex * 17n) % 31n).toString(), 10))

			for (const deposit of activeClaimOrder) {
				await withdrawLocalDepositViaTestQuestionLedger(testQuestionLedgerAddress, deposit.depositIndex, QuestionOutcome.Yes)
				deposit.carryActive = false
				deposit.escrowed = false
				await assertLocalYesAccountingModel(escalationGameAddress, vaults, deposits)
			}
		})

	test('deposit events expose updated local escrow totals', async () => {
		const { escalationGameAddress, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		const vault = client.account.address
		const amount = 3n * reportBond
		const depositHash = await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, vault, QuestionOutcome.Yes, amount)
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
		assert.strictEqual(depositLog.args.amountAttoRep, amount, 'deposit log should expose the requested amount')
		assert.strictEqual(depositLog.args.depositIndex, 0n, 'deposit log should expose the new deposit index')
		assert.strictEqual(depositLog.args.cumulativeRepAmountAttoRep, yesState.balanceAttoRep, 'deposit log should expose the updated outcome balance')
		assert.strictEqual(depositLog.args.resultingVaultDisputeStakedAttoRep, vaultEscrow, 'deposit log should expose the updated vault escrow')
		assert.strictEqual(depositLog.args.resultingTotalDisputeStakedAttoRep, totalEscrow, 'deposit log should expose the updated total escrow')
	})

	test('aggregate-backed winner payout is sent to the authenticated wallet', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const { peaks: parentYesPeaks, leafCount: parentLeafCount, carryTotal: parentCarryTotal } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployForkContinuationEscalationGame(0n, parentCarryTotal)
		await initializeSnapshotViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [])
		const genRepToken = getRepTokenAddress(0n)
		const walletBalanceBefore = await getERC20Balance(client, genRepToken, client.account.address)
		const withdrawalHash = await withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, proof)
		const replayLogs = await getEscalationReplayLogs([withdrawalHash], new Set([child.escalationGameAddress.toLowerCase()]))
		const consumptionLog = replayLogs.find(log => log.eventName === 'CarryDepositConsumed')
		const walletBalanceAfter = await getERC20Balance(client, genRepToken, client.account.address)
		assert.strictEqual(consumptionLog?.args['reason'], 0n, 'aggregate-backed proof consumption should be a winning claim')
		assert.strictEqual(walletBalanceAfter - walletBalanceBefore, proof.amountAttoRep, 'the winning proof should transfer REP to its authenticated beneficiary')
		assert.strictEqual(await getEscrowedRepByVault(client, child.escalationGameAddress, client.account.address), 0n, 'proof-only claims should not create vault escrow')
	})

	test('aggregate-backed winner payouts consume multiple carried proofs independently', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)

		const { peaks: parentYesPeaks, leafCount: parentLeafCount, carryTotal: parentCarryTotal } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, 0n, reportBond, 1n)
		const secondLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 2n * reportBond, 1n, 3n * reportBond, 2n)

		const child = await deployForkContinuationEscalationGame(0n, parentCarryTotal)
		await initializeSnapshotViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		const repToken = getRepTokenAddress(0n)
		const firstProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [secondLeafHash])
		const walletBalanceBefore = await getERC20Balance(client, repToken, client.account.address)
		await withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, firstProof)
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), 2n * reportBond, 'the first proof should leave only the second winning principal unresolved')

		const secondProof = await createCarryProof(parent.escalationGameAddress, 1n, 1n, 1n, [firstLeafHash])
		await withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, secondProof)
		const walletBalanceAfter = await getERC20Balance(client, repToken, client.account.address)
		assert.strictEqual(walletBalanceAfter - walletBalanceBefore, parentCarryTotal, 'both winning proofs should eventually release their aggregate principal')
		assert.strictEqual(await getEscrowedRepByVault(client, child.escalationGameAddress, client.account.address), 0n, 'aggregate-backed claims should never create vault escrow')
	})
})
