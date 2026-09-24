import type { EntityHistory, QuestionRecord, StateCatalog, StateEntity, StateTab, UniverseRecord } from './browser-types.ts'
import { exactUnit } from './format.ts'
import { short, shortIdentifier } from './identifier-format.ts'
import { questionDateLabel, questionStatus } from './question-time.ts'
import type { createStateComponents } from './state-components.ts'

type StateComponents = ReturnType<typeof createStateComponents>

export interface StateEntityDeps {
	readonly lookup: (selector: string) => HTMLElement
	readonly fetchEntityHistory: (type: StateTab, item: StateEntity, throughOffset?: number) => Promise<EntityHistory>
	readonly isCurrent: () => boolean
	readonly stateHeader: StateComponents['stateHeader']
	readonly pageUrl: URL
	readonly isDemo: boolean
	readonly historyCoverageNotice: (history: EntityHistory, type: StateTab, item: StateEntity) => HTMLElement
	readonly element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	readonly metricCard: StateComponents['metricCard']
	readonly number: (value: string | number | bigint | null | undefined) => string
	readonly staticField: StateComponents['staticField']
	readonly chartCard: StateComponents['chartCard']
	readonly stateData: StateCatalog | undefined
	readonly counted: (value: string | number | bigint | null | undefined, singular: string, plural?: string) => string
	readonly staticAddressField: StateComponents['staticAddressField']
}

export const renderQuestionDetailPage = async (deps: StateEntityDeps, question: QuestionRecord, suppliedHistory?: EntityHistory): Promise<void> => {
	const { lookup: $, fetchEntityHistory, isCurrent, stateHeader, pageUrl, isDemo, historyCoverageNotice, element, metricCard, number, staticField } = deps
	const history = suppliedHistory ?? (await fetchEntityHistory('questions', question))
	if (!isCurrent()) return
	const kind = question.outcome_options.length === 0 ? 'Scalar' : 'Categorical'
	const fragment = document.createDocumentFragment()
	fragment.append(stateHeader('Immutable question', question.title, `ID ${short(question.question_id, 10, 8)}`, `${kind} · ${questionStatus(question)}`))
	const canonicalQuestionRoute = location.pathname.startsWith('/question/')
	const questionTab = pageUrl.searchParams.get('tab') === 'usage' ? 'usage' : 'overview'
	if (canonicalQuestionRoute) {
		const tabs = element('nav', 'entity-detail-tabs')
		tabs.setAttribute('aria-label', 'Question sections')
		for (const [key, label] of [
			['overview', 'Overview'],
			['usage', 'Usage'],
		] as const) {
			const target = new URL(location.href)
			if (key === 'overview') target.searchParams.delete('tab')
			else target.searchParams.set('tab', key)
			const link = element('a', '', label)
			link.href = `${target.pathname}${target.search}`
			if (key === questionTab) link.setAttribute('aria-current', 'page')
			tabs.append(link)
		}
		fragment.append(tabs)
	}
	if (location.pathname === '/system') {
		const canonicalQuestion = element('a', 'back-link', 'Open question page →')
		canonicalQuestion.href = `/question/${question.question_id}?chainId=${question.chain_id}${isDemo ? '&demo=1' : ''}`
		fragment.append(canonicalQuestion)
	}
	if (!canonicalQuestionRoute || questionTab === 'usage') fragment.append(historyCoverageNotice(history, 'questions', question))
	const metrics = element('div', 'metric-grid')
	metrics.append(metricCard('Status', questionStatus(question)), metricCard('Linked pools', number(question.pool_count)), metricCard('Universe forks', number(question.fork_count)), metricCard('Answer type', kind))
	if (!canonicalQuestionRoute || questionTab === 'overview') fragment.append(metrics)
	const definition = element('section', 'static-card')
	definition.append(element('h4', '', 'Question definition'), element('p', 'question-description', question.description))
	const outcomes = element('div', 'outcomes')
	const labels = question.outcome_options.length > 0 ? ['Invalid', ...question.outcome_options] : [`${exactUnit(question.display_value_min, 18, question.answer_unit)} → ${exactUnit(question.display_value_max, 18, question.answer_unit)}`, `${number(question.num_ticks)} ticks`]
	for (const label of labels) outcomes.append(element('span', 'outcome', label))
	definition.append(outcomes)
	const timeline = element('div', 'timeline')
	for (const [label, value] of [
		['Created', `${new Date(question.created_timestamp).toLocaleDateString('en-GB', { timeZone: 'UTC' })} UTC`],
		['Starts', questionDateLabel(question.start_time)],
		['Ends', questionDateLabel(question.end_time)],
	] as const)
		timeline.append(element('div', 'timeline-step', `${label} · ${value}`))
	definition.append(timeline)
	if (!canonicalQuestionRoute || questionTab === 'overview') fragment.append(definition)
	const usage = element('section', 'static-card')
	usage.append(element('h4', '', 'Protocol usage'))
	const grid = element('div', 'static-grid')
	grid.append(staticField('Pool deployments', number(question.pool_count)), staticField('Universe forks using this question', number(question.fork_count)), staticField('Question ID', question.question_id), staticField('Created block evidence', `#${number(question.block_number)}`))
	usage.append(grid)
	if (!canonicalQuestionRoute || questionTab === 'usage') fragment.append(usage)
	$('#state-detail').replaceChildren(fragment)
}

const renderLineage = (counted: StateEntityDeps['counted'], universes: UniverseRecord[], selected: UniverseRecord): SVGSVGElement => {
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

export const renderUniverseDetailPage = async (deps: StateEntityDeps, universe: UniverseRecord, suppliedHistory?: EntityHistory): Promise<void> => {
	const { lookup: $, fetchEntityHistory, isCurrent, stateHeader, historyCoverageNotice, element, metricCard, number, staticField, chartCard, stateData, counted, staticAddressField } = deps
	const history = suppliedHistory ?? (await fetchEntityHistory('universes', universe))
	if (!isCurrent()) return
	const fragment = document.createDocumentFragment()
	const title = universe.universe_id === '0' ? 'Genesis universe' : `Universe ${shortIdentifier(universe.universe_id, 12, 8)}`
	fragment.append(stateHeader('Zoltar universe', title, `Outcome ${universe.forking_outcome_index} · parent ${shortIdentifier(universe.parent_universe_id, 8, 6)}`, universe.active_fork_time ? 'Forked' : 'Active'))
	fragment.append(historyCoverageNotice(history, 'universes', universe))
	const metrics = element('div', 'metric-grid')
	metrics.append(
		metricCard('Theoretical REP supply', exactUnit(universe.theoretical_supply_atto_rep, 18, 'REP')),
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
	const catalog = stateData
	if (catalog === undefined) throw new Error('System state catalog is unavailable')
	heading.append(element('h4', '', 'Zoltar universes'), element('span', 'data-note', counted(catalog.universes.length, 'universe')))
	const scroll = element('div', 'lineage-scroll')
	scroll.append(renderLineage(counted, catalog.universes, universe))
	lineage.append(heading, scroll)
	fragment.append(lineage)
	const identity = element('section', 'static-card')
	identity.append(element('h4', '', 'Immutable universe identity'))
	const grid = element('div', 'static-grid')
	grid.append(
		staticField('Universe ID', universe.universe_id),
		staticField('Parent universe', universe.parent_universe_id),
		staticField('Forking outcome', universe.forking_outcome_index),
		staticAddressField('REP token', universe.reputation_token_address, universe.chain_id),
		staticField('Fork question', universe.active_fork_question_id),
		staticField('Fork time', universe.active_fork_time ? new Date(universe.active_fork_time).toISOString() : 'Not forked'),
		staticAddressField('Fork initiator', universe.forker_address, universe.chain_id),
		staticField('Fork threshold', exactUnit(universe.fork_threshold_atto_rep, 18, 'REP')),
		staticField('Fork initiator migration balance at fork', exactUnit(universe.migration_rep_balance_atto_rep, 18, 'REP')),
	)
	identity.append(grid)
	fragment.append(identity)
	$('#state-detail').replaceChildren(fragment)
}
