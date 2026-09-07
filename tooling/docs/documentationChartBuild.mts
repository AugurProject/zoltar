import path from 'node:path'

import { quantitativeChartMetadata } from '../docs/charts/chartMetadata'
import { createDiagramLayouts } from '../docs/charts/diagramLayout'
import type { ChartMetadata, DiagramLayoutSpec } from '../docs/charts/diagramTypes'

const repositoryRoot = path.resolve(import.meta.dir, '..')
const entrypoint = path.join(repositoryRoot, 'docs/charts/chartRuntime.ts')
const virtualLayoutsModule = 'virtual:diagram-layouts'

type PlotDiagramNode = {
	attributes?: Record<string, string>
	children?: PlotDiagramNode[]
	tag?: string
	text?: string
}

type PlotDiagramSpec = ChartMetadata & {
	nodes: PlotDiagramNode[]
}

function textNode(text: string, className: string, x: number, y: number, anchor: 'middle' | 'start' = 'middle', nodeId?: string): PlotDiagramNode {
	let fontSize = 13
	if (className === 'svg-label') fontSize = 17
	if (className === 'elk-panel-description' || className === 'elk-edge-label') fontSize = 11
	return {
		attributes: { class: className, ...(nodeId === undefined ? {} : { 'data-node-id': nodeId }), x: String(x), y: String(y + fontSize * 0.34), 'text-anchor': anchor },
		children: [{ text }],
		tag: 'text',
	}
}

function diagramPlotSpec(layout: DiagramLayoutSpec): PlotDiagramSpec {
	const nodes: PlotDiagramNode[] = []
	for (const panel of layout.panels) {
		nodes.push({ attributes: { class: 'elk-panel', height: String(panel.height), rx: '14', width: String(panel.width), x: String(panel.x), y: String(panel.y) }, tag: 'rect' })
		if (panel.title !== undefined) nodes.push(textNode(panel.title, 'svg-label', panel.x + 18, panel.y + 19, 'start'))
		if (panel.description !== undefined) nodes.push(textNode(panel.description, 'elk-panel-description', panel.x + 18, panel.y + 39, 'start'))
	}
	for (const candidate of layout.edges) {
		nodes.push({
			attributes: {
				class: candidate.className,
				'data-edge-id': candidate.id,
				'marker-end': 'elk-arrow',
				points: candidate.points.map(point => `${point.x},${point.y}`).join(' '),
				...(candidate.dashed ? { 'stroke-dasharray': '6,5' } : {}),
				'stroke-width': '2.2',
			},
			tag: 'polyline',
		})
		if (candidate.label !== undefined && candidate.labelX !== undefined && candidate.labelY !== undefined) {
			nodes.push(textNode(candidate.label, 'elk-edge-label', candidate.labelX, candidate.labelY))
		}
	}
	for (const candidate of layout.nodes) {
		nodes.push({ attributes: { class: candidate.className, 'data-node-id': candidate.id, height: String(candidate.height), rx: '10', width: String(candidate.width), x: String(candidate.x), y: String(candidate.y) }, tag: 'rect' })
		const centerX = candidate.x + candidate.width / 2
		const centerY = candidate.y + candidate.height / 2
		const titleY = centerY - candidate.details.length * 9
		nodes.push(textNode(candidate.title, 'svg-label', centerX, titleY, 'middle', candidate.id))
		for (const [index, detail] of candidate.details.entries()) nodes.push(textNode(detail, 'svg-small', centerX, titleY + 21 + index * 17, 'middle', candidate.id))
	}
	return { ariaDescription: layout.ariaDescription, ariaLabel: layout.ariaLabel, height: layout.height, nodes, width: layout.width }
}

function quantitativePlotSpec(metadata: ChartMetadata): PlotDiagramSpec {
	return { ...metadata, nodes: [] }
}

export async function buildDocumentationChartBundle(): Promise<string> {
	const layouts = await createDiagramLayouts()
	const chartSpecs: Record<string, PlotDiagramSpec> = {}
	for (const [chartId, layout] of Object.entries(layouts)) chartSpecs[chartId] = diagramPlotSpec(layout)
	const quantitativeMetadata: Record<string, ChartMetadata> = quantitativeChartMetadata
	for (const [chartId, metadata] of Object.entries(quantitativeMetadata)) chartSpecs[chartId] = quantitativePlotSpec(metadata)
	const result = await Bun.build({
		entrypoints: [entrypoint],
		minify: true,
		plugins: [
			{
				name: 'documentation-elk-layouts',
				setup(build) {
					build.onResolve({ filter: /^virtual:diagram-layouts$/ }, () => ({ namespace: 'documentation-elk-layouts', path: virtualLayoutsModule }))
					build.onLoad({ filter: /.*/, namespace: 'documentation-elk-layouts' }, () => ({ contents: `export default ${JSON.stringify(chartSpecs)}`, loader: 'js' }))
				},
			},
		],
		target: 'browser',
	})
	if (!result.success) throw new AggregateError(result.logs, 'Could not build documentation charts')
	const output = result.outputs.find(candidate => candidate.kind === 'entry-point')
	if (output === undefined) throw new Error('Documentation chart build did not produce an entry-point')
	return output.text()
}
