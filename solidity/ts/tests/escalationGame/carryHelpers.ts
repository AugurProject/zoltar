import { decodeEventLog, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import assert from '../../testSupport/simulator/utils/assert'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { getEscalationGameOutcomeState, type readCarryPeaks } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { statoblast_EscalationGame_EscalationGame } from '../../types/contractArtifact'
import { initializeForkCarrySnapshotAbi, initializeForkCarrySnapshotFromSourceAbi, initializeForkCarrySnapshotWithResolutionBalancesAbi } from '../carrySnapshotAbis'
import { hashParent } from '../carryProofHelpers'
import type { ReplayLog } from '../eventReplay/eventReplayModel'
import { isIgnorableLogDecodeError } from '../logDecodeErrors'

export const ESCALATION_TIME_LENGTH = 4233600n
export const FRESH_FORK_RESPONSE_PERIOD = 3n * 24n * 60n * 60n
export const NON_DECISION_STATE_NONE = 0n
export const NON_DECISION_STATE_LOCAL = 1n
export const NON_DECISION_STATE_INHERITED_THRESHOLD_TIE = 2n

export const requireContractAddress = (value: `0x${string}` | null | undefined, context: string): `0x${string}` => {
	if (value === undefined || value === null) throw new Error(`${context} missing`)
	return value
}

export type LocalAccountingDeposit = {
	vault: Address
	amountAttoRep: bigint
	depositIndex: bigint
	carryActive: boolean
	escrowed: boolean
}

export const createDeterministicRng = (initialSeed: bigint) => {
	let seed = initialSeed
	return () => {
		seed = (seed * 1103515245n + 12345n) % (1n << 31n)
		return Number.parseInt(seed.toString(), 10)
	}
}

type PeakArray = Awaited<ReturnType<typeof readCarryPeaks>>

export const zeroHash = () => `0x${'0'.repeat(64)}` as Hex
export const oneHash = () => `0x${'0'.repeat(63)}1` as Hex

const toPeakArray = (peaks: readonly Hex[]): PeakArray => {
	if (peaks.length !== 64) {
		throw new Error(`expected 64 carry peaks, got ${peaks.length}`)
	}
	return peaks as PeakArray
}

export const zeroPeakArray = () => toPeakArray(Array.from({ length: 64 }, () => zeroHash()))

const bagCarryPeaks = (peaks: readonly Hex[], leafCount: bigint) => {
	if (leafCount === 0n) return zeroHash()
	const occupiedPeaks: Hex[] = []
	for (let peakHeight = 0; peakHeight < 64; peakHeight += 1) {
		if (((leafCount >> BigInt(peakHeight)) & 1n) === 0n) continue
		const peak = peaks[peakHeight]
		if (peak === undefined) throw new Error(`missing carry peak ${peakHeight.toString()}`)
		occupiedPeaks.push(peak)
	}
	const lastPeak = occupiedPeaks.at(-1)
	if (lastPeak === undefined) throw new Error('nonzero leaf count has no occupied carry peak')
	let root = lastPeak
	for (let peakIndex = occupiedPeaks.length - 2; peakIndex >= 0; peakIndex -= 1) {
		const peak = occupiedPeaks[peakIndex]
		if (peak === undefined) throw new Error(`missing occupied carry peak ${peakIndex.toString()}`)
		root = hashParent(peak, root)
	}
	return root
}

export function createEscalationGameCarryHelpers(getClient: () => WriteClient) {
	const assertOutcomeCarryTotalsMatchComponents = async (escalationGameAddress: Address) => {
		for (const outcome of [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]) {
			const state = await getEscalationGameOutcomeState(getClient(), escalationGameAddress, outcome)
			assert.strictEqual(state.currentCarryTotalAttoRep, state.inheritedUnresolvedTotalAttoRep + state.localUnresolvedTotalAttoRep, 'outcome carry total should equal inherited plus local unresolved REP')
		}
	}

	const initializeSnapshotViaTestSecurityPool = async (
		testSecurityPoolAddress: Address,
		inheritedCarryPeaks: readonly [PeakArray, PeakArray, PeakArray],
		inheritedCarryLeafCounts: readonly [bigint, bigint, bigint],
		inheritedCarryTotals: readonly [bigint, bigint, bigint],
		inheritedNullifierRoots: readonly [Hex, Hex, Hex],
	) =>
		await writeContractAndWait(
			getClient(),
			async () =>
				await getClient().writeContract({
					abi: initializeForkCarrySnapshotAbi,
					address: testSecurityPoolAddress,
					functionName: 'initializeForkCarrySnapshot',
					args: [inheritedCarryPeaks, inheritedCarryLeafCounts, inheritedCarryTotals, inheritedNullifierRoots],
				}),
		)

	const initializeSnapshotWithResolutionBalancesViaTestSecurityPool = async (
		testSecurityPoolAddress: Address,
		inheritedCarryPeaks: readonly [PeakArray, PeakArray, PeakArray],
		inheritedCarryLeafCounts: readonly [bigint, bigint, bigint],
		inheritedCarryTotals: readonly [bigint, bigint, bigint],
		inheritedResolutionBalances: readonly [bigint, bigint, bigint],
		inheritedNullifierRoots: readonly [Hex, Hex, Hex],
	) =>
		await writeContractAndWait(
			getClient(),
			async () =>
				await getClient().writeContract({
					abi: initializeForkCarrySnapshotWithResolutionBalancesAbi,
					address: testSecurityPoolAddress,
					functionName: 'initializeForkCarrySnapshotWithResolutionBalances',
					args: [inheritedCarryPeaks, inheritedCarryLeafCounts, inheritedCarryTotals, inheritedResolutionBalances, inheritedNullifierRoots],
				}),
		)

	const initializeSnapshotFromSourceViaTestSecurityPool = async (
		testSecurityPoolAddress: Address,
		sourceGame: Address,
		snapshotId: Hex,
		inheritedCarryPeaks: readonly [PeakArray, PeakArray, PeakArray],
		inheritedCarryLeafCounts: readonly [bigint, bigint, bigint],
		inheritedCarryTotals: readonly [bigint, bigint, bigint],
		inheritedNullifierRoots: readonly [Hex, Hex, Hex],
	) =>
		await writeContractAndWait(
			getClient(),
			async () =>
				await getClient().writeContract({
					abi: initializeForkCarrySnapshotFromSourceAbi,
					address: testSecurityPoolAddress,
					functionName: 'initializeForkCarrySnapshotFromSource',
					args: [sourceGame, snapshotId, inheritedCarryPeaks, inheritedCarryLeafCounts, inheritedCarryTotals, inheritedNullifierRoots],
				}),
		)

	const getEscalationReplayLogs = async (transactionHashes: readonly Hex[], gameAddresses: ReadonlySet<string>) => {
		const chainId = BigInt(await getClient().getChainId())
		const replayLogs: ReplayLog[] = []
		for (const transactionHash of transactionHashes) {
			const receipt = await getClient().getTransactionReceipt({ hash: transactionHash })
			for (const log of receipt.logs) {
				if (!gameAddresses.has(log.address.toLowerCase())) continue
				if (log.logIndex === null || log.logIndex === undefined) throw new Error('escalation event log is missing its log index')
				let decoded: ReturnType<typeof decodeEventLog>
				try {
					decoded = decodeEventLog({ abi: statoblast_EscalationGame_EscalationGame.abi, data: log.data, topics: log.topics })
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					continue
				}
				if (typeof decoded.args !== 'object' || decoded.args === null || Array.isArray(decoded.args)) throw new Error('escalation event arguments are not named')
				replayLogs.push({
					chainId,
					blockHash: receipt.blockHash,
					blockNumber: receipt.blockNumber,
					transactionHash: receipt.transactionHash,
					transactionIndex: Number.parseInt(receipt.transactionIndex.toString(), 10),
					logIndex: Number.parseInt(log.logIndex.toString(), 10),
					emitter: log.address,
					eventName: decoded.eventName,
					args: Object.fromEntries(Object.entries(decoded.args)),
				})
			}
		}
		return replayLogs
	}

	const assertCarryCommitmentStructure = async (escalationGameAddress: Address, label: string) => {
		const snapshot = await getClient().readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getForkCarrySnapshot',
			args: [],
		})
		const roots = await getClient().readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getForkCarryRoots',
			args: [],
		})
		const outcomes = [
			{ outcome: QuestionOutcome.Invalid, snapshotIndex: 0 },
			{ outcome: QuestionOutcome.Yes, snapshotIndex: 1 },
			{ outcome: QuestionOutcome.No, snapshotIndex: 2 },
		] as const

		for (const { outcome, snapshotIndex } of outcomes) {
			const state = await getEscalationGameOutcomeState(getClient(), escalationGameAddress, outcome)
			const snapshotPeaks = snapshot[0][snapshotIndex]
			const snapshotLeafCount = snapshot[1][snapshotIndex]
			const snapshotCarryTotal = snapshot[2][snapshotIndex]
			const snapshotNullifierRoot = snapshot[3][snapshotIndex]
			const snapshotRoot = roots[snapshotIndex]
			assert.deepStrictEqual(snapshotPeaks, state.currentPeaks, `${label}: exported peaks should match outcome ${outcome.toString()} state`)
			assert.strictEqual(snapshotLeafCount, state.currentLeafCount, `${label}: exported leaf count should match outcome ${outcome.toString()} state`)
			assert.strictEqual(snapshotCarryTotal, state.currentCarryTotalAttoRep, `${label}: exported carry total should match outcome ${outcome.toString()} state`)
			assert.strictEqual(snapshotNullifierRoot, state.currentNullifierRoot, `${label}: exported nullifier should match outcome ${outcome.toString()} state`)
			assert.strictEqual(state.currentCarryTotalAttoRep, state.inheritedUnresolvedTotalAttoRep + state.localUnresolvedTotalAttoRep, `${label}: carry total should equal inherited plus local unresolved REP`)

			for (let peakHeight = 0; peakHeight < 64; peakHeight += 1) {
				if (((state.currentLeafCount >> BigInt(peakHeight)) & 1n) !== 0n) continue
				assert.strictEqual(state.currentPeaks[peakHeight], zeroHash(), `${label}: unoccupied peak ${peakHeight.toString()} should be zero for outcome ${outcome.toString()}`)
			}
			const independentlyBaggedRoot = bagCarryPeaks(state.currentPeaks, state.currentLeafCount)
			assert.strictEqual(state.currentCarryRoot, independentlyBaggedRoot, `${label}: outcome ${outcome.toString()} root should independently bag its occupied peaks`)
			assert.strictEqual(snapshotRoot, independentlyBaggedRoot, `${label}: exported outcome ${outcome.toString()} root should match independent peak bagging`)
		}
	}

	return { assertOutcomeCarryTotalsMatchComponents, initializeSnapshotViaTestSecurityPool, initializeSnapshotWithResolutionBalancesViaTestSecurityPool, initializeSnapshotFromSourceViaTestSecurityPool, getEscalationReplayLogs, assertCarryCommitmentStructure }
}
