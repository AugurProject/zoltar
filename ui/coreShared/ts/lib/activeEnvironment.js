import { createInjectedBackend } from './chainBackend.js';
import { getErrorMessage } from './errors.js';
import { getPublicNetworkProfile, getPublicNetworkProfileForChainId, MAINNET_NETWORK_PROFILE, resetRuntimeNetworkProfile, setRuntimeNetworkProfile } from './networkProfile.js';
import { getSavedSimulationStateEnvelope } from '../simulation/savedStates.js';
import { createSimulationBackend } from '../simulation/tevmBackend.js';
import { getRegisteredSimulationScenarios } from '../simulation/scenarios.js';
const defaultInjectedBackend = createInjectedBackend();
let activeBackend = undefined;
let activeSimulationController = undefined;
let initializeActiveEnvironmentGeneration = 0;
const SIMULATION_QUERY_PARAM = 'simulate';
const SIMULATION_QUERY_VALUE = '1';
const NETWORK_QUERY_PARAM = 'network';
const defaultInitializeActiveEnvironmentDependencies = {
    createInjectedBackend,
    createSimulationBackend,
};
function readLocationParams(location) {
    const params = new URLSearchParams(location.search);
    const hash = location.hash ?? '';
    const queryIndex = hash.indexOf('?');
    if (queryIndex === -1)
        return params;
    for (const [key, value] of new URLSearchParams(hash.slice(queryIndex))) {
        params.set(key, value);
    }
    return params;
}
export function shouldUseSimulationLocation(location) {
    const params = readLocationParams(location);
    // Simulation mode is intentionally available as a public URL opt-in on any hostname,
    // including production deployments. It boots a browser-local chain instead of
    // granting privileged access to production state.
    return params.get(SIMULATION_QUERY_PARAM) === SIMULATION_QUERY_VALUE;
}
export function shouldFollowWalletNetwork(location = window.location) {
    return !shouldUseSimulationLocation(location) && !readLocationParams(location).has(NETWORK_QUERY_PARAM);
}
function getSimulationScenario(location) {
    const raw = readLocationParams(location).get('simScenario') ?? undefined;
    if (raw === undefined)
        return 'baseline';
    return getRegisteredSimulationScenarios().includes(raw) ? raw : 'baseline';
}
function getSimulationStateId(location) {
    const params = readLocationParams(location);
    const stateId = params.get('simState');
    return stateId === null || stateId.trim() === '' ? undefined : stateId;
}
export async function initializeActiveEnvironment(location = window.location, dependencies = defaultInitializeActiveEnvironmentDependencies, options = {}) {
    initializeActiveEnvironmentGeneration += 1;
    const requestGeneration = initializeActiveEnvironmentGeneration;
    const previousSimulationController = activeSimulationController;
    if (!shouldUseSimulationLocation(location)) {
        const createBackend = dependencies.createInjectedBackend ?? createInjectedBackend;
        const requestedNetwork = readLocationParams(location).get(NETWORK_QUERY_PARAM);
        let profile = requestedNetwork === null ? undefined : getPublicNetworkProfile(requestedNetwork);
        let injectedBackend = createBackend({ profile: profile ?? MAINNET_NETWORK_PROFILE });
        if (profile === undefined) {
            try {
                profile = getPublicNetworkProfileForChainId(await injectedBackend.getChainId());
            }
            catch (error) {
                void error;
                // A missing, locked, or unavailable wallet leaves Mainnet as the public default.
            }
            if (profile !== undefined && profile !== injectedBackend.profile)
                injectedBackend = createBackend({ profile });
        }
        if (options.shouldCommit?.() === false || requestGeneration !== initializeActiveEnvironmentGeneration)
            return getActiveBackend();
        activeBackend = injectedBackend;
        setRuntimeNetworkProfile(injectedBackend.profile);
        activeSimulationController = undefined;
        if (previousSimulationController !== undefined) {
            try {
                await previousSimulationController.dispose();
            }
            catch (error) {
                console.error('[simulation] failed to dispose previous environment', error);
            }
        }
        return getActiveBackend();
    }
    const savedStateId = getSimulationStateId(location);
    let initialBootstrapError = undefined;
    let savedState = undefined;
    if (savedStateId !== undefined) {
        try {
            savedState = getSavedSimulationStateEnvelope(savedStateId);
        }
        catch (error) {
            initialBootstrapError = `Saved simulation state "${savedStateId}" could not be loaded. ${getErrorMessage(error, 'The saved state is invalid')}. Falling back to the baseline scenario.`;
        }
        if (savedState === undefined && initialBootstrapError === undefined) {
            initialBootstrapError = `Saved simulation state "${savedStateId}" could not be loaded. Falling back to the baseline scenario.`;
        }
    }
    const simulationBackend = savedStateId !== undefined && savedState !== undefined
        ? await dependencies.createSimulationBackend({
            savedState,
            savedStateId,
        })
        : await dependencies.createSimulationBackend({
            ...(initialBootstrapError === undefined ? {} : { initialBootstrapError }),
            scenario: savedStateId === undefined ? getSimulationScenario(location) : 'baseline',
        });
    if (requestGeneration !== initializeActiveEnvironmentGeneration) {
        try {
            await simulationBackend.dispose();
        }
        catch (error) {
            console.error('[simulation] failed to dispose stale replacement environment', error);
        }
        return getActiveBackend();
    }
    activeBackend = simulationBackend;
    setRuntimeNetworkProfile(simulationBackend.profile);
    activeSimulationController = simulationBackend;
    if (previousSimulationController !== undefined && previousSimulationController !== simulationBackend) {
        try {
            await previousSimulationController.dispose();
        }
        catch (error) {
            console.error('[simulation] failed to dispose previous environment', error);
        }
    }
    if (activeBackend !== simulationBackend || activeSimulationController !== simulationBackend)
        return getActiveBackend();
    void simulationBackend.bootstrap().catch(error => {
        console.error('[simulation] bootstrap failed', error);
    });
    return simulationBackend;
}
export function getActiveBackend() {
    return activeBackend ?? defaultInjectedBackend;
}
export function getActiveNetworkProfile() {
    return getActiveBackend().profile;
}
export function getActiveSimulationController() {
    return activeSimulationController;
}
function setActiveEnvironmentForTesting(backend, simulationController) {
    activeBackend = backend;
    activeSimulationController = simulationController;
    setRuntimeNetworkProfile(backend.profile);
}
export function installActiveEnvironmentForTesting(backend, simulationController) {
    setActiveEnvironmentForTesting(backend, simulationController);
    return () => {
        resetActiveEnvironmentForTesting();
    };
}
export function resetActiveEnvironmentForTesting() {
    initializeActiveEnvironmentGeneration += 1;
    activeBackend = undefined;
    activeSimulationController = undefined;
    resetRuntimeNetworkProfile();
}
//# sourceMappingURL=activeEnvironment.js.map