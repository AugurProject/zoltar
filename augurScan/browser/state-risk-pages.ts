import { annualFeeMillionths, annualFeeText } from './pool-metrics.ts'
import type { EntityHistory, PoolRecord, StateEntity, StateTab, VaultRecord } from './browser-types.ts'
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
	readonly chartNumericValue: StateComponents['chartNumericValue']
	readonly yesNoCheckpoint: (value: unknown) => string
}

export const renderPoolDetailPage = async (deps: StateRiskDeps, poolItem: PoolRecord, suppliedHistory?: EntityHistory): Promise<void> => {
	const { lookup: $, fetchEntityHistory, isCurrent, nativeSymbol, stateHeader, historyCoverageNotice, element, operationsHref, operationsPanel, operationRow, metricCard, number, chartCard, staticField, staticAddressField, chartNumericValue, yesNoCheckpoint } = deps
	const history = suppliedHistory ?? (await fetchEntityHistory('pools', poolItem))
	if (!isCurrent()) return
	const poolNativeSymbol = nativeSymbol(poolItem.chain_id)
	const ammPrices = history.ammPrices ?? []
	const repEthPrices = history.repEthPrices ?? []
	const uniswapRepEthPrices = history.uniswapRepEthPrices ?? []
	const openOracleHistory = history.openOracleHistory ?? []
	const uniswapChart = uniswapPriceChartModel(uniswapRepEthPrices)
	const uniswapLiquidity = uniswapLiquidityChartModel(uniswapRepEthPrices)
	const feeHistory = history.snapshots.map(row => ({ ...row, annual_fee_millionths: annualFeeMillionths(row['current_retention_rate']) }))
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
		metricCard('Settlement collateral', exactUnit(poolItem.settlement_collateral_atto_eth ?? poolItem.initial_settlement_collateral_atto_eth, 18, poolNativeSymbol)),
		metricCard('Capacity ownership', exactUnit(poolItem.total_capacity_ownership_atto_rep, 18, 'REP')),
		metricCard('Claimable vault fees', exactUnit(poolItem.total_claimable_vault_fees_atto_eth, 18, poolNativeSymbol)),
		metricCard('Vaults', number(poolItem.vault_count)),
		metricCard('Annual open-interest fee', annualFeeText(poolItem.current_retention_rate)),
		metricCard('Conditional YES', latestAmmPrice === undefined ? 'No AMM price' : exactUnit(latestAmmPrice.conditional_yes_bps, 2, '%')),
		metricCard('Conditional NO', latestAmmPrice === undefined ? 'No AMM price' : exactUnit(latestAmmPrice.conditional_no_bps, 2, '%')),
		metricCard('REP / ETH', latestRepEthPrice === undefined ? 'No coordinator price' : exactUnit(latestRepEthPrice.rep_per_eth_1e18, 18, 'REP/ETH')),
		metricCard('Latest Uniswap spot', latestUniswapPrice === undefined ? 'No Uniswap price' : exactUnit(latestUniswapPrice.rep_per_eth_1e18, 18, `REP/${latestUniswapPrice.quote_symbol}`), latestUniswapPrice === undefined ? undefined : uniswapPriceProvenance(latestUniswapPrice)),
		metricCard('AMM market', history.market === undefined ? 'Unavailable' : `${number(ammPrices.length)} observations`),
	)
	fragment.append(metrics)
	fragment.append(
		chartCard(
			'Pool accounting history',
			history.snapshots,
			[
				{ key: 'settlement_collateral_atto_eth', label: 'Collateral', unit: poolNativeSymbol },
				{ key: 'total_capacity_ownership_atto_rep', label: 'Capacity ownership', unit: 'REP', className: 'secondary' },
				{ key: 'total_claimable_vault_fees_atto_eth', label: 'Claimable fees', unit: poolNativeSymbol, className: 'tertiary' },
			],
			'Authoritative PoolAccountingCheckpoint results. Collateral and fees are shown in whole ETH; capacity ownership is shown in whole REP.',
			{ zeroBaseline: true },
		),
		chartCard(
			'Fee accrual history',
			history.snapshots,
			[
				{ key: 'fee_index', label: 'Fee index', unit: `${poolNativeSymbol}/REP` },
				{ key: 'unallocated_accrued_fees_atto_eth', label: 'Unallocated accrued fees', unit: poolNativeSymbol },
			],
			'Checkpoint fee accumulator and unallocated fees; balances may fall when fees are claimed.',
			{ zeroBaseline: true },
		),
		chartCard('Annual open-interest fee history', feeHistory, [{ key: 'annual_fee_millionths', label: 'Annual open-interest fee', decimals: 6, unit: '%' }], 'Annualized assuming unchanged retention for 365 days. Actual fees vary with utilization.', {
			sharedRange: [0, 100],
			axisUnit: '%',
		}),
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
			'REP / ETH coordinator price history',
			repEthPrices,
			[
				{
					key: 'rep_per_eth_1e18',
					label: 'REP per ETH',
					unit: 'REP/ETH',
					pointShape: row => (row.event_name === 'RepEthPriceSet' ? 'diamond' : 'circle'),
					pointLabel: row => (row.event_name === 'RepEthPriceSet' ? 'Initialization seed' : 'Accepted settlement'),
				},
			],
			'Coordinator price state. RepEthPriceSet records initialization and does not establish timestamp-based oracle validity; PriceReported points are accepted settlements.',
			{
				legendItems: [{ label: 'Initialization', className: 'initialization' }],
				emptyMessage: 'No REP / ETH coordinator price observations match this view.',
			},
		),
	)
	const currentCard = element('section', 'static-card')
	currentCard.append(element('h4', '', 'Latest available accounting and lifecycle'))
	const currentGrid = element('div', 'static-grid')
	const systemStates = ['Operational', 'Pool forked', 'Fork migration', 'Fork truth auction']
	const currentState = poolItem.current_state ?? {}
	currentGrid.append(
		staticField('System state', currentState.systemState === undefined ? 'No lifecycle event yet' : (systemStates[Number(currentState.systemState)] ?? `State ${currentState.systemState}`)),
		staticField('Awaiting fork continuation', yesNoCheckpoint(currentState.awaitingForkContinuation)),
		staticField('Total REP backing units', currentState.totalRepBackingUnits === undefined ? 'No checkpoint' : exactUnit(chartNumericValue(currentState.totalRepBackingUnits), 18, '')),
		staticField('Share-token supply', currentState.shareTokenSupplyAttoShares === undefined ? 'No checkpoint' : exactUnit(chartNumericValue(currentState.shareTokenSupplyAttoShares), 18, 'shares')),
		staticField('Fee-eligible capacity ownership', exactUnit(poolItem.fee_eligible_capacity_ownership_atto_rep, 18, 'REP')),
		staticField('Unallocated accrued fees', exactUnit(poolItem.unallocated_accrued_fees_atto_eth, 18, poolNativeSymbol)),
		staticField('Annual open-interest fee', annualFeeText(poolItem.current_retention_rate)),
		typeof currentState.escalationGame === 'string' && currentState.escalationGame !== '' ? staticAddressField('Escalation game', currentState.escalationGame, poolItem.chain_id) : staticField('Escalation game', 'Not set'),
	)
	currentCard.append(currentGrid)
	fragment.append(currentCard)
	const staticCard = element('section', 'static-card')
	staticCard.append(element('h4', '', 'Immutable deployment configuration'))
	const grid = element('div', 'static-grid')
	grid.append(
		staticField('Question ID', poolItem.question_id),
		staticAddressField('Parent pool', poolItem.parent_address, poolItem.chain_id),
		staticAddressField('Share token', poolItem.share_token_address, poolItem.chain_id),
		staticAddressField('Price coordinator', poolItem.coordinator_address, poolItem.chain_id),
		history.market === undefined || history.market === null ? staticField('Augur AMM pair', 'Unavailable') : staticAddressField('Augur AMM pair', history.market.pair_address, poolItem.chain_id),
		staticField('Augur AMM fee', history.market === undefined || history.market === null ? '—' : percentFromBps(history.market.fee_bps)),
		staticAddressField('Truth auction', poolItem.truth_auction_address, poolItem.chain_id),
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

export const renderVaultDetailPage = async (deps: StateRiskDeps, vaultItem: VaultRecord, suppliedHistory?: EntityHistory): Promise<void> => {
	const { lookup: $, fetchEntityHistory, isCurrent, nativeSymbol, stateHeader, historyCoverageNotice, element, metricCard, number, chartCard, staticField, staticAddressField } = deps
	const history = suppliedHistory ?? (await fetchEntityHistory('vaults', vaultItem))
	if (!isCurrent()) return
	const vaultNativeSymbol = nativeSymbol(vaultItem.chain_id)
	const fragment = document.createDocumentFragment()
	fragment.append(stateHeader('Security vault', vaultItem.vault_address, `Pool ${vaultItem.pool_address}`, 'Latest available'))
	const riskLink = element('a', 'back-link', 'View vault risk and liquidation history →')
	riskLink.href = deps.operationsHref(`/vault/${vaultItem.pool_address}/${vaultItem.vault_address}?chainId=${vaultItem.chain_id}`)
	fragment.append(riskLink)
	fragment.append(historyCoverageNotice(history, 'vaults', vaultItem))
	const metrics = element('div', 'metric-grid')
	metrics.append(
		metricCard('REP backing units', exactUnit(vaultItem.rep_backing_units, 18, '')),
		metricCard('Capacity ownership', exactUnit(vaultItem.capacity_ownership_atto_rep, 18, 'REP')),
		metricCard('Claimable fees', exactUnit(vaultItem.claimable_fees_atto_eth, 18, vaultNativeSymbol)),
		metricCard('Fee index', exactUnit(vaultItem.fee_index, 18, '')),
	)
	fragment.append(metrics)
	fragment.append(
		chartCard(
			'Vault accounting history',
			history.snapshots,
			[
				{ key: 'rep_backing_units', label: 'REP backing units', unit: 'units' },
				{ key: 'capacity_ownership_atto_rep', label: 'Capacity ownership', unit: 'REP', className: 'secondary' },
				{ key: 'claimable_fees_atto_eth', label: 'Claimable fees', unit: vaultNativeSymbol, className: 'tertiary' },
			],
			'VaultAccountingCheckpoint history. REP backing units are protocol accounting units; capacity ownership and fees are shown in whole REP and ETH.',
			{ zeroBaseline: true },
		),
	)
	const staticCard = element('section', 'static-card')
	staticCard.append(element('h4', '', 'Identity and complete current checkpoint'))
	const grid = element('div', 'static-grid')
	grid.append(
		staticAddressField('Vault address', vaultItem.vault_address, vaultItem.chain_id),
		staticAddressField('Pool address', vaultItem.pool_address, vaultItem.chain_id),
		staticField('Question', vaultItem.question_title),
		staticField('Last block', `#${number(vaultItem.block_number)}`),
		staticField('Fee remainder (1e18 denominator)', vaultItem.vault_fee_remainder),
		staticField('Resulting pool-held REP backing units', exactUnit(vaultItem.resulting_total_rep_backing_units, 18, '')),
		staticField('Resulting active obligation units', vaultItem.resulting_fee_eligible_capacity_ownership_atto_rep),
		staticField('Fee index', exactUnit(vaultItem.fee_index, 18, '')),
	)
	staticCard.append(grid)
	fragment.append(staticCard)
	$('#state-detail').replaceChildren(fragment)
}
