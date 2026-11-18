import { coreContractReferences } from './core-contract-references.mts'
import { forkEscalationContractReferences } from './fork-escalation-contract-references.mts'
import { oracleMarketContractReferences } from './oracle-market-contract-references.mts'
import { securityPoolContractReference } from './security-pool-contract-reference.mts'
import { securityPoolForkerContractReference } from './security-pool-forker-contract-reference.mts'

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
export const expectedProductionSoliditySourceFingerprint = 'eb539d1b0c4f59c65cba468b12d652795ec051a82b76a8152d5fc019482aa46b'

export const contractReferences: ContractReference[] = [...coreContractReferences, securityPoolContractReference, securityPoolForkerContractReference, ...forkEscalationContractReferences, ...oracleMarketContractReferences]
