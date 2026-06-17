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

const SIMULATION_TIME_PRESETS = [
	{ label: '+1 hour', seconds: 60n * 60n },
	{ label: '+1 day', seconds: 24n * 60n * 60n },
	{ label: '+1 week', seconds: 7n * 24n * 60n * 60n },
	{ label: '+1 month', seconds: 30n * 24n * 60n * 60n },
	{ label: '+1 year', seconds: 365n * 24n * 60n * 60n },
] as const
const SIMULATION_REP_MINT_AMOUNT = 1_000_000n * 10n ** 18n
type SimulationBannerProps = {
	controller: SimulationController
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
	window.dispatchEvent(new PopStateEvent('popstate'))
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

function getScenarioStatus(parameters: { bootstrapError: string | undefined; isBootstrapped: boolean }) {
	if (parameters.bootstrapError !== undefined) {
		return {
			badgeClassName: 'error',
			label: 'Error',
		}
	}
	if (parameters.isBootstrapped) {
		return {
			badgeClassName: 'ok',
			label: 'Ready',
		}
	}
	return {
		badgeClassName: 'pending',
		label: 'Bootstrapping',
	}
}

export function SimulationBanner({ controller, onRefresh }: SimulationBannerProps) {
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
			savedStateError.value = getErrorMessage(error, 'Failed to update the saved simulation state')
		} finally {
			busy.value = false
		}
	}

	const persistAndNavigateToSavedState = async (serialized: string) => {
		const record = persistSavedSimulationState(serialized, savedStateStorage)
		reloadSavedStateRecords()
		navigateToSavedSimulationState(record.id)
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
			savedStateError.value = getErrorMessage(error, 'Failed to export the current simulation state')
		}
	}

	let scenarioDetail = bootstrapError.value
	if (scenarioDetail === undefined) {
		scenarioDetail = currentSource.value.kind === 'saved-state' ? `Custom state "${currentSource.value.name}" based on ${getSimulationScenarioLabel(currentSource.value.baseScenario)}. Saved ${new Date(currentSource.value.savedAt).toLocaleString()}.` : getSimulationScenarioDescription(currentScenario.value)
	}
	const scenarioStatus = getScenarioStatus({
		bootstrapError: bootstrapError.value,
		isBootstrapped: isBootstrapped.value,
	})

	return (
		<section className='panel contract-panel simulation-banner'>
			<div className='contract-panel-header simulation-banner-header'>
				<div>
					<h2>Simulation Mode</h2>
					<p className='detail'>Browser Simulation</p>
				</div>
			</div>
			<div className='contract-list simulation-banner-list'>
				<div className='contract-row simulation-banner-row'>
					<div className='contract-copy'>
						<div className='contract-topline'>
							<span className={`badge ${scenarioStatus.badgeClassName}`}>{scenarioStatus.label}</span>
							<h3>Scenario</h3>
						</div>
						<p className='detail'>{scenarioDetail}</p>
						{savedStateStorageWarning.value === undefined ? undefined : <p className='detail'>{savedStateStorageWarning.value}</p>}
						{bootstrapError.value === undefined && isBootstrapping.value ? (
							<p className='detail'>
								<span className='spinner' aria-hidden='true' />
								{bootstrapLabel.value ?? 'Preparing the selected simulation scenario in the background.'}
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
						value={currentSource.value.kind === 'saved-state' ? `saved:${currentSource.value.stateId}` : `scenario:${currentScenario.value}`}
						disabled={busy.value || isBootstrapping.value}
						onChange={event => {
							const nextSelection = event.currentTarget.value
							if (nextSelection.startsWith('saved:')) {
								navigateToSavedSimulationState(nextSelection.slice('saved:'.length))
								return
							}
							navigateToBuiltInScenario(nextSelection.slice('scenario:'.length))
						}}
					>
						<optgroup label='Built-in scenarios'>
							{SIMULATION_SCENARIOS.map(scenario => (
								<option key={scenario} value={`scenario:${scenario}`}>
									{getSimulationScenarioLabel(scenario)}
								</option>
							))}
						</optgroup>
						{savedStateRecords.value.length === 0 ? undefined : (
							<optgroup label='Saved states'>
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
							<span className='badge ok'>Active</span>
							<h3>QA account</h3>
						</div>
					</div>
					<select
						className='simulation-control-select'
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
								{account}
							</option>
						))}
					</select>
				</div>
				<div className='simulation-banner-stats'>
					<div className='simulation-stat-card'>
						<span className='simulation-stat-label'>Blocks</span>
						<strong>{blockCountSinceReset.value.toString()}</strong>
					</div>
					<div className='simulation-stat-card'>
						<span className='simulation-stat-label'>Transactions</span>
						<strong>{transactionCountSinceReset.value.toString()}</strong>
					</div>
					<div className='simulation-stat-card simulation-stat-card-wide'>
						<span className='simulation-stat-label'>Blockchain time</span>
						<strong>
							<TimestampValue currentTimestamp={currentTimestamp.value} timestamp={currentTimestamp.value} />
						</strong>
					</div>
				</div>
				<div className='simulation-banner-controls'>
					<div className='contract-copy'>
						<h3>Controls</h3>
						<p className='detail'>Use these controls for repeatable manual UI QA without a wallet extension.</p>
						<div className='simulation-delay-grid'>
							<label className='simulation-delay-field'>
								<span className='simulation-delay-label'>Query delay (ms)</span>
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
								<span className='simulation-delay-label'>REP / ETH mock price</span>
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
								<span className='simulation-delay-label'>REP / USDC mock price</span>
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
								<span className='simulation-delay-label'>Transaction receipt delay (ms)</span>
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
						<p className='detail'>Query delay slows simulation reads. The REP / ETH and REP / USDC mocks apply to every REP token in simulation mode. Transaction delay slows receipt confirmation so loading states stay visible.</p>
					</div>
					<div className='simulation-control-groups'>
						<div className='simulation-control-group'>
							<span className='simulation-control-group-label'>Actions</span>
							<div className='button-row simulation-button-row'>
								<button className='secondary' onClick={() => void runControl(async () => await controller.reset())} disabled={busy.value || !isBootstrapped.value}>
									Reset scenario
								</button>
								<button className='secondary' onClick={() => void runControl(async () => await controller.mineBlock())} disabled={busy.value || !isBootstrapped.value}>
									Mine block
								</button>
								<button className='secondary' onClick={() => void runControl(async () => await controller.mintRep(SIMULATION_REP_MINT_AMOUNT))} disabled={busy.value || !isBootstrapped.value}>
									Mint 1 million REP
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
									Save state
								</button>
								<button className='secondary' onClick={() => void showExportModal()} disabled={busy.value || !isBootstrapped.value}>
									Export state
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
									Import state
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
										Remove corrupted saves
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
										Delete save
									</button>
								)}
							</div>
						</div>
						<div className='simulation-control-group'>
							<span className='simulation-control-group-label'>Time travel</span>
							<div className='button-row simulation-button-row'>
								{SIMULATION_TIME_PRESETS.map(preset => (
									<button key={preset.label} className='secondary' onClick={() => void runControl(async () => await controller.advanceTime(preset.seconds))} disabled={busy.value || !isBootstrapped.value}>
										{preset.label}
									</button>
								))}
							</div>
						</div>
					</div>
				</div>
			</div>
			<OperationModal isOpen={modal.value === 'save'} onClose={closeModal} title='Save Simulation State'>
				<div className='field'>
					<label htmlFor='simulation-save-name'>State name</label>
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
						Save
					</button>
				</div>
			</OperationModal>
			<OperationModal isOpen={modal.value === 'export'} onClose={closeModal} title='Export Simulation State'>
				<div className='field'>
					<label htmlFor='simulation-export-name'>Export name</label>
					<input id='simulation-export-name' className='simulation-control-input' type='text' value={exportName.value} onInput={event => (exportName.value = event.currentTarget.value)} />
				</div>
				<div className='field'>
					<label htmlFor='simulation-export-json'>JSON state</label>
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
						Refresh export
					</button>
					<button type='button' className='secondary' disabled={exportStateText.value.trim() === ''} onClick={() => void copyText(exportStateText.value)}>
						{copied.value ? 'Copied' : 'Copy JSON'}
					</button>
				</div>
			</OperationModal>
			<OperationModal isOpen={modal.value === 'import'} onClose={closeModal} title='Import Simulation State'>
				<div className='field'>
					<label htmlFor='simulation-import-json'>JSON state</label>
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
						Import and load
					</button>
				</div>
			</OperationModal>
			<OperationModal isOpen={modal.value === 'delete'} onClose={closeModal} title='Delete Saved Simulation State'>
				<p className='detail'>{currentSource.value.kind === 'saved-state' ? `Delete the saved state "${currentSource.value.name}" from browser storage. Built-in scenarios are not affected.` : 'Built-in scenarios cannot be deleted.'}</p>
				{savedStateError.value === undefined ? undefined : <p className='detail'>{savedStateError.value}</p>}
				<div className='actions'>
					<button
						type='button'
						className='destructive'
						disabled={currentSource.value.kind !== 'saved-state'}
						onClick={() =>
							void runNavigationControl(async () => {
								if (currentSource.value.kind !== 'saved-state') return
								if (!deleteSavedSimulationState(currentSource.value.stateId, savedStateStorage)) throw new Error(`Saved simulation state "${currentSource.value.name}" no longer exists`)
								reloadSavedStateRecords()
								navigateToBuiltInScenario(currentSource.value.baseScenario)
							})
						}
					>
						Delete save
					</button>
				</div>
			</OperationModal>
			<OperationModal isOpen={modal.value === 'cleanup'} onClose={closeModal} title='Remove Corrupted Saved States'>
				<p className='detail'>Remove saved simulation state entries that are no longer readable from browser storage. Valid saved states will be kept.</p>
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
								if (removedCount === 0) throw new Error('No corrupted saved simulation states were found')
								clearSavedStateStorageWarning()
								if (hasSavedSimulationStateRoute()) {
									navigateToBuiltInScenario(currentScenario.value)
									return
								}
							})
						}}
					>
						Remove corrupted saves
					</button>
				</div>
			</OperationModal>
		</section>
	)
}
