import type { GenesisOutcome } from '@zoltar/zoltar-shared/deployment/genesisUniverses'
import type { SimulationScenario } from './scenarios.js'
import type { SimulationBootstrapParameters } from './tevmWorkerProtocol.js'
import { parseSavedSimulationStateEnvelope } from './savedStates.js'

/** Returns the prepared envelope when it was made for this scenario, universe and these sources; anything else seeds live instead. */
export const parseScenarioSnapshot = (scenario: SimulationScenario, genesisOutcome: GenesisOutcome, getBundledSnapshotKey: () => string | undefined, { scenarioSnapshot: serialized, scenarioSnapshotKey }: SimulationBootstrapParameters) => {
	if (serialized === undefined) return undefined
	try {
		const bundledKey = getBundledSnapshotKey()
		if (bundledKey !== undefined && scenarioSnapshotKey !== undefined && bundledKey !== scenarioSnapshotKey) throw new Error('The prepared state was generated for other sources')
		const envelope = parseSavedSimulationStateEnvelope(serialized)
		if (envelope.baseScenario !== scenario) throw new Error(`The prepared state belongs to the ${envelope.baseScenario} scenario`)
		if ((envelope.genesisOutcome ?? 'yes') !== genesisOutcome) throw new Error('The prepared state belongs to another genesis universe')
		return envelope
	} catch (error) {
		console.warn(`[simulation] Ignoring the prepared ${scenario} state: ${error instanceof Error ? error.message : String(error)}`)
		return undefined
	}
}
