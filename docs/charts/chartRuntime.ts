import { areaY, barX, dot, lineY, plot, ruleX, ruleY, text, type RenderFunction } from '@observablehq/plot'
import { calculateAuctionModel, calculateCollateralRepairModel, calculateEscalationDepositModel, calculateOracleSecurityModel, calculateResolutionModel, normalizedEscalationCost } from './chartModels'

declare function require(path: './diagramSpecs.json'): unknown

const diagramSpecsSource = require('./diagramSpecs.json')

type ChartNode = {
	attributes?: Record<string, string>
	children?: ChartNode[]
	tag?: string
	text?: string
}

type ChartSpec = {
	ariaDescription: string
	ariaLabel: string
	height: number
	nodes: ChartNode[]
	width: number
}

const svgNamespace = 'http://www.w3.org/2000/svg'
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseChartNode(value: unknown): ChartNode {
	if (!isRecord(value)) {
		throw new Error('Plot diagram node must be an object')
	}
	const text = value['text']
	if (typeof text === 'string') {
		return { text }
	}
	const tag = value['tag']
	if (typeof tag !== 'string' || tag.length === 0) {
		throw new Error('Plot diagram node is missing a tag')
	}
	const rawAttributes = value['attributes']
	const attributes: Record<string, string> = {}
	if (rawAttributes !== undefined) {
		if (!isRecord(rawAttributes)) {
			throw new Error(`Plot diagram ${tag} attributes must be an object`)
		}
		for (const [name, attributeValue] of Object.entries(rawAttributes)) {
			if (typeof attributeValue !== 'string') {
				throw new Error(`Plot diagram ${tag} attribute ${name} must be a string`)
			}
			attributes[name] = attributeValue
		}
	}
	const rawChildren = value['children']
	let children: ChartNode[] = []
	if (rawChildren !== undefined) {
		if (!Array.isArray(rawChildren)) {
			throw new Error(`Plot diagram ${tag} children must be an array`)
		}
		children = rawChildren.map(parseChartNode)
	}
	return {
		...(Object.keys(attributes).length === 0 ? {} : { attributes }),
		...(children.length === 0 ? {} : { children }),
		tag,
	}
}

function parseChartSpec(value: unknown, chartId: string): ChartSpec {
	if (!isRecord(value)) {
		throw new Error(`Plot chart ${chartId} specification must be an object`)
	}
	const { ariaDescription, ariaLabel, height, nodes, width } = value
	if (typeof ariaDescription !== 'string' || typeof ariaLabel !== 'string') {
		throw new Error(`Plot chart ${chartId} needs accessible text`)
	}
	if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
		throw new Error(`Plot chart ${chartId} needs positive dimensions`)
	}
	if (!Array.isArray(nodes)) {
		throw new Error(`Plot chart ${chartId} nodes must be an array`)
	}
	return { ariaDescription, ariaLabel, height, nodes: nodes.map(parseChartNode), width }
}

if (!isRecord(diagramSpecsSource)) {
	throw new Error('Plot diagram specifications must be an object')
}
const specs = Object.fromEntries(Object.entries(diagramSpecsSource).map(([chartId, value]) => [chartId, parseChartSpec(value, chartId)]))

function createSvgNode(node: ChartNode): Node {
	if (node.text !== undefined) {
		return document.createTextNode(node.text)
	}
	if (node.tag === undefined) {
		throw new Error('Plot diagram node is missing a tag')
	}

	const element = document.createElementNS(svgNamespace, node.tag)
	for (const [name, value] of Object.entries(node.attributes ?? {})) {
		element.setAttribute(name, value)
	}
	for (const child of node.children ?? []) {
		element.append(createSvgNode(child))
	}
	return element
}

function narrativeMark(spec: ChartSpec): RenderFunction {
	return () => {
		const group = document.createElementNS(svgNamespace, 'g')
		group.classList.add('plot-narrative-mark')
		for (const node of spec.nodes) {
			group.append(createSvgNode(node))
		}
		return group
	}
}

function narrativeChart(spec: ChartSpec): SVGSVGElement {
	return plot({
		ariaDescription: spec.ariaDescription,
		ariaLabel: spec.ariaLabel,
		height: spec.height,
		margin: 0,
		marks: [narrativeMark(spec)],
		style: {
			background: 'transparent',
			color: 'currentColor',
			overflow: 'visible',
		},
		width: spec.width,
	}) as SVGSVGElement
}

function readInput(container: Element | null, name: string, fallback = 0): number {
	const input = container?.querySelector<HTMLInputElement>(`[data-example-input="${name}"]`)
	const value = Number(input?.value)
	return Number.isFinite(value) ? value : fallback
}

function formatAtomicRep(value: bigint): string {
	const scale = 1_000_000_000_000_000_000n
	const whole = value / scale
	const fraction = (value % scale).toString().padStart(18, '0')
	return `${whole}.${fraction}`
}

function escalationCostChart(spec: ChartSpec): SVGSVGElement {
	const curve = Array.from({ length: 61 }, (_, index) => {
		const elapsed = index / 60
		return {
			elapsed,
			requiredRep: normalizedEscalationCost(elapsed),
		}
	})
	return plot({
		ariaDescription: spec.ariaDescription,
		ariaLabel: spec.ariaLabel,
		height: spec.height,
		marginBottom: 46,
		marginLeft: 58,
		marginRight: 24,
		marginTop: 20,
		marks: [
			areaY(curve, {
				fill: 'var(--green-soft, #dcefe8)',
				x: 'elapsed',
				y: 'requiredRep',
			}),
			lineY(curve, {
				stroke: 'var(--green, #1d735d)',
				strokeWidth: 3,
				x: 'elapsed',
				y: 'requiredRep',
			}),
			dot([curve[0], curve[curve.length - 1]], {
				fill: (_datum, index) => (index === 0 ? 'var(--green, #1d735d)' : 'var(--red, #99453f)'),
				r: 6,
				x: 'elapsed',
				y: 'requiredRep',
			}),
			ruleY([Math.exp(-2.4), 1], { stroke: 'var(--line, #d8e0e4)' }),
		],
		style: { background: 'transparent', color: 'var(--ink, currentColor)' },
		width: spec.width,
		x: { domain: [0, 1], grid: true, label: 'Elapsed escalation interval', percent: true },
		y: { domain: [0, 1], grid: true, label: 'Required REP (normalized)', percent: true },
	}) as SVGSVGElement
}

function auctionDemandChart(spec: ChartSpec, mount: HTMLElement): SVGSVGElement {
	const example = document.querySelector('#simple-auction-example')
	const repInventory = Math.max(readInput(example, 'repInventory', 4), 1)
	const ethRaiseCap = Math.max(readInput(example, 'ethRaiseCap', 10), 0)
	const model = calculateAuctionModel(ethRaiseCap, repInventory, [
		{ eth: readInput(example, 'aliceEth', 5), key: 'alice', name: 'Alice', price: 5 },
		{ eth: readInput(example, 'bobEth', 4), key: 'bob', name: 'Bob', price: 4 },
		{ eth: readInput(example, 'carolEth', 5), key: 'carol', name: 'Carol', price: 3 },
	])
	const rawBids = model.bids.filter(bid => bid.eth > 0)
	const bids = rawBids.map(bid => ({ ...bid, cumulativeRep: bid.chartRep }))
	const firstDemandPoint = model.demandPoints[0]
	const demandCurve = firstDemandPoint === undefined ? [] : [{ cumulativeRep: 0, price: firstDemandPoint.price }, ...model.demandPoints]
	const clearingPrice = model.clearingPrice
	const maxRep = Math.max(repInventory, ...bids.map(bid => bid.cumulativeRep), ...model.demandPoints.map(point => point.cumulativeRep), 1)
	const yMax = Math.max(5.8, clearingPrice * 1.16, ...rawBids.map(bid => bid.price * 1.16))
	const priceDescription = model.mode === 'uniform' ? `uniform clearing at ${clearingPrice.toFixed(2)} ETH per REP` : `underfunded allocation at an effective ${model.effectivePrice.toFixed(2)} ETH per REP, with a ${model.qualificationPrice.toFixed(2)} ETH per REP qualification boundary`

	const chart = plot({
		ariaDescription: `${spec.ariaDescription} The current result is ${priceDescription}, with ${model.ethRaised.toFixed(2)} ETH retained for ${repInventory.toFixed(2)} REP of inventory.`,
		ariaLabel: 'Interactive truth-auction aggregate demand curve',
		color: {
			domain: ['Accepted', 'Partially filled', 'Rejected'],
			range: ['var(--green, #1d735d)', 'var(--gold, #8a5d18)', 'var(--red, #99453f)'],
			type: 'ordinal',
		},
		height: spec.height,
		marginBottom: 50,
		marginLeft: 66,
		marginRight: 28,
		marginTop: 24,
		marks: [
			areaY(demandCurve, {
				curve: 'step-after',
				fill: 'var(--blue-soft, #dceaf8)',
				x: 'cumulativeRep',
				y: 'price',
				y1: 0,
			}),
			lineY(demandCurve, {
				curve: 'step-after',
				stroke: 'var(--blue, #245f9f)',
				strokeWidth: 3,
				x: 'cumulativeRep',
				y: 'price',
			}),
			ruleX([repInventory], {
				stroke: 'var(--red, #99453f)',
				strokeDasharray: '5,4',
				strokeWidth: 2,
			}),
			ruleY([clearingPrice], {
				stroke: 'var(--gold, #8a5d18)',
				strokeDasharray: '5,4',
				strokeWidth: 2,
			}),
			dot(bids, {
				fill: 'status',
				r: 6,
				tip: true,
				title: bid => `${bid.name}: ${bid.eth.toFixed(2)} ETH at ${bid.price.toFixed(2)} ETH/REP`,
				x: 'cumulativeRep',
				y: 'price',
			}),
			text([{ label: `REP inventory ${repInventory.toFixed(2)}`, x: repInventory, y: yMax * 0.72 }], {
				dx: -6,
				dy: -7,
				fill: 'var(--ink, currentColor)',
				fontSize: 12,
				text: 'label',
				textAnchor: 'end',
				x: 'x',
				y: 'y',
			}),
			text(
				[
					{
						label: `${model.mode === 'uniform' ? 'clearing' : 'qualification'} ${clearingPrice.toFixed(2)} ETH/REP`,
						x: maxRep * 0.72,
						y: clearingPrice,
					},
				],
				{
					dx: 6,
					dy: -7,
					fill: 'var(--ink, currentColor)',
					fontSize: 12,
					text: 'label',
					textAnchor: 'start',
					x: 'x',
					y: 'y',
				},
			),
			text(
				[
					{ label: '● accepted', status: 'Accepted', x: maxRep * 0.12 },
					{ label: '● partially filled', status: 'Partially filled', x: maxRep * 0.42 },
					{ label: '● rejected', status: 'Rejected', x: maxRep * 0.74 },
				],
				{
					fill: 'status',
					fontSize: 12,
					text: 'label',
					x: 'x',
					y: yMax * 0.97,
				},
			),
		],
		style: { background: 'transparent', color: 'var(--ink, currentColor)' },
		width: spec.width,
		x: { domain: [0, maxRep * 1.08], grid: true, label: 'Cumulative REP demand' },
		y: { domain: [0, yMax], grid: true, label: 'Bid limit (ETH per REP)' },
	}) as SVGSVGElement
	chart.dataset['chartState'] = model.mode
	mount.dataset['chartState'] = chart.dataset['chartState']
	return chart
}

function collateralRepairChart(spec: ChartSpec, mount: HTMLElement): SVGSVGElement {
	const example = mount.closest('#collateral-repair-example')
	const parentCollateral = Math.max(readInput(example, 'parentCollateral', 50), 0)
	const model = calculateCollateralRepairModel(parentCollateral, readInput(example, 'forkCollateralReceived', 47.5), readInput(example, 'auctionRaised', 2.5))
	const parts = [
		{ kind: 'Migration-routed', x1: 0, x2: model.received },
		{ kind: 'Auction repair', x1: model.received, x2: model.received + model.repairEth },
	]
	const chart = plot({
		ariaDescription: `${spec.ariaDescription}. Migration routed ${model.received.toFixed(2)} ETH and the auction repairs ${model.repairEth.toFixed(2)} ETH toward the ${parentCollateral.toFixed(2)} ETH target, leaving ${model.remainingShortfall.toFixed(2)} ETH unfilled.`,
		ariaLabel: spec.ariaLabel,
		color: {
			domain: ['Migration-routed', 'Auction repair'],
			range: ['var(--blue, #245f9f)', 'var(--green, #1d735d)'],
		},
		height: spec.height,
		marginBottom: 44,
		marginLeft: 32,
		marginRight: 28,
		marginTop: 52,
		marks: [
			barX(parts, { fill: 'kind', inset: 2, x1: 'x1', x2: 'x2', y: () => 'Child collateral' }),
			ruleX([parentCollateral], { stroke: 'var(--gold, #8a5d18)', strokeDasharray: '5,4', strokeWidth: 2 }),
			text(
				[
					{ kind: 'Migration-routed', label: '■ Migration-routed', value: parentCollateral * 0.24 },
					{ kind: 'Auction repair', label: '■ Auction repair', value: parentCollateral * 0.68 },
				],
				{
					dy: -55,
					fill: 'kind',
					fontSize: 12,
					text: 'label',
					x: 'value',
					y: () => 'Child collateral',
				},
			),
			text([{ label: `target ${parentCollateral.toFixed(2)} ETH`, value: parentCollateral }], {
				dx: -6,
				dy: -55,
				fontSize: 12,
				text: 'label',
				textAnchor: 'end',
				x: 'value',
				y: () => 'Child collateral',
			}),
		],
		style: { background: 'transparent', color: 'var(--ink, currentColor)' },
		width: spec.width,
		x: { domain: [0, Math.max(parentCollateral, model.received + model.repairEth, 1)], grid: true, label: 'Collateral (ETH)' },
		y: { axis: null },
	}) as SVGSVGElement
	chart.dataset['chartState'] = model.remainingShortfall === 0 ? 'repaired' : 'partial'
	mount.dataset['chartState'] = chart.dataset['chartState']
	return chart
}

function oracleSecurityChart(spec: ChartSpec, mount: HTMLElement): SVGSVGElement {
	const example = mount.closest('#binary-censorship-example')
	const honestPrice = Math.max(readInput(example, 'honestPrice', 900), 0.0001)
	const manipulatedPrice = Math.max(readInput(example, 'manipulatedPrice', 1017), 0.0001)
	const liquidationThresholdPrice = Math.max(readInput(example, 'liquidationThresholdPrice', 101), 0.0001)
	const minLiquidationPriceDistanceBps = Math.max(readInput(example, 'minLiquidationPriceDistanceBps', 1000), 0)
	const externalPayoff = Math.max(readInput(example, 'externalPayoff', 1000), 0)
	const oracleLiquidity = Math.max(readInput(example, 'oracleReportLiquidity', 4000), 0)
	const disputeBarrier = Math.max(readInput(example, 'honestDisputeBarrierFraction', 0.01), 0)
	const selectedDuration = Math.max(readInput(example, 'censorshipDuration', 24), 0)
	const targetGriefRatio = Math.max(readInput(example, 'targetGriefRatio', 1), 0)
	const model = calculateOracleSecurityModel({
		censorshipDuration: selectedDuration,
		externalPayoff,
		honestDisputeBarrierFraction: disputeBarrier,
		honestPrice,
		liquidationThresholdPrice,
		manipulatedPrice,
		minLiquidationPriceDistanceBps,
		oracleReportLiquidity: oracleLiquidity,
		targetGriefRatio,
	})
	const costRate = model.censorshipRate * oracleLiquidity
	const maxDuration = Math.max(168, selectedDuration)
	const costs = Array.from({ length: maxDuration + 1 }, (_, duration) => ({
		cost: duration * costRate,
		duration,
	}))
	const selectedCost = model.censorshipCost
	const horizontalRules = [
		{ label: 'Conditional attacker payoff', value: model.attackerProfit },
		{ label: 'Target payoff + grief cost', value: model.griefTarget },
	]

	return plot({
		ariaDescription: `${spec.ariaDescription}. Liquidation is ${model.liquidationExecutable ? 'executable' : 'not executable'}, so attacker payoff is ${model.attackerProfit.toFixed(2)} ETH. At ${selectedDuration.toFixed(0)} steps, censorship costs ${selectedCost.toFixed(2)} ETH; the payoff-plus-grief target is ${model.griefTarget.toFixed(2)} ETH.`,
		ariaLabel: 'Interactive censorship cost and attacker payoff',
		height: spec.height,
		marginBottom: 48,
		marginLeft: 72,
		marginRight: 24,
		marginTop: 18,
		marks: [
			areaY(costs, {
				fill: 'var(--gold-soft, #f3e4c6)',
				x: 'duration',
				y: 'cost',
			}),
			lineY(costs, {
				stroke: 'var(--gold, #8a5d18)',
				strokeWidth: 3,
				x: 'duration',
				y: 'cost',
			}),
			ruleY(horizontalRules, {
				stroke: (_datum, index) => (index === 0 ? 'var(--red, #99453f)' : 'var(--green, #1d735d)'),
				strokeDasharray: '5,4',
				strokeWidth: 2,
				y: 'value',
			}),
			ruleX([selectedDuration], {
				stroke: 'var(--blue, #245f9f)',
				strokeDasharray: '5,4',
			}),
			text([{ label: 'attacker payoff', value: model.attackerProfit }], {
				dy: -6,
				fill: 'var(--red, #99453f)',
				fontSize: 11,
				text: 'label',
				textAnchor: 'start',
				x: maxDuration * 0.63,
				y: 'value',
			}),
			text([{ label: 'payoff + grief target', value: model.griefTarget }], {
				dy: -20,
				fill: 'var(--green, #1d735d)',
				fontSize: 11,
				text: 'label',
				textAnchor: 'start',
				x: maxDuration * 0.63,
				y: 'value',
			}),
			dot([{ cost: selectedCost, duration: selectedDuration }], {
				fill: selectedCost >= model.griefTarget ? 'var(--green, #1d735d)' : 'var(--red, #99453f)',
				r: 6,
				tip: true,
				title: `Selected: ${selectedDuration.toFixed(0)} steps, ${selectedCost.toFixed(2)} ETH`,
				x: 'duration',
				y: 'cost',
			}),
		],
		style: { background: 'transparent', color: 'var(--ink, currentColor)' },
		width: spec.width,
		x: { domain: [0, maxDuration], grid: true, label: 'Censorship duration (steps)' },
		y: { grid: true, label: 'Cost or payoff (ETH)' },
	}) as SVGSVGElement
}

function escalationDepositChart(spec: ChartSpec, mount: HTMLElement): SVGSVGElement {
	const example = mount.closest('#escalation-deposit-example')
	const invalidBalance = readInput(example, 'invalidBalance', 1)
	const yesBalance = readInput(example, 'yesBalance', 9)
	const noBalance = readInput(example, 'noBalance', 7)
	const model = calculateEscalationDepositModel({
		invalidBalance,
		noBalance,
		nonDecisionThreshold: readInput(example, 'nonDecisionThreshold', 10),
		proposedDeposit: readInput(example, 'proposedDeposit', 5),
		startBond: readInput(example, 'startBond', 2),
		yesBalance,
	})
	const balances = [
		{ balance: invalidBalance, phase: 'Before', side: 'Invalid' },
		{ balance: yesBalance, phase: 'Before', side: 'Yes' },
		{ balance: noBalance, phase: 'Before', side: 'No' },
		{ balance: invalidBalance, phase: 'After', side: 'Invalid' },
		{ balance: yesBalance, phase: 'After', side: 'Yes' },
		{ balance: model.noAfter, phase: 'After', side: 'No' },
	]
	const acceptedLabel = model.tieAdjusted ? formatAtomicRep(model.acceptedAtomic) : model.accepted.toFixed(6)
	const noAfterLabel = model.tieAdjusted ? formatAtomicRep(model.noAfterAtomic) : model.noAfter.toFixed(6)
	const chart = plot({
		ariaDescription: `${spec.ariaDescription}. The proposed No deposit ${model.previewReverts ? 'reverts' : `accepts ${acceptedLabel} REP`}; No ends at ${noAfterLabel} REP against a ${model.threshold.toFixed(2)} REP threshold.`,
		ariaLabel: spec.ariaLabel,
		color: {
			domain: ['Invalid', 'Yes', 'No'],
			range: ['var(--red, #99453f)', 'var(--green, #1d735d)', 'var(--blue, #245f9f)'],
		},
		fx: { domain: ['Before', 'After'], label: null },
		height: spec.height,
		marginBottom: 42,
		marginLeft: 58,
		marginRight: 24,
		marginTop: 28,
		marks: [barX(balances, { fill: 'side', fx: 'phase', inset: 2, x: 'balance', y: 'side' }), ruleX([model.threshold], { stroke: 'var(--gold, #8a5d18)', strokeDasharray: '5,4', strokeWidth: 2 })],
		style: { background: 'transparent', color: 'var(--ink, currentColor)' },
		width: spec.width,
		x: { domain: [0, Math.max(model.threshold, ...balances.map(item => item.balance), 1)], grid: true, label: 'Escrowed REP' },
		y: { domain: ['Invalid', 'Yes', 'No'], label: null },
	}) as SVGSVGElement
	chart.dataset['chartState'] = model.previewReverts ? 'reverts' : 'accepted'
	return chart
}

function resolutionChart(spec: ChartSpec, mount: HTMLElement): SVGSVGElement {
	const example = mount.closest('#resolution-edge-example')
	const invalidBalance = readInput(example, 'invalidBalance', 4)
	const yesBalance = readInput(example, 'yesBalance', 6)
	const noBalance = readInput(example, 'noBalance', 7)
	const runningCost = readInput(example, 'runningCost', 5)
	const model = calculateResolutionModel({ invalidBalance, noBalance, runningCost, yesBalance })
	const balances = [
		{ balance: invalidBalance, side: 'Invalid' },
		{ balance: yesBalance, side: 'Yes' },
		{ balance: noBalance, side: 'No' },
	]
	const chart = plot({
		ariaDescription: `${spec.ariaDescription}. ${model.atCost} outcomes meet the ${runningCost.toFixed(2)} REP running cost, so the helper returns ${model.result}.`,
		ariaLabel: spec.ariaLabel,
		color: {
			domain: ['Invalid', 'Yes', 'No'],
			range: ['var(--red, #99453f)', 'var(--green, #1d735d)', 'var(--blue, #245f9f)'],
		},
		height: spec.height,
		marginBottom: 42,
		marginLeft: 58,
		marginRight: 24,
		marginTop: 22,
		marks: [barX(balances, { fill: 'side', inset: 3, x: 'balance', y: 'side' }), ruleX([runningCost], { stroke: 'var(--gold, #8a5d18)', strokeDasharray: '5,4', strokeWidth: 2 })],
		style: { background: 'transparent', color: 'var(--ink, currentColor)' },
		width: spec.width,
		x: { domain: [0, Math.max(runningCost, ...balances.map(item => item.balance), 1)], grid: true, label: 'Escrowed REP' },
		y: { domain: ['Invalid', 'Yes', 'No'], label: null },
	}) as SVGSVGElement
	chart.dataset['chartState'] = model.result.toLowerCase()
	return chart
}

function createChart(chartId: string, spec: ChartSpec, mount: HTMLElement): SVGSVGElement {
	if (chartId === 'fig-statoblast-escalation-cost-curve') {
		return escalationCostChart(spec)
	}
	if (chartId === 'fig-auction-clearing-ladder') {
		return auctionDemandChart(spec, mount)
	}
	if (chartId === 'plot-open-oracle-integration-2') {
		return oracleSecurityChart(spec, mount)
	}
	if (chartId === 'plot-statoblast-whitepaper-7') {
		return escalationDepositChart(spec, mount)
	}
	if (chartId === 'plot-statoblast-whitepaper-8') {
		return resolutionChart(spec, mount)
	}
	if (chartId === 'plot-statoblast-whitepaper-19') {
		return collateralRepairChart(spec, mount)
	}
	return narrativeChart(spec)
}

function renderMount(mount: HTMLElement): void {
	const chartId = mount.dataset['plotChart']
	if (chartId === undefined) {
		throw new Error('Plot mount is missing data-plot-chart')
	}
	const spec = specs[chartId]
	if (spec === undefined) {
		throw new Error(`Plot chart specification is missing for ${chartId}`)
	}
	const chart = createChart(chartId, spec, mount)
	if (!(chart instanceof SVGSVGElement)) {
		throw new Error(`Plot chart ${chartId} did not produce an SVG root`)
	}
	chart.dataset['plotGenerated'] = 'true'
	chart.setAttribute('role', 'img')
	if (!chart.hasAttribute('viewBox')) {
		chart.setAttribute('viewBox', `0 0 ${spec.width} ${spec.height}`)
	}
	mount.removeAttribute('aria-label')
	mount.removeAttribute('role')
	mount.replaceChildren(chart)
	mount.classList.add('plot-chart-ready')
}

const mounts = Array.from(document.querySelectorAll<HTMLElement>('[data-plot-chart]'))
for (const mount of mounts) {
	renderMount(mount)
}

for (const chartId of ['fig-auction-clearing-ladder', 'plot-open-oracle-integration-2', 'plot-statoblast-whitepaper-7', 'plot-statoblast-whitepaper-8', 'plot-statoblast-whitepaper-19']) {
	const mount = document.querySelector<HTMLElement>(`[data-plot-chart="${chartId}"]`)
	const inputRoot = chartId === 'fig-auction-clearing-ladder' ? document.querySelector('#simple-auction-example') : mount?.closest('.interactive-example')
	for (const input of Array.from(inputRoot?.querySelectorAll<HTMLInputElement>('[data-example-input]') ?? [])) {
		input.addEventListener('input', () => {
			if (mount !== null && mount !== undefined) {
				renderMount(mount)
			}
		})
	}
}
