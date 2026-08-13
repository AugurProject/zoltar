import { bigintToSafeNumber, formatUnits, parseUnits, type Hex } from '#ethereum'
import { endpointLabel } from '#monitoring/connectivity'
import { attemptHasFinality, assertReceiptSnapshotBlockHash, canonicalBlockHashWithQuorum, transactionHashBySenderNonceWithQuorum, transactionReceiptsOrMissingWithQuorum, transactionReceiptsWithQuorum } from '#execution/execution-orchestration'
import { decimalSignedEth, decimalWeth, parseDecimalWeth, parseSignedDecimalEth, type ExecutionRecord } from '#state/operator-state'
import { formatTokenAmount } from '#monitoring/market-monitor'
import { realizedNetProfitWeth, recoveredHedgedProfitBeforeGasWeth } from '#core/position-accounting'
import { type PositionRecord } from '#state/position-store'
import { settledQuorumValue } from '#monitoring/read-quorum'
import { calculateTrackedNetProfitEth } from '#core/strategy'
import { receiptGasCost } from '#execution/transaction-tracker'
import type { ReadClient, RecoveryConfiguration } from '#core/operator-types'
import { confirmedGasExpenditures, confirmedNonceWithQuorum, hedgeExecutionFromLogs, lifecycleExecutionFromLogs, recoveredTransactionIntentMismatchWithQuorum, replacementCreditExecutionFromLogs } from '#execution/recovery-support'
import { confirmCanonicalReceiptFinality } from '@zoltar/bot-shared/execution/canonical-finality'
const REORG_OVERLAP_BLOCKS = 12n

export function tokenDecimalsFromSnapshot(snapshot: { tokenDecimals: bigint }, reportId: string) {
	const tokenDecimals = bigintToSafeNumber(snapshot.tokenDecimals, `Position ${reportId} token decimals`)
	if (tokenDecimals < 0 || tokenDecimals > 255) throw new Error(`Position ${reportId} token decimals are invalid`)
	return tokenDecimals
}

export function executionRecordForConfirmedPosition(position: PositionRecord, blockNumber: bigint, transactionHash: Hex): ExecutionRecord {
	const intent = position.executionIntent
	if (intent === undefined) throw new Error(`Position ${position.reportId} is missing its durable execution intent`)
	const executedAt = position.gasExpenditures.find(expenditure => expenditure.transactionHash.toLowerCase() === transactionHash.toLowerCase())?.minedAt ?? position.gasExpenditures.at(-1)?.minedAt
	if (executedAt === undefined) throw new Error(`Position ${position.reportId} is missing its confirmed execution timestamp`)
	return {
		...intent,
		actualGasCostEth: position.actualEntryGasCostEth,
		blockNumber: blockNumber.toString(),
		executedAt,
		trackedNetProfitEth: decimalSignedEth(calculateTrackedNetProfitEth(parseSignedDecimalEth(position.hedgedProfitBeforeGasEth), parseDecimalWeth(position.actualEntryGasCostEth))),
		transactionHash,
	}
}

export async function recoverPendingEntryWithQuorum(readClients: readonly ReadClient[], config: RecoveryConfiguration, position: PositionRecord, tokenDecimals: number, expectedBlockNumber?: bigint | undefined) {
	const executor = config.executor
	if (executor === undefined) throw new Error('Pending entry recovery requires the authenticated executor')
	const journaledPrivateTargetBlockNumber = position.entrySubmissionMode === 'private' && position.entrySubmissionBlockNumber !== undefined ? BigInt(position.entrySubmissionBlockNumber) + 1n : undefined
	if (expectedBlockNumber !== undefined && journaledPrivateTargetBlockNumber !== undefined && expectedBlockNumber !== journaledPrivateTargetBlockNumber) {
		throw new Error('Private entry target block does not match the durable journal')
	}
	const privateTargetBlockNumber = expectedBlockNumber ?? journaledPrivateTargetBlockNumber
	const receipts = await transactionReceiptsWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], `pending entry ${position.reportId}`, position.entryTransactionHashes)
	const firstReceipt = receipts[0]
	const executorReceipt = receipts.at(-1)
	if (firstReceipt === undefined || executorReceipt === undefined) throw new Error('Entry bundle receipts are missing, reverted, or split across blocks')
	const publicEntry = position.entrySubmissionMode === 'public' && expectedBlockNumber === undefined && receipts.length === 1
	const atomicPrivateEntry = position.entrySubmissionMode === 'private' && privateTargetBlockNumber !== undefined && receipts.length === 1
	const invalidPrivateReceipt = atomicPrivateEntry
		? firstReceipt.status === 'success' && firstReceipt.blockNumber !== privateTargetBlockNumber
		: !publicEntry && receipts.some(receipt => receipt.status !== 'success' || receipt.blockNumber !== firstReceipt.blockNumber || receipt.blockHash.toLowerCase() !== firstReceipt.blockHash.toLowerCase() || (privateTargetBlockNumber !== undefined && receipt.blockNumber !== privateTargetBlockNumber))
	if (invalidPrivateReceipt) throw new Error('Entry bundle receipts are missing, reverted, or split across blocks')
	const canonicalReceiptBlockHash = await canonicalBlockHashWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], `pending entry ${position.reportId}`, firstReceipt.blockNumber)
	assertReceiptSnapshotBlockHash(firstReceipt.blockHash, canonicalReceiptBlockHash, 'Entry')
	for (const [index, receipt] of receipts.entries()) {
		const expectedHash = position.entryTransactionHashes[index]
		if (expectedHash === undefined || receipt.transactionHash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error('Entry bundle receipt hash does not match the durable journal')
	}
	const actualEntryGasCost = receipts.reduce((total, receipt) => total + receiptGasCost(receipt), 0n)
	const gasExpenditures = await confirmedGasExpenditures(readClients, config, `pending entry ${position.reportId}`, receipts)
	const transactionIntentMismatch =
		publicEntry && executorReceipt.status === 'success' ? await recoveredTransactionIntentMismatchWithQuorum(readClients, config, `pending public entry ${position.reportId}`, executorReceipt.transactionHash, position.account, position.entryTransactionNonce, position.entryTransactionIntent) : undefined
	if (transactionIntentMismatch !== undefined) {
		return {
			position: {
				...position,
				actualEntryGasCostEth: decimalWeth(actualEntryGasCost),
				entryTransactionHash: executorReceipt.transactionHash,
				gasExpenditures,
				status: 'recovery-required' as const,
			},
			receipts,
		}
	}
	let hedgeExecution: ReturnType<typeof hedgeExecutionFromLogs> | undefined
	try {
		hedgeExecution = hedgeExecutionFromLogs(executorReceipt.logs, executor)
	} catch (error) {
		if (!(error instanceof Error) || error.message !== 'Confirmed executor transaction did not emit HedgeAndDisputeExecuted') throw error
		if (!publicEntry && !atomicPrivateEntry) throw new Error('Executor hedge event is missing from the durable entry receipt')
	}
	if (hedgeExecution === undefined || hedgeExecution.account.toLowerCase() !== position.account.toLowerCase() || hedgeExecution.reportId.toString() !== position.reportId) {
		if ((publicEntry || atomicPrivateEntry) && executorReceipt.status === 'reverted') {
			const closedAt = gasExpenditures.at(-1)?.minedAt
			if (closedAt === undefined) throw new Error('Recovered atomic entry gas timestamp is unavailable')
			return {
				position: {
					...position,
					actualEntryGasCostEth: decimalWeth(actualEntryGasCost),
					capitalAtRiskWeth: '0',
					closedAt,
					entryTransactionHash: executorReceipt.transactionHash,
					gasExpenditures,
					hedgedProfitBeforeGasEth: '0',
					lockedToken: '0',
					lockedWeth: '0',
					realizedNetProfitEth: decimalSignedEth(-actualEntryGasCost),
					status: 'closed' as const,
				},
				receipts,
			}
		}
		if (publicEntry || atomicPrivateEntry) {
			return {
				position: {
					...position,
					actualEntryGasCostEth: decimalWeth(actualEntryGasCost),
					entryTransactionHash: executorReceipt.transactionHash,
					gasExpenditures,
					status: 'recovery-required' as const,
				},
				receipts,
			}
		}
		throw new Error('Executor hedge event does not match the durable position')
	}
	const actualProfitBeforeGas = recoveredHedgedProfitBeforeGasWeth(position.direction, parseSignedDecimalEth(position.hedgedProfitBeforeGasEth), parseDecimalWeth(position.hedgeWeth), hedgeExecution.hedgeAmountAttoWeth)
	const confirmedPosition = {
		...position,
		actualEntryGasCostEth: decimalWeth(actualEntryGasCost),
		entryTransactionHash: executorReceipt.transactionHash,
		gasExpenditures,
		hedgeAmountToken: formatTokenAmount(hedgeExecution.hedgeAmountToken2, tokenDecimals),
		hedgeWeth: decimalWeth(hedgeExecution.hedgeAmountAttoWeth),
		hedgedProfitBeforeGasEth: decimalSignedEth(actualProfitBeforeGas),
		status: 'open' as const,
	} satisfies PositionRecord
	return {
		position: {
			...confirmedPosition,
			historyOutbox: executionRecordForConfirmedPosition(confirmedPosition, executorReceipt.blockNumber, executorReceipt.transactionHash),
		},
		receipts,
	}
}

export async function expireEntryWithQuorum(readClients: readonly ReadClient[], config: RecoveryConfiguration, position: PositionRecord, currentBlockNumber: bigint, expiredAt: string) {
	if (position.entrySubmissionMode === undefined || position.entrySubmissionBlockNumber === undefined) throw new Error('Only a journaled atomic entry can expire without inclusion')
	if (position.entryTransactionHashes.length !== 1) throw new Error('Only an atomic entry can expire automatically')
	const targetBlockNumber = BigInt(position.entrySubmissionBlockNumber) + 1n
	if (!attemptHasFinality(currentBlockNumber, targetBlockNumber)) throw new Error('Entry target block is not sufficiently confirmed')
	const finalityDescendantBlockNumber = targetBlockNumber + REORG_OVERLAP_BLOCKS
	await fixedBlockHashWithQuorum(readClients, config, `expired entry ${position.reportId} finality descendant`, finalityDescendantBlockNumber)
	const optionalReceipts = await transactionReceiptsOrMissingWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], `expired entry ${position.reportId}`, position.entryTransactionHashes)
	const executorReceipt = optionalReceipts.at(-1)
	if (executorReceipt !== undefined) throw new Error('Entry executor receipt exists and requires normal recovery')
	const transactionHash = position.entryTransactionHashes[0]
	if (transactionHash === undefined) throw new Error('Atomic entry transaction hash is missing')
	if (position.entryTransactionNonce === undefined) throw new Error('Atomic entry transaction nonce is missing')
	return {
		...position,
		actualEntryGasCostEth: '0',
		capitalAtRiskWeth: '0',
		closedAt: expiredAt,
		expiredTransactionAttempts: [
			...(position.expiredTransactionAttempts ?? []),
			{
				kind: 'entry' as const,
				nonce: position.entryTransactionNonce,
				targetBlockNumber: targetBlockNumber.toString(),
				transactionHash,
			},
		],
		gasExpenditures: [],
		hedgedProfitBeforeGasEth: '0',
		lockedToken: '0',
		lockedWeth: '0',
		realizedNetProfitEth: '0',
		status: 'expired-not-included' as const,
	} satisfies PositionRecord
}

export async function reconcileExpiredAttemptsWithQuorum(readClients: readonly ReadClient[], config: RecoveryConfiguration, position: PositionRecord, currentBlockNumber: bigint) {
	if (position.manualReconciliation !== undefined) return position
	const attempts = position.expiredTransactionAttempts ?? []
	if (attempts.length === 0) return position
	const receipts = await transactionReceiptsOrMissingWithQuorum(
		readClients,
		[config.connectivity.readRpcUrl, ...config.quorumRpcUrls],
		`expired atomic attempts ${position.reportId}`,
		attempts.map(attempt => attempt.transactionHash),
	)
	const found = attempts.flatMap((attempt, index) => {
		const receipt = receipts[index]
		return receipt === undefined ? [] : [{ attempt, receipt }]
	})
	const finalityBlockNumber = currentBlockNumber > REORG_OVERLAP_BLOCKS ? currentBlockNumber - REORG_OVERLAP_BLOCKS : 0n
	const finalizedFound = found.filter(({ receipt }) => receipt.blockNumber <= finalityBlockNumber)
	const confirmedNonce = await confirmedNonceWithQuorum(readClients, config, position.account, finalityBlockNumber)
	const impossible = attempts.filter((attempt, index) => receipts[index] === undefined && BigInt(attempt.nonce) < confirmedNonce)
	if (finalizedFound.length === 0 && impossible.length === 0) return position
	const successful = finalizedFound.find(({ receipt }) => receipt.status === 'success')
	const expenditures =
		finalizedFound.length === 0
			? []
			: await confirmedGasExpenditures(
					readClients,
					config,
					`expired atomic attempts ${position.reportId}`,
					finalizedFound.map(({ receipt }) => receipt),
				)
	const knownGasHashes = new Set(position.gasExpenditures.map(expenditure => expenditure.transactionHash.toLowerCase()))
	const newExpenditures = expenditures.filter(expenditure => !knownGasHashes.has(expenditure.transactionHash.toLowerCase()))
	const entryHashes = new Set(finalizedFound.filter(({ attempt }) => attempt.kind === 'entry').map(({ attempt }) => attempt.transactionHash.toLowerCase()))
	const entryGas = newExpenditures.filter(expenditure => entryHashes.has(expenditure.transactionHash.toLowerCase())).reduce((total, expenditure) => total + parseDecimalWeth(expenditure.costEth), 0n)
	const lifecycleGas = newExpenditures.filter(expenditure => !entryHashes.has(expenditure.transactionHash.toLowerCase())).reduce((total, expenditure) => total + parseDecimalWeth(expenditure.costEth), 0n)
	const totalGas = entryGas + lifecycleGas
	const completedHashes = new Set([...finalizedFound.filter(({ receipt }) => receipt.status === 'reverted').map(({ attempt }) => attempt.transactionHash.toLowerCase()), ...impossible.map(attempt => attempt.transactionHash.toLowerCase())])
	return {
		...position,
		actualEntryGasCostEth: decimalWeth(parseDecimalWeth(position.actualEntryGasCostEth) + entryGas),
		expiredTransactionAttempts: attempts.filter(attempt => !completedHashes.has(attempt.transactionHash.toLowerCase())),
		gasExpenditures: [...position.gasExpenditures, ...newExpenditures],
		lifecycleGasCostEth: decimalWeth(parseDecimalWeth(position.lifecycleGasCostEth) + lifecycleGas),
		lifecycleUpdatedAt: lifecycleGas === 0n ? position.lifecycleUpdatedAt : (newExpenditures.find(expenditure => !entryHashes.has(expenditure.transactionHash.toLowerCase()))?.minedAt ?? position.lifecycleUpdatedAt),
		realizedNetProfitEth: position.realizedNetProfitEth === undefined ? undefined : decimalSignedEth(parseSignedDecimalEth(position.realizedNetProfitEth) - totalGas),
		status: successful === undefined ? position.status : 'recovery-required',
	} satisfies PositionRecord
}

function withoutLifecycleAttempt(position: PositionRecord, preserveExpiredAttempt = false) {
	const transactionHash = position.lifecycleTransactionHashes[0]
	const targetBlockNumber = position.lifecycleTargetBlockNumber
	const nonce = position.lifecycleTransactionNonce
	if (preserveExpiredAttempt && (transactionHash === undefined || targetBlockNumber === undefined || nonce === undefined)) {
		throw new Error('Expired lifecycle attempt is missing its durable hash, target block, or nonce')
	}
	return {
		...position,
		expiredTransactionAttempts: preserveExpiredAttempt && transactionHash !== undefined && targetBlockNumber !== undefined && nonce !== undefined ? [...(position.expiredTransactionAttempts ?? []), { kind: 'lifecycle' as const, nonce, targetBlockNumber, transactionHash }] : position.expiredTransactionAttempts,
		lifecycleReceiptBlockHash: undefined,
		lifecycleReceiptBlockNumber: undefined,
		lifecycleSettlerRewardEth: undefined,
		lifecycleSubmissionBlockNumber: undefined,
		lifecycleSubmissionMode: undefined,
		lifecycleTargetBlockNumber: undefined,
		lifecycleTokenDecimals: undefined,
		lifecycleTransactionIntent: undefined,
		lifecycleTransactionNonce: undefined,
		lifecycleTransactionHashes: [],
		lifecycleWalletTokenBefore: undefined,
		lifecycleWalletWethBefore: undefined,
	}
}

function rollbackProvisionalLifecycleAccounting(position: PositionRecord) {
	const transactionHash = position.lifecycleTransactionHashes[0]
	if (transactionHash === undefined) return position
	const expenditure = position.lifecycleReceiptBlockHash === undefined ? undefined : position.gasExpenditures.find(candidate => candidate.transactionHash.toLowerCase() === transactionHash.toLowerCase())
	const provisionalGas = expenditure === undefined ? 0n : parseDecimalWeth(expenditure.costEth)
	const recordedLifecycleGas = parseDecimalWeth(position.lifecycleGasCostEth)
	if (provisionalGas > recordedLifecycleGas) throw new Error('Provisional lifecycle gas exceeds the recorded lifecycle total')
	return {
		...position,
		closedAt: undefined,
		gasExpenditures: position.gasExpenditures.filter(candidate => candidate.transactionHash.toLowerCase() !== transactionHash.toLowerCase()),
		lifecycleGasCostEth: decimalWeth(recordedLifecycleGas - provisionalGas),
		lifecycleReceiptBlockHash: undefined,
		lifecycleReceiptBlockNumber: undefined,
		lifecycleReceiptRecovered: false,
		lifecycleSettlerRewardEth: undefined,
		lifecycleUpdatedAt: undefined,
		realizedNetProfitEth: undefined,
		withdrawnToken: '0',
		withdrawnWeth: '0',
	} satisfies PositionRecord
}

export async function recoverPendingLifecycleWithQuorum(readClients: readonly ReadClient[], config: RecoveryConfiguration, position: PositionRecord, currentBlockNumber?: bigint | undefined): Promise<PositionRecord> {
	if (position.lifecycleTransactionHashes.length !== 1 || position.lifecycleTargetBlockNumber === undefined || position.lifecycleTokenDecimals === undefined || position.lifecycleSubmissionMode === undefined) {
		throw new Error('Atomic lifecycle recovery journal is incomplete')
	}
	const executor = config.executor
	if (executor === undefined) throw new Error('Atomic lifecycle recovery requires the authenticated executor')
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const targetBlockNumber = BigInt(position.lifecycleTargetBlockNumber)
	let receipts
	try {
		receipts = await transactionReceiptsWithQuorum(readClients, endpoints, `pending lifecycle ${position.reportId}`, position.lifecycleTransactionHashes)
	} catch (error) {
		if (currentBlockNumber === undefined || !attemptHasFinality(currentBlockNumber, targetBlockNumber)) throw error
		const finalityDescendantBlockNumber = targetBlockNumber + REORG_OVERLAP_BLOCKS
		await fixedBlockHashWithQuorum(readClients, config, `expired lifecycle ${position.reportId} finality descendant`, finalityDescendantBlockNumber)
		const optionalReceipts = await transactionReceiptsOrMissingWithQuorum(readClients, endpoints, `expired lifecycle ${position.reportId}`, position.lifecycleTransactionHashes)
		if (optionalReceipts.some(receipt => receipt !== undefined)) throw error
		return {
			...withoutLifecycleAttempt(rollbackProvisionalLifecycleAccounting(position), true),
			lifecycleReceiptRecovered: false,
			lifecycleUpdatedAt: new Date().toISOString(),
			status: 'open',
		}
	}
	const receipt = receipts[0]
	const expectedHash = position.lifecycleTransactionHashes[0]
	if (receipt === undefined || expectedHash === undefined || receipt.transactionHash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error('Lifecycle receipt hash does not match the durable journal')
	const lifecycleGasExpenditures = await confirmedGasExpenditures(readClients, config, `pending lifecycle ${position.reportId}`, [receipt])
	const previousExpenditure = position.lifecycleReceiptBlockHash === undefined ? undefined : position.gasExpenditures.find(expenditure => expenditure.transactionHash.toLowerCase() === receipt.transactionHash.toLowerCase())
	const previousGas = previousExpenditure === undefined ? 0n : parseDecimalWeth(previousExpenditure.costEth)
	const canonicalGas = lifecycleGasExpenditures.reduce((total, expenditure) => total + parseDecimalWeth(expenditure.costEth), 0n)
	const recordedLifecycleGas = parseDecimalWeth(position.lifecycleGasCostEth)
	if (previousGas > recordedLifecycleGas) throw new Error('Previously recorded lifecycle gas exceeds the lifecycle total')
	const lifecycleGas = recordedLifecycleGas - previousGas + canonicalGas
	const accountedPosition = {
		...position,
		gasExpenditures: [...(previousExpenditure === undefined ? position.gasExpenditures : position.gasExpenditures.filter(expenditure => expenditure.transactionHash.toLowerCase() !== receipt.transactionHash.toLowerCase())), ...lifecycleGasExpenditures],
		lifecycleGasCostEth: decimalWeth(lifecycleGas),
		lifecycleUpdatedAt: lifecycleGasExpenditures[0]?.minedAt ?? position.lifecycleUpdatedAt,
	} satisfies PositionRecord
	const transactionIntentMismatch =
		position.lifecycleSubmissionMode === 'public' && receipt.status === 'success'
			? await recoveredTransactionIntentMismatchWithQuorum(readClients, config, `pending public lifecycle ${position.reportId}`, receipt.transactionHash, position.account, position.lifecycleTransactionNonce, position.lifecycleTransactionIntent)
			: undefined
	if (transactionIntentMismatch !== undefined) {
		return {
			...accountedPosition,
			lifecycleReceiptRecovered: true,
			status: 'recovery-required',
		}
	}
	let execution: ReturnType<typeof lifecycleExecutionFromLogs> | ReturnType<typeof replacementCreditExecutionFromLogs> | undefined
	if (receipt.status === 'success') {
		try {
			execution = position.lifecycleKind === 'replacement-credit' ? replacementCreditExecutionFromLogs(receipt.logs, executor) : lifecycleExecutionFromLogs(receipt.logs, executor)
		} catch (error) {
			const expectedMessage = position.lifecycleKind === 'replacement-credit' ? 'Confirmed executor transaction did not emit ReplacementCreditWithdrawn' : 'Confirmed executor transaction did not emit LifecycleExecuted'
			if (!(error instanceof Error) || error.message !== expectedMessage) throw error
			execution = undefined
		}
	}
	if (execution === undefined) {
		if (receipt.status === 'success') {
			return {
				...accountedPosition,
				lifecycleReceiptRecovered: true,
				status: 'recovery-required',
			}
		}
		return {
			...withoutLifecycleAttempt(accountedPosition),
			lifecycleReceiptRecovered: false,
			status: 'open',
		}
	}
	if (receipt.blockNumber !== targetBlockNumber) throw new Error('Lifecycle executor transaction was included outside its signed parent-block target')
	if (!/^\d+$/u.test(position.lifecycleTokenDecimals)) throw new Error('Lifecycle recovery token decimals are invalid')
	const tokenDecimals = Number.parseInt(position.lifecycleTokenDecimals, 10)
	if (tokenDecimals < 0 || tokenDecimals > 255) throw new Error('Lifecycle recovery token decimals are invalid')
	if (position.lifecycleKind === 'replacement-credit') {
		if (position.replacementCreditAmount === undefined || position.replacementCreditToken === undefined || !('amount' in execution)) {
			throw new Error('Replacement-credit recovery journal is incomplete')
		}
		const expectedAmount = BigInt(position.replacementCreditAmount)
		if (execution.account.toLowerCase() !== position.account.toLowerCase() || execution.reportId.toString() !== position.reportId || execution.token.toLowerCase() !== position.replacementCreditToken.toLowerCase() || execution.amount !== expectedAmount) {
			return { ...accountedPosition, lifecycleReceiptRecovered: true, status: 'recovery-required' }
		}
		const creditIsWeth = execution.token.toLowerCase() === config.network.weth.toLowerCase()
		const creditIsPositionToken = execution.token.toLowerCase() === position.token.toLowerCase()
		if (!creditIsWeth && !creditIsPositionToken) return { ...accountedPosition, lifecycleReceiptRecovered: true, status: 'recovery-required' }
		return {
			...accountedPosition,
			closedAt: undefined,
			lifecycleReceiptBlockHash: receipt.blockHash,
			lifecycleReceiptBlockNumber: receipt.blockNumber.toString(),
			lifecycleReceiptRecovered: true,
			lifecycleSettlerRewardEth: '0',
			realizedNetProfitEth: undefined,
			status: 'closed-pending-finality',
			withdrawnToken: creditIsPositionToken ? formatUnits(execution.amount, tokenDecimals) : '0',
			withdrawnWeth: creditIsWeth ? decimalWeth(execution.amount) : '0',
		}
	}
	if (!('amount1' in execution)) throw new Error('Lifecycle executor event does not match the durable position')
	const expectedAttoWeth = parseDecimalWeth(position.lockedWeth)
	const expectedToken = parseUnits(position.lockedToken, tokenDecimals)
	if (
		execution.account.toLowerCase() !== position.account.toLowerCase() ||
		execution.reportId.toString() !== position.reportId ||
		execution.token1.toLowerCase() !== config.network.weth.toLowerCase() ||
		execution.token2.toLowerCase() !== position.token.toLowerCase() ||
		execution.amount1 !== expectedAttoWeth ||
		execution.amount2 !== expectedToken
	) {
		return { ...accountedPosition, lifecycleReceiptRecovered: true, status: 'recovery-required' }
	}
	return {
		...accountedPosition,
		closedAt: undefined,
		lifecycleReceiptBlockHash: receipt.blockHash,
		lifecycleReceiptBlockNumber: receipt.blockNumber.toString(),
		lifecycleReceiptRecovered: true,
		lifecycleSettlerRewardEth: decimalWeth(execution.settlerRewardAttoEth),
		realizedNetProfitEth: undefined,
		status: 'closed-pending-finality',
		withdrawnToken: position.lockedToken,
		withdrawnWeth: position.lockedWeth,
	}
}

async function fixedBlockHashWithQuorum(readClients: readonly ReadClient[], config: RecoveryConfiguration, label: string, blockNumber: bigint) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	if (readClients.length !== endpoints.length) throw new Error(`${label} block readers and endpoints differ`)
	return settledQuorumValue(
		`${label} ${blockNumber.toString()}`,
		readClients.map(async (client, index) => {
			const block = await client.getBlock({ blockNumber })
			if (block.hash == null) throw new Error(`${label} block is missing its canonical hash`)
			return { endpoint: endpointLabel(endpoints[index] ?? ''), value: block.hash }
		}),
	)
}

export async function finalizeLifecycleAfterFinalityWithQuorum(readClients: readonly ReadClient[], config: RecoveryConfiguration, position: PositionRecord, currentBlockNumber: bigint): Promise<PositionRecord> {
	if (position.status !== 'closed-pending-finality') return position
	if (position.lifecycleReceiptBlockNumber === undefined || position.lifecycleReceiptBlockHash === undefined) throw new Error('Pending lifecycle finality evidence is incomplete')
	const receiptBlockNumber = BigInt(position.lifecycleReceiptBlockNumber)
	if (!attemptHasFinality(currentBlockNumber, receiptBlockNumber)) return position
	const refreshed = await recoverPendingLifecycleWithQuorum(readClients, config, position, currentBlockNumber)
	if (refreshed.status !== 'closed-pending-finality') return refreshed
	if (refreshed.lifecycleReceiptBlockNumber === undefined || !attemptHasFinality(currentBlockNumber, BigInt(refreshed.lifecycleReceiptBlockNumber))) return refreshed
	if (refreshed.lifecycleReceiptBlockHash === undefined) throw new Error('Pending lifecycle finality receipt hash is unavailable')
	if (
		!(await confirmCanonicalReceiptFinality(
			readClients,
			[config.connectivity.readRpcUrl, ...config.quorumRpcUrls],
			`lifecycle ${refreshed.reportId}`,
			{
				blockHash: refreshed.lifecycleReceiptBlockHash,
				blockNumber: BigInt(refreshed.lifecycleReceiptBlockNumber),
			},
			REORG_OVERLAP_BLOCKS,
			currentBlockNumber,
		))
	)
		return refreshed
	const closedAt = refreshed.lifecycleUpdatedAt
	if (closedAt === undefined) throw new Error('Finalized lifecycle receipt timestamp is unavailable')
	if (refreshed.lifecycleSettlerRewardEth === undefined) throw new Error('Finalized lifecycle settler reward evidence is unavailable')
	if (refreshed.lifecycleKind === 'replacement-credit') {
		return {
			...withoutLifecycleAttempt(refreshed),
			closedAt: undefined,
			lifecycleKind: 'replacement-credit',
			lifecycleSettlerRewardEth: '0',
			realizedNetProfitEth: undefined,
			status: 'replaced',
		} satisfies PositionRecord
	}
	const realized = realizedNetProfitWeth(parseSignedDecimalEth(refreshed.hedgedProfitBeforeGasEth), parseDecimalWeth(refreshed.lifecycleSettlerRewardEth), parseDecimalWeth(refreshed.actualEntryGasCostEth), parseDecimalWeth(refreshed.lifecycleGasCostEth))
	return {
		...withoutLifecycleAttempt(refreshed),
		closedAt,
		lifecycleSettlerRewardEth: refreshed.lifecycleSettlerRewardEth,
		realizedNetProfitEth: decimalSignedEth(realized),
		status: 'closed',
	} satisfies PositionRecord
}

export async function discoverPublicReplacementWithQuorum(readClients: readonly ReadClient[], config: RecoveryConfiguration, position: PositionRecord, blockNumber: bigint, kind: 'entry' | 'lifecycle', persistPosition: (position: PositionRecord) => Promise<void>) {
	const submissionBlockNumber = kind === 'entry' ? position.entrySubmissionBlockNumber : position.lifecycleSubmissionBlockNumber
	const transactionNonce = kind === 'entry' ? position.entryTransactionNonce : position.lifecycleTransactionNonce
	if (submissionBlockNumber === undefined || transactionNonce === undefined) return position
	const discoveredHash = await transactionHashBySenderNonceWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], `pending public ${kind} ${position.reportId}`, {
		account: position.account,
		fromBlockNumber: BigInt(submissionBlockNumber),
		nonce: BigInt(transactionNonce),
		toBlockNumber: blockNumber,
	})
	if (discoveredHash === undefined) return position
	const currentHashes = kind === 'entry' ? position.entryTransactionHashes : position.lifecycleTransactionHashes
	if (currentHashes.length === 1 && currentHashes[0]?.toLowerCase() === discoveredHash.toLowerCase()) return position
	const updated =
		kind === 'entry'
			? {
					...position,
					entryTransactionHash: discoveredHash,
					entryTransactionHashes: [discoveredHash],
				}
			: {
					...position,
					lifecycleTransactionHashes: [discoveredHash],
				}
	await persistPosition(updated)
	return updated
}
