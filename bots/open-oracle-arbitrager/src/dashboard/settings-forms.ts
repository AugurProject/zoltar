import type { StoredRuntimeLimits } from '#config/settings-store'
import type { SettlementSettings } from '#state/settlement-store'
import type { QueuedSettingsSection, StrategySettings } from '#state/operator-state'
import type { SubmissionSettings } from '#execution/transaction-submission'
import { urlLines } from '@zoltar/bot-shared/dashboard/forms'
import { nonnegativeAtomicValue } from '@zoltar/bot-shared/dashboard/amount'
import { confirmOperatorAction, reviewChangeRows } from '@zoltar/bot-shared/dashboard/confirmation'
import { decodeCentralizedMarkets, decodeDeployment, decodeExecution, decodeRuntimeLimits, decodeSettings, decodeSettlement, decodeSubmission, type DashboardDeployment } from './api-validation.ts'
import { element, setText } from './dom.js'
import { createFocusedFormSubmitter, onFormSubmit } from '@zoltar/bot-shared/dashboard/focused-form'
import { formIsDirty, markFormClean, trackForm } from '@zoltar/bot-shared/dashboard/form-state'
import type { GoLiveConfiguration } from './go-live.ts'
import { loadMarketSources, marketSourcesDocument, registerMarketSourceControls } from './market-sources-form.ts'

type FocusedFormContext = {
	api: (path: string, init?: RequestInit) => Promise<unknown>
	refresh: () => Promise<void>
	/** Re-derives every fieldset's locked state from connection and configuration state once a save has finished. */
	syncControls: () => void
}

/** The last configuration the bot returned for each section; forms diff against it and the go-live checklist reads it. */
const loaded: { deployment: DashboardDeployment | undefined; execute: boolean; relayUrls: readonly string[]; rpcQuorum: 1 | 2; submissionMode: 'private' | 'public' } = {
	deployment: undefined,
	execute: false,
	relayUrls: [],
	rpcQuorum: 1,
	submissionMode: 'public',
}
let loadedRuntime: StoredRuntimeLimits | undefined
let loadedStrategy: StrategySettings | undefined
let loadedSettlement: SettlementSettings | undefined
let loadedMarkets: Record<string, unknown> | undefined

export function goLiveConfiguration(): GoLiveConfiguration | undefined {
	if (loaded.deployment === undefined) return undefined
	return { deployment: loaded.deployment, execute: loaded.execute, relayUrls: loaded.relayUrls, rpcQuorum: loaded.rpcQuorum, submissionMode: loaded.submissionMode }
}

export function setLoadedRpcQuorum(rpcQuorum: 1 | 2) {
	loaded.rpcQuorum = rpcQuorum
}

/** The strategy form's inputs are addressed by their JSON field name. */
function input(name: keyof StrategySettings) {
	const found = document.querySelector(`[name="${name}"]`)
	if (!(found instanceof HTMLInputElement)) throw new Error(`Missing strategy input: ${name}`)
	return found
}

export function loadSettings(settings: StrategySettings) {
	loadedStrategy = settings
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

type DeploymentForm = 'connectivity-form' | 'deployment-form'

/**
 * Venues and quorum RPC URLs share one stored section across two forms. Each form submits only its own
 * fields and the bot returns the section merged with the latest saved values, so the saves may overlap. A form that
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
	loadedRuntime = runtime
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
	loadedSettlement = settlement
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
	loadedMarkets = centralizedMarkets
	loadMarketSources(centralizedMarkets)
	markFormClean('market-form')
}

/** The operator-file section each focused form edits; mirrors `queuedSettingsSections` on the server. */
const FOCUSED_FORMS: Readonly<Record<string, QueuedSettingsSection | undefined>> = {
	'configuration-form': undefined,
	'connectivity-form': 'connectivity',
	'deployment-form': 'deployment',
	'execution-form': 'execution',
	'market-form': 'markets',
	'runtime-form': 'risk',
	'settlement-form': 'settlement',
	'strategy-form': 'strategy',
	'submission-form': 'submission',
}

/**
 * Wires the focused Settings forms that each edit one section of the operator file. Values load from the complete
 * configuration document, every save reloads the section the bot returns, and a form's save button stays disabled until
 * an edit differs from the loaded values.
 */
export function registerFocusedSettingsForms({ api, refresh, syncControls }: FocusedFormContext) {
	for (const [formId, section] of Object.entries(FOCUSED_FORMS)) trackForm(formId, { section })
	registerMarketSourceControls()
	const submitFocusedForm = createFocusedFormSubmitter({ refresh, syncControls })
	const put = (path: string, body: unknown) => api(path, { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'PUT' })

	onFormSubmit(element('strategy-form', HTMLFormElement), () => {
		void submitFocusedForm('strategy-form', 'form-status', 'Saving strategy…', async () => {
			const settings = {
				maxSpotTwapTicks: input('maxSpotTwapTicks').value,
				minimumProfitBps: input('minimumProfitBps').value,
				minimumProfitWeth: input('minimumProfitWeth').value,
				minimumRemainingBlocks: input('minimumRemainingBlocks').value,
				minimumRemainingSeconds: input('minimumRemainingSeconds').value,
				pollMilliseconds: Number(input('pollMilliseconds').value),
				twapSeconds: Number(input('twapSeconds').value),
			} satisfies StrategySettings
			nonnegativeAtomicValue(settings.minimumProfitWeth, 'WETH')
			if (loadedStrategy !== undefined && !(await confirmOperatorAction({ title: 'Review strategy', description: 'Profit and timing settings change which transactions the bot may submit.', changes: reviewChangeRows(loadedStrategy, settings), confirmLabel: 'Save strategy' }))) return 'Save canceled.'
			loadSettings(decodeSettings(await put('/api/settings', settings)).settings)
			return 'Strategy saved.'
		})
	})

	onFormSubmit(element('submission-form', HTMLFormElement), () => {
		void submitFocusedForm('submission-form', 'submission-status', 'Saving submission…', async () => {
			const submission = {
				minimumBundleRelaySuccesses: Number(element('minimum-bundle-relay-successes', HTMLInputElement).value),
				mode: element('submission-mode', HTMLSelectElement).value,
				relayUrls: urlLines(element('relay-urls', HTMLTextAreaElement).value),
			}
			loadSubmission(decodeSubmission(await put('/api/submission', submission)).submission)
			return 'Submission settings saved.'
		})
	})

	onFormSubmit(element('runtime-form', HTMLFormElement), () => {
		void (async () => {
			const saved = loadedRuntime
			if (saved === undefined) return
			const riskFields = ['lifecycleGasReserveWeth', 'maxConcurrentPositions', 'maxDailyGasSpendWeth', 'maxPositionNotionalWeth', 'maxTotalLockedWeth'] as const
			for (const field of riskFields) {
				if (field !== 'maxConcurrentPositions') nonnegativeAtomicValue(runtimeInput(field).value, 'WETH')
			}
			const positionLimit = nonnegativeAtomicValue(runtimeInput('maxPositionNotionalWeth').value, 'WETH')
			const totalLimit = nonnegativeAtomicValue(runtimeInput('maxTotalLockedWeth').value, 'WETH')
			if (positionLimit > totalLimit) throw new Error('Per-position WETH limit cannot exceed the total locked WETH limit.')
			const hedgeSlippageValue = runtimeInput('maxHedgeSlippageBps').value
			const maxHedgeSlippageBps = Number(hedgeSlippageValue)
			if (!/^\d+$/.test(hedgeSlippageValue) || !Number.isSafeInteger(maxHedgeSlippageBps) || maxHedgeSlippageBps > 1_000) throw new Error('Maximum hedge slippage must be a whole number from 0 to 1000 bps.')
			const lookbackValue = runtimeInput('lookbackBlocks').value
			const lookbackBlocks = Number(lookbackValue)
			if (!/^\d+$/.test(lookbackValue) || !Number.isSafeInteger(lookbackBlocks) || lookbackBlocks > 256) throw new Error('Lookback period must be a whole number from 0 to 256 blocks.')
			const changes = riskFields
				.flatMap(field => {
					const before = String(saved.riskLimits[field])
					const after = runtimeInput(field).value
					return before === after ? [] : [{ label: field.replace(/([A-Z])/g, ' $1'), before: `${before} ${field === 'maxConcurrentPositions' ? 'positions' : 'WETH'}`, after: `${after} ${field === 'maxConcurrentPositions' ? 'positions' : 'WETH'}` }]
				})
				.concat(
					saved.maxHedgeSlippageBps === runtimeInput('maxHedgeSlippageBps').value ? [] : [{ label: 'Maximum hedge slippage', before: `${saved.maxHedgeSlippageBps} bps`, after: `${maxHedgeSlippageBps} bps` }],
					saved.lookbackBlocks === runtimeInput('lookbackBlocks').value ? [] : [{ label: 'Lookback period', before: `${saved.lookbackBlocks} blocks`, after: `${lookbackBlocks} blocks` }],
				)
			if (changes.length > 0 && !(await confirmOperatorAction({ title: 'Review risk limits', description: 'These limits govern the next scan and live execution.', changes, confirmLabel: 'Save risk limits' }))) return
			await submitFocusedForm('runtime-form', 'runtime-status', 'Saving risk limits…', async () => {
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
		})().catch(error => setText('runtime-status', error instanceof Error ? error.message : 'Risk limits are invalid.'))
	})

	onFormSubmit(element('settlement-form', HTMLFormElement), () => {
		void submitFocusedForm('settlement-form', 'settlement-status', 'Saving settlement…', async () => {
			const settlement = {
				enabled: element('settlement-enabled', HTMLInputElement).checked,
				maxGasPriceNanoEth: settlementInput('settlementMaxGasPriceNanoEth').value,
				minimumProfitWeth: settlementInput('settlementMinimumProfitWeth').value,
				rewardWithdrawThresholdEth: settlementInput('settlementRewardWithdrawThresholdEth').value,
			} satisfies SettlementSettings
			const threshold = nonnegativeAtomicValue(settlement.rewardWithdrawThresholdEth, 'ETH')
			if (threshold === 0n || threshold > 100n * 10n ** 18n) throw new Error('Settlement rewardWithdrawThresholdEth must be from 0.000000000000000001 to 100')
			if (nonnegativeAtomicValue(settlement.minimumProfitWeth, 'WETH') > 10n ** 18n) throw new Error('Settlement minimumProfitWeth must be from 0 to 1')
			const gasPrice = nonnegativeAtomicValue(settlement.maxGasPriceNanoEth, 'nanoETH', 9)
			if (gasPrice === 0n || gasPrice > 10000n * 10n ** 9n) throw new Error('Settlement maxGasPriceNanoEth must be from 0.000000001 to 10000')
			if (loadedSettlement !== undefined && !(await confirmOperatorAction({ title: 'Review settlement', description: 'These thresholds control settlement transactions and reward withdrawals.', changes: reviewChangeRows(loadedSettlement, settlement), confirmLabel: 'Save settlement' }))) return 'Save canceled.'
			const response = decodeSettlement(await put('/api/settlement', settlement))
			loadSettlement(response.settlement)
			return `Settlement ${response.settlement.enabled ? 'enabled' : 'disabled'}.`
		})
	})

	onFormSubmit(element('execution-form', HTMLFormElement), () => {
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

	onFormSubmit(element('market-form', HTMLFormElement), () => {
		void submitFocusedForm('market-form', 'market-status', 'Validating market sources…', async () => {
			const markets = marketSourcesDocument()
			if (loadedMarkets !== undefined && !(await confirmOperatorAction({ title: 'Review market sources', description: 'Source and consensus changes affect which opportunities can authorize execution.', changes: reviewChangeRows(loadedMarkets, markets), confirmLabel: 'Save market sources' }))) return 'Save canceled.'
			loadCentralizedMarkets(decodeCentralizedMarkets(await put('/api/centralized-markets', markets)).centralizedMarkets)
			return 'Market sources saved.'
		})
	})

	onFormSubmit(element('deployment-form', HTMLFormElement), () => {
		void submitFocusedForm('deployment-form', 'deployment-status', 'Validating venues…', async () => {
			// Only the venue switches travel; the bot merges them into the latest saved section so a quorum save
			// that is still in flight from another form is never overwritten with cached values.
			const venues = {
				uniswapV2Enabled: element('deployment-v2-enabled', HTMLInputElement).checked,
				uniswapV3Enabled: element('deployment-v3-enabled', HTMLInputElement).checked,
				uniswapV4Enabled: element('deployment-v4-enabled', HTMLInputElement).checked,
			}
			const savedDeployment = loaded.deployment
			if (savedDeployment !== undefined) {
				const changes = (
					[
						['uniswapV2Enabled', 'Uniswap V2'],
						['uniswapV3Enabled', 'Uniswap V3'],
						['uniswapV4Enabled', 'Uniswap V4'],
					] as const
				).map(([field, label]) => ({
					label,
					before: savedDeployment[field] ? 'Enabled' : 'Disabled',
					after: venues[field] ? 'Enabled' : 'Disabled',
				}))
				if (changes.some(change => change.before !== change.after) && !(await confirmOperatorAction({ title: 'Review trading venues', description: 'Enabled venues may be used for live execution after the next scan.', changes, confirmLabel: 'Save venues' }))) return 'Save canceled.'
			}
			loadDeployment(decodeDeployment(await put('/api/deployment', venues)).deployment, 'deployment-form')
			return 'Venues saved.'
		})
	})
}
