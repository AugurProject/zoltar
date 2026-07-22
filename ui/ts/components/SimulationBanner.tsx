import * as commonCopy from '../copy/common.js'
import * as simulationCopy from '../copy/simulation.js'
import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { getErrorMessage } from '../lib/errors.js'
import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch } from '../lib/routing.js'
import type { SimulationController } from '../simulation/controller.js'
import { tryParseDecimalInput } from '../lib/decimal.js'
import { formatCurrencyInputBalance } from '../lib/formatters.js'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { getSimulationScenarioDescription, getSimulationScenarioLabel, SIMULATION_SCENARIOS } from '../simulation/scenarios.js'
import { deleteSavedSimulationState, getSavedSimulationStateStorageSummary, persistSavedSimulationState, removeCorruptedSavedSimulationStates, type SavedSimulationStateRecord, type SavedSimulationStateStorageSummary } from '../simulation/savedStates.js'
import { OperationModal } from './OperationModal.js'
import { AddressValue } from './AddressValue.js'
import { TimestampValue } from './TimestampValue.js'
import { Badge } from './Badge.js'
import type { BadgeTone } from '../types/components.js'

const SIMULATION_TIME_PRESETS = [
	{ label: simulationCopy.plus1Hour, seconds: 60n * 60n },
	{ label: simulationCopy.plus1Day, seconds: 24n * 60n * 60n },
	{ label: simulationCopy.plus1Week, seconds: 7n * 24n * 60n * 60n },
	{ label: simulationCopy.plus1Month, seconds: 30n * 24n * 60n * 60n },
	{ label: simulationCopy.plus1Year, seconds: 365n * 24n * 60n * 60n },
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

function getSimulationAccountOptionLabel(accountIndex: number) {
	return simulationCopy.formatQaAccountNumber((accountIndex + 1).toString())
}

function getScenarioStatus(parameters: { bootstrapError: string | undefined; isBootstrapped: boolean }): { badgeTone: BadgeTone; label: string } {
	if (parameters.bootstrapError !== undefined) {
		return {
			badgeTone: 'blocked',
			label: commonCopy.error,
		}
	}
	if (parameters.isBootstrapped) {
		return {
			badgeTone: 'ok',
			label: simulationCopy.ready,
		}
	}
	return {
		badgeTone: 'pending',
		label: simulationCopy.bootstrapping,
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
	const simulationDetailsOpen = useSignal(!controller.isBootstrapped)
	const bootstrapError = useSignal(controller.bootstrapError)
	const bootstrapLabel = useSignal(controller.bootstrapLabel)
	const bootstrapProgress = useSignal(controller.bootstrapProgress)
	const transactionCountSinceReset = useSignal(controller.transactionCountSinceReset)
	const transactionDelayMilliseconds = useSignal(controller.transactionDelayMilliseconds.toString())
	const previousController = useRef(controller)

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
	useEffect(() => {
		let controllerChanged = previousController.current !== controller
		previousController.current = controller
		const syncControllerState = () => {
			const wasBootstrapped = isBootstrapped.value
			blockCountSinceReset.value = controller.blockCountSinceReset
			bootstrapError.value = controller.bootstrapError
			bootstrapLabel.value = controller.bootstrapLabel
			bootstrapProgress.value = controller.bootstrapProgress
			currentTimestamp.value = controller.currentTimestamp
			currentScenario.value = controller.currentScenario
			currentSource.value = controller.simulationSource
			isBootstrapped.value = controller.isBootstrapped
			isBootstrapping.value = controller.isBootstrapping
			if (!controller.isBootstrapped || controller.isBootstrapping) simulationDetailsOpen.value = true
			else if (controllerChanged || !wasBootstrapped) simulationDetailsOpen.value = false
			controllerChanged = false
			queryDelayMilliseconds.value = controller.queryDelayMilliseconds.toString()
			repPerEthPrice.value = formatCurrencyInputBalance(controller.repPerEthPrice)
			repPerUsdcPrice.value = formatCurrencyInputBalance(controller.repPerUsdcPrice, 6)
			selectedAccount.value = controller.selectedAccount
			transactionCountSinceReset.value = controller.transactionCountSinceReset
			transactionDelayMilliseconds.value = controller.transactionDelayMilliseconds.toString()
		}
		syncControllerState()
		return controller.subscribe(syncControllerState)
	}, [controller])
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
			savedStateError.value = getErrorMessage(error, simulationCopy.savedStateUpdateError)
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
			savedStateError.value = getErrorMessage(error, simulationCopy.stateExportError)
		}
	}

	let scenarioDetail = bootstrapError.value
	if (scenarioDetail === undefined) {
		scenarioDetail = currentSource.value.kind === 'saved-state' ? simulationCopy.formatSavedStateDetail(currentSource.value.name, getSimulationScenarioLabel(currentSource.value.baseScenario), new Date(currentSource.value.savedAt).toLocaleString()) : getSimulationScenarioDescription(currentScenario.value)
	}
	const scenarioStatus = getScenarioStatus({
		bootstrapError: bootstrapError.value,
		isBootstrapped: isBootstrapped.value,
	})
	const selectedAccountIndex = controller.accounts.findIndex(account => account === selectedAccount.value)
	const selectedAccountLabel = getSimulationAccountOptionLabel(selectedAccountIndex < 0 ? 0 : selectedAccountIndex)

	return (
		<section className='panel contract-panel simulation-banner'>
			<details
				className='simulation-banner-details'
				open={simulationDetailsOpen.value}
				onToggle={event => {
					simulationDetailsOpen.value = event.currentTarget.open
				}}
			>
				<summary>
					<span className='simulation-banner-compact-summary'>
						<span className='simulation-banner-compact-heading'>
							<h2>{simulationCopy.browserSimulation}</h2>
							<span className='simulation-banner-compact-state'>
								<Badge tone={scenarioStatus.badgeTone}>{scenarioStatus.label}</Badge>
								<strong>{getSimulationScenarioLabel(currentScenario.value)}</strong>
								<span className='simulation-banner-compact-account'>{selectedAccountLabel}</span>
							</span>
						</span>
						<span className='simulation-banner-compact-action'>{simulationDetailsOpen.value ? simulationCopy.hideSimulationDetails : simulationCopy.showSimulationDetails}</span>
					</span>
				</summary>
				<div className='contract-list simulation-banner-list'>
					<div className='contract-row simulation-banner-row'>
						<div className='contract-copy'>
							<div className='contract-topline'>
								<Badge tone={scenarioStatus.badgeTone}>{scenarioStatus.label}</Badge>
								<h3>{simulationCopy.scenario}</h3>
							</div>
							<p className='detail'>{scenarioDetail}</p>
							{savedStateStorageWarning.value === undefined ? undefined : <p className='detail'>{savedStateStorageWarning.value}</p>}
							{bootstrapError.value === undefined && isBootstrapping.value ? (
								<p className='detail'>
									<span className='spinner' aria-hidden='true' />
									{bootstrapLabel.value ?? simulationCopy.scenarioPreparationDetail}
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
							aria-label={simulationCopy.simulationScenario}
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
							<optgroup label={simulationCopy.builtInScenarios}>
								{SIMULATION_SCENARIOS.map(scenario => (
									<option key={scenario} value={`scenario:${scenario}`}>
										{getSimulationScenarioLabel(scenario)}
									</option>
								))}
							</optgroup>
							{savedStateRecords.value.length === 0 ? undefined : (
								<optgroup label={simulationCopy.savedStates}>
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
								<Badge tone='ok'>{commonCopy.active}</Badge>
								<h3>{simulationCopy.qaAccount}</h3>
							</div>
							<AddressValue address={selectedAccount.value} />
						</div>
						<select
							className='simulation-control-select'
							aria-label={simulationCopy.simulationQaAccount}
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
							{controller.accounts.map((account, accountIndex) => (
								<option key={account} value={account}>
									{getSimulationAccountOptionLabel(accountIndex)}
								</option>
							))}
						</select>
					</div>
					<div className='simulation-banner-stats'>
						<div className='simulation-stat-card'>
							<span className='simulation-stat-label'>{simulationCopy.blocks}</span>
							<strong>{blockCountSinceReset.value.toString()}</strong>
						</div>
						<div className='simulation-stat-card'>
							<span className='simulation-stat-label'>{simulationCopy.transactions}</span>
							<strong>{transactionCountSinceReset.value.toString()}</strong>
						</div>
						<div className='simulation-stat-card simulation-stat-card-wide'>
							<span className='simulation-stat-label'>{simulationCopy.blockchainTime}</span>
							<strong>
								<TimestampValue currentTimestamp={currentTimestamp.value} timestamp={currentTimestamp.value} />
							</strong>
						</div>
					</div>
					<details className='simulation-advanced-controls'>
						<summary>{simulationCopy.qaControlsPricesAndTimeTravel}</summary>
						<div className='simulation-banner-controls'>
							<div className='contract-copy'>
								<div className='simulation-delay-grid'>
									<label className='simulation-delay-field'>
										<span className='simulation-delay-label'>{simulationCopy.queryDelayMs}</span>
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
										<span className='simulation-delay-label'>{simulationCopy.repEthMockPrice}</span>
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
										<span className='simulation-delay-label'>{simulationCopy.repUsdcMockPrice}</span>
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
										<span className='simulation-delay-label'>{simulationCopy.transactionReceiptDelayMs}</span>
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
								<p className='detail'>{simulationCopy.simulationControlHelpText}</p>
							</div>
							<div className='simulation-control-groups'>
								<div className='simulation-control-group'>
									<span className='simulation-control-group-label'>{simulationCopy.actions}</span>
									<div className='button-row simulation-button-row'>
										<button className='secondary' onClick={() => void runControl(async () => await controller.reset())} disabled={busy.value || !isBootstrapped.value}>
											{simulationCopy.resetScenario}
										</button>
										<button className='secondary' onClick={() => void runControl(async () => await controller.mineBlock())} disabled={busy.value || !isBootstrapped.value}>
											{simulationCopy.mineBlock}
										</button>
										<button className='secondary' onClick={() => void runControl(async () => await controller.mintRep(SIMULATION_REP_MINT_AMOUNT))} disabled={busy.value || !isBootstrapped.value}>
											{simulationCopy.mint1MillionRep}
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
											{simulationCopy.saveState}
										</button>
										<button className='secondary' onClick={() => void showExportModal()} disabled={busy.value || !isBootstrapped.value}>
											{simulationCopy.exportState}
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
											{simulationCopy.importState}
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
												{simulationCopy.removeCorruptedSaves}
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
												{simulationCopy.deleteSave}
											</button>
										)}
									</div>
								</div>
								<div className='simulation-control-group'>
									<span className='simulation-control-group-label'>{simulationCopy.timeTravel}</span>
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
			</details>
			<OperationModal isOpen={modal.value === 'save'} onClose={closeModal} title={simulationCopy.saveSimulationState}>
				<div className='field'>
					<label htmlFor='simulation-save-name'>{simulationCopy.stateName}</label>
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
						{simulationCopy.save}
					</button>
				</div>
			</OperationModal>
			<OperationModal isOpen={modal.value === 'export'} onClose={closeModal} title={simulationCopy.exportSimulationState}>
				<div className='field'>
					<label htmlFor='simulation-export-name'>{simulationCopy.exportName}</label>
					<input id='simulation-export-name' className='simulation-control-input' type='text' value={exportName.value} onInput={event => (exportName.value = event.currentTarget.value)} />
				</div>
				<div className='field'>
					<label htmlFor='simulation-export-json'>{simulationCopy.jsonState}</label>
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
						{simulationCopy.refreshExport}
					</button>
					<button type='button' className='secondary' disabled={exportStateText.value.trim() === ''} onClick={() => void copyText(exportStateText.value)}>
						{copied.value ? commonCopy.copied : simulationCopy.copyJson}
					</button>
				</div>
			</OperationModal>
			<OperationModal isOpen={modal.value === 'import'} onClose={closeModal} title={simulationCopy.importSimulationState}>
				<div className='field'>
					<label htmlFor='simulation-import-json'>{simulationCopy.jsonState}</label>
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
						{simulationCopy.importAndLoad}
					</button>
				</div>
			</OperationModal>
			<OperationModal isOpen={modal.value === 'delete'} onClose={closeModal} title={simulationCopy.deleteSavedSimulationState}>
				<p className='detail'>{currentSource.value.kind === 'saved-state' ? simulationCopy.formatDeleteSavedSimulationStateDetail(currentSource.value.name) : simulationCopy.builtInScenarioDeletionReason}</p>
				{savedStateError.value === undefined ? undefined : <p className='detail'>{savedStateError.value}</p>}
				<div className='actions'>
					<button
						type='button'
						className='destructive'
						disabled={currentSource.value.kind !== 'saved-state'}
						onClick={() =>
							void runNavigationControl(async () => {
								if (currentSource.value.kind !== 'saved-state') return
								if (!deleteSavedSimulationState(currentSource.value.stateId, savedStateStorage)) throw new Error(simulationCopy.formatMissingSavedStateError(currentSource.value.name))
								const baseScenario = currentSource.value.baseScenario
								reloadSavedStateRecords()
								navigateToBuiltInScenario(baseScenario)
								await onEnvironmentChanged()
							})
						}
					>
						{simulationCopy.deleteSave}
					</button>
				</div>
			</OperationModal>
			<OperationModal isOpen={modal.value === 'cleanup'} onClose={closeModal} title={simulationCopy.removeCorruptedSavedStates}>
				<p className='detail'>{simulationCopy.invalidSavedStateCleanupHint}</p>
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
								if (removedCount === 0) throw new Error(simulationCopy.corruptedSavesEmptyError)
								clearSavedStateStorageWarning()
								if (hasSavedSimulationStateRoute()) {
									navigateToBuiltInScenario(currentScenario.value)
									await onEnvironmentChanged()
									return
								}
							})
						}}
					>
						{simulationCopy.removeCorruptedSaves}
					</button>
				</div>
			</OperationModal>
		</section>
	)
}
