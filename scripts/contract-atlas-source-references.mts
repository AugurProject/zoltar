import path from 'node:path'

export type ContractAtlasSourceNode = {
	declaration?: string
	id: string
	kind: string
	panel?: string
	source: string
}

export type ContractAtlasSourceReference = {
	source: string
	symbols: string[]
	target: string
}

export type ContractAtlasSourceSemanticRelationship = ContractAtlasSourceReference & {
	relation: 'delegatecall' | 'implements' | 'inherits'
}

export type ContractAtlasSourceUnit = {
	nodeId: string
	source: string
}

export type ContractAtlasSourceAnalysis = {
	delegatecalls: ContractAtlasSourceSemanticRelationship[]
	directBases: ContractAtlasSourceSemanticRelationship[]
	explicitDeployments: ContractAtlasSourceReference[]
	references: ContractAtlasSourceReference[]
	sourceUnits: ContractAtlasSourceUnit[]
}

type ImportName = {
	local: string
	original: string
}

type SourceImport = {
	names: ImportName[]
	target: string
}

type DeclarationSpan = {
	end: number
	node: ContractAtlasSourceNode
	start: number
	text: string
}

function maskCommentsAndStrings(source: string): string {
	const characters = [...source]
	let state: 'block-comment' | 'code' | 'double-quoted' | 'line-comment' | 'single-quoted' = 'code'
	let escaped = false
	for (let index = 0; index < characters.length; index += 1) {
		const character = characters[index]
		const nextCharacter = characters[index + 1]
		if (character === undefined) continue
		if (state === 'code') {
			if (character === '/' && nextCharacter === '/') {
				characters[index] = ' '
				characters[index + 1] = ' '
				state = 'line-comment'
				index += 1
			} else if (character === '/' && nextCharacter === '*') {
				characters[index] = ' '
				characters[index + 1] = ' '
				state = 'block-comment'
				index += 1
			} else if (character === "'") {
				characters[index] = ' '
				state = 'single-quoted'
			} else if (character === '"') {
				characters[index] = ' '
				state = 'double-quoted'
			}
			continue
		}
		if (state === 'line-comment') {
			if (character === '\n') {
				state = 'code'
			} else {
				characters[index] = ' '
			}
			continue
		}
		if (state === 'block-comment') {
			if (character === '*' && nextCharacter === '/') {
				characters[index] = ' '
				characters[index + 1] = ' '
				state = 'code'
				index += 1
			} else if (character !== '\n') {
				characters[index] = ' '
			}
			continue
		}
		if (escaped) {
			if (character !== '\n') characters[index] = ' '
			escaped = false
			continue
		}
		if (character === '\\') {
			characters[index] = ' '
			escaped = true
			continue
		}
		const closingQuote = state === 'single-quoted' ? "'" : '"'
		if (character === closingQuote) {
			characters[index] = ' '
			state = 'code'
		} else if (character !== '\n') {
			characters[index] = ' '
		}
	}
	return characters.join('')
}

function matchingBrace(source: string, openingIndex: number): number {
	let depth = 0
	for (let index = openingIndex; index < source.length; index += 1) {
		const character = source[index]
		if (character === '{') depth += 1
		if (character !== '}') continue
		depth -= 1
		if (depth === 0) return index + 1
	}
	throw new Error(`Solidity declaration at offset ${openingIndex} has no closing brace`)
}

function declarationSpans(sourcePath: string, source: string, nodes: readonly ContractAtlasSourceNode[]): DeclarationSpan[] {
	const maskedSource = maskCommentsAndStrings(source)
	const declarationPattern = /^(abstract contract|contract|interface|library)\s+([A-Za-z_]\w*)\b/gm
	const spans: DeclarationSpan[] = []
	for (const match of maskedSource.matchAll(declarationPattern)) {
		const declaration = match[2]
		const start = match.index
		if (declaration === undefined || start === undefined) {
			throw new Error(`Could not parse a Solidity declaration in ${sourcePath}`)
		}
		const openingIndex = maskedSource.indexOf('{', start)
		if (openingIndex < 0) throw new Error(`Solidity declaration ${sourcePath}#${declaration} has no body`)
		const node = nodes.find(candidate => candidate.declaration === declaration)
		if (node === undefined) throw new Error(`Contract atlas has no node for ${sourcePath}#${declaration}`)
		const end = matchingBrace(maskedSource, openingIndex)
		spans.push({ end, node, start, text: maskedSource.slice(start, end) })
	}
	return spans
}

function resolveImportPath(sourcePath: string, specifier: string): string {
	if (specifier.startsWith('@openzeppelin/contracts/')) {
		return `solidity/contracts/peripherals/openOracle/openzeppelin/contracts/${specifier.slice('@openzeppelin/contracts/'.length)}`
	}
	return path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier))
}

function parseImports(sourcePath: string, source: string): SourceImport[] {
	const imports: SourceImport[] = []
	const importPattern = /import\s+(?:(\{[\s\S]*?\}|\*\s+as\s+[A-Za-z_]\w*)\s+from\s+)?['"]([^'"]+)['"]\s*;/g
	for (const match of source.matchAll(importPattern)) {
		const clause = match[1]
		const specifier = match[2]
		if (specifier === undefined) throw new Error(`Could not parse an import in ${sourcePath}`)
		let names: ImportName[] = []
		if (clause?.startsWith('{')) {
			names = clause
				.slice(1, -1)
				.split(',')
				.map(name => name.trim())
				.filter(name => name.length > 0)
				.map(name => {
					const [original, alias] = name.split(/\s+as\s+/)
					if (original === undefined) throw new Error(`Could not parse imported name ${name} in ${sourcePath}`)
					return { local: (alias ?? original).trim(), original: original.trim() }
				})
		} else if (clause?.startsWith('*')) {
			const namespace = clause.split(/\s+as\s+/)[1]
			if (namespace === undefined) throw new Error(`Could not parse namespace import ${clause} in ${sourcePath}`)
			names = [{ local: namespace.trim(), original: '*' }]
		}
		imports.push({ names, target: resolveImportPath(sourcePath, specifier) })
	}
	return imports
}

function escapedIdentifier(identifier: string): string {
	return identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function directlyDelegatesToType(source: string, typeName: string): boolean {
	const escapedType = escapedIdentifier(typeName)
	const variableNames = new Set<string>()
	const typedVariablePattern = new RegExp(`\\b${escapedType}\\s+(?:(?:constant|immutable|internal|private|public)\\s+)*([A-Za-z_]\\w*)\\b`, 'g')
	for (const match of source.matchAll(typedVariablePattern)) {
		const variableName = match[1]
		if (variableName !== undefined) variableNames.add(variableName)
	}
	const deployedVariablePattern = new RegExp(`\\b([A-Za-z_]\\w*)\\s*=\\s*(?:address\\s*\\(\\s*)?new\\s+${escapedType}\\b`, 'g')
	for (const match of source.matchAll(deployedVariablePattern)) {
		const variableName = match[1]
		if (variableName !== undefined) variableNames.add(variableName)
	}
	const addressAliases = [...source.matchAll(/\baddress\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g)]
	const delegateForwarders = [...source.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(\s*address\s+([A-Za-z_]\w*)[\s\S]*?\)\s*[^{;]*\{/g)]
	function isDelegateTarget(variableName: string): boolean {
		const escapedVariable = escapedIdentifier(variableName)
		const memberDelegatecall = new RegExp(`(?:\\baddress\\s*\\(\\s*)?\\b${escapedVariable}\\b(?:\\s*\\))?\\s*\\.\\s*delegatecall\\s*\\(`)
		const assemblyDelegatecall = new RegExp(`\\bdelegatecall\\s*\\([^,]*,\\s*${escapedVariable}\\s*,`)
		return memberDelegatecall.test(source) || assemblyDelegatecall.test(source)
	}
	for (const variableName of variableNames) {
		if (isDelegateTarget(variableName)) return true
		for (const alias of addressAliases) {
			const aliasName = alias[1]
			const assignment = alias[2]
			if (aliasName !== undefined && assignment !== undefined && new RegExp(`\\b${escapedIdentifier(variableName)}\\b`).test(assignment) && isDelegateTarget(aliasName)) {
				return true
			}
		}
		for (const forwarder of delegateForwarders) {
			const functionName = forwarder[1]
			const delegateParameter = forwarder[2]
			if (functionName !== undefined && delegateParameter !== undefined && isDelegateTarget(delegateParameter) && new RegExp(`\\b${escapedIdentifier(functionName)}\\s*\\(\\s*${escapedIdentifier(variableName)}\\b`).test(source)) {
				return true
			}
		}
	}
	return false
}

export async function analyzeContractAtlasSource(contractsDirectory: string, nodes: readonly ContractAtlasSourceNode[], sourceOwnerOverrides: Readonly<Record<string, string>>): Promise<ContractAtlasSourceAnalysis> {
	const sourceEntries = [...new Bun.Glob('**/*.sol').scanSync({ cwd: contractsDirectory })].sort()
	const sources = new Map<string, string>()
	for (const entry of sourceEntries) {
		const repositoryPath = path.posix.join('solidity/contracts', entry.split(path.sep).join('/'))
		sources.set(repositoryPath, await Bun.file(path.join(contractsDirectory, entry)).text())
	}
	const nodesBySource = new Map<string, ContractAtlasSourceNode[]>()
	for (const node of nodes) {
		const sourceNodes = nodesBySource.get(node.source) ?? []
		sourceNodes.push(node)
		nodesBySource.set(node.source, sourceNodes)
	}
	const spansBySource = new Map<string, DeclarationSpan[]>()
	const importsBySource = new Map<string, SourceImport[]>()
	const topLevelSymbolsBySource = new Map<string, string[]>()
	for (const [sourcePath, source] of sources) {
		const spans = declarationSpans(sourcePath, source, nodesBySource.get(sourcePath) ?? [])
		spansBySource.set(sourcePath, spans)
		importsBySource.set(sourcePath, parseImports(sourcePath, source))
		const maskedSource = [...maskCommentsAndStrings(source)]
		for (const span of spans) {
			for (let index = span.start; index < span.end; index += 1) {
				if (maskedSource[index] !== '\n') maskedSource[index] = ' '
			}
		}
		const topLevelSymbols: string[] = []
		for (const match of maskedSource.join('').matchAll(/^(struct|enum)\s+([A-Za-z_]\w*)\b/gm)) {
			const symbol = match[2]
			if (symbol !== undefined) topLevelSymbols.push(symbol)
		}
		topLevelSymbolsBySource.set(sourcePath, topLevelSymbols)
	}

	function exportedNames(sourcePath: string, visited = new Set<string>()): ImportName[] {
		if (visited.has(sourcePath)) return []
		visited.add(sourcePath)
		const names = (nodesBySource.get(sourcePath) ?? []).flatMap(node => (node.declaration === undefined ? [] : [{ local: node.declaration, original: node.declaration }]))
		names.push(...(topLevelSymbolsBySource.get(sourcePath) ?? []).map(symbol => ({ local: symbol, original: symbol })))
		for (const imported of importsBySource.get(sourcePath) ?? []) {
			if (imported.names.length === 0) {
				names.push(...exportedNames(imported.target, visited))
			} else {
				names.push(...imported.names.map(name => ({ local: name.local, original: name.local })))
			}
		}
		return names
	}

	function tryResolveImportedNode(target: string, original: string, visited = new Set<string>()): ContractAtlasSourceNode | undefined {
		const visitKey = `${target}#${original}`
		if (visited.has(visitKey)) return undefined
		visited.add(visitKey)
		const targetNodes = nodesBySource.get(target) ?? []
		const directNode = targetNodes.find(node => node.declaration === original)
		if (directNode !== undefined) return directNode
		const moduleNode = targetNodes.find(node => node.kind === 'module')
		if (moduleNode !== undefined) return moduleNode
		for (const imported of importsBySource.get(target) ?? []) {
			const importedName = imported.names.find(name => name.local === original)
			if (importedName !== undefined) {
				const resolvedNode = tryResolveImportedNode(imported.target, importedName.original, new Set(visited))
				if (resolvedNode !== undefined) return resolvedNode
			}
			if (imported.names.length === 0) {
				const resolvedNode = tryResolveImportedNode(imported.target, original, new Set(visited))
				if (resolvedNode !== undefined) return resolvedNode
			}
		}
		if ((topLevelSymbolsBySource.get(target) ?? []).includes(original) && targetNodes.length === 1) {
			const onlyNode = targetNodes[0]
			if (onlyNode === undefined) return undefined
			return onlyNode
		}
		if ((topLevelSymbolsBySource.get(target) ?? []).includes(original)) {
			const ownerId = sourceOwnerOverrides[target]
			const ownerNode = ownerId === undefined ? undefined : targetNodes.find(node => node.id === ownerId)
			if (ownerNode !== undefined) return ownerNode
		}
		return undefined
	}

	function resolveImportedNode(target: string, original: string): ContractAtlasSourceNode {
		const resolvedNode = tryResolveImportedNode(target, original)
		if (resolvedNode !== undefined) return resolvedNode
		throw new Error(`Contract atlas could not resolve the source owner for ${target}#${original}`)
	}

	const symbolsByPair = new Map<string, { source: string; symbols: Set<string>; target: string }>()
	const explicitDeploymentsByPair = new Map<string, { source: string; symbols: Set<string>; target: string }>()
	const directBasesByKey = new Map<string, { relation: 'implements' | 'inherits'; source: string; symbols: Set<string>; target: string }>()
	const delegatecallsByPair = new Map<string, { relation: 'delegatecall'; source: string; symbols: Set<string>; target: string }>()
	const sourceUnitsByNodeId = new Map<string, string>()
	for (const [sourcePath, source] of sources) {
		const spans = spansBySource.get(sourcePath) ?? []
		const moduleUnits = spans.length === 0 ? (nodesBySource.get(sourcePath) ?? []).filter(node => node.kind === 'module').map(node => ({ end: source.length, node, start: 0, text: maskCommentsAndStrings(source) })) : []
		const sourceUnits = [...spans, ...moduleUnits]
		const candidates: { local: string; target: ContractAtlasSourceNode }[] = []
		for (const imported of importsBySource.get(sourcePath) ?? []) {
			const importedNames = imported.names.length === 0 ? exportedNames(imported.target) : imported.names
			for (const importedName of importedNames) {
				if (importedName.original === '*') {
					throw new Error(`Namespace imports need an explicit atlas mapping in ${sourcePath}`)
				}
				candidates.push({
					local: importedName.local,
					target: resolveImportedNode(imported.target, importedName.original),
				})
			}
		}
		for (const localNode of nodesBySource.get(sourcePath) ?? []) {
			if (localNode.declaration !== undefined) {
				candidates.push({ local: localNode.declaration, target: localNode })
			}
		}
		for (const sourceUnit of sourceUnits) {
			sourceUnitsByNodeId.set(sourceUnit.node.id, sourceUnit.text)
			const openingBraceIndex = sourceUnit.text.indexOf('{')
			const declarationHeader = openingBraceIndex < 0 ? '' : sourceUnit.text.slice(0, openingBraceIndex)
			const directBaseClause = declarationHeader.match(/\bis\b([\s\S]+)$/)?.[1] ?? ''
			for (const candidate of candidates) {
				if (candidate.target.id === sourceUnit.node.id) continue
				if (!new RegExp(`\\b${escapedIdentifier(candidate.local)}\\b`).test(sourceUnit.text)) continue
				const pairKey = `${sourceUnit.node.id}->${candidate.target.id}`
				const pair = symbolsByPair.get(pairKey) ?? {
					source: sourceUnit.node.id,
					symbols: new Set<string>(),
					target: candidate.target.id,
				}
				pair.symbols.add(candidate.local)
				symbolsByPair.set(pairKey, pair)
				const isNewDeployment = new RegExp(`\\bnew\\s+${escapedIdentifier(candidate.local)}\\s*(?:\\{|\\()`).test(sourceUnit.text)
				const isCreate2Deployment = /\bcreate2\s*\(/.test(sourceUnit.text) && new RegExp(`\\btype\\s*\\(\\s*${escapedIdentifier(candidate.local)}\\s*\\)\\s*\\.\\s*creationCode\\b`).test(sourceUnit.text)
				if (isNewDeployment || isCreate2Deployment) {
					const deployment = explicitDeploymentsByPair.get(pairKey) ?? {
						source: sourceUnit.node.id,
						symbols: new Set<string>(),
						target: candidate.target.id,
					}
					deployment.symbols.add(candidate.local)
					explicitDeploymentsByPair.set(pairKey, deployment)
				}
				if (new RegExp(`\\b${escapedIdentifier(candidate.local)}\\b`).test(directBaseClause)) {
					let relation: 'implements' | 'inherits' = 'inherits'
					if (sourceUnit.node.kind !== 'interface' && candidate.target.kind === 'interface') {
						relation = 'implements'
					}
					const directBaseKey = `${pairKey}:${relation}`
					const directBase = directBasesByKey.get(directBaseKey) ?? {
						relation,
						source: sourceUnit.node.id,
						symbols: new Set<string>(),
						target: candidate.target.id,
					}
					directBase.symbols.add(candidate.local)
					directBasesByKey.set(directBaseKey, directBase)
				}
				if (directlyDelegatesToType(sourceUnit.text, candidate.local)) {
					const delegatecall: { relation: 'delegatecall'; source: string; symbols: Set<string>; target: string } = delegatecallsByPair.get(pairKey) ?? {
						relation: 'delegatecall',
						source: sourceUnit.node.id,
						symbols: new Set<string>(),
						target: candidate.target.id,
					}
					delegatecall.symbols.add(candidate.local)
					delegatecallsByPair.set(pairKey, delegatecall)
				}
			}
		}
	}
	function sortedReferences(referencesByPair: ReadonlyMap<string, { source: string; symbols: Set<string>; target: string }>): ContractAtlasSourceReference[] {
		return [...referencesByPair.values()]
			.map(reference => ({
				source: reference.source,
				symbols: [...reference.symbols].sort(),
				target: reference.target,
			}))
			.sort((first, second) => `${first.source}->${first.target}`.localeCompare(`${second.source}->${second.target}`))
	}
	function sortedSemanticRelationships(relationshipsByKey: ReadonlyMap<string, { relation: 'delegatecall' | 'implements' | 'inherits'; source: string; symbols: Set<string>; target: string }>): ContractAtlasSourceSemanticRelationship[] {
		return [...relationshipsByKey.values()]
			.map(relationship => ({
				relation: relationship.relation,
				source: relationship.source,
				symbols: [...relationship.symbols].sort(),
				target: relationship.target,
			}))
			.sort((first, second) => `${first.source}->${first.target}:${first.relation}`.localeCompare(`${second.source}->${second.target}:${second.relation}`))
	}
	return {
		delegatecalls: sortedSemanticRelationships(delegatecallsByPair),
		directBases: sortedSemanticRelationships(directBasesByKey),
		explicitDeployments: sortedReferences(explicitDeploymentsByPair),
		references: sortedReferences(symbolsByPair),
		sourceUnits: [...sourceUnitsByNodeId].map(([nodeId, source]) => ({ nodeId, source })).sort((first, second) => first.nodeId.localeCompare(second.nodeId)),
	}
}

export function contractAtlasSourceReferenceIssue(expectedReferences: readonly ContractAtlasSourceReference[], registeredReferences: readonly ContractAtlasSourceReference[]): string | undefined {
	function referenceKeys(references: readonly ContractAtlasSourceReference[]): string[] {
		return references.map(reference => `${reference.source}->${reference.target}:${[...reference.symbols].sort().join(',')}`)
	}
	const expectedKeys = referenceKeys(expectedReferences)
	const registeredKeys = referenceKeys(registeredReferences)
	if (new Set(registeredKeys).size !== registeredKeys.length) {
		return 'Complete contract atlas source references contain duplicate ordered pairs'
	}
	const expectedKeySet = new Set(expectedKeys)
	const registeredKeySet = new Set(registeredKeys)
	const missing = expectedKeys.filter(key => !registeredKeySet.has(key))
	const extra = registeredKeys.filter(key => !expectedKeySet.has(key))
	if (missing.length === 0 && extra.length === 0) return undefined
	return `Complete contract atlas source-reference mismatch; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`
}
