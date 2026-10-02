import { expect } from 'bun:test'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { connectToChromium, expectVisibleIdentifiers, explorerUrl, readAccessibilityIdentity, walletAddress } from './dashboard-harness.ts'
import { rpcSecret, scenarios } from './dashboard-workflow-fixtures.ts'

// The dashboard server and Chromium session the workflow-recovery browser test drives through its staged steps.

type DashboardBrowser = Awaited<ReturnType<typeof connectToChromium>>
type WorkflowRecoveryDashboard = ReturnType<typeof startDashboardServer>

/** Inputs the dashboard controller reads on every request and the mutations it records; the staged steps change them between checks. */
export type WorkflowRecoveryFixture = {
	configurationRevision: string
	/** Extra saved public RPCs, so a step can change the saved endpoint set under an unsaved RPC draft. */
	additionalPublicRpcUrls: string[]
	readonly connectivityMutations: unknown[]
	delayNextConnectivityMutation: boolean
	executeMode: boolean
	readonly executionMutations: unknown[]
	failNextStateRead: boolean
	failSecondStateRead: boolean
	initialDashboardState: Record<string, unknown>
	recoveredDashboardState: Record<string, unknown>
	selectableOperationAllowlist: string[] | null
	readonly settingsMutations: unknown[]
	stateRequests: number
	submissionConfigured: boolean
}

export type WorkflowRecoveryServer = { dashboard: WorkflowRecoveryDashboard; dashboardPort: number; fixture: WorkflowRecoveryFixture }

export type WorkflowRecoveryContext = WorkflowRecoveryServer & {
	accessibilityIdentity: (selector: string) => Promise<unknown>
	cdp: DashboardBrowser
	expectVisibleIdentifiers: (expected: { explorerUrl?: string; type: string; value: string }[], minimumButtonHeight: number, selector?: string) => Promise<unknown>
	/** Flips the saved execution mode through the Execution mode panel so the policy form validates against it. */
	setExecutionMode: (execute: boolean, message: string) => Promise<void>
	waitFor: (expression: string, message: string) => Promise<unknown>
	waitForConnectivityMutation: (count: number, message: string) => Promise<void>
	waitForSettingsMutation: (count: number, message: string) => Promise<void>
}

export type WorkflowViewport = { height: number; label: 'desktop' | 'mobile'; nextConfigurationRevision: string; width: number }

export const WORKFLOW_VIEWPORTS: readonly WorkflowViewport[] = [
	{ height: 900, label: 'desktop', nextConfigurationRevision: 'fixture-2', width: 1_440 },
	{ height: 844, label: 'mobile', nextConfigurationRevision: 'fixture-3', width: 390 },
]

/** Starts the dashboard against a mutable fixture whose second state read fails until a step recovers it. */
export function startWorkflowRecoveryDashboard(): WorkflowRecoveryServer {
	const firstScenario = scenarios[0]
	if (firstScenario === undefined) throw new Error('Recovery scenarios are required')
	const fixture: WorkflowRecoveryFixture = {
		additionalPublicRpcUrls: [],
		configurationRevision: 'fixture-1',
		connectivityMutations: [],
		delayNextConnectivityMutation: true,
		executeMode: false,
		executionMutations: [],
		failNextStateRead: false,
		failSecondStateRead: true,
		initialDashboardState: firstScenario.staleState,
		recoveredDashboardState: firstScenario.recoveredState,
		selectableOperationAllowlist: null,
		settingsMutations: [],
		stateRequests: 0,
		submissionConfigured: true,
	}
	const dashboard = startDashboardServer(0, {
		getConfiguration: () => ({
			hasSigner: true,
			revision: fixture.configurationRevision,
			settings: {
				connectivity: {
					publicRpcUrls: [`https://submit.example/?token=${rpcSecret}`, ...fixture.additionalPublicRpcUrls],
					quorumRpcUrls: ['https://read-two.example/?api_key=private', 'https://read-three.example/private'],
					readRpcUrl: `https://operator:${rpcSecret}@read-one.example/private`,
					rpcQuorum: 2,
				},
				network: { chainId: 11_155_111, explorerUrl, name: 'sepolia' },
				paused: Reflect.get(fixture.initialDashboardState, 'paused') === true,
				runtime: { execute: fixture.executeMode },
				submission: fixture.submissionConfigured
					? {
							minimumBundleRelaySuccesses: 2,
							mode: 'private',
							relayUrls: [`https://relay-one.example/private?token=${rpcSecret}`, 'https://relay-two.example/private', 'https://relay-three.example/private'],
						}
					: undefined,
				scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 60 },
				strategy: {
					allowHighRiskOperations: false,
					allowIrreversibleOperations: false,
					initializeGenesisUniverse: true,
					enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'],
					maximumEthPerOperation: '0.05',
					maximumGasCostEth: '0.02',
					maximumRepPerOperation: '10',
					minimumEthReserve: '0.05',
					minimumRepReserve: '10',
					selectableOperationAllowlist: fixture.selectableOperationAllowlist,
					workflowValidForBlocks: 288,
				},
			},
			signerAddress: walletAddress,
		}),
		getState: async () => {
			fixture.stateRequests += 1
			if (fixture.failNextStateRead) {
				fixture.failNextStateRead = false
				throw new Error('intentional one-shot state-read failure')
			}
			if (fixture.failSecondStateRead && fixture.stateRequests === 2) {
				await Bun.sleep(150)
				throw new Error('intentional state-read failure')
			}
			if (fixture.stateRequests === 3) await Bun.sleep(150)
			return fixture.stateRequests >= 3 ? fixture.recoveredDashboardState : fixture.initialDashboardState
		},
		hostname: '127.0.0.1',
		setCancellation: () => {},
		setCandidate: () => {},
		setConnectivity: async value => {
			fixture.connectivityMutations.push(value)
			if (fixture.delayNextConnectivityMutation) {
				fixture.delayNextConnectivityMutation = false
				await Bun.sleep(5_250)
			}
		},
		setObligation: () => {},
		setPaused: () => {},
		setReplacement: () => {},
		setExecution: value => {
			fixture.executionMutations.push(value)
			fixture.executeMode = Reflect.get(Object(value), 'execute') === true
		},
		setSettings: value => fixture.settingsMutations.push(value),
		setSigner: () => {},
		setWorkflow: () => {},
	})
	const dashboardPort = dashboard.port
	if (dashboardPort === undefined) throw new Error('Dashboard interaction fixture did not expose a port')
	return { dashboard, dashboardPort, fixture }
}

/**
 * Connects Chromium with a script that accepts every operator confirmation dialog, hands the session to `track` so the
 * caller can close it, and builds the waiting and assertion helpers the staged steps share.
 */
export async function openWorkflowRecoveryBrowser(server: WorkflowRecoveryServer, track: (session: DashboardBrowser) => void): Promise<WorkflowRecoveryContext> {
	const { fixture } = server
	const cdp = await connectToChromium()
	await cdp.command('Page.addScriptToEvaluateOnNewDocument', {
		source: `document.addEventListener('DOMContentLoaded', () => {
		const accept = () => {
			const dialog = document.querySelector('.operator-confirm-dialog')
			if (!(dialog instanceof HTMLDialogElement)) return
			window.operatorDialogReview = dialog.textContent ?? ''
			const input = dialog.querySelector('input')
			if (input instanceof HTMLInputElement) {
				input.value = dialog.querySelector('label strong')?.textContent ?? ''
				input.dispatchEvent(new Event('input', { bubbles: true }))
			}
			setTimeout(() => dialog.querySelector('button[type="submit"]')?.click(), 0)
		}
		new MutationObserver(accept).observe(document.body, { childList: true, subtree: true })
	})`,
	})
	track(cdp)
	await cdp.command('Network.enable')
	const waitFor = async (expression: string, message: string) => await cdp.waitFor(expression, { attempts: 400, message })
	const waitForMutation = async (mutations: readonly unknown[], count: number, message: string) => {
		for (let attempt = 0; attempt < 200; attempt += 1) {
			if (mutations.length === count) return
			await Bun.sleep(25)
		}
		throw new Error(message)
	}
	const setExecutionMode = async (execute: boolean, message: string) => {
		const count = fixture.executionMutations.length + 1
		await cdp.evaluate(`(() => {
			const toggle = document.querySelector('#execution-enabled')
			const form = document.querySelector('#execution-form')
			if (!(toggle instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
			toggle.checked = ${execute ? 'true' : 'false'}
			toggle.dispatchEvent(new Event('change', { bubbles: true }))
			form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
		})()`)
		for (let attempt = 0; attempt < 200; attempt += 1) {
			if (fixture.executionMutations.length === count) break
			await Bun.sleep(25)
		}
		if (fixture.executionMutations.length !== count) throw new Error(message)
		expect(fixture.executionMutations.at(-1)).toEqual({ execute, revision: fixture.configurationRevision })
		await waitFor(`document.querySelector('#execution-status')?.textContent === ${JSON.stringify(execute ? 'Live execution enabled. Resume through the readiness check to start signing.' : 'Dry-run mode saved.')} && document.querySelector('#execution-fieldset')?.disabled === false`, message)
	}
	return {
		...server,
		accessibilityIdentity: async selector => await readAccessibilityIdentity(cdp, selector),
		cdp,
		expectVisibleIdentifiers: async (expected, minimumButtonHeight, selector) => await expectVisibleIdentifiers(cdp, expected, minimumButtonHeight, selector),
		setExecutionMode,
		waitFor,
		waitForConnectivityMutation: async (count, message) => await waitForMutation(fixture.connectivityMutations, count, message),
		waitForSettingsMutation: async (count, message) => await waitForMutation(fixture.settingsMutations, count, message),
	}
}
