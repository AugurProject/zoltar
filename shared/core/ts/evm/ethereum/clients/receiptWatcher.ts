import { isRateLimitError, retryRateLimited, runWithDeadline } from '../transport.js'
import type { BlockTransaction, Hash, PublicClientActions, ReplacementReason, Transport } from '../types.js'

function isBlockTransaction(value: unknown): value is BlockTransaction {
	return typeof value === 'object' && value !== null && 'hash' in value && 'from' in value && 'nonce' in value
}

function isTransactionNotFoundError(error: unknown): error is Error {
	return error instanceof Error && error.message.includes('could not be found')
}

function getReplacementReason(originalTransaction: BlockTransaction, replacementTransaction: BlockTransaction): ReplacementReason {
	if (replacementTransaction.to?.toLowerCase() === originalTransaction.from.toLowerCase() && replacementTransaction.value === 0n && replacementTransaction.input === '0x') return 'cancelled'
	if (replacementTransaction.to?.toLowerCase() === originalTransaction.to?.toLowerCase() && replacementTransaction.value === originalTransaction.value && replacementTransaction.input === originalTransaction.input) return 'repriced'
	return 'replaced'
}

const REPLACEMENT_SCAN_BLOCK_DEPTH = 12n

type ReplacementScanBlock = { number: bigint; hash: Hash }

async function scanReplacementTransactions(blockReader: Pick<PublicClientActions, 'getBlock'>, originalTransaction: BlockTransaction, latestBlockNumber: bigint, previousHistory: readonly ReplacementScanBlock[]): Promise<{ history: ReplacementScanBlock[]; transaction?: BlockTransaction }> {
	// Expire checkpoints outside the supported lookback before making any reads.
	// A large head jump must not introduce a dependency on older RPC history.
	const earliestBlock = latestBlockNumber > REPLACEMENT_SCAN_BLOCK_DEPTH ? latestBlockNumber - REPLACEMENT_SCAN_BLOCK_DEPTH : 0n
	let history = previousHistory.filter(scanned => scanned.number >= earliestBlock)
	// Validate even at an unchanged height. A linked tip authenticates its scanned
	// ancestors; after a reorg, walk backwards to the newest retained common one.
	while (history.length > 0) {
		const tip = history.at(-1)
		if (tip === undefined) break
		if (tip.number <= latestBlockNumber && (await blockReader.getBlock({ blockNumber: tip.number })).hash === tip.hash) break
		history.pop()
	}

	// Recovery beyond retained history deliberately restarts only the supported
	// recent window. Older affected blocks are unknown, never marked as scanned.
	const ancestor = history.at(-1)
	const firstBlock = ancestor === undefined ? earliestBlock : ancestor.number + 1n
	if (firstBlock > latestBlockNumber) return { history }

	let transaction: BlockTransaction | undefined
	for (let blockNumber = firstBlock; blockNumber <= latestBlockNumber; blockNumber += 1n) {
		const block = await blockReader.getBlock({ blockNumber, includeTransactions: true })
		if (block.hash === undefined) throw new Error('Replacement scan requires a block hash')
		const previous = history.at(-1)
		if (previous !== undefined && block.parentHash !== previous.hash) return { history: [] }
		history.push({ number: blockNumber, hash: block.hash })
		history = history.filter(scanned => scanned.number >= earliestBlock)
		transaction = block.transactions.find((candidate): candidate is BlockTransaction => isBlockTransaction(candidate) && candidate.hash !== originalTransaction.hash && candidate.nonce === originalTransaction.nonce && candidate.from.toLowerCase() === originalTransaction.from.toLowerCase())
		if (transaction !== undefined) break
	}

	// Do not commit a partial or mixed-chain scan, or report an orphan candidate.
	// Parent linkage plus a final canonical tip read validates the entire batch.
	const tip = history.at(-1)
	if (tip === undefined || (await blockReader.getBlock({ blockNumber: tip.number })).hash !== tip.hash) return { history: [] }
	return { history, ...(transaction === undefined ? {} : { transaction }) }
}

export const waitForTransactionReceipt = async (actions: Pick<PublicClientActions, 'getTransaction' | 'getTransactionReceipt' | 'getBlockNumber' | 'getBlock'>, parameters: Parameters<PublicClientActions['waitForTransactionReceipt']>[0], retryDelay: Transport['retryDelay']) => {
	const timeoutMilliseconds = parameters.timeout ?? 180_000
	const pollingInterval = parameters.pollingInterval ?? 1_000
	const startTime = Date.now()
	let lastRequestError: Error | undefined
	let lastReceiptNotFoundError: Error | undefined
	return await runWithDeadline({
		getTimeoutError: () => {
			if (lastRequestError !== undefined && isRateLimitError(lastRequestError)) return lastRequestError
			return lastReceiptNotFoundError ?? lastRequestError ?? new Error(`Timed out while waiting for transaction receipt "${parameters.hash}".`)
		},
		operation: async runBeforeDeadline => {
			const waitForNextPoll = async () => {
				let pollingTimer: ReturnType<typeof setTimeout> | undefined
				try {
					await runBeforeDeadline(
						async () =>
							await new Promise(resolve => {
								pollingTimer = setTimeout(resolve, pollingInterval)
							}),
					)
				} finally {
					if (pollingTimer !== undefined) clearTimeout(pollingTimer)
				}
			}
			const requestWithRetry = <TValue>(operation: () => Promise<TValue>) => {
				lastRequestError = undefined
				return runBeforeDeadline(() =>
					retryRateLimited(
						async () => {
							lastRequestError = undefined
							try {
								return await operation()
							} catch (error) {
								if (error instanceof Error) lastRequestError = error
								throw error
							}
						},
						{ retryDelay, startTime, timeout: timeoutMilliseconds },
					),
				)
			}
			const findOriginalTransaction = async () => {
				try {
					return await requestWithRetry(() => actions.getTransaction({ hash: parameters.hash }))
				} catch (error) {
					if (!isTransactionNotFoundError(error)) throw error
					return undefined
				}
			}
			let originalTransaction = parameters.transaction
			let replacementScanHistory: ReplacementScanBlock[] = []
			if (parameters.onReplaced !== undefined) originalTransaction ??= await findOriginalTransaction()
			while (true) {
				try {
					return await requestWithRetry(() => actions.getTransactionReceipt({ hash: parameters.hash }))
				} catch (error) {
					if (!isTransactionNotFoundError(error)) throw error
					lastReceiptNotFoundError = error
					if (parameters.onReplaced !== undefined) originalTransaction ??= await findOriginalTransaction()
					if (originalTransaction !== undefined) {
						const transactionToReplace = originalTransaction
						const latestBlockNumber = await requestWithRetry(() => actions.getBlockNumber())
						const replacementBlockReader: Pick<PublicClientActions, 'getBlock'> = {
							getBlock: parameters => requestWithRetry(() => actions.getBlock(parameters)),
						}
						const scan = await scanReplacementTransactions(replacementBlockReader, transactionToReplace, latestBlockNumber, replacementScanHistory)
						replacementScanHistory = scan.history
						const replacementTransaction = scan.transaction
						if (replacementTransaction !== undefined) {
							const transactionReceipt = await requestWithRetry(() => actions.getTransactionReceipt({ hash: replacementTransaction.hash }))
							parameters.onReplaced?.({
								reason: getReplacementReason(transactionToReplace, replacementTransaction),
								replacedTransaction: transactionToReplace,
								transaction: replacementTransaction,
								transactionReceipt,
							})
							return transactionReceipt
						}
					}
					if (Date.now() - startTime >= timeoutMilliseconds) throw error
					await waitForNextPoll()
				}
			}
		},
		timeout: timeoutMilliseconds,
	})
}
