import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transactionSteps.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { embeddedTransactionSteps } from '@zoltar/ui-core-shared/components/TransactionStepsModal.js'
import { registerTransactionPreparationScope, registerTransactionReviewScope } from '@zoltar/ui-core-shared/transactions/transactionReviewScope.js'
import { cancelTransactionReview, isTransactionStepInFlight, transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'

type Workflow = NonNullable<typeof transactionSteps.value>

/** Preparing a plan only reads requirements; each write still waits for its own button. */
export function usePreparedOracleOperation({ key, enabled, busy, onPrepare, onCompleted }: { key: string; enabled: boolean; busy: boolean; onPrepare: () => void | Promise<void>; onCompleted?: (() => void) | undefined }) {
	const callbacks = useRef({ onPrepare, onCompleted })
	callbacks.current = { onPrepare, onCompleted }
	const mounted = useRef(true)
	const [error, setError] = useState<string>()
	const [preparationFailed, setPreparationFailed] = useState(false)
	const run = useRef<{ key: string; scope: AbortController; workflow?: Workflow; cancel: () => void }>()
	const [attempted, setAttempted] = useState<string>()
	const [version, setVersion] = useState(0)
	const [running, setRunning] = useState(false)
	const [retainedWorkflow, setRetainedWorkflow] = useState<Workflow>()
	const attemptKey = `${key}:${version}`
	const workflow = transactionSteps.value
	const ownedWorkflow = workflow?.reviewSignal === run.current?.scope.signal && run.current !== undefined ? workflow : undefined
	if (ownedWorkflow !== undefined && run.current !== undefined) run.current.workflow = ownedWorkflow
	const sending = ownedWorkflow?.steps.some(isTransactionStepInFlight) ?? false
	const failed = ownedWorkflow?.steps.some(step => step.phase === 'failed') ?? false
	useEffect(() => {
		if (!failed || ownedWorkflow === undefined) return
		setRetainedWorkflow(ownedWorkflow)
		run.current?.cancel()
	}, [failed, ownedWorkflow])
	useEffect(() => {
		if (!enabled) setAttempted(undefined)
		if (run.current?.key !== attemptKey || !enabled) {
			run.current?.cancel()
			setRetainedWorkflow(undefined)
			setError(undefined)
			setPreparationFailed(false)
		}
	}, [attemptKey, enabled])
	useEffect(() => {
		if (!enabled || busy || running || attempted === attemptKey || retainedWorkflow !== undefined) return
		const timer = setTimeout(() => {
			const scope = new AbortController()
			const releaseReview = registerTransactionReviewScope(scope.signal)
			const releasePreparation = registerTransactionPreparationScope(scope.signal)
			embeddedTransactionSteps.value = scope.signal
			const cancel = () => {
				const { trackingSubmitted } = cancelTransactionReview(scope.signal)
				if (!trackingSubmitted) scope.abort()
				releaseReview()
				releasePreparation()
				if (embeddedTransactionSteps.peek() === scope.signal) embeddedTransactionSteps.value = undefined
			}
			const currentRun: NonNullable<typeof run.current> = { key: attemptKey, scope, cancel }
			run.current = currentRun
			setAttempted(attemptKey)
			setRunning(true)
			const prepare = async () => await callbacks.current.onPrepare()
			void prepare()
				.catch(cause => {
					if (mounted.current && !scope.signal.aborted) setError(getErrorMessage(cause, transactionCopy.requirementsFailed))
				})
				.finally(() => {
					const current = transactionSteps.peek()
					const finished = current?.reviewSignal === scope.signal ? current : currentRun.workflow
					if (mounted.current && finished === undefined && !scope.signal.aborted) setPreparationFailed(true)
					const completed = finished?.steps.at(-1)?.hash !== undefined && finished.steps.every(step => step.phase === 'confirmed' || step.phase === 'skipped')
					if (mounted.current && finished?.steps.some(step => step.phase === 'failed')) setRetainedWorkflow(finished)
					releaseReview()
					releasePreparation()
					if (embeddedTransactionSteps.peek() === scope.signal) embeddedTransactionSteps.value = undefined
					if (mounted.current && run.current === currentRun) {
						run.current = undefined
						setRunning(false)
						if (completed) {
							if (callbacks.current.onCompleted === undefined) setRetainedWorkflow(finished)
							else callbacks.current.onCompleted()
						}
					}
				})
		}, 300)
		return () => clearTimeout(timer)
	}, [attemptKey, enabled, busy, running, attempted, retainedWorkflow])
	useEffect(
		() => () => {
			mounted.current = false
			run.current?.cancel()
		},
		[],
	)
	return {
		workflow: ownedWorkflow,
		retainedWorkflow,
		error,
		retryAvailable: preparationFailed || error !== undefined,
		preparing: running,
		sending,
		retry: () => {
			setRetainedWorkflow(undefined)
			setError(undefined)
			setPreparationFailed(false)
			setVersion(value => value + 1)
		},
	}
}
