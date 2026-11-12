import { createPublicClient, toHex, type Account, type Chain, type Transport, type WalletClient, type createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { settledQuorumValue, sharedQuorumReadTargets } from '@zoltar/bot-shared/monitoring/read-quorum'
import { PRIVATE_INTENT_FINALITY_BLOCKS } from '#core/cycle-control'
import type { OperatorSettings } from '#config/settings'
import { recordActivity, saveDurableState, type RuntimeState } from '#state/operator-state'
import { sameSponsoredReport } from '#state/sponsored-reports'
import { applySponsoredReportReceipt, terminalReportTopics } from './sponsored-report-receipt.ts'
import { finalizedReceiptWithQuorum } from './recovery.ts'

/** Bounded, durable event scans find settlements by any account, including while
 * this process was offline. Only canonical, finalized receipts retire funding. */
export async function reconcileSponsoredReports(wallet: WalletClient<Transport, Chain, Account>, settings: OperatorSettings, state: RuntimeState, pool: ReturnType<typeof createRpcEndpointPool>) {
	for (const report of [...(state.sponsoredReports ?? [])]) {
		// The pending intent's receipt transition owns its activity and funding
		// resolution. Scanning it too would publish the same result twice.
		if (state.pendingTransactions.some(intent => intent.reportOperations !== undefined && sameSponsoredReport(report, { ...intent.reportOperations, sponsor: intent.sender }))) continue
		const pinned = await sharedQuorumReadTargets(
			[settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(endpoint => ({ endpoint, client: createPublicClient({ chain: wallet.chain, transport: pool.transportFor(endpoint) }) })),
			settings.connectivity.rpcQuorum,
		)
		const finalizedBlock = pinned.blockNumber - PRIVATE_INTENT_FINALITY_BLOCKS
		if (finalizedBlock < report.nextBlock) continue
		const end = report.nextBlock + 2047n < finalizedBlock ? report.nextBlock + 2047n : finalizedBlock
		const range = await settledQuorumValue(
			'sponsored report event scan',
			pinned.readers.map(async ({ client, endpoint }) => {
				if (report.anchorHash !== undefined && (await client.getBlock({ blockNumber: report.nextBlock - 1n })).hash !== report.anchorHash) throw new Error('Sponsored report scan anchor was replaced')
				const block = await client.getBlock({ blockNumber: end })
				if (block.hash === undefined) throw new Error('Sponsored report scan block has no hash')
				const logs = await client.getLogs({ address: report.feed, topics: [terminalReportTopics, toHex(report.reportId, { size: 32 })], fromBlock: report.nextBlock, toBlock: end })
				if ((await client.getBlock({ blockNumber: end })).hash !== block.hash) throw new Error('Sponsored report scan changed during discovery')
				return { endpoint, value: { logs, hash: block.hash } }
			}),
			settings.connectivity.rpcQuorum,
		)
		const next = { ...state, activities: [...state.activities], sponsoredReports: [...(state.sponsoredReports ?? [])] }
		const terminal = range.logs[0]
		if (terminal !== undefined) {
			if (terminal.transactionHash === undefined) throw new Error('Sponsored report event has no transaction hash')
			const { receipt } = await finalizedReceiptWithQuorum(settings, wallet, terminal.transactionHash, pool)
			if (receipt === undefined) continue
			if (receipt.blockHash !== terminal.blockHash || receipt.blockNumber !== terminal.blockNumber) throw new Error('Sponsored report event does not match its canonical receipt')
			const outcome = applySponsoredReportReceipt(next, report, receipt, 'Settle sponsored takeover report')
			if (outcome === undefined) throw new Error('Sponsored report receipt has no matching terminal outcome')
			recordActivity(next, { hash: receipt.transactionHash, kind: 'liquidation', message: outcome.message, status: outcome.status })
		} else {
			next.sponsoredReports = next.sponsoredReports.map(item => (sameSponsoredReport(item, report) ? { ...item, nextBlock: end + 1n, anchorHash: range.hash } : item))
		}
		await saveDurableState(settings.runtime.stateFile, next)
		state.sponsoredReports = next.sponsoredReports
		state.portfolioFunding = next.portfolioFunding
		state.activities = next.activities
	}
}
