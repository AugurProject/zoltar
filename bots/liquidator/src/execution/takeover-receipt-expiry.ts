import { securityPoolCapitalLedgerAbi, securityPoolCommitmentIndexAbi, zoltarAbi } from '@zoltar/bot-shared/contracts/abi'
import { decodeFunctionData, parseTransaction, type TransactionReceipt } from '@zoltar/bot-shared/ethereum'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import type { RpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import type { ReadClient } from '#monitoring/read-client'
import type { PendingTransactionIntent } from '#state/operator-state'

/**
 * Explains a reverted takeover by a change after signing that the ledger rejects, so the revert is an
 * expected expiry rather than a safety failure. `undefined` means no such change is evident.
 */
export async function explainTakeoverReceiptExpiry(intent: PendingTransactionIntent, receipt: TransactionReceipt, readers: readonly { client: ReadClient; endpoint: string }[], quorum: RpcQuorumRequirement) {
	if (!intent.requiresMarketEvidence || intent.submissionBlock >= receipt.blockNumber) return undefined
	const signed = parseTransaction(intent.serializedTransaction)
	if (signed.to === undefined || signed.data === undefined || signed.gas === undefined || receipt.gasUsed >= signed.gas) return undefined
	const ledger = signed.to
	const call = decodeFunctionData({ abi: securityPoolCapitalLedgerAbi, data: signed.data })
	if (call.functionName !== 'takeOverWithBounds' && call.functionName !== 'takeOverAuctionBid') return undefined
	const [target, , , , bounds] = call.args
	const state = await settledQuorumValue(
		'finalized takeover evidence',
		readers.map(async ({ client, endpoint }) => {
			const blockNumber = receipt.blockNumber
			const [confirmed, submission] = await Promise.all([client.getBlock({ blockNumber }), client.getBlock({ blockNumber: intent.submissionBlock })])
			if (confirmed.hash !== receipt.blockHash) throw new Error('Takeover receipt block changed during reconciliation')
			if (submission.hash === undefined) throw new Error('Takeover submission block is missing')
			const atReceipt = { address: ledger, abi: securityPoolCapitalLedgerAbi, blockNumber } as const
			const [epoch, oldDemand, demand, index, priceValidUntil, importing, frozen, zoltar, universeId] = await Promise.all([
				client.readContract({ ...atReceipt, functionName: 'acceptedPriceEpoch' }),
				client.readContract({ ...atReceipt, functionName: 'demandAttoEth', blockNumber: intent.submissionBlock }),
				client.readContract({ ...atReceipt, functionName: 'demandAttoEth' }),
				client.readContract({ ...atReceipt, functionName: 'commitmentIndex' }),
				client.readContract({ ...atReceipt, functionName: 'priceValidUntil', blockNumber: intent.submissionBlock }),
				client.readContract({ ...atReceipt, functionName: 'importing' }),
				client.readContract({ ...atReceipt, functionName: 'frozen' }),
				client.readContract({ ...atReceipt, functionName: 'zoltar' }),
				client.readContract({ ...atReceipt, functionName: 'universeId' }),
			])
			const forkTime = await client.readContract({ address: zoltar, abi: zoltarAbi, functionName: 'getForkTime', args: [universeId], blockNumber })
			const positionId = call.functionName === 'takeOverWithBounds' ? target : await client.readContract({ ...atReceipt, functionName: 'auctionBidPositionIds', args: [target] })
			const position = positionId === 0n ? undefined : await client.readContract({ address: index, abi: securityPoolCommitmentIndexAbi, functionName: 'accountOf', args: [positionId], blockNumber })
			const priorPosition = call.functionName === 'takeOverWithBounds' ? await client.readContract({ address: index, abi: securityPoolCommitmentIndexAbi, functionName: 'accountOf', args: [target], blockNumber: intent.submissionBlock }) : undefined
			const [receiptCheck, submissionCheck] = await Promise.all([client.getBlock({ blockNumber }), client.getBlock({ blockNumber: intent.submissionBlock })])
			if (receiptCheck.hash !== confirmed.hash || submissionCheck.hash !== submission.hash) throw new Error('Takeover evidence changed during reconciliation')
			// The ledger's `_requireFresh` and `_requireOpen` at inclusion: the price signed against has lapsed, or the universe forked, froze or is importing.
			const priceStale = confirmed.timestamp >= priceValidUntil
			const inactive = importing || frozen || forkTime !== 0n
			return { endpoint, value: { epoch, oldDemand, demand, position, priorPosition, priceStale, inactive, submissionHash: submission.hash } }
		}),
		quorum,
	)
	if (state.inactive) return 'Capital universe inactive'
	if (state.priceStale) return 'Capital price stale'
	if (state.epoch !== bounds.expectedAcceptedPriceEpoch) return 'Accepted price epoch changed'
	if (state.oldDemand !== state.demand) return 'Portfolio demand changed'
	if (state.position !== undefined && state.position.commitment === 0n) return 'Target position is no longer live'
	if (state.position !== undefined && state.position.batch !== bounds.expectedSourceBatch) return 'Target retirement cohort changed'
	if (state.position !== undefined && state.priorPosition !== undefined && (state.position.owner !== state.priorPosition.owner || state.position.commitment !== state.priorPosition.commitment)) return 'Target position changed'
	return undefined
}
