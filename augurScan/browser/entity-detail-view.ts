import { $, element, number, counted, operationRow, operationsPanel, stateHeader, historyBlockRangeLabel, yesNoCheckpoint, questionStatus } from './view-presentation.ts'
import { exactUnit, metricCard, chartCard, staticField, chartNumericValue } from './chart-view.ts'
import { short, shortIdentifier } from './identifier-format.ts'
import { type EntityHistory, type PoolRecord, type QuestionRecord, type SelectEntityOptions, type StateCatalog, type StateEntity, type StateTab, type UniverseRecord, type VaultRecord } from './browser-types.ts'
import { isRecord } from './api-validation.ts'
import { entityHistoryContinuationPresentation, isCurrentCanonicalGeneration, summarizeHistoryCollections } from './live-update.ts'
import { uniswapLiquidityChartModel, uniswapPriceChartModel, uniswapPriceProvenance } from './chart-values.ts'

type EntityDetailViewContext = {
	entityHistoryCollections: (history: EntityHistory) => Readonly<Record<'forks' | 'pools' | 'snapshots' | 'events' | 'ammPrices' | 'repEthPrices' | 'uniswapRepEthPrices' | 'openOracleHistory', readonly unknown[]>>
	entityHistoryCollectionKeys: readonly ['snapshots', 'events', 'ammPrices', 'repEthPrices', 'uniswapRepEthPrices', 'openOracleHistory', 'pools', 'forks']
	historyCoverageHeadline: (moreAvailable: boolean, partiallyIndexed: boolean) => 'More history available' | 'Requested range is partially indexed' | 'History loaded'
	selectEntity: (item: StateEntity, options?: SelectEntityOptions) => Promise<boolean>
	isDemo: boolean
	pageUrl: URL
	demoStateHistoryAutoLoadConsumed: boolean
	fetchEntityHistory: (type: StateTab, item: StateEntity, throughOffset?: number) => Promise<EntityHistory>
	stateDetailRequestVersion: number
	canonicalDataGeneration: number
	nativeSymbol: (chainId?: string) => 'ETH' | 'SepoliaETH'
	staticAddressField: (label: string, address: string | null | undefined, chainId: string) => HTMLDivElement
	operationsHref: (pathname: string) => string
	stateData: StateCatalog | undefined
}

export function createEntityDetailView(context: EntityDetailViewContext) {
	const historySeriesLabel = (key: string): string => {
		if (key === 'snapshots') return 'checkpoints'
		if (key === 'events') return 'lifecycle'
		if (key === 'ammPrices') return 'AMM prices'
		if (key === 'repEthPrices') return 'coordinator prices'
		if (key === 'uniswapRepEthPrices') return 'Uniswap prices'
		if (key === 'openOracleHistory') return 'OpenOracle'
		return key
	}

	const historyCoverageNotice = (history: EntityHistory, type: StateTab, item: StateEntity): HTMLElement => {
		const notice = element('section', `history-coverage${history.coverage?.complete === false ? ' incomplete' : ''}`)
		const coverage = history.coverage
		if (coverage?.complete === true && coverage.rangeCovered !== false && coverage.nextCursor === undefined) {
			if ((history.loadedOffset ?? 0) > 0) {
				notice.className = 'sr-only state-history-complete'
				notice.tabIndex = -1
				notice.setAttribute('role', 'status')
				notice.textContent = 'History complete'
			} else notice.hidden = true
			return notice
		}
		if (coverage === undefined) {
			notice.append(element('strong', '', 'History coverage unavailable'), element('span', '', 'This response did not include an indexed range boundary.'))
			return notice
		}
		const collections = context.entityHistoryCollections(history)
		const recordCollections = Object.fromEntries(context.entityHistoryCollectionKeys.map(key => [key, collections[key].filter(isRecord)]))
		const summary = summarizeHistoryCollections(recordCollections, context.entityHistoryCollectionKeys)
		const loadedRange = historyBlockRangeLabel(summary.oldestBlock, summary.newestBlock, 'No block-numbered records loaded')
		const seriesCounts = Object.entries(coverage.series)
			.map(([key, count]) => `${historySeriesLabel(key)} ${number(count)}`)
			.join(' · ')
		const indexedRange = `#${number(coverage.indexedFromBlock)}–${coverage.indexedThroughBlock === undefined ? 'pending' : `#${number(coverage.indexedThroughBlock)}`}`
		const requestedRange = `#${number(coverage.requestedFromBlock)}–#${number(coverage.requestedToBlock)}`
		notice.append(
			element('strong', '', context.historyCoverageHeadline(coverage.nextCursor !== undefined, coverage.rangeCovered === false)),
			element('span', '', `${loadedRange} · ${seriesCounts || 'no historical series'}. Requested ${requestedRange}; scanner coverage ${indexedRange}.${coverage.rangeCovered === false ? ' Narrow the requested range or backfill the missing blocks.' : ''}`),
		)
		if (coverage.nextCursor !== undefined) {
			const pagination = element('div', 'history-coverage-pagination')
			const showOlder = element('button', 'secondary compact state-history-more', 'Show older history')
			showOlder.type = 'button'
			showOlder.setAttribute('aria-label', `Show older ${type.slice(0, -1)} history`)
			const status = element('p', 'state-history-status')
			status.setAttribute('role', 'status')
			status.setAttribute('aria-live', 'polite')
			showOlder.addEventListener('click', async () => {
				const scrollY = window.scrollY
				const pendingPresentation = entityHistoryContinuationPresentation('pending')
				showOlder.disabled = true
				showOlder.setAttribute('aria-busy', 'true')
				showOlder.textContent = pendingPresentation.buttonLabel
				status.textContent = pendingPresentation.statusText
				status.classList.toggle('sr-only', pendingPresentation.statusVisuallyHidden)
				const loaded = await context.selectEntity(item, {
					preserveDetail: true,
					pagination: true,
					historyTargetOffset: (history.loadedOffset ?? 0) + coverage.limit,
				})
				if (loaded) {
					const nextControl = $('#state-detail').querySelector<HTMLElement>('.state-history-more, .state-history-complete')
					nextControl?.focus({ preventScroll: true })
					window.scrollTo({ top: scrollY, behavior: 'auto' })
				} else if (showOlder.isConnected) {
					const errorPresentation = entityHistoryContinuationPresentation('error')
					showOlder.disabled = false
					showOlder.removeAttribute('aria-busy')
					showOlder.textContent = errorPresentation.buttonLabel
					status.textContent = errorPresentation.statusText
					status.classList.toggle('sr-only', errorPresentation.statusVisuallyHidden)
					showOlder.focus({ preventScroll: true })
				}
			})
			pagination.append(showOlder, status)
			notice.append(pagination)
			if (context.isDemo && context.pageUrl.searchParams.get('stateHistoryAutoLoad') === '1' && !context.demoStateHistoryAutoLoadConsumed) {
				context.demoStateHistoryAutoLoadConsumed = true
				window.setTimeout(() => {
					if (showOlder.isConnected) {
						showOlder.focus({ preventScroll: true })
						showOlder.click()
					}
				}, 0)
			}
		} else if ((history.loadedOffset ?? 0) > 0) {
			notice.classList.add('state-history-complete')
			notice.tabIndex = -1
			notice.setAttribute('role', 'status')
			notice.setAttribute('aria-live', 'polite')
		}
		return notice
	}

	const renderPoolDetail = async (poolItem: PoolRecord, requestVersion: number, canonicalGeneration: number, suppliedHistory?: EntityHistory): Promise<void> => {
		const history = suppliedHistory ?? (await context.fetchEntityHistory('pools', poolItem))
		if (requestVersion !== context.stateDetailRequestVersion || !isCurrentCanonicalGeneration(canonicalGeneration, context.canonicalDataGeneration)) return
		const poolNativeSymbol = context.nativeSymbol(poolItem.chain_id)
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
			metricCard('Settlement collateral', exactUnit(poolItem.settlement_collateral_atto_eth ?? poolItem.initial_settlement_collateral_atto_eth, 18, poolNativeSymbol, 2)),
			metricCard('Capacity ownership', exactUnit(poolItem.total_capacity_ownership_atto_rep, 18, 'REP', 2)),
			metricCard('Claimable vault fees', exactUnit(poolItem.total_claimable_vault_fees_atto_eth, 18, poolNativeSymbol, 3)),
			metricCard('Vaults', number(poolItem.vault_count)),
			metricCard('Conditional YES', latestAmmPrice === undefined ? 'No AMM price' : exactUnit(latestAmmPrice.conditional_yes_bps, 2, '%', 2)),
			metricCard('Conditional NO', latestAmmPrice === undefined ? 'No AMM price' : exactUnit(latestAmmPrice.conditional_no_bps, 2, '%', 2)),
			metricCard('REP / ETH', latestRepEthPrice === undefined ? 'No coordinator price' : exactUnit(latestRepEthPrice.rep_per_eth_1e18, 18, 'REP/ETH', 4)),
			metricCard('Latest Uniswap spot', latestUniswapPrice === undefined ? 'No Uniswap price' : exactUnit(latestUniswapPrice.rep_per_eth_1e18, 18, `REP/${latestUniswapPrice.quote_symbol}`, 4), latestUniswapPrice === undefined ? undefined : uniswapPriceProvenance(latestUniswapPrice)),
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
				'Authoritative PoolAccountingCheckpoint results. Collateral and fees use attoETH; capacity ownership uses attoREP.',
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
				'V2 points preserve the exact reserve product. V3 and V4 points preserve the exact active-liquidity integer emitted by Swap. Each venue is raw protocol evidence and is not silently normalized across token decimal systems.',
				{ emptyMessage: 'No Uniswap liquidity observations match this view.' },
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
			staticField('Total REP backing units', currentState.totalRepBackingUnits === undefined ? 'No checkpoint' : exactUnit(chartNumericValue(currentState.totalRepBackingUnits), 18, '', 3)),
			staticField('Share-token supply', currentState.shareTokenSupplyAttoShares === undefined ? 'No checkpoint' : exactUnit(chartNumericValue(currentState.shareTokenSupplyAttoShares), 18, 'shares', 3)),
			staticField('Fee-eligible capacity ownership', exactUnit(poolItem.fee_eligible_capacity_ownership_atto_rep, 18, 'REP', 3)),
			staticField('Unallocated accrued fees', exactUnit(poolItem.unallocated_accrued_fees_atto_eth, 18, poolNativeSymbol, 5)),
			staticField('Current retention rate', exactUnit(poolItem.current_retention_rate, 18, '', 9)),
			typeof currentState.escalationGame === 'string' && currentState.escalationGame !== '' ? context.staticAddressField('Escalation game', currentState.escalationGame, poolItem.chain_id) : staticField('Escalation game', 'Not set'),
		)
		currentCard.append(currentGrid)
		fragment.append(currentCard)
		const staticCard = element('section', 'static-card')
		staticCard.append(element('h4', '', 'Immutable deployment configuration'))
		const grid = element('div', 'static-grid')
		grid.append(
			staticField('Question ID', poolItem.question_id),
			context.staticAddressField('Parent pool', poolItem.parent_address, poolItem.chain_id),
			context.staticAddressField('Share token', poolItem.share_token_address, poolItem.chain_id),
			context.staticAddressField('Price coordinator', poolItem.coordinator_address, poolItem.chain_id),
			history.market === undefined || history.market === null ? staticField('Augur AMM pair', 'Unavailable') : context.staticAddressField('Augur AMM pair', history.market.pair_address, poolItem.chain_id),
			staticField('Augur AMM fee', history.market === undefined || history.market === null ? '—' : `${Number(history.market.fee_bps) / 100}%`),
			context.staticAddressField('Truth auction', poolItem.truth_auction_address, poolItem.chain_id),
			staticField('Security multiplier', `${Number(poolItem.security_multiplier_bps) / 100}%`),
			staticField('Initial priority fee', exactUnit(poolItem.initial_priority_fee_atto_eth_per_gas, 9, 'nanoETH', 2)),
			staticField('Child pools', number(poolItem.child_count)),
		)
		staticCard.append(grid)
		if (history.market?.pair_address) {
			const analyticsLink = document.createElement('a')
			analyticsLink.className = 'secondary compact state-analytics-link'
			analyticsLink.href = context.operationsHref(`/operations/trading/${encodeURIComponent(history.market.pair_address)}`)
			analyticsLink.textContent = 'Open AMM trading analytics'
			staticCard.append(analyticsLink)
		}
		fragment.append(staticCard)
		$('#state-detail').replaceChildren(fragment)
	}

	const renderVaultDetail = async (vaultItem: VaultRecord, requestVersion: number, canonicalGeneration: number, suppliedHistory?: EntityHistory): Promise<void> => {
		const history = suppliedHistory ?? (await context.fetchEntityHistory('vaults', vaultItem))
		if (requestVersion !== context.stateDetailRequestVersion || !isCurrentCanonicalGeneration(canonicalGeneration, context.canonicalDataGeneration)) return
		const vaultNativeSymbol = context.nativeSymbol(vaultItem.chain_id)
		const fragment = document.createDocumentFragment()
		fragment.append(stateHeader('Security vault', vaultItem.vault_address, `Pool ${vaultItem.pool_address}`, 'Latest available'))
		fragment.append(historyCoverageNotice(history, 'vaults', vaultItem))
		const metrics = element('div', 'metric-grid')
		metrics.append(
			metricCard('REP backing units', exactUnit(vaultItem.rep_backing_units, 18, '', 2)),
			metricCard('Capacity ownership', exactUnit(vaultItem.capacity_ownership_atto_rep, 18, 'REP', 2)),
			metricCard('Claimable fees', exactUnit(vaultItem.claimable_fees_atto_eth, 18, vaultNativeSymbol, 4)),
			metricCard('Fee index', exactUnit(vaultItem.fee_index, 18, '', 5)),
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
				'VaultAccountingCheckpoint history. REP backing units are protocol accounting units; capacity ownership uses attoREP and fees use attoETH.',
			),
		)
		const staticCard = element('section', 'static-card')
		staticCard.append(element('h4', '', 'Identity and complete current checkpoint'))
		const grid = element('div', 'static-grid')
		grid.append(
			context.staticAddressField('Vault address', vaultItem.vault_address, vaultItem.chain_id),
			context.staticAddressField('Pool address', vaultItem.pool_address, vaultItem.chain_id),
			staticField('Question', vaultItem.question_title),
			staticField('Last block', `#${number(vaultItem.block_number)}`),
			staticField('Fee remainder (1e18 denominator)', vaultItem.vault_fee_remainder),
			staticField('Resulting pool-held REP backing units', exactUnit(vaultItem.resulting_total_rep_backing_units, 18, '', 3)),
			staticField('Resulting fee-eligible capacity', exactUnit(vaultItem.resulting_fee_eligible_capacity_ownership_atto_rep, 18, 'REP', 3)),
			staticField('Fee index', exactUnit(vaultItem.fee_index, 18, '', 8)),
		)
		staticCard.append(grid)
		fragment.append(staticCard)
		$('#state-detail').replaceChildren(fragment)
	}

	const renderQuestionDetail = async (question: QuestionRecord, requestVersion: number, canonicalGeneration: number, suppliedHistory?: EntityHistory): Promise<void> => {
		const history = suppliedHistory ?? (await context.fetchEntityHistory('questions', question))
		if (requestVersion !== context.stateDetailRequestVersion || !isCurrentCanonicalGeneration(canonicalGeneration, context.canonicalDataGeneration)) return
		const kind = question.outcome_options.length === 0 ? 'Scalar' : 'Categorical'
		const fragment = document.createDocumentFragment()
		fragment.append(stateHeader('Immutable question', question.title, `ID ${short(question.question_id, 10, 8)}`, `${kind} · ${questionStatus(question)}`))
		fragment.append(historyCoverageNotice(history, 'questions', question))
		const metrics = element('div', 'metric-grid')
		metrics.append(metricCard('Status', questionStatus(question)), metricCard('Linked pools', number(question.pool_count)), metricCard('Universe forks', number(question.fork_count)), metricCard('Answer type', kind))
		fragment.append(metrics)
		const definition = element('section', 'static-card')
		definition.append(element('h4', '', 'Question definition — immutable after creation'), element('p', 'question-description', question.description))
		const outcomes = element('div', 'outcomes')
		const labels = question.outcome_options.length > 0 ? ['Invalid', ...question.outcome_options] : [`${exactUnit(question.display_value_min, 18, question.answer_unit)} → ${exactUnit(question.display_value_max, 18, question.answer_unit)}`, `${number(question.num_ticks)} ticks`]
		for (const label of labels) outcomes.append(element('span', 'outcome', label))
		definition.append(outcomes)
		const timeline = element('div', 'timeline')
		for (const [label, value] of [
			['Created', question.created_timestamp],
			['Starts', question.start_time],
			['Ends', question.end_time],
		] as const)
			timeline.append(element('div', 'timeline-step', `${label} · ${new Date(value).toLocaleDateString('en-GB')}`))
		definition.append(timeline)
		fragment.append(definition)
		const usage = element('section', 'static-card')
		usage.append(element('h4', '', 'Protocol usage'))
		const grid = element('div', 'static-grid')
		grid.append(staticField('Pool deployments', String(history.pools.length)), staticField('Universe forks using this question', String(history.forks.length)), staticField('Question ID', question.question_id), staticField('Created block evidence', `#${number(question.block_number)}`))
		usage.append(grid, element('p', 'data-note', 'Question metadata has no mutable onchain fields. Pool deployments and universe forks are tracked separately as historical usage.'))
		fragment.append(usage)
		$('#state-detail').replaceChildren(fragment)
	}

	const renderLineage = (universes: UniverseRecord[], selected: UniverseRecord): SVGSVGElement => {
		const byKey = new Map(universes.map(universe => [`${universe.chain_id}:${universe.universe_id}`, universe]))
		const depth = (universe: UniverseRecord, seen = new Set<string>()): number => {
			const key = `${universe.chain_id}:${universe.universe_id}`
			if (seen.has(key) || universe.parent_universe_id === universe.universe_id) return 0
			seen.add(key)
			const parent = byKey.get(`${universe.chain_id}:${universe.parent_universe_id}`)
			return parent === undefined ? 0 : depth(parent, seen) + 1
		}
		const positions = new Map<string, { x: number; y: number }>()
		const levels = new Map<number, UniverseRecord[]>()
		for (const universe of universes) {
			const level = depth(universe)
			const members = levels.get(level) ?? []
			members.push(universe)
			levels.set(level, members)
		}
		const maximumLevel = Math.max(0, ...levels.keys())
		const maximumMembers = Math.max(1, ...[...levels.values()].map(members => members.length))
		const nodeWidth = 210
		const columnGap = 285
		const rowGap = 70
		const width = 60 + maximumLevel * columnGap + nodeWidth
		const height = 40 + maximumMembers * rowGap
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
		svg.setAttribute('class', 'lineage-graph')
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
		svg.setAttribute('width', String(width))
		svg.setAttribute('height', String(height))
		svg.setAttribute('role', 'img')
		svg.setAttribute('aria-label', 'Zoltar universe parent and child relationships')
		for (const [level, members] of levels)
			members.forEach((universe, index) => {
				positions.set(`${universe.chain_id}:${universe.universe_id}`, { x: 30 + level * columnGap, y: 20 + index * rowGap })
			})
		for (const universe of universes) {
			if (universe.parent_universe_id === universe.universe_id) continue
			const from = positions.get(`${universe.chain_id}:${universe.parent_universe_id}`)
			const to = positions.get(`${universe.chain_id}:${universe.universe_id}`)
			if (from === undefined || to === undefined) continue
			const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
			line.setAttribute('class', 'lineage-link')
			line.setAttribute('x1', String(from.x + nodeWidth))
			line.setAttribute('y1', String(from.y + 25))
			line.setAttribute('x2', String(to.x))
			line.setAttribute('y2', String(to.y + 25))
			svg.append(line)
		}
		for (const universe of universes) {
			const position = positions.get(`${universe.chain_id}:${universe.universe_id}`)
			if (position === undefined) continue
			const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
			group.setAttribute('class', `lineage-node${universe === selected ? ' selected' : ''}`)
			group.setAttribute('transform', `translate(${position.x} ${position.y})`)
			const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
			rect.setAttribute('width', String(nodeWidth))
			rect.setAttribute('height', '50')
			rect.setAttribute('rx', '7')
			const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
			label.setAttribute('x', '10')
			label.setAttribute('y', '20')
			label.textContent = universe.universe_id === '0' ? 'Genesis universe' : `Universe ${shortIdentifier(universe.universe_id, 7, 5)}`
			const meta = document.createElementNS('http://www.w3.org/2000/svg', 'text')
			meta.setAttribute('class', 'node-meta')
			meta.setAttribute('x', '10')
			meta.setAttribute('y', '37')
			meta.textContent = `${counted(universe.pool_count, 'pool')} · outcome ${universe.forking_outcome_index}`
			group.append(rect, label, meta)
			svg.append(group)
		}
		return svg
	}

	const renderUniverseDetail = async (universe: UniverseRecord, requestVersion: number, canonicalGeneration: number, suppliedHistory?: EntityHistory): Promise<void> => {
		const history = suppliedHistory ?? (await context.fetchEntityHistory('universes', universe))
		if (requestVersion !== context.stateDetailRequestVersion || !isCurrentCanonicalGeneration(canonicalGeneration, context.canonicalDataGeneration)) return
		const fragment = document.createDocumentFragment()
		const title = universe.universe_id === '0' ? 'Genesis universe' : `Universe ${shortIdentifier(universe.universe_id, 12, 8)}`
		fragment.append(stateHeader('Zoltar universe', title, `Outcome ${universe.forking_outcome_index} · parent ${shortIdentifier(universe.parent_universe_id, 8, 6)}`, universe.active_fork_time ? 'Forked' : 'Active'))
		fragment.append(historyCoverageNotice(history, 'universes', universe))
		const metrics = element('div', 'metric-grid')
		metrics.append(
			metricCard('Theoretical REP supply', exactUnit(universe.theoretical_supply_atto_rep, 18, 'REP', 1)),
			metricCard('Child universes', number(universe.child_count)),
			metricCard('Security pools', number(universe.pool_count)),
			metricCard('Fork time', universe.active_fork_time ? new Date(universe.active_fork_time).toLocaleDateString('en-GB') : 'Not forked'),
		)
		fragment.append(metrics)
		fragment.append(
			chartCard(
				'Theoretical REP supply history',
				history.events.filter(event => event['theoretical_supply_atto_rep'] !== null),
				[{ key: 'theoretical_supply_atto_rep', label: 'Theoretical REP', unit: 'REP' }],
				'Supply changes are recorded from initialization, fork, burn, and migration events.',
			),
		)
		const lineage = element('section', 'lineage-card')
		const heading = element('div', 'chart-heading')
		const catalog = context.stateData
		if (catalog === undefined) throw new Error('System state catalog is unavailable')
		heading.append(element('h4', '', 'Zoltar universes'), element('span', 'data-note', counted(catalog.universes.length, 'universe')))
		const scroll = element('div', 'lineage-scroll')
		scroll.append(renderLineage(catalog.universes, universe))
		lineage.append(heading, scroll)
		fragment.append(lineage)
		const identity = element('section', 'static-card')
		identity.append(element('h4', '', 'Immutable universe identity'))
		const grid = element('div', 'static-grid')
		grid.append(
			staticField('Universe ID', universe.universe_id),
			staticField('Parent universe', universe.parent_universe_id),
			staticField('Forking outcome', universe.forking_outcome_index),
			context.staticAddressField('REP token', universe.reputation_token_address, universe.chain_id),
			staticField('Fork question', universe.active_fork_question_id),
			staticField('Fork time', universe.active_fork_time ? new Date(universe.active_fork_time).toISOString() : 'Not forked'),
			context.staticAddressField('Fork initiator', universe.forker_address, universe.chain_id),
			staticField('Fork threshold', exactUnit(universe.fork_threshold_atto_rep, 18, 'REP', 3)),
			staticField('Fork initiator migration balance at fork', exactUnit(universe.migration_rep_balance_atto_rep, 18, 'REP', 3)),
		)
		identity.append(grid)
		fragment.append(identity)
		$('#state-detail').replaceChildren(fragment)
	}
	return { renderPoolDetail, renderVaultDetail, renderQuestionDetail, renderUniverseDetail }
}
