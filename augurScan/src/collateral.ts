export type CollateralUnit = { readonly symbol: string; readonly decimals: number; readonly address?: string }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Missing metadata stays in explicit base units; collateral must never silently inherit native ETH units. */
export function collateralUnit(value: unknown): CollateralUnit {
	if (!record(value)) return { symbol: 'collateral units', decimals: 0 }
	for (const key of ['collateral', 'read_result', 'pool_read_result', 'current_state']) {
		const candidate = value[key]
		if (record(candidate)) {
			if (key !== 'collateral') {
				if (record(candidate['collateral'])) return collateralUnit({ collateral: candidate['collateral'] })
				continue
			}
			const decimals = candidate['decimals']
			const symbol = candidate['symbol']
			if (typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 0 && decimals <= 255 && typeof symbol === 'string' && symbol.trim() !== '') return { symbol: symbol.trim(), decimals, ...(typeof candidate['address'] === 'string' ? { address: candidate['address'] } : {}) }
		}
	}
	return { symbol: 'collateral units', decimals: 0 }
}
