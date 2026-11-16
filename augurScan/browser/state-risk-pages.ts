import { collateralUnit } from '../src/collateral.ts'
import { questionIdHex } from './identifier-format.ts'
import type { EntityHistory, PoolRecord, StateEntity, StateTab } from './browser-types.ts'
import { uniswapLiquidityChartModel, uniswapPriceChartModel, uniswapPriceProvenance } from './chart-values.ts'
import { exactUnit, percentFromBps } from './format.ts'
import { shortIdentifier } from './identifier-format.ts'
import type { createOperationsComponents } from './operations-components.ts'
import type { createStateComponents } from './state-components.ts'

type OperationsComponents = ReturnType<typeof createOperationsComponents>
type StateComponents = ReturnType<typeof createStateComponents>

export interface StateRiskDeps {
	readonly lookup: (selector: string) => HTMLElement
	readonly fetchEntityHistory: (type: StateTab, item: StateEntity, throughOffset?: number) => Promise<EntityHistory>
	readonly isCurrent: () => boolean
	readonly nativeSymbol: (chainId?: string) => string
	readonly stateHeader: StateComponents['stateHeader']
	readonly historyCoverageNotice: (history: EntityHistory, type: StateTab, item: StateEntity) => HTMLElement
	readonly element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	readonly operationsHref: (pathname: string) => string
	readonly operationsPanel: OperationsComponents['operationsPanel']
	readonly operationRow: OperationsComponents['operationRow']
	readonly metricCard: StateComponents['metricCard']
	readonly number: (value: string | number | bigint | null | undefined) => string
	readonly chartCard: StateComponents['chartCard']
	readonly staticField: StateComponents['staticField']
	readonly staticAddressField: StateComponents['staticAddressField']
	readonly yesNoCheckpoint: (value: unknown) => string
}

export const renderPoolDetailPage = async (deps: StateRiskDeps, poolItem: PoolRecord, suppliedHistory?: EntityHistory): Promise<void> => {
	const { lookup: $, fetchEntityHistory, isCurrent, stateHeader, historyCoverageNotice, element, operationsHref, operationsPanel, operationRow, metricCard, number, chartCard, staticField, staticAddressField, yesNoCheckpoint } = deps
	const history = suppliedHistory ?? (await fetchEntityHistory('pools', poolItem))
	if (!isCurrent()) return
	const poolCollateral = collateralUnit(poolItem)
	const poolNativeSymbol = poolCollateral.symbol
	const ammPrices = history.ammPrices ?? []
	const repEthPrices = history.repEthPrices ?? []
	const uniswapRepEthPrices = history.uniswapRepEthPrices ?? []
	const openOracleHistory = history.openOracleHistory ?? []
	const uniswapChart = uniswapPriceChartModel(uniswapRepEthPrices)
	const uniswapLiquidity = uniswapLiquidityChartModel(uniswapRepEthPrices)
	const latestAmmPrice = ammPrices.at(-1)
	const latestRepEthPrice = repEthPrices.at(-1)
	const latestUniswapPrice = uniswapChart.latestObservation
	const fragment = document.createDocumentFragment()
	fragment.append(stateHeader('Security pool', poolItem.question_title ?? 'Unknown question', `${poolItem.pool_address} · universe ${shortIdentifier(poolItem.universe_id, 8, 6)}`, 'Latest available'))
	const canonicalPool = element('a', 'back-link', 'Open pool page →')
	canonicalPool.href = operationsHref(`/pool/${poolItem.pool_address}`)
	fragment.append(canonicalPool)
	fragment.append(historyCoverageNotice(history, 'pools', poolItem))
	fragment.append(
		operationsPanel(
			'OpenOracle coordinator state and history',
			openOracleHistory.map(observation => operationRow(String(observation['event_name'] ?? 'Coordinator transition'), String(observation['summary'] ?? 'Canonical OpenOracle coordinator evidence'), String(observation['coordinator_address'] ?? poolItem.coordinator_address), observation['block_number'])),
			'No OpenOracle coordinator state transitions match this view.',
		),
	)
	const metrics = element('div', 'metric-grid')
	metrics.append(
		metricCard('Settlement collateral', poolItem.settlement_collateral_atto_eth == null ? 'No checkpoint' : exactUnit(poolItem.settlement_collateral_atto_eth, poolCollateral.decimals, poolNativeSymbol)),
		metricCard('Share-token supply', poolItem.share_token_supply_atto_shares == null ? 'No checkpoint' : exactUnit(poolItem.share_token_supply_atto_shares, poolCollateral.decimals, 'shares')),
		metricCard('Conditional YES', latestAmmPrice === undefined ? 'No AMM price' : exactUnit(latestAmmPrice.conditional_yes_bps, 2, '%')),
		metricCard('Conditional NO', latestAmmPrice === undefined ? 'No AMM price' : exactUnit(latestAmmPrice.conditional_no_bps, 2, '%')),
		metricCard(`REP / ${poolNativeSymbol}`, latestRepEthPrice === undefined ? 'No coordinator price' : exactUnit(latestRepEthPrice.rep_per_eth_1e18, Math.max(0, 36 - poolCollateral.decimals), `REP/${poolNativeSymbol}`)),
		metricCard('Latest Uniswap spot', latestUniswapPrice === undefined ? 'No Uniswap price' : exactUnit(latestUniswapPrice.rep_per_eth_1e18, 18, `REP/${latestUniswapPrice.quote_symbol}`), latestUniswapPrice === undefined ? undefined : uniswapPriceProvenance(latestUniswapPrice)),
		metricCard('AMM market', history.market === undefined ? 'Unavailable' : `${number(ammPrices.length)} observations`),
	)
	fragment.append(metrics)
	fragment.append(
		chartCard(
			'Pool accounting history',
			history.snapshots,
			[
				{ key: 'settlement_collateral_atto_eth', label: 'Collateral', unit: poolNativeSymbol, decimals: poolCollateral.decimals },
				{ key: 'share_token_supply_atto_shares', label: 'Share-token supply', unit: 'shares', decimals: poolCollateral.decimals, className: 'secondary' },
			],
			`Collateral is shown in ${poolNativeSymbol}; supply in shares.`,
			{ zeroBaseline: true },
		),
		chartCard(
			'Uniswap REP price curves',
			uniswapChart.rows,
			uniswapChart.definitions,
			'Event-time marginal prices derived from V2 Sync reserves and V3/V4 Initialize or Swap sqrt prices. Curves retain their explicit WETH, native ETH, or USDC quote orientation. These values can be manipulated within a block and are not a TWAP or protocol oracle.',
			{
				sharedRange: uniswapChart.sharedRange,
				emptyMessage: 'No Uniswap REP / ETH or REP / USDC pool observations match this view.',
			},
		),
		chartCard(
			'Uniswap liquidity over time',
			uniswapLiquidity.rows,
			uniswapLiquidity.definitions,
			`Values use whole-token units: V2 shows REP × quote-token reserves; V3/V4 show active liquidity in √(REP × quote token). These measures are not directly comparable.${uniswapLiquidity.unavailableCount > 0 ? ` ${uniswapLiquidity.unavailableCount} observations omitted because decimal scaling is unavailable.` : ''}`,
			{ zeroBaseline: true, emptyMessage: uniswapLiquidity.unavailableCount > 0 ? 'Liquidity decimal scaling is unavailable for these observations.' : 'No Uniswap liquidity observations match this view.' },
		),
	)
	fragment.append(
		chartCard(
			'Conditional YES / NO spot price history',
			ammPrices,
			[
				{ key: 'conditional_yes_bps', label: 'Conditional YES', decimals: 2, unit: '%' },
				{ key: 'conditional_no_bps', label: 'Conditional NO', decimals: 2, unit: '%', className: 'secondary' },
			],
			'Each point is derived from the exact YES/NO reserves emitted by an Augur AMM Sync event. Prices are conditional on a valid resolution and are manipulable spot values, not a TWAP or protocol oracle.',
			{ sharedRange: [0, 100], axisUnit: '%', emptyMessage: 'No Augur AMM reserve observations match this view.' },
		),
		chartCard(
			`REP / ${poolNativeSymbol} coordinator price history`,
			repEthPrices,
			[
				{
					key: 'rep_per_eth_1e18',
					label: `REP per ${poolNativeSymbol}`,
					unit: `REP/${poolNativeSymbol}`,
					decimals: Math.max(0, 36 - poolCollateral.decimals),
				},
			],
			'Each point is a settlement the coordinator accepted (PriceReported).',
			{ emptyMessage: 'No collateral / REP coordinator price observations match this view.' },
		),
	)
	const currentCard = element('section', 'static-card')
	currentCard.append(element('h4', '', 'Latest available accounting and lifecycle'))
	const currentGrid = element('div', 'static-grid')
	const systemStates = ['Operational', 'Pool forked', 'Fork migration']
	const currentState = poolItem.current_state ?? {}
	currentGrid.append(
		staticField('System state', currentState['systemState'] === undefined ? 'No lifecycle event yet' : (systemStates[Number(currentState['systemState'])] ?? `State ${currentState['systemState']}`)),
		staticField('Awaiting fork continuation', yesNoCheckpoint(currentState['awaitingForkContinuation'])),
		typeof currentState['escalationGame'] === 'string' && currentState['escalationGame'] !== '' ? staticAddressField('Escalation game', currentState['escalationGame'], poolItem.chain_id) : staticField('Escalation game', 'Not set'),
	)
	currentCard.append(currentGrid)
	fragment.append(currentCard)
	const staticCard = element('section', 'static-card')
	staticCard.append(element('h4', '', 'Immutable deployment configuration'))
	const grid = element('div', 'static-grid')
	grid.append(
		staticField('Question ID', questionIdHex(poolItem.question_id)),
		staticAddressField('Parent pool', poolItem.parent_address, poolItem.chain_id),
		staticAddressField('Share token', poolItem.share_token_address, poolItem.chain_id),
		staticAddressField('Price coordinator', poolItem.coordinator_address, poolItem.chain_id),
		history.market === undefined || history.market === null ? staticField('Augur AMM pair', 'Unavailable') : staticAddressField('Augur AMM pair', history.market.pair_address, poolItem.chain_id),
		staticField('Augur AMM fee', history.market === undefined || history.market === null ? '—' : percentFromBps(history.market.fee_bps)),
		staticField('Security multiplier', percentFromBps(poolItem.security_multiplier_bps)),
		staticField('Initial priority fee', exactUnit(poolItem.initial_priority_fee_atto_eth_per_gas, 9, 'nanoETH')),
		staticField('Child pools', number(poolItem.child_count)),
	)
	staticCard.append(grid)
	if (history.market?.pair_address) {
		const analyticsLink = document.createElement('a')
		analyticsLink.className = 'secondary compact state-analytics-link'
		analyticsLink.href = operationsHref(`/operations/trading/${encodeURIComponent(history.market.pair_address)}`)
		analyticsLink.textContent = 'Open AMM trading analytics'
		staticCard.append(analyticsLink)
	}
	fragment.append(staticCard)
	$('#state-detail').replaceChildren(fragment)
}
