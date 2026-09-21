import type { OperatorSettings } from '#config/settings'
import { privateKeyToAccount, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import type { BotProcessLocks } from '@zoltar/bot-shared/execution/bot-process-locks'
import { configuredQuorumRpcUrlMinimum } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'

export function parseExecutionRequest(value: unknown) {
	if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || !('execute' in value) || typeof value.execute !== 'boolean') throw new Error('Execution mode updates require execute')
	return value.execute
}

/** Everything the operator file rejects for live mode at startup, checked before the signer is reserved. */
function assertLiveExecutionReadiness(settings: OperatorSettings, activePrivateKey: Hex | undefined): Address {
	if (!settings.networkConfigured) throw new Error('Configure the chain and RPC endpoints before enabling live execution')
	if (activePrivateKey === undefined) throw new Error('Live execution requires an active signer')
	// The file keeps the saved key; arming with a different memory-only signer would let a restart go live with the saved one.
	if (settings.privateKey !== undefined && settings.privateKey.toLowerCase() !== activePrivateKey.toLowerCase()) throw new Error('The saved key differs from the active signer; save or remove it before enabling live execution')
	if (settings.connectivity.quorumRpcUrls.length < configuredQuorumRpcUrlMinimum(settings.connectivity.rpcQuorum)) throw new Error('Live execution with RPC quorum 2 requires at least two independent quorum RPCs (three read endpoints total)')
	return privateKeyToAccount(activePrivateKey).address
}

type ExecutionModeContext = {
	activePrivateKey: Hex | undefined
	locks: Pick<BotProcessLocks, 'disableExecution' | 'enableExecution'>
	/** Pauses the running operator so arming never starts signing before the operator resumes through the readiness check. */
	pause: () => void
	persist: (update: (current: OperatorSettings) => OperatorSettings) => Promise<OperatorSettings>
	settings: OperatorSettings
}

/**
 * Switches the running liquidator between dry run and live execution. Arming reserves the signer for this process
 * first, then persists live mode together with a pause; the reservation is released again if the file cannot be
 * saved. Returning to dry run persists first and releases the signer afterwards, so a failed save leaves the process
 * live and still holding its reservation.
 */
export async function applyExecutionMode(execute: boolean, { activePrivateKey, locks, pause, persist, settings }: ExecutionModeContext) {
	if (!execute) {
		if (!settings.runtime.execute) return { address: undefined, changed: false }
		await persist(current => ({ ...current, runtime: { ...current.runtime, execute: false } }))
		await locks.disableExecution()
		return { address: undefined, changed: true }
	}
	if (settings.runtime.execute) return { address: undefined, changed: false }
	const address = assertLiveExecutionReadiness(settings, activePrivateKey)
	await locks.enableExecution(address)
	try {
		await persist(current => ({ ...current, paused: true, runtime: { ...current.runtime, execute: true } }))
	} catch (error) {
		await locks.disableExecution()
		throw error
	}
	pause()
	return { address, changed: true }
}
