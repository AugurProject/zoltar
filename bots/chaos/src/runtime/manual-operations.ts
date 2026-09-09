import { operationInputCoverage } from '../operations/input-coverage.ts'
import { inputChoices, inputFieldValue, operationInputSchema, resolveOperationInputs } from '../operations/input-schema.ts'
import { readableTransaction } from '../operations/transaction-description.ts'
import { lifecycleObstructions } from './lifecycle-readiness.ts'
import type { SignerOperationGate } from '@zoltar/bot-shared/execution/signer-operation-gate'
import { CHAOS_OPERATION_CATALOG, evaluateOperationCatalog } from '../operations/catalog.ts'
import { manualInputFields, resolveManualInputs, type ManualInput, type ManualInputs } from '../operations/manual-inputs.ts'
import type { OperationPlan } from '../operations/types.ts'
import type { RuntimeState } from '../state/operator-state.ts'
import { applyExecutionPolicy, planningOptions, type performCanonicalScan } from './canonical-scan.ts'
import type { ConfigurationState } from './dashboard-controller.ts'
import { dashboardRecord, exactDashboardKeys } from './dashboard-input.ts'
import { liveInventoryReadinessBlockers } from './live-readiness.ts'
import { workflowNeedsContinuation } from './workflows.ts'
import { assertOperationPrincipalCaps } from '../execution/safety.ts'

export type ManualScan = Pick<Awaited<ReturnType<typeof performCanonicalScan>>, 'snapshot' | 'anchor' | 'indexComplete' | 'carryProofJournalComplete' | 'canonicalLifecyclePresenceComplete' | 'inventory'>

type Options = {
	configuration: ConfigurationState
	state: RuntimeState
	gate: SignerOperationGate
	scan: () => Promise<ManualScan>
	execute: (plan: OperationPlan) => Promise<void>
}

type Preview = {
	id: string
	definitionId: string
	inputs: ManualInputs
	seed: number
	revision: string
	expiresAt: number
	plan: OperationPlan
}

type Execution = { previewId: string; definitionId: string; status: 'pending' | 'completed' | 'failed'; message: string }

function failure(message: string): never {
	const error = new Error(message)
	error.name = 'ManualOperationInputError'
	throw error
}

function parseInputs(value: unknown): ManualInputs {
	const source = dashboardRecord(value, 'Operation inputs')
	const inputs: Array<[string, ManualInput]> = []
	for (const [key, value] of Object.entries(source)) {
		const input = dashboardRecord(value, 'Operation input')
		exactDashboardKeys(input, input['source'] === 'chaosbot' ? ['source'] : ['source', 'value'], 'Operation input')
		if (input['source'] === 'chaosbot') inputs.push([key, { source: 'chaosbot' }])
		else if (input['source'] === 'custom' && typeof input['value'] === 'string') inputs.push([key, { source: 'custom', value: input['value'] }])
		else failure('Each input needs a chaosbot or custom source')
	}
	return Object.fromEntries(inputs)
}

function candidateIdentity(plan: OperationPlan) {
	return JSON.stringify(plan.metadata)
}

function transactionIdentity(plan: OperationPlan) {
	return JSON.stringify({ metadata: plan.metadata, steps: plan.steps, terminalSubmission: plan.terminalSubmission })
}

export function createManualOperationController(options: Options) {
	let closing = false
	const pendingWork = new Set<Promise<unknown>>()
	function track<T>(work: Promise<T>) {
		pendingWork.add(work)
		void work.then(
			() => pendingWork.delete(work),
			() => pendingWork.delete(work),
		)
		return work
	}
	let preview: Preview | undefined
	const executions = new Map<string, Execution>()
	let seed = Math.floor(Math.random() * 0x1_0000_0000)

	function runtimeBlockers() {
		const { state, configuration } = options
		const blockers: string[] = []
		if (state.pendingTransactions.length !== 0) blockers.push('Resolve the pending transaction before starting another operation')
		if (state.workflows.some(workflowNeedsContinuation)) blockers.push('Complete or reconcile the existing workflow first')
		if (state.retirement.status !== 'inactive') blockers.push('Manual operations are unavailable during retirement')
		if (state.lifecyclePresenceBlocker !== undefined) blockers.push('Resolve the lifecycle presence blocker first')
		if (configuration.settings.runtime.execute && (state.paused || configuration.settings.paused)) blockers.push('Resume the bot before live execution')
		if (configuration.settings.privateKey === undefined) blockers.push('Configure the operation signer first')
		return blockers
	}

	function plans(scan: ManualScan, id: string, inputs: ManualInputs, selectedSeed: number) {
		const settings = options.configuration.settings
		const defaults = planningOptions(settings, selectedSeed)
		let resolved
		try {
			const commonKeys = new Set(manualInputFields(defaults).map(field => field.key))
			const schema = operationInputSchema(id)
			for (const key of Object.keys(inputs)) if (!commonKeys.has(key) && !schema.some(field => field.key === key)) throw new Error(`Unknown operation input: ${key}`)
			resolved = resolveManualInputs(defaults, Object.fromEntries(Object.entries(inputs).filter(([key]) => commonKeys.has(key))))
			resolved.operationInputs = resolveOperationInputs(id, inputs, scan.snapshot)
		} catch (error) {
			failure(error instanceof Error ? error.message : 'Invalid operation inputs')
		}
		const evaluate = () =>
			applyExecutionPolicy(evaluateOperationCatalog(scan.snapshot, resolved, id), settings, scan.indexComplete && scan.carryProofJournalComplete && scan.canonicalLifecyclePresenceComplete, scan.anchor.blockNumber.toString(), scan.anchor.blockNumber.toString(), BigInt(scan.snapshot.wallet.ethBalanceAttoEth))
		let evaluated
		try {
			evaluated = evaluate()
		} catch (error) {
			failure(error instanceof Error ? error.message : 'Operation inputs are invalid')
		}
		const blockers = runtimeBlockers()
		if (!scan.canonicalLifecyclePresenceComplete) blockers.push('Wait for complete canonical discovery')
		const definition = CHAOS_OPERATION_CATALOG.find(item => item.id === id)
		if (definition?.classification === 'selectable' && settings.runtime.execute) blockers.push(...liveInventoryReadinessBlockers(scan.inventory, scan.snapshot.universes, settings.strategy))
		const obstructions = lifecycleObstructions(options.state)
		if (obstructions.hard !== undefined || obstructions.automaticRetry !== undefined) blockers.push('Resolve blocked lifecycle obligations before manual execution')
		if (definition?.classification === 'selectable' && options.state.obligations.some(item => !['completed', 'abandoned', 'superseded'].includes(item.status))) blockers.push('Lifecycle obligations must complete before a new selectable operation')
		const candidates = evaluated.flatMap(item => (item.eligibility.eligible && item.plan !== undefined ? [item.plan] : []))
		if (candidates.length === 0) blockers.push(...evaluated.flatMap(item => item.eligibility.blockers))
		for (const plan of candidates) {
			const fields = operationInputSchema(id)
			const values = Object.fromEntries(fields.map((field): [string, string] => [field.key, inputFieldValue(field, plan)]))
			for (const [key, value] of Object.entries(resolved.operationInputs ?? {})) {
				const field = fields.find(field => field.key === key)
				const matches = field?.kind === 'address' || field?.kind === 'choice' ? values[key]?.toLowerCase() === value.toLowerCase() : values[key] === value
				if (!matches) blockers.push(`The planner cannot honor the selected ${key}; change the input or target`)
			}
			plan.operationInputs = { ...values, ...Object.fromEntries(manualInputFields(resolved).map(field => [field.key, field.value])) }
			plan.inputSources = Object.fromEntries(Object.keys(plan.operationInputs).map(key => [key, inputs[key]?.source ?? 'chaosbot']))
			try {
				assertOperationPrincipalCaps(plan, settings.strategy)
			} catch (error) {
				console.error('chaosManualOperation principal validation failed', error)
				blockers.push('The operation exceeds the configured spending caps')
			}
		}
		return {
			blockers: [...new Set(blockers)],
			candidates,
			fields: [...manualInputFields(defaults).map(field => ({ ...field, kind: 'integer', advanced: true })), ...operationInputSchema(id).map(field => ({ key: field.key, label: field.label, kind: field.kind, value: inputFieldValue(field, candidates[0]), choices: inputChoices(field, scan.snapshot), advanced: false }))],
		}
	}

	async function handle(value: unknown): Promise<unknown> {
		const body = dashboardRecord(value, 'Manual operation')
		exactDashboardKeys({ definitionId: undefined, inputs: undefined, candidate: undefined, previewId: undefined, ...body }, ['action', 'definitionId', 'inputs', 'candidate', 'previewId'], 'Manual operation')
		if (body['action'] === 'status') {
			const id = body['previewId']
			if (typeof id !== 'string') failure('Missing execution reference')
			return { execution: executions.get(id) ?? null }
		}
		if (body['action'] === 'execute') {
			const id = body['previewId']
			if (typeof id !== 'string') failure('Preview the operation first')
			const existing = executions.get(id)
			if (existing !== undefined) return { execution: existing }
			const current = preview
			if (current === undefined || current.id !== id || current.expiresAt < Date.now() || current.revision !== options.configuration.revision) failure('This preview expired or configuration changed. Preview the operation again')
			if (!options.gate.acquire('scan')) failure('The bot is completing another operation. Retry shortly')
			preview = undefined
			const execution: Execution = { definitionId: current.definitionId, message: 'Checking current state…', previewId: id, status: 'pending' }
			executions.set(id, execution)
			if (executions.size > 32) {
				const oldest = executions.keys().next().value
				if (oldest !== undefined) executions.delete(oldest)
			}
			void track(
				(async () => {
					try {
						const scan = await options.scan()
						if (current.revision !== options.configuration.revision) failure('Configuration changed. Preview the operation again')
						const frozenInputs = { ...current.inputs }
						for (const [key, value] of Object.entries(current.plan.operationInputs ?? {})) frozenInputs[key] = { source: 'custom', value }
						const rebuilt = plans(scan, current.definitionId, frozenInputs, current.seed)
						if (rebuilt.blockers.length !== 0) failure(rebuilt.blockers.join('. '))
						const plan = rebuilt.candidates.find(item => transactionIdentity(item) === transactionIdentity(current.plan))
						if (plan === undefined) failure('Operation inputs or prerequisites changed. Preview the operation again')
						execution.message = options.configuration.settings.runtime.execute ? 'Executing operation…' : 'Running dry run…'
						if (current.plan.inputSources !== undefined) plan.inputSources = { ...current.plan.inputSources }
						await options.execute(plan)
						execution.status = 'completed'
						execution.message = options.configuration.settings.runtime.execute ? 'Operation processed. Check its workflow for confirmation and recovery status.' : 'Dry run completed. No transaction signed.'
					} catch (error) {
						execution.status = 'failed'
						execution.message = error instanceof Error && error.name === 'ManualOperationInputError' ? error.message : 'Operation stopped. Review its workflow and activity for recovery details.'
						console.error('chaosManualOperation failed', error)
					} finally {
						options.gate.release('scan')
					}
				})(),
			)
			return { execution }
		}
		if (body['action'] !== 'preview' && body['action'] !== 'inspect') failure('Unknown operation action')
		const id = body['definitionId']
		if (typeof id !== 'string') failure('Choose an operation')
		const definition = CHAOS_OPERATION_CATALOG.find(item => item.id === id)
		if (definition === undefined || (definition.classification !== 'selectable' && definition.classification !== 'lifecycle-obligation')) return { blockers: ['This catalog entry is not independently executable'], fields: [], candidates: [], coverage: definition === undefined ? [] : operationInputCoverage(definition) }
		if (!options.gate.acquire('scan')) failure('The bot is completing another operation. Retry shortly')
		try {
			const revision = options.configuration.revision
			const inputs = parseInputs(body['inputs'] ?? {})
			if (body['action'] === 'inspect' && Object.keys(inputs).length === 0) seed = Math.floor(Math.random() * 0x1_0000_0000)
			const scan = await options.scan()
			if (revision !== options.configuration.revision) failure('Configuration changed. Reopen the operation')
			const result = plans(scan, id, inputs, seed)
			const candidate = body['candidate']
			if (candidate !== undefined && typeof candidate !== 'string') failure('Invalid operation candidate')
			const plan = candidate === undefined ? result.candidates[0] : result.candidates.find(item => candidateIdentity(item) === candidate)
			const blockers = [...result.blockers]
			if (plan === undefined && blockers.length === 0) blockers.push('The selected candidate is no longer available')
			preview = body['action'] === 'preview' && plan !== undefined && blockers.length === 0 ? { definitionId: id, expiresAt: Date.now() + 60_000, id: crypto.randomUUID(), inputs, plan, revision, seed } : undefined
			return {
				blockers,
				candidates:
					definition.classification === 'lifecycle-obligation'
						? result.candidates.map(item => ({
								value: candidateIdentity(item),
								label:
									Object.entries(item.metadata)
										.map(([key, value]) => `${key}: ${value}`)
										.join(' · ') || item.label,
							}))
						: [],
				fields: result.fields,
				coverage: operationInputCoverage(definition),
				mode: options.configuration.settings.runtime.execute ? 'live' : 'dry-run',
				previewId: preview?.id,
				expiresAt: preview?.expiresAt,
				steps: plan?.steps.map(readableTransaction) ?? [],
			}
		} finally {
			options.gate.release('scan')
		}
	}
	return {
		handle: async (value: unknown): Promise<unknown> => {
			if (closing) failure('The bot is shutting down')
			return await track(handle(value))
		},
		[Symbol.asyncDispose]: async () => {
			closing = true
			while (pendingWork.size !== 0) await Promise.allSettled([...pendingWork])
		},
	}
}
