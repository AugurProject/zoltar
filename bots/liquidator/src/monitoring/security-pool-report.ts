import { sharedPoolPriceFeedAbi, openOracleAbi } from '@zoltar/bot-shared/contracts/abi'
import type { SecurityPoolCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { parseAbiItem, type Hex } from '@zoltar/bot-shared/ethereum'
import { fetchLogsWithAdaptiveRanges } from '@zoltar/bot-shared/monitoring/block-sync'
import type { ReadClient } from './read-client.ts'

export type SponsoredReportCursor = { nextBlock: bigint; reportIds: bigint[]; blockHash?: Hex }
const fundingEvent = parseAbiItem('event ReportFundingAssigned(uint256 indexed reportId,address indexed sponsor)')

/** Retained unresolved IDs and a canonical log cursor survive restarts; an index overwrite cannot hide funding. */
export async function loadSponsoredOperationReport(client: ReadClient, snapshot: SecurityPoolCapitalSnapshot, cursor: SponsoredReportCursor = { nextBlock: 0n, reportIds: [] }) {
	let start = cursor.nextBlock
	if (start > snapshot.blockNumber + 1n || (start > 0n && cursor.blockHash !== (await client.getBlock({ blockNumber: start - 1n })).hash)) start = 0n
	const ids = new Set(start === 0n ? [] : cursor.reportIds)
	const latest = await client.readContract({ abi: sharedPoolPriceFeedAbi, address: snapshot.priceFeed, blockNumber: snapshot.blockNumber, functionName: 'sponsorOperationReport', args: [snapshot.owner] })
	if (latest === 0n && ids.size === 0) return undefined
	if (latest !== 0n) ids.add(latest)
	const logs = start > snapshot.blockNumber ? [] : await fetchLogsWithAdaptiveRanges({ nextBlock: start }, snapshot.blockNumber, 50_000n, range => client.getLogs({ address: snapshot.priceFeed, event: fundingEvent, args: { sponsor: snapshot.owner }, ...range }))
	for (const log of logs) {
		const reportId: unknown = Reflect.get(log.args ?? {}, 'reportId')
		const sponsor: unknown = Reflect.get(log.args ?? {}, 'sponsor')
		if (typeof reportId !== 'bigint' || reportId <= 0n || typeof sponsor !== 'string' || sponsor.toLowerCase() !== snapshot.owner.toLowerCase()) throw new Error('Invalid sponsored report funding event')
		ids.add(reportId)
	}
	const pending = []
	for (const id of ids) {
		const report = await loadReport(client, snapshot, id)
		if (report !== undefined) pending.push(report)
	}
	if ((await client.getBlock({ blockNumber: snapshot.blockNumber })).hash !== snapshot.blockHash) throw new Error('Sponsored report snapshot changed during discovery')
	cursor.nextBlock = snapshot.blockNumber + 1n
	cursor.blockHash = snapshot.blockHash
	cursor.reportIds = pending.map(report => report.id)
	const selected = pending[0]
	return selected === undefined ? undefined : { ...selected, reservedRep: pending.reduce((sum, report) => sum + report.reservedRep, 0n), exposureKnown: pending.every(report => report.exposureKnown) }
}

async function loadReport(client: ReadClient, snapshot: SecurityPoolCapitalSnapshot, id: bigint) {
	const blockNumber = snapshot.blockNumber
	const feed = { abi: sharedPoolPriceFeedAbi, address: snapshot.priceFeed, blockNumber }
	if ((await client.readContract({ ...feed, functionName: 'reportOutcome', args: [id] })) !== 0n) return undefined
	const [escrow, sponsor, maxSettlementBaseFee] = await client.readContract({ ...feed, functionName: 'reportCandidates', args: [id] })
	if (sponsor.toLowerCase() !== snapshot.owner.toLowerCase()) throw new Error('Report sponsor index mismatch')
	const oracle = await client.readContract({ ...feed, functionName: 'openOracle' })
	const game = await client.readContract({ address: oracle, abi: openOracleAbi, functionName: 'storedGame', args: [id], blockNumber })
	const helper = await client.readContract({ address: oracle, abi: openOracleAbi, functionName: 'storedHelper', args: [id], blockNumber })
	if (game[16].toLowerCase() !== escrow.toLowerCase() || helper[0].toLowerCase() !== escrow.toLowerCase() || game[5].toLowerCase() === game[11].toLowerCase()) throw new Error('Report escrow binding mismatch')
	// recoverReport retires a settled report as 'Report stale' at any base fee once
	// its observation (final report time plus settlement time) leaves the validity window.
	const staleAt = game[3] + game[7] + (await client.readContract({ ...feed, functionName: 'priceValidityWindowSeconds' }))
	const credits = await Promise.all([game[5], game[11]].map(token => client.readContract({ address: oracle, abi: openOracleAbi, functionName: 'tokenHolder', args: [escrow, token], blockNumber })))
	const ownReport = game[4] === 0n && game[2].toLowerCase() === escrow.toLowerCase()
	const weth = (credits[0] === undefined || credits[0] <= 1n ? 0n : credits[0] - 1n) + (ownReport ? game[0] : 0n)
	const rep = (credits[1] === undefined || credits[1] <= 1n ? 0n : credits[1] - 1n) + (ownReport ? game[1] : 0n)
	return { id, oracle, game, helper, maxSettlementBaseFee, staleAt, exposureKnown: weth === 0n || snapshot.acceptedPrice > 0n, reservedRep: rep + (weth * snapshot.acceptedPrice) / 10n ** 18n }
}
