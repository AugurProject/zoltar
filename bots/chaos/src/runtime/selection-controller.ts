import { CHAOS_OPERATION_CATALOG } from '../operations/catalog.ts'
import { parseSettings, serializedSettings, type OperatorSettings } from '../config/settings.ts'
import type { RuntimeState } from '../state/operator-state.ts'
import type { ConfigurationState } from './dashboard-controller.ts'
import { dashboardRecord as record, exactDashboardKeys as exactKeys } from './dashboard-input.ts'

type SelectionControllerOptions = {
	configuration: ConfigurationState
	state: RuntimeState
	update: (operation: () => Promise<void>) => Promise<void>
	persist: (path: string, state: RuntimeState) => Promise<void>
	expectedRevision: (value: unknown, current: string) => string
	assertPaused: (settings: OperatorSettings, paused: boolean) => void
	onScheduleRequested: (() => void) | undefined
	applySelection: (settings: OperatorSettings, revision: string, message: string) => Promise<void>
}

export function createSelectionController(options: SelectionControllerOptions) {
	return {
		async setSchedule(value: unknown) {
			await options.update(async () => {
				const body = record(value, 'Schedule update')
				exactKeys(body, ['revision', 'nextRunAt'], 'Schedule update')
				options.expectedRevision(body['revision'], options.configuration.revision)
				if (options.state.paused || options.configuration.settings.paused || options.state.safetyPaused) throw new Error('Resume the bot before running the next choice')
				const scheduler = options.state.scheduler
				if (scheduler.status !== 'scheduled' || scheduler.nextRunAt === undefined || scheduler.nextRunAt !== body['nextRunAt']) throw new Error('The schedule changed; refresh and review it again')
				if (options.state.retirement.status !== 'inactive') throw new Error('Random choices are unavailable during retirement')
				const candidate = { ...options.state, scheduler: { ...scheduler, nextRunAt: new Date().toISOString(), status: 'due' as const } }
				await options.persist(options.configuration.settings.runtime.stateFile, candidate)
				Object.assign(scheduler, candidate.scheduler)
				options.onScheduleRequested?.()
			})
		},
		async setSelection(value: unknown) {
			await options.update(async () => {
				const body = record(value, 'Operation selection')
				exactKeys(body, ['revision', 'operationId', 'enabled'], 'Operation selection')
				options.assertPaused(options.configuration.settings, options.state.paused)
				const revision = options.expectedRevision(body['revision'], options.configuration.revision)
				const selectable = CHAOS_OPERATION_CATALOG.filter(definition => definition.classification === 'selectable').map(definition => definition.id)
				const operationId = body['operationId']
				if (typeof operationId !== 'string' || !selectable.includes(operationId) || typeof body['enabled'] !== 'boolean') throw new Error('Choose a selectable operation and whether to enable it')
				const current = options.configuration.settings
				const allowed = new Set(current.strategy.selectableOperationAllowlist ?? selectable)
				if (body['enabled']) allowed.add(operationId)
				else allowed.delete(operationId)
				const serialized = serializedSettings(current)
				const candidate = parseSettings({ ...serialized, strategy: { ...serialized.strategy, selectableOperationAllowlist: [...allowed] } }, current.privateKey)
				await options.applySelection(candidate, revision, `${operationId} ${body['enabled'] ? 'enabled' : 'disabled'} for random selection`)
			})
		},
	}
}

export function settingsPatchCandidate(current: OperatorSettings, value: unknown) {
	const body = record(value, 'Settings update')
	exactKeys(body, ['patch', 'revision'], 'Settings update')
	const patch = record(body['patch'], 'Settings patch')
	exactKeys(patch, ['runtime', 'scheduler', 'strategy'], 'Settings patch')
	const runtime = record(patch['runtime'], 'Runtime patch')
	exactKeys(runtime, ['execute'], 'Runtime patch')
	const scheduler = record(patch['scheduler'], 'Scheduler patch')
	exactKeys(scheduler, ['maximumDelaySeconds', 'minimumDelaySeconds'], 'Scheduler patch')
	const strategy = record(patch['strategy'], 'Strategy patch')
	exactKeys(
		strategy,
		['allowHighRiskOperations', 'allowIrreversibleOperations', 'enabledEcosystems', 'initializeGenesisUniverse', 'maximumEthPerOperation', 'maximumGasCostEth', 'maximumRepPerOperation', 'minimumEthReserve', 'minimumRepReserve', 'selectableOperationAllowlist', 'workflowValidForBlocks'],
		'Strategy patch',
	)
	const serialized = serializedSettings(current)
	return {
		revision: body['revision'],
		settings: parseSettings(
			{
				...serialized,
				runtime: { ...serialized.runtime, execute: runtime['execute'] },
				scheduler: {
					...serialized.scheduler,
					maximumDelaySeconds: scheduler['maximumDelaySeconds'],
					minimumDelaySeconds: scheduler['minimumDelaySeconds'],
				},
				strategy: {
					...serialized.strategy,
					allowHighRiskOperations: strategy['allowHighRiskOperations'],
					allowIrreversibleOperations: strategy['allowIrreversibleOperations'],
					initializeGenesisUniverse: strategy['initializeGenesisUniverse'],
					enabledEcosystems: strategy['enabledEcosystems'],
					maximumEthPerOperation: strategy['maximumEthPerOperation'],
					maximumGasCostEth: strategy['maximumGasCostEth'],
					maximumRepPerOperation: strategy['maximumRepPerOperation'],
					minimumEthReserve: strategy['minimumEthReserve'],
					minimumRepReserve: strategy['minimumRepReserve'],
					selectableOperationAllowlist: strategy['selectableOperationAllowlist'],
					workflowValidForBlocks: strategy['workflowValidForBlocks'],
				},
			},
			current.privateKey,
		),
	}
}
