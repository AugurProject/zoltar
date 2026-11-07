import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { repositoryRoot } from '../repo/root.mts'

import { Window } from 'happy-dom'
import ts from 'typescript'

import { quantitativeChartMetadata } from '../../docs/charts/chartMetadata'
import { quantitativeChartAxisLabels, quantitativeChartIds } from '../../docs/charts/chartModels'
import { hasDiagramOverflow, resolveChartEnvelopeWidth } from '../../docs/charts/diagramControl'
import { fitArrowEndpointOutsideRectangles, layerDiagramRectangles } from '../../docs/charts/diagramGeometry'
import { createDiagramLayouts } from '../../docs/charts/diagramLayout'
import { diagramGraphSpecs } from '../../docs/charts/diagramModels'
import type { DiagramGraphSpec, DiagramLayoutNode, DiagramLayoutPanel, DiagramLayoutSpec, DiagramNodeKind } from '../../docs/charts/diagramTypes'
import { buildDocumentationChartBundle } from './documentationChartBuild.mts'

const docsDirectory = path.join(repositoryRoot, 'docs')
const entrypoint = path.join(repositoryRoot, 'docs/charts/chartRuntime.ts')
const diagramControlPath = path.join(repositoryRoot, 'docs/charts/diagramControl.ts')
const diagramModelsPath = path.join(repositoryRoot, 'docs/charts/diagramModels.ts')
const generatedPath = path.join(repositoryRoot, 'docs/assets/js/chartRuntime.js')
const packagePath = path.join(repositoryRoot, 'package.json')
const sharedDocsCssPath = path.join(repositoryRoot, 'docs/assets/css/shared-docs.css')
const zoltarPagePath = path.join(repositoryRoot, 'docs/explanation/zoltar.html')
const chartAxes = ['x', 'y'] as const

if (resolveChartEnvelopeWidth(612, 780, 1024) !== 612 || resolveChartEnvelopeWidth(0, 780, 1024) !== 780 || resolveChartEnvelopeWidth(0, 0, 1024) !== 992) {
	throw new Error('Documentation chart layout must use the measured envelope before parent and viewport fallbacks')
}
if (!hasDiagramOverflow(934, 976) || !hasDiagramOverflow(957, 976) || hasDiagramOverflow(976, 976)) {
	throw new Error('Documentation diagram controls must follow measured CSS-driven overflow')
}
const exposedArrow = fitArrowEndpointOutsideRectangles(
	[
		{ x: 0, y: 10 },
		{ x: 100, y: 10 },
	],
	[
		{ height: 40, width: 80, x: 80, y: -10 },
		{ height: 20, width: 40, x: 100, y: 0 },
	],
	5,
)
if (exposedArrow.at(-1)?.x !== 95 || exposedArrow.at(-1)?.y !== 10) throw new Error('Documentation arrowheads must remain visible outside destination nodes')
const rectangleLayers = layerDiagramRectangles([
	{ height: 40, width: 80, x: 80, y: -10 },
	{ height: 20, width: 40, x: 100, y: 0 },
])
if (rectangleLayers.background.length !== 1 || rectangleLayers.foreground.length !== 1) throw new Error('Documentation diagram containers must paint below edges and nodes above them')

function findFunction(sourceFile: ts.SourceFile, name: string): ts.FunctionDeclaration {
	const declaration = sourceFile.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name)
	if (declaration === undefined || !ts.isFunctionDeclaration(declaration) || declaration.body === undefined) throw new Error(`Could not find ${name}`)
	return declaration
}

function readProperty(object: ts.ObjectLiteralExpression, propertyName: string, sourceFile: ts.SourceFile): ts.Expression {
	for (const property of object.properties) {
		if (ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === propertyName) return property.initializer
	}
	throw new Error(`Object literal is missing ${propertyName}`)
}

function nativeDispatches(sourceFile: ts.SourceFile): Map<string, string> {
	const createChart = findFunction(sourceFile, 'createChart')
	const statements = createChart.body?.statements ?? []
	const fallback = statements.at(-1)
	if (fallback === undefined || !ts.isReturnStatement(fallback) || fallback.expression === undefined || !ts.isCallExpression(fallback.expression) || !ts.isIdentifier(fallback.expression.expression) || fallback.expression.expression.text !== 'markDrivenDiagramChart') {
		throw new Error('createChart must end with the ELK-backed markDrivenDiagramChart fallback')
	}
	const dispatches = new Map<string, string>()
	for (const statement of statements.slice(0, -1)) {
		if (!ts.isIfStatement(statement) || statement.elseStatement !== undefined || !ts.isBinaryExpression(statement.expression) || statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) {
			throw new Error('createChart dispatches must be top-level chartId equality branches')
		}
		if (!ts.isIdentifier(statement.expression.left) || statement.expression.left.text !== 'chartId' || !ts.isStringLiteral(statement.expression.right)) throw new Error('createChart dispatch conditions must compare chartId with a literal')
		const branchStatements = ts.isBlock(statement.thenStatement) ? statement.thenStatement.statements : []
		const branchReturn = branchStatements[0]
		if (branchStatements.length !== 1 || branchReturn === undefined || !ts.isReturnStatement(branchReturn) || branchReturn.expression === undefined || !ts.isCallExpression(branchReturn.expression) || !ts.isIdentifier(branchReturn.expression.expression)) {
			throw new Error(`Native chart dispatch ${statement.expression.right.text} must directly return one named renderer`)
		}
		if (dispatches.has(statement.expression.right.text)) throw new Error(`createChart repeats ${statement.expression.right.text}`)
		dispatches.set(statement.expression.right.text, branchReturn.expression.expression.text)
	}
	return dispatches
}

function plotOptions(renderer: ts.FunctionDeclaration): ts.ObjectLiteralExpression {
	let found: ts.ObjectLiteralExpression | undefined
	function visit(node: ts.Node): void {
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'plot') {
			const candidate = node.arguments[0]
			if (candidate === undefined || !ts.isObjectLiteralExpression(candidate) || found !== undefined) throw new Error(`Renderer ${renderer.name?.text ?? 'unknown'} must contain one literal Plot configuration`)
			found = candidate
		}
		ts.forEachChild(node, visit)
	}
	visit(renderer)
	if (found === undefined) throw new Error(`Renderer ${renderer.name?.text ?? 'unknown'} has no Plot configuration`)
	return found
}

function assertQuantitativeRenderer(sourceFile: ts.SourceFile, chartId: string, rendererName: string): void {
	const renderer = findFunction(sourceFile, rendererName)
	const axesDeclaration = renderer.body?.statements.flatMap(statement => (ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])).find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'axes')
	const axes = axesDeclaration?.initializer
	if (axes === undefined || !ts.isElementAccessExpression(axes) || !ts.isIdentifier(axes.expression) || axes.expression.text !== 'quantitativeChartAxisLabels' || axes.argumentExpression === undefined || !ts.isStringLiteral(axes.argumentExpression) || axes.argumentExpression.text !== chartId) {
		throw new Error(`Quantitative renderer ${rendererName} must use the ${chartId} axis registry entry`)
	}
	const options = plotOptions(renderer)
	for (const axis of chartAxes) {
		const axisOptions = readProperty(options, axis, sourceFile)
		if (!ts.isObjectLiteralExpression(axisOptions)) throw new Error(`Quantitative renderer ${rendererName} needs ${axis} options`)
		const label = readProperty(axisOptions, 'label', sourceFile)
		if (!ts.isPropertyAccessExpression(label) || !ts.isIdentifier(label.expression) || label.expression.text !== 'axes' || label.name.text !== axis) throw new Error(`Quantitative renderer ${rendererName} must attach axes.${axis}`)
	}
}

function touchesBoundary(point: { x: number; y: number }, node: DiagramLayoutNode): boolean {
	const tolerance = 0.001
	const withinX = point.x >= node.x - tolerance && point.x <= node.x + node.width + tolerance
	const withinY = point.y >= node.y - tolerance && point.y <= node.y + node.height + tolerance
	const touchesHorizontal = Math.abs(point.y - node.y) <= tolerance || Math.abs(point.y - (node.y + node.height)) <= tolerance
	const touchesVertical = Math.abs(point.x - node.x) <= tolerance || Math.abs(point.x - (node.x + node.width)) <= tolerance
	return (withinX && touchesHorizontal) || (withinY && touchesVertical)
}

function insidePanel(point: { x: number; y: number }, panel: DiagramLayoutPanel): boolean {
	return point.x >= panel.x && point.x <= panel.x + panel.width && point.y >= panel.y && point.y <= panel.y + panel.height
}

function assertGraphLayout(chartId: string, graph: DiagramGraphSpec, layout: DiagramLayoutSpec): void {
	if (layout.nodes.length !== graph.sections.reduce((count, candidate) => count + candidate.nodes.length, 0)) throw new Error(`ELK layout ${chartId} changed the node count`)
	if (layout.edges.length !== graph.sections.reduce((count, candidate) => count + candidate.edges.length, 0)) throw new Error(`ELK layout ${chartId} changed the edge count`)
	if (layout.width < graph.width || layout.height < graph.height || !Number.isInteger(layout.width) || !Number.isInteger(layout.height)) throw new Error(`ELK layout ${chartId} needs integral dimensions at least as large as its declared canvas`)
	const edgeIds = new Set<string>()
	for (const section of graph.sections) {
		const declaredNodeIds = new Set(section.nodes.map(candidate => candidate.id))
		if (declaredNodeIds.size !== section.nodes.length) throw new Error(`ELK graph ${chartId}/${section.id} repeats a node id`)
		const panel = layout.panels.find(candidate => candidate.id === section.id)
		for (const declared of section.nodes) {
			const candidate = layout.nodes.find(item => item.id === `${chartId}:${section.id}:${declared.id}`)
			if (candidate === undefined) throw new Error(`ELK layout ${chartId} is missing ${declared.id}`)
			if (panel !== undefined && (!insidePanel({ x: candidate.x, y: candidate.y }, panel) || !insidePanel({ x: candidate.x + candidate.width, y: candidate.y + candidate.height }, panel))) throw new Error(`ELK node ${chartId}/${declared.id} leaves its panel`)
		}
		for (const declared of section.edges) {
			if (edgeIds.has(declared.id)) throw new Error(`ELK graph ${chartId} repeats edge ${declared.id}`)
			edgeIds.add(declared.id)
			if (!declaredNodeIds.has(declared.source) || !declaredNodeIds.has(declared.target)) throw new Error(`ELK graph ${chartId} edge ${declared.id} references a missing node`)
			const candidate = layout.edges.find(item => item.id === declared.id)
			const source = layout.nodes.find(item => item.id === `${chartId}:${section.id}:${declared.source}`)
			const target = layout.nodes.find(item => item.id === `${chartId}:${section.id}:${declared.target}`)
			const firstPoint = candidate?.points[0]
			const lastPoint = candidate?.points.at(-1)
			if (candidate === undefined || source === undefined || target === undefined || firstPoint === undefined || lastPoint === undefined) throw new Error(`ELK route ${chartId}/${declared.id} is incomplete`)
			if (!touchesBoundary(firstPoint, source) || !touchesBoundary(lastPoint, target)) throw new Error(`ELK route ${chartId}/${declared.id} does not touch its source and target boundaries`)
			if (candidate.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error(`ELK route ${chartId}/${declared.id} has invalid coordinates`)
			if (panel !== undefined && candidate.points.some(point => !insidePanel(point, panel))) throw new Error(`ELK route ${chartId}/${declared.id} leaves its panel`)
		}
	}
}

const [diagramControlSource, diagramModelsSource, generated, packageSource, runtimeSource, sharedDocsCssSource, zoltarPageSource] = await Promise.all([
	readFile(diagramControlPath, 'utf8'),
	readFile(diagramModelsPath, 'utf8'),
	readFile(generatedPath, 'utf8'),
	readFile(packagePath, 'utf8'),
	readFile(entrypoint, 'utf8'),
	readFile(sharedDocsCssPath, 'utf8'),
	readFile(zoltarPagePath, 'utf8'),
])
const packageJson: unknown = JSON.parse(packageSource)
if (typeof packageJson !== 'object' || packageJson === null || !('devDependencies' in packageJson) || typeof packageJson.devDependencies !== 'object' || packageJson.devDependencies === null || !('elkjs' in packageJson.devDependencies) || packageJson.devDependencies.elkjs !== '0.12.0') {
	throw new Error('elkjs must remain an exact pinned development dependency')
}

const shellPaletteBlock = sharedDocsCssSource.match(/body\.docs-shell-page\s*\{([\s\S]*?)\}/)?.[1]
if (shellPaletteBlock === undefined) throw new Error('Could not find the documentation shell semantic palette')
function shellPaletteValue(name: string): string {
	const value = shellPaletteBlock?.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim()
	if (value === undefined) throw new Error(`Documentation shell palette is missing --${name}`)
	return value
}
for (const suffix of ['', '-soft']) {
	const values = ['blue', 'green', 'teal'].map(color => shellPaletteValue(`${color}${suffix}`))
	if (new Set(values).size !== values.length) throw new Error(`Documentation shell ${suffix || 'stroke'} colors must distinguish blue, green, and teal semantics`)
}
if (!sharedDocsCssSource.includes('.plot-chart .svg-teal {\n\tfill: var(--teal-soft') || !sharedDocsCssSource.includes('body.paper-zoltar .legend-swatch.teal {\n\tbackground: var(--teal-soft);') || !sharedDocsCssSource.includes('body.paper-zoltar .svg-teal {\n\tfill: var(--teal-soft);')) {
	throw new Error('Teal diagram nodes and legends must use the distinct teal semantic tokens')
}

const graphSpecs: Record<string, DiagramGraphSpec> = diagramGraphSpecs
const quantitativeMetadata: Record<string, { ariaDescription: string; ariaLabel: string; height: number; width: number }> = quantitativeChartMetadata
const graphIds = new Set(Object.keys(graphSpecs))
const quantitativeIds = new Set(Object.keys(quantitativeMetadata))
const allSpecIds = new Set([...graphIds, ...quantitativeIds])
if (graphIds.size === 0 || quantitativeIds.size === 0) throw new Error(`Expected mounted diagrams and quantitative plots, found ${graphIds.size} and ${quantitativeIds.size}`)
if ([...graphIds].some(chartId => quantitativeIds.has(chartId))) throw new Error('A documentation chart cannot be both an ELK diagram and quantitative plot')

const mountIds: string[] = []
const mountDimensions = new Map<string, { height: number; width: number }>()
const mountFallbacks = new Map<string, string>()
const interactiveStaticDiagramIds = new Set<string>()
for await (const relativePath of new Bun.Glob('**/*.html').scan({ cwd: docsDirectory, onlyFiles: true })) {
	const html = await readFile(path.join(docsDirectory, relativePath), 'utf8')
	if (/<svg\b/.test(html)) throw new Error(`Documentation HTML docs/${relativePath} contains a literal SVG instead of a generated chart mount`)
	const window = new Window()
	window.document.write(html)
	window.document.close()
	for (const mount of window.document.querySelectorAll('[data-plot-chart]')) {
		const chartId = mount.getAttribute('data-plot-chart')
		if (chartId === null || chartId.length === 0) throw new Error(`Could not read a chart id in docs/${relativePath}`)
		if (mount.closest('figure.diagram, .example-visual') === null) throw new Error(`Documentation chart ${chartId} in docs/${relativePath} lacks an overflow envelope`)
		const width = Number(mount.getAttribute('data-plot-width'))
		const height = Number(mount.getAttribute('data-plot-height'))
		if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error(`Documentation chart ${chartId} in docs/${relativePath} needs positive dimensions`)
		mountIds.push(chartId)
		mountDimensions.set(chartId, { height, width })
		mountFallbacks.set(chartId, mount.querySelector('.plot-chart-fallback')?.textContent?.trim() ?? '')
		if (graphIds.has(chartId) && mount.closest('.interactive-example') !== null) interactiveStaticDiagramIds.add(chartId)
	}
	window.close()
}
if (mountIds.length !== allSpecIds.size || new Set(mountIds).size !== mountIds.length) throw new Error('Documentation chart mount ids must be unique and match the chart count')
const mountIdSet = new Set(mountIds)
const missing = [...mountIdSet].filter(chartId => !allSpecIds.has(chartId))
const orphaned = [...allSpecIds].filter(chartId => !mountIdSet.has(chartId))
if (missing.length > 0 || orphaned.length > 0) throw new Error(`Documentation chart model mismatch; missing ${missing.join(', ') || 'none'}; orphaned ${orphaned.join(', ') || 'none'}`)
for (const chartId of interactiveStaticDiagramIds) {
	const graph = graphSpecs[chartId]
	if (graph === undefined) throw new Error(`Interactive static diagram ${chartId} is missing its graph model`)
	const labels = graph.sections.flatMap(candidate => [...candidate.nodes.flatMap(node => [node.title, ...(node.details ?? [])]), ...candidate.edges.flatMap(edge => (edge.label === undefined ? [] : [edge.label]))])
	const unboundValue = labels.find(label => /\b\d+(?:\.\d+)?\s*(?:attoETH|attoREP|attoShares|ETH|REP|shares?)\b/i.test(label))
	if (unboundValue !== undefined) throw new Error(`Static diagram ${chartId} exposes an unbound interactive value: ${unboundValue}`)
}

const layouts = await createDiagramLayouts()
if (Object.keys(layouts).length !== graphIds.size) throw new Error('ELK did not produce every declared diagram')
for (const [chartId, graph] of Object.entries(graphSpecs)) {
	const layout = layouts[chartId]
	if (layout === undefined) throw new Error(`ELK layout is missing ${chartId}`)
	assertGraphLayout(chartId, graph, layout)
	const mounted = mountDimensions.get(chartId)
	if (mounted?.width !== layout.width || mounted.height !== layout.height) throw new Error(`Documentation chart ${chartId} mount dimensions do not match its ELK layout`)
}
for (const [chartId, metadata] of Object.entries(quantitativeMetadata)) {
	const mounted = mountDimensions.get(chartId)
	if (mounted?.width !== metadata.width || mounted.height !== metadata.height) throw new Error(`Documentation chart ${chartId} mount dimensions do not match its quantitative metadata`)
}

const zoltarWindow = new Window()
zoltarWindow.document.write(zoltarPageSource)
zoltarWindow.document.close()
function legendColor(figureId: string, label: string): DiagramNodeKind {
	const figure = zoltarWindow.document.getElementById(figureId)
	if (figure === null) throw new Error(`Could not find ${figureId} for legend validation`)
	const item = Array.from(figure.querySelectorAll('.legend-item')).find(candidate => candidate.textContent?.trim() === label)
	const swatch = item?.querySelector('.legend-swatch')
	for (const color of ['blue', 'gold', 'teal'] as const) {
		if (swatch?.classList.contains(color)) return color
	}
	throw new Error(`Could not resolve ${label} in ${figureId}'s legend`)
}
function assertNodeMatchesLegend(figureId: string, nodeId: string, legendLabel: string): void {
	const candidate = graphSpecs[figureId]?.sections.flatMap(section => section.nodes).find(node => node.id === nodeId)
	const expectedKind = legendColor(figureId, legendLabel)
	if (candidate?.kind !== expectedKind) throw new Error(`${figureId} node ${nodeId} must use the ${expectedKind} color declared by ${legendLabel}`)
}
assertNodeMatchesLegend('fig-zoltar-fork-branch-set', 'parent', 'Forking parent')
assertNodeMatchesLegend('fig-zoltar-fork-branch-set', 'invalid', 'Invalid branch')
for (const nodeId of ['yes', 'no']) assertNodeMatchesLegend('fig-zoltar-fork-branch-set', nodeId, 'Valid outcome branches')
assertNodeMatchesLegend('fig-zoltar-packed-scalar-answer', 'flag', 'Namespace bit')
assertNodeMatchesLegend('fig-zoltar-packed-scalar-answer', 'first', 'First payout')
assertNodeMatchesLegend('fig-zoltar-packed-scalar-answer', 'second', 'Second payout')
zoltarWindow.close()

const runtimeSourceFile = ts.createSourceFile(entrypoint, runtimeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const dispatches = nativeDispatches(runtimeSourceFile)
if (dispatches.size !== quantitativeIds.size || [...dispatches].some(([chartId]) => !quantitativeIds.has(chartId)) || [...quantitativeIds].some(chartId => !dispatches.has(chartId))) throw new Error('Only quantitative charts may use specialized runtime renderers')
for (const chartId of quantitativeChartIds) {
	const metadata = quantitativeMetadata[chartId]
	const axes = quantitativeChartAxisLabels[chartId]
	if (metadata === undefined || axes.x.includes('(') === false || !axes.x.endsWith(')') || axes.y.includes('(') === false || !axes.y.endsWith(')')) throw new Error(`Quantitative chart ${chartId} needs metadata and explicit axis units`)
	const rendererName = dispatches.get(chartId)
	if (rendererName === undefined) throw new Error(`Quantitative chart ${chartId} lacks a renderer`)
	assertQuantitativeRenderer(runtimeSourceFile, chartId, rendererName)
}

if (
	!runtimeSource.includes("from 'virtual:diagram-layouts'") ||
	runtimeSource.includes('contractInteractionChart') ||
	diagramModelsSource.includes('x1:') ||
	diagramModelsSource.includes('labelX:') ||
	!runtimeSource.includes('return markDrivenDiagramChart(spec)') ||
	!runtimeSource.includes("mount.closest<HTMLElement>('figure.diagram, .example-visual')") ||
	// A fitted chart is not a scroll surface, so only the full-screen scroll surface becomes a keyboard stop.
	runtimeSource.includes('overflowEnvelope.tabIndex = 0') ||
	!runtimeSource.includes('scrollSurface.tabIndex = 0') ||
	!runtimeSource.includes("overflowEnvelope.setAttribute('aria-label', spec.ariaLabel)") ||
	!runtimeSource.includes('fitArrowEndpointOutsideRectangles(item.points, data.rectangles') ||
	!runtimeSource.includes('...rectangleMarks(rectangleLayers.background), ...lineMarks, ...rectangleMarks(rectangleLayers.foreground)') ||
	!runtimeSource.includes("document.addEventListener('keydown'") ||
	!runtimeSource.includes("window.addEventListener('resize'") ||
	!runtimeSource.includes("new CustomEvent('docs:charts-rendered')") ||
	!diagramControlSource.includes('state.element.inert = true') ||
	!sharedDocsCssSource.includes('.plot-chart .elk-panel') ||
	!sharedDocsCssSource.includes('.plot-chart .elk-edge-label') ||
	!sharedDocsCssSource.includes('\toverflow: auto;\n\toverscroll-behavior: contain;') ||
	!sharedDocsCssSource.includes('\twidth: var(--diagram-expanded-width, 70rem) !important;\n\theight: auto !important;\n\tmin-width: var(--diagram-expanded-width, 70rem) !important;\n\tmax-width: none !important;\n\tmax-height: none !important;')
) {
	throw new Error('Documentation diagrams must preserve generated Plot rendering, responsive controls, accessibility, and ELK-specific presentation')
}
if (/elk-worker|elk\.algorithm|ELK layout/.test(generated)) throw new Error('The browser chart bundle must contain generated coordinates, not the ELK layout engine')
if (!generated.includes('data-node-id')) throw new Error('Generated documentation diagrams must expose node ids for rendered containment validation')

const expectedBundle = await buildDocumentationChartBundle()
if (expectedBundle !== generated) throw new Error('docs/assets/js/chartRuntime.js is stale; run bun run docs:build-charts')

console.log(`Documentation chart bundle is current; validated ${allSpecIds.size} mount/model pairs, ${graphIds.size} build-time ELK diagrams, and ${quantitativeIds.size} quantitative Plot charts.`)
