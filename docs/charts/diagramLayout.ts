import ELK from 'elkjs/lib/elk-api.js'
import type { ElkExtendedEdge, ElkLabel, ElkNode } from 'elkjs/lib/elk-api'

import { diagramGraphSpecs } from './diagramModels'
import type { DiagramGraphNode, DiagramGraphSection, DiagramGraphSpec, DiagramLayoutEdge, DiagramLayoutNode, DiagramLayoutPanel, DiagramLayoutSpec } from './diagramTypes'

const OUTER_MARGIN = 18
const PANEL_GAP = 20
const PANEL_HEADER_HEIGHT = 52
const PANEL_PADDING = 18

type SectionLayout = {
	edges: DiagramLayoutEdge[]
	height: number
	nodes: DiagramLayoutNode[]
	section: DiagramGraphSection
	width: number
}

function nodeWidth(node: DiagramGraphNode): number {
	if (node.width !== undefined) return node.width
	const titleWidth = node.title.length * 9.2 + 60
	const detailWidth = Math.max(0, ...(node.details ?? []).map(line => line.length * 7.5 + 52))
	return Math.min(340, Math.max(160, titleWidth, detailWidth))
}

function nodeHeight(node: DiagramGraphNode): number {
	return 48 + (node.details?.length ?? 0) * 18
}

function edgeLabel(label: string | undefined): ElkLabel[] | undefined {
	if (label === undefined) return undefined
	return [{ height: 18, text: label, width: Math.max(38, label.length * 6.2 + 14) }]
}

function classNameForNode(node: DiagramGraphNode): string {
	return node.kind === undefined || node.kind === 'neutral' ? 'svg-box' : `svg-${node.kind}`
}

function requiredNumber(value: number | undefined, context: string): number {
	if (value === undefined || !Number.isFinite(value)) throw new Error(`ELK layout is missing ${context}`)
	return value
}

function sectionGraph(spec: DiagramGraphSpec, section: DiagramGraphSection): ElkNode {
	const nodeIds = new Set(section.nodes.map(candidate => candidate.id))
	if (nodeIds.size !== section.nodes.length) throw new Error(`ELK diagram section ${section.id} contains duplicate node ids`)
	for (const candidate of section.edges) {
		if (!nodeIds.has(candidate.source) || !nodeIds.has(candidate.target)) {
			throw new Error(`ELK diagram edge ${candidate.id} references a missing node in ${section.id}`)
		}
	}
	return {
		children: section.nodes.map(candidate => ({ height: nodeHeight(candidate), id: candidate.id, width: nodeWidth(candidate) })),
		edges: section.edges.map(candidate => {
			const labels = edgeLabel(candidate.label)
			return { id: candidate.id, ...(labels === undefined ? {} : { labels }), sources: [candidate.source], targets: [candidate.target] }
		}),
		id: `${section.id}-root`,
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': section.direction ?? spec.direction ?? 'RIGHT',
			'elk.edgeRouting': 'ORTHOGONAL',
			'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
			'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
			'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
			'elk.layered.spacing.edgeNodeBetweenLayers': '18',
			'elk.layered.spacing.nodeNodeBetweenLayers': '54',
			'elk.padding': '[top=18,left=18,bottom=18,right=18]',
			'elk.spacing.nodeNode': '26',
		},
	}
}

function edgePoints(edge: ElkExtendedEdge, sectionId: string): { x: number; y: number }[] {
	const edgeSection = edge.sections?.[0]
	if (edgeSection === undefined || edge.sections?.length !== 1) {
		throw new Error(`ELK diagram edge ${edge.id} in ${sectionId} must produce one routed section`)
	}
	return [edgeSection.startPoint, ...(edgeSection.bendPoints ?? []), edgeSection.endPoint]
}

function edgeLabelPosition(points: { x: number; y: number }[]): { x: number; y: number } {
	let longestStart = points[0]
	let longestEnd = points[1]
	let longestLength = -1
	for (let index = 1; index < points.length; index += 1) {
		const start = points[index - 1]
		const end = points[index]
		if (start === undefined || end === undefined) continue
		const length = (end.x - start.x) ** 2 + (end.y - start.y) ** 2
		if (length > longestLength) {
			longestLength = length
			longestStart = start
			longestEnd = end
		}
	}
	if (longestStart === undefined || longestEnd === undefined) throw new Error('ELK edge needs at least two route points')
	const horizontal = Math.abs(longestEnd.x - longestStart.x) >= Math.abs(longestEnd.y - longestStart.y)
	return {
		x: (longestStart.x + longestEnd.x) / 2 + (horizontal ? 0 : 8),
		y: (longestStart.y + longestEnd.y) / 2 + (horizontal ? -9 : 0),
	}
}

async function layoutSection(elk: InstanceType<typeof ELK>, chartId: string, spec: DiagramGraphSpec, section: DiagramGraphSection): Promise<SectionLayout> {
	const result = await elk.layout(sectionGraph(spec, section))
	const sourceNodes = new Map(section.nodes.map(candidate => [candidate.id, candidate]))
	const sourceEdges = new Map(section.edges.map(candidate => [candidate.id, candidate]))
	const nodes = (result.children ?? []).map(candidate => {
		const source = sourceNodes.get(candidate.id)
		if (source === undefined) throw new Error(`ELK returned unknown node ${candidate.id} for ${chartId}`)
		return {
			className: classNameForNode(source),
			details: source.details ?? [],
			height: requiredNumber(candidate.height, `${chartId} node ${candidate.id} height`),
			id: `${chartId}:${section.id}:${candidate.id}`,
			title: source.title,
			width: requiredNumber(candidate.width, `${chartId} node ${candidate.id} width`),
			x: requiredNumber(candidate.x, `${chartId} node ${candidate.id} x`),
			y: requiredNumber(candidate.y, `${chartId} node ${candidate.id} y`),
		}
	})
	const edges = (result.edges ?? []).map(candidate => {
		const source = sourceEdges.get(candidate.id)
		if (source === undefined) throw new Error(`ELK returned unknown edge ${candidate.id} for ${chartId}`)
		const points = edgePoints(candidate, section.id)
		const layoutLabel = candidate.labels?.[0]
		let labelPosition: { x: number; y: number } | undefined
		if (source.label !== undefined) {
			if (layoutLabel?.x === undefined || layoutLabel.y === undefined || layoutLabel.width === undefined || layoutLabel.height === undefined) {
				labelPosition = edgeLabelPosition(points)
			} else {
				labelPosition = { x: layoutLabel.x + layoutLabel.width / 2, y: layoutLabel.y + layoutLabel.height / 2 }
			}
		}
		return {
			className: 'svg-line',
			dashed: source.dashed ?? false,
			id: source.id,
			...(source.label === undefined ? {} : { label: source.label }),
			...(labelPosition === undefined ? {} : { labelX: labelPosition.x, labelY: labelPosition.y }),
			points,
		}
	})
	if (nodes.length !== section.nodes.length || edges.length !== section.edges.length) {
		throw new Error(`ELK layout for ${chartId}/${section.id} changed the declared node or edge count`)
	}
	return {
		edges,
		height: requiredNumber(result.height, `${chartId}/${section.id} height`),
		nodes,
		section,
		width: requiredNumber(result.width, `${chartId}/${section.id} width`),
	}
}

function offsetSection(layout: SectionLayout, offsetX: number, offsetY: number): { edges: DiagramLayoutEdge[]; nodes: DiagramLayoutNode[] } {
	return {
		edges: layout.edges.map(candidate => ({
			...candidate,
			...(candidate.labelX === undefined ? {} : { labelX: candidate.labelX + offsetX }),
			...(candidate.labelY === undefined ? {} : { labelY: candidate.labelY + offsetY }),
			points: candidate.points.map(point => ({ x: point.x + offsetX, y: point.y + offsetY })),
		})),
		nodes: layout.nodes.map(candidate => ({ ...candidate, x: candidate.x + offsetX, y: candidate.y + offsetY })),
	}
}

function assembleDiagram(spec: DiagramGraphSpec, sectionLayouts: SectionLayout[]): DiagramLayoutSpec {
	const metadata = { ariaDescription: spec.ariaDescription, ariaLabel: spec.ariaLabel, height: spec.height, width: spec.width }
	const usesPanels = sectionLayouts.length > 1 || sectionLayouts.some(layout => layout.section.title !== undefined || layout.section.description !== undefined)
	const widestSection = Math.max(...sectionLayouts.map(layout => layout.width))
	const width = Math.ceil(Math.max(spec.width, widestSection + OUTER_MARGIN * 2 + (usesPanels ? PANEL_PADDING * 2 : 0)))
	if (!usesPanels) {
		const layout = sectionLayouts[0]
		if (layout === undefined) throw new Error(`ELK diagram ${spec.ariaLabel} has no sections`)
		const height = Math.ceil(Math.max(spec.height, layout.height + OUTER_MARGIN * 2))
		const positioned = offsetSection(layout, (width - layout.width) / 2, (height - layout.height) / 2)
		return { ...metadata, edges: positioned.edges, height, nodes: positioned.nodes, panels: [], width }
	}

	const panelWidth = width - OUTER_MARGIN * 2
	const panelHeights = sectionLayouts.map(layout => PANEL_HEADER_HEIGHT + PANEL_PADDING * 2 + layout.height)
	const contentHeight = panelHeights.reduce((total, height) => total + height, 0) + PANEL_GAP * Math.max(0, panelHeights.length - 1)
	const height = Math.ceil(Math.max(spec.height, contentHeight + OUTER_MARGIN * 2))
	let panelY = (height - contentHeight) / 2
	const nodes: DiagramLayoutNode[] = []
	const edges: DiagramLayoutEdge[] = []
	const panels: DiagramLayoutPanel[] = []
	for (const [index, layout] of sectionLayouts.entries()) {
		const panelHeight = panelHeights[index]
		if (panelHeight === undefined) throw new Error(`ELK diagram ${spec.ariaLabel} is missing a panel height`)
		panels.push({
			...(layout.section.description === undefined ? {} : { description: layout.section.description }),
			height: panelHeight,
			id: layout.section.id,
			...(layout.section.title === undefined ? {} : { title: layout.section.title }),
			width: panelWidth,
			x: OUTER_MARGIN,
			y: panelY,
		})
		const offsetX = OUTER_MARGIN + (panelWidth - layout.width) / 2
		const offsetY = panelY + PANEL_HEADER_HEIGHT + PANEL_PADDING
		const positioned = offsetSection(layout, offsetX, offsetY)
		nodes.push(...positioned.nodes)
		edges.push(...positioned.edges)
		panelY += panelHeight + PANEL_GAP
	}
	return { ...metadata, edges, height, nodes, panels, width }
}

export async function createDiagramLayouts(): Promise<Record<string, DiagramLayoutSpec>> {
	const workerUrl = import.meta.resolve('elkjs/lib/elk-worker.min.js')
	const elk = new ELK({
		workerFactory: url => {
			if (url === undefined) throw new Error('ELK worker URL is required')
			return new Worker(url)
		},
		workerUrl,
	})
	try {
		const layouts: Record<string, DiagramLayoutSpec> = {}
		const graphSpecs: Record<string, DiagramGraphSpec> = diagramGraphSpecs
		for (const [chartId, spec] of Object.entries(graphSpecs)) {
			const sectionLayouts: SectionLayout[] = []
			for (const candidate of spec.sections) sectionLayouts.push(await layoutSection(elk, chartId, spec, candidate))
			layouts[chartId] = assembleDiagram(spec, sectionLayouts)
		}
		return layouts
	} finally {
		elk.terminateWorker()
	}
}
