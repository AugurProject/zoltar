import type { StoredRuntimeLimits } from '#config/settings-store'
import type { SettlementSettings } from '#state/settlement-store'
import type { QueuedSettingsSection, StrategySettings } from '#state/operator-state'
import type { SubmissionSettings } from '#execution/transaction-submission'
import { urlLines } from '@zoltar/bot-shared/dashboard/forms'
import { nonnegativeAtomicValue } from '@zoltar/bot-shared/dashboard/amount'
import { confirmOperatorAction, reviewChangeRows } from '@zoltar/bot-shared/dashboard/confirmation'
import { decodeCentralizedMarkets, decodeDeployment, decodeExecution, decodeRuntimeLimits, decodeSettings, decodeSettlement, decodeSubmission, type DashboardDeployment } from './api-validation.ts'
import { element, setStatus, setText } from './dom.js'
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
const loaded: { deployment: DashboardDeployment | undefined; execute: boolean; quorumRpcUrls: readonly string[]; relayUrls: readonly string[]; rpcQuorum: 1 | 2; submissionMode: 'private' | 'public' } = {
	deployment: undefined,
	execute: false,
	quorumRpcUrls: [],
	relayUrls: [],
	rpcQuorum: 1,
	submissionMode: 'public',
}
let loadedRuntime: StoredRuntimeLimits | undefined
let loadedStrategy: StrategySettings | undefined
let loadedSettlement: SettlementSettings | undefined
let loadedMarkets: Record<string, unknown> | undefined
let loadedSubmission: SubmissionSettings | undefined

export function goLiveConfiguration(): GoLiveConfiguration | undefined {
	if (loaded.deployment === undefined) return undefined
	return { deployment: loaded.deployment, execute: loaded.execute, quorumRpcUrls: loaded.quorumRpcUrls, relayUrls: loaded.relayUrls, rpcQuorum: loaded.rpcQuorum, submissionMode: loaded.submissionMode }
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
	input('minimumProfitBps').value = settings.minimumProfitBps.toString()
	input('maxSpotTwapTicks').value = settings.maxSpotTwapTicks
	input('twapSeconds').value = settings.twapSeconds.toString()
	input('minimumRemainingBlocks').value = settings.minimumRemainingBlocks
	input('minimumRemainingSeconds').value = settings.minimumRemainingSeconds
	markFormClean('strategy-form')
}

export function loadSubmission(submission: SubmissionSettings) {
	const mode = element('submission-mode', HTMLSelectElement)
	mode.value = submission.mode
	element('relay-urls', HTMLTextAreaElement).value = submission.relayUrls.join('\n')
	element('minimum-bundle-relay-successes', HTMLInputElement).value = submission.minimumBundleRelaySuccesses.toString()
	loadedSubmission = submission
	loaded.relayUrls = submission.relayUrls
	loaded.submissionMode = submission.mode
	markFormClean('submission-form')
}

/**
 * The venues form submits only the venue switches and the bot returns the section merged with the latest saved values. A
 * form that saved, or that has no unsaved edits, takes the returned values; a form mid-edit keeps them, except when the
 * complete configuration reloads and every form restarts from the file.
 */
export function loadDeployment(deployment: DashboardDeployment, source?: 'configuration' | 'deployment-form') {
	loaded.deployment = deployment
	if (source !== undefined || !formIsDirty('deployment-form')) {
		element('deployment-v2-enabled', HTMLInputElement).checked = deployment.uniswapV2Enabled
		element('deployment-v3-enabled', HTMLInputElement).checked = deployment.uniswapV3Enabled
		element('deployment-v4-enabled', HTMLInputElement).checked = deployment.uniswapV4Enabled
		markFormClean('deployment-form')
	}
}

/** The saved `connectivity.quorumRpcUrls`, which the RPC endpoints form edits beside the primary and public RPCs. */
export function applyQuorumRpcUrls(quorumRpcUrls: readonly string[]) {
	loaded.quorumRpcUrls = quorumRpcUrls
	element('quorum-rpc-urls', HTMLTextAreaElement).value = quorumRpcUrls.join('\n')
}

type RuntimeLimitField = keyof StoredRuntimeLimits['riskLimits'] | 'logLookbackBlocks' | 'maxHedgeSlippageBps' | 'pollMilliseconds'

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
	runtimeInput('maxHedgeSlippageBps').value = runtime.maxHedgeSlippageBps.toString()
	runtimeInput('logLookbackBlocks').value = runtime.logLookbackBlocks.toString()
	runtimeInput('pollMilliseconds').value = runtime.pollMilliseconds.toString()
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
	'connectivity-form': 'connectivity',
	'deployment-form': 'deployment',
	'execution-form': 'execution',
	'market-form': 'markets',
	'runtime-form': 'risk',
	'settlement-form': 'settlement',
	'strategy-form': 'strategy',
	'submission-form': 'submission',
}

/** Panel titles of every Settings form a configuration reload or chain switch would overwrite. */
const SETTINGS_PANELS: readonly (readonly [formId: string, title: string])[] = [
	['connectivity-form', 'Chain and RPC connectivity'],
	['tokens-form', 'Approved universes'],
	['deployment-form', 'Venues and executor'],
	['market-form', 'REP market sources'],
	['strategy-form', 'Strategy'],
	['runtime-form', 'Risk limits and scanning'],
	['settlement-form', 'Settlement'],
	['submission-form', 'Submission'],
	['execution-form', 'Execution mode'],
]

/** The panels holding edits the operator has not saved, by title, in page order. */
export function dirtySettingsPanels() {
	return SETTINGS_PANELS.filter(([formId]) => formIsDirty(formId)).map(([, title]) => title)
}

/** The strategy fields the bot stores as integer strings; a number input also accepts forms such as `010` or `1e2` that it rejects. */
const STRATEGY_INTEGER_FIELDS = [
	['maxSpotTwapTicks', 'Maximum spot/TWAP ticks'],
	['minimumRemainingBlocks', 'Minimum remaining blocks'],
	['minimumRemainingSeconds', 'Minimum remaining seconds'],
] as const

const RISK_FIELDS = [
	['maxPositionNotionalWeth', 'Maximum position notional', 'WETH'],
	['maxTotalLockedWeth', 'Maximum total locked', 'WETH'],
	['maxConcurrentPositions', 'Maximum concurrent positions', 'positions'],
	['maxDailyGasSpendWeth', 'Maximum daily gas spend', 'ETH'],
	['lifecycleGasReserveWeth', 'Lifecycle gas reserve', 'ETH'],
] as const

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
				minimumProfitBps: Number(input('minimumProfitBps').value),
				minimumProfitWeth: input('minimumProfitWeth').value,
				minimumRemainingBlocks: input('minimumRemainingBlocks').value,
				minimumRemainingSeconds: input('minimumRemainingSeconds').value,
				twapSeconds: Number(input('twapSeconds').value),
			} satisfies StrategySettings
			nonnegativeAtomicValue(settings.minimumProfitWeth, 'WETH')
			for (const [field, label] of STRATEGY_INTEGER_FIELDS) {
				if (!/^(?:0|[1-9]\d*)$/.test(settings[field])) throw new Error(`${label} must be a whole number written in plain digits, such as 12.`)
			}
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
			if (submission.mode !== 'private' && submission.mode !== 'public') throw new Error('Choose private relays or the public mempool.')
			if (submission.mode === 'private' && submission.relayUrls.length === 0) throw new Error('Private delivery requires at least one relay URL.')
			if (submission.mode === 'private' && submission.minimumBundleRelaySuccesses > submission.relayUrls.length) throw new Error(`Required successful bundle relays cannot exceed the ${submission.relayUrls.length.toString()} configured relay URLs.`)
			if (loadedSubmission !== undefined) {
				const exposesTransactions = loadedSubmission.mode === 'private' && submission.mode === 'public'
				const description = exposesTransactions ? 'Public mempool delivery shows every entry transaction to other searchers before it is included.' : 'Delivery settings decide how signed transactions reach block builders.'
				if (!(await confirmOperatorAction({ title: 'Review submission', description, changes: reviewChangeRows(loadedSubmission, submission), confirmLabel: 'Save submission' }))) return 'Save canceled.'
			}
			loadSubmission(decodeSubmission(await put('/api/submission', submission)).submission)
			return 'Submission settings saved.'
		})
	})

	onFormSubmit(element('runtime-form', HTMLFormElement), () => {
		void (async () => {
			const saved = loadedRuntime
			if (saved === undefined) return
			setStatus('runtime-status', '')
			for (const [field, , unit] of RISK_FIELDS) {
				if (field !== 'maxConcurrentPositions') nonnegativeAtomicValue(runtimeInput(field).value, unit)
			}
			const positionLimit = nonnegativeAtomicValue(runtimeInput('maxPositionNotionalWeth').value, 'WETH')
			const totalLimit = nonnegativeAtomicValue(runtimeInput('maxTotalLockedWeth').value, 'WETH')
			if (positionLimit > totalLimit) throw new Error('Maximum position notional cannot exceed maximum total locked.')
			const hedgeSlippageValue = runtimeInput('maxHedgeSlippageBps').value
			const maxHedgeSlippageBps = Number(hedgeSlippageValue)
			if (!/^\d+$/.test(hedgeSlippageValue) || !Number.isSafeInteger(maxHedgeSlippageBps) || maxHedgeSlippageBps > 1_000) throw new Error('Maximum hedge slippage must be a whole number from 0 to 1000 bps.')
			const lookbackValue = runtimeInput('logLookbackBlocks').value
			const logLookbackBlocks = Number(lookbackValue)
			if (!/^\d+$/.test(lookbackValue) || !Number.isSafeInteger(logLookbackBlocks) || logLookbackBlocks > 256) throw new Error('Event lookback must be a whole number from 0 to 256 blocks.')
			const pollValue = runtimeInput('pollMilliseconds').value
			const pollMilliseconds = Number(pollValue)
			if (!/^\d+$/.test(pollValue) || !Number.isSafeInteger(pollMilliseconds) || pollMilliseconds < 1_000 || pollMilliseconds > 3_600_000) throw new Error('Poll interval must be a whole number from 1000 to 3600000 milliseconds.')
			// Amounts are compared by value, so `1.0` over a saved `1` is not reported as a change.
			const riskChanges: { label: string; before: string; after: string }[] = RISK_FIELDS.flatMap(([field, label, unit]) => {
				const before = String(saved.riskLimits[field])
				const after = runtimeInput(field).value
				const unchanged = field === 'maxConcurrentPositions' ? Number(before) === Number(after) : nonnegativeAtomicValue(before, unit) === nonnegativeAtomicValue(after, unit)
				return unchanged ? [] : [{ label, before: `${before} ${unit}`, after: `${after} ${unit}` }]
			})
			const changes = riskChanges.concat(
				saved.maxHedgeSlippageBps === maxHedgeSlippageBps ? [] : [{ label: 'Maximum hedge slippage', before: `${saved.maxHedgeSlippageBps.toString()} bps`, after: `${maxHedgeSlippageBps.toString()} bps` }],
				saved.logLookbackBlocks === logLookbackBlocks ? [] : [{ label: 'Event lookback', before: `${saved.logLookbackBlocks.toString()} blocks`, after: `${logLookbackBlocks.toString()} blocks` }],
				saved.pollMilliseconds === pollMilliseconds ? [] : [{ label: 'Poll interval', before: `${saved.pollMilliseconds.toString()} ms`, after: `${pollMilliseconds.toString()} ms` }],
			)
			if (changes.length > 0 && !(await confirmOperatorAction({ title: 'Review risk limits', description: 'These limits govern the next scan and live execution.', changes, confirmLabel: 'Save risk limits' }))) {
				setStatus('runtime-status', 'Save canceled.')
				return
			}
			await submitFocusedForm('runtime-form', 'runtime-status', 'Saving risk limits…', async () => {
				const runtime = {
					logLookbackBlocks,
					maxHedgeSlippageBps,
					pollMilliseconds,
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
		})().catch(error => setStatus('runtime-status', error instanceof Error ? error.message : 'Risk limits are invalid.', true))
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
			if (threshold === 0n || threshold > 100n * 10n ** 18n) throw new Error('Reward withdraw threshold must be from 0.000000000000000001 to 100 ETH.')
			if (nonnegativeAtomicValue(settlement.minimumProfitWeth, 'ETH') > 10n ** 18n) throw new Error('Minimum net must be from 0 to 1 ETH.')
			const gasPrice = nonnegativeAtomicValue(settlement.maxGasPriceNanoEth, 'nanoETH', 9)
			if (gasPrice === 0n || gasPrice > 10000n * 10n ** 9n) throw new Error('Settlement fee cap must be from 0.000000001 to 10000 nanoETH.')
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
			// Only the venue switches travel; the bot merges them into the latest saved section.
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
