import { getAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { isHash32, record } from '@zoltar/bot-shared/infrastructure/json-validation'
import { parseFundingEffect } from './portfolio-instructions.ts'

export type ReportSponsorship = { feed: Address; fundingKey: string }
/** Only bot-created takeover batches enter this journal. */
export type SponsoredReport = ReportSponsorship & { reportId: bigint; sponsor: Address; createdBlock: bigint; nextBlock: bigint; anchorHash?: Hex | undefined }

export function parseReportSponsorship(value: unknown): ReportSponsorship | undefined {
	if (value === undefined) return undefined
	const data = record(value, 'Report sponsorship')
	const funding = parseFundingEffect({ key: data['fundingKey'], operation: 'consume', amount: '0' })
	if (funding === undefined) throw new Error('Missing report funding key')
	return { feed: getAddress(String(data['feed'])), fundingKey: funding.key }
}

function uint(value: unknown) {
	if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) >= 2n ** 256n) throw new Error('Invalid sponsored report integer')
	return BigInt(value)
}

export function parseSponsoredReports(value: unknown): SponsoredReport[] {
	if (value === undefined) return []
	if (!Array.isArray(value)) throw new Error('Sponsored reports must be an array')
	return value.map(item => {
		const data = record(item, 'Sponsored report')
		const sponsorship = parseReportSponsorship(item)
		if (sponsorship === undefined) throw new Error('Missing sponsorship')
		const reportId = uint(data['reportId'])
		const createdBlock = uint(data['createdBlock'])
		const nextBlock = uint(data['nextBlock'])
		const anchorHash = data['anchorHash']
		if (reportId === 0n || nextBlock < createdBlock || (anchorHash !== undefined && !isHash32(anchorHash)) || (nextBlock > createdBlock && anchorHash === undefined)) throw new Error('Invalid sponsored report scan cursor')
		return { ...sponsorship, reportId, sponsor: getAddress(String(data['sponsor'])), createdBlock, nextBlock, anchorHash }
	})
}

export function sameSponsoredReport(left: Pick<SponsoredReport, 'feed' | 'reportId' | 'sponsor'>, right: Pick<SponsoredReport, 'feed' | 'reportId' | 'sponsor'>) {
	return left.feed.toLowerCase() === right.feed.toLowerCase() && left.reportId === right.reportId && left.sponsor.toLowerCase() === right.sponsor.toLowerCase()
}
