export const chartValueBounds = (values, sharedRange) => {
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

const feeLabel = (fee) => `${Number(fee) / 10_000}%`
const shortMarketId = (marketId) => (marketId.length > 15 ? `${marketId.slice(0, 8)}…${marketId.slice(-6)}` : marketId)

export const uniswapPriceProvenance = (observation) =>
	`${observation.venue.toUpperCase()} · ${feeLabel(observation.fee_hundredths_bip)} · ${observation.quote_symbol} · ${shortMarketId(observation.market_id)}`

export const uniswapPriceChartModel = (observations) => {
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
	const keys = new Map(identities.map(([identity], index) => [identity, `uniswap_price_${index}`]))
	const rows = [...observations]
		.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
		.map((observation) => ({
			...observation,
			[keys.get(`${observation.venue}:${observation.market_id}`)]: observation.rep_per_eth_1e18,
		}))
	return {
		rows,
		definitions: identities.map(([identity, observation], index) => ({
			key: keys.get(identity),
			label: `Uniswap ${uniswapPriceProvenance(observation)}`,
			unit: `REP/${observation.quote_symbol}`,
			className: `series-${index % 8}`,
			pointLabel: (row) => `${row.event_name} · ${row.market_id}`,
		})),
		sharedRange: [bounds.minimum, bounds.maximum],
		latestObservation: rows.at(-1),
	}
}
