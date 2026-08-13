import { bigintToSafeNumber, type Address, type BlockTransaction, type Hex, type TransactionReceipt, type TransactionReplacement } from '#ethereum'
import { endpointLabel } from '#monitoring/connectivity'
import { operationalFailureDisposition } from '#monitoring/resilience'
import type { OpportunitySnapshot } from '#state/operator-state'
import type { DurableTransactionIntent, ExecutionIntent, PositionRecord } from '#state/position-store'
import { quorumValue, settledQuorumValue } from '#monitoring/read-quorum'
import { isSelfReport } from '#core/strategy'
import type { StandardUniswapFee } from '#core/uniswap-v4'
import type { Venue } from '#core/venue-strategy'

export function hedgeExecutionRoute(venue: Venue, selectedFee: StandardUniswapFee) {
	let encodedVenue: 0 | 1 | 2 = 0
	if (venue === 'uniswap-v2') encodedVenue = 1
	if (venue === 'uniswap-v4') encodedVenue = 2
	return {
		poolFee: selectedFee,
		venue: encodedVenue,
	} as const
}

export function buildHedgeExecutionPayload(parameters: {
	expectedParentBlockHash: Hex
	executionIntent: Omit<ExecutionIntent, 'pool' | 'poolFee'>
	hedgePool: Address
	hedgeWethLimitAttoEth: bigint
	newAmount1: bigint
	newAmount2: bigint
	openOracle: Address
	router: Address
	selectedFee: StandardUniswapFee
	swapDeadline: bigint
	venue: Venue
}) {
	const route = hedgeExecutionRoute(parameters.venue, parameters.selectedFee)
	return {
		executionIntent: {
			...parameters.executionIntent,
			pool: parameters.hedgePool,
			poolFee: route.poolFee,
		},
		hedgeRequest: {
			expectedParentBlockHash: parameters.expectedParentBlockHash,
			hedgeWethLimitAttoEth: parameters.hedgeWethLimitAttoEth,
			newAmount1: parameters.newAmount1,
			newAmount2: parameters.newAmount2,
			openOracle: parameters.openOracle,
			poolFee: route.poolFee,
			router: parameters.router,
			swapDeadline: parameters.swapDeadline,
			venue: route.venue,
		},
	}
}

export function executionSnapshotWithQuorum<T>(blockNumber: bigint, observations: readonly { endpoint: string; value: T }[]) {
	return quorumValue(`execution snapshot at block ${blockNumber.toString()}`, observations)
}

export function settledExecutionSnapshotWithQuorum<T>(blockNumber: bigint, observations: readonly Promise<{ endpoint: string; value: T }>[]) {
	return settledQuorumValue(`execution snapshot at block ${blockNumber.toString()}`, observations)
}

export function executionTokenAllowed(allowedTokens: readonly Address[], token: Address) {
	return allowedTokens.some(allowed => allowed.toLowerCase() === token.toLowerCase())
}

export function fundingTransactionPlan(allowances: { token1: bigint; token2: bigint }, contributions: { token1: bigint; token2: bigint }) {
	if (allowances.token1 < contributions.token1 || allowances.token2 < contributions.token2) {
		throw new Error('Missing executor allowances must be approved before entry submission')
	}
	return ['execution'] as const
}

export function lifecycleAllowanceMismatch(allowances: { token1: bigint; token2: bigint }, withdrawals: { token1: bigint; token2: bigint }) {
	if (allowances.token1 < withdrawals.token1) return 'OpenOracle internal WETH allowance to the executor is too low'
	if (allowances.token2 < withdrawals.token2) return 'OpenOracle internal report-token allowance to the executor is too low'
	return undefined
}

export function lifecycleWithdrawalMismatch(parameters: { currentReporter: boolean; expectedToken: bigint; expectedAttoWeth: bigint; holderToken: bigint; holderAttoWeth: bigint; willSettle: boolean }) {
	if (!parameters.currentReporter) return 'Position was replaced; exact returned assets require manual reconciliation'
	if (!parameters.willSettle && (parameters.holderAttoWeth <= parameters.expectedAttoWeth || parameters.holderToken <= parameters.expectedToken)) {
		return 'Position does not have its exact withdrawable OpenOracle balances'
	}
	return undefined
}

export function openOracleDisputeTiming(quoteBlockNumber: bigint, quoteBlockTimestamp: bigint) {
	return [quoteBlockNumber, 1n, quoteBlockTimestamp, 300n] as const
}

export function privateBundleReceiptStatus(receipt: Pick<TransactionReceipt, 'blockNumber' | 'status'> | undefined, targetBlockNumber: bigint) {
	if (receipt === undefined || receipt.blockNumber !== targetBlockNumber) return 'confirmation-unknown' as const
	return receipt.status === 'success' ? ('confirmed' as const) : ('reverted' as const)
}

export function attemptHasFinality(currentBlockNumber: bigint, targetBlockNumber: bigint) {
	return currentBlockNumber >= targetBlockNumber + 12n
}

export function privateEntryRecoveryIsConfirmed(position: Pick<PositionRecord, 'status'>) {
	return position.status === 'open'
}

export function recoveredTransactionIntentMismatch(expected: DurableTransactionIntent | undefined, actual: { data: Hex; from: Address; nonce: bigint; to?: Address | null | undefined; value: bigint }, account: Address, nonce: string | undefined) {
	if (nonce === undefined || expected === undefined) return 'Durable transaction intent is missing'
	if (actual.from.toLowerCase() !== account.toLowerCase() || actual.nonce !== BigInt(nonce) || actual.to?.toLowerCase() !== expected.to.toLowerCase() || actual.data.toLowerCase() !== expected.data.toLowerCase() || actual.value !== BigInt(expected.value)) {
		return 'Transaction does not match the durable destination, calldata, sender, nonce, and value'
	}
	return undefined
}

export function lifecycleLastValidBlockNumber(targetBlockNumber: bigint) {
	return targetBlockNumber
}

export async function simulateTrackedPrivateBundle<TTransaction, TResult>(transactions: readonly TTransaction[], simulate: () => Promise<TResult>, track: (transaction: TTransaction, status: 'submission-failed' | 'submitting', error: unknown | undefined) => void) {
	for (const transaction of transactions) track(transaction, 'submitting', undefined)
	try {
		return await simulate()
	} catch (error) {
		for (const transaction of transactions) track(transaction, 'submission-failed', error)
		throw error
	}
}

export function trackPrivateBundleReceiptStatuses<TTransaction, TReceipt extends Pick<TransactionReceipt, 'blockNumber' | 'status'>>(
	transactions: readonly TTransaction[],
	receipts: readonly (TReceipt | undefined)[],
	targetBlockNumber: bigint,
	track: (transaction: TTransaction, status: 'confirmation-unknown' | 'confirmed' | 'reverted', receipt: TReceipt | undefined) => void,
) {
	if (transactions.length !== receipts.length) throw new Error('Private bundle transaction and receipt counts differ')
	const statuses = receipts.map(receipt => privateBundleReceiptStatus(receipt, targetBlockNumber))
	const complete = statuses.every(status => status === 'confirmed')
	if (complete) return true
	for (const [index, transaction] of transactions.entries()) {
		const status = statuses[index]
		if (status === undefined) throw new Error('Bundle receipt status order is incomplete')
		track(transaction, status, receipts[index])
	}
	return false
}

export function executionPausedError() {
	const error = new Error('Bot paused before the next transaction was broadcast')
	error.name = 'ExecutionPausedError'
	return error
}

export function isExecutionPausedError(error: unknown) {
	return error instanceof Error && error.name === 'ExecutionPausedError'
}

export function executionFailureDecision(error: unknown): OpportunitySnapshot['decision'] {
	return isExecutionPausedError(error) ? 'paused' : 'execution-failed'
}

export function opportunityDecision(parameters: { account: Address | undefined; currentReporter: Address; execute: boolean; executionReady: boolean; hasRequiredInventory: boolean | undefined; paused?: boolean | undefined; profitable: boolean }): OpportunitySnapshot['decision'] {
	if (!parameters.profitable) return 'unprofitable'
	if (parameters.execute && parameters.account === undefined) return 'signer-unavailable'
	if (isSelfReport(parameters.account, parameters.currentReporter)) return 'self-report'
	if (parameters.execute && parameters.hasRequiredInventory !== true) return 'insufficient-inventory'
	if (parameters.execute && parameters.paused === true) return 'paused'
	if (parameters.execute && !parameters.executionReady) return 'history-unavailable'
	return parameters.execute ? 'eligible' : 'dry-run-opportunity'
}

function rejectedReplacementError(replacement: TransactionReplacement) {
	const error = new Error(`Transaction ${replacement.replacedTransaction.hash} was ${replacement.reason} by ${replacement.transaction.hash}`)
	error.name = 'RejectedTransactionReplacementError'
	return error
}

function isRejectedReplacementError(error: unknown) {
	return error instanceof Error && error.name === 'RejectedTransactionReplacementError'
}

export async function waitForResolvedTransaction(
	hash: Hex,
	wait: (parameters: { hash: Hex; onReplaced: (replacement: TransactionReplacement) => void }) => Promise<TransactionReceipt>,
	retryDelay: () => Promise<unknown> = () => Bun.sleep(1_000),
	onRetry: (error: unknown) => Promise<unknown> | unknown = () => {},
	onReplacement: (replacement: TransactionReplacement) => Promise<unknown> | unknown = () => {},
	acceptReplacement: (replacement: TransactionReplacement) => boolean = replacement => replacement.reason === 'repriced',
) {
	while (true) {
		let replacement: TransactionReplacement | undefined
		let replacementPersistence: Promise<unknown> | undefined
		try {
			const receipt = await wait({
				hash,
				onReplaced: value => {
					replacement = value
					replacementPersistence = (replacementPersistence ?? Promise.resolve()).then(() => onReplacement(value))
				},
			})
			await replacementPersistence
			if (replacement !== undefined && !acceptReplacement(replacement)) throw rejectedReplacementError(replacement)
			return receipt
		} catch (error) {
			await replacementPersistence
			if (isRejectedReplacementError(error)) throw error
			await onRetry(error)
			await retryDelay()
		}
	}
}

export async function guardedExecutionStep<T>(isPaused: () => boolean, action: () => Promise<T>) {
	if (isPaused()) throw executionPausedError()
	return action()
}

export async function guardedTransactionSubmission<T>(isPaused: () => boolean, prepare: () => Promise<unknown>, submit: () => Promise<T>) {
	await prepare()
	if (isPaused()) throw executionPausedError()
	return submit()
}

export async function journaledSubmission<T>(persistPending: () => Promise<unknown>, submit: () => Promise<T>, boundaryGuard?: (() => Promise<unknown> | unknown) | undefined) {
	await boundaryGuard?.()
	await persistPending()
	await boundaryGuard?.()
	return submit()
}

export async function guardedRiskSubmission<T>(riskMismatch: string | undefined, submit: () => Promise<T>) {
	if (riskMismatch !== undefined) throw new Error(`Final execution risk check failed: ${riskMismatch}`)
	return submit()
}

export function assertReceiptSnapshotBlockHash(receiptBlockHash: Hex, snapshotBlockHash: Hex, label: string) {
	if (receiptBlockHash.toLowerCase() !== snapshotBlockHash.toLowerCase()) throw new Error(`${label} receipt and balance snapshot use different canonical blocks`)
}

export function assertCanonicalExecutionSnapshot(parameters: { expectedReportStateHash: Hex; localBlockHash: Hex; quorumBlockHash: Hex; quorumReportStateHash: Hex }) {
	if (parameters.localBlockHash.toLowerCase() !== parameters.quorumBlockHash.toLowerCase()) throw new Error('Execution quote and quorum snapshot use different canonical blocks')
	if (parameters.expectedReportStateHash.toLowerCase() !== parameters.quorumReportStateHash.toLowerCase()) throw new Error('Execution report changed in the canonical quorum snapshot')
}

type BlockHashReader = {
	getBlock: (parameters: { blockNumber: bigint }) => Promise<{ hash?: Hex | null | undefined }>
}

export async function canonicalBlockHashWithQuorum(readers: readonly BlockHashReader[], endpoints: readonly string[], label: string, blockNumber: bigint) {
	if (readers.length !== endpoints.length) throw new Error(`${label} block readers and endpoints differ`)
	return settledQuorumValue(
		`${label} canonical block ${blockNumber.toString()}`,
		readers.map(async (reader, index) => {
			const block = await reader.getBlock({ blockNumber })
			if (block.hash == null) throw new Error(`${label} canonical block is missing its hash`)
			return {
				endpoint: endpointLabel(endpoints[index] ?? ''),
				value: block.hash,
			}
		}),
	)
}

type SenderNonceBlockReader = {
	getBlock: (parameters: { blockNumber: bigint; includeTransactions: true }) => Promise<{
		transactions: readonly unknown[]
	}>
	getTransactionCount: (parameters: { address: Address; blockNumber: bigint }) => Promise<bigint>
}

type TransactionIntentReader = {
	getTransaction: (parameters: { hash: Hex }) => Promise<Pick<BlockTransaction, 'from' | 'input' | 'nonce' | 'to' | 'value'>>
}

export async function transactionIntentWithQuorum(readers: readonly TransactionIntentReader[], endpoints: readonly string[], label: string, transactionHash: Hex) {
	if (readers.length !== endpoints.length) throw new Error(`${label} transaction readers and endpoints differ`)
	return settledQuorumValue(
		`${label} transaction intent`,
		readers.map(async (reader, index) => {
			const transaction = await reader.getTransaction({ hash: transactionHash })
			return {
				endpoint: endpointLabel(endpoints[index] ?? ''),
				value: {
					data: transaction.input,
					from: transaction.from,
					nonce: transaction.nonce,
					to: transaction.to,
					value: transaction.value,
				},
			}
		}),
	)
}

export async function transactionHashBySenderNonceWithQuorum(readers: readonly SenderNonceBlockReader[], endpoints: readonly string[], label: string, parameters: { account: Address; fromBlockNumber: bigint; nonce: bigint; toBlockNumber: bigint }) {
	if (readers.length !== endpoints.length) throw new Error(`${label} block readers and endpoints differ`)
	if (parameters.toBlockNumber < parameters.fromBlockNumber) throw new Error(`${label} replacement scan range is invalid`)
	return settledQuorumValue(
		`${label} replacement transaction`,
		readers.map(async (reader, index) => {
			let value: Hex | undefined
			if ((await reader.getTransactionCount({ address: parameters.account, blockNumber: parameters.toBlockNumber })) > parameters.nonce) {
				let lower = parameters.fromBlockNumber
				let upper = parameters.toBlockNumber
				while (lower < upper) {
					const middle = lower + (upper - lower) / 2n
					const transactionCount = await reader.getTransactionCount({ address: parameters.account, blockNumber: middle })
					if (transactionCount > parameters.nonce) upper = middle
					else lower = middle + 1n
				}
				const block = await reader.getBlock({ blockNumber: lower, includeTransactions: true })
				const transaction = block.transactions.find(candidate => {
					if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return false
					const record = candidate as Record<string, unknown>
					return typeof record['from'] === 'string' && record['from'].toLowerCase() === parameters.account.toLowerCase() && record['nonce'] === parameters.nonce && typeof record['hash'] === 'string' && /^0x[0-9a-fA-F]{64}$/.test(record['hash'])
				})
				if (typeof transaction === 'object' && transaction !== null && !Array.isArray(transaction)) {
					value = (transaction as { hash: Hex }).hash
				}
			}
			return {
				endpoint: endpointLabel(endpoints[index] ?? ''),
				value,
			}
		}),
	)
}

export function lifecycleAttemptNeedsRecovery(position: PositionRecord) {
	return (position.status === 'withdrawing' || position.status === 'recovery-required') && position.lifecycleTransactionHashes.length !== 0 && !position.lifecycleReceiptRecovered
}

export async function finalizeSubmittedLifecycleAttempt(lifecyclePosition: PositionRecord, recover: (position: PositionRecord) => Promise<PositionRecord>, persist: (position: PositionRecord) => Promise<unknown>) {
	let recovered: PositionRecord
	try {
		recovered = await recover(lifecyclePosition)
	} catch (error) {
		if (operationalFailureDisposition(error) === 'connectivity-degraded') throw error
		await persist({ ...lifecyclePosition, status: 'recovery-required' })
		throw error
	}
	await persist(recovered)
	if (recovered.status !== 'closed-pending-finality') throw new Error(`Position ${lifecyclePosition.reportId} lifecycle assets do not match the expected hedge-neutral withdrawal`)
	return recovered
}

type TransactionReceiptReader = {
	getTransactionReceipt: (parameters: { hash: Hex }) => Promise<TransactionReceipt>
}

type ReceiptBlockReader = {
	getBlock: (parameters: { blockNumber: bigint }) => Promise<{ hash?: Hex | null | undefined; timestamp: bigint }>
}

function normalizedReceipt(label: string, receipt: TransactionReceipt) {
	const effectiveGasPrice = receipt.effectiveGasPrice
	if (typeof effectiveGasPrice !== 'bigint') throw new Error(`${label} receipt ${receipt.transactionHash} is missing its effective gas price`)
	return {
		blockHash: receipt.blockHash,
		blockNumber: receipt.blockNumber,
		effectiveGasPrice,
		gasUsed: receipt.gasUsed,
		logs: receipt.logs.map(log => ({ address: log.address, data: log.data, topics: log.topics })),
		status: receipt.status,
		transactionHash: receipt.transactionHash,
	}
}

function isMissingReceipt(error: unknown) {
	return error instanceof Error && error.message.includes('Transaction receipt with hash') && error.message.includes('could not be found')
}

export async function receiptGasExpendituresWithQuorum(readers: readonly ReceiptBlockReader[], endpoints: readonly string[], label: string, receipts: readonly Pick<TransactionReceipt, 'blockHash' | 'blockNumber' | 'effectiveGasPrice' | 'gasUsed' | 'transactionHash'>[]) {
	if (readers.length !== endpoints.length) throw new Error(`${label} block readers and endpoints differ`)
	return settledQuorumValue(
		`${label} canonical receipt blocks`,
		readers.map(async (reader, index) => ({
			endpoint: endpointLabel(endpoints[index] ?? ''),
			value: await Promise.all(
				receipts.map(async receipt => {
					const block = await reader.getBlock({ blockNumber: receipt.blockNumber })
					if (block.hash === null || block.hash === undefined) throw new Error(`${label} receipt block ${receipt.blockNumber.toString()} is missing its canonical hash`)
					if (block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new Error(`${label} receipt ${receipt.transactionHash} is not in the canonical block`)
					if (typeof receipt.effectiveGasPrice !== 'bigint') throw new Error(`${label} receipt ${receipt.transactionHash} is missing its effective gas price`)
					const milliseconds = block.timestamp * 1_000n
					if (milliseconds < 0n || milliseconds > 8_640_000_000_000_000n) throw new Error(`${label} receipt block timestamp is outside the supported date range`)
					return {
						costAttoEth: receipt.gasUsed * receipt.effectiveGasPrice,
						minedAt: new Date(bigintToSafeNumber(milliseconds, `${label} receipt block timestamp`)).toISOString(),
						transactionHash: receipt.transactionHash,
					}
				}),
			),
		})),
	)
}

export async function transactionReceiptsWithQuorum(readers: readonly TransactionReceiptReader[], endpoints: readonly string[], label: string, transactionHashes: readonly Hex[]) {
	if (readers.length !== endpoints.length) throw new Error(`${label} receipt readers and endpoints differ`)
	return settledQuorumValue(
		`${label} receipts`,
		readers.map(async (reader, index) => {
			const receipts = await Promise.all(transactionHashes.map(hash => reader.getTransactionReceipt({ hash })))
			return {
				endpoint: endpointLabel(endpoints[index] ?? ''),
				value: receipts.map(receipt => normalizedReceipt(label, receipt)),
			}
		}),
	)
}

export async function transactionReceiptsOrMissingWithQuorum(readers: readonly TransactionReceiptReader[], endpoints: readonly string[], label: string, transactionHashes: readonly Hex[]) {
	if (readers.length !== endpoints.length) throw new Error(`${label} receipt readers and endpoints differ`)
	return settledQuorumValue(
		`${label} optional receipts`,
		readers.map(async (reader, index) => ({
			endpoint: endpointLabel(endpoints[index] ?? ''),
			value: await Promise.all(
				transactionHashes.map(async hash => {
					try {
						return normalizedReceipt(label, await reader.getTransactionReceipt({ hash }))
					} catch (error) {
						if (isMissingReceipt(error)) return undefined
						throw error
					}
				}),
			),
		})),
	)
}

export async function signAndSubmitOpenOracleDispute<TSigned, TSubmitted>(quoteBlockNumber: bigint, sign: (lastValidBlockNumber: bigint) => Promise<TSigned>, submit: (signed: TSigned) => Promise<TSubmitted>) {
	const signed = await sign(quoteBlockNumber + 1n)
	return submit(signed)
}

export async function retryPrivateSubmissionWithinWindow<T>(parameters: { currentBlockNumber: bigint; lastValidBlockNumber: bigint | undefined; submit: (maxBlockNumber: bigint) => Promise<T> }) {
	if (parameters.lastValidBlockNumber !== undefined && parameters.currentBlockNumber >= parameters.lastValidBlockNumber) return { attempted: false as const }
	const defaultMaxBlockNumber = parameters.currentBlockNumber + 25n
	const maxBlockNumber = parameters.lastValidBlockNumber === undefined || parameters.lastValidBlockNumber > defaultMaxBlockNumber ? defaultMaxBlockNumber : parameters.lastValidBlockNumber
	return {
		attempted: true as const,
		maxBlockNumber,
		result: await parameters.submit(maxBlockNumber),
	}
}

export async function attemptConfirmationRecovery<T>(recover: () => Promise<T>, onFailure: (error: unknown) => Promise<unknown> | unknown) {
	try {
		return await recover()
	} catch (error) {
		await onFailure(error)
		return undefined
	}
}

export async function runFundedExecution<TPrepared, TSubmitted, TResult>(
	isPaused: () => boolean,
	stages: {
		approveToken1: () => Promise<bigint>
		approveToken2: () => Promise<bigint>
		confirm: (submitted: TSubmitted, prepared: TPrepared, approvalGasCost: bigint) => Promise<TResult>
		prepare: () => Promise<TPrepared>
		simulate: (prepared: TPrepared) => Promise<unknown>
		submit: (prepared: TPrepared) => Promise<TSubmitted>
	},
) {
	const approvalGasCost = (await guardedExecutionStep(isPaused, stages.approveToken1)) + (await guardedExecutionStep(isPaused, stages.approveToken2))
	const prepared = await stages.prepare()
	await guardedExecutionStep(isPaused, () => stages.simulate(prepared))
	const submitted = await guardedExecutionStep(isPaused, () => stages.submit(prepared))
	return stages.confirm(submitted, prepared, approvalGasCost)
}

export function selectBestExecution<T>(candidates: readonly T[], score: (candidate: T) => bigint) {
	let best: T | undefined
	for (const candidate of candidates) {
		if (best === undefined || score(candidate) > score(best)) best = candidate
	}
	return best
}
