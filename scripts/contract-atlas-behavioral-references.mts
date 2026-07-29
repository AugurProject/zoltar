import path from 'node:path'
import solc from 'solc'
import type { ContractAtlasBehavioralReference } from '../docs/charts/contractAtlasBehavioralReferences'
import type { ContractAtlasSourceReference, ContractAtlasSourceNode } from './contract-atlas-source-references.mts'

type AstRecord = Record<string, unknown>

type IndexedAstNode = {
	node: AstRecord
	owner?: AstRecord
	source: string
}

type BehavioralReferenceAccumulator = {
	members: Set<string>
	relation: ContractAtlasBehavioralReference['relation']
	source: string
	target: string
}

const openOraclePragma = 'pragma solidity 0.8.28;'
const mainCompilerPragma = 'pragma solidity 0.8.35;'
const openZeppelinLocalPrefix = 'solidity/contracts/peripherals/openOracle/openzeppelin/contracts/'
const openZeppelinImportPrefix = '@openzeppelin/contracts/'

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isAstRecord(value: unknown): value is AstRecord {
	return isObjectRecord(value) && typeof value['nodeType'] === 'string'
}

function astChildren(node: AstRecord): AstRecord[] {
	const children: AstRecord[] = []
	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const child of value) {
				if (isAstRecord(child)) children.push(child)
			}
		} else if (isAstRecord(value)) {
			children.push(value)
		}
	}
	return children
}

function repositorySourcePath(compilerPath: string): string {
	if (compilerPath.startsWith(openZeppelinImportPrefix)) {
		return `${openZeppelinLocalPrefix}${compilerPath.slice(openZeppelinImportPrefix.length)}`
	}
	return compilerPath
}

function compileAst(sources: ReadonlyMap<string, string>): Map<string, AstRecord> {
	const compilerSources: Record<string, { content: string }> = {}
	for (const [sourcePath, originalContent] of sources) {
		const content = originalContent.replaceAll(openOraclePragma, mainCompilerPragma)
		compilerSources[sourcePath] = { content }
		if (sourcePath.startsWith(openZeppelinLocalPrefix)) {
			compilerSources[`${openZeppelinImportPrefix}${sourcePath.slice(openZeppelinLocalPrefix.length)}`] = { content }
		}
	}
	const outputText = solc.compile(
		JSON.stringify({
			language: 'Solidity',
			settings: {
				outputSelection: {
					'*': {
						'': ['ast'],
					},
				},
			},
			sources: compilerSources,
		}),
	)
	const output: unknown = JSON.parse(outputText)
	if (!isObjectRecord(output)) throw new Error('Contract atlas behavioral analysis received an invalid Solidity compiler result')
	const diagnostics = output['errors']
	if (Array.isArray(diagnostics)) {
		const errors = diagnostics.flatMap(diagnostic => {
			if (!isObjectRecord(diagnostic) || diagnostic['severity'] !== 'error') return []
			const formattedMessage = diagnostic['formattedMessage']
			return [typeof formattedMessage === 'string' ? formattedMessage : 'Unknown Solidity compiler error']
		})
		if (errors.length > 0) throw new Error(`Contract atlas behavioral analysis could not compile Solidity ASTs:\n${errors.join('\n')}`)
	}
	const compiledSources = output['sources']
	if (!isObjectRecord(compiledSources)) throw new Error('Contract atlas behavioral analysis received no Solidity compiler sources')
	const astBySource = new Map<string, AstRecord>()
	for (const [sourcePath, sourceOutput] of Object.entries(compiledSources)) {
		if (!isObjectRecord(sourceOutput)) continue
		const ast = sourceOutput['ast']
		if (!isAstRecord(ast)) continue
		astBySource.set(sourcePath, ast)
	}
	return astBySource
}

function indexAst(astBySource: ReadonlyMap<string, AstRecord>): Map<number, IndexedAstNode> {
	const nodeById = new Map<number, IndexedAstNode>()
	function visit(node: AstRecord, source: string, owner?: AstRecord): void {
		const nextOwner = node['nodeType'] === 'ContractDefinition' ? node : owner
		const id = node['id']
		if (typeof id === 'number') {
			nodeById.set(id, nextOwner === undefined ? { node, source } : { node, owner: nextOwner, source })
		}
		for (const child of astChildren(node)) visit(child, source, nextOwner)
	}
	for (const [source, ast] of astBySource) visit(ast, source)
	return nodeById
}

function referencedNode(node: AstRecord, nodeById: ReadonlyMap<number, IndexedAstNode>): IndexedAstNode | undefined {
	const referencedDeclaration = node['referencedDeclaration']
	return typeof referencedDeclaration === 'number' ? nodeById.get(referencedDeclaration) : undefined
}

function contractDefinitionFromType(node: AstRecord, nodeById: ReadonlyMap<number, IndexedAstNode>): IndexedAstNode | undefined {
	const typeDescriptions = node['typeDescriptions']
	if (!isObjectRecord(typeDescriptions)) return undefined
	const typeIdentifier = typeDescriptions['typeIdentifier']
	if (typeof typeIdentifier !== 'string') return undefined
	const contractIdText = typeIdentifier.match(/t_contract\$_[^$]*_\$(\d+)/)?.[1]
	return contractIdText === undefined ? undefined : nodeById.get(Number(contractIdText))
}

function atlasNodeForDefinition(
	definition: IndexedAstNode,
	nodesBySourceAndDeclaration: ReadonlyMap<string, ContractAtlasSourceNode>,
	nodesBySource: ReadonlyMap<string, readonly ContractAtlasSourceNode[]>,
	sourceOwnerOverrides: Readonly<Record<string, string>>,
	nodesById: ReadonlyMap<string, ContractAtlasSourceNode>,
): ContractAtlasSourceNode | undefined {
	const source = repositorySourcePath(definition.source)
	const declaration = definition.owner?.['name']
	if (typeof declaration === 'string') {
		const directNode = nodesBySourceAndDeclaration.get(`${source}#${declaration}`)
		if (directNode !== undefined) return directNode
	}
	const override = sourceOwnerOverrides[source]
	if (override !== undefined) return nodesById.get(override)
	const sourceNodes = nodesBySource.get(source) ?? []
	return sourceNodes.length === 1 ? sourceNodes[0] : undefined
}

function usingForMember(node: AstRecord): { libraryNode: AstRecord; member: string } | undefined {
	const libraryName = node['libraryName']
	if (!isAstRecord(libraryName)) return undefined
	const typeName = node['typeName']
	let typeLabel = 'type'
	if (isAstRecord(typeName)) {
		const pathNode = typeName['pathNode']
		if (isAstRecord(pathNode) && typeof pathNode['name'] === 'string') typeLabel = pathNode['name']
	}
	return { libraryNode: libraryName, member: `using for ${typeLabel}` }
}

function isInvokedMember(node: AstRecord, parent?: AstRecord): boolean {
	if (parent === undefined || (parent['nodeType'] !== 'FunctionCall' && parent['nodeType'] !== 'FunctionCallOptions')) return false
	return parent['expression'] === node
}

function isEncodedFunctionMember(ancestors: readonly AstRecord[]): boolean {
	for (let index = ancestors.length - 1; index >= 0; index -= 1) {
		const ancestor = ancestors[index]
		if (ancestor?.['nodeType'] !== 'FunctionCall') continue
		const expression = ancestor['expression']
		if (!isAstRecord(expression) || expression['nodeType'] !== 'MemberAccess') continue
		const receiver = expression['expression']
		const memberName = expression['memberName']
		if (isAstRecord(receiver) && receiver['nodeType'] === 'Identifier' && receiver['name'] === 'abi' && (memberName === 'encodeCall' || memberName === 'encodeWithSelector')) return true
	}
	return false
}

function isInsideNormalLowLevelCall(ancestors: readonly AstRecord[]): boolean {
	for (let index = ancestors.length - 1; index >= 0; index -= 1) {
		const ancestor = ancestors[index]
		if (ancestor?.['nodeType'] !== 'FunctionCall') continue
		const expression = ancestor['expression']
		if (!isAstRecord(expression) || expression['nodeType'] !== 'MemberAccess') continue
		if (expression['memberName'] === 'call') return true
	}
	return false
}

function lowLevelReceiverTarget(receiver: AstRecord, nodeById: ReadonlyMap<number, IndexedAstNode>): IndexedAstNode | undefined {
	const directTarget = contractDefinitionFromType(receiver, nodeById)
	if (directTarget !== undefined) return directTarget
	if (receiver['nodeType'] !== 'FunctionCall') return undefined
	const argumentsValue = receiver['arguments']
	if (!Array.isArray(argumentsValue)) return undefined
	for (const argument of argumentsValue) {
		if (!isAstRecord(argument)) continue
		const target = contractDefinitionFromType(argument, nodeById)
		if (target !== undefined) return target
	}
	return undefined
}

function assemblyCallTarget(node: AstRecord, nodeById: ReadonlyMap<number, IndexedAstNode>): IndexedAstNode | undefined {
	const assemblyAst = node['AST']
	const externalReferences = node['externalReferences']
	if (!isAstRecord(assemblyAst) || !Array.isArray(externalReferences)) return undefined
	const checkedExternalReferences: unknown[] = externalReferences
	let target: IndexedAstNode | undefined
	function visitAssembly(assemblyNode: AstRecord): void {
		if (target !== undefined) return
		if (assemblyNode['nodeType'] === 'YulFunctionCall') {
			const functionName = assemblyNode['functionName']
			const argumentsValue = assemblyNode['arguments']
			if (isObjectRecord(functionName) && functionName['name'] === 'call' && Array.isArray(argumentsValue)) {
				const receiver = argumentsValue[1]
				const receiverSource = isObjectRecord(receiver) ? receiver['src'] : undefined
				if (typeof receiverSource === 'string') {
					const reference = checkedExternalReferences.find(candidate => isObjectRecord(candidate) && candidate['src'] === receiverSource)
					const declaration = isObjectRecord(reference) ? reference['declaration'] : undefined
					const declarationNode = typeof declaration === 'number' ? nodeById.get(declaration) : undefined
					if (declarationNode !== undefined) target = contractDefinitionFromType(declarationNode.node, nodeById)
				}
			}
		}
		for (const child of astChildren(assemblyNode)) visitAssembly(child)
	}
	visitAssembly(assemblyAst)
	return target
}

export async function analyzeContractAtlasBehavioralReferences(
	contractsDirectory: string,
	nodes: readonly ContractAtlasSourceNode[],
	sourceOwnerOverrides: Readonly<Record<string, string>>,
	sourceReferences: readonly ContractAtlasSourceReference[],
	delegatecallPairs: ReadonlySet<string>,
	sourceContentOverrides: ReadonlyMap<string, string> = new Map(),
): Promise<ContractAtlasBehavioralReference[]> {
	const sources = new Map<string, string>()
	for (const entry of [...new Bun.Glob('**/*.sol').scanSync({ cwd: contractsDirectory })].sort()) {
		const sourcePath = path.posix.join('solidity/contracts', entry.split(path.sep).join('/'))
		sources.set(sourcePath, sourceContentOverrides.get(sourcePath) ?? (await Bun.file(path.join(contractsDirectory, entry)).text()))
	}
	const astBySource = compileAst(sources)
	const nodeById = indexAst(astBySource)
	const nodesById = new Map(nodes.map(node => [node.id, node]))
	const nodesBySourceAndDeclaration = new Map<string, ContractAtlasSourceNode>()
	for (const node of nodes) {
		if (node.declaration !== undefined) nodesBySourceAndDeclaration.set(`${node.source}#${node.declaration}`, node)
	}
	const nodesBySource = new Map<string, ContractAtlasSourceNode[]>()
	for (const node of nodes) {
		const sourceNodes = nodesBySource.get(node.source) ?? []
		sourceNodes.push(node)
		nodesBySource.set(node.source, sourceNodes)
	}
	const sourceReferencePairs = new Set(sourceReferences.map(reference => `${reference.source}->${reference.target}`))
	const candidatesByPair = new Map<string, BehavioralReferenceAccumulator>()
	const normalLowLevelCallPairs = new Set<string>()

	function addNormalLowLevelCallPair(sourcePath: string, owner: AstRecord, targetDefinition: IndexedAstNode | undefined): void {
		if (targetDefinition === undefined) return
		const sourceNode = atlasNodeForDefinition({ node: owner, owner, source: sourcePath }, nodesBySourceAndDeclaration, nodesBySource, sourceOwnerOverrides, nodesById)
		const targetNode = atlasNodeForDefinition(targetDefinition, nodesBySourceAndDeclaration, nodesBySource, sourceOwnerOverrides, nodesById)
		if (sourceNode !== undefined && targetNode !== undefined) normalLowLevelCallPairs.add(`${sourceNode.id}->${targetNode.id}`)
	}

	function collectNormalLowLevelCalls(node: AstRecord, sourcePath: string, owner?: AstRecord, parent?: AstRecord): void {
		const nextOwner = node['nodeType'] === 'ContractDefinition' ? node : owner
		if (nextOwner !== undefined && node['nodeType'] === 'MemberAccess' && node['memberName'] === 'call' && isInvokedMember(node, parent)) {
			const receiver = node['expression']
			if (isAstRecord(receiver)) addNormalLowLevelCallPair(sourcePath, nextOwner, lowLevelReceiverTarget(receiver, nodeById))
		}
		if (nextOwner !== undefined && node['nodeType'] === 'InlineAssembly') {
			addNormalLowLevelCallPair(sourcePath, nextOwner, assemblyCallTarget(node, nodeById))
		}
		for (const child of astChildren(node)) collectNormalLowLevelCalls(child, sourcePath, nextOwner, node)
	}

	for (const [compilerPath, ast] of astBySource) {
		if (compilerPath.startsWith(openZeppelinImportPrefix)) continue
		collectNormalLowLevelCalls(ast, compilerPath)
	}

	function addCandidate(source: ContractAtlasSourceNode, target: ContractAtlasSourceNode, relation: 'calls' | 'uses', member: string): void {
		if (source.id === target.id || !sourceReferencePairs.has(`${source.id}->${target.id}`)) return
		const resolvedRelation: ContractAtlasBehavioralReference['relation'] = source.panel === 'tests' && relation === 'calls' ? 'tests' : relation
		const pair = `${source.id}->${target.id}`
		const existing = candidatesByPair.get(pair)
		if (existing === undefined) {
			candidatesByPair.set(pair, {
				members: new Set([member]),
				relation: resolvedRelation,
				source: source.id,
				target: target.id,
			})
			return
		}
		existing.members.add(member)
		if (existing.relation === 'uses' && resolvedRelation !== 'uses') existing.relation = resolvedRelation
	}

	function visit(node: AstRecord, sourcePath: string, owner?: AstRecord, ancestors: readonly AstRecord[] = []): void {
		const nextOwner = node['nodeType'] === 'ContractDefinition' ? node : owner
		if (nextOwner !== undefined && node['nodeType'] === 'MemberAccess') {
			const referenced = referencedNode(node, nodeById)
			const expression = node['expression']
			const referencedNodeType = referenced?.node['nodeType']
			const referencedOwnerKind = referenced?.owner?.['contractKind']
			const parent = ancestors[ancestors.length - 1]
			const isDirectFunctionInvocation = referencedNodeType === 'FunctionDefinition' && isInvokedMember(node, parent)
			const isEncodedFunctionInvocation = referencedNodeType === 'FunctionDefinition' && !isDirectFunctionInvocation && isEncodedFunctionMember(ancestors)
			const isFunction = isDirectFunctionInvocation || isEncodedFunctionInvocation
			const isLibraryMember = referencedOwnerKind === 'library' && (isFunction || referencedNodeType === 'VariableDeclaration' || referencedNodeType === 'EnumValue')
			let targetDefinition: IndexedAstNode | undefined
			if (isLibraryMember) {
				targetDefinition = referenced
			} else if (isFunction && isAstRecord(expression)) {
				targetDefinition = contractDefinitionFromType(expression, nodeById) ?? referenced
			}
			const sourceNode = atlasNodeForDefinition({ node: nextOwner, owner: nextOwner, source: sourcePath }, nodesBySourceAndDeclaration, nodesBySource, sourceOwnerOverrides, nodesById)
			const targetNode = targetDefinition === undefined ? undefined : atlasNodeForDefinition(targetDefinition, nodesBySourceAndDeclaration, nodesBySource, sourceOwnerOverrides, nodesById)
			const memberName = typeof node['memberName'] === 'string' ? node['memberName'] : referenced?.node['name']
			if (sourceNode !== undefined && targetNode !== undefined && typeof memberName === 'string') {
				const pair = `${sourceNode.id}->${targetNode.id}`
				const isNormalEncodedInvocation = isEncodedFunctionInvocation && (isInsideNormalLowLevelCall(ancestors) || normalLowLevelCallPairs.has(pair))
				if (!isEncodedFunctionInvocation || (isNormalEncodedInvocation && !delegatecallPairs.has(pair))) {
					addCandidate(sourceNode, targetNode, isLibraryMember ? 'uses' : 'calls', memberName)
				}
			}
		}
		if (nextOwner !== undefined && node['nodeType'] === 'UsingForDirective') {
			const usingMember = usingForMember(node)
			const libraryDefinition = usingMember === undefined ? undefined : referencedNode(usingMember.libraryNode, nodeById)
			const sourceNode = atlasNodeForDefinition({ node: nextOwner, owner: nextOwner, source: sourcePath }, nodesBySourceAndDeclaration, nodesBySource, sourceOwnerOverrides, nodesById)
			const targetNode = libraryDefinition === undefined ? undefined : atlasNodeForDefinition(libraryDefinition, nodesBySourceAndDeclaration, nodesBySource, sourceOwnerOverrides, nodesById)
			if (sourceNode !== undefined && targetNode !== undefined && usingMember !== undefined) {
				addCandidate(sourceNode, targetNode, 'uses', usingMember.member)
			}
		}
		for (const child of astChildren(node)) visit(child, sourcePath, nextOwner, [...ancestors, node])
	}

	for (const [compilerPath, ast] of astBySource) {
		if (compilerPath.startsWith(openZeppelinImportPrefix)) continue
		visit(ast, compilerPath)
	}
	return [...candidatesByPair.values()]
		.map(candidate => ({
			members: [...candidate.members].sort(),
			relation: candidate.relation,
			source: candidate.source,
			target: candidate.target,
		}))
		.sort((first, second) => `${first.source}->${first.target}`.localeCompare(`${second.source}->${second.target}`))
}

function behavioralReferenceKeys(references: readonly ContractAtlasBehavioralReference[]): string[] {
	return references.map(reference => `${reference.source}->${reference.target}:${reference.relation}:${[...reference.members].sort().join(',')}`)
}

export function contractAtlasBehavioralReferenceIssue(expectedReferences: readonly ContractAtlasBehavioralReference[], registeredReferences: readonly ContractAtlasBehavioralReference[]): string | undefined {
	const expectedKeys = behavioralReferenceKeys(expectedReferences)
	const registeredKeys = behavioralReferenceKeys(registeredReferences)
	if (new Set(registeredKeys).size !== registeredKeys.length) {
		return 'Complete contract atlas behavioral references contain duplicate ordered pairs'
	}
	const expectedKeySet = new Set(expectedKeys)
	const registeredKeySet = new Set(registeredKeys)
	const missing = expectedKeys.filter(key => !registeredKeySet.has(key))
	const extra = registeredKeys.filter(key => !expectedKeySet.has(key))
	if (missing.length === 0 && extra.length === 0) return undefined
	return `Complete contract atlas behavioral-reference mismatch; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`
}
