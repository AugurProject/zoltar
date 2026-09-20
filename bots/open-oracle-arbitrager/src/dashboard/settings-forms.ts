import type { StoredRuntimeLimits } from '#config/settings-store'
import type { SettlementSettings } from '#state/settlement-store'
import type { StrategySettings } from '#state/operator-state'
import type { SubmissionSettings } from '#execution/transaction-submission'
import { decodeCentralizedMarkets, decodeDeployment, decodeExecution, decodeRuntimeLimits, decodeSettlement, type DashboardDeployment } from './api-validation.ts'
import { element, setText } from './dom.js'
import { formIsDirty, markFormClean, setFormSubmitting, trackForm } from './form-state.ts'
import type { GoLiveConfiguration } from './go-live.ts'
import { loadMarketSources, marketSourcesDocument, registerMarketSourceControls } from './market-sources-form.ts'

function prettyJson(value: unknown) {
	const serialized = JSON.stringify(value, undefined, 2)
	if (serialized === undefined) throw new Error('Configuration cannot be represented as JSON')
	return serialized
}

type FocusedFormContext = {
	api: (path: string, init?: RequestInit) => Promise<unknown>
	refresh: () => Promise<void>
}

/** The last configuration the bot returned for each section; forms diff against it and the go-live checklist reads it. */
const loaded: { deployment: DashboardDeployment | undefined; execute: boolean; relayUrls: readonly string[]; rpcQuorum: 1 | 2; submissionMode: 'private' | 'public' } = {
	deployment: undefined,
	execute: false,
	relayUrls: [],
	rpcQuorum: 1,
	submissionMode: 'public',
}

export function goLiveConfiguration(): GoLiveConfiguration | undefined {
	if (loaded.deployment === undefined) return undefined
	return { deployment: loaded.deployment, execute: loaded.execute, relayUrls: loaded.relayUrls, rpcQuorum: loaded.rpcQuorum, submissionMode: loaded.submissionMode }
}

export function setLoadedRpcQuorum(rpcQuorum: 1 | 2) {
	loaded.rpcQuorum = rpcQuorum
}

/** The strategy form's inputs are addressed by their JSON field name. */
export function input(name: keyof StrategySettings) {
	const found = document.querySelector(`[name="${name}"]`)
	if (!(found instanceof HTMLInputElement)) throw new Error(`Missing strategy input: ${name}`)
	return found
}

export function loadSettings(settings: StrategySettings) {
	input('minimumProfitWeth').value = settings.minimumProfitWeth
	input('minimumProfitBps').value = settings.minimumProfitBps
	input('maxSpotTwapTicks').value = settings.maxSpotTwapTicks
	input('twapSeconds').value = settings.twapSeconds.toString()
	input('minimumRemainingBlocks').value = settings.minimumRemainingBlocks
	input('minimumRemainingSeconds').value = settings.minimumRemainingSeconds
	input('pollMilliseconds').value = settings.pollMilliseconds.toString()
	markFormClean('strategy-form')
}

export function loadSubmission(submission: SubmissionSettings) {
	const mode = element('submission-mode', HTMLSelectElement)
	mode.value = submission.mode
	element('relay-urls', HTMLTextAreaElement).value = submission.relayUrls.join('\n')
	element('minimum-bundle-relay-successes', HTMLInputElement).value = submission.minimumBundleRelaySuccesses.toString()
	loaded.relayUrls = submission.relayUrls
	loaded.submissionMode = submission.mode
	markFormClean('submission-form')
}

type DeploymentForm = 'connectivity-form' | 'deployment-form' | 'manifest-form'

/**
 * Venues, the manifest, and the quorum RPC URLs are one stored section but three forms. Each form submits only its own
 * fields and the bot returns the section merged with the latest saved values, so the three saves may overlap. A form that
 * saved, or that has no unsaved edits, takes the returned values; a form mid-edit keeps them, except when the complete
 * configuration reloads and every form restarts from the file.
 */
export function loadDeployment(deployment: DashboardDeployment, source?: DeploymentForm | 'configuration') {
	loaded.deployment = deployment
	const accepts = (formId: DeploymentForm) => source === 'configuration' || source === formId || !formIsDirty(formId)
	if (accepts('deployment-form')) {
		element('deployment-v2-enabled', HTMLInputElement).checked = deployment.uniswapV2Enabled
		element('deployment-v3-enabled', HTMLInputElement).checked = deployment.uniswapV3Enabled
		element('deployment-v4-enabled', HTMLInputElement).checked = deployment.uniswapV4Enabled
		markFormClean('deployment-form')
	}
	if (accepts('connectivity-form')) {
		element('quorum-rpc-urls', HTMLTextAreaElement).value = deployment.quorumRpcUrls.join('\n')
		markFormClean('connectivity-form')
	}
	if (accepts('manifest-form')) {
		element('deployment-manifest', HTMLTextAreaElement).value = deployment.deploymentManifest === undefined ? '' : prettyJson(deployment.deploymentManifest)
		markFormClean('manifest-form')
	}
	setText('manifest-summary', deployment.deploymentManifest === undefined ? 'Missing · required before live execution' : 'Configured')
}

/** The RPC endpoints form saved new quorum URLs; they live in the deployment section, so the loaded copy follows. */
export function applyQuorumRpcUrls(quorumRpcUrls: readonly string[]) {
	if (loaded.deployment === undefined) return
	loadDeployment({ ...loaded.deployment, quorumRpcUrls }, 'connectivity-form')
}

type RuntimeLimitField = keyof StoredRuntimeLimits['riskLimits'] | 'lookbackBlocks' | 'maxHedgeSlippageBps'

function runtimeInput(name: RuntimeLimitField) {
	const found = element('runtime-form', HTMLFormElement).querySelector(`[name="${name}"]`)
	if (!(found instanceof HTMLInputElement)) throw new Error(`Missing risk limit input: ${name}`)
	return found
}

export function loadRuntimeLimits(runtime: StoredRuntimeLimits) {
	runtimeInput('maxPositionNotionalWeth').value = runtime.riskLimits.maxPositionNotionalWeth
	runtimeInput('maxTotalLockedWeth').value = runtime.riskLimits.maxTotalLockedWeth
	runtimeInput('maxConcurrentPositions').value = runtime.riskLimits.maxConcurrentPositions.toString()
	runtimeInput('maxDailyGasSpendWeth').value = runtime.riskLimits.maxDailyGasSpendWeth
	runtimeInput('lifecycleGasReserveWeth').value = runtime.riskLimits.lifecycleGasReserveWeth
	runtimeInput('maxHedgeSlippageBps').value = runtime.maxHedgeSlippageBps
	runtimeInput('lookbackBlocks').value = runtime.lookbackBlocks
	markFormClean('runtime-form')
}

function settlementInput(name: 'settlementMinimumProfitWeth' | 'settlementMaxGasPriceNanoEth' | 'settlementRewardWithdrawThresholdEth') {
	const found = element('settlement-form', HTMLFormElement).querySelector(`[name="${name}"]`)
	if (!(found instanceof HTMLInputElement)) throw new Error(`Missing settlement input: ${name}`)
	return found
}

/** The saved settlement switch, which the panel summary reports while the bot has not applied it yet. */
export let savedSettlementEnabled = false

export function loadSettlement(settlement: SettlementSettings) {
	savedSettlementEnabled = settlement.enabled
	element('settlement-enabled', HTMLInputElement).checked = settlement.enabled
	settlementInput('settlementMinimumProfitWeth').value = settlement.minimumProfitWeth
	settlementInput('settlementMaxGasPriceNanoEth').value = settlement.maxGasPriceNanoEth
	settlementInput('settlementRewardWithdrawThresholdEth').value = settlement.rewardWithdrawThresholdEth
	markFormClean('settlement-form')
}

export function loadExecutionMode(execute: boolean) {
	loaded.execute = execute
	element('execution-enabled', HTMLInputElement).checked = execute
	setText('execution-mode-summary', execute ? 'Live' : 'Dry run')
	markFormClean('execution-form')
}

export function loadCentralizedMarkets(centralizedMarkets: Record<string, unknown>) {
	loadMarketSources(centralizedMarkets)
	markFormClean('market-form')
}

const FOCUSED_FORMS = ['connectivity-form', 'deployment-form', 'manifest-form', 'market-form', 'runtime-form', 'settlement-form', 'execution-form', 'strategy-form', 'submission-form', 'configuration-form'] as const

/**
 * Wires the focused Settings forms that each edit one section of the operator file. Values load from the complete
 * configuration document, every save reloads the section the bot returns, and a form's save button stays disabled until
 * an edit differs from the loaded values.
 */
export function registerFocusedSettingsForms({ api, refresh }: FocusedFormContext) {
	for (const formId of FOCUSED_FORMS) trackForm(formId)
	registerMarketSourceControls()
	/** Shared save flow for the focused forms: lock the button, send, reload the returned values, and refresh the snapshot. */
	const submitFocusedForm = async (formId: string, statusId: string, pendingMessage: string, save: () => Promise<string>, onError?: () => void) => {
		setFormSubmitting(formId, true)
		setText(statusId, pendingMessage)
		try {
			setText(statusId, await save())
		} catch (error) {
			onError?.()
			setText(statusId, error instanceof Error ? error.message : String(error))
		} finally {
			setFormSubmitting(formId, false)
			await refresh()
		}
	}
	const put = (path: string, body: unknown) => api(path, { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'PUT' })

	element('runtime-form', HTMLFormElement).addEventListener('submit', event => {
		event.preventDefault()
		void submitFocusedForm('runtime-form', 'runtime-status', 'Saving risk limits…', async () => {
			const runtime = {
				lookbackBlocks: runtimeInput('lookbackBlocks').value,
				maxHedgeSlippageBps: runtimeInput('maxHedgeSlippageBps').value,
				riskLimits: {
					lifecycleGasReserveWeth: runtimeInput('lifecycleGasReserveWeth').value,
					maxConcurrentPositions: Number(runtimeInput('maxConcurrentPositions').value),
					maxDailyGasSpendWeth: runtimeInput('maxDailyGasSpendWeth').value,
					maxPositionNotionalWeth: runtimeInput('maxPositionNotionalWeth').value,
					maxTotalLockedWeth: runtimeInput('maxTotalLockedWeth').value,
				},
			} satisfies StoredRuntimeLimits
			loadRuntimeLimits(decodeRuntimeLimits(await put('/api/runtime-limits', runtime)).runtime)
			return 'Risk limits saved.'
		})
	})

	element('settlement-form', HTMLFormElement).addEventListener('submit', event => {
		event.preventDefault()
		void submitFocusedForm('settlement-form', 'settlement-status', 'Saving settlement…', async () => {
			const settlement = {
				enabled: element('settlement-enabled', HTMLInputElement).checked,
				maxGasPriceNanoEth: settlementInput('settlementMaxGasPriceNanoEth').value,
				minimumProfitWeth: settlementInput('settlementMinimumProfitWeth').value,
				rewardWithdrawThresholdEth: settlementInput('settlementRewardWithdrawThresholdEth').value,
			} satisfies SettlementSettings
			const response = decodeSettlement(await put('/api/settlement', settlement))
			loadSettlement(response.settlement)
			return `Settlement ${response.settlement.enabled ? 'enabled' : 'disabled'}.`
		})
	})

	element('execution-form', HTMLFormElement).addEventListener('submit', event => {
		event.preventDefault()
		void submitFocusedForm(
			'execution-form',
			'execution-status',
			'Saving execution mode…',
			async () => {
				const execute = element('execution-enabled', HTMLInputElement).checked
				loadExecutionMode(decodeExecution(await put('/api/execution', { execute })).execute)
				return execute ? 'Live execution saved.' : 'Dry-run mode saved.'
			},
			() => {
				// A rejected switch changes nothing, so the control returns to the saved mode instead of showing an unapplied choice.
				element('execution-enabled', HTMLInputElement).checked = loaded.execute
			},
		)
	})

	element('market-form', HTMLFormElement).addEventListener('submit', event => {
		event.preventDefault()
		void submitFocusedForm('market-form', 'market-status', 'Validating market sources…', async () => {
			loadCentralizedMarkets(decodeCentralizedMarkets(await put('/api/centralized-markets', marketSourcesDocument())).centralizedMarkets)
			return 'Market sources saved.'
		})
	})

	element('deployment-form', HTMLFormElement).addEventListener('submit', event => {
		event.preventDefault()
		void submitFocusedForm('deployment-form', 'deployment-status', 'Validating venues…', async () => {
			// Only the venue switches travel; the bot merges them into the latest saved section so a manifest or quorum save
			// that is still in flight from another form is never overwritten with cached values.
			const venues = {
				uniswapV2Enabled: element('deployment-v2-enabled', HTMLInputElement).checked,
				uniswapV3Enabled: element('deployment-v3-enabled', HTMLInputElement).checked,
				uniswapV4Enabled: element('deployment-v4-enabled', HTMLInputElement).checked,
			}
			loadDeployment(decodeDeployment(await put('/api/deployment', venues)).deployment, 'deployment-form')
			return 'Venues saved.'
		})
	})

	element('manifest-form', HTMLFormElement).addEventListener('submit', event => {
		event.preventDefault()
		void submitFocusedForm('manifest-form', 'manifest-status', 'Validating manifest…', async () => {
			const manifestText = element('deployment-manifest', HTMLTextAreaElement).value.trim()
			const deploymentManifest: unknown = manifestText === '' ? null : JSON.parse(manifestText)
			loadDeployment(decodeDeployment(await put('/api/deployment', { deploymentManifest })).deployment, 'manifest-form')
			return manifestText === '' ? 'Manifest removed. Live execution stays unavailable until one is saved.' : 'Manifest saved.'
		})
	})
}
