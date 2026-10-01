import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { repositoryRoot } from '../repo/root.mts'
import { assertAccountingExampleOwnership } from './check-docs-example-ownership.mts'
import { entrypointSignaturesBySource, readDeclarationExclusionsBySource, stateChangingAbiFingerprintBySource } from './contract-reference-abi-surface.mts'
import { delegateEventDeclarationMirrors, documentedEventSchemas } from './contract-reference-event-schemas.mts'
import { renderAccountingExamples } from './contract-reference-examples.mts'
import { contractReferences } from './contract-reference-metadata.mts'

const missingSources = (sourcePaths: Iterable<string>) => [...sourcePaths].filter(sourcePath => !existsSync(path.join(repositoryRoot, sourcePath)))

test('contract references document each contract once from an existing Solidity source', () => {
	expect(new Set(contractReferences.map(reference => reference.name)).size).toBe(contractReferences.length)
	const declarations = contractReferences.flatMap(reference => [...reference.readDeclarations, ...(reference.readStorageDeclarations ?? []), ...reference.interactions.flatMap(interaction => interaction.declarations)])
	expect(missingSources([...contractReferences.map(reference => reference.sourcePath), ...declarations.flatMap(declaration => (declaration.sourcePath === undefined ? [] : [declaration.sourcePath]))])).toEqual([])
})

test('ABI surface and event tables only name existing Solidity sources', () => {
	expect(missingSources([...Object.keys(entrypointSignaturesBySource), ...Object.keys(stateChangingAbiFingerprintBySource), ...Object.keys(readDeclarationExclusionsBySource)])).toEqual([])
	expect(missingSources([...documentedEventSchemas, ...delegateEventDeclarationMirrors].map(event => event.sourcePath))).toEqual([])
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
