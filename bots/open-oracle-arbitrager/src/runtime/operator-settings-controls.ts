import { mutableStrategy, runnableOperatorSettings, type Configuration } from '#config/configuration'
import { configurationRevisionConflict, loadOperatorSettingsWithRevision, parseRuntimeLimitsRequest, parseStoredCentralizedMarkets, serializeRuntimeLimits, serializeStoredCentralizedMarkets, type PersistedOperatorSettings } from '#config/settings-store'
import { persistSignerSettingsWithProvisionalLock, type ExecutionLockManager } from '#execution/execution-locks'
import { recordOperation, strategySettings, updateStrategyFromRequest, type OperatorSnapshotFixedState, type OperatorState, type QueuedSettingsSection } from '#state/operator-state'
import { parseSettlementSettings, settlementSettings } from '#state/settlement-store'
import type { ExclusiveProcessLock } from '#state/position-store'
import { privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import type { SignerOperationGate } from '@zoltar/bot-shared/execution/signer-operation-gate'
import { operatorStatusAfterPause, type SyncCursor } from '@zoltar/bot-shared/monitoring/block-sync'
import type { PendingOperatorUpdates } from './operator-control-plane.ts'
import { acquireConfigurationSignerOperation } from './signer-operations.ts'

/** Which operator-file sections hold a saved change the scan boundary has not consumed yet. */
export function queuedSettingsSections(pending: PendingOperatorUpdates): QueuedSettingsSection[] {
	const sections: QueuedSettingsSection[] = []
	if (pending.connectivity !== undefined || pending.rpcQuorum !== undefined || pending.network !== undefined) sections.push('connectivity')
	if (pending.deployment !== undefined) sections.push('deployment')
	if (pending.execute !== undefined) sections.push('execution')
	if (pending.centralizedMarkets !== undefined) sections.push('markets')
	if (pending.riskLimits !== undefined || pending.lookbackBlocks !== undefined || pending.maxHedgeSlippageBps !== undefined) sections.push('risk')
	if (pending.settlement !== undefined) sections.push('settlement')
	if (pending.strategy !== undefined) sections.push('strategy')
	if (pending.submission !== undefined) sections.push('submission')
	if (pending.operatorSettings !== undefined) sections.push('universes')
	return sections
}

type OperatorSettingsContext = {
	config: Configuration
	fixedState: OperatorSnapshotFixedState
	getCursor: () => SyncCursor | undefined
	lockManager: ExecutionLockManager | undefined
	pending: PendingOperatorUpdates
	persistFocusedSettings: (update: (settings: PersistedOperatorSettings) => PersistedOperatorSettings) => Promise<PersistedOperatorSettings>
	persistSettings: (settings: PersistedOperatorSettings, expectedRevision?: string) => Promise<string>
	queueSettingsUpdate: <T>(update: () => Promise<T>) => Promise<T>
	signerOperationGate: SignerOperationGate
	state: OperatorState
}

/**
 * The focused Settings forms that edit one section of the operator file each: strategy, settlement, risk limits,
 * the REP market policy, and execution mode. Each validates its own section, persists it against the latest
 * revision, and queues the parsed value for the next scan boundary.
 */
export function createOperatorSettingsControls(context: OperatorSettingsContext) {
	const { config, fixedState, getCursor, lockManager, pending, persistFocusedSettings, persistSettings, queueSettingsUpdate, signerOperationGate, state } = context
	return {
		updateStrategy: async (value: unknown) => {
			const next = mutableStrategy(pending.strategy ?? config)
			updateStrategyFromRequest(next, value)
			return queueSettingsUpdate(async () => {
				await persistFocusedSettings(settings => ({
					...settings,
					strategy: next,
				}))
				pending.strategy = next
				recordOperation(state, {
					category: 'configuration',
					details: undefined,
					level: 'info',
					message: 'Strategy update saved and queued',
					reason: 'Applied at the next scan boundary',
					reportId: undefined,
				})
				return strategySettings(next)
			})
		},
		updateSettlement: (value: unknown) => {
			const next = parseSettlementSettings(value)
			return queueSettingsUpdate(async () => {
				await persistFocusedSettings(settings => ({ ...settings, settlement: next }))
				pending.settlement = { ...next }
				recordOperation(state, {
					category: 'configuration',
					details: undefined,
					level: 'info',
					message: `Third-party settlement ${next.enabled ? 'enabled' : 'disabled'} and saved`,
					reason: 'Applied at the next scan boundary',
					reportId: undefined,
				})
				return settlementSettings(next)
			})
		},
		updateRuntimeLimits: (value: unknown) => {
			const next = parseRuntimeLimitsRequest(value)
			return queueSettingsUpdate(async () => {
				await persistFocusedSettings(settings => ({ ...settings, runtime: { ...settings.runtime, ...next } }))
				pending.lookbackBlocks = next.lookbackBlocks
				pending.maxHedgeSlippageBps = next.maxHedgeSlippageBps
				pending.riskLimits = next.riskLimits
				recordOperation(state, {
					category: 'configuration',
					details: undefined,
					level: 'info',
					message: 'Risk limits saved and queued',
					reason: 'Applied at the next scan boundary',
					reportId: undefined,
				})
				return serializeRuntimeLimits(next)
			})
		},
		updateCentralizedMarkets: (value: unknown) =>
			queueSettingsUpdate(async () => {
				const latest = await loadOperatorSettingsWithRevision(config.settingsFile)
				if (latest === undefined) throw configurationRevisionConflict()
				const next = parseStoredCentralizedMarkets(value, latest.settings.deployment.rep, latest.settings.network)
				await persistSettings({ ...latest.settings, centralizedMarkets: next }, latest.revision)
				pending.centralizedMarkets = next
				recordOperation(state, {
					category: 'configuration',
					details: next.sources.map(source => source.exchangeId).join(', ') || undefined,
					level: 'info',
					message: 'REP market source policy saved and queued',
					reason: 'Applied at the next scan boundary',
					reportId: undefined,
				})
				return serializeStoredCentralizedMarkets(next)
			}),
		updateExecution: (value: unknown) =>
			queueSettingsUpdate(async () => {
				if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || !('execute' in value) || typeof value.execute !== 'boolean') throw new Error('Execution mode updates require execute')
				const execute = value.execute
				const latest = await loadOperatorSettingsWithRevision(config.settingsFile)
				if (latest === undefined) throw configurationRevisionConflict()
				if (!execute) {
					await persistSettings({ ...latest.settings, runtime: { ...latest.settings.runtime, execute } }, latest.revision)
					pending.execute = false
					recordOperation(state, {
						category: 'configuration',
						details: undefined,
						level: 'info',
						message: 'Dry-run mode saved and queued',
						reason: 'Applied at the next scan boundary; transactions already broadcast are not cancelled',
						reportId: undefined,
					})
					return { execute }
				}
				// Re-applying an already saved and effective live mode changes nothing, so it must not pause a running operator.
				if (latest.settings.runtime.execute && (pending.execute ?? config.execute)) return { execute }
				// Live execution activates at the next boundary, so the saved file must already be startable in live mode
				// (quorum RPCs and an enabled venue); the bot is paused with it so arming never starts signing
				// until the operator resumes through the readiness check.
				const next = { ...latest.settings, paused: true, runtime: { ...latest.settings.runtime, execute } }
				runnableOperatorSettings(config.settingsFile, next)
				const persist = async () => {
					await persistSettings(next, latest.revision)
				}
				// Live execution needs the signer that will be active at the boundary, which is the queued one when a signer
				// change is pending and otherwise the running one; the complete editor instead binds to the persisted key.
				const privateKey = pending.signerUpdate ? pending.privateKey : config.privateKey
				if (privateKey === undefined) throw new Error('Execution requires an active signer')
				const signerAddress = privateKeyToAccount(privateKey).address
				// The running signer's lock is held for as long as the operator executes with it, whether or not the same key is
				// queued again; a queued signer's lock lives on the pending update.
				const holdsActiveSignerLock = fixedState.execute && fixedState.wallet !== undefined && fixedState.wallet.toLowerCase() === signerAddress.toLowerCase()
				const holdsPendingSignerLock = pending.signerUpdate && pending.signerLock !== undefined
				await acquireConfigurationSignerOperation(signerOperationGate)
				try {
					let acquiredSignerLock: ExclusiveProcessLock | undefined
					if (!holdsActiveSignerLock && !holdsPendingSignerLock) {
						if (lockManager === undefined) throw new Error('Execution signer lock management is unavailable')
						acquiredSignerLock = await lockManager.acquireSigner(signerAddress)
					}
					await persistSignerSettingsWithProvisionalLock(persist, acquiredSignerLock, lockManager)
					if (acquiredSignerLock !== undefined) {
						pending.persistedPrivateKey = pending.signerUpdate ? pending.persistedPrivateKey : config.persistedPrivateKey
						pending.privateKey = privateKey
						pending.signerLock = acquiredSignerLock
						pending.signerUpdate = true
						fixedState.queuedWallet = signerAddress
					}
					pending.execute = true
					pending.paused = true
					state.paused = true
					state.status = operatorStatusAfterPause(true, getCursor()?.initial === false, state.lastError !== undefined)
				} finally {
					signerOperationGate.release('configuration')
				}
				recordOperation(state, {
					category: 'configuration',
					details: undefined,
					level: 'info',
					message: `Live execution with signer ${signerAddress} saved and queued; operator paused`,
					reason: 'Activates at the next scan boundary after startup validation; resume to start signing',
					reportId: undefined,
				})
				return { execute }
			}),
	}
}
