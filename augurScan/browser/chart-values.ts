export interface UniswapPriceObservation {
	timestamp: string
	venue: string
	market_id: string
	fee_hundredths_bip: string
	quote_symbol: string
	event_name: string
	rep_per_eth_1e18: string
	liquidity_value?: string | null
	block_number: string
	contract_address: string
}

export interface UniswapChartRow extends UniswapPriceObservation {
	[key: `uniswap_price_${number}`]: string
}

export interface UniswapLiquidityChartRow extends UniswapPriceObservation {
	[key: `uniswap_liquidity_${number}`]: string
}

export interface ChartDefinition {
	key: Extract<keyof UniswapChartRow, string>
	label: string
	unit: string
	className: string
	pointLabel: (row: UniswapChartRow) => string
}

export const chartValueBounds = (values: readonly number[], sharedRange: readonly [number, number] | undefined): { minimum: number; maximum: number } => {
	if (sharedRange !== undefined) return { minimum: sharedRange[0], maximum: sharedRange[1] }
	const finiteValues = values.filter(Number.isFinite)
	if (finiteValues.length === 0) return { minimum: 0, maximum: 1 }
	const minimum = Math.min(...finiteValues)
	const maximum = Math.max(...finiteValues)
	if (maximum !== minimum) return { minimum, maximum }
	if (maximum === 0) return { minimum: 0, maximum: 1 }
	const padding = Math.abs(maximum) * 0.05
	return { minimum: minimum - padding, maximum: maximum + padding }
}

const feeLabel = (fee: string): string => `${Number(fee) / 10_000}%`
const shortMarketId = (marketId: string): string => (marketId.length > 15 ? `${marketId.slice(0, 8)}…${marketId.slice(-6)}` : marketId)

export const uniswapPriceProvenance = (observation: UniswapPriceObservation): string =>
	`${observation.venue.toUpperCase()} · ${feeLabel(observation.fee_hundredths_bip)} · ${observation.quote_symbol} · ${shortMarketId(observation.market_id)}`

export const uniswapPriceChartModel = (observations: readonly UniswapPriceObservation[]) => {
	const quoteSymbols = new Set(observations.map(({ quote_symbol }) => quote_symbol))
	const bounds = chartValueBounds(
		observations.map((observation) => Number(observation.rep_per_eth_1e18) / 1e18),
		undefined,
	)
	const identities = [
		...new Map(
			observations.map((observation) => {
				const identity = `${observation.venue}:${observation.market_id}`
				return [identity, observation]
			}),
		).entries(),
	].sort(([, left], [, right]) => left.venue.localeCompare(right.venue) || Number(left.fee_hundredths_bip) - Number(right.fee_hundredths_bip))
	const keys = new Map<string, `uniswap_price_${number}`>(
		identities.map(([identity], index): [string, `uniswap_price_${number}`] => [identity, `uniswap_price_${index}`]),
	)
	const rows: UniswapChartRow[] = [...observations]
		.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
		.map((observation) => {
			const key = keys.get(`${observation.venue}:${observation.market_id}`)
			if (key === undefined) throw new Error(`Missing chart series for ${observation.venue}:${observation.market_id}`)
			return { ...observation, [key]: observation.rep_per_eth_1e18 }
		})
	return {
		rows,
		definitions: identities.map(
			([identity, observation], index): ChartDefinition => ({
				key:
					keys.get(identity) ??
					(() => {
						throw new Error(`Missing chart definition for ${identity}`)
					})(),
				label: `Uniswap ${uniswapPriceProvenance(observation)}`,
				unit: `REP/${observation.quote_symbol}`,
				className: `series-${index % 8}`,
				pointLabel: (row) => `${row.event_name} · ${row.market_id}`,
			}),
		),
		sharedRange: quoteSymbols.size <= 1 ? ([bounds.minimum, bounds.maximum] as const) : undefined,
		latestObservation: rows.at(-1),
	}
}

export const uniswapLiquidityChartModel = (observations: readonly UniswapPriceObservation[]) => {
	const available = observations.filter(
		(observation): observation is UniswapPriceObservation & { liquidity_value: string } =>
			observation.liquidity_value !== undefined && observation.liquidity_value !== null,
	)
	const identities = [
		...new Map(
			available.map((observation) => {
				const identity = `${observation.venue}:${observation.market_id}`
				return [identity, observation]
			}),
		).entries(),
	].sort(([, left], [, right]) => left.venue.localeCompare(right.venue) || Number(left.fee_hundredths_bip) - Number(right.fee_hundredths_bip))
	const keys = new Map<string, `uniswap_liquidity_${number}`>(
		identities.map(([identity], index): [string, `uniswap_liquidity_${number}`] => [identity, `uniswap_liquidity_${index}`]),
	)
	const rows: UniswapLiquidityChartRow[] = [...available]
		.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
		.map((observation) => {
			const key = keys.get(`${observation.venue}:${observation.market_id}`)
			if (key === undefined) throw new Error(`Missing liquidity series for ${observation.venue}:${observation.market_id}`)
			return { ...observation, [key]: observation.liquidity_value }
		})
	return {
		rows,
		definitions: identities.map(([identity, observation], index) => ({
			key:
				keys.get(identity) ??
				(() => {
					throw new Error(`Missing liquidity definition for ${identity}`)
				})(),
			label: `${uniswapPriceProvenance(observation)} liquidity`,
			decimals: 0,
			unit: observation.venue === 'v2' ? 'reserve product' : 'active liquidity',
			className: `series-${index % 8}`,
			pointLabel: (row: UniswapLiquidityChartRow) =>
				`${row.venue.toUpperCase()} ${row.event_name} · ${row.market_id} · ${row.venue === 'v2' ? 'reserve product' : 'active liquidity'}`,
		})),
	}
}
