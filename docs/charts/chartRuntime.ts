import { areaY, barX, dot, line, lineY, plot, rect, ruleX, ruleY, text } from '@observablehq/plot'
import {
	calculateAnnualizedRetentionFeePercent,
	calculateAuctionModel,
	calculateCollateralRepairModel,
	calculateEscalationDepositModel,
	calculateForkThresholdSeries,
	calculateOracleSecurityModel,
	calculateResolutionModel,
	contractInteractionEdges,
	normalizedEscalationCost,
	quantitativeChartAxisLabels,
	quantitativeChartIds,
} from './chartModels'
import { hasDiagramOverflow, resolveChartEnvelopeWidth, updateDiagramControl } from './diagramControl'

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
const quantitativeChartIdSet = new Set<string>(quantitativeChartIds)

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

function formatRepFromAttoRep(valueAttoRep: bigint): string {
	const scale = 1_000_000_000_000_000_000n
	const whole = valueAttoRep / scale
	const fraction = (valueAttoRep % scale).toString().padStart(18, '0')
	return `${whole}.${fraction}`
}

function escalationCostChart(spec: ChartSpec): SVGSVGElement {
	const axes = quantitativeChartAxisLabels['fig-statoblast-escalation-cost-curve']
	const curve = Array.from({ length: 61 }, (_, index) => {
		const elapsed = index / 60
		return {
			elapsed,
			requiredRepFraction: normalizedEscalationCost(elapsed),
		}
	})
	const start = curve[0]
	const end = curve[curve.length - 1]
	if (start === undefined || end === undefined) {
		throw new Error('Escalation cost curve must include both endpoints')
	}
	return plot({
		ariaDescription: spec.ariaDescription,
		ariaLabel: spec.ariaLabel,
		height: spec.height,
		marginBottom: 46,
		marginLeft: 66,
		marginRight: 34,
		marginTop: 20,
		marks: [
			areaY(curve, {
				fill: 'var(--gold-soft, #f3e4c6)',
				x: 'elapsed',
				y: 'requiredRepFraction',
			}),
			lineY(curve, {
				stroke: 'var(--gold, #8a5d18)',
				strokeWidth: 3,
				x: 'elapsed',
				y: 'requiredRepFraction',
			}),
			ruleY([start.requiredRepFraction], { stroke: 'var(--green, #1d735d)', strokeDasharray: '5,4', strokeWidth: 2 }),
			ruleY([end.requiredRepFraction], { stroke: 'var(--red, #99453f)', strokeDasharray: '5,4', strokeWidth: 2 }),
			dot([start, end], {
				fill: (_datum, index) => (index === 0 ? 'var(--green, #1d735d)' : 'var(--red, #99453f)'),
				r: 6,
				x: 'elapsed',
				y: 'requiredRepFraction',
			}),
			text([{ elapsed: start.elapsed, label: `start bond ${(start.requiredRepFraction * 100).toFixed(1)}%`, requiredRepFraction: start.requiredRepFraction }], {
				dx: 9,
				dy: -10,
				fill: 'var(--green, #1d735d)',
				fontWeight: 700,
				text: 'label',
				textAnchor: 'start',
				x: 'elapsed',
				y: 'requiredRepFraction',
			}),
			text([{ elapsed: end.elapsed, label: 'non-decision threshold 100%', requiredRepFraction: end.requiredRepFraction }], {
				dx: -9,
				dy: 14,
				fill: 'var(--red, #99453f)',
				fontWeight: 700,
				text: 'label',
				textAnchor: 'end',
				x: 'elapsed',
				y: 'requiredRepFraction',
			}),
		],
		style: { background: 'transparent', color: 'var(--ink, currentColor)' },
		width: spec.width,
		x: { domain: [0, 1], grid: true, label: axes.x, tickFormat: (value: number) => `${Math.round(value * 100)}%` },
		y: { domain: [0, 1.06], grid: true, label: axes.y, tickFormat: (value: number) => `${Math.round(value * 100)}%` },
	}) as SVGSVGElement
}

function forkThresholdDecayChart(spec: ChartSpec): SVGSVGElement {
	const axes = quantitativeChartAxisLabels['fig-zoltar-fork-threshold-decay']
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
			lineY(generations, { stroke: 'var(--gold, #8a5d18)', strokeDasharray: '6,4', strokeWidth: 2, x: 'generation', y: 'forkThresholdRep' }),
			text(
				[
					{ generation: 15, label: 'theoretical supply', value: generations[15]?.theoreticalSupply ?? 0 },
					{ generation: 15, label: 'next fork threshold', value: generations[15]?.forkThresholdRep ?? 0 },
				],
				{ dy: -8, fill: datum => (datum.label === 'theoretical supply' ? 'var(--blue, #245f9f)' : 'var(--gold, #8a5d18)'), fontWeight: 650, text: 'label', x: 'generation', y: 'value' },
			),
		],
		style: { background: 'transparent', color: 'var(--ink, currentColor)' },
		width: spec.width,
		x: { grid: true, label: axes.x, ticks: 10 },
		y: { domain: [0, 100], grid: true, label: axes.y },
	}) as SVGSVGElement
}

function retentionUtilizationChart(spec: ChartSpec): SVGSVGElement {
	const axes = quantitativeChartAxisLabels['fig-statoblast-retention-utilization']
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
		x: { domain: [0, 100], grid: true, label: axes.x },
		y: { domain: [0, 55], grid: true, label: axes.y },
	}) as SVGSVGElement
}

function contractInteractionChart(spec: ChartSpec): SVGSVGElement {
	const panels = [
		{ id: 'deploy', subtitle: 'Construction-time validation and deployment', title: '1. Deploy & wire', x1: 0.1, x2: 11.9, y1: 0.1, y2: 3.2 },
		{ id: 'runtime', subtitle: 'Claims, dispute escrow, and guarded price execution', title: '2. Operate & resolve', x1: 0.1, x2: 11.9, y1: 3.45, y2: 6.55 },
		{ id: 'fork', subtitle: 'Child creation, REP migration, state migration, and backing repair', title: '3. Fork & repair', x1: 0.1, x2: 11.9, y1: 6.8, y2: 11.15 },
	]
	const nodes = [
		{ fill: 'registry', id: 'deploy-question', label: 'Question Data', x1: 0.4, x2: 2.2, y1: 0.65, y2: 1.25 },
		{ fill: 'registry', id: 'deploy-zoltar', label: 'Zoltar', x1: 0.4, x2: 2.2, y1: 1.5, y2: 2.1 },
		{ fill: 'registry', id: 'deploy-rep', label: 'Reputation Token', x1: 0.4, x2: 2.2, y1: 2.35, y2: 2.95 },
		{ fill: 'factory', id: 'deploy-factory', label: 'Pool Factory', x1: 4, x2: 6.1, y1: 1.5, y2: 2.1 },
		{ fill: 'market', id: 'deploy-pool', label: 'Security Pool', x1: 7.4, x2: 9.3, y1: 0.65, y2: 1.25 },
		{ fill: 'market', id: 'deploy-share', label: 'Share Token', x1: 9.7, x2: 11.5, y1: 1.5, y2: 2.1 },
		{ fill: 'oracle', id: 'deploy-coordinator', label: 'Price Coordinator', x1: 7.4, x2: 9.3, y1: 2.35, y2: 2.95 },
		{ fill: 'market', id: 'runtime-pool', label: 'Security Pool', x1: 0.4, x2: 2.3, y1: 4.75, y2: 5.35 },
		{ fill: 'market', id: 'runtime-share', label: 'Share Token', x1: 3, x2: 4.9, y1: 3.95, y2: 4.55 },
		{ fill: 'resolution', id: 'runtime-escalation', label: 'Escalation Game', x1: 3, x2: 4.9, y1: 5.55, y2: 6.15 },
		{ fill: 'oracle', id: 'runtime-coordinator', label: 'Price Coordinator', x1: 5.3, x2: 7.5, y1: 4.75, y2: 5.35 },
		{ fill: 'oracle', id: 'runtime-oracle', label: 'OpenOracle', x1: 9.1, x2: 11.2, y1: 4.75, y2: 5.35 },
		{ fill: 'market', id: 'fork-share', label: 'Share Token', x1: 0.4, x2: 2.3, y1: 7.35, y2: 7.95 },
		{ fill: 'resolution', id: 'fork-escalation', label: 'Escalation Game', x1: 0.4, x2: 2.3, y1: 8.3, y2: 8.9 },
		{ fill: 'fork', id: 'fork-proxy', label: 'Migration Proxy', x1: 0.4, x2: 2.3, y1: 9.25, y2: 9.85 },
		{ fill: 'registry', id: 'fork-zoltar', label: 'Zoltar', x1: 0.4, x2: 2.3, y1: 10.2, y2: 10.8 },
		{ fill: 'fork', id: 'fork-forker', label: 'Pool Forker', x1: 4.5, x2: 6.7, y1: 8.65, y2: 9.35 },
		{ fill: 'factory', id: 'fork-factory', label: 'Pool Factory', x1: 9.1, x2: 11.2, y1: 7.35, y2: 7.95 },
		{ fill: 'market', id: 'fork-pool', label: 'Security Pool', x1: 9.1, x2: 11.2, y1: 8.3, y2: 8.9 },
		{ fill: 'fork', id: 'fork-auction', label: 'Truth Auction', x1: 9.1, x2: 11.2, y1: 9.25, y2: 9.85 },
	]
	const routedEdgeIds = new Set(contractInteractionEdges.map(edge => edge.id))
	const routedEdges = [
		{
			id: 'factory-question-validation',
			labelX: 3.05,
			labelY: 1.28,
			receiverNodeId: 'deploy-question',
			sourceNodeId: 'deploy-factory',
			points: [
				{ x: 4, y: 1.63 },
				{ x: 3.1, y: 1.63 },
				{ x: 3.1, y: 0.95 },
				{ x: 2.2, y: 0.95 },
			],
		},
		{
			id: 'factory-universe-lookup',
			labelX: 3.1,
			labelY: 1.68,
			receiverNodeId: 'deploy-zoltar',
			sourceNodeId: 'deploy-factory',
			points: [
				{ x: 4, y: 1.8 },
				{ x: 2.2, y: 1.8 },
			],
		},
		{
			id: 'factory-pool-deployment',
			labelX: 6.78,
			labelY: 1.28,
			receiverNodeId: 'deploy-pool',
			sourceNodeId: 'deploy-factory',
			points: [
				{ x: 6.1, y: 1.63 },
				{ x: 6.75, y: 1.63 },
				{ x: 6.75, y: 0.95 },
				{ x: 7.4, y: 0.95 },
			],
		},
		{
			id: 'factory-share-token-deployment',
			labelX: 7.9,
			labelY: 1.68,
			receiverNodeId: 'deploy-share',
			sourceNodeId: 'deploy-factory',
			points: [
				{ x: 6.1, y: 1.8 },
				{ x: 9.7, y: 1.8 },
			],
		},
		{
			id: 'factory-price-coordinator-deployment',
			labelX: 6.78,
			labelY: 2.32,
			receiverNodeId: 'deploy-coordinator',
			sourceNodeId: 'deploy-factory',
			points: [
				{ x: 6.1, y: 1.97 },
				{ x: 6.75, y: 1.97 },
				{ x: 6.75, y: 2.65 },
				{ x: 7.4, y: 2.65 },
			],
		},
		{
			id: 'zoltar-reputation-token-lifecycle',
			labelX: 2.28,
			labelY: 2.23,
			receiverNodeId: 'deploy-rep',
			sourceNodeId: 'deploy-zoltar',
			points: [
				{ x: 1.3, y: 2.1 },
				{ x: 1.3, y: 2.35 },
			],
		},
		{
			id: 'pool-share-token-claims',
			labelX: 3.08,
			labelY: 4.62,
			receiverNodeId: 'runtime-share',
			sourceNodeId: 'runtime-pool',
			points: [
				{ x: 2.3, y: 4.92 },
				{ x: 2.65, y: 4.92 },
				{ x: 2.65, y: 4.25 },
				{ x: 3, y: 4.25 },
			],
		},
		{
			id: 'pool-escalation-game-resolution',
			labelX: 2.3,
			labelY: 5.73,
			receiverNodeId: 'runtime-escalation',
			sourceNodeId: 'runtime-pool',
			points: [
				{ x: 1.35, y: 5.35 },
				{ x: 1.35, y: 5.85 },
				{ x: 3, y: 5.85 },
			],
		},
		{
			id: 'pool-price-read',
			labelX: 3.8,
			labelY: 4.88,
			receiverNodeId: 'runtime-coordinator',
			sourceNodeId: 'runtime-pool',
			points: [
				{ x: 2.3, y: 4.95 },
				{ x: 5.3, y: 4.95 },
			],
		},
		{
			id: 'coordinator-pool-execute',
			labelX: 3.8,
			labelY: 5.28,
			receiverNodeId: 'runtime-pool',
			sourceNodeId: 'runtime-coordinator',
			points: [
				{ x: 5.3, y: 5.2 },
				{ x: 2.3, y: 5.2 },
			],
		},
		{
			id: 'coordinator-oracle-report',
			labelX: 8.3,
			labelY: 4.88,
			receiverNodeId: 'runtime-oracle',
			sourceNodeId: 'runtime-coordinator',
			points: [
				{ x: 7.5, y: 4.95 },
				{ x: 9.1, y: 4.95 },
			],
		},
		{
			id: 'oracle-coordinator-callback',
			labelX: 8.3,
			labelY: 5.28,
			receiverNodeId: 'runtime-coordinator',
			sourceNodeId: 'runtime-oracle',
			points: [
				{ x: 9.1, y: 5.2 },
				{ x: 7.5, y: 5.2 },
			],
		},
		{
			id: 'share-token-forker-migration',
			labelX: 3.9,
			labelY: 8.2,
			receiverNodeId: 'fork-forker',
			sourceNodeId: 'fork-share',
			points: [
				{ x: 2.3, y: 7.65 },
				{ x: 3.9, y: 7.65 },
				{ x: 3.9, y: 8.75 },
				{ x: 4.5, y: 8.75 },
			],
		},
		{
			id: 'forker-escalation-snapshot',
			labelX: 3.43,
			labelY: 8.75,
			receiverNodeId: 'fork-escalation',
			sourceNodeId: 'fork-forker',
			points: [
				{ x: 4.5, y: 8.83 },
				{ x: 3.45, y: 8.83 },
				{ x: 3.45, y: 8.6 },
				{ x: 2.3, y: 8.6 },
			],
		},
		{
			id: 'forker-migration-proxy',
			labelX: 3.4,
			labelY: 9.5,
			receiverNodeId: 'fork-proxy',
			sourceNodeId: 'fork-forker',
			points: [
				{ x: 4.5, y: 9.17 },
				{ x: 3.45, y: 9.17 },
				{ x: 3.45, y: 9.55 },
				{ x: 2.3, y: 9.55 },
			],
		},
		{
			id: 'migration-proxy-zoltar',
			labelX: 2.3,
			labelY: 10.02,
			receiverNodeId: 'fork-zoltar',
			sourceNodeId: 'fork-proxy',
			points: [
				{ x: 1.35, y: 9.85 },
				{ x: 1.35, y: 10.2 },
			],
		},
		{
			id: 'forker-child-deployment',
			labelX: 7.95,
			labelY: 7.78,
			receiverNodeId: 'fork-factory',
			sourceNodeId: 'fork-forker',
			points: [
				{ x: 6.7, y: 8.78 },
				{ x: 6.95, y: 8.78 },
				{ x: 6.95, y: 7.65 },
				{ x: 9.1, y: 7.65 },
			],
		},
		{
			id: 'forker-pool-migration',
			labelX: 7.92,
			labelY: 8.68,
			receiverNodeId: 'fork-pool',
			sourceNodeId: 'fork-forker',
			points: [
				{ x: 6.7, y: 9 },
				{ x: 9.1, y: 8.6 },
			],
		},
		{
			id: 'forker-truth-auction',
			labelX: 8.02,
			labelY: 9.48,
			receiverNodeId: 'fork-auction',
			sourceNodeId: 'fork-forker',
			points: [
				{ x: 6.7, y: 9.17 },
				{ x: 8, y: 9.17 },
				{ x: 8, y: 9.55 },
				{ x: 9.1, y: 9.55 },
			],
		},
	]
	const edgeById = new Map(contractInteractionEdges.map(edge => [edge.id, edge]))
	const nodeById = new Map(nodes.map(node => [node.id, node]))
	const panelById = new Map(panels.map(panel => [panel.id, panel]))
	const routedEdgeIdSet = new Set(routedEdges.map(edge => edge.id))
	if (routedEdgeIdSet.size !== routedEdgeIds.size || [...routedEdgeIds].some(edgeId => !routedEdgeIdSet.has(edgeId))) {
		throw new Error('Contract interaction chart routed edges do not match the shared interaction registry')
	}
	function panelForPhase(phase: string): string {
		switch (phase) {
			case 'Deployment':
			case 'Universe lifecycle':
				return 'deploy'
			case 'Market runtime':
			case 'Price discovery':
			case 'Price settlement':
			case 'Resolution':
			case 'Risk execution':
			case 'Risk operations':
				return 'runtime'
			case 'Backing repair':
			case 'Fork migration':
			case 'Fork snapshot':
			case 'Share migration':
				return 'fork'
			default:
				throw new Error(`Contract interaction chart has no panel for phase ${phase}`)
		}
	}
	function pointTouchesNodeBoundary(point: { x: number; y: number }, node: (typeof nodes)[number]): boolean {
		const tolerance = 0.000_001
		const withinX = point.x >= node.x1 - tolerance && point.x <= node.x2 + tolerance
		const withinY = point.y >= node.y1 - tolerance && point.y <= node.y2 + tolerance
		const touchesHorizontal = Math.abs(point.y - node.y1) <= tolerance || Math.abs(point.y - node.y2) <= tolerance
		const touchesVertical = Math.abs(point.x - node.x1) <= tolerance || Math.abs(point.x - node.x2) <= tolerance
		return (withinX && touchesHorizontal) || (withinY && touchesVertical)
	}
	for (const route of routedEdges) {
		const registryEdge = edgeById.get(route.id)
		const sourceNode = nodeById.get(route.sourceNodeId)
		const receiverNode = nodeById.get(route.receiverNodeId)
		const firstPoint = route.points[0]
		const lastPoint = route.points[route.points.length - 1]
		if (registryEdge === undefined || sourceNode === undefined || receiverNode === undefined || firstPoint === undefined || lastPoint === undefined) {
			throw new Error(`Contract interaction chart route ${route.id} is incomplete`)
		}
		const panel = panelForPhase(registryEdge.phase)
		const panelBounds = panelById.get(panel)
		if (sourceNode.label !== registryEdge.source || receiverNode.label !== registryEdge.receiver) {
			throw new Error(`Contract interaction chart route ${route.id} does not match registry direction ${registryEdge.source} to ${registryEdge.receiver}`)
		}
		if (panelBounds === undefined || !sourceNode.id.startsWith(`${panel}-`) || !receiverNode.id.startsWith(`${panel}-`)) {
			throw new Error(`Contract interaction chart route ${route.id} is not in its ${panel} phase panel`)
		}
		const sourceInsidePanel = sourceNode.x1 >= panelBounds.x1 && sourceNode.x2 <= panelBounds.x2 && sourceNode.y1 >= panelBounds.y1 && sourceNode.y2 <= panelBounds.y2
		const receiverInsidePanel = receiverNode.x1 >= panelBounds.x1 && receiverNode.x2 <= panelBounds.x2 && receiverNode.y1 >= panelBounds.y1 && receiverNode.y2 <= panelBounds.y2
		const routeInsidePanel = route.points.every(point => point.x >= panelBounds.x1 && point.x <= panelBounds.x2 && point.y >= panelBounds.y1 && point.y <= panelBounds.y2)
		if (!sourceInsidePanel || !receiverInsidePanel || !routeInsidePanel) {
			throw new Error(`Contract interaction chart route ${route.id} leaves its ${panel} phase panel bounds`)
		}
		if (!pointTouchesNodeBoundary(firstPoint, sourceNode) || !pointTouchesNodeBoundary(lastPoint, receiverNode)) {
			throw new Error(`Contract interaction chart route ${route.id} does not touch its source and receiver boundaries`)
		}
	}
	const panelTitles = panels.map(panel => ({ label: panel.title, x: panel.x1 + 0.22, y: panel.y1 + 0.27 }))
	const panelSubtitles = panels.map(panel => ({ label: panel.subtitle, x: panel.x1 + 2.2, y: panel.y1 + 0.27 }))
	const routeLabels = routedEdges.map(route => {
		const registryEdge = edgeById.get(route.id)
		if (registryEdge === undefined) throw new Error(`Contract interaction chart route ${route.id} has no registry edge`)
		return { label: registryEdge.action, x: route.labelX, y: route.labelY }
	})
	return plot({
		ariaDescription: spec.ariaDescription,
		ariaLabel: spec.ariaLabel,
		color: {
			domain: ['registry', 'factory', 'market', 'resolution', 'oracle', 'fork'],
			range: ['var(--blue-soft, #dceaf8)', 'var(--gold-soft, #f3e4c6)', 'var(--green-soft, #dcefe8)', 'var(--red-soft, #f2d9d6)', 'var(--blue-soft, #dceaf8)', 'var(--gold-soft, #f3e4c6)'],
		},
		height: spec.height,
		margin: 18,
		marks: [
			rect(panels, { fill: 'var(--paper, #fff)', rx: 14, stroke: 'var(--line, #d8e0e4)', strokeWidth: 1.4, x1: 'x1', x2: 'x2', y1: 'y1', y2: 'y2' }),
			text(panelTitles, { fill: 'var(--ink, #1f2529)', fontSize: 15, fontWeight: 750, text: 'label', textAnchor: 'start', x: 'x', y: 'y' }),
			text(panelSubtitles, { fill: 'var(--muted, #465760)', fontSize: 11, text: 'label', textAnchor: 'start', x: 'x', y: 'y' }),
			...routedEdges.map(edge => line(edge.points, { markerEnd: 'arrow', stroke: 'var(--muted, #465760)', strokeWidth: 2.2, x: 'x', y: 'y' })),
			text(routeLabels, { fill: 'var(--muted, #465760)', fontSize: 10, fontWeight: 650, stroke: 'var(--paper, #fff)', strokeWidth: 4, text: 'label', x: 'x', y: 'y' }),
			rect(nodes, { fill: 'fill', rx: 10, stroke: 'var(--ink, #1f2529)', strokeWidth: 1.5, x1: 'x1', x2: 'x2', y1: 'y1', y2: 'y2' }),
			text(nodes, { fill: 'var(--ink, #1f2529)', fontSize: 12, fontWeight: 700, text: 'label', x: node => (node.x1 + node.x2) / 2, y: node => (node.y1 + node.y2) / 2 }),
		],
		style: { background: 'transparent', color: 'var(--ink, currentColor)' },
		width: spec.width,
		x: { axis: null, domain: [0, 12] },
		y: { axis: null, domain: [11.3, 0] },
	}) as SVGSVGElement
}

function auctionDemandChart(spec: ChartSpec, mount: HTMLElement): SVGSVGElement {
	const axes = quantitativeChartAxisLabels['fig-auction-clearing-ladder']
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
		x: { domain: [0, maxRep * 1.08], grid: true, label: axes.x },
		y: { domain: [0, yMax], grid: true, label: axes.y },
	}) as SVGSVGElement
	chart.dataset['chartState'] = model.mode
	mount.dataset['chartState'] = chart.dataset['chartState']
	return chart
}

function collateralRepairChart(spec: ChartSpec, mount: HTMLElement): SVGSVGElement {
	const axes = quantitativeChartAxisLabels['plot-statoblast-whitepaper-19']
	const example = mount.closest('#collateral-repair-example')
	const parentSettlementCollateral = Math.max(readInput(example, 'parentSettlementCollateral', 50), 0)
	const model = calculateCollateralRepairModel(parentSettlementCollateral, readInput(example, 'forkSettlementCollateralReceived', 47.5), readInput(example, 'auctionRaised', 2.5))
	const parts = [
		{ kind: 'Migration-routed', x1: 0, x2: model.received },
		{ kind: 'Auction repair', x1: model.received, x2: model.received + model.repairEth },
	]
	const chart = plot({
		ariaDescription: `${spec.ariaDescription}. Migration routed ${model.received.toFixed(2)} ETH and the auction repairs ${model.repairEth.toFixed(2)} ETH toward the ${parentSettlementCollateral.toFixed(2)} ETH target, leaving ${model.remainingShortfall.toFixed(2)} ETH unfilled.`,
		ariaLabel: spec.ariaLabel,
		color: {
			domain: ['Migration-routed', 'Auction repair'],
			range: ['var(--blue, #245f9f)', 'var(--green, #1d735d)'],
		},
		height: spec.height,
		marginBottom: 44,
		marginLeft: 124,
		marginRight: 28,
		marginTop: 52,
		marks: [
			barX(parts, { fill: 'kind', inset: 2, x1: 'x1', x2: 'x2', y: () => 'Child collateral' }),
			ruleX([parentSettlementCollateral], { stroke: 'var(--gold, #8a5d18)', strokeDasharray: '5,4', strokeWidth: 2 }),
			text(
				[
					{ kind: 'Migration-routed', label: '■ Migration-routed', value: parentSettlementCollateral * 0.24 },
					{ kind: 'Auction repair', label: '■ Auction repair', value: parentSettlementCollateral * 0.68 },
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
			text([{ label: `target ${parentSettlementCollateral.toFixed(2)} ETH`, value: parentSettlementCollateral }], {
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
		x: { domain: [0, Math.max(parentSettlementCollateral, model.received + model.repairEth, 1)], grid: true, label: axes.x },
		y: { label: axes.y },
	}) as SVGSVGElement
	chart.dataset['chartState'] = model.remainingShortfall === 0 ? 'repaired' : 'partial'
	mount.dataset['chartState'] = chart.dataset['chartState']
	return chart
}

function oracleSecurityChart(spec: ChartSpec, mount: HTMLElement): SVGSVGElement {
	const axes = quantitativeChartAxisLabels['plot-open-oracle-integration-2']
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
		x: { domain: [0, maxDuration], grid: true, label: axes.x },
		y: { grid: true, label: axes.y },
	}) as SVGSVGElement
}

function escalationDepositChart(spec: ChartSpec, mount: HTMLElement): SVGSVGElement {
	const axes = quantitativeChartAxisLabels['plot-statoblast-whitepaper-7']
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
	const acceptedLabel = model.tieAdjusted ? formatRepFromAttoRep(model.acceptedAttoRep) : model.accepted.toFixed(6)
	const noAfterLabel = model.tieAdjusted ? formatRepFromAttoRep(model.noAfterAttoRep) : model.noAfter.toFixed(6)
	const chart = plot({
		ariaDescription: `${spec.ariaDescription}. This is a ${repeatDeposit ? 'repeat deposit into an existing game' : 'first deposit that creates the game'} with an effective start bond of ${formatRepFromAttoRep(model.effectiveStartBondAttoRep)} REP. The proposed No deposit ${model.previewReverts ? 'reverts' : `accepts ${acceptedLabel} REP`}; No ends at ${noAfterLabel} REP against a ${model.threshold.toFixed(2)} REP threshold.`,
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
		x: { domain: [0, Math.max(model.threshold, ...balances.map(item => item.balance), 1)], grid: true, label: axes.x },
		y: { domain: ['Invalid', 'Yes', 'No'], label: axes.y },
	}) as SVGSVGElement
	chart.dataset['chartState'] = model.previewReverts ? 'reverts' : 'accepted'
	return chart
}

function resolutionChart(spec: ChartSpec, mount: HTMLElement): SVGSVGElement {
	const axes = quantitativeChartAxisLabels['plot-statoblast-whitepaper-8']
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
		x: { domain: [0, Math.max(runningCost, ...balances.map(item => item.balance), 1)], grid: true, label: axes.x },
		y: { domain: ['Invalid', 'Yes', 'No'], label: axes.y },
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

function chartEnvelopeWidth(overflowEnvelope: HTMLElement): number {
	const envelopeWidth = overflowEnvelope.getBoundingClientRect().width
	const parentWidth = overflowEnvelope.parentElement?.getBoundingClientRect().width ?? 0
	return resolveChartEnvelopeWidth(envelopeWidth, parentWidth, document.documentElement.clientWidth)
}

function responsiveChartSpec(spec: ChartSpec, overflowEnvelope: HTMLElement): ChartSpec {
	const availableWidth = Math.max(280, Math.floor(chartEnvelopeWidth(overflowEnvelope) - 16))
	return { ...spec, width: Math.min(spec.width, availableWidth) }
}

function dispatchChartLayout(): void {
	window.dispatchEvent(new CustomEvent('docs:charts-rendered'))
}

function fullSizeDiagramOverflows(overflowEnvelope: HTMLElement): boolean {
	const wasFit = overflowEnvelope.classList.contains('plot-figure-fit')
	if (wasFit) overflowEnvelope.classList.remove('plot-figure-fit')
	const overflows = hasDiagramOverflow(overflowEnvelope.clientWidth, overflowEnvelope.scrollWidth)
	if (wasFit) overflowEnvelope.classList.add('plot-figure-fit')
	return overflows
}

function updateDiagramToolbar(overflowEnvelope: HTMLElement): void {
	const toolbar = overflowEnvelope.querySelector<HTMLElement>(':scope > .plot-chart-toolbar')
	const button = toolbar?.querySelector<HTMLButtonElement>('button')
	const cue = toolbar?.querySelector<HTMLElement>('.plot-chart-pan-cue')
	if (toolbar === null || toolbar === undefined || button === null || button === undefined || cue === null || cue === undefined) return
	const needsControl = fullSizeDiagramOverflows(overflowEnvelope)
	toolbar.hidden = !needsControl
	if (!needsControl) return
	const isFit = overflowEnvelope.classList.contains('plot-figure-fit')
	updateDiagramControl(button, cue, isFit)
}

function ensureDiagramToolbar(overflowEnvelope: HTMLElement): void {
	let toolbar = overflowEnvelope.querySelector<HTMLElement>(':scope > .plot-chart-toolbar')
	if (toolbar === null) {
		toolbar = document.createElement('div')
		toolbar.className = 'plot-chart-toolbar'
		toolbar.setAttribute('role', 'group')
		toolbar.setAttribute('aria-label', 'Diagram display')
		const button = document.createElement('button')
		button.type = 'button'
		const cue = document.createElement('span')
		cue.className = 'plot-chart-pan-cue'
		toolbar.append(button, cue)
		overflowEnvelope.prepend(toolbar)
		overflowEnvelope.classList.add('plot-figure-fit')
		button.addEventListener('click', () => {
			overflowEnvelope.classList.toggle('plot-figure-fit')
			updateDiagramToolbar(overflowEnvelope)
			dispatchChartLayout()
		})
	}
	updateDiagramToolbar(overflowEnvelope)
}

const observedEnvelopes = new WeakSet<HTMLElement>()

function observeChartEnvelope(mount: HTMLElement, overflowEnvelope: HTMLElement, chartId: string, spec: ChartSpec): void {
	if (observedEnvelopes.has(overflowEnvelope) || typeof ResizeObserver === 'undefined') return
	observedEnvelopes.add(overflowEnvelope)
	let scheduled = false
	const observer = new ResizeObserver(() => {
		if (scheduled) return
		scheduled = true
		requestAnimationFrame(() => {
			scheduled = false
			if (quantitativeChartIdSet.has(chartId)) {
				const expectedWidth = responsiveChartSpec(spec, overflowEnvelope).width
				const currentWidth = Number(mount.dataset['renderedChartWidth'])
				if (!Number.isFinite(currentWidth) || Math.abs(expectedWidth - currentWidth) > 1) {
					renderMount(mount)
					dispatchChartLayout()
				}
			} else {
				updateDiagramToolbar(overflowEnvelope)
			}
		})
	})
	observer.observe(overflowEnvelope)
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
	const overflowEnvelope = mount.closest<HTMLElement>('figure.diagram, .example-visual')
	if (overflowEnvelope === null) {
		throw new Error(`Plot chart ${chartId} is missing a scrollable figure or example envelope`)
	}
	const isQuantitative = quantitativeChartIdSet.has(chartId)
	const renderSpec = isQuantitative ? responsiveChartSpec(spec, overflowEnvelope) : spec
	const chart = createChart(chartId, renderSpec, mount)
	if (!(chart instanceof SVGSVGElement)) {
		throw new Error(`Plot chart ${chartId} did not produce an SVG root`)
	}
	chart.dataset['plotGenerated'] = 'true'
	chart.setAttribute('role', 'img')
	if (!chart.hasAttribute('viewBox')) {
		chart.setAttribute('viewBox', `0 0 ${renderSpec.width} ${renderSpec.height}`)
	}
	overflowEnvelope.tabIndex = 0
	overflowEnvelope.classList.toggle('plot-figure-quantitative', isQuantitative)
	overflowEnvelope.classList.toggle('plot-figure-diagram', !isQuantitative)
	overflowEnvelope.classList.toggle('plot-figure-fit', !isQuantitative)
	overflowEnvelope.setAttribute('aria-label', isQuantitative ? `Responsive chart: ${spec.ariaLabel}` : `Scrollable figure: ${spec.ariaLabel}`)
	mount.removeAttribute('aria-label')
	mount.removeAttribute('role')
	mount.replaceChildren(chart)
	mount.classList.add('plot-chart-ready')
	mount.dataset['renderedChartWidth'] = String(renderSpec.width)
	if (!isQuantitative) {
		ensureDiagramToolbar(overflowEnvelope)
	}
	observeChartEnvelope(mount, overflowEnvelope, chartId, spec)
}

const mounts = Array.from(document.querySelectorAll<HTMLElement>('[data-plot-chart]'))
for (const mount of mounts) {
	renderMount(mount)
}
dispatchChartLayout()

function restoreDocumentFragment(): void {
	const rawFragment = window.location.hash.slice(1)
	if (rawFragment.length === 0) return
	let fragment = rawFragment
	try {
		fragment = decodeURIComponent(rawFragment)
	} catch (error) {
		if (!(error instanceof URIError)) throw error
	}
	const target = document.getElementById(fragment)
	if (!(target instanceof HTMLElement)) return
	if (target instanceof HTMLDetailsElement) target.open = true
	const containingDetails = target.closest('details')
	if (containingDetails instanceof HTMLDetailsElement) containingDetails.open = true
	const targetTop = target.getBoundingClientRect().top + window.scrollY
	window.scrollTo({ behavior: 'instant', top: Math.max(0, targetTop - 16) })
}

requestAnimationFrame(() => {
	requestAnimationFrame(restoreDocumentFragment)
})
window.setTimeout(restoreDocumentFragment, 180)
window.setTimeout(restoreDocumentFragment, 600)
window.addEventListener('load', restoreDocumentFragment)
window.addEventListener('docs:tools-ready', restoreDocumentFragment)

for (const chartId of ['fig-auction-clearing-ladder', 'plot-open-oracle-integration-2', 'plot-statoblast-whitepaper-7', 'plot-statoblast-whitepaper-8', 'plot-statoblast-whitepaper-19']) {
	const mount = document.querySelector<HTMLElement>(`[data-plot-chart="${chartId}"]`)
	const inputRoot = chartId === 'fig-auction-clearing-ladder' ? document.querySelector('#simple-auction-example') : mount?.closest('.interactive-example')
	for (const input of Array.from(inputRoot?.querySelectorAll<HTMLInputElement>('[data-example-input]') ?? [])) {
		input.addEventListener('input', () => {
			if (mount !== null && mount !== undefined) {
				renderMount(mount)
				dispatchChartLayout()
			}
		})
	}
}
