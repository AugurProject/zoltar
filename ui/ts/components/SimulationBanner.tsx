import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { getErrorMessage } from '../lib/errors.js'
import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch } from '../lib/routing.js'
import type { SimulationController } from '../simulation/controller.js'
import { tryParseDecimalInput } from '../lib/decimal.js'
import { formatCurrencyInputBalance } from '../lib/formatters.js'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { getSimulationScenarioDescription, getSimulationScenarioLabel, SIMULATION_SCENARIOS } from '../simulation/scenarios.js'
import { deleteSavedSimulationState, getSavedSimulationStateStorageSummary, persistSavedSimulationState, removeCorruptedSavedSimulationStates, type SavedSimulationStateRecord, type SavedSimulationStateStorageSummary } from '../simulation/savedStates.js'
import { OperationModal } from './OperationModal.js'
import { TimestampValue } from './TimestampValue.js'
import { Badge } from './Badge.js'
import type { BadgeTone } from '../types/components.js'
import {
	UI_STRING_1_DAY,
	UI_STRING_1_HOUR,
	UI_STRING_1_MONTH,
	UI_STRING_1_WEEK,
	UI_STRING_1_YEAR,
	UI_STRING_ACTIONS,
	UI_STRING_ACTIVE,
	UI_STRING_BLOCKCHAIN_TIME,
	UI_STRING_BLOCKS,
	UI_STRING_BOOTSTRAPPING,
	UI_STRING_BROWSER_SIMULATION,
	UI_STRING_BUILT_IN_SCENARIOS,
	UI_STRING_BUILT_IN_SCENARIOS_CANNOT_BE_DELETED,
	UI_STRING_CONTROLS,
	UI_STRING_COPIED,
	UI_STRING_COPY_JSON,
	UI_STRING_DELETE_SAVE,
	UI_STRING_DELETE_SAVED_SIMULATION_STATE,
	UI_STRING_ERROR,
	UI_STRING_EXPORT_NAME,
	UI_STRING_EXPORT_SIMULATION_STATE,
	UI_STRING_EXPORT_STATE,
	UI_STRING_FAILED_TO_EXPORT_THE_CURRENT_SIMULATION_STATE,
	UI_STRING_FAILED_TO_UPDATE_THE_SAVED_SIMULATION_STATE,
	UI_STRING_IMPORT_AND_LOAD,
	UI_STRING_IMPORT_SIMULATION_STATE,
	UI_STRING_IMPORT_STATE,
	UI_STRING_JSON_STATE,
	UI_STRING_MINE_BLOCK,
	UI_STRING_MINT_1_MILLION_REP,
	UI_STRING_NO_CORRUPTED_SAVED_SIMULATION_STATES_WERE_FOUND,
	UI_STRING_PREPARING_THE_SELECTED_SIMULATION_SCENARIO_IN_THE_BACKGROUND,
	UI_STRING_QA_ACCOUNT,
	UI_STRING_QA_CONTROLS_PRICES_AND_TIME_TRAVEL,
	UI_STRING_QUERY_DELAY_MS,
	UI_STRING_SIMULATION_CONTROL_HELP_TEXT,
	UI_STRING_READY,
	UI_STRING_REFRESH_EXPORT,
	UI_STRING_REMOVE_CORRUPTED_SAVED_STATES,
	UI_STRING_REMOVE_CORRUPTED_SAVES,
	UI_STRING_REMOVE_SAVED_SIMULATION_STATE_ENTRIES_THAT_ARE_NO_LONGER_READABLE_FROM_BROWSER,
	UI_STRING_REP_ETH_MOCK_PRICE,
	UI_STRING_REP_USDC_MOCK_PRICE,
	UI_STRING_RESET_SCENARIO,
	UI_STRING_SAVE,
	UI_STRING_SAVED_STATES,
	UI_STRING_SAVE_SIMULATION_STATE,
	UI_STRING_SAVE_STATE,
	UI_STRING_SCENARIO,
	UI_STRING_SIMULATION_MODE,
	UI_STRING_SIMULATION_QA_ACCOUNT,
	UI_STRING_SIMULATION_SCENARIO,
	UI_STRING_STATE_NAME,
	UI_STRING_TIME_TRAVEL,
	UI_STRING_TRANSACTIONS,
	UI_STRING_TRANSACTION_RECEIPT_DELAY_MS,
	UI_STRING_USE_THESE_CONTROLS_FOR_REPEATABLE_MANUAL_UI_QA_WITHOUT_A_WALLET_EXTENSION,
	UI_TEMPLATE_CUSTOM_STATE_VALUE_BASED_ON_VALUE_SAVED_VALUE,
	UI_TEMPLATE_DELETE_SAVED_SIMULATION_STATE_DETAIL,
	UI_TEMPLATE_QA_VALUE,
	UI_TEMPLATE_SAVED_SIMULATION_STATE_VALUE_NO_LONGER_EXISTS,
} from '../lib/uiStrings.js'

const SIMULATION_TIME_PRESETS = [
	{ label: UI_STRING_1_HOUR, seconds: 60n * 60n },
	{ label: UI_STRING_1_DAY, seconds: 24n * 60n * 60n },
	{ label: UI_STRING_1_WEEK, seconds: 7n * 24n * 60n * 60n },
	{ label: UI_STRING_1_MONTH, seconds: 30n * 24n * 60n * 60n },
	{ label: UI_STRING_1_YEAR, seconds: 365n * 24n * 60n * 60n },
] as const
const SIMULATION_REP_MINT_AMOUNT = 1_000_000n * 10n ** 18n
type SimulationBannerProps = {
	controller: SimulationController
	onEnvironmentChanged?: () => Promise<void>
	onRefresh: () => Promise<void>
}

type SimulationModal = 'cleanup' | 'delete' | 'export' | 'import' | 'save' | undefined

function buildSimulationSearch(update: (params: URLSearchParams) => void) {
	const params = new URLSearchParams(getRouteHashSearch())
	params.set('simulate', '1')
	update(params)
	const nextSearch = params.toString()
	return nextSearch === '' ? '' : `?${nextSearch}`
}

function navigateToSimulationSearch(nextSearch: string) {
	window.history.pushState({}, '', buildRouteHref(getCurrentRouteHash(), nextSearch))
	window.dispatchEvent(new window.PopStateEvent('popstate'))
}

function navigateToBuiltInScenario(scenario: string) {
	const nextSearch = buildSimulationSearch(params => {
		params.set('simScenario', scenario)
		params.delete('simState')
	})
	navigateToSimulationSearch(nextSearch)
}

function navigateToSavedSimulationState(stateId: string) {
	const nextSearch = buildSimulationSearch(params => {
		params.delete('simScenario')
		params.set('simState', stateId)
	})
	navigateToSimulationSearch(nextSearch)
}

function hasSavedSimulationStateRoute() {
	const params = new URLSearchParams(getRouteHashSearch())
	const stateId = params.get('simState')
	return stateId !== null && stateId.trim() !== ''
}

function getSimulationAccountOptionLabel(account: string) {
	return UI_TEMPLATE_QA_VALUE(account)
}

function getScenarioStatus(parameters: { bootstrapError: string | undefined; isBootstrapped: boolean }): { badgeTone: BadgeTone; label: string } {
	if (parameters.bootstrapError !== undefined) {
		return {
			badgeTone: 'blocked',
			label: UI_STRING_ERROR,
		}
	}
	if (parameters.isBootstrapped) {
		return {
			badgeTone: 'ok',
			label: UI_STRING_READY,
		}
	}
	return {
		badgeTone: 'pending',
		label: UI_STRING_BOOTSTRAPPING,
	}
}

export function SimulationBanner({ controller, onEnvironmentChanged = async () => undefined, onRefresh }: SimulationBannerProps) {
	const { copied, copyText } = useCopyToClipboard()
	const busy = useSignal(false)
	const blockCountSinceReset = useSignal(controller.blockCountSinceReset)
	const currentTimestamp = useSignal(controller.currentTimestamp)
	const currentScenario = useSignal(controller.currentScenario)
	const currentSource = useSignal(controller.simulationSource)
	const isBootstrapped = useSignal(controller.isBootstrapped)
	const isBootstrapping = useSignal(controller.isBootstrapping)
	const modal = useSignal<SimulationModal>(undefined)
	const queryDelayMilliseconds = useSignal(controller.queryDelayMilliseconds.toString())
	const repPerEthPrice = useSignal(formatCurrencyInputBalance(controller.repPerEthPrice))
	const repPerUsdcPrice = useSignal(formatCurrencyInputBalance(controller.repPerUsdcPrice, 6))
	const savedStateError = useSignal<string | undefined>(undefined)
	const savedStateStorage = window.localStorage
	const initialSavedStateSummary: SavedSimulationStateStorageSummary = getSavedSimulationStateStorageSummary(savedStateStorage)
	const savedStateRecords = useSignal<SavedSimulationStateRecord[]>(initialSavedStateSummary.records)
	const savedStateStorageWarning = useSignal<string | undefined>(initialSavedStateSummary.warning)
	const saveName = useSignal('')
	const exportName = useSignal('')
	const exportStateText = useSignal('')
	const importStateText = useSignal('')
	const selectedAccount = useSignal(controller.selectedAccount)
	const bootstrapError = useSignal(controller.bootstrapError)
	const bootstrapLabel = useSignal(controller.bootstrapLabel)
	const bootstrapProgress = useSignal(controller.bootstrapProgress)
	const transactionCountSinceReset = useSignal(controller.transactionCountSinceReset)
	const transactionDelayMilliseconds = useSignal(controller.transactionDelayMilliseconds.toString())

	const reloadSavedStateRecords = () => {
		const summary = getSavedSimulationStateStorageSummary(savedStateStorage)
		savedStateRecords.value = summary.records
		savedStateStorageWarning.value = summary.warning
	}

	const clearSavedStateStorageWarning = () => {
		const summary = getSavedSimulationStateStorageSummary(savedStateStorage)
		savedStateRecords.value = summary.records
		savedStateStorageWarning.value = undefined
	}

	const getDefaultSavedStateName = () => (currentSource.value.kind === 'saved-state' ? currentSource.value.name : `${getSimulationScenarioLabel(currentScenario.value)} ${new Date().toISOString().slice(0, 16)}`)

	const closeModal = () => {
		modal.value = undefined
		savedStateError.value = undefined
	}

	const resetRepPerEthPriceInput = () => {
		repPerEthPrice.value = formatCurrencyInputBalance(controller.repPerEthPrice)
	}
	const resetRepPerUsdcPriceInput = () => {
		repPerUsdcPrice.value = formatCurrencyInputBalance(controller.repPerUsdcPrice, 6)
	}
	useEffect(
		() =>
			controller.subscribe(() => {
				blockCountSinceReset.value = controller.blockCountSinceReset
				bootstrapError.value = controller.bootstrapError
				bootstrapLabel.value = controller.bootstrapLabel
				bootstrapProgress.value = controller.bootstrapProgress
				currentTimestamp.value = controller.currentTimestamp
				currentScenario.value = controller.currentScenario
				currentSource.value = controller.simulationSource
				isBootstrapped.value = controller.isBootstrapped
				isBootstrapping.value = controller.isBootstrapping
				queryDelayMilliseconds.value = controller.queryDelayMilliseconds.toString()
				repPerEthPrice.value = formatCurrencyInputBalance(controller.repPerEthPrice)
				repPerUsdcPrice.value = formatCurrencyInputBalance(controller.repPerUsdcPrice, 6)
				selectedAccount.value = controller.selectedAccount
				transactionCountSinceReset.value = controller.transactionCountSinceReset
				transactionDelayMilliseconds.value = controller.transactionDelayMilliseconds.toString()
			}),
		[controller],
	)
	const runControl = async (work: () => Promise<void>) => {
		if (busy.value) return
		busy.value = true
		try {
			await work()
			await onRefresh()
		} finally {
			busy.value = false
		}
	}
	const runNavigationControl = async (work: () => Promise<void>) => {
		if (busy.value) return
		busy.value = true
		savedStateError.value = undefined
		try {
			await work()
		} catch (error) {
			savedStateError.value = getErrorMessage(error, UI_STRING_FAILED_TO_UPDATE_THE_SAVED_SIMULATION_STATE)
		} finally {
			busy.value = false
		}
	}

	const navigateAndRefreshEnvironment = async (navigate: () => void) => {
		await runNavigationControl(async () => {
			navigate()
			await onEnvironmentChanged()
		})
	}

	const persistAndNavigateToSavedState = async (serialized: string) => {
		const record = persistSavedSimulationState(serialized, savedStateStorage)
		reloadSavedStateRecords()
		navigateToSavedSimulationState(record.id)
		await onEnvironmentChanged()
	}

	const showExportModal = async () => {
		const nextName = getDefaultSavedStateName()
		exportName.value = nextName
		exportStateText.value = ''
		savedStateError.value = undefined
		modal.value = 'export'
		try {
			exportStateText.value = await controller.exportState(nextName)
		} catch (error) {
			savedStateError.value = getErrorMessage(error, UI_STRING_FAILED_TO_EXPORT_THE_CURRENT_SIMULATION_STATE)
		}
	}

	let scenarioDetail = bootstrapError.value
	if (scenarioDetail === undefined) {
		scenarioDetail =
			currentSource.value.kind === 'saved-state' ? UI_TEMPLATE_CUSTOM_STATE_VALUE_BASED_ON_VALUE_SAVED_VALUE(currentSource.value.name, getSimulationScenarioLabel(currentSource.value.baseScenario), new Date(currentSource.value.savedAt).toLocaleString()) : getSimulationScenarioDescription(currentScenario.value)
	}
	const scenarioStatus = getScenarioStatus({
		bootstrapError: bootstrapError.value,
		isBootstrapped: isBootstrapped.value,
	})

	return (
		<section className='panel contract-panel simulation-banner'>
			<div className='contract-panel-header simulation-banner-header'>
				<div>
					<h2>{UI_STRING_SIMULATION_MODE}</h2>
					<p className='detail'>{UI_STRING_BROWSER_SIMULATION}</p>
				</div>
			</div>
			<div className='contract-list simulation-banner-list'>
				<div className='contract-row simulation-banner-row'>
					<div className='contract-copy'>
						<div className='contract-topline'>
							<Badge tone={scenarioStatus.badgeTone}>{scenarioStatus.label}</Badge>
							<h3>{UI_STRING_SCENARIO}</h3>
						</div>
						<p className='detail'>{scenarioDetail}</p>
						{savedStateStorageWarning.value === undefined ? undefined : <p className='detail'>{savedStateStorageWarning.value}</p>}
						{bootstrapError.value === undefined && isBootstrapping.value ? (
							<p className='detail'>
								<span className='spinner' aria-hidden='true' />
								{bootstrapLabel.value ?? UI_STRING_PREPARING_THE_SELECTED_SIMULATION_SCENARIO_IN_THE_BACKGROUND}
							</p>
						) : undefined}
						{isBootstrapping.value ? (
							<div className='notice-progress-track simulation-progress-track' aria-hidden='true'>
								<div className='notice-progress-fill simulation-progress-fill' style={{ width: `${Math.round((bootstrapProgress.value ?? 0.08) * 100)}%` }} />
							</div>
						) : undefined}
					</div>
					<select
						className='simulation-control-select'
						aria-label={UI_STRING_SIMULATION_SCENARIO}
						value={currentSource.value.kind === 'saved-state' ? `saved:${currentSource.value.stateId}` : `scenario:${currentScenario.value}`}
						disabled={busy.value || isBootstrapping.value}
						onChange={event => {
							const nextSelection = event.currentTarget.value
							if (nextSelection.startsWith('saved:')) {
								void navigateAndRefreshEnvironment(() => {
									navigateToSavedSimulationState(nextSelection.slice('saved:'.length))
								})
								return
							}
							void navigateAndRefreshEnvironment(() => {
								navigateToBuiltInScenario(nextSelection.slice('scenario:'.length))
							})
						}}
					>
						<optgroup label={UI_STRING_BUILT_IN_SCENARIOS}>
							{SIMULATION_SCENARIOS.map(scenario => (
								<option key={scenario} value={`scenario:${scenario}`}>
									{getSimulationScenarioLabel(scenario)}
								</option>
							))}
						</optgroup>
						{savedStateRecords.value.length === 0 ? undefined : (
							<optgroup label={UI_STRING_SAVED_STATES}>
								{savedStateRecords.value.map(record => (
									<option key={record.id} value={`saved:${record.id}`}>
										{record.name}
									</option>
								))}
							</optgroup>
						)}
					</select>
				</div>
				<div className='contract-row simulation-banner-row'>
					<div className='contract-copy'>
						<div className='contract-topline'>
							<Badge tone='ok'>{UI_STRING_ACTIVE}</Badge>
							<h3>{UI_STRING_QA_ACCOUNT}</h3>
						</div>
					</div>
					<select
						className='simulation-control-select'
						aria-label={UI_STRING_SIMULATION_QA_ACCOUNT}
						value={selectedAccount.value}
						disabled={busy.value || !isBootstrapped.value}
						onChange={event => {
							const nextAccount = controller.accounts.find(account => account === event.currentTarget.value)
							if (nextAccount === undefined) return
							void runControl(async () => {
								await controller.selectAccount(nextAccount)
							})
						}}
					>
						{controller.accounts.map(account => (
							<option key={account} value={account}>
								{getSimulationAccountOptionLabel(account)}
							</option>
						))}
					</select>
				</div>
				<div className='simulation-banner-stats'>
					<div className='simulation-stat-card'>
						<span className='simulation-stat-label'>{UI_STRING_BLOCKS}</span>
						<strong>{blockCountSinceReset.value.toString()}</strong>
					</div>
					<div className='simulation-stat-card'>
						<span className='simulation-stat-label'>{UI_STRING_TRANSACTIONS}</span>
						<strong>{transactionCountSinceReset.value.toString()}</strong>
					</div>
					<div className='simulation-stat-card simulation-stat-card-wide'>
						<span className='simulation-stat-label'>{UI_STRING_BLOCKCHAIN_TIME}</span>
						<strong>
							<TimestampValue currentTimestamp={currentTimestamp.value} timestamp={currentTimestamp.value} />
						</strong>
					</div>
				</div>
				<details className='simulation-advanced-controls'>
					<summary>{UI_STRING_QA_CONTROLS_PRICES_AND_TIME_TRAVEL}</summary>
					<div className='simulation-banner-controls'>
						<div className='contract-copy'>
							<h3>{UI_STRING_CONTROLS}</h3>
							<p className='detail'>{UI_STRING_USE_THESE_CONTROLS_FOR_REPEATABLE_MANUAL_UI_QA_WITHOUT_A_WALLET_EXTENSION}</p>
							<div className='simulation-delay-grid'>
								<label className='simulation-delay-field'>
									<span className='simulation-delay-label'>{UI_STRING_QUERY_DELAY_MS}</span>
									<input
										className='simulation-control-input'
										type='number'
										min='0'
										step='100'
										inputMode='numeric'
										value={queryDelayMilliseconds.value}
										disabled={busy.value}
										onInput={event => {
											queryDelayMilliseconds.value = event.currentTarget.value
										}}
										onChange={event => {
											controller.setQueryDelayMilliseconds(Number(event.currentTarget.value))
										}}
									/>
								</label>
								<label className='simulation-delay-field'>
									<span className='simulation-delay-label'>{UI_STRING_REP_ETH_MOCK_PRICE}</span>
									<input
										className='simulation-control-input'
										type='text'
										inputMode='decimal'
										value={repPerEthPrice.value}
										disabled={busy.value}
										onInput={event => {
											repPerEthPrice.value = event.currentTarget.value
										}}
										onChange={event => {
											const parsedPrice = tryParseDecimalInput(event.currentTarget.value)
											if (parsedPrice === undefined) {
												resetRepPerEthPriceInput()
												return
											}
											void runControl(async () => {
												controller.setRepPerEthPrice(parsedPrice)
											})
										}}
									/>
								</label>
								<label className='simulation-delay-field'>
									<span className='simulation-delay-label'>{UI_STRING_REP_USDC_MOCK_PRICE}</span>
									<input
										className='simulation-control-input'
										type='text'
										inputMode='decimal'
										value={repPerUsdcPrice.value}
										disabled={busy.value}
										onInput={event => {
											repPerUsdcPrice.value = event.currentTarget.value
										}}
										onChange={event => {
											const parsedPrice = tryParseDecimalInput(event.currentTarget.value, 6)
											if (parsedPrice === undefined) {
												resetRepPerUsdcPriceInput()
												return
											}
											void runControl(async () => {
												controller.setRepPerUsdcPrice(parsedPrice)
											})
										}}
									/>
								</label>
								<label className='simulation-delay-field'>
									<span className='simulation-delay-label'>{UI_STRING_TRANSACTION_RECEIPT_DELAY_MS}</span>
									<input
										className='simulation-control-input'
										type='number'
										min='0'
										step='100'
										inputMode='numeric'
										value={transactionDelayMilliseconds.value}
										disabled={busy.value}
										onInput={event => {
											transactionDelayMilliseconds.value = event.currentTarget.value
										}}
										onChange={event => {
											controller.setTransactionDelayMilliseconds(Number(event.currentTarget.value))
										}}
									/>
								</label>
							</div>
							<p className='detail'>{UI_STRING_SIMULATION_CONTROL_HELP_TEXT}</p>
						</div>
						<div className='simulation-control-groups'>
							<div className='simulation-control-group'>
								<span className='simulation-control-group-label'>{UI_STRING_ACTIONS}</span>
								<div className='button-row simulation-button-row'>
									<button className='secondary' onClick={() => void runControl(async () => await controller.reset())} disabled={busy.value || !isBootstrapped.value}>
										{UI_STRING_RESET_SCENARIO}
									</button>
									<button className='secondary' onClick={() => void runControl(async () => await controller.mineBlock())} disabled={busy.value || !isBootstrapped.value}>
										{UI_STRING_MINE_BLOCK}
									</button>
									<button className='secondary' onClick={() => void runControl(async () => await controller.mintRep(SIMULATION_REP_MINT_AMOUNT))} disabled={busy.value || !isBootstrapped.value}>
										{UI_STRING_MINT_1_MILLION_REP}
									</button>
									<button
										className='secondary'
										onClick={() => {
											saveName.value = getDefaultSavedStateName()
											savedStateError.value = undefined
											modal.value = 'save'
										}}
										disabled={busy.value || !isBootstrapped.value}
									>
										{UI_STRING_SAVE_STATE}
									</button>
									<button className='secondary' onClick={() => void showExportModal()} disabled={busy.value || !isBootstrapped.value}>
										{UI_STRING_EXPORT_STATE}
									</button>
									<button
										className='secondary'
										onClick={() => {
											importStateText.value = ''
											savedStateError.value = undefined
											modal.value = 'import'
										}}
										disabled={busy.value}
									>
										{UI_STRING_IMPORT_STATE}
									</button>
									{savedStateStorageWarning.value === undefined ? undefined : (
										<button
											className='destructive'
											onClick={() => {
												savedStateError.value = undefined
												modal.value = 'cleanup'
											}}
											disabled={busy.value}
										>
											{UI_STRING_REMOVE_CORRUPTED_SAVES}
										</button>
									)}
									{currentSource.value.kind !== 'saved-state' ? undefined : (
										<button
											className='destructive'
											onClick={() => {
												savedStateError.value = undefined
												modal.value = 'delete'
											}}
											disabled={busy.value}
										>
											{UI_STRING_DELETE_SAVE}
										</button>
									)}
								</div>
							</div>
							<div className='simulation-control-group'>
								<span className='simulation-control-group-label'>{UI_STRING_TIME_TRAVEL}</span>
								<div className='button-row simulation-button-row simulation-time-travel-row'>
									{SIMULATION_TIME_PRESETS.map(preset => (
										<button key={preset.label} className='secondary' onClick={() => void runControl(async () => await controller.advanceTime(preset.seconds))} disabled={busy.value || !isBootstrapped.value}>
											{preset.label}
										</button>
									))}
								</div>
							</div>
						</div>
					</div>
				</details>
			</div>
			<OperationModal isOpen={modal.value === 'save'} onClose={closeModal} title={UI_STRING_SAVE_SIMULATION_STATE}>
				<div className='field'>
					<label htmlFor='simulation-save-name'>{UI_STRING_STATE_NAME}</label>
					<input id='simulation-save-name' className='simulation-control-input' type='text' value={saveName.value} onInput={event => (saveName.value = event.currentTarget.value)} />
				</div>
				{savedStateError.value === undefined ? undefined : <p className='detail'>{savedStateError.value}</p>}
				<div className='actions'>
					<button
						type='button'
						onClick={() =>
							void runNavigationControl(async () => {
								await persistAndNavigateToSavedState(await controller.exportState(saveName.value))
							})
						}
					>
						{UI_STRING_SAVE}
					</button>
				</div>
			</OperationModal>
			<OperationModal isOpen={modal.value === 'export'} onClose={closeModal} title={UI_STRING_EXPORT_SIMULATION_STATE}>
				<div className='field'>
					<label htmlFor='simulation-export-name'>{UI_STRING_EXPORT_NAME}</label>
					<input id='simulation-export-name' className='simulation-control-input' type='text' value={exportName.value} onInput={event => (exportName.value = event.currentTarget.value)} />
				</div>
				<div className='field'>
					<label htmlFor='simulation-export-json'>{UI_STRING_JSON_STATE}</label>
					<textarea id='simulation-export-json' rows={14} value={exportStateText.value} readOnly />
				</div>
				{savedStateError.value === undefined ? undefined : <p className='detail'>{savedStateError.value}</p>}
				<div className='actions'>
					<button
						type='button'
						className='secondary'
						onClick={() =>
							void runNavigationControl(async () => {
								exportStateText.value = await controller.exportState(exportName.value)
							})
						}
					>
						{UI_STRING_REFRESH_EXPORT}
					</button>
					<button type='button' className='secondary' disabled={exportStateText.value.trim() === ''} onClick={() => void copyText(exportStateText.value)}>
						{copied.value ? UI_STRING_COPIED : UI_STRING_COPY_JSON}
					</button>
				</div>
			</OperationModal>
			<OperationModal isOpen={modal.value === 'import'} onClose={closeModal} title={UI_STRING_IMPORT_SIMULATION_STATE}>
				<div className='field'>
					<label htmlFor='simulation-import-json'>{UI_STRING_JSON_STATE}</label>
					<textarea id='simulation-import-json' rows={14} value={importStateText.value} onInput={event => (importStateText.value = event.currentTarget.value)} />
				</div>
				{savedStateError.value === undefined ? undefined : <p className='detail'>{savedStateError.value}</p>}
				<div className='actions'>
					<button
						type='button'
						onClick={() =>
							void runNavigationControl(async () => {
								await persistAndNavigateToSavedState(importStateText.value)
							})
						}
					>
						{UI_STRING_IMPORT_AND_LOAD}
					</button>
				</div>
			</OperationModal>
			<OperationModal isOpen={modal.value === 'delete'} onClose={closeModal} title={UI_STRING_DELETE_SAVED_SIMULATION_STATE}>
				<p className='detail'>{currentSource.value.kind === 'saved-state' ? UI_TEMPLATE_DELETE_SAVED_SIMULATION_STATE_DETAIL(currentSource.value.name) : UI_STRING_BUILT_IN_SCENARIOS_CANNOT_BE_DELETED}</p>
				{savedStateError.value === undefined ? undefined : <p className='detail'>{savedStateError.value}</p>}
				<div className='actions'>
					<button
						type='button'
						className='destructive'
						disabled={currentSource.value.kind !== 'saved-state'}
						onClick={() =>
							void runNavigationControl(async () => {
								if (currentSource.value.kind !== 'saved-state') return
								if (!deleteSavedSimulationState(currentSource.value.stateId, savedStateStorage)) throw new Error(UI_TEMPLATE_SAVED_SIMULATION_STATE_VALUE_NO_LONGER_EXISTS(currentSource.value.name))
								const baseScenario = currentSource.value.baseScenario
								reloadSavedStateRecords()
								navigateToBuiltInScenario(baseScenario)
								await onEnvironmentChanged()
							})
						}
					>
						{UI_STRING_DELETE_SAVE}
					</button>
				</div>
			</OperationModal>
			<OperationModal isOpen={modal.value === 'cleanup'} onClose={closeModal} title={UI_STRING_REMOVE_CORRUPTED_SAVED_STATES}>
				<p className='detail'>{UI_STRING_REMOVE_SAVED_SIMULATION_STATE_ENTRIES_THAT_ARE_NO_LONGER_READABLE_FROM_BROWSER}</p>
				{savedStateStorageWarning.value === undefined ? undefined : <p className='detail'>{savedStateStorageWarning.value}</p>}
				{savedStateError.value === undefined ? undefined : <p className='detail'>{savedStateError.value}</p>}
				<div className='actions'>
					<button
						type='button'
						className='destructive'
						onClick={() => {
							closeModal()
							savedStateStorageWarning.value = undefined
							void runNavigationControl(async () => {
								const removedCount = removeCorruptedSavedSimulationStates(savedStateStorage)
								if (removedCount === 0) throw new Error(UI_STRING_NO_CORRUPTED_SAVED_SIMULATION_STATES_WERE_FOUND)
								clearSavedStateStorageWarning()
								if (hasSavedSimulationStateRoute()) {
									navigateToBuiltInScenario(currentScenario.value)
									await onEnvironmentChanged()
									return
								}
							})
						}}
					>
						{UI_STRING_REMOVE_CORRUPTED_SAVES}
					</button>
				</div>
			</OperationModal>
		</section>
	)
}
