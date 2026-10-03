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

export type ContractDeclaration = {
	kind?: 'receive'
	name: string
	sourcePath?: string
}

export type ContractReference = {
	compiledAbiFingerprint: string
	delegatedInteractions?: string
	interactions: Interaction[]
	name: string
	purpose: string
	readAbiFingerprint: string
	readDeclarations: ContractDeclaration[]
	readStorageDeclarations?: ContractDeclaration[]
	readSurface: string
	securityBoundary?: string
	securityBoundaryHeading?: string
	sourcePath: string
}

export const outputPath = 'docs/reference/contracts.html'
export const contractPagesDirectory = 'docs/reference/contracts'

export function contractPageOutputPath(contractName: string): string {
	return `${contractPagesDirectory}/${contractName.toLowerCase()}.html`
}
export const expectedProductionSoliditySourceFingerprint = 'bcf3a9946730b602a3b059ec9cdd08b3dda81a4d250268b8db17f01be11dde7e'

export const contractReferences: ContractReference[] = [...coreContractReferences, securityPoolContractReference, ...forkEscalationContractReferences, ...oracleMarketContractReferences]
