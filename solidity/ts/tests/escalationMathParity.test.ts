import { allocatedWinningPayout, ordinaryWinningPayout } from '../../../augurScan/src/claim-payout'
import { buildCarryMerkleMountainRangeProof, createSparseNullifier, hashCarryLeaf as hashSharedCarryLeaf } from '@zoltar/core-shared/evm/carryProof'
import { beforeEach, describe, test } from 'bun:test'
import { concatHex, encodeAbiParameters, keccak256, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import assert from '../testSupport/simulator/utils/assert'
import type { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import type { WriteClient } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { getActivationTime, getBalances, getEscalationGameDeposits, readCarryTotal } from '../testSupport/simulator/utils/contracts/escalationGame'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier, statoblast_EscalationGame_EscalationGame, test_statoblast_EscalationGameProofTestSecurityPool_EscalationGameProofTestSecurityPool as escalationGameProofTestPoolArtifact } from '../types/contractArtifact'
import { computeEscalationFinalityElapsed, ESCALATION_TIME_LENGTH, getWinningEscalationDepositClaimAmount, getWinningImportedEscalationDepositClaimAmount, projectEscalationDeposit } from '@zoltar/statoblast-shared/escalationGame/escalationMath'
import { requireContractAddress } from './escalationGame/carryHelpers'
import { useEscalationGameFixture } from './escalationGame/fixture'

describe('Escalation math parity', () => {
	const fixture = useEscalationGameFixture()
	const {
		reportBond,
		nonDecisionThresholdAttoRep,
		recursiveResolutionTargetCost,
		deployEscalationGameWithProofPool,
		deployEscalationGameTestSecurityPool,
		deployForkContinuationEscalationGame,
		readOutcomeCarrySnapshot,
		depositOnOutcomeViaTestSecurityPool,
		initializeSnapshotViaTestSecurityPool,
		recordForkedEscrowForOutcomeViaTestSecurityPool,
		withdrawDepositViaProofTestSecurityPool,
		advanceForkContinuationPastStart,
		createCarryProof,
	} = fixture
	const NULLIFIER_DEPTH = 64
	const ZERO_HASH: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'
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

	const hashParent = (left: Hex, right: Hex) => keccak256(concatHex([left, right]))

	const buildZeroHashes = () => {
		const zeroHashes: Hex[] = [ZERO_HASH]
		for (let depth = 0; depth < NULLIFIER_DEPTH; depth += 1) {
			const previousHash = zeroHashes[depth]
			if (previousHash === undefined) throw new Error(`Zero hash missing at depth ${depth.toString()}`)
			zeroHashes.push(hashParent(previousHash, previousHash))
		}
		return zeroHashes
	}

	const createNullifierPath = (parentDepositIndex: bigint) => BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }], [parentDepositIndex]))) & ((1n << BigInt(NULLIFIER_DEPTH)) - 1n)

	class SparseNullifierTree {
		private readonly zeroHashes = buildZeroHashes()
		private readonly nodes = new Map<string, Hex>()
		private readonly pathMask = (1n << BigInt(NULLIFIER_DEPTH)) - 1n

		getProof(parentDepositIndex: bigint) {
			const path = createNullifierPath(parentDepositIndex) & this.pathMask
			const siblings: Hex[] = []
			let nodeIndex = path
			for (let depth = 0; depth < NULLIFIER_DEPTH; depth += 1) {
				const siblingIndex = nodeIndex ^ 1n
				const defaultHash = this.zeroHashes[depth]
				if (defaultHash === undefined) throw new Error(`Sparse tree zero hash missing at depth ${depth.toString()}`)
				siblings.push(this.nodes.get(`${depth}:${siblingIndex}`) ?? defaultHash)
				nodeIndex >>= 1n
			}
			return siblings
		}
	}

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
		for (const [principal, rewardAmount, rewardCumulative, binding, winningBalance, forkThreshold, nonDecisionThreshold] of [
			[81n, 33n, 75n, 100n, 160n, 500n, 1000n],
			[100n, 77n, 160n, 100n, 160n, 1000n, 1000n],
			[1n, 1n, 1000n, 0n, 1000n, 0n, 1000n],
			[10n ** 23n + 1n, 7n * 10n ** 18n + 1n, 19n * 10n ** 18n + 3n, 11n * 10n ** 18n, 20n * 10n ** 18n, 713n, 1000n],
		] as const) {
			const expected = await client.readContract({ abi, address: verifier, functionName: 'computeAllocatedWinningWithdrawal', args: [principal, rewardAmount, rewardCumulative, binding, winningBalance, forkThreshold, nonDecisionThreshold] })
			const actual = allocatedWinningPayout({ principal, rewardAmount, rewardCumulative, binding, winningBalance, forkThreshold, nonDecisionThreshold })
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
		const nullifiers = createSparseNullifier([1n, 4n])
		const root = await client.readContract({ abi, address: verifier, functionName: 'computeNullifierRoot', args: [2n, nullifiers.getProof(2n), ZERO_HASH] })
		assert.strictEqual(root, nullifiers.getRoot())
	})

	test('shared finality cutoffs match deployed forward-curve deadlines', async () => {
		for (const binding of [reportBond, 7n * reportBond, 11n * reportBond, nonDecisionThresholdAttoRep - 1n]) {
			const { escalationGameAddress: game, testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
			await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, binding + reportBond)
			await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.No, binding)
			assert.strictEqual(await readBindingCapital(game), binding)
			const elapsed = computeEscalationFinalityElapsed(reportBond, nonDecisionThresholdAttoRep, binding)
			assert.strictEqual(await readEscalationEndDate(game), (await getActivationTime(client, game)) + elapsed)
			const curve = (time: bigint) => client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'computeIterativeAttritionCostAttoRep', args: [time] })
			assert.ok((await curve(elapsed)) <= binding, 'the scheduled second must remain unresolved')
			assert.ok((await curve(elapsed + 1n)) > binding, 'the next second must strictly cross binding capital')
		}
	})

	test('shared deposit projection matches previewDepositOnOutcome and projected end time', async () => {
		const { escalationGameAddress: escalationGame, testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 9n * reportBond)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.No, 6n * reportBond)

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
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Invalid, acceptedAmount)
		const expectedEndTime = activationTime + computeEscalationFinalityElapsed(reportBond, nonDecisionThresholdAttoRep, await readBindingCapital(escalationGame))
		assert.strictEqual(await readEscalationEndDate(escalationGame), expectedEndTime, 'shared projected end time should match the contract after the same deposit')
	})

	test('shared winning-withdrawal math matches claimDepositForWinning', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 5n * reportBond)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 5n * reportBond)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.No, 10n * reportBond)

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
			address: testSecurityPoolAddress,
			functionName: 'claimDepositForWinning',
			args: [0n, QuestionOutcome.Yes],
		})
		const [, claimedAmount, originalDepositAmountAttoRep] = preview.result
		assert.strictEqual(originalDepositAmountAttoRep, firstWinningDeposit.amountAttoRep, 'claim preview should preserve the original winning principal size')
		assert.strictEqual(sharedWithdrawal, claimedAmount, 'shared model should match the contract winning-withdrawal amount')
	})

	test('shared imported winning-withdrawal math matches carried proof settlement at the reward-cap boundary', async () => {
		const parent = await deployEscalationGameTestSecurityPool()
		const firstWinningDepositAmount = 2n * reportBond
		const secondWinningDepositAmount = 2n * reportBond
		const losingDepositAmount = 2n * reportBond

		await depositOnOutcomeViaTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, firstWinningDepositAmount)
		await depositOnOutcomeViaTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, secondWinningDepositAmount)
		await depositOnOutcomeViaTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.No, losingDepositAmount)

		const { peaks: emptyOutcomePeaks, leafCount: emptyOutcomeLeafCount, carryTotal: emptyOutcomeCarryTotal, nullifierRoot: emptyOutcomeNullifierRoot } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const { peaks: parentYesPeaks, leafCount: parentYesLeafCount, carryTotal: parentYesCarryTotal, nullifierRoot: parentYesNullifierRoot } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const { peaks: parentNoPeaks, leafCount: parentNoLeafCount, carryTotal: parentNoCarryTotal, nullifierRoot: parentNoNullifierRoot } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.No)

		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, firstWinningDepositAmount, 0n, firstWinningDepositAmount, 1n)
		const child = await deployForkContinuationEscalationGame()
		await initializeSnapshotViaTestSecurityPool(
			child.testSecurityPoolAddress,
			[emptyOutcomePeaks, parentYesPeaks, parentNoPeaks],
			[emptyOutcomeLeafCount, parentYesLeafCount, parentNoLeafCount],
			[emptyOutcomeCarryTotal, parentYesCarryTotal, parentNoCarryTotal],
			[emptyOutcomeNullifierRoot, parentYesNullifierRoot, parentNoNullifierRoot],
		)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, parentYesCarryTotal, parentYesCarryTotal)
		const childBindingCapital = await readBindingCapital(child.escalationGameAddress)
		assert.strictEqual(childBindingCapital, losingDepositAmount, 'child fork should inherit the parent binding-capital depth for this snapshot')
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const secondProof = await createCarryProof(parent.escalationGameAddress, 1n, 1n, 1n, [firstLeafHash], new SparseNullifierTree().getProof(1n))
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
			address: child.testSecurityPoolAddress,
			functionName: 'withdrawDeposit',
			args: [QuestionOutcome.Yes, secondProof],
		})
		const [, claimedAmount, originalDepositAmountAttoRep] = preview.result
		assert.strictEqual(originalDepositAmountAttoRep, secondProof.amountAttoRep, 'proof preview should preserve the original imported winning principal size')
		assert.strictEqual(sharedWithdrawal, claimedAmount, 'shared imported model should match carried proof settlement')

		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, secondProof)
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), firstWinningDepositAmount, 'withdrawing the later carried proof should leave only the first winning imported principal unresolved')
	})
})
