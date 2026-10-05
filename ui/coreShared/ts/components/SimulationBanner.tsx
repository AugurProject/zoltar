import * as appCopy from '../copy/app.js'
import * as commonCopy from '../copy/common.js'
import * as simulationCopy from '../copy/simulation.js'
import { useSignal } from '@preact/signals'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import { getErrorMessage } from '../lib/errors.js'
import type { SimulationController } from '../simulation/controller.js'
import { getBuiltInScenarioLocation, getSavedSimulationStateLocation, hasSavedSimulationStateRoute, refreshEnvironmentAtSimulationLocation } from '../simulation/scenarioNavigation.js'
import { tryParseDecimalInput } from '../forms/decimal.js'
import { formatCurrencyInputBalance, formatTimestampWithRelative } from '../lib/formatters.js'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { getBrowserStorage } from '../lib/browserStorage.js'
import { getRegisteredSimulationScenarios, getSimulationScenarioDescription, getSimulationScenarioLabel } from '../simulation/scenarios.js'
import { deleteSavedSimulationState, getSavedSimulationStateStorageSummary, persistSavedSimulationState, removeCorruptedSavedSimulationStates, type SavedSimulationStateRecord, type SavedSimulationStateStorageSummary } from '../simulation/savedStates.js'
import { OperationModal } from './OperationModal.js'
import { TimestampValue } from './TimestampValue.js'
import { Badge } from './Badge.js'
import { getSimulationAccountOptionLabel, SimulationAccountControls, SimulationWalletControls } from './SimulationWalletControls.js'
import { ErrorNotice } from './ErrorNotice.js'
import { CopyErrorMessage } from './CopyErrorMessage.js'
import { SIMULATION_TIME_PRESETS } from '../simulation/timePresets.js'
import { getScenarioStatus, SimulationStripSummary } from './SimulationStripSummary.js'
import { SimulationControlField, SimulationNameField } from './SimulationControlFields.js'

const SIMULATION_REP_MINT_AMOUNT = 1_000_000n * 10n ** 18n
type SimulationBannerProps = {
	controller: SimulationController
	onEnvironmentChanged?: () => Promise<void>
	onRefresh: () => Promise<void>
}

type SimulationModal = 'cleanup' | 'delete' | 'export' | 'import' | 'save' | undefined
type NavigationOperation = 'cleanup' | 'delete' | 'import' | 'navigation' | 'save'

export function SimulationBanner({ controller, onEnvironmentChanged = async () => undefined, onRefresh }: SimulationBannerProps) {
	const busy = useSignal(false)
	const controlError = useSignal<string | undefined>(undefined)
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
	const savedStateStorage = getBrowserStorage('localStorage')
	const initialSavedStateSummary: SavedSimulationStateStorageSummary = getSavedSimulationStateStorageSummary(savedStateStorage)
	const savedStateRecords = useSignal<SavedSimulationStateRecord[]>(initialSavedStateSummary.records)
	const savedStateStorageWarning = useSignal<string | undefined>(initialSavedStateSummary.warning)
	const saveName = useSignal('')
	const exportName = useSignal('')
	const exportStateText = useSignal('')
	const exportInProgress = useSignal(false)
	const { copied, copyError, copyErrorId, copyText } = useCopyToClipboard(exportStateText.value)
	const importStateText = useSignal('')
	const selectedAccount = useSignal(controller.selectedAccount)
	const simulationDetailsOpen = useSignal(controller.bootstrapError !== undefined)
	const bootstrapError = useSignal(controller.bootstrapError)
	const bootstrapLabel = useSignal(controller.bootstrapLabel)
	const bootstrapProgress = useSignal(controller.bootstrapProgress)
	const transactionCountSinceReset = useSignal(controller.transactionCountSinceReset)
	const walletMode = useSignal(controller.walletMode)
	const transactionDelayMilliseconds = useSignal(controller.transactionDelayMilliseconds.toString())
	const previousController = useRef(controller)
	const currentController = useRef(controller)
	const operationRequestGeneration = useRef(0)
	const navigationRequestGeneration = useRef(0)
	const navigationInProgress = useRef(false)
	const navigationOperation = useSignal<NavigationOperation | undefined>(undefined)
	if (currentController.current !== controller) {
		currentController.current = controller
		operationRequestGeneration.current += 1
	}

	useLayoutEffect(() => {
		if (!navigationInProgress.current) busy.value = false
		controlError.value = undefined
		modal.value = undefined
		savedStateError.value = undefined
		exportStateText.value = ''
		exportInProgress.value = false
		if (!navigationInProgress.current) navigationOperation.value = undefined
	}, [controller])

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
	const syncControllerState = () => {
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
		walletMode.value = controller.walletMode
	}
	const startOperation = () => {
		operationRequestGeneration.current += 1
		const requestGeneration = operationRequestGeneration.current
		const requestController = controller
		return () => requestGeneration === operationRequestGeneration.current && requestController === currentController.current
	}
	const startNavigationOperation = () => {
		navigationRequestGeneration.current += 1
		const requestGeneration = navigationRequestGeneration.current
		const requestController = controller
		return {
			isCurrentRequest: () => requestGeneration === navigationRequestGeneration.current,
			isOriginControllerCurrent: () => requestController === currentController.current,
		}
	}
	useEffect(() => {
		let controllerChanged = previousController.current !== controller
		previousController.current = controller
		if (controllerChanged) controlError.value = undefined
		const handleControllerState = () => {
			syncControllerState()
			// The strip shows boot progress inline, so the details panel stays collapsed unless the scenario fails to boot.
			if (controller.bootstrapError !== undefined) simulationDetailsOpen.value = true
			else if (controllerChanged) simulationDetailsOpen.value = false
			controllerChanged = false
		}
		handleControllerState()
		return controller.subscribe(handleControllerState)
	}, [controller])
	const runControl = async (work: () => Promise<void>) => {
		if (busy.value) return
		const isCurrentRequest = startOperation()
		busy.value = true
		controlError.value = undefined
		try {
			await work()
			if (!isCurrentRequest()) return
			await onRefresh()
		} catch (error) {
			if (!isCurrentRequest()) return
			syncControllerState()
			controlError.value = getErrorMessage(error, simulationCopy.simulationControlError)
		} finally {
			if (isCurrentRequest()) busy.value = false
		}
	}
	const commitPrice = (parsedPrice: bigint | undefined, resetInput: () => void, setPrice: (price: bigint) => Promise<void>) => {
		if (parsedPrice === undefined) {
			resetInput()
			return
		}
		void runControl(async () => {
			await setPrice(parsedPrice)
		})
	}
	const runNavigationControl = async (operation: NavigationOperation, work: (ownership: ReturnType<typeof startNavigationOperation>) => Promise<void>) => {
		if (busy.value) return
		const ownership = startNavigationOperation()
		navigationInProgress.current = true
		navigationOperation.value = operation
		busy.value = true
		savedStateError.value = undefined
		try {
			await work(ownership)
		} catch (error) {
			if (!ownership.isCurrentRequest()) return
			savedStateError.value = getErrorMessage(error, simulationCopy.savedStateUpdateError)
			simulationDetailsOpen.value = true
		} finally {
			if (ownership.isCurrentRequest()) {
				navigationInProgress.current = false
				navigationOperation.value = undefined
				busy.value = false
			}
		}
	}

	const refreshEnvironmentAtLocation = async (nextUrl: string) => {
		await refreshEnvironmentAtSimulationLocation(nextUrl, onEnvironmentChanged)
	}

	const navigateAndRefreshEnvironment = async (getNextLocation: () => string) => {
		await runNavigationControl('navigation', async () => {
			await refreshEnvironmentAtLocation(getNextLocation())
		})
	}

	const persistAndNavigateToSavedState = async (serialized: string) => {
		const record = persistSavedSimulationState(serialized, savedStateStorage)
		reloadSavedStateRecords()
		await refreshEnvironmentAtLocation(getSavedSimulationStateLocation(record.id))
	}

	const exportNamedState = async (name: string, isCurrentRequest: () => boolean) => {
		savedStateError.value = undefined
		exportInProgress.value = true
		try {
			const serialized = await controller.exportState(name)
			if (!isCurrentRequest()) return
			exportStateText.value = serialized
		} catch (error) {
			if (!isCurrentRequest()) return
			savedStateError.value = getErrorMessage(error, simulationCopy.stateExportError)
		} finally {
			if (isCurrentRequest()) exportInProgress.value = false
		}
	}

	const showExportModal = async () => {
		if (exportInProgress.value) return
		const isCurrentRequest = startOperation()
		const nextName = getDefaultSavedStateName()
		exportName.value = nextName
		exportStateText.value = ''
		modal.value = 'export'
		await exportNamedState(nextName, isCurrentRequest)
	}

	const refreshExport = async () => {
		if (exportInProgress.value) return
		await exportNamedState(exportName.value, startOperation())
	}

	let scenarioDetail = bootstrapError.value
	if (scenarioDetail === undefined) {
		const savedAtMilliseconds = currentSource.value.kind === 'saved-state' ? Date.parse(currentSource.value.savedAt) : undefined
		const savedAtTimestamp = savedAtMilliseconds === undefined || Number.isNaN(savedAtMilliseconds) ? undefined : BigInt(Math.floor(savedAtMilliseconds / 1_000))
		scenarioDetail =
			currentSource.value.kind === 'saved-state' && savedAtTimestamp !== undefined ? simulationCopy.formatSavedStateDetail(currentSource.value.name, getSimulationScenarioLabel(currentSource.value.baseScenario), formatTimestampWithRelative(savedAtTimestamp)) : getSimulationScenarioDescription(currentScenario.value)
	}
	const scenarioStatus = getScenarioStatus({
		bootstrapError: bootstrapError.value,
		isBootstrapped: isBootstrapped.value,
	})
	const selectedAccountIndex = controller.accounts.findIndex(account => account === selectedAccount.value)
	const selectedAccountLabel = walletMode.value === 'disconnected' ? appCopy.qaAccountDisconnected : getSimulationAccountOptionLabel(selectedAccountIndex < 0 ? 0 : selectedAccountIndex)

	return (
		<section className='panel contract-panel simulation-banner'>
			<details
				className='simulation-banner-details'
				open={simulationDetailsOpen.value}
				onToggle={event => {
					simulationDetailsOpen.value = event.currentTarget.open
				}}
			>
				<SimulationStripSummary
					accountLabel={selectedAccountLabel}
					bootstrapLabel={bootstrapLabel.value}
					bootstrapProgress={bootstrapProgress.value}
					bootstrapping={bootstrapError.value === undefined && isBootstrapping.value}
					detailsOpen={simulationDetailsOpen.value}
					scenarioLabel={getSimulationScenarioLabel(currentScenario.value)}
					status={scenarioStatus}
				/>
				<div className='contract-list simulation-banner-list'>
					<div className='contract-row simulation-banner-row'>
						<div className='contract-copy'>
							<div className='contract-topline'>
								<Badge tone={scenarioStatus.badgeTone}>{scenarioStatus.label}</Badge>
								<h3>{simulationCopy.scenario}</h3>
							</div>
							<p className='detail'>{scenarioDetail}</p>
							{savedStateStorageWarning.value === undefined ? undefined : <p className='detail'>{savedStateStorageWarning.value}</p>}
							{modal.value === undefined ? <ErrorNotice message={savedStateError.value} /> : undefined}
						</div>
						<select
							className='simulation-control-select'
							aria-label={simulationCopy.simulationScenario}
							value={currentSource.value.kind === 'saved-state' ? `saved:${currentSource.value.stateId}` : `scenario:${currentScenario.value}`}
							disabled={busy.value || isBootstrapping.value}
							onChange={event => {
								const nextSelection = event.currentTarget.value
								if (nextSelection.startsWith('saved:')) {
									void navigateAndRefreshEnvironment(() => getSavedSimulationStateLocation(nextSelection.slice('saved:'.length)))
									return
								}
								void navigateAndRefreshEnvironment(() => getBuiltInScenarioLocation(nextSelection.slice('scenario:'.length)))
							}}
						>
							<optgroup label={simulationCopy.builtInScenarios}>
								{getRegisteredSimulationScenarios().map(scenario => (
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
					<SimulationAccountControls
						accounts={controller.accounts}
						disabled={busy.value || !isBootstrapped.value}
						selectedAccount={selectedAccount.value}
						onAccountChange={nextAccount => {
							void runControl(async () => {
								await controller.selectAccount(nextAccount)
							})
						}}
					/>
					<SimulationWalletControls
						disabled={busy.value || !isBootstrapped.value}
						mode={walletMode.value}
						onModeChange={nextMode => {
							void runControl(async () => {
								await controller.setWalletMode(nextMode)
							})
						}}
					/>
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
									<SimulationControlField kind='milliseconds' label={simulationCopy.queryDelayMs} value={queryDelayMilliseconds} disabled={busy.value} onCommit={input => void runControl(async () => await controller.setQueryDelayMilliseconds(Number(input)))} />
									<SimulationControlField kind='decimal' label={simulationCopy.repEthMockPrice} value={repPerEthPrice} disabled={busy.value} onCommit={input => commitPrice(tryParseDecimalInput(input), resetRepPerEthPriceInput, async price => await controller.setRepPerEthPrice(price))} />
									<SimulationControlField kind='decimal' label={simulationCopy.repUsdcMockPrice} value={repPerUsdcPrice} disabled={busy.value} onCommit={input => commitPrice(tryParseDecimalInput(input, 6), resetRepPerUsdcPriceInput, async price => await controller.setRepPerUsdcPrice(price))} />
									<SimulationControlField kind='milliseconds' label={simulationCopy.transactionReceiptDelayMs} value={transactionDelayMilliseconds} disabled={busy.value} onCommit={input => void runControl(async () => await controller.setTransactionDelayMilliseconds(Number(input)))} />
								</div>
								<p className='detail'>{simulationCopy.simulationControlHelpText}</p>
								<ErrorNotice message={controlError.value} />
							</div>
							<div className='simulation-control-groups'>
								<div className='simulation-control-group'>
									<span className='simulation-control-group-label'>{simulationCopy.actions}</span>
									<div className='button-row simulation-button-row'>
										<button className='secondary' onClick={() => void runControl(async () => await controller.reset())} disabled={busy.value || !isBootstrapped.value}>
											{simulationCopy.resetScenario}
										</button>
										<button className='secondary' onClick={() => void runControl(async () => await controller.advanceBlock())} disabled={busy.value || !isBootstrapped.value}>
											{simulationCopy.advanceBlock}
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
										<button className='secondary' onClick={() => void showExportModal()} disabled={busy.value || exportInProgress.value || !isBootstrapped.value}>
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
			<OperationModal closeDisabled={busy.value} isOpen={modal.value === 'save'} onClose={closeModal} title={simulationCopy.saveSimulationState}>
				<SimulationNameField id='simulation-save-name' label={simulationCopy.stateName} value={saveName} disabled={busy.value} />
				<ErrorNotice message={savedStateError.value} />
				<div className='actions'>
					<button
						type='button'
						disabled={busy.value}
						onClick={() =>
							void runNavigationControl('save', async ownership => {
								const serialized = await controller.exportState(saveName.value)
								if (!ownership.isCurrentRequest() || !ownership.isOriginControllerCurrent()) return
								await persistAndNavigateToSavedState(serialized)
							})
						}
					>
						{navigationOperation.value === 'save' ? simulationCopy.savingState : simulationCopy.save}
					</button>
				</div>
			</OperationModal>
			<OperationModal closeDisabled={exportInProgress.value} isOpen={modal.value === 'export'} onClose={closeModal} title={simulationCopy.exportSimulationState}>
				<SimulationNameField id='simulation-export-name' label={simulationCopy.exportName} value={exportName} disabled={exportInProgress.value} />
				<div className='field'>
					<label htmlFor='simulation-export-json'>{simulationCopy.jsonState}</label>
					<textarea id='simulation-export-json' aria-busy={exportInProgress.value || undefined} rows={14} value={exportStateText.value} readOnly />
				</div>
				<ErrorNotice message={savedStateError.value} />
				<div className='actions'>
					<button type='button' className='secondary' disabled={exportInProgress.value} onClick={() => void refreshExport()}>
						{exportInProgress.value ? simulationCopy.exportingState : simulationCopy.refreshExport}
					</button>
					<button type='button' className='secondary' disabled={exportInProgress.value || exportStateText.value.trim() === ''} aria-describedby={copyError.value === undefined ? undefined : copyErrorId} onClick={() => void copyText(exportStateText.value)}>
						{copied.value ? commonCopy.copied : simulationCopy.copyJson}
					</button>
				</div>
				<CopyErrorMessage id={copyErrorId} message={copyError.value} />
			</OperationModal>
			<OperationModal closeDisabled={busy.value} isOpen={modal.value === 'import'} onClose={closeModal} title={simulationCopy.importSimulationState}>
				<div className='field'>
					<label htmlFor='simulation-import-json'>{simulationCopy.jsonState}</label>
					<textarea id='simulation-import-json' rows={14} value={importStateText.value} disabled={busy.value} onInput={event => (importStateText.value = event.currentTarget.value)} />
				</div>
				<ErrorNotice message={savedStateError.value} />
				<div className='actions'>
					<button
						type='button'
						disabled={busy.value}
						onClick={() =>
							void runNavigationControl('import', async () => {
								await persistAndNavigateToSavedState(importStateText.value)
							})
						}
					>
						{navigationOperation.value === 'import' ? simulationCopy.importingState : simulationCopy.importAndLoad}
					</button>
				</div>
			</OperationModal>
			<OperationModal closeDisabled={busy.value} isOpen={modal.value === 'delete'} onClose={closeModal} title={simulationCopy.deleteSavedSimulationState}>
				<p className='detail'>{currentSource.value.kind === 'saved-state' ? simulationCopy.formatDeleteSavedSimulationStateDetail(currentSource.value.name) : simulationCopy.builtInScenarioDeletionReason}</p>
				<ErrorNotice message={savedStateError.value} />
				<div className='actions'>
					<button
						type='button'
						className='destructive'
						disabled={busy.value || currentSource.value.kind !== 'saved-state'}
						onClick={() =>
							void runNavigationControl('delete', async () => {
								if (currentSource.value.kind !== 'saved-state') return
								const stateId = currentSource.value.stateId
								const stateName = currentSource.value.name
								const baseScenario = currentSource.value.baseScenario
								await refreshEnvironmentAtLocation(getBuiltInScenarioLocation(baseScenario))
								if (!deleteSavedSimulationState(stateId, savedStateStorage)) throw new Error(simulationCopy.formatMissingSavedStateError(stateName))
								reloadSavedStateRecords()
							})
						}
					>
						{busy.value ? simulationCopy.deletingSave : simulationCopy.deleteSave}
					</button>
				</div>
			</OperationModal>
			<OperationModal isOpen={modal.value === 'cleanup'} onClose={closeModal} title={simulationCopy.removeCorruptedSaves}>
				<p className='detail'>{simulationCopy.invalidSavedStateCleanupHint}</p>
				{savedStateStorageWarning.value === undefined ? undefined : <p className='detail'>{savedStateStorageWarning.value}</p>}
				<ErrorNotice message={savedStateError.value} />
				<div className='actions'>
					<button
						type='button'
						className='destructive'
						onClick={() => {
							closeModal()
							savedStateStorageWarning.value = undefined
							void runNavigationControl('cleanup', async () => {
								const removedCount = removeCorruptedSavedSimulationStates(savedStateStorage)
								if (removedCount === 0) throw new Error(simulationCopy.corruptedSavesEmptyError)
								clearSavedStateStorageWarning()
								if (hasSavedSimulationStateRoute()) {
									await refreshEnvironmentAtLocation(getBuiltInScenarioLocation(currentScenario.value))
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
