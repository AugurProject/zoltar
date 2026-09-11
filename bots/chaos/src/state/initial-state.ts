import type { Address } from '@zoltar/bot-shared/ethereum'
import type { DurableState, SchedulerState } from './operator-state.ts'
import { assertSafeRetirementRecipient, initialRetirementState } from './retirement.ts'
import type { RuntimeState } from './runtime-state.ts'
import { identifier } from './validators.ts'

export const DURABLE_STATE_VERSION = 4

function emptySchedulerState(paused = true): SchedulerState {
	return {
		lastDelaySeconds: undefined,
		lastRunAt: undefined,
		nextRunAt: undefined,
		selectedOperationId: undefined,
		status: paused ? 'paused' : 'idle',
	}
}

export function initialDurableState(chainId: number, paused = true, profileId = 'profile:unconfigured', signerAddress?: Address | undefined): DurableState {
	if (!Number.isSafeInteger(chainId) || chainId < 1) throw new Error('State chain ID must be a positive integer')
	return {
		activities: [],
		chainId,
		lifecyclePresenceBlocker: undefined,
		obligationTombstones: [],
		obligations: [],
		pendingTransactions: [],
		profileId: identifier(profileId, 'profileId'),
		protocolIndex: undefined,
		retirement: initialRetirementState(),
		safetyPaused: false,
		scheduler: emptySchedulerState(paused),
		signerAddress,
		version: DURABLE_STATE_VERSION,
		workflows: [],
	}
}

export function initialRuntimeState(paused: boolean, wallet: Address | undefined, chainId: number, durableState: DurableState = initialDurableState(chainId, paused)): RuntimeState {
	if (durableState.chainId !== chainId) throw new Error(`Durable state belongs to chain ${durableState.chainId.toString()}, expected chain ${chainId.toString()}`)
	if (durableState.retirement.recipient !== undefined) assertSafeRetirementRecipient(durableState.retirement.recipient, wallet ?? durableState.signerAddress)
	const restoredSchedulerStatus = durableState.scheduler.status
	const effectivePaused = paused || durableState.safetyPaused
	let activeSchedulerStatus = restoredSchedulerStatus
	if (restoredSchedulerStatus === 'running') activeSchedulerStatus = 'running'
	else if (effectivePaused) activeSchedulerStatus = 'paused'
	else if (restoredSchedulerStatus === 'paused') activeSchedulerStatus = 'idle'
	const durableSafetyError = durableState.safetyPaused ? durableState.activities.find(activity => activity.type === 'error' && activity.status === 'failed')?.message : undefined
	return {
		...durableState,
		activities: [...durableState.activities],
		error: durableSafetyError,
		evaluations: [],
		inventory: { eth: '0', rep: [], weth: '0' },
		inventoryAddress: undefined,
		deploymentNotice: undefined,
		lastDeploymentCheckedBlock: undefined,
		lastDeploymentCheckAt: undefined,
		lastScanAt: undefined,
		lastScannedBlock: undefined,
		lifecyclePresenceBlocker: durableState.lifecyclePresenceBlocker === undefined ? undefined : { ...durableState.lifecyclePresenceBlocker },
		obligationTombstones: [...durableState.obligationTombstones],
		obligations: [...durableState.obligations],
		paused: effectivePaused,
		pendingTransactions: [...durableState.pendingTransactions],
		rpcEndpointHealth: [],
		scanning: false,
		scheduler: { ...durableState.scheduler, status: activeSchedulerStatus },
		startedAt: new Date().toISOString(),
		status: effectivePaused ? 'paused' : 'starting',
		topology: undefined,
		wallet: wallet ?? durableState.signerAddress,
		warnings: [],
		workflows: [...durableState.workflows],
	}
}
