import { advanceNextSimulationBlock, initializeSimulationClock } from './clock.js'
import { formatTevmErrors, requireSuccessfulLoadState, type DumpedTevmState } from './dumpedState.js'
import { serializeSavedSimulationStateEnvelope, type SavedSimulationStateEnvelopeV1 } from './savedStates.js'
import type { SimulationChain } from './simulationChain.js'

type SnapshotState = SavedSimulationStateEnvelopeV1['state']

export async function restoreSimulationSnapshot(restored: SimulationChain, state: SnapshotState, initializeAccounts: () => Promise<void>) {
	await requireSuccessfulLoadState(restored.memoryClient, state.snapshot as DumpedTevmState)
	await initializeAccounts()
	if (state.blocks !== undefined && state.blocks.length > 0) {
		// The saved blocks bring back logs, receipts and numbering; one fresh block ties the loaded state to the head.
		await restored.restoreHistory(state.blocks)
		await advanceNextSimulationBlock(restored.memoryClient)
	} else {
		// Loading state leaves the chain at genesis time; the saved contracts expect the clock they were saved under.
		await initializeSimulationClock(restored.memoryClient, state.currentTimestamp)
	}
}

export async function exportSimulationSnapshot(chain: SimulationChain, metadata: Pick<SavedSimulationStateEnvelopeV1, 'baseScenario' | 'genesisOutcome' | 'name'>, readState: () => Omit<SnapshotState, 'blocks' | 'snapshot'>) {
	// Export the chain history and VM state under the same lock.
	const { blocks, snapshot } = await chain.withLock(async () => ({ blocks: await chain.exportHistory(), snapshot: await chain.memoryClient.tevmDumpState() }))
	if (snapshot.errors !== undefined && snapshot.errors.length > 0) throw new Error(formatTevmErrors(snapshot.errors))
	const name = metadata.name.trim()
	if (name === '') throw new Error('Saved simulation state name is required')
	return serializeSavedSimulationStateEnvelope({
		...metadata,
		name,
		savedAt: new Date().toISOString(),
		state: { ...readState(), blocks, snapshot: snapshot.state },
		version: 1,
	})
}
