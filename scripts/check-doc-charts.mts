import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dir, '..')
const docsDirectory = path.join(repositoryRoot, 'docs')
const entrypoint = path.join(repositoryRoot, 'docs/charts/chartRuntime.ts')
const generatedPath = path.join(repositoryRoot, 'docs/chartRuntime.js')
const specsPath = path.join(repositoryRoot, 'docs/charts/diagramSpecs.json')
const expectedChartCount = 36
const nativeChartIds = new Set(['fig-auction-clearing-ladder', 'fig-statoblast-escalation-cost-curve', 'plot-open-oracle-integration-2', 'plot-statoblast-whitepaper-7', 'plot-statoblast-whitepaper-8', 'plot-statoblast-whitepaper-19'])

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
	if (mergedDescriptionBoundaryPattern.test(html)) {
		throw new Error(`Documentation chart fallback in docs/${entry} has a merged description boundary`)
	}
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
console.log(`Documentation chart bundle is current; validated ${expectedChartCount} mount/spec pairs and ${nativeChartIds.size} native quantitative charts.`)
