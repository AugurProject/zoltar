import type { OperatorSettings } from '#config/settings'
import { serializedSettings } from '#config/settings'
import { recordActivity, type RuntimeState } from '#state/operator-state'
import { signerCandidate } from '@zoltar/bot-shared/config/signer'
import type { Hex } from '@zoltar/bot-shared/ethereum'
import type { BotProcessLocks } from '@zoltar/bot-shared/execution/bot-process-locks'
import { validateSubmissionSettings } from '@zoltar/bot-shared/execution/transaction-submission'
import { checkSubmissionEndpoints } from '@zoltar/bot-shared/monitoring/connectivity'
import { applyExecutionMode, parseExecutionRequest } from './execution-mode.ts'
import { commitSignerMutation } from './signer-mutation.ts'

export const PENDING_INTENT_MODE_CHANGE = 'The delivery mode cannot change while a pending transaction sent under the current mode awaits recovery'

type GoLiveContext = {
	activePrivateKey: () => Hex | undefined
	/** Installs the signer in the running process: the active key, its wallet client, and the snapshot's wallet address. */
	applySigner: (privateKey: Hex | undefined) => void
	locks: Pick<BotProcessLocks, 'acquireSigner' | 'commitSigner' | 'disableExecution' | 'discardSigner' | 'enableExecution'>
	persist: (update: (current: OperatorSettings) => OperatorSettings) => Promise<OperatorSettings>
	/** Serializes dashboard mutations against the scan loop; every control runs inside it. */
	runMutation: <T>(mutation: () => Promise<T>) => Promise<T>
	settings: () => OperatorSettings
	state: RuntimeState
}

/** The Go live dashboard controls: the execution signer, transaction delivery, and the readiness-gated execution mode switch. */
export function createGoLiveControls({ activePrivateKey, applySigner, locks, persist, runMutation, settings, state }: GoLiveContext) {
	return {
		setSigner: (value: unknown) =>
			runMutation(async () => {
				if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Signer request must be an object')
				const rawPrivateKey = Reflect.get(value, 'privateKey')
				const rememberSigner = Reflect.get(value, 'rememberSigner')
				if (typeof rawPrivateKey !== 'string' || typeof rememberSigner !== 'boolean') throw new Error('Signer request requires privateKey and rememberSigner')
				const candidate = signerCandidate(rawPrivateKey.trim() === '' ? null : rawPrivateKey)
				const nextSignerLock = await locks.acquireSigner(candidate.address)
				try {
					await commitSignerMutation(
						candidate,
						rememberSigner,
						async signer => {
							await persist(current => ({ ...current, privateKey: signer.privateKey }))
						},
						signer => applySigner(signer.privateKey),
					)
				} catch (error) {
					try {
						await locks.discardSigner(candidate.address, nextSignerLock)
					} catch (cleanupError) {
						throw new AggregateError([error, cleanupError], 'Signer update failed and its provisional lock could not be released')
					}
					throw error
				}
				await locks.commitSigner(candidate.address, nextSignerLock)
				recordActivity(state, {
					kind: 'configuration',
					message: candidate.address === undefined ? 'Active signer cleared' : `Signer ${candidate.address} activated${rememberSigner ? ' and saved' : ''}`,
					status: 'info',
				})
				return { wallet: candidate.address }
			}),
		setExecution: (value: unknown) =>
			runMutation(async () => {
				const execute = parseExecutionRequest(value)
				const outcome = await applyExecutionMode(execute, {
					activePrivateKey: activePrivateKey(),
					locks,
					pause: () => {
						state.paused = true
						state.status = 'paused'
					},
					persist,
					settings: settings(),
				})
				if (outcome.changed) {
					recordActivity(state, {
						kind: 'configuration',
						message: execute ? `Live execution armed with signer ${outcome.address ?? ''}; operator paused until resumed` : 'Dry-run mode saved',
						status: 'info',
					})
				}
				return serializedSettings(settings(), true)
			}),
		setSubmission: (value: unknown) =>
			runMutation(async () => {
				const submission = validateSubmissionSettings(value)
				// Recovery resubmits a pending intent with the current delivery settings, so a mode change would broadcast a
				// transaction that was signed for private relays (or vice versa) until that intent has been resolved.
				const pendingOtherMode = state.pendingTransactions.filter(intent => intent.mode !== submission.mode).length
				if (pendingOtherMode > 0) throw new Error(PENDING_INTENT_MODE_CHANGE)
				await checkSubmissionEndpoints(submission, settings().network.chainId)
				await persist(current => ({ ...current, submission }))
				recordActivity(state, {
					details: `mode=${submission.mode} relays=${submission.relayUrls.length.toString()}`,
					kind: 'configuration',
					message: 'Transaction delivery settings saved',
					status: 'info',
				})
				return serializedSettings(settings(), true)
			}),
	}
}
