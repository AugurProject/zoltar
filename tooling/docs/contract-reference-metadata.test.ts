import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { repositoryRoot } from '../repo/root.mts'
import { assertAccountingExampleOwnership } from './check-docs-example-ownership.mts'
import { entrypointSignaturesBySource, fallbackRoutedEntrypointSignatures, interfaceEntrypointExclusionsBySource, readDeclarationExclusionsBySource, stateChangingAbiFingerprintBySource } from './contract-reference-abi-surface.mts'
import { delegateEventDeclarationMirrors, documentedEventSchemas } from './contract-reference-event-schemas.mts'
import { renderAccountingExamples } from './contract-reference-examples.mts'
import { contractReferences } from './contract-reference-metadata.mts'
import { computeCompiledAbiFingerprint, countEntrypoints, getCompiledContractAbi, getFallbackSelectorReferences } from './contract-reference-abi-readers.mts'
import { assertCoordinatorDataEventAndEnumDeclarations } from './check-docs-catalog-declarations.mts'

const missingSources = (sourcePaths: Iterable<string>) => [...sourcePaths].filter(sourcePath => !existsSync(path.join(repositoryRoot, sourcePath)))

test('ABI fingerprints ignore declaration and property order but retain parameter order', () => {
	const first = { type: 'function', name: 'request', inputs: [{ type: 'address' }, { type: 'uint256' }] }
	const event = { type: 'event', name: 'Requested', inputs: [] }
	expect(computeCompiledAbiFingerprint([first, event])).toBe(computeCompiledAbiFingerprint([event, { inputs: first.inputs, name: first.name, type: first.type }]))
	expect(computeCompiledAbiFingerprint([first])).not.toBe(computeCompiledAbiFingerprint([{ ...first, inputs: first.inputs.toReversed() }]))
})

test('coordinator metadata retains ABI event indexing and source enum values', () => {
	const data = { events: ['CoordinatorStateCheckpoint'], eventDeclarations: { CoordinatorStateCheckpoint: 'CoordinatorStateCheckpoint(uint256 indexed reportId)' }, checkpoint: { fields: ['reportId'], indexed: ['reportId'] }, enumValues: { Operation: { '0': 'None', '1': 'Vault' } } }
	const artifacts = { contracts: { 'contracts/statoblast/OpenOraclePriceCoordinator.sol': { OpenOraclePriceCoordinator: { abi: [{ type: 'event', name: 'CoordinatorStateCheckpoint', inputs: [{ type: 'uint256', name: 'reportId', indexed: true }] }] } } } }
	const source = 'enum Operation { None, Vault }'
	expect(() => assertCoordinatorDataEventAndEnumDeclarations(JSON.stringify(data), artifacts, source)).not.toThrow()
	expect(() => assertCoordinatorDataEventAndEnumDeclarations(JSON.stringify({ ...data, checkpoint: { ...data.checkpoint, indexed: [] } }), artifacts, source)).toThrow('indexed checkpoint fields')
	expect(() => assertCoordinatorDataEventAndEnumDeclarations(JSON.stringify(data), artifacts, 'enum Operation { None, Withdraw }')).toThrow('enum values')
})

test('ABI readers reject incomplete artifacts and keep fallback selectors within their body', () => {
	const abi = [{ type: 'function', name: 'request', inputs: [] }]
	expect(getCompiledContractAbi({ contracts: { 'contracts/Oracle.sol': { Oracle: { abi } } } }, 'solidity/contracts/Oracle.sol', 'Oracle')).toEqual(abi)
	expect(() => getCompiledContractAbi({ contracts: {} }, 'solidity/contracts/Oracle.sol', 'Oracle')).toThrow('missing contracts/Oracle.sol')
	expect(
		countEntrypoints(
			new Map([
				['request()', 1],
				['settle(uint256)', 2],
			]),
		),
	).toBe(3)
	expect(() => countEntrypoints(undefined)).toThrow('at least one entrypoint')
	expect(getFallbackSelectorReferences('fallback() external { if (true) { A.request.selector; } A.request.selector; B.settle.selector; }\nfunction other() external { C.other.selector; }', 'Oracle')).toEqual(['A.request', 'B.settle'])
	expect(() => getFallbackSelectorReferences('fallback() external {', 'Oracle')).toThrow('balanced')
})

test('contract references document each contract once from an existing Solidity source', () => {
	expect(new Set(contractReferences.map(reference => reference.name)).size).toBe(contractReferences.length)
	const declarations = contractReferences.flatMap(reference => [...reference.readDeclarations, ...(reference.readStorageDeclarations ?? []), ...reference.interactions.flatMap(interaction => interaction.declarations)])
	expect(missingSources([...contractReferences.map(reference => reference.sourcePath), ...declarations.flatMap(declaration => (declaration.sourcePath === undefined ? [] : [declaration.sourcePath]))])).toEqual([])
})

test('ABI surface and event tables only name existing Solidity sources', () => {
	expect(missingSources([...Object.keys(entrypointSignaturesBySource), ...Object.keys(stateChangingAbiFingerprintBySource), ...Object.keys(readDeclarationExclusionsBySource)])).toEqual([])
	expect(missingSources([...documentedEventSchemas, ...delegateEventDeclarationMirrors].map(event => event.sourcePath))).toEqual([])
	expect(missingSources([...Object.keys(interfaceEntrypointExclusionsBySource), ...Object.keys(fallbackRoutedEntrypointSignatures), ...Object.values(fallbackRoutedEntrypointSignatures).flatMap(signaturesByDelegateSource => Object.keys(signaturesByDelegateSource))])).toEqual([])
})

test('every fallback-routed selector is documented by a row on the contract that routes it', () => {
	for (const [routerSourcePath, signaturesByDelegateSource] of Object.entries(fallbackRoutedEntrypointSignatures)) {
		const reference = contractReferences.find(candidate => candidate.sourcePath === routerSourcePath)
		expect(reference).toBeDefined()
		const documented = (reference?.interactions ?? []).flatMap(interaction => interaction.declarations.filter(declaration => declaration.kind === 'fallback-routed').map(declaration => `${declaration.sourcePath}#${declaration.name}`))
		const configured = Object.entries(signaturesByDelegateSource).flatMap(([delegateSourcePath, signaturesByName]) => Object.keys(signaturesByName).map(name => `${delegateSourcePath}#${name}`))
		expect(documented.toSorted()).toEqual(configured.toSorted())
	}
})

test('accounting examples render only for the contracts whose rules they explain', () => {
	for (const contractName of ['EscalationGame', 'SecurityPool', 'LiquidationApprovalRegistry', 'UniformPriceDualCapBatchAuction']) expect(renderAccountingExamples(contractName)).toContain('<h2 id="accounting-examples">Accounting examples</h2>')
	expect(renderAccountingExamples('Zoltar')).toBe('')
})

test('documented accounting rules match the contracts and the generated reference pages', async () => {
	const workingDirectory = process.cwd()
	process.chdir(repositoryRoot)
	try {
		await assertAccountingExampleOwnership()
	} finally {
		process.chdir(workingDirectory)
	}
})
