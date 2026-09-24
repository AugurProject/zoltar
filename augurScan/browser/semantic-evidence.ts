import { isRecord } from './api-validation.ts'
import { exactNumber, exactUnit, percentFromBps, utcDateTime } from './format.ts'

const outcomes = ['INVALID', 'YES', 'NO', 'None']
const label = (key: string): string => {
	const words = key
		.replace(/Bps$/i, '')
		.replace(/Atto(?:Rep|Eth|Shares)|_atto_(?:rep|eth|shares)/gi, '')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replaceAll('_', ' ')
	return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

const valueText = (key: string, value: unknown): string => {
	if (value === undefined || value === null) return 'Unavailable'
	if (typeof value === 'boolean') return value ? 'Yes' : 'No'
	if (Array.isArray(value)) return value.map(item => valueText(key, item)).join(', ')
	if (isRecord(value))
		return semanticFields(value)
			.map(([name, text]) => `${name}: ${text}`)
			.join(' · ')
	const text = String(value)
	if (/^(outcome|questionResolution|finalQuestionResolution)$/.test(key)) return outcomes[Number(text)] ?? `Unknown outcome (${text})`
	if (/^-?\d+$/.test(text)) {
		if (/^(activationTime|endTimestamp|nonDecisionTimestamp)$/.test(key) && BigInt(text) >= 0n && BigInt(text) <= 8_640_000_000_000n) return utcDateTime(Number(text) * 1000)
		const unitKey = key.replaceAll('_', '')
		if (/attoRep/i.test(unitKey)) return exactUnit(text, 18, 'REP')
		if (/attoEth/i.test(unitKey) || key === 'wad') return exactUnit(text, 18, 'ETH')
		if (/shares/i.test(unitKey)) return exactUnit(text, 18, 'shares')
		if (/^(currentRetentionRate|feeIndex)$/i.test(unitKey)) return exactUnit(text, 18, 'ratio')
		if (/bps$/i.test(unitKey)) return percentFromBps(text)
		return exactNumber(text)
	}
	return text
}

export const semanticFields = (data: Readonly<Record<string, unknown>>): ReadonlyArray<readonly [string, string]> =>
	Object.entries(data).flatMap(([key, value]) => {
		if (key === 'outcomeBalancesAttoRep' && Array.isArray(value)) return value.map((balance, index): readonly [string, string] => [`${outcomes[index] ?? index} balance`, valueText('amountAttoRep', balance)])
		return [[label(key), valueText(key, value)] as const]
	})

export const semanticSummary = (record: Readonly<Record<string, unknown>>): string => {
	const data = record['event_data'] ?? record['summary_data'] ?? record['arguments'] ?? record['read_result']
	return isRecord(data)
		? semanticFields(data)
				.map(([name, value]) => `${name}: ${value}`)
				.join(' · ') || 'No payload fields'
		: 'Payload unavailable'
}

export const timelineEntityPath = (record: Readonly<Record<string, unknown>>): string | undefined => {
	const identity = String(record['entity_identity'] ?? '')
	if (identity === '') return undefined
	const segment = encodeURIComponent(identity)
	switch (record['entity_type']) {
		case 'vault':
			return `/operations/risk/vault/${identity.split(':').map(encodeURIComponent).join('/')}`
		case 'pool':
			return `/operations/risk/pool/${segment}`
		case 'auction':
			return `/operations/auction/${segment}`
		case 'escalation':
			return `/operations/escalation/${segment}`
		case 'fork':
			return `/operations/fork/${segment}`
		case 'amm':
			return `/operations/trading/${segment}`
		case 'open-oracle-report':
			return `/operations/report/${identity.split(':').map(encodeURIComponent).join('/')}`
		case 'question':
			return `/question/${segment}`
		default:
			return /^0x[\da-f]{40}$/i.test(identity) ? `/address/${segment}` : undefined
	}
}
