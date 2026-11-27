import { formatUnits } from '@zoltar/core-shared/evm/ethereum'

export type ReviewRow = { label: string; value: string }

export function reviewBalance(label: string, before: bigint, after: bigint, decimals: number, symbol?: string): ReviewRow {
	const amount = (value: bigint) => [formatUnits(value, decimals), symbol].filter(Boolean).join(' ')
	return { label, value: `${amount(before)} → ${amount(after)}` }
}
