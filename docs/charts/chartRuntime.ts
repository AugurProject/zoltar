import { areaY, barX, dot, line, lineY, link, plot, rect, ruleX, ruleY, text } from '@observablehq/plot'
import {
	calculateAnnualizedRetentionFeePercent,
	calculateAuctionModel,
	calculateCollateralRepairModel,
	calculateEscalationDepositModel,
	calculateForkThresholdSeries,
	calculateLiquidationHealth,
	calculateOracleSecurityModel,
	calculateResolutionModel,
	contractInteractionEdges,
	normalizedEscalationCost,
} from './chartModels'

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

type DiagramRect = {
	attributes: Record<string, string>
	className: string | undefined
	height: number
	rx: number
	width: number
	x: number
	y: number
}

type DiagramText = {
	attributes: Record<string, string>
	className: string | undefined
	fontSize: number
	fontWeight: number
	text: string
	textAnchor: 'end' | 'middle' | 'start'
	x: number
	y: number
}

type DiagramLine = {
	attributes: Record<string, string>
	className: string | undefined
	hasArrow: boolean
	points: { x: number; y: number }[]
	stroke: string
	strokeDasharray: string | undefined
	strokeWidth: number
}

type DiagramDot = {
	className: string | undefined
	fill: string
	r: number
	x: number
	y: number
}

function numericAttribute(attributes: Record<string, string>, name: string, fallback = 0): number {
	const value = Number(attributes[name])
	return Number.isFinite(value) ? value : fallback
}

function textContent(node: ChartNode): string {
	if (node.text !== undefined) return node.text
	return (node.children ?? []).map(textContent).join('')
}

function textStyle(className: string | undefined): { fontSize: number; fontWeight: number } {
	if (className === 'svg-label') return { fontSize: 17, fontWeight: 800 }
	if (className === 'svg-micro') return { fontSize: 11, fontWeight: 650 }
	return { fontSize: 13, fontWeight: className === 'svg-small' ? 650 : 500 }
}

function textAnchor(attributes: Record<string, string>): DiagramText['textAnchor'] {
	if (attributes['text-anchor'] === 'end') return 'end'
	if (attributes['text-anchor'] === 'middle') return 'middle'
	return 'start'
}

function parsePathPoints(source: string): { x: number; y: number }[] {
	const tokens = source.match(/[MLHVCZz]|-?(?:\d+\.?\d*|\.\d+)/g) ?? []
	const points: { x: number; y: number }[] = []
	let command = ''
	let index = 0
	let x = 0
	let y = 0
	while (index < tokens.length) {
		const token = tokens[index]
		if (token === undefined) break
		if (/^[MLHVCZz]$/.test(token)) {
			command = token
			index += 1
			if (command === 'Z' || command === 'z') continue
		}
		if (command === 'M' || command === 'L') {
			x = Number(tokens[index])
			y = Number(tokens[index + 1])
			index += 2
			points.push({ x, y })
			command = command === 'M' ? 'L' : command
			continue
		}
		if (command === 'H') {
			x = Number(tokens[index])
			index += 1
			points.push({ x, y })
			continue
		}
		if (command === 'V') {
			y = Number(tokens[index])
			index += 1
			points.push({ x, y })
			continue
		}
		if (command === 'C') {
			const control1X = Number(tokens[index])
			const control1Y = Number(tokens[index + 1])
			const control2X = Number(tokens[index + 2])
			const control2Y = Number(tokens[index + 3])
			const endX = Number(tokens[index + 4])
			const endY = Number(tokens[index + 5])
			index += 6
			const startX = x
			const startY = y
			for (let step = 1; step <= 16; step++) {
				const progress = step / 16
				const remaining = 1 - progress
				points.push({
					x: remaining ** 3 * startX + 3 * remaining ** 2 * progress * control1X + 3 * remaining * progress ** 2 * control2X + progress ** 3 * endX,
					y: remaining ** 3 * startY + 3 * remaining ** 2 * progress * control1Y + 3 * remaining * progress ** 2 * control2Y + progress ** 3 * endY,
				})
			}
			x = endX
			y = endY
			continue
		}
		throw new Error(`Unsupported Plot diagram path command in ${source}`)
	}
	return points
}

function parsePolylinePoints(source: string): { x: number; y: number }[] {
	const values = source
		.trim()
		.split(/[\s,]+/)
		.map(Number)
	const points: { x: number; y: number }[] = []
	for (let index = 0; index + 1 < values.length; index += 2) {
		const x = values[index]
		const y = values[index + 1]
		if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y })
	}
	return points
}

function diagramData(spec: ChartSpec): { dots: DiagramDot[]; lines: DiagramLine[]; rectangles: DiagramRect[]; texts: DiagramText[] } {
	const rectangles: DiagramRect[] = []
	const texts: DiagramText[] = []
	const lines: DiagramLine[] = []
	const dots: DiagramDot[] = []
	function visit(node: ChartNode, insideDefinitions = false): void {
		if (node.text !== undefined) return
		const attributes = node.attributes ?? {}
		const className = attributes['class']
		if (node.tag === 'defs') {
			for (const child of node.children ?? []) visit(child, true)
			return
		}
		if (insideDefinitions) return
		if (node.tag === 'rect') {
			rectangles.push({
				attributes,
				className,
				height: numericAttribute(attributes, 'height'),
				rx: numericAttribute(attributes, 'rx'),
				width: numericAttribute(attributes, 'width'),
				x: numericAttribute(attributes, 'x'),
				y: numericAttribute(attributes, 'y'),
			})
		} else if (node.tag === 'text') {
			const parentX = numericAttribute(attributes, 'x')
			let lineY = numericAttribute(attributes, 'y')
			const tspanChildren = (node.children ?? []).filter(child => child.tag === 'tspan')
			const textNodes = tspanChildren.length > 0 ? tspanChildren : [node]
			for (const textNode of textNodes) {
				const textAttributes = textNode === node ? attributes : { ...attributes, ...(textNode.attributes ?? {}) }
				lineY += numericAttribute(textNode.attributes ?? {}, 'dy')
				const style = textStyle(textAttributes['class'])
				texts.push({
					attributes: textAttributes,
					className: textAttributes['class'],
					fontSize: style.fontSize,
					fontWeight: style.fontWeight,
					text: textContent(textNode).trim(),
					textAnchor: textAnchor(textAttributes),
					x: numericAttribute(textAttributes, 'x', parentX),
					y: lineY - style.fontSize * 0.34,
				})
			}
		} else if (node.tag === 'path') {
			lines.push({
				attributes,
				className,
				hasArrow: attributes['marker-end'] !== undefined,
				points: parsePathPoints(attributes['d'] ?? ''),
				stroke: attributes['stroke'] ?? 'currentColor',
				strokeDasharray: attributes['stroke-dasharray'],
				strokeWidth: numericAttribute(attributes, 'stroke-width', 2.35),
			})
		} else if (node.tag === 'line') {
			lines.push({
				attributes,
				className,
				hasArrow: attributes['marker-end'] !== undefined,
				points: [
					{ x: numericAttribute(attributes, 'x1'), y: numericAttribute(attributes, 'y1') },
					{ x: numericAttribute(attributes, 'x2'), y: numericAttribute(attributes, 'y2') },
				],
				stroke: attributes['stroke'] ?? 'currentColor',
				strokeDasharray: attributes['stroke-dasharray'],
				strokeWidth: numericAttribute(attributes, 'stroke-width', 2.35),
			})
		} else if (node.tag === 'polyline') {
			lines.push({
				attributes,
				className,
				hasArrow: attributes['marker-end'] !== undefined,
				points: parsePolylinePoints(attributes['points'] ?? ''),
				stroke: attributes['stroke'] ?? 'currentColor',
				strokeDasharray: attributes['stroke-dasharray'],
				strokeWidth: numericAttribute(attributes, 'stroke-width', 2.35),
			})
		} else if (node.tag === 'circle') {
			dots.push({
				className,
				fill: attributes['fill'] ?? 'currentColor',
				r: numericAttribute(attributes, 'r', 4),
				x: numericAttribute(attributes, 'cx'),
				y: numericAttribute(attributes, 'cy'),
			})
		}
		for (const child of node.children ?? []) visit(child, insideDefinitions)
	}
	for (const node of spec.nodes) visit(node)
	return { dots, lines, rectangles, texts }
}

function copyDataAttributes(element: Element | undefined, attributes: Record<string, string>): void {
	if (element === undefined) return
	for (const [name, value] of Object.entries(attributes)) {
		if (name.startsWith('data-')) element.setAttribute(name, value)
	}
}

function markDrivenDiagramChart(spec: ChartSpec): SVGSVGElement {
	const data = diagramData(spec)
	const lineMarks = data.lines.map(item =>
		line(item.points, {
			...(item.className === undefined ? {} : { className: item.className }),
			curve: 'linear',
			...(item.hasArrow ? { markerEnd: 'arrow' } : {}),
			stroke: item.stroke,
			...(item.strokeDasharray === undefined ? {} : { strokeDasharray: item.strokeDasharray }),
			strokeWidth: item.strokeWidth,
			x: 'x',
			y: 'y',
		}),
	)
	const rectangleMarks = data.rectangles.map(item =>
		rect([item], {
			...(item.className === undefined ? {} : { className: item.className }),
			rx: item.rx,
			x1: 'x',
			x2: datum => datum.x + datum.width,
			y1: 'y',
			y2: datum => datum.y + datum.height,
		}),
	)
	const dotMarks = data.dots.map(item =>
		dot([item], {
			...(item.className === undefined ? {} : { className: item.className }),
			fill: item.fill,
			r: item.r,
			x: 'x',
			y: 'y',
		}),
	)
	const textMarks = data.texts.map(item =>
		text([item], {
			...(item.className === undefined ? {} : { className: item.className }),
			fontSize: item.fontSize,
			fontWeight: item.fontWeight,
			text: 'text',
			textAnchor: item.textAnchor,
			x: 'x',
			y: 'y',
		}),
	)
	const chart = plot({
		ariaDescription: spec.ariaDescription,
		ariaLabel: spec.ariaLabel,
		height: spec.height,
		margin: 0,
		marks: [...lineMarks, ...rectangleMarks, ...dotMarks, ...textMarks],
		style: {
			background: 'transparent',
			color: 'currentColor',
			overflow: 'visible',
		},
		width: spec.width,
		x: { axis: null, domain: [0, spec.width] },
		y: { axis: null, domain: [spec.height, 0] },
	}) as SVGSVGElement
	const rectangleElements = Array.from(chart.querySelectorAll<SVGRectElement>('g[aria-label="rect"] > rect'))
	const lineElements = Array.from(chart.querySelectorAll<SVGPathElement>('g[aria-label="line"] > path'))
	const textElements = Array.from(chart.querySelectorAll<SVGTextElement>('g[aria-label="text"] > text'))
	data.rectangles.forEach((item, index) => copyDataAttributes(rectangleElements[index], item.attributes))
	data.lines.forEach((item, index) => copyDataAttributes(lineElements[index], item.attributes))
	data.texts.forEach((item, index) => copyDataAttributes(textElements[index], item.attributes))
	return chart
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

function forkThresholdDecayChart(spec: ChartSpec): SVGSVGElement {
	const generations = calculateForkThresholdSeries(21)
	return plot({
		ariaDescription: spec.ariaDescription,
		ariaLabel: spec.ariaLabel,
		height: spec.height,
		marginBottom: 46,
		marginLeft: 62,
		marginRight: 24,
		marginTop: 22,
		marks: [
			areaY(generations, { fill: 'var(--blue-soft, #dceaf8)', x: 'generation', y: 'theoreticalSupply' }),
			lineY(generations, { stroke: 'var(--blue, #245f9f)', strokeWidth: 3, x: 'generation', y: 'theoreticalSupply' }),
			lineY(generations, { stroke: 'var(--gold, #8a5d18)', strokeDasharray: '6,4', strokeWidth: 2, x: 'generation', y: 'forkThreshold' }),
			text(
				[
					{ generation: 15, label: 'theoretical supply', value: generations[15]?.theoreticalSupply ?? 0 },
					{ generation: 15, label: 'next fork threshold', value: generations[15]?.forkThreshold ?? 0 },
				],
				{ dy: -8, fill: datum => (datum.label === 'theoretical supply' ? 'var(--blue, #245f9f)' : 'var(--gold, #8a5d18)'), fontWeight: 650, text: 'label', x: 'generation', y: 'value' },
			),
		],
		style: { background: 'transparent', color: 'var(--ink, currentColor)' },
		width: spec.width,
		x: { grid: true, label: 'Fork generation along one lineage', ticks: 10 },
		y: { domain: [0, 100], grid: true, label: 'Percent of genesis theoretical supply' },
	}) as SVGSVGElement
}

function retentionUtilizationChart(spec: ChartSpec): SVGSVGElement {
	const curve = Array.from({ length: 101 }, (_, utilizationPercent) => {
		return {
			annualFeePercent: calculateAnnualizedRetentionFeePercent(utilizationPercent),
			utilizationPercent,
		}
	})
	return plot({
		ariaDescription: spec.ariaDescription,
		ariaLabel: spec.ariaLabel,
		height: spec.height,
		marginBottom: 46,
		marginLeft: 60,
		marginRight: 28,
		marginTop: 22,
		marks: [
			areaY(curve, { fill: 'var(--gold-soft, #f3e4c6)', x: 'utilizationPercent', y: 'annualFeePercent' }),
			lineY(curve, { stroke: 'var(--gold, #8a5d18)', strokeWidth: 3, x: 'utilizationPercent', y: 'annualFeePercent' }),
			ruleX([80], { stroke: 'var(--red, #99453f)', strokeDasharray: '5,4', strokeWidth: 2 }),
			text([{ annualFeePercent: curve[80]?.annualFeePercent ?? 50, label: '80% utilization dip', utilizationPercent: 80 }], {
				dx: -8,
				dy: -10,
				fill: 'var(--red, #99453f)',
				fontWeight: 700,
				text: 'label',
				textAnchor: 'end',
				x: 'utilizationPercent',
				y: 'annualFeePercent',
			}),
		],
		style: { background: 'transparent', color: 'var(--ink, currentColor)' },
		width: spec.width,
		x: { domain: [0, 100], grid: true, label: 'Fee-eligible allowance utilization (%)' },
		y: { domain: [0, 55], grid: true, label: 'Annualized open-interest fee (%)' },
	}) as SVGSVGElement
}

function liquidationHealthChart(spec: ChartSpec, mount: HTMLElement): SVGSVGElement {
	const container = mount.closest('.interactive-example')
	const unlockedRep = Number(container?.querySelector<HTMLInputElement>('[data-liquidation-input="rep"]')?.value ?? 1000)
	const allowance = Number(container?.querySelector<HTMLInputElement>('[data-liquidation-input="debt"]')?.value ?? 75)
	const multiplier = Number(container?.querySelector<HTMLInputElement>('[data-liquidation-input="multiplier"]')?.value ?? 2)
	const currentPrice = Number(container?.querySelector<HTMLInputElement>('[data-liquidation-input="price"]')?.value ?? 10)
	const maximumPrice = Math.max(20, currentPrice)
	const curve = Array.from({ length: 81 }, (_, index) => {
		const price = (maximumPrice * index) / 80
		return { price, requiredRep: allowance * multiplier * price }
	})
	const { currentRequiredRep, state, thresholdPrice } = calculateLiquidationHealth(unlockedRep, allowance, multiplier, currentPrice)
	const chart = plot({
		ariaDescription: `${spec.ariaDescription} At the selected values, required backing is ${currentRequiredRep.toFixed(0)} REP against ${unlockedRep.toFixed(0)} unlocked REP, so the vault is ${state}.`,
		ariaLabel: spec.ariaLabel,
		height: spec.height,
		marginBottom: 48,
		marginLeft: 68,
		marginRight: 28,
		marginTop: 24,
		marks: [
			areaY(curve, { fill: 'var(--red-soft, #f2d9d6)', x: 'price', y: 'requiredRep' }),
			lineY(curve, { stroke: 'var(--red, #99453f)', strokeWidth: 3, x: 'price', y: 'requiredRep' }),
			ruleY([unlockedRep], { stroke: 'var(--green, #1d735d)', strokeDasharray: '7,4', strokeWidth: 3 }),
			...(Number.isFinite(thresholdPrice) && thresholdPrice <= maximumPrice ? [ruleX([thresholdPrice], { stroke: 'var(--gold, #8a5d18)', strokeDasharray: '4,4', strokeWidth: 2 })] : []),
			dot([{ price: currentPrice, requiredRep: currentRequiredRep }], { fill: state === 'safe' ? 'var(--green, #1d735d)' : 'var(--red, #99453f)', r: 7, stroke: 'var(--paper, #fff)', strokeWidth: 2, x: 'price', y: 'requiredRep' }),
			text([{ label: `${unlockedRep.toFixed(0)} REP available`, price: maximumPrice * 0.72, requiredRep: unlockedRep }], { dy: -9, fill: 'var(--green, #1d735d)', fontWeight: 650, text: 'label', x: 'price', y: 'requiredRep' }),
		],
		style: { background: 'transparent', color: 'var(--ink, currentColor)' },
		width: spec.width,
		x: { domain: [0, maximumPrice], grid: true, label: 'REP per ETH price' },
		y: { domain: [0, Math.max(unlockedRep, allowance * multiplier * maximumPrice) * 1.06], grid: true, label: 'REP backing' },
	}) as SVGSVGElement
	chart.dataset['chartState'] = state
	return chart
}

function contractInteractionChart(spec: ChartSpec): SVGSVGElement {
	const nodes = [
		{ fill: 'registry', id: 'Question Data', x1: 0.2, x2: 2.4, y1: 0.4, y2: 1.4 },
		{ fill: 'registry', id: 'Zoltar', x1: 0.2, x2: 2.4, y1: 2.2, y2: 3.2 },
		{ fill: 'registry', id: 'Reputation Token', x1: 0.2, x2: 2.4, y1: 4, y2: 5 },
		{ fill: 'factory', id: 'Pool Factory', x1: 4, x2: 6.4, y1: 0.4, y2: 1.4 },
		{ fill: 'market', id: 'Security Pool', x1: 4, x2: 6.4, y1: 2.2, y2: 3.2 },
		{ fill: 'market', id: 'Share Token', x1: 8, x2: 10.4, y1: 0.4, y2: 1.4 },
		{ fill: 'resolution', id: 'Escalation Game', x1: 8, x2: 10.4, y1: 2.2, y2: 3.2 },
		{ fill: 'oracle', id: 'Price Coordinator', x1: 4, x2: 6.4, y1: 4, y2: 5 },
		{ fill: 'oracle', id: 'OpenOracle', x1: 8, x2: 10.4, y1: 4, y2: 5 },
		{ fill: 'fork', id: 'Migration Proxy', x1: 0.2, x2: 2.4, y1: 5.8, y2: 6.8 },
		{ fill: 'fork', id: 'Pool Forker', x1: 4, x2: 6.4, y1: 5.8, y2: 6.8 },
		{ fill: 'fork', id: 'Truth Auction', x1: 8, x2: 10.4, y1: 5.8, y2: 6.8 },
	]
	const nodeById = new Map(nodes.map(node => [node.id, node]))
	function boundaryPoint(source: (typeof nodes)[number], target: (typeof nodes)[number]): { x: number; y: number } {
		const sourceX = (source.x1 + source.x2) / 2
		const sourceY = (source.y1 + source.y2) / 2
		const deltaX = (target.x1 + target.x2) / 2 - sourceX
		const deltaY = (target.y1 + target.y2) / 2 - sourceY
		const halfWidth = (source.x2 - source.x1) / 2
		const halfHeight = (source.y2 - source.y1) / 2
		const scale = 1 / Math.max(Math.abs(deltaX) / halfWidth, Math.abs(deltaY) / halfHeight)
		return { x: sourceX + deltaX * scale, y: sourceY + deltaY * scale }
	}
	const routedEdgeIds = new Set(['factory-price-coordinator-deployment', 'pool-price-read', 'coordinator-pool-execute', 'coordinator-oracle-report', 'oracle-coordinator-callback', 'share-token-forker-migration', 'forker-escalation-snapshot', 'migration-proxy-zoltar', 'forker-child-deployment', 'forker-pool-migration'])
	const edges = contractInteractionEdges
		.filter(edge => !routedEdgeIds.has(edge.id))
		.map(edge => {
			const sourceNode = nodeById.get(edge.source)
			const targetNode = nodeById.get(edge.receiver)
			if (sourceNode === undefined || targetNode === undefined) throw new Error(`Contract interaction chart node is missing for ${edge.source} or ${edge.receiver}`)
			const from = boundaryPoint(sourceNode, targetNode)
			const to = boundaryPoint(targetNode, sourceNode)
			return { id: edge.id, x1: from.x, x2: to.x, y1: from.y, y2: to.y }
		})
	const routedEdges = [
		{
			id: 'factory-price-coordinator-deployment',
			points: [
				{ x: 6.4, y: 1.1 },
				{ x: 6.8, y: 1.6 },
				{ x: 6.8, y: 4.5 },
				{ x: 6.4, y: 4.5 },
			],
		},
		{
			id: 'pool-price-read',
			points: [
				{ x: 4.95, y: 3.2 },
				{ x: 4.95, y: 4 },
			],
		},
		{
			id: 'coordinator-pool-execute',
			points: [
				{ x: 5.45, y: 4 },
				{ x: 5.45, y: 3.2 },
			],
		},
		{
			id: 'coordinator-oracle-report',
			points: [
				{ x: 6.4, y: 4.3 },
				{ x: 8, y: 4.3 },
			],
		},
		{
			id: 'oracle-coordinator-callback',
			points: [
				{ x: 8, y: 4.7 },
				{ x: 6.4, y: 4.7 },
			],
		},
		{
			id: 'share-token-forker-migration',
			points: [
				{ x: 8, y: 1.1 },
				{ x: 7.05, y: 1.6 },
				{ x: 7.05, y: 5.25 },
				{ x: 6.1, y: 5.8 },
			],
		},
		{
			id: 'forker-escalation-snapshot',
			points: [
				{ x: 6.4, y: 6.15 },
				{ x: 7.3, y: 5.45 },
				{ x: 7.3, y: 2.7 },
				{ x: 8, y: 2.7 },
			],
		},
		{
			id: 'migration-proxy-zoltar',
			points: [
				{ x: 1.3, y: 5.8 },
				{ x: 2.75, y: 5.3 },
				{ x: 2.75, y: 2.7 },
				{ x: 2.4, y: 2.7 },
			],
		},
		{
			id: 'forker-child-deployment',
			points: [
				{ x: 4.5, y: 5.8 },
				{ x: 3.2, y: 5.35 },
				{ x: 3.2, y: 0.9 },
				{ x: 4, y: 0.9 },
			],
		},
		{
			id: 'forker-pool-migration',
			points: [
				{ x: 4.75, y: 5.8 },
				{ x: 3.5, y: 5.35 },
				{ x: 3.5, y: 2.7 },
				{ x: 4, y: 2.7 },
			],
		},
	]
	const routedEdgeIdSet = new Set(routedEdges.map(edge => edge.id))
	if (routedEdgeIdSet.size !== routedEdgeIds.size || [...routedEdgeIds].some(edgeId => !routedEdgeIdSet.has(edgeId))) {
		throw new Error('Contract interaction chart routed edges do not match the shared interaction registry')
	}
	return plot({
		ariaDescription: spec.ariaDescription,
		ariaLabel: spec.ariaLabel,
		color: {
			domain: ['registry', 'factory', 'market', 'resolution', 'oracle', 'fork'],
			range: ['var(--blue-soft, #dceaf8)', 'var(--gold-soft, #f3e4c6)', 'var(--green-soft, #dcefe8)', 'var(--red-soft, #f2d9d6)', 'var(--blue-soft, #dceaf8)', 'var(--gold-soft, #f3e4c6)'],
		},
		height: spec.height,
		margin: 28,
		marks: [
			link(edges, { curve: 'bump-x', markerEnd: 'arrow', stroke: 'var(--muted, #465760)', strokeWidth: 2.2, x1: 'x1', x2: 'x2', y1: 'y1', y2: 'y2' }),
			...routedEdges.map(edge => line(edge.points, { markerEnd: 'arrow', stroke: 'var(--muted, #465760)', strokeWidth: 2.2, x: 'x', y: 'y' })),
			rect(nodes, { fill: 'fill', rx: 12, stroke: 'var(--ink, #1f2529)', strokeWidth: 1.6, x1: 'x1', x2: 'x2', y1: 'y1', y2: 'y2' }),
			text(nodes, { fill: 'var(--ink, #1f2529)', fontSize: 14, fontWeight: 700, text: 'id', x: node => (node.x1 + node.x2) / 2, y: node => (node.y1 + node.y2) / 2 }),
		],
		style: { background: 'transparent', color: 'var(--ink, currentColor)' },
		width: spec.width,
		x: { axis: null, domain: [-0.1, 10.7] },
		y: { axis: null, domain: [7.2, 0] },
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
	const repeatDeposit = readInput(example, 'depositLifecycle', 0) === 1
	const invalidBalance = repeatDeposit ? readInput(example, 'invalidBalance', 1) : 0
	const yesBalance = repeatDeposit ? readInput(example, 'yesBalance', 9) : 0
	const noBalance = repeatDeposit ? readInput(example, 'noBalance', 7) : 0
	const model = calculateEscalationDepositModel({
		invalidBalance,
		noBalance,
		nonDecisionThreshold: readInput(example, 'nonDecisionThreshold', 10),
		proposedDeposit: readInput(example, 'proposedDeposit', 5),
		repeatDeposit,
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
		ariaDescription: `${spec.ariaDescription}. This is a ${repeatDeposit ? 'repeat deposit into an existing game' : 'first deposit that creates the game'} with an effective start bond of ${formatAtomicRep(model.effectiveStartBondAtomic)} REP. The proposed No deposit ${model.previewReverts ? 'reverts' : `accepts ${acceptedLabel} REP`}; No ends at ${noAfterLabel} REP against a ${model.threshold.toFixed(2)} REP threshold.`,
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
	if (chartId === 'fig-zoltar-fork-threshold-decay') {
		return forkThresholdDecayChart(spec)
	}
	if (chartId === 'fig-statoblast-retention-utilization') {
		return retentionUtilizationChart(spec)
	}
	if (chartId === 'fig-liquidation-health-curve') {
		return liquidationHealthChart(spec, mount)
	}
	if (chartId === 'fig-contract-interaction-map') {
		return contractInteractionChart(spec)
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
	return markDrivenDiagramChart(spec)
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
	const overflowEnvelope = mount.closest<HTMLElement>('figure.diagram, .example-visual')
	if (overflowEnvelope === null) {
		throw new Error(`Plot chart ${chartId} is missing a scrollable figure or example envelope`)
	}
	overflowEnvelope.tabIndex = 0
	overflowEnvelope.setAttribute('aria-label', `Scrollable figure: ${spec.ariaLabel}`)
	mount.removeAttribute('aria-label')
	mount.removeAttribute('role')
	mount.replaceChildren(chart)
	mount.classList.add('plot-chart-ready')
}

const mounts = Array.from(document.querySelectorAll<HTMLElement>('[data-plot-chart]'))
for (const mount of mounts) {
	renderMount(mount)
}

for (const chartId of ['fig-auction-clearing-ladder', 'fig-liquidation-health-curve', 'plot-open-oracle-integration-2', 'plot-statoblast-whitepaper-7', 'plot-statoblast-whitepaper-8', 'plot-statoblast-whitepaper-19']) {
	const mount = document.querySelector<HTMLElement>(`[data-plot-chart="${chartId}"]`)
	const inputRoot = chartId === 'fig-auction-clearing-ladder' ? document.querySelector('#simple-auction-example') : mount?.closest('.interactive-example')
	const inputSelector = chartId === 'fig-liquidation-health-curve' ? '[data-liquidation-input]' : '[data-example-input]'
	for (const input of Array.from(inputRoot?.querySelectorAll<HTMLInputElement>(inputSelector) ?? [])) {
		input.addEventListener('input', () => {
			if (mount !== null && mount !== undefined) {
				renderMount(mount)
			}
		})
	}
}
