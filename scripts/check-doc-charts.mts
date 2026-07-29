import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { Window } from 'happy-dom'
import ts from 'typescript'

import { contractInteractionEdges, quantitativeChartAxisLabels, quantitativeChartIds } from '../docs/charts/chartModels'
import {
	contractAtlasDefaultView,
	contractAtlasEdges,
	contractAtlasInventoryRows,
	contractAtlasNodes,
	contractAtlasPlotRouteMeaning,
	contractAtlasPlotRoutes,
	contractAtlasPlotRoutesForView,
	contractAtlasRelationLabels,
	contractAtlasRelationshipRows,
	contractAtlasViewDefinitions,
	type ContractAtlasView,
} from '../docs/charts/contractAtlas'
import { contractAtlasSourceOwnerOverrides, contractAtlasSourceReferences } from '../docs/charts/contractAtlasSourceReferences'
import { analyzeContractAtlasSource, contractAtlasSourceReferenceIssue } from './contract-atlas-source-references.mts'

const repositoryRoot = path.resolve(import.meta.dir, '..')
const docsDirectory = path.join(repositoryRoot, 'docs')
const entrypoint = path.join(repositoryRoot, 'docs/charts/chartRuntime.ts')
const generatedPath = path.join(repositoryRoot, 'docs/chartRuntime.js')
const specsPath = path.join(repositoryRoot, 'docs/charts/diagramSpecs.json')
const expectedChartCount = 41
const expectedContractAtlasNodeCount = 114
const expectedContractAtlasRelationshipCount = 366
const expectedContractAtlasPlotRouteCount = 360
const expectedContractAtlasMultiRelationRouteCount = 6
const expectedContractAtlasSourceReferenceCount = 321
const expectedContractAtlasExplicitDeploymentCount = 17
const expectedContractAtlasDirectBaseCount = 43
const expectedContractAtlasDelegatecallCount = 5
const expectedContractAtlasViewRouteCounts: Record<ContractAtlasView, number> = {
	all: 360,
	protocol: 69,
	references: 189,
	structure: 76,
	tests: 26,
}
const expectedContractAtlasTypeModuleSources = new Set(['solidity/contracts/peripherals/EscalationGameTypes.sol', 'solidity/contracts/peripherals/SecurityPoolForkerTypes.sol'])
const supportedDiagramTags = new Set(['circle', 'defs', 'line', 'marker', 'path', 'polyline', 'rect', 'text', 'tspan'])
const axisFreeNativeChartIds = new Set(['fig-complete-contract-atlas', 'fig-contract-interaction-map'])
const quantitativeChartIdSet = new Set<string>(quantitativeChartIds)
const chartAxes: ('x' | 'y')[] = ['x', 'y']

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readObjectProperty(object: ts.ObjectLiteralExpression, propertyName: string, sourceFile: ts.SourceFile): ts.Expression {
	for (const property of object.properties) {
		if (ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === propertyName) {
			return property.initializer
		}
	}
	throw new Error(`Object literal is missing required ${propertyName} property`)
}

function readStringProperty(object: ts.ObjectLiteralExpression, propertyName: string, sourceFile: ts.SourceFile): string {
	const expression = readObjectProperty(object, propertyName, sourceFile)
	if (!ts.isStringLiteral(expression)) {
		throw new Error(`Contract interaction layout ${propertyName} must be a string literal`)
	}
	return expression.text
}

function readNumberProperty(object: ts.ObjectLiteralExpression, propertyName: string, sourceFile: ts.SourceFile): number {
	const expression = readObjectProperty(object, propertyName, sourceFile)
	if (!ts.isNumericLiteral(expression)) {
		throw new Error(`Contract interaction layout ${propertyName} must be a number literal`)
	}
	return Number(expression.text)
}

function findContractInteractionArray(sourceFile: ts.SourceFile, variableName: string): ts.ArrayLiteralExpression {
	const chartFunction = sourceFile.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'contractInteractionChart')
	if (chartFunction === undefined || !ts.isFunctionDeclaration(chartFunction) || chartFunction.body === undefined) {
		throw new Error('Could not find contractInteractionChart for structured layout validation')
	}
	for (const statement of chartFunction.body.statements) {
		if (!ts.isVariableStatement(statement)) continue
		for (const declaration of statement.declarationList.declarations) {
			if (ts.isIdentifier(declaration.name) && declaration.name.text === variableName && declaration.initializer !== undefined && ts.isArrayLiteralExpression(declaration.initializer)) {
				return declaration.initializer
			}
		}
	}
	throw new Error(`Could not find contractInteractionChart ${variableName} array`)
}

function findFunctionDeclaration(sourceFile: ts.SourceFile, functionName: string): ts.FunctionDeclaration {
	const declaration = sourceFile.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === functionName)
	if (declaration === undefined || !ts.isFunctionDeclaration(declaration) || declaration.body === undefined) {
		throw new Error(`Could not find chart renderer function ${functionName}`)
	}
	return declaration
}

function readNativeChartDispatches(sourceFile: ts.SourceFile): { dispatches: Map<string, string>; issue?: string } {
	const createChart = findFunctionDeclaration(sourceFile, 'createChart')
	const dispatches = new Map<string, string>()
	const statements = createChart.body?.statements ?? []
	const fallback = statements[statements.length - 1]
	if (fallback === undefined || !ts.isReturnStatement(fallback) || fallback.expression === undefined || !ts.isCallExpression(fallback.expression) || !ts.isIdentifier(fallback.expression.expression) || fallback.expression.expression.text !== 'markDrivenDiagramChart') {
		return { dispatches, issue: 'createChart must end with one direct markDrivenDiagramChart fallback return' }
	}
	for (const statement of statements.slice(0, -1)) {
		if (!ts.isIfStatement(statement) || statement.elseStatement !== undefined || !ts.isBinaryExpression(statement.expression) || statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) {
			return { dispatches, issue: 'createChart native dispatches must be top-level chartId === literal if statements without else branches' }
		}
		const { left, right } = statement.expression
		if (!ts.isIdentifier(left) || left.text !== 'chartId' || !ts.isStringLiteral(right)) {
			return { dispatches, issue: 'createChart native dispatch conditions must use chartId === literal in that order' }
		}
		const branchStatements = ts.isBlock(statement.thenStatement) ? statement.thenStatement.statements : []
		const branchReturn = branchStatements[0]
		if (branchStatements.length !== 1 || branchReturn === undefined || !ts.isReturnStatement(branchReturn) || branchReturn.expression === undefined || !ts.isCallExpression(branchReturn.expression) || !ts.isIdentifier(branchReturn.expression.expression)) {
			return { dispatches, issue: `Native chart dispatch ${right.text} must contain one direct named renderer return` }
		}
		if (dispatches.has(right.text)) {
			return { dispatches, issue: `createChart contains duplicate native dispatch ${right.text}` }
		}
		dispatches.set(right.text, branchReturn.expression.expression.text)
	}
	return { dispatches }
}

function findPlotOptions(renderer: ts.FunctionDeclaration, sourceFile: ts.SourceFile): ts.ObjectLiteralExpression {
	let options: ts.ObjectLiteralExpression | undefined
	function visit(node: ts.Node): void {
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'plot') {
			const candidate = node.arguments[0]
			if (candidate === undefined || !ts.isObjectLiteralExpression(candidate) || options !== undefined) {
				throw new Error(`Quantitative renderer ${renderer.name?.text ?? 'unknown'} must contain exactly one literal Plot configuration`)
			}
			options = candidate
		}
		ts.forEachChild(node, visit)
	}
	visit(renderer)
	if (options === undefined) {
		throw new Error(`Quantitative renderer ${renderer.name?.text ?? 'unknown'} has no Plot configuration in ${sourceFile.fileName}`)
	}
	return options
}

function axisUsesRegisteredLabel(options: ts.ObjectLiteralExpression, axis: 'x' | 'y', sourceFile: ts.SourceFile): boolean {
	const axisOptions = readObjectProperty(options, axis, sourceFile)
	if (!ts.isObjectLiteralExpression(axisOptions)) return false
	const label = readObjectProperty(axisOptions, 'label', sourceFile)
	return ts.isPropertyAccessExpression(label) && ts.isIdentifier(label.expression) && label.expression.text === 'axes' && label.name.text === axis
}

function assertRendererAxisBindings(sourceFile: ts.SourceFile, chartId: string, rendererName: string): void {
	const renderer = findFunctionDeclaration(sourceFile, rendererName)
	const axesDeclaration = renderer.body?.statements.flatMap(statement => (ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])).find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'axes')
	const initializer = axesDeclaration?.initializer
	if (
		initializer === undefined ||
		!ts.isElementAccessExpression(initializer) ||
		!ts.isIdentifier(initializer.expression) ||
		initializer.expression.text !== 'quantitativeChartAxisLabels' ||
		initializer.argumentExpression === undefined ||
		!ts.isStringLiteral(initializer.argumentExpression) ||
		initializer.argumentExpression.text !== chartId
	) {
		throw new Error(`Quantitative renderer ${rendererName} must select the ${chartId} axis registry entry`)
	}
	const options = findPlotOptions(renderer, sourceFile)
	for (const axis of chartAxes) {
		if (!axisUsesRegisteredLabel(options, axis, sourceFile)) {
			throw new Error(`Quantitative renderer ${rendererName} must attach axes.${axis} to its ${axis}-axis label`)
		}
	}
}

function nativeRegistryCoverageIssue(nativeChartIds: Set<string>): string | undefined {
	if (quantitativeChartIdSet.size + axisFreeNativeChartIds.size !== nativeChartIds.size || [...nativeChartIds].some(chartId => !quantitativeChartIdSet.has(chartId) && !axisFreeNativeChartIds.has(chartId)) || [...quantitativeChartIdSet].some(chartId => !nativeChartIds.has(chartId))) {
		return 'Native chart dispatches must be registered as quantitative charts or explicitly axis-free diagrams'
	}
	return undefined
}

function assertNativeRegistryCoverage(nativeChartIds: Set<string>): void {
	const issue = nativeRegistryCoverageIssue(nativeChartIds)
	if (issue !== undefined) throw new Error(issue)
}

function stringSetIssue(label: string, expectedValues: readonly string[], registeredValues: readonly string[]): string | undefined {
	const expected = new Set(expectedValues)
	const registered = new Set(registeredValues)
	const missing = [...expected].filter(value => !registered.has(value))
	const extra = [...registered].filter(value => !expected.has(value))
	if (missing.length === 0 && extra.length === 0) return undefined
	return `${label}; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`
}

function exactRelationshipSetIssue(label: string, expectedValues: readonly string[], registeredValues: readonly string[]): string | undefined {
	if (new Set(expectedValues).size !== expectedValues.length) {
		return `${label} source analysis contains duplicate relationships`
	}
	if (new Set(registeredValues).size !== registeredValues.length) {
		return `${label} registry contains duplicate relationships`
	}
	return stringSetIssue(label, expectedValues, registeredValues)
}

function contractAtlasRelationshipIssue(edges: readonly (typeof contractAtlasEdges)[number][], nodeIds: ReadonlySet<string>): string | undefined {
	if (edges.length !== expectedContractAtlasRelationshipCount) {
		return `Complete contract atlas expected ${expectedContractAtlasRelationshipCount} relationships, found ${edges.length}`
	}
	const edgeIds = edges.map(edge => edge.id)
	if (new Set(edgeIds).size !== edgeIds.length) {
		return 'Complete contract atlas relationship IDs must be unique'
	}
	const sourceReferencePairs = new Set(contractAtlasSourceReferences.map(reference => `${reference.source}->${reference.target}`))
	const relationshipPairs = new Set<string>()
	for (const edge of edges) {
		if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
			return `Complete contract atlas relationship ${edge.id} has a missing source or target`
		}
		if (edge.description.trim().length === 0) {
			return `Complete contract atlas relationship ${edge.id} is missing its meaning`
		}
		const pair = `${edge.source}->${edge.target}`
		relationshipPairs.add(pair)
		if (edge.relation === 'references' && !sourceReferencePairs.has(pair)) {
			return `Complete contract atlas relationship ${edge.id} claims a direct source reference absent from Solidity`
		}
		if (edge.relation === 'assets' && !edge.description.includes('→')) {
			return `Complete contract atlas asset-bearing relationship ${edge.id} must name an actual sender → recipient path`
		}
	}
	const missingSourcePair = contractAtlasSourceReferences.find(reference => !relationshipPairs.has(`${reference.source}->${reference.target}`))
	if (missingSourcePair !== undefined) {
		return `Complete contract atlas is missing direct source relationship ${missingSourcePair.source}->${missingSourcePair.target}`
	}
	return undefined
}

async function assertContractAtlasCoverage(): Promise<void> {
	const contractsDirectory = path.join(repositoryRoot, 'solidity/contracts')
	const sourceEntries = [...new Bun.Glob('**/*.sol').scanSync({ cwd: contractsDirectory })].sort()
	const declarationPattern = /^(abstract contract|contract|interface|library)\s+([A-Za-z_]\w*)\b/gm
	const declarationRecords: { key: string; kind: string; source: string }[] = []
	const typeModuleSources: string[] = []
	for (const entry of sourceEntries) {
		const repositoryPath = path.posix.join('solidity/contracts', entry.split(path.sep).join('/'))
		const source = await readFile(path.join(contractsDirectory, entry), 'utf8')
		const sourceDeclarations = [...source.matchAll(declarationPattern)]
		for (const match of sourceDeclarations) {
			const declarationKind = match[1]
			const declaration = match[2]
			if (declarationKind === undefined || declaration === undefined) {
				throw new Error(`Could not read Solidity declaration in ${repositoryPath}`)
			}
			declarationRecords.push({
				key: `${repositoryPath}#${declaration}`,
				kind: declarationKind === 'abstract contract' ? 'abstract' : declarationKind,
				source: repositoryPath,
			})
		}
		if (sourceDeclarations.length === 0 && /^(struct|enum)\s+[A-Za-z_]\w*\b/m.test(source)) {
			typeModuleSources.push(repositoryPath)
		}
	}
	const declarationKeys = declarationRecords.map(record => record.key)
	const registeredDeclarationKeys = contractAtlasNodes.flatMap(node => (node.declaration === undefined ? [] : [`${node.source}#${node.declaration}`]))
	const declarationKeySet = new Set(declarationKeys)
	const registeredDeclarationKeySet = new Set(registeredDeclarationKeys)
	if (declarationKeySet.size !== declarationKeys.length) {
		throw new Error('Solidity source inventory contains duplicate declaration keys')
	}
	if (registeredDeclarationKeySet.size !== registeredDeclarationKeys.length) {
		throw new Error('Complete contract atlas contains duplicate declaration keys')
	}
	const declarationIssue = stringSetIssue('Complete contract atlas declaration mismatch', declarationKeys, registeredDeclarationKeys)
	if (declarationIssue !== undefined) throw new Error(declarationIssue)
	const registeredTypeModuleSources = contractAtlasNodes.filter(node => node.kind === 'module' && node.declaration === undefined).map(node => node.source)
	const sourceTypeModuleIssue = stringSetIssue('Complete contract atlas type-module source mismatch', typeModuleSources, registeredTypeModuleSources)
	if (sourceTypeModuleIssue !== undefined) throw new Error(sourceTypeModuleIssue)
	const expectedTypeModuleIssue = stringSetIssue('Complete contract atlas must register the two named type modules', [...expectedContractAtlasTypeModuleSources], registeredTypeModuleSources)
	if (expectedTypeModuleIssue !== undefined) throw new Error(expectedTypeModuleIssue)
	const unregisteredModuleProbe = stringSetIssue('Complete contract atlas type-module negative probe', [...typeModuleSources, 'solidity/contracts/peripherals/UnregisteredTypes.sol'], registeredTypeModuleSources)
	if (unregisteredModuleProbe === undefined) {
		throw new Error('Complete contract atlas type-module coverage did not reject an unregistered type module')
	}
	if (contractAtlasNodes.length !== expectedContractAtlasNodeCount) {
		throw new Error(`Complete contract atlas expected ${expectedContractAtlasNodeCount} nodes, found ${contractAtlasNodes.length}`)
	}
	const nodeIds = contractAtlasNodes.map(node => node.id)
	const nodeIdSet = new Set(nodeIds)
	if (nodeIdSet.size !== nodeIds.length) {
		throw new Error('Complete contract atlas node IDs must be unique')
	}
	if (contractAtlasInventoryRows.length !== expectedContractAtlasNodeCount) {
		throw new Error(`Complete contract atlas component inventory expected ${expectedContractAtlasNodeCount} rows, found ${contractAtlasInventoryRows.length}`)
	}
	const inventoryNodeIssue = exactRelationshipSetIssue(
		'Complete contract atlas component inventory mismatch',
		nodeIds,
		contractAtlasInventoryRows.map(row => row.node.id),
	)
	if (inventoryNodeIssue !== undefined) throw new Error(inventoryNodeIssue)
	if (contractAtlasInventoryRows.some(row => row.panelLabel.trim().length === 0)) {
		throw new Error('Complete contract atlas component inventory contains an empty region label')
	}
	const sourcePathSet = new Set(sourceEntries.map(entry => path.posix.join('solidity/contracts', entry.split(path.sep).join('/'))))
	for (const node of contractAtlasNodes) {
		if (!sourcePathSet.has(node.source)) {
			throw new Error(`Complete contract atlas node ${node.id} references missing source ${node.source}`)
		}
		const isTestDeclaration = node.source.startsWith('solidity/contracts/test/')
		if ((node.panel === 'tests') !== isTestDeclaration) {
			throw new Error(`Complete contract atlas node ${node.id} is assigned to the wrong production or test panel`)
		}
		if (node.declaration !== undefined) {
			const record = declarationRecords.find(candidate => candidate.key === `${node.source}#${node.declaration}`)
			if (record === undefined || record.kind !== node.kind) {
				throw new Error(`Complete contract atlas node ${node.id} has the wrong Solidity declaration kind`)
			}
		}
	}
	if (contractAtlasSourceReferences.length !== expectedContractAtlasSourceReferenceCount) {
		throw new Error(`Complete contract atlas expected ${expectedContractAtlasSourceReferenceCount} direct source references, found ${contractAtlasSourceReferences.length}`)
	}
	const sourceAnalysis = await analyzeContractAtlasSource(contractsDirectory, contractAtlasNodes, contractAtlasSourceOwnerOverrides)
	const derivedSourceReferences = sourceAnalysis.references
	const sourceReferenceIssue = contractAtlasSourceReferenceIssue(derivedSourceReferences, contractAtlasSourceReferences)
	if (sourceReferenceIssue !== undefined) throw new Error(sourceReferenceIssue)
	if (contractAtlasSourceReferenceIssue(derivedSourceReferences, contractAtlasSourceReferences.slice(1)) === undefined) {
		throw new Error('Complete contract atlas source-reference coverage did not reject a removed relationship')
	}
	if (sourceAnalysis.explicitDeployments.length !== expectedContractAtlasExplicitDeploymentCount) {
		throw new Error(`Complete contract atlas expected ${expectedContractAtlasExplicitDeploymentCount} source-derived new or CREATE2 deployments, found ${sourceAnalysis.explicitDeployments.length}`)
	}
	const derivedDeploymentPairs = sourceAnalysis.explicitDeployments.map(deployment => `${deployment.source}->${deployment.target}`)
	const registeredDeploymentPairs = contractAtlasEdges.filter(edge => edge.relation === 'deploys').map(edge => `${edge.source}->${edge.target}`)
	const deploymentIssue = exactRelationshipSetIssue('Complete contract atlas deployment relationship mismatch', derivedDeploymentPairs, registeredDeploymentPairs)
	if (deploymentIssue !== undefined) throw new Error(deploymentIssue)
	if (exactRelationshipSetIssue('Complete contract atlas deployment removal probe', derivedDeploymentPairs, registeredDeploymentPairs.slice(1)) === undefined) {
		throw new Error('Complete contract atlas deployment coverage did not reject a removed deployment')
	}
	if (exactRelationshipSetIssue('Complete contract atlas deployment addition probe', derivedDeploymentPairs, [...registeredDeploymentPairs, 'probe-source->probe-target']) === undefined) {
		throw new Error('Complete contract atlas deployment coverage did not reject an extra deployment')
	}
	if (sourceAnalysis.directBases.length !== expectedContractAtlasDirectBaseCount) {
		throw new Error(`Complete contract atlas expected ${expectedContractAtlasDirectBaseCount} direct inheritance and implementation relationships, found ${sourceAnalysis.directBases.length}`)
	}
	const derivedDirectBaseKeys = sourceAnalysis.directBases.map(relationship => `${relationship.source}->${relationship.target}:${relationship.relation}`)
	const registeredDirectBaseKeys = contractAtlasEdges.filter(edge => edge.relation === 'implements' || edge.relation === 'inherits').map(edge => `${edge.source}->${edge.target}:${edge.relation}`)
	const directBaseIssue = exactRelationshipSetIssue('Complete contract atlas direct inheritance and implementation mismatch', derivedDirectBaseKeys, registeredDirectBaseKeys)
	if (directBaseIssue !== undefined) throw new Error(directBaseIssue)
	const firstDirectBaseKey = derivedDirectBaseKeys[0]
	const firstDirectBasePair = firstDirectBaseKey === undefined ? 'probe-source->probe-target' : firstDirectBaseKey.slice(0, firstDirectBaseKey.lastIndexOf(':'))
	const reclassifiedDirectBaseProbe = [`${firstDirectBasePair}:calls`, ...derivedDirectBaseKeys.slice(1)]
	if (exactRelationshipSetIssue('Complete contract atlas direct-base reclassification probe', derivedDirectBaseKeys, reclassifiedDirectBaseProbe) === undefined) {
		throw new Error('Complete contract atlas direct-base coverage did not reject a reclassified relationship')
	}
	if (sourceAnalysis.delegatecalls.length !== expectedContractAtlasDelegatecallCount) {
		throw new Error(`Complete contract atlas expected ${expectedContractAtlasDelegatecallCount} directly resolved delegatecall relationships, found ${sourceAnalysis.delegatecalls.length}`)
	}
	const derivedDelegatecallPairs = sourceAnalysis.delegatecalls.map(relationship => `${relationship.source}->${relationship.target}`)
	const registeredDelegatecallPairs = contractAtlasEdges.filter(edge => edge.relation === 'delegatecall').map(edge => `${edge.source}->${edge.target}`)
	const delegatecallIssue = exactRelationshipSetIssue('Complete contract atlas delegatecall relationship mismatch', derivedDelegatecallPairs, registeredDelegatecallPairs)
	if (delegatecallIssue !== undefined) throw new Error(delegatecallIssue)
	if (exactRelationshipSetIssue('Complete contract atlas delegatecall target probe', derivedDelegatecallPairs, ['probe-source->probe-target', ...derivedDelegatecallPairs.slice(1)]) === undefined) {
		throw new Error('Complete contract atlas delegatecall coverage did not reject a changed target')
	}
	const relationshipIssue = contractAtlasRelationshipIssue(contractAtlasEdges, nodeIdSet)
	if (relationshipIssue !== undefined) throw new Error(relationshipIssue)
	if (contractAtlasRelationshipIssue(contractAtlasEdges.slice(1), nodeIdSet) === undefined) {
		throw new Error('Complete contract atlas relationship coverage did not reject a removed relationship')
	}
	if (contractAtlasRelationshipRows.length !== expectedContractAtlasRelationshipCount) {
		throw new Error(`Complete contract atlas generated ${contractAtlasRelationshipRows.length} register rows for ${expectedContractAtlasRelationshipCount} relationships`)
	}
	const rowEdgeIssue = stringSetIssue(
		'Complete contract atlas generated relationship rows mismatch',
		contractAtlasEdges.map(edge => edge.id),
		contractAtlasRelationshipRows.map(row => row.edge.id),
	)
	if (rowEdgeIssue !== undefined) throw new Error(rowEdgeIssue)
	if (contractAtlasPlotRoutes.length !== expectedContractAtlasPlotRouteCount) {
		throw new Error(`Complete contract atlas expected ${expectedContractAtlasPlotRouteCount} ordered plot routes, found ${contractAtlasPlotRoutes.length}`)
	}
	const routePairs = contractAtlasPlotRoutes.map(route => `${route.source}->${route.target}`)
	if (new Set(routePairs).size !== routePairs.length) {
		throw new Error('Complete contract atlas plot routes must contain one route per ordered source-target pair')
	}
	const multiRelationRoutes = contractAtlasPlotRoutes.filter(route => route.edges.length > 1)
	if (multiRelationRoutes.length !== expectedContractAtlasMultiRelationRouteCount) {
		throw new Error(`Complete contract atlas expected ${expectedContractAtlasMultiRelationRouteCount} multi-relation plot routes, found ${multiRelationRoutes.length}`)
	}
	for (const route of contractAtlasPlotRoutes) {
		if (route.edges.length === 0 || route.edges.some(edge => edge.source !== route.source || edge.target !== route.target)) {
			throw new Error(`Complete contract atlas plot route ${route.id} contains a relationship for another ordered pair`)
		}
		const meaning = contractAtlasPlotRouteMeaning(route)
		for (const edge of route.edges) {
			if (!meaning.includes(`${contractAtlasRelationLabels[edge.relation]}: ${edge.description}`)) {
				throw new Error(`Complete contract atlas plot route ${route.id} omits relationship ${edge.id} from its tooltip meaning`)
			}
		}
	}
	const routeEdgeIssue = stringSetIssue(
		'Complete contract atlas plot-route relationship mismatch',
		contractAtlasEdges.map(edge => edge.id),
		contractAtlasPlotRoutes.flatMap(route => route.edges.map(edge => edge.id)),
	)
	if (routeEdgeIssue !== undefined) throw new Error(routeEdgeIssue)
	const expectedViewIds = Object.keys(expectedContractAtlasViewRouteCounts)
	const registeredViewIds = contractAtlasViewDefinitions.map(view => view.id)
	const viewIdIssue = exactRelationshipSetIssue('Complete contract atlas relationship-layer definitions', expectedViewIds, registeredViewIds)
	if (viewIdIssue !== undefined) throw new Error(viewIdIssue)
	if (contractAtlasDefaultView !== 'protocol') {
		throw new Error('Complete contract atlas must default to the reduced-overlap protocol-flow layer')
	}
	for (const view of contractAtlasViewDefinitions) {
		const viewRoutes = contractAtlasPlotRoutesForView(view)
		if (viewRoutes.length !== expectedContractAtlasViewRouteCounts[view.id]) {
			throw new Error(`Complete contract atlas ${view.id} layer expected ${expectedContractAtlasViewRouteCounts[view.id]} routes, found ${viewRoutes.length}`)
		}
	}
	const nonAllViews = contractAtlasViewDefinitions.filter(view => view.id !== 'all')
	const partitionedRelations = nonAllViews.flatMap(view => view.relations)
	const relationPartitionIssue = exactRelationshipSetIssue('Complete contract atlas relationship layers must partition every relation', Object.keys(contractAtlasRelationLabels), partitionedRelations)
	if (relationPartitionIssue !== undefined) throw new Error(relationPartitionIssue)
	const layeredEdgeIds = nonAllViews.flatMap(view => {
		const viewRelations = new Set(view.relations)
		return contractAtlasPlotRoutesForView(view).flatMap(route => route.edges.filter(edge => viewRelations.has(edge.relation)).map(edge => edge.id))
	})
	const layerCoverageIssue = exactRelationshipSetIssue(
		'Complete contract atlas reduced-overlap layers must preserve every relationship',
		contractAtlasEdges.map(edge => edge.id),
		layeredEdgeIds,
	)
	if (layerCoverageIssue !== undefined) throw new Error(layerCoverageIssue)
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
const runtimeSourceFile = ts.createSourceFile(entrypoint, runtimeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const nativeDispatchResult = readNativeChartDispatches(runtimeSourceFile)
if (nativeDispatchResult.issue !== undefined) {
	throw new Error(nativeDispatchResult.issue)
}
const nativeDispatches = nativeDispatchResult.dispatches
const nativeChartIds = new Set(nativeDispatches.keys())
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
assertNativeRegistryCoverage(nativeChartIds)
await assertContractAtlasCoverage()
for (const chartId of quantitativeChartIds) {
	const axes = quantitativeChartAxisLabels[chartId]
	for (const axis of chartAxes) {
		const label = axes[axis]
		if (!label.includes('(') || !label.endsWith(')')) {
			throw new Error(`Quantitative chart ${chartId} ${axis}-axis label must end with explicit units or scale type`)
		}
	}
	const rendererName = nativeDispatches.get(chartId)
	if (rendererName === undefined) {
		throw new Error(`Quantitative chart ${chartId} is missing a native renderer dispatch`)
	}
	assertRendererAxisBindings(runtimeSourceFile, chartId, rendererName)
}
const unknownDispatchProbe = ts.createSourceFile('unknown-dispatch-negative-probe.ts', "function createChart(chartId: string, spec: unknown) { if (chartId === 'plot-unregistered-negative-probe') { return probeRenderer(spec) } return markDrivenDiagramChart(spec) }", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const unknownDispatchResult = readNativeChartDispatches(unknownDispatchProbe)
if (unknownDispatchResult.issue !== undefined || nativeRegistryCoverageIssue(new Set(unknownDispatchResult.dispatches.keys())) === undefined) {
	throw new Error('Documentation chart validator negative probe unexpectedly accepted an unregistered native chart dispatch')
}
const duplicateDispatchProbe = ts.createSourceFile(
	'duplicate-dispatch-negative-probe.ts',
	"function createChart(chartId: string, spec: unknown) { if (chartId === 'duplicate') { return firstRenderer(spec) } if (chartId === 'duplicate') { return secondRenderer(spec) } return markDrivenDiagramChart(spec) }",
	ts.ScriptTarget.Latest,
	true,
	ts.ScriptKind.TS,
)
if (readNativeChartDispatches(duplicateDispatchProbe).issue === undefined) {
	throw new Error('Documentation chart validator negative probe unexpectedly accepted a duplicate native chart dispatch')
}
const unsupportedDispatchProbe = ts.createSourceFile('unsupported-dispatch-negative-probe.ts', "function createChart(chartId: string, spec: unknown) { switch (chartId) { case 'unsupported': return probeRenderer(spec) } return markDrivenDiagramChart(spec) }", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
if (readNativeChartDispatches(unsupportedDispatchProbe).issue === undefined) {
	throw new Error('Documentation chart validator negative probe unexpectedly accepted an unsupported native chart dispatch shape')
}
const detachedLabelSource = ts.createSourceFile('axis-negative-probe.ts', "function negativeProbeRenderer() { const axes = quantitativeChartAxisLabels['fig-auction-clearing-ladder']; return plot({ x: { label: axes.x }, y: { label: null } }) }", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const detachedLabelOptions = findPlotOptions(findFunctionDeclaration(detachedLabelSource, 'negativeProbeRenderer'), detachedLabelSource)
if (axisUsesRegisteredLabel(detachedLabelOptions, 'y', detachedLabelSource)) {
	throw new Error('Documentation chart validator negative probe unexpectedly accepted a detached y-axis registry label')
}
if (!runtimeSource.includes('return markDrivenDiagramChart(spec)') || /createElementNS|RenderFunction|narrativeMark/.test(runtimeSource)) {
	throw new Error('Documentation flowcharts must use native Observable Plot marks without raw SVG DOM reconstruction')
}
if (!runtimeSource.includes("mount.closest<HTMLElement>('figure.diagram, .example-visual')") || !runtimeSource.includes('overflowEnvelope.tabIndex = 0') || !runtimeSource.includes('Scrollable figure: ${spec.ariaLabel}')) {
	throw new Error('Documentation figure overflow wrappers must be keyboard-focusable and accessibly named')
}
if (
	!/new Set\(contractInteractionEdges\.map/.test(runtimeSource) ||
	!/does not match registry direction/.test(runtimeSource) ||
	!/is not in its \$\{panel\} phase panel/.test(runtimeSource) ||
	!/leaves its \$\{panel\} phase panel bounds/.test(runtimeSource) ||
	!/does not touch its source and receiver boundaries/.test(runtimeSource)
) {
	throw new Error('Contract interaction map must validate every route ID, direction, phase bounds, and endpoint against the shared interaction registry')
}
const layoutPanels = new Map<string, { id: string; x1: number; x2: number; y1: number; y2: number }>()
for (const element of findContractInteractionArray(runtimeSourceFile, 'panels').elements) {
	if (!ts.isObjectLiteralExpression(element)) throw new Error('Contract interaction panel must be an object literal')
	const panel = {
		id: readStringProperty(element, 'id', runtimeSourceFile),
		x1: readNumberProperty(element, 'x1', runtimeSourceFile),
		x2: readNumberProperty(element, 'x2', runtimeSourceFile),
		y1: readNumberProperty(element, 'y1', runtimeSourceFile),
		y2: readNumberProperty(element, 'y2', runtimeSourceFile),
	}
	layoutPanels.set(panel.id, panel)
}
const layoutNodes = new Map<string, { id: string; label: string; x1: number; x2: number; y1: number; y2: number }>()
for (const element of findContractInteractionArray(runtimeSourceFile, 'nodes').elements) {
	if (!ts.isObjectLiteralExpression(element)) throw new Error('Contract interaction node must be an object literal')
	const node = {
		id: readStringProperty(element, 'id', runtimeSourceFile),
		label: readStringProperty(element, 'label', runtimeSourceFile),
		x1: readNumberProperty(element, 'x1', runtimeSourceFile),
		x2: readNumberProperty(element, 'x2', runtimeSourceFile),
		y1: readNumberProperty(element, 'y1', runtimeSourceFile),
		y2: readNumberProperty(element, 'y2', runtimeSourceFile),
	}
	layoutNodes.set(node.id, node)
}
const layoutRoutes = findContractInteractionArray(runtimeSourceFile, 'routedEdges').elements.map(element => {
	if (!ts.isObjectLiteralExpression(element)) throw new Error('Contract interaction route must be an object literal')
	const pointsExpression = readObjectProperty(element, 'points', runtimeSourceFile)
	if (!ts.isArrayLiteralExpression(pointsExpression)) throw new Error('Contract interaction route points must be an array literal')
	const points = pointsExpression.elements.map(point => {
		if (!ts.isObjectLiteralExpression(point)) throw new Error('Contract interaction route point must be an object literal')
		return { x: readNumberProperty(point, 'x', runtimeSourceFile), y: readNumberProperty(point, 'y', runtimeSourceFile) }
	})
	return {
		id: readStringProperty(element, 'id', runtimeSourceFile),
		points,
		receiverNodeId: readStringProperty(element, 'receiverNodeId', runtimeSourceFile),
		sourceNodeId: readStringProperty(element, 'sourceNodeId', runtimeSourceFile),
	}
})
function expectedPanelForPhase(phase: string): string {
	if (phase === 'Deployment' || phase === 'Universe lifecycle') return 'deploy'
	if (['Market runtime', 'Price discovery', 'Price settlement', 'Resolution', 'Risk execution', 'Risk operations'].includes(phase)) return 'runtime'
	if (['Backing repair', 'Fork migration', 'Fork snapshot', 'Share migration'].includes(phase)) return 'fork'
	throw new Error(`Contract interaction registry has an unsupported phase ${phase}`)
}
function touchesBoundary(point: { x: number; y: number }, node: { x1: number; x2: number; y1: number; y2: number }): boolean {
	const tolerance = 0.000_001
	const withinX = point.x >= node.x1 - tolerance && point.x <= node.x2 + tolerance
	const withinY = point.y >= node.y1 - tolerance && point.y <= node.y2 + tolerance
	const touchesHorizontal = Math.abs(point.y - node.y1) <= tolerance || Math.abs(point.y - node.y2) <= tolerance
	const touchesVertical = Math.abs(point.x - node.x1) <= tolerance || Math.abs(point.x - node.x2) <= tolerance
	return (withinX && touchesHorizontal) || (withinY && touchesVertical)
}
function segmentsIntersect(firstStart: { x: number; y: number }, firstEnd: { x: number; y: number }, secondStart: { x: number; y: number }, secondEnd: { x: number; y: number }): boolean {
	const tolerance = 0.000_001
	const cross = (origin: { x: number; y: number }, first: { x: number; y: number }, second: { x: number; y: number }) => (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x)
	const firstSideStart = cross(firstStart, firstEnd, secondStart)
	const firstSideEnd = cross(firstStart, firstEnd, secondEnd)
	const secondSideStart = cross(secondStart, secondEnd, firstStart)
	const secondSideEnd = cross(secondStart, secondEnd, firstEnd)
	const properIntersection = firstSideStart * firstSideEnd < -tolerance && secondSideStart * secondSideEnd < -tolerance
	const liesOnSegment = (point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }) =>
		Math.abs(cross(start, end, point)) <= tolerance && point.x >= Math.min(start.x, end.x) - tolerance && point.x <= Math.max(start.x, end.x) + tolerance && point.y >= Math.min(start.y, end.y) - tolerance && point.y <= Math.max(start.y, end.y) + tolerance
	return properIntersection || liesOnSegment(secondStart, firstStart, firstEnd) || liesOnSegment(secondEnd, firstStart, firstEnd) || liesOnSegment(firstStart, secondStart, secondEnd) || liesOnSegment(firstEnd, secondStart, secondEnd)
}
const routeById = new Map(layoutRoutes.map(route => [route.id, route]))
if (routeById.size !== contractInteractionEdges.length || layoutRoutes.length !== contractInteractionEdges.length) {
	throw new Error(`Contract interaction layout has ${layoutRoutes.length} routes for ${contractInteractionEdges.length} registry edges`)
}
for (const edge of contractInteractionEdges) {
	const route = routeById.get(edge.id)
	if (route === undefined) throw new Error(`Contract interaction layout is missing ${edge.id}`)
	const sourceNode = layoutNodes.get(route.sourceNodeId)
	const receiverNode = layoutNodes.get(route.receiverNodeId)
	const firstPoint = route.points[0]
	const lastPoint = route.points[route.points.length - 1]
	if (sourceNode === undefined || receiverNode === undefined || firstPoint === undefined || lastPoint === undefined) {
		throw new Error(`Contract interaction layout route ${edge.id} is incomplete`)
	}
	if (sourceNode.label !== edge.source || receiverNode.label !== edge.receiver) {
		throw new Error(`Contract interaction layout route ${edge.id} reverses or changes ${edge.source} to ${edge.receiver}`)
	}
	const panel = expectedPanelForPhase(edge.phase)
	const panelBounds = layoutPanels.get(panel)
	if (panelBounds === undefined || !sourceNode.id.startsWith(`${panel}-`) || !receiverNode.id.startsWith(`${panel}-`)) {
		throw new Error(`Contract interaction layout route ${edge.id} is outside its ${panel} phase panel`)
	}
	const sourceInsidePanel = sourceNode.x1 >= panelBounds.x1 && sourceNode.x2 <= panelBounds.x2 && sourceNode.y1 >= panelBounds.y1 && sourceNode.y2 <= panelBounds.y2
	const receiverInsidePanel = receiverNode.x1 >= panelBounds.x1 && receiverNode.x2 <= panelBounds.x2 && receiverNode.y1 >= panelBounds.y1 && receiverNode.y2 <= panelBounds.y2
	const routeInsidePanel = route.points.every(point => point.x >= panelBounds.x1 && point.x <= panelBounds.x2 && point.y >= panelBounds.y1 && point.y <= panelBounds.y2)
	if (!sourceInsidePanel || !receiverInsidePanel || !routeInsidePanel) {
		throw new Error(`Contract interaction layout route ${edge.id} leaves its ${panel} phase panel bounds`)
	}
	if (!touchesBoundary(firstPoint, sourceNode) || !touchesBoundary(lastPoint, receiverNode)) {
		throw new Error(`Contract interaction layout route ${edge.id} misses its source or receiver boundary`)
	}
	if (edge.action.trim().length === 0) throw new Error(`Contract interaction registry edge ${edge.id} is missing its short action label`)
}
for (let firstRouteIndex = 0; firstRouteIndex < layoutRoutes.length; firstRouteIndex += 1) {
	const firstRoute = layoutRoutes[firstRouteIndex]
	if (firstRoute === undefined) continue
	for (let secondRouteIndex = firstRouteIndex + 1; secondRouteIndex < layoutRoutes.length; secondRouteIndex += 1) {
		const secondRoute = layoutRoutes[secondRouteIndex]
		if (secondRoute === undefined) continue
		for (let firstSegmentIndex = 1; firstSegmentIndex < firstRoute.points.length; firstSegmentIndex += 1) {
			const firstStart = firstRoute.points[firstSegmentIndex - 1]
			const firstEnd = firstRoute.points[firstSegmentIndex]
			if (firstStart === undefined || firstEnd === undefined) continue
			for (let secondSegmentIndex = 1; secondSegmentIndex < secondRoute.points.length; secondSegmentIndex += 1) {
				const secondStart = secondRoute.points[secondSegmentIndex - 1]
				const secondEnd = secondRoute.points[secondSegmentIndex]
				if (secondStart !== undefined && secondEnd !== undefined && segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
					throw new Error(`Contract interaction layout routes ${firstRoute.id} and ${secondRoute.id} cross or overlap`)
				}
			}
		}
	}
}
const contractInteractionHtml = await readFile(path.join(docsDirectory, 'contract-interactions.html'), 'utf8')
const contractInteractionWindow = new Window()
contractInteractionWindow.document.write(contractInteractionHtml)
contractInteractionWindow.document.close()
const contractAtlasCaption = contractInteractionWindow.document.querySelector('#fig-complete-contract-atlas .diagram-caption')?.textContent.replace(/\s+/g, ' ').trim()
contractInteractionWindow.close()
const productionDeclarationCount = contractAtlasNodes.filter(node => node.declaration !== undefined && node.panel !== 'tests').length
const testDeclarationCount = contractAtlasNodes.filter(node => node.declaration !== undefined && node.panel === 'tests').length
const contractAtlasSpec = parsedSpecs['fig-complete-contract-atlas']
const contractAtlasAriaDescription = isRecord(contractAtlasSpec) ? contractAtlasSpec['ariaDescription'] : undefined
if (
	contractAtlasCaption === undefined ||
	!contractAtlasCaption.includes(`default protocol-flow layer shows ${expectedContractAtlasViewRouteCounts.protocol} routes`) ||
	!contractAtlasCaption.includes(`layer controls expose every one of the ${expectedContractAtlasPlotRouteCount} routes while keeping all ${expectedContractAtlasNodeCount} components fixed`) ||
	!contractAtlasCaption.includes(`all ${expectedContractAtlasRelationshipCount} meanings remain`)
) {
	throw new Error('Complete contract atlas caption must state its exact default-layer, plot-route, component, and relationship counts')
}
if (
	!contractInteractionHtml.includes(`all ${productionDeclarationCount + testDeclarationCount} Solidity declarations`) ||
	!contractInteractionHtml.includes(`${productionDeclarationCount} production declarations and ${testDeclarationCount}`) ||
	!contractInteractionHtml.includes(`${expectedContractAtlasNodeCount} nodes and ${expectedContractAtlasRelationshipCount} relationships`) ||
	!contractInteractionHtml.includes(`${expectedContractAtlasPlotRouteCount} ordered source-target routes`) ||
	!contractInteractionHtml.includes(`protocol-flow layer shows ${expectedContractAtlasViewRouteCounts.protocol} routes`) ||
	!contractInteractionHtml.includes('data-contract-atlas-controls') ||
	!contractInteractionHtml.includes('data-contract-atlas-view="protocol"') ||
	!contractInteractionHtml.includes('data-contract-atlas-view="all"') ||
	!contractInteractionHtml.includes(`complete ${expectedContractAtlasNodeCount}-component inventory`) ||
	!contractInteractionHtml.includes('data-contract-atlas-node-table') ||
	!contractInteractionHtml.includes('data-contract-atlas-table') ||
	!runtimeSource.includes('renderContractAtlasInventoryTable()') ||
	!runtimeSource.includes('contractAtlasInventoryRows.map') ||
	!runtimeSource.includes('renderContractAtlasTable()') ||
	!runtimeSource.includes('contractAtlasRelationshipRows.map') ||
	!runtimeSource.includes('contractAtlasPlotRoutesForView(view).map') ||
	!runtimeSource.includes('contractAtlasPlotRouteMeaning(route)') ||
	!runtimeSource.includes('spreadContractAtlasPorts(positionedEdges') ||
	!runtimeSource.includes("chart.dataset['plotRouteCount']") ||
	!runtimeSource.includes("chart.dataset['visibleRouteCount']") ||
	typeof contractAtlasAriaDescription !== 'string' ||
	!contractAtlasAriaDescription.includes(`${expectedContractAtlasRelationshipCount} relationships grouped into ${expectedContractAtlasPlotRouteCount} ordered source-target routes`) ||
	!contractAtlasAriaDescription.includes(`${expectedContractAtlasViewRouteCounts.protocol}-route protocol-flow layer`)
) {
	throw new Error('Complete contract atlas page must state its checked inventory and layered plot-route counts, expose reduced-overlap controls, and mount the generated component and relationship registers')
}
for (const view of contractAtlasViewDefinitions) {
	if (!contractInteractionHtml.includes(`data-contract-atlas-view="${view.id}"`) || !contractInteractionHtml.includes(`data-contract-atlas-view-count="${view.id}"`)) {
		throw new Error(`Complete contract atlas page is missing its ${view.id} relationship-layer control`)
	}
}
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
