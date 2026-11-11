import { sharedPoolPriceFeedAbi } from '@zoltar/bot-shared/contracts/abi'
import { decodeEventLog, keccak256, toHex, type TransactionReceipt } from '@zoltar/bot-shared/ethereum'
import { sameAddress } from '@zoltar/core-shared/evm/address'
import type { PendingTransactionIntent } from '#state/operator-state'

const attemptedTopic = keccak256(toHex('ReportOperationAttempted(uint256,address,uint256,bool)'))

/** Resolve from the receipt so live submission and restart recovery agree. */
export function reportOperationOutcomes(intent: Pick<PendingTransactionIntent, 'reportOperations' | 'sender' | 'label'>, receipt: TransactionReceipt) {
	const report = intent.reportOperations
	if (report === undefined) return undefined
	const operations = new Map<bigint, boolean>()
	for (const log of receipt.logs) {
		if (!sameAddress(log.address, report.feed) || log.topics[0] !== attemptedTopic) continue
		const event = decodeEventLog({ abi: sharedPoolPriceFeedAbi, data: log.data, topics: log.topics })
		if (event.eventName === 'ReportOperationAttempted' && event.args.reportId === report.reportId && sameAddress(event.args.sponsor, intent.sender)) operations.set(event.args.operationIndex, event.args.success)
	}
	if (operations.size === 0) return { succeeded: 0, message: `${intent.label}: no operation outcomes reported; inspect report status before recovery`, status: 'failed' as const }
	const ordered = [...operations].sort(([left], [right]) => {
		if (left === right) return 0
		return left < right ? -1 : 1
	})
	const succeeded = ordered.filter(([, success]) => success).length
	const failed = ordered.length - succeeded
	return {
		succeeded,
		message: `${intent.label}: ${succeeded} succeeded, ${failed} failed (${ordered.map(([index, success]) => `${index + 1n} ${success ? 'succeeded' : 'failed'}`).join('; ')})`,
		status: failed === 0 ? ('confirmed' as const) : ('failed' as const),
	}
}
