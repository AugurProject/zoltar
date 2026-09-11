import { MUTATING_CONTRACT_SURFACE } from '../contracts/surface.ts'
import { CHAOS_OPERATION_CATALOG } from '../operations/catalog.ts'
import type { EvaluatedOperation } from '../operations/types.ts'

function surfaceEcosystem(contract: string): EvaluatedOperation['definition']['ecosystem'] {
	if (contract === 'Zoltar' || contract === 'ZoltarQuestionData' || contract === 'GenesisReputationToken' || contract === 'ReputationToken') {
		return 'zoltar'
	}
	if (contract === 'OpenOracle' || contract === 'WETH9') return 'open-oracle'
	if (contract === 'ShareToken' || contract === 'TwoWayConstantProductFactory' || contract === 'TwoWayConstantProductPair' || contract === 'TwoWayConstantProductRouter') {
		return 'trading'
	}
	return 'statoblast'
}

function surfaceBlocker(entry: (typeof MUTATING_CONTRACT_SURFACE)[number]) {
	if (entry.reason !== undefined) return entry.reason
	if (entry.classification === 'prerequisite') {
		return 'This method is submitted only as a prerequisite inside an eligible durable workflow'
	}
	return 'This classified protocol method has no independently executable chaos plan'
}

function surfaceCoverageId(entry: (typeof MUTATING_CONTRACT_SURFACE)[number]) {
	return `surface.${entry.contract.replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}.${entry.method.replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`
}

export function completeOperationCoverage(evaluations: readonly EvaluatedOperation[]): EvaluatedOperation[] {
	const completed = [...evaluations]
	for (const entry of MUTATING_CONTRACT_SURFACE) {
		const coverageId = surfaceCoverageId(entry)
		const represented = completed.some(evaluation => evaluation.definition.contract === entry.contract && evaluation.definition.method === entry.method && (evaluation.definition.abiEntryKind ?? 'function') === entry.abiEntryKind)
		if (represented) continue
		const operationTarget = entry.operationId === undefined ? undefined : CHAOS_OPERATION_CATALOG.find(definition => definition.id === entry.operationId)
		const coverageExplanation = surfaceBlocker(entry)
		completed.push({
			definition: {
				abiEntryKind: entry.abiEntryKind,
				classification: entry.classification,
				contract: entry.contract,
				description: coverageExplanation,
				discoveryInputs: [],
				ecosystem: surfaceEcosystem(entry.contract),
				id: coverageId,
				independentlyExecutable: false,
				label: `${entry.contract}.${entry.method}`,
				method: entry.method,
				risk: operationTarget?.risk ?? (entry.classification === 'prerequisite' ? 'medium' : 'high'),
			},
			eligibility: {
				blockers: [coverageExplanation],
				eligible: false,
			},
		})
	}
	return completed
}
