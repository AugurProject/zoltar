import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { Window } from 'happy-dom'

import { contractInteractionEdges } from '../docs/charts/chartModels'

const repositoryRoot = path.resolve(import.meta.dir, '..')
const docsDirectory = path.join(repositoryRoot, 'docs')
const entrypoint = path.join(repositoryRoot, 'docs/charts/chartRuntime.ts')
const generatedPath = path.join(repositoryRoot, 'docs/chartRuntime.js')
const specsPath = path.join(repositoryRoot, 'docs/charts/diagramSpecs.json')
const expectedChartCount = 40
const supportedDiagramTags = new Set(['circle', 'defs', 'line', 'marker', 'path', 'polyline', 'rect', 'text', 'tspan'])
const nativeChartIds = new Set([
	'fig-auction-clearing-ladder',
	'fig-contract-interaction-map',
	'fig-liquidation-health-curve',
	'fig-statoblast-escalation-cost-curve',
	'fig-statoblast-retention-utilization',
	'fig-zoltar-fork-threshold-decay',
	'plot-open-oracle-integration-2',
	'plot-statoblast-whitepaper-7',
	'plot-statoblast-whitepaper-8',
	'plot-statoblast-whitepaper-19',
])

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertChartNode(value: unknown, chartId: string): void {
	if (!isRecord(value)) {
		throw new Error(`Chart ${chartId} contains a non-object node`)
	}
	if (typeof value['text'] === 'string') {
		return
	}
	if (typeof value['tag'] !== 'string' || value['tag'].length === 0) {
		throw new Error(`Chart ${chartId} contains a node without a tag`)
	}
	if (!supportedDiagramTags.has(value['tag'])) {
		throw new Error(`Chart ${chartId} contains unsupported native Plot diagram tag ${value['tag']}`)
	}
	const attributes = value['attributes']
	if (attributes !== undefined && (!isRecord(attributes) || Object.values(attributes).some(attribute => typeof attribute !== 'string'))) {
		throw new Error(`Chart ${chartId} contains invalid node attributes`)
	}
	const children = value['children']
	if (children !== undefined) {
		if (!Array.isArray(children)) {
			throw new Error(`Chart ${chartId} contains non-array children`)
		}
		for (const child of children) {
			assertChartNode(child, chartId)
		}
	}
}

const [htmlEntries, specsSource, runtimeSource] = await Promise.all([readdir(docsDirectory), readFile(specsPath, 'utf8'), readFile(entrypoint, 'utf8')])
const mountIds: string[] = []
const mergedDescriptionBoundaryPattern = /(?:FlowThe|treeA|SplitThe|ReproductionSelecting|AnswerA)/
for (const entry of htmlEntries.filter(item => item.endsWith('.html'))) {
	const html = await readFile(path.join(docsDirectory, entry), 'utf8')
	if (/<svg\b/.test(html)) {
		throw new Error(`Documentation HTML docs/${entry} contains a literal SVG instead of a Plot mount`)
	}
	if (mergedDescriptionBoundaryPattern.test(html)) {
		throw new Error(`Documentation chart fallback in docs/${entry} has a merged description boundary`)
	}
	const window = new Window()
	window.document.write(html)
	window.document.close()
	for (const mount of window.document.querySelectorAll('[data-plot-chart]')) {
		if (mount.closest('figure.diagram, .example-visual') === null) {
			window.close()
			throw new Error(`Documentation chart ${mount.getAttribute('data-plot-chart') ?? 'unknown'} in docs/${entry} is missing a focusable overflow envelope`)
		}
	}
	window.close()
	for (const match of html.matchAll(/data-plot-chart="([^"]+)"/g)) {
		const chartId = match[1]
		if (chartId === undefined) {
			throw new Error(`Could not read a Plot mount ID in docs/${entry}`)
		}
		mountIds.push(chartId)
	}
}
const parsedSpecs: unknown = JSON.parse(specsSource)
if (!isRecord(parsedSpecs)) {
	throw new Error('Documentation chart specifications must be an object')
}
for (const [chartId, value] of Object.entries(parsedSpecs)) {
	if (!isRecord(value) || typeof value['ariaLabel'] !== 'string' || typeof value['ariaDescription'] !== 'string' || typeof value['width'] !== 'number' || typeof value['height'] !== 'number' || !Array.isArray(value['nodes'])) {
		throw new Error(`Chart ${chartId} has an invalid specification envelope`)
	}
	if (mergedDescriptionBoundaryPattern.test(value['ariaDescription'])) {
		throw new Error(`Chart ${chartId} has a merged accessible-description boundary`)
	}
	for (const node of value['nodes']) {
		assertChartNode(node, chartId)
	}
}
const markDrivenFlowchartIds = Object.entries(parsedSpecs)
	.filter(([chartId, value]) => !nativeChartIds.has(chartId) && isRecord(value) && Array.isArray(value['nodes']) && value['nodes'].length > 0)
	.map(([chartId]) => chartId)
const mountIdSet = new Set(mountIds)
const specIdSet = new Set(Object.keys(parsedSpecs))
if (mountIds.length !== mountIdSet.size) {
	throw new Error('Documentation Plot mount IDs must be unique')
}
if (mountIds.length !== expectedChartCount || specIdSet.size !== expectedChartCount) {
	throw new Error(`Expected ${expectedChartCount} documentation charts, found ${mountIds.length} mounts and ${specIdSet.size} specifications`)
}
const missingSpecs = [...mountIdSet].filter(chartId => !specIdSet.has(chartId))
const orphanedSpecs = [...specIdSet].filter(chartId => !mountIdSet.has(chartId))
if (missingSpecs.length > 0 || orphanedSpecs.length > 0) {
	throw new Error(`Documentation chart mount/spec mismatch; missing specs: ${missingSpecs.join(', ') || 'none'}; orphaned specs: ${orphanedSpecs.join(', ') || 'none'}`)
}
for (const chartId of nativeChartIds) {
	if (!mountIdSet.has(chartId) || !runtimeSource.includes(`chartId === '${chartId}'`)) {
		throw new Error(`Native quantitative Plot chart ${chartId} is not mounted and explicitly dispatched`)
	}
}
if (!runtimeSource.includes('return markDrivenDiagramChart(spec)') || /createElementNS|RenderFunction|narrativeMark/.test(runtimeSource)) {
	throw new Error('Documentation flowcharts must use native Observable Plot marks without raw SVG DOM reconstruction')
}
if (!runtimeSource.includes("mount.closest<HTMLElement>('figure.diagram, .example-visual')") || !runtimeSource.includes('overflowEnvelope.tabIndex = 0') || !runtimeSource.includes('Scrollable figure: ${spec.ariaLabel}')) {
	throw new Error('Documentation figure overflow wrappers must be keyboard-focusable and accessibly named')
}
if (!/contractInteractionEdges\s*\.filter/.test(runtimeSource)) {
	throw new Error('Contract interaction map must render from the shared interaction registry')
}
const contractInteractionHtml = await readFile(path.join(docsDirectory, 'contract-interactions.html'), 'utf8')
const documentedEdges = [...contractInteractionHtml.matchAll(/<tr data-edge-id="([^"]+)" data-source="([^"]+)" data-receiver="([^"]+)" data-phase="([^"]+)">/g)].map(match => ({
	id: match[1],
	phase: match[4],
	receiver: match[3],
	source: match[2],
}))
if (documentedEdges.length !== contractInteractionEdges.length) {
	throw new Error(`Contract interaction table has ${documentedEdges.length} checked edges but the shared registry has ${contractInteractionEdges.length}`)
}
for (const expectedEdge of contractInteractionEdges) {
	const tableEdge = documentedEdges.find(edge => edge.id === expectedEdge.id)
	if (tableEdge === undefined || tableEdge.source !== expectedEdge.source || tableEdge.receiver !== expectedEdge.receiver || tableEdge.phase !== expectedEdge.phase) {
		throw new Error(`Contract interaction table does not match shared edge ${expectedEdge.id}: ${expectedEdge.source} -> ${expectedEdge.receiver} (${expectedEdge.phase})`)
	}
}
if (markDrivenFlowchartIds.length === 0) {
	throw new Error('Documentation chart validation did not find any mark-driven flowcharts')
}

const result = await Bun.build({
	entrypoints: [entrypoint],
	minify: true,
	target: 'browser',
})
if (!result.success) {
	throw new AggregateError(result.logs, 'Could not build documentation charts')
}
const output = result.outputs.find(item => item.kind === 'entry-point')
if (output === undefined) {
	throw new Error('Documentation chart build did not produce an entry-point')
}
const [expected, generated] = await Promise.all([output.text(), readFile(generatedPath, 'utf8')])
if (expected !== generated) {
	throw new Error('docs/chartRuntime.js is stale; run bun run docs:build-charts')
}
console.log(`Documentation chart bundle is current; validated ${expectedChartCount} mount/spec pairs, ${nativeChartIds.size} specialized native charts, and ${markDrivenFlowchartIds.length} mark-driven flowcharts.`)
