import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { Window } from 'happy-dom'
import ts from 'typescript'

import { quantitativeChartMetadata } from '../docs/charts/chartMetadata'
import { contractInteractionEdges, quantitativeChartAxisLabels, quantitativeChartIds } from '../docs/charts/chartModels'
import { hasDiagramOverflow, resolveChartEnvelopeWidth } from '../docs/charts/diagramControl'
import { fitArrowEndpointOutsideRectangles, layerDiagramRectangles } from '../docs/charts/diagramGeometry'
import { createDiagramLayouts } from '../docs/charts/diagramLayout'
import { diagramGraphSpecs } from '../docs/charts/diagramModels'
import type { DiagramGraphSpec, DiagramLayoutNode, DiagramLayoutPanel, DiagramLayoutSpec, DiagramNodeKind } from '../docs/charts/diagramTypes'
import { buildDocumentationChartBundle } from './documentationChartBuild.mts'

const repositoryRoot = path.resolve(import.meta.dir, '..')
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

function graphPathExists(section: DiagramGraphSpec['sections'][number], source: string, target: string): boolean {
	const pending = [source]
	const visited = new Set<string>()
	while (pending.length > 0) {
		const current = pending.pop()
		if (current === undefined || visited.has(current)) continue
		if (current === target) return true
		visited.add(current)
		for (const candidate of section.edges) {
			if (candidate.source === current) pending.push(candidate.target)
		}
	}
	return false
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
if (graphIds.size !== 18 || quantitativeIds.size !== 5 || allSpecIds.size !== 23) throw new Error(`Expected 18 ELK diagrams and 5 quantitative plots, found ${graphIds.size} and ${quantitativeIds.size}`)
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

const forkStateMachine = graphSpecs['fig-statoblast-fork-state-machine']?.sections[0]
const operationalChild = forkStateMachine?.nodes.find(candidate => candidate.id === 'child')
if (operationalChild?.title !== 'Operational' || operationalChild.details?.includes('child activated') !== true || !/operational child/i.test(mountFallbacks.get('fig-statoblast-fork-state-machine') ?? '') || /child settlement/i.test(mountFallbacks.get('fig-statoblast-fork-state-machine') ?? '')) {
	throw new Error('The fork state-machine model and fallback must end in child activation, not outcome settlement')
}

const auctionLifecycle = graphSpecs['fig-auction-lifecycle']?.sections[0]
const noSaleTarget = auctionLifecycle?.edges.find(candidate => candidate.id === 'auction-start-operational')?.target
if (auctionLifecycle === undefined || noSaleTarget === undefined || graphPathExists(auctionLifecycle, noSaleTarget, 'settle')) {
	throw new Error('The no-sale truth-auction branch must activate the child without reaching bid settlement')
}
if (!graphPathExists(auctionLifecycle, 'bid', 'settle')) throw new Error('The repair truth-auction branch must preserve paged bid settlement')
const earlyRefund = auctionLifecycle.edges.find(candidate => candidate.id === 'auction-bid-early-refund')
const earlyRefundFinalize = auctionLifecycle.edges.find(candidate => candidate.id === 'auction-early-refund-finalize')
const directFinalize = auctionLifecycle.edges.find(candidate => candidate.id === 'auction-bid-finalize')
const remainingSettlement = auctionLifecycle.nodes.find(candidate => candidate.id === 'settle')
if (
	earlyRefund?.source !== 'bid' ||
	earlyRefund.target !== 'early-refund' ||
	earlyRefundFinalize?.source !== 'early-refund' ||
	earlyRefundFinalize.target !== 'finalize' ||
	directFinalize?.source !== 'bid' ||
	directFinalize.target !== 'finalize' ||
	!graphPathExists(auctionLifecycle, 'early-refund', 'finalize') ||
	remainingSettlement?.title !== 'Settle remaining bids'
) {
	throw new Error('The truth-auction lifecycle must allow optional losing-bid refunds before both paths reach finalization and settlement of remaining bids')
}

const oracleOperation = graphSpecs['fig-statoblast-oracle-flow']?.sections[0]
const oracleOperationEdges = new Map(oracleOperation?.edges.map(candidate => [candidate.id, candidate]) ?? [])
const callbackAttempt = oracleOperationEdges.get('oracle-callback-consume')
const acceptedCallback = oracleOperationEdges.get('oracle-report-callback')
const rejectedCallback = oracleOperationEdges.get('oracle-report-rejected')
const rejectedConsumption = oracleOperationEdges.get('oracle-rejected-consume')
const overflowOperation = oracleOperationEdges.get('oracle-stage-overflow')
const overflowExecution = oracleOperationEdges.get('oracle-overflow-execute')
const callbackNode = oracleOperation?.nodes.find(candidate => candidate.id === 'callback')
const consumedNode = oracleOperation?.nodes.find(candidate => candidate.id === 'consume')
const rejectedNode = oracleOperation?.nodes.find(candidate => candidate.id === 'rejected')
const rejectedConsumedNode = oracleOperation?.nodes.find(candidate => candidate.id === 'reject-consume')
const overflowNode = oracleOperation?.nodes.find(candidate => candidate.id === 'overflow')
if (
	oracleOperation === undefined ||
	callbackAttempt?.source !== 'callback' ||
	callbackAttempt.target !== 'consume' ||
	acceptedCallback?.source !== 'oracle' ||
	acceptedCallback.target !== 'callback' ||
	acceptedCallback.label !== 'accepted report' ||
	rejectedCallback?.source !== 'oracle' ||
	rejectedCallback.target !== 'rejected' ||
	rejectedCallback.label !== 'rejected report' ||
	rejectedConsumption?.source !== 'rejected' ||
	rejectedConsumption.target !== 'reject-consume' ||
	overflowOperation?.source !== 'stage' ||
	overflowOperation.target !== 'overflow' ||
	overflowExecution?.source !== 'overflow' ||
	overflowExecution.target !== 'execute' ||
	callbackNode?.details?.includes('skip already consumed') !== true ||
	consumedNode?.details?.includes('success or terminal execution failure') !== true ||
	rejectedNode?.details?.includes('price cache unchanged') !== true ||
	rejectedConsumedNode?.details?.includes('terminal failure without execution') !== true ||
	overflowNode?.details?.includes('remains active') !== true ||
	!graphPathExists(oracleOperation, 'oracle', 'consume') ||
	!graphPathExists(oracleOperation, 'oracle', 'reject-consume') ||
	!graphPathExists(oracleOperation, 'overflow', 'execute') ||
	graphPathExists(oracleOperation, 'rejected', 'execute') ||
	graphPathExists(oracleOperation, 'rejected', 'consume') ||
	graphPathExists(oracleOperation, 'overflow', 'consume') ||
	oracleOperation.nodes.some(candidate => [candidate.title, ...(candidate.details ?? [])].some(label => /\breplay\b/i.test(label))) ||
	!/accepted settlement callback/i.test(graphSpecs['fig-statoblast-oracle-flow']?.ariaDescription ?? '') ||
	!/rejected report.*terminally consumes/is.test(graphSpecs['fig-statoblast-oracle-flow']?.ariaDescription ?? '') ||
	!/accepted settlement callback/i.test(mountFallbacks.get('fig-statoblast-oracle-flow') ?? '') ||
	!/rejected report.*terminally consumes/is.test(mountFallbacks.get('fig-statoblast-oracle-flow') ?? '') ||
	!/overflow operations remain active.*fresh price/is.test(mountFallbacks.get('fig-statoblast-oracle-flow') ?? '')
) {
	throw new Error('The oracle operation flow must branch accepted and rejected reports, terminally consume the rejected batch, and leave overflow active for later fresh-price execution')
}

const openOracleIntegration = graphSpecs['fig-openoracle-integration-flow']?.sections[0]
const openOracleEdges = new Map(openOracleIntegration?.edges.map(candidate => [candidate.id, candidate]) ?? [])
const settlementCallback = openOracleEdges.get('openoracle-settlement-coordinator')
const guardedExecution = openOracleEdges.get('openoracle-coordinator-guardrails')
const rejectedReport = openOracleEdges.get('openoracle-coordinator-rejected')
const integrationFallback = mountFallbacks.get('fig-openoracle-integration-flow') ?? ''
if (
	openOracleIntegration === undefined ||
	settlementCallback?.source !== 'settlement' ||
	settlementCallback.target !== 'coordinator-callback' ||
	guardedExecution?.source !== 'coordinator-callback' ||
	guardedExecution.target !== 'guardrails' ||
	guardedExecution.label !== 'accepted report' ||
	rejectedReport?.source !== 'coordinator-callback' ||
	rejectedReport.target !== 'rejected' ||
	rejectedReport.label !== 'rejected report' ||
	graphPathExists(openOracleIntegration, 'rejected', 'guardrails') ||
	!/accepted report.*refreshes/is.test(integrationFallback) ||
	!/rejected report.*price cache unchanged.*terminally fails/is.test(integrationFallback)
) {
	throw new Error('OpenOracle settlement must call the coordinator, then branch accepted reports into guarded execution and rejected reports into terminal batch failure')
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
for (const nodeId of ['outcome-1', 'outcome-2', 'outcome-n']) assertNodeMatchesLegend('fig-zoltar-fork-branch-set', nodeId, 'Valid outcome branches')
assertNodeMatchesLegend('fig-zoltar-packed-scalar-answer', 'flag', 'Namespace bit')
assertNodeMatchesLegend('fig-zoltar-packed-scalar-answer', 'first', 'First payout')
assertNodeMatchesLegend('fig-zoltar-packed-scalar-answer', 'second', 'Second payout')
zoltarWindow.close()

const contractMap = graphSpecs['fig-contract-interaction-map']
if (contractMap === undefined) throw new Error('Contract interaction map is missing')
const contractRoutes = contractMap.sections.flatMap(candidate => candidate.edges)
if (contractRoutes.length !== contractInteractionEdges.length || new Set(contractRoutes.map(candidate => candidate.id)).size !== contractInteractionEdges.length) throw new Error('Contract interaction map must contain every registry edge exactly once')
for (const expected of contractInteractionEdges) {
	const definition = contractMap.sections.find(candidate => candidate.edges.some(edge => edge.id === expected.id))
	const route = definition?.edges.find(candidate => candidate.id === expected.id)
	const source = definition?.nodes.find(candidate => candidate.id === route?.source)
	const receiver = definition?.nodes.find(candidate => candidate.id === route?.target)
	if (route === undefined || source?.title !== expected.source || receiver?.title !== expected.receiver || route.label !== expected.action) throw new Error(`Contract interaction diagram does not match ${expected.id}`)
}

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
	!runtimeSource.includes('overflowEnvelope.tabIndex = 0') ||
	!runtimeSource.includes('Responsive diagram: ${spec.ariaLabel}') ||
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
