import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import * as simulationCopy from '../copy/simulation.js';
import { useSignal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { getErrorMessage } from '../lib/errors.js';
import { SIMULATION_QUERY_PARAM, SIMULATION_QUERY_VALUE } from '../lib/activeEnvironment.js';
import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch } from '../lib/routing.js';
import { tryParseDecimalInput } from '../lib/decimal.js';
import { formatCurrencyInputBalance } from '../lib/formatters.js';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js';
import { getBrowserStorage } from '../lib/browserStorage.js';
import { getRegisteredSimulationScenarios, getSimulationScenarioDescription, getSimulationScenarioLabel } from '../simulation/scenarios.js';
import { deleteSavedSimulationState, getSavedSimulationStateStorageSummary, persistSavedSimulationState, removeCorruptedSavedSimulationStates } from '../simulation/savedStates.js';
import { OperationModal } from './OperationModal.js';
import { AddressValue } from './AddressValue.js';
import { TimestampValue } from './TimestampValue.js';
import { Badge } from './Badge.js';
import { ErrorNotice } from './ErrorNotice.js';
import { CopyErrorMessage } from './CopyErrorMessage.js';
const SIMULATION_TIME_PRESETS = [
    { label: simulationCopy.plus1Hour, seconds: 60n * 60n },
    { label: simulationCopy.plus1Day, seconds: 24n * 60n * 60n },
    { label: simulationCopy.plus1Week, seconds: 7n * 24n * 60n * 60n },
    { label: simulationCopy.plus1Month, seconds: 30n * 24n * 60n * 60n },
    { label: simulationCopy.plus1Year, seconds: 365n * 24n * 60n * 60n },
];
const SIMULATION_REP_MINT_AMOUNT = 1000000n * 10n ** 18n;
function buildSimulationSearch(update) {
    const params = new URLSearchParams(getRouteHashSearch());
    params.set(SIMULATION_QUERY_PARAM, SIMULATION_QUERY_VALUE);
    update(params);
    const nextSearch = params.toString();
    return nextSearch === '' ? '' : `?${nextSearch}`;
}
function getSimulationLocation(nextSearch) {
    return new URL(buildRouteHref(getCurrentRouteHash(), nextSearch), window.location.href).toString();
}
function stageSimulationLocation(nextUrl) {
    window.history.replaceState({}, '', nextUrl);
    window.dispatchEvent(new window.PopStateEvent('popstate'));
}
function restoreSimulationLocation(previousUrl) {
    window.history.replaceState({}, '', previousUrl);
    window.dispatchEvent(new window.PopStateEvent('popstate'));
}
function commitSimulationLocation(previousUrl, nextUrl) {
    window.history.replaceState({}, '', previousUrl);
    window.history.pushState({}, '', nextUrl);
}
function getBuiltInScenarioLocation(scenario) {
    const nextSearch = buildSimulationSearch(params => {
        params.set('simScenario', scenario);
        params.delete('simState');
    });
    return getSimulationLocation(nextSearch);
}
function getSavedSimulationStateLocation(stateId) {
    const nextSearch = buildSimulationSearch(params => {
        params.delete('simScenario');
        params.set('simState', stateId);
    });
    return getSimulationLocation(nextSearch);
}
function hasSavedSimulationStateRoute() {
    const params = new URLSearchParams(getRouteHashSearch());
    const stateId = params.get('simState');
    return stateId !== null && stateId.trim() !== '';
}
function getSimulationAccountOptionLabel(accountIndex) {
    return simulationCopy.formatQaAccountNumber((accountIndex + 1).toString());
}
function getScenarioStatus(parameters) {
    if (parameters.bootstrapError !== undefined) {
        return {
            badgeTone: 'blocked',
            label: commonCopy.error,
        };
    }
    if (parameters.isBootstrapped) {
        return {
            badgeTone: 'ok',
            label: simulationCopy.ready,
        };
    }
    return {
        badgeTone: 'pending',
        label: simulationCopy.bootstrapping,
    };
}
export function SimulationBanner({ controller, onEnvironmentChanged = async () => undefined, onRefresh }) {
    const busy = useSignal(false);
    const controlError = useSignal(undefined);
    const blockCountSinceReset = useSignal(controller.blockCountSinceReset);
    const currentTimestamp = useSignal(controller.currentTimestamp);
    const currentScenario = useSignal(controller.currentScenario);
    const currentSource = useSignal(controller.simulationSource);
    const isBootstrapped = useSignal(controller.isBootstrapped);
    const isBootstrapping = useSignal(controller.isBootstrapping);
    const modal = useSignal(undefined);
    const queryDelayMilliseconds = useSignal(controller.queryDelayMilliseconds.toString());
    const repPerEthPrice = useSignal(formatCurrencyInputBalance(controller.repPerEthPrice));
    const repPerUsdcPrice = useSignal(formatCurrencyInputBalance(controller.repPerUsdcPrice, 6));
    const savedStateError = useSignal(undefined);
    const savedStateStorage = getBrowserStorage('localStorage');
    const initialSavedStateSummary = getSavedSimulationStateStorageSummary(savedStateStorage);
    const savedStateRecords = useSignal(initialSavedStateSummary.records);
    const savedStateStorageWarning = useSignal(initialSavedStateSummary.warning);
    const saveName = useSignal('');
    const exportName = useSignal('');
    const exportStateText = useSignal('');
    const exportInProgress = useSignal(false);
    const { copied, copyError, copyErrorId, copyText } = useCopyToClipboard(exportStateText.value);
    const importStateText = useSignal('');
    const selectedAccount = useSignal(controller.selectedAccount);
    const simulationDetailsOpen = useSignal(!controller.isBootstrapped);
    const bootstrapError = useSignal(controller.bootstrapError);
    const bootstrapLabel = useSignal(controller.bootstrapLabel);
    const bootstrapProgress = useSignal(controller.bootstrapProgress);
    const transactionCountSinceReset = useSignal(controller.transactionCountSinceReset);
    const transactionDelayMilliseconds = useSignal(controller.transactionDelayMilliseconds.toString());
    const previousController = useRef(controller);
    const currentController = useRef(controller);
    const operationRequestGeneration = useRef(0);
    const navigationRequestGeneration = useRef(0);
    const navigationInProgress = useRef(false);
    const navigationOperation = useSignal(undefined);
    if (currentController.current !== controller) {
        currentController.current = controller;
        operationRequestGeneration.current += 1;
    }
    useLayoutEffect(() => {
        if (!navigationInProgress.current)
            busy.value = false;
        controlError.value = undefined;
        modal.value = undefined;
        savedStateError.value = undefined;
        exportStateText.value = '';
        exportInProgress.value = false;
        if (!navigationInProgress.current)
            navigationOperation.value = undefined;
    }, [controller]);
    const reloadSavedStateRecords = () => {
        const summary = getSavedSimulationStateStorageSummary(savedStateStorage);
        savedStateRecords.value = summary.records;
        savedStateStorageWarning.value = summary.warning;
    };
    const clearSavedStateStorageWarning = () => {
        const summary = getSavedSimulationStateStorageSummary(savedStateStorage);
        savedStateRecords.value = summary.records;
        savedStateStorageWarning.value = undefined;
    };
    const getDefaultSavedStateName = () => (currentSource.value.kind === 'saved-state' ? currentSource.value.name : `${getSimulationScenarioLabel(currentScenario.value)} ${new Date().toISOString().slice(0, 16)}`);
    const closeModal = () => {
        modal.value = undefined;
        savedStateError.value = undefined;
    };
    const resetRepPerEthPriceInput = () => {
        repPerEthPrice.value = formatCurrencyInputBalance(controller.repPerEthPrice);
    };
    const resetRepPerUsdcPriceInput = () => {
        repPerUsdcPrice.value = formatCurrencyInputBalance(controller.repPerUsdcPrice, 6);
    };
    const syncControllerState = () => {
        blockCountSinceReset.value = controller.blockCountSinceReset;
        bootstrapError.value = controller.bootstrapError;
        bootstrapLabel.value = controller.bootstrapLabel;
        bootstrapProgress.value = controller.bootstrapProgress;
        currentTimestamp.value = controller.currentTimestamp;
        currentScenario.value = controller.currentScenario;
        currentSource.value = controller.simulationSource;
        isBootstrapped.value = controller.isBootstrapped;
        isBootstrapping.value = controller.isBootstrapping;
        queryDelayMilliseconds.value = controller.queryDelayMilliseconds.toString();
        repPerEthPrice.value = formatCurrencyInputBalance(controller.repPerEthPrice);
        repPerUsdcPrice.value = formatCurrencyInputBalance(controller.repPerUsdcPrice, 6);
        selectedAccount.value = controller.selectedAccount;
        transactionCountSinceReset.value = controller.transactionCountSinceReset;
        transactionDelayMilliseconds.value = controller.transactionDelayMilliseconds.toString();
    };
    const startOperation = () => {
        operationRequestGeneration.current += 1;
        const requestGeneration = operationRequestGeneration.current;
        const requestController = controller;
        return () => requestGeneration === operationRequestGeneration.current && requestController === currentController.current;
    };
    const startNavigationOperation = () => {
        navigationRequestGeneration.current += 1;
        const requestGeneration = navigationRequestGeneration.current;
        const requestController = controller;
        return {
            isCurrentRequest: () => requestGeneration === navigationRequestGeneration.current,
            isOriginControllerCurrent: () => requestController === currentController.current,
        };
    };
    useEffect(() => {
        let controllerChanged = previousController.current !== controller;
        previousController.current = controller;
        if (controllerChanged)
            controlError.value = undefined;
        const handleControllerState = () => {
            const wasBootstrapped = isBootstrapped.value;
            syncControllerState();
            if (!controller.isBootstrapped || controller.isBootstrapping)
                simulationDetailsOpen.value = true;
            else if (controllerChanged || !wasBootstrapped)
                simulationDetailsOpen.value = false;
            controllerChanged = false;
        };
        handleControllerState();
        return controller.subscribe(handleControllerState);
    }, [controller]);
    const runControl = async (work) => {
        if (busy.value)
            return;
        const isCurrentRequest = startOperation();
        busy.value = true;
        controlError.value = undefined;
        try {
            await work();
            if (!isCurrentRequest())
                return;
            await onRefresh();
        }
        catch (error) {
            if (!isCurrentRequest())
                return;
            syncControllerState();
            controlError.value = getErrorMessage(error, simulationCopy.simulationControlError);
        }
        finally {
            if (isCurrentRequest())
                busy.value = false;
        }
    };
    const runNavigationControl = async (operation, work) => {
        if (busy.value)
            return;
        const ownership = startNavigationOperation();
        navigationInProgress.current = true;
        navigationOperation.value = operation;
        busy.value = true;
        savedStateError.value = undefined;
        try {
            await work(ownership);
        }
        catch (error) {
            if (!ownership.isCurrentRequest())
                return;
            savedStateError.value = getErrorMessage(error, simulationCopy.savedStateUpdateError);
            simulationDetailsOpen.value = true;
        }
        finally {
            if (ownership.isCurrentRequest()) {
                navigationInProgress.current = false;
                navigationOperation.value = undefined;
                busy.value = false;
            }
        }
    };
    const refreshEnvironmentAtLocation = async (nextUrl) => {
        const previousUrl = window.location.href;
        stageSimulationLocation(nextUrl);
        try {
            await onEnvironmentChanged();
        }
        catch (error) {
            restoreSimulationLocation(previousUrl);
            throw error;
        }
        commitSimulationLocation(previousUrl, nextUrl);
    };
    const navigateAndRefreshEnvironment = async (getNextLocation) => {
        await runNavigationControl('navigation', async () => {
            await refreshEnvironmentAtLocation(getNextLocation());
        });
    };
    const persistAndNavigateToSavedState = async (serialized) => {
        const record = persistSavedSimulationState(serialized, savedStateStorage);
        reloadSavedStateRecords();
        await refreshEnvironmentAtLocation(getSavedSimulationStateLocation(record.id));
    };
    const showExportModal = async () => {
        if (exportInProgress.value)
            return;
        const isCurrentRequest = startOperation();
        const nextName = getDefaultSavedStateName();
        exportName.value = nextName;
        exportStateText.value = '';
        savedStateError.value = undefined;
        modal.value = 'export';
        exportInProgress.value = true;
        try {
            const serialized = await controller.exportState(nextName);
            if (!isCurrentRequest())
                return;
            exportStateText.value = serialized;
        }
        catch (error) {
            if (!isCurrentRequest())
                return;
            savedStateError.value = getErrorMessage(error, simulationCopy.stateExportError);
        }
        finally {
            if (isCurrentRequest())
                exportInProgress.value = false;
        }
    };
    const refreshExport = async () => {
        if (exportInProgress.value)
            return;
        const isCurrentRequest = startOperation();
        savedStateError.value = undefined;
        exportInProgress.value = true;
        try {
            const serialized = await controller.exportState(exportName.value);
            if (!isCurrentRequest())
                return;
            exportStateText.value = serialized;
        }
        catch (error) {
            if (!isCurrentRequest())
                return;
            savedStateError.value = getErrorMessage(error, simulationCopy.stateExportError);
        }
        finally {
            if (isCurrentRequest())
                exportInProgress.value = false;
        }
    };
    let scenarioDetail = bootstrapError.value;
    if (scenarioDetail === undefined) {
        scenarioDetail = currentSource.value.kind === 'saved-state' ? simulationCopy.formatSavedStateDetail(currentSource.value.name, getSimulationScenarioLabel(currentSource.value.baseScenario), new Date(currentSource.value.savedAt).toLocaleString()) : getSimulationScenarioDescription(currentScenario.value);
    }
    const scenarioStatus = getScenarioStatus({
        bootstrapError: bootstrapError.value,
        isBootstrapped: isBootstrapped.value,
    });
    const selectedAccountIndex = controller.accounts.findIndex(account => account === selectedAccount.value);
    const selectedAccountLabel = getSimulationAccountOptionLabel(selectedAccountIndex < 0 ? 0 : selectedAccountIndex);
    return (_jsxs("section", { className: 'panel contract-panel simulation-banner', children: [_jsxs("details", { className: 'simulation-banner-details', open: simulationDetailsOpen.value, onToggle: event => {
                    simulationDetailsOpen.value = event.currentTarget.open;
                }, children: [_jsx("summary", { children: _jsxs("span", { className: 'simulation-banner-compact-summary', children: [_jsxs("span", { className: 'simulation-banner-compact-heading', children: [_jsx("h2", { children: simulationCopy.browserSimulation }), _jsxs("span", { className: 'simulation-banner-compact-state', children: [_jsx(Badge, { tone: scenarioStatus.badgeTone, children: scenarioStatus.label }), _jsx("strong", { children: getSimulationScenarioLabel(currentScenario.value) }), _jsx("span", { className: 'simulation-banner-compact-account', children: selectedAccountLabel })] })] }), _jsx("span", { className: 'simulation-banner-compact-action', children: simulationDetailsOpen.value ? simulationCopy.hideSimulationDetails : simulationCopy.showSimulationDetails })] }) }), _jsxs("div", { className: 'contract-list simulation-banner-list', children: [_jsxs("div", { className: 'contract-row simulation-banner-row', children: [_jsxs("div", { className: 'contract-copy', children: [_jsxs("div", { className: 'contract-topline', children: [_jsx(Badge, { tone: scenarioStatus.badgeTone, children: scenarioStatus.label }), _jsx("h3", { children: simulationCopy.scenario })] }), _jsx("p", { className: 'detail', children: scenarioDetail }), savedStateStorageWarning.value === undefined ? undefined : _jsx("p", { className: 'detail', children: savedStateStorageWarning.value }), modal.value === undefined ? _jsx(ErrorNotice, { message: savedStateError.value }) : undefined, bootstrapError.value === undefined && isBootstrapping.value ? (_jsxs("p", { className: 'detail', children: [_jsx("span", { className: 'spinner', "aria-hidden": 'true' }), bootstrapLabel.value ?? simulationCopy.scenarioPreparationDetail] })) : undefined, isBootstrapping.value ? (_jsx("div", { className: 'notice-progress-track simulation-progress-track', "aria-hidden": 'true', children: _jsx("div", { className: 'notice-progress-fill simulation-progress-fill', style: { width: `${Math.round((bootstrapProgress.value ?? 0.08) * 100)}%` } }) })) : undefined] }), _jsxs("select", { className: 'simulation-control-select', "aria-label": simulationCopy.simulationScenario, value: currentSource.value.kind === 'saved-state' ? `saved:${currentSource.value.stateId}` : `scenario:${currentScenario.value}`, disabled: busy.value || isBootstrapping.value, onChange: event => {
                                            const nextSelection = event.currentTarget.value;
                                            if (nextSelection.startsWith('saved:')) {
                                                void navigateAndRefreshEnvironment(() => getSavedSimulationStateLocation(nextSelection.slice('saved:'.length)));
                                                return;
                                            }
                                            void navigateAndRefreshEnvironment(() => getBuiltInScenarioLocation(nextSelection.slice('scenario:'.length)));
                                        }, children: [_jsx("optgroup", { label: simulationCopy.builtInScenarios, children: getRegisteredSimulationScenarios().map(scenario => (_jsx("option", { value: `scenario:${scenario}`, children: getSimulationScenarioLabel(scenario) }, scenario))) }), savedStateRecords.value.length === 0 ? undefined : (_jsx("optgroup", { label: simulationCopy.savedStates, children: savedStateRecords.value.map(record => (_jsx("option", { value: `saved:${record.id}`, children: record.name }, record.id))) }))] })] }), _jsxs("div", { className: 'contract-row simulation-banner-row', children: [_jsxs("div", { className: 'contract-copy', children: [_jsxs("div", { className: 'contract-topline', children: [_jsx(Badge, { tone: 'ok', children: commonCopy.active }), _jsx("h3", { children: simulationCopy.qaAccount })] }), _jsx(AddressValue, { address: selectedAccount.value })] }), _jsx("select", { className: 'simulation-control-select', "aria-label": simulationCopy.simulationQaAccount, value: selectedAccount.value, disabled: busy.value || !isBootstrapped.value, onChange: event => {
                                            const nextAccount = controller.accounts.find(account => account === event.currentTarget.value);
                                            if (nextAccount === undefined)
                                                return;
                                            void runControl(async () => {
                                                await controller.selectAccount(nextAccount);
                                            });
                                        }, children: controller.accounts.map((account, accountIndex) => (_jsx("option", { value: account, children: getSimulationAccountOptionLabel(accountIndex) }, account))) })] }), _jsxs("div", { className: 'simulation-banner-stats', children: [_jsxs("div", { className: 'simulation-stat-card', children: [_jsx("span", { className: 'simulation-stat-label', children: simulationCopy.blocks }), _jsx("strong", { children: blockCountSinceReset.value.toString() })] }), _jsxs("div", { className: 'simulation-stat-card', children: [_jsx("span", { className: 'simulation-stat-label', children: simulationCopy.transactions }), _jsx("strong", { children: transactionCountSinceReset.value.toString() })] }), _jsxs("div", { className: 'simulation-stat-card simulation-stat-card-wide', children: [_jsx("span", { className: 'simulation-stat-label', children: simulationCopy.blockchainTime }), _jsx("strong", { children: _jsx(TimestampValue, { currentTimestamp: currentTimestamp.value, timestamp: currentTimestamp.value }) })] })] }), _jsxs("details", { className: 'simulation-advanced-controls', children: [_jsx("summary", { children: simulationCopy.qaControlsPricesAndTimeTravel }), _jsxs("div", { className: 'simulation-banner-controls', children: [_jsxs("div", { className: 'contract-copy', children: [_jsxs("div", { className: 'simulation-delay-grid', children: [_jsxs("label", { className: 'simulation-delay-field', children: [_jsx("span", { className: 'simulation-delay-label', children: simulationCopy.queryDelayMs }), _jsx("input", { className: 'simulation-control-input', type: 'number', min: '0', step: '100', inputMode: 'numeric', value: queryDelayMilliseconds.value, disabled: busy.value, onInput: event => {
                                                                            queryDelayMilliseconds.value = event.currentTarget.value;
                                                                        }, onChange: event => {
                                                                            void runControl(async () => await controller.setQueryDelayMilliseconds(Number(event.currentTarget.value)));
                                                                        } })] }), _jsxs("label", { className: 'simulation-delay-field', children: [_jsx("span", { className: 'simulation-delay-label', children: simulationCopy.repEthMockPrice }), _jsx("input", { className: 'simulation-control-input', type: 'text', inputMode: 'decimal', value: repPerEthPrice.value, disabled: busy.value, onInput: event => {
                                                                            repPerEthPrice.value = event.currentTarget.value;
                                                                        }, onChange: event => {
                                                                            const parsedPrice = tryParseDecimalInput(event.currentTarget.value);
                                                                            if (parsedPrice === undefined) {
                                                                                resetRepPerEthPriceInput();
                                                                                return;
                                                                            }
                                                                            void runControl(async () => {
                                                                                await controller.setRepPerEthPrice(parsedPrice);
                                                                            });
                                                                        } })] }), _jsxs("label", { className: 'simulation-delay-field', children: [_jsx("span", { className: 'simulation-delay-label', children: simulationCopy.repUsdcMockPrice }), _jsx("input", { className: 'simulation-control-input', type: 'text', inputMode: 'decimal', value: repPerUsdcPrice.value, disabled: busy.value, onInput: event => {
                                                                            repPerUsdcPrice.value = event.currentTarget.value;
                                                                        }, onChange: event => {
                                                                            const parsedPrice = tryParseDecimalInput(event.currentTarget.value, 6);
                                                                            if (parsedPrice === undefined) {
                                                                                resetRepPerUsdcPriceInput();
                                                                                return;
                                                                            }
                                                                            void runControl(async () => {
                                                                                await controller.setRepPerUsdcPrice(parsedPrice);
                                                                            });
                                                                        } })] }), _jsxs("label", { className: 'simulation-delay-field', children: [_jsx("span", { className: 'simulation-delay-label', children: simulationCopy.transactionReceiptDelayMs }), _jsx("input", { className: 'simulation-control-input', type: 'number', min: '0', step: '100', inputMode: 'numeric', value: transactionDelayMilliseconds.value, disabled: busy.value, onInput: event => {
                                                                            transactionDelayMilliseconds.value = event.currentTarget.value;
                                                                        }, onChange: event => {
                                                                            void runControl(async () => await controller.setTransactionDelayMilliseconds(Number(event.currentTarget.value)));
                                                                        } })] })] }), _jsx("p", { className: 'detail', children: simulationCopy.simulationControlHelpText }), _jsx(ErrorNotice, { message: controlError.value })] }), _jsxs("div", { className: 'simulation-control-groups', children: [_jsxs("div", { className: 'simulation-control-group', children: [_jsx("span", { className: 'simulation-control-group-label', children: simulationCopy.actions }), _jsxs("div", { className: 'button-row simulation-button-row', children: [_jsx("button", { className: 'secondary', onClick: () => void runControl(async () => await controller.reset()), disabled: busy.value || !isBootstrapped.value, children: simulationCopy.resetScenario }), _jsx("button", { className: 'secondary', onClick: () => void runControl(async () => await controller.mineBlock()), disabled: busy.value || !isBootstrapped.value, children: simulationCopy.mineBlock }), _jsx("button", { className: 'secondary', onClick: () => void runControl(async () => await controller.mintRep(SIMULATION_REP_MINT_AMOUNT)), disabled: busy.value || !isBootstrapped.value, children: simulationCopy.mint1MillionRep }), _jsx("button", { className: 'secondary', onClick: () => {
                                                                            saveName.value = getDefaultSavedStateName();
                                                                            savedStateError.value = undefined;
                                                                            modal.value = 'save';
                                                                        }, disabled: busy.value || !isBootstrapped.value, children: simulationCopy.saveState }), _jsx("button", { className: 'secondary', onClick: () => void showExportModal(), disabled: busy.value || exportInProgress.value || !isBootstrapped.value, children: simulationCopy.exportState }), _jsx("button", { className: 'secondary', onClick: () => {
                                                                            importStateText.value = '';
                                                                            savedStateError.value = undefined;
                                                                            modal.value = 'import';
                                                                        }, disabled: busy.value, children: simulationCopy.importState }), savedStateStorageWarning.value === undefined ? undefined : (_jsx("button", { className: 'destructive', onClick: () => {
                                                                            savedStateError.value = undefined;
                                                                            modal.value = 'cleanup';
                                                                        }, disabled: busy.value, children: simulationCopy.removeCorruptedSaves })), currentSource.value.kind !== 'saved-state' ? undefined : (_jsx("button", { className: 'destructive', onClick: () => {
                                                                            savedStateError.value = undefined;
                                                                            modal.value = 'delete';
                                                                        }, disabled: busy.value, children: simulationCopy.deleteSave }))] })] }), _jsxs("div", { className: 'simulation-control-group', children: [_jsx("span", { className: 'simulation-control-group-label', children: simulationCopy.timeTravel }), _jsx("div", { className: 'button-row simulation-button-row simulation-time-travel-row', children: SIMULATION_TIME_PRESETS.map(preset => (_jsx("button", { className: 'secondary', onClick: () => void runControl(async () => await controller.advanceTime(preset.seconds)), disabled: busy.value || !isBootstrapped.value, children: preset.label }, preset.label))) })] })] })] })] })] })] }), _jsxs(OperationModal, { closeDisabled: busy.value, isOpen: modal.value === 'save', onClose: closeModal, title: simulationCopy.saveSimulationState, children: [_jsxs("div", { className: 'field', children: [_jsx("label", { htmlFor: 'simulation-save-name', children: simulationCopy.stateName }), _jsx("input", { id: 'simulation-save-name', className: 'simulation-control-input', type: 'text', value: saveName.value, disabled: busy.value, onInput: event => (saveName.value = event.currentTarget.value) })] }), _jsx(ErrorNotice, { message: savedStateError.value }), _jsx("div", { className: 'actions', children: _jsx("button", { type: 'button', disabled: busy.value, onClick: () => void runNavigationControl('save', async (ownership) => {
                                const serialized = await controller.exportState(saveName.value);
                                if (!ownership.isCurrentRequest() || !ownership.isOriginControllerCurrent())
                                    return;
                                await persistAndNavigateToSavedState(serialized);
                            }), children: navigationOperation.value === 'save' ? simulationCopy.savingState : simulationCopy.save }) })] }), _jsxs(OperationModal, { closeDisabled: exportInProgress.value, isOpen: modal.value === 'export', onClose: closeModal, title: simulationCopy.exportSimulationState, children: [_jsxs("div", { className: 'field', children: [_jsx("label", { htmlFor: 'simulation-export-name', children: simulationCopy.exportName }), _jsx("input", { id: 'simulation-export-name', className: 'simulation-control-input', type: 'text', value: exportName.value, disabled: exportInProgress.value, onInput: event => (exportName.value = event.currentTarget.value) })] }), _jsxs("div", { className: 'field', children: [_jsx("label", { htmlFor: 'simulation-export-json', children: simulationCopy.jsonState }), _jsx("textarea", { id: 'simulation-export-json', "aria-busy": exportInProgress.value || undefined, rows: 14, value: exportStateText.value, readOnly: true })] }), _jsx(ErrorNotice, { message: savedStateError.value }), _jsxs("div", { className: 'actions', children: [_jsx("button", { type: 'button', className: 'secondary', disabled: exportInProgress.value, onClick: () => void refreshExport(), children: exportInProgress.value ? simulationCopy.exportingState : simulationCopy.refreshExport }), _jsx("button", { type: 'button', className: 'secondary', disabled: exportInProgress.value || exportStateText.value.trim() === '', "aria-describedby": copyError.value === undefined ? undefined : copyErrorId, onClick: () => void copyText(exportStateText.value), children: copied.value ? commonCopy.copied : simulationCopy.copyJson })] }), _jsx(CopyErrorMessage, { id: copyErrorId, message: copyError.value })] }), _jsxs(OperationModal, { closeDisabled: busy.value, isOpen: modal.value === 'import', onClose: closeModal, title: simulationCopy.importSimulationState, children: [_jsxs("div", { className: 'field', children: [_jsx("label", { htmlFor: 'simulation-import-json', children: simulationCopy.jsonState }), _jsx("textarea", { id: 'simulation-import-json', rows: 14, value: importStateText.value, disabled: busy.value, onInput: event => (importStateText.value = event.currentTarget.value) })] }), _jsx(ErrorNotice, { message: savedStateError.value }), _jsx("div", { className: 'actions', children: _jsx("button", { type: 'button', disabled: busy.value, onClick: () => void runNavigationControl('import', async () => {
                                await persistAndNavigateToSavedState(importStateText.value);
                            }), children: navigationOperation.value === 'import' ? simulationCopy.importingState : simulationCopy.importAndLoad }) })] }), _jsxs(OperationModal, { closeDisabled: busy.value, isOpen: modal.value === 'delete', onClose: closeModal, title: simulationCopy.deleteSavedSimulationState, children: [_jsx("p", { className: 'detail', children: currentSource.value.kind === 'saved-state' ? simulationCopy.formatDeleteSavedSimulationStateDetail(currentSource.value.name) : simulationCopy.builtInScenarioDeletionReason }), _jsx(ErrorNotice, { message: savedStateError.value }), _jsx("div", { className: 'actions', children: _jsx("button", { type: 'button', className: 'destructive', disabled: busy.value || currentSource.value.kind !== 'saved-state', onClick: () => void runNavigationControl('delete', async () => {
                                if (currentSource.value.kind !== 'saved-state')
                                    return;
                                const stateId = currentSource.value.stateId;
                                const stateName = currentSource.value.name;
                                const baseScenario = currentSource.value.baseScenario;
                                await refreshEnvironmentAtLocation(getBuiltInScenarioLocation(baseScenario));
                                if (!deleteSavedSimulationState(stateId, savedStateStorage))
                                    throw new Error(simulationCopy.formatMissingSavedStateError(stateName));
                                reloadSavedStateRecords();
                            }), children: busy.value ? simulationCopy.deletingSave : simulationCopy.deleteSave }) })] }), _jsxs(OperationModal, { isOpen: modal.value === 'cleanup', onClose: closeModal, title: simulationCopy.removeCorruptedSavedStatesTitle, children: [_jsx("p", { className: 'detail', children: simulationCopy.invalidSavedStateCleanupHint }), savedStateStorageWarning.value === undefined ? undefined : _jsx("p", { className: 'detail', children: savedStateStorageWarning.value }), _jsx(ErrorNotice, { message: savedStateError.value }), _jsx("div", { className: 'actions', children: _jsx("button", { type: 'button', className: 'destructive', onClick: () => {
                                closeModal();
                                savedStateStorageWarning.value = undefined;
                                void runNavigationControl('cleanup', async () => {
                                    const removedCount = removeCorruptedSavedSimulationStates(savedStateStorage);
                                    if (removedCount === 0)
                                        throw new Error(simulationCopy.corruptedSavesEmptyError);
                                    clearSavedStateStorageWarning();
                                    if (hasSavedSimulationStateRoute()) {
                                        await refreshEnvironmentAtLocation(getBuiltInScenarioLocation(currentScenario.value));
                                        return;
                                    }
                                });
                            }, children: simulationCopy.removeCorruptedSaves }) })] })] }));
}
//# sourceMappingURL=SimulationBanner.js.map