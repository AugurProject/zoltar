import { createSignerOperationGate } from '@zoltar/bot-shared/execution/signer-operation-gate'
import { parseSettings } from '../../src/config/settings.ts'
import example from '../../config/operator.example.json'
import { initialDurableState, initialRuntimeState } from '../../src/state/operator-state.ts'
import { createManualOperationController, type ManualScan } from '../../src/runtime/manual-operations.ts'
import type { ConfigurationState } from '../../src/runtime/dashboard-controller.ts'
import { snapshotFixture } from '../operations/fixture.ts'
import type { OperationPlan } from '../../src/operations/types.ts'

export function manualOperationFixture() {
	const snapshot = snapshotFixture()
	const settings = parseSettings({ ...example, privateKey: `0x${'11'.repeat(32)}`, runtime: { ...example.runtime, execute: false }, strategy: { ...example.strategy, selectableOperationAllowlist: ['open-oracle.weth.wrap'] } })
	const configuration: ConfigurationState = { path: '/unused', rememberSigner: false, revision: 'revision-1', settings }
	const state = initialRuntimeState(true, snapshot.wallet.address, settings.network.chainId, initialDurableState(settings.network.chainId, true))
	const scan: ManualScan = {
		anchor: { baseFeePerGas: 1n, blockHash: snapshot.anchor.blockHash, blockNumber: 100n, timestamp: 2_000_000_000n },
		canonicalLifecyclePresenceComplete: true,
		carryProofsComplete: true,
		indexComplete: true,
		executionReady: true,
		inventory: { eth: snapshot.wallet.ethBalanceAttoEth, rep: [], weth: '0' },
		snapshot,
	}
	const executed: OperationPlan[] = []
	const gate = createSignerOperationGate()
	const controller = createManualOperationController({
		configuration,
		execute: async plan => {
			executed.push(plan)
		},
		gate,
		scan: async () => scan,
		state,
	})
	return { configuration, controller, executed, gate, scan, state }
}
