import { coreContractReferences } from './core-contract-references.mts'
import { forkEscalationContractReferences } from './fork-escalation-contract-references.mts'
import { oracleMarketContractReferences } from './oracle-market-contract-references.mts'
import { securityPoolContractReference } from './security-pool-contract-reference.mts'

type Interaction = {
	call: string
	caller: string
	declarations: ContractDeclaration[]
	effect: string
	preconditions: string
	signals: string
}

// A `fallback-routed` declaration names a selector the documented contract reaches only through its fallback; `sourcePath` is the delegate source that implements it.
export type ContractDeclaration = {
	kind?: 'receive' | 'fallback-routed'
	name: string
	sourcePath?: string
}

export type ContractReference = {
	compiledAbiFingerprint: string
	interactionNotes?: string
	interactions: Interaction[]
	name: string
	purpose: string
	readAbiFingerprint: string
	readDeclarations: ContractDeclaration[]
	readStorageDeclarations?: ContractDeclaration[]
	readSurface: string
	// Rendered under `securityBoundaryHeading`, or under the shared "Security assumptions" heading when no page-specific heading is set.
	securityBoundary?: string
	securityBoundaryHeading?: string
	sourcePath: string
}

export const outputPath = 'docs/reference/contracts.html'
export const contractPagesDirectory = 'docs/reference/contracts'

export function contractPageOutputPath(contractName: string): string {
	return `${contractPagesDirectory}/${contractName.toLowerCase()}.html`
}
export const expectedProductionSoliditySourceFingerprint = '5c9277cbe5f8c0a0e9432a4dcb29844400c86e2956058a7b472c04e93b628d16'

export const contractReferences: ContractReference[] = [...coreContractReferences, securityPoolContractReference, ...forkEscalationContractReferences, ...oracleMarketContractReferences]
