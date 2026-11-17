import { collateralUnit, type CollateralUnit } from '../src/collateral.ts'
import { annualFeeText } from './pool-metrics.ts'
import { exactNumber, exactUnit, percentFromBps, utcDateTime } from './format.ts'
import { isPlainRecord } from '@zoltar/core-shared/validation/guards'

const outcomes = ['INVALID', 'YES', 'NO', 'None']
const capitalPriceKeys: ReadonlySet<string> = new Set(['acceptedPrice', 'conservativePrice', 'liquidationPrice', 'ownerConservativePrice', 'maxHealthyPrice'])
const MAX_UINT256 = 2n ** 256n - 1n
const label = (key: string): string => {
	const words = key
		.replace(/Bps$/i, '')
		.replace(/Atto(?:Rep|Eth|Shares)|_atto_(?:rep|eth|shares)/gi, '')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replaceAll('_', ' ')
	return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

const valueText = (key: string, value: unknown, nativeSymbol: string, collateral?: CollateralUnit): string => {
	if (value === undefined || value === null) return 'Unavailable'
	if (typeof value === 'boolean') return value ? 'Yes' : 'No'
	if (Array.isArray(value)) return value.map(item => valueText(key, item, nativeSymbol, collateral)).join(', ')
	if (isPlainRecord(value))
		return semanticFields(value, nativeSymbol, collateral)
			.map(([name, text]) => `${name}: ${text}`)
			.join(' · ')
	const text = String(value)
	if (/^(outcome|questionResolution|finalQuestionResolution)$/.test(key)) return outcomes[Number(text)] ?? `Unknown outcome (${text})`
	if (/^-?\d+$/.test(text)) {
		if (/^(activationTime|endTimestamp|nonDecisionTimestamp|priceValidUntil)$/.test(key) && BigInt(text) >= 0n && BigInt(text) <= 8_640_000_000_000n) return utcDateTime(Number(text) * 1000)
		// The ledger reports zero until an adverse price observation starts a position's take-over clock.
		if (key === 'liquidationStartedAt') return text === '0' ? 'Not started' : utcDateTime(Number(text) * 1000)
		// Capital-ledger prices are attoREP per whole collateral token scaled by 1e18; a position without commitment has no price limit.
		if (capitalPriceKeys.has(key)) {
			if (BigInt(text) === MAX_UINT256) return 'No limit'
			return collateral === undefined ? exactNumber(text) : exactUnit(text, Math.max(0, 36 - collateral.decimals), `REP/${collateral.symbol}`)
		}
		const unitKey = key.replaceAll('_', '')
		if (/attoRep/i.test(unitKey)) return exactUnit(text, 18, 'REP')
		if (/attoEthPerGas/i.test(unitKey)) return exactUnit(text, 18, `${nativeSymbol}/gas`)
		if (/attoEth/i.test(unitKey) || key === 'wad') return collateral === undefined ? exactUnit(text, 18, nativeSymbol) : exactUnit(text, collateral.decimals, collateral.symbol)
		if (/shares/i.test(unitKey)) return exactUnit(text, 18, 'shares')
		if (/^feeIndex$/i.test(unitKey)) return exactUnit(text, 18, 'ratio')
		if (/bps$/i.test(unitKey)) return percentFromBps(text)
		return exactNumber(text)
	}
	return text
}

/**
 * Labels and formats decoded fields. attoETH amounts are in the record's `collateral` token when it names one, otherwise in
 * the inherited `collateral` (nested records and collateral-denominated entities such as auctions), otherwise in the
 * chain's native currency, `nativeSymbol`.
 */
export const semanticFields = (data: Readonly<Record<string, unknown>>, nativeSymbol: string, inheritedCollateral?: CollateralUnit): ReadonlyArray<readonly [string, string]> => {
	const collateral = data['collateral'] === undefined ? inheritedCollateral : collateralUnit(data)
	return Object.entries(data).flatMap(([key, value]) => {
		if (/^(current)?retentionrate$/i.test(key.replaceAll('_', ''))) return [['Annual open-interest fee', annualFeeText(value)] as const]
		if (key === 'outcomeBalancesAttoRep' && Array.isArray(value)) return value.map((balance, index): readonly [string, string] => [`${outcomes[index] ?? index} balance`, valueText('amountAttoRep', balance, nativeSymbol)])
		return [[label(key), valueText(key, value, nativeSymbol, collateral)] as const]
	})
}

export const semanticSummary = (record: Readonly<Record<string, unknown>>, nativeSymbol: string, collateral?: CollateralUnit): string => {
	const data = record['event_data'] ?? record['summary_data'] ?? record['arguments'] ?? record['read_result']
	return isPlainRecord(data)
		? semanticFields(data, nativeSymbol, collateral)
				.map(([name, value]) => `${name}: ${value}`)
				.join(' · ') || 'No payload fields'
		: 'Payload unavailable'
}

export const timelineEntityPath = (record: Readonly<Record<string, unknown>>): string | undefined => {
	const identity = String(record['entity_identity'] ?? '')
	if (identity === '') return undefined
	const segment = encodeURIComponent(identity)
	switch (record['entity_type']) {
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
