import type { Account, Address, Chain, Hex, PublicClient, TransactionReplacement, Transport, WalletClient } from '#ethereum'
import type { Configuration } from '#config/configuration'
import { sendRawTransactionToRpc } from '#monitoring/connectivity'
import { attemptConfirmationRecovery, guardedTransactionSubmission, isExecutionPausedError, journaledSubmission, retryPrivateSubmissionWithinWindow, waitForResolvedTransaction } from '#execution/execution-orchestration'
import type { TransactionActivity } from '#state/operator-state'
import { decimalWeth } from '#state/operator-state'
import { mergeSubmissionFailures, assertSubmissionWindowOpen, SubmissionFailure, submitSignedTransaction, type SignedTransaction, type SubmittedTransaction, type SubmissionTargetResult } from '#execution/transaction-submission'

type ReadClient = PublicClient<Transport, Chain>
type WriteClient = WalletClient<Transport, Chain, Account>

export type TrackTransaction = (activity: TransactionActivity) => void

export type TrackedSubmission = SignedTransaction &
	SubmittedTransaction & {
		estimatedNetProfitEth: string | undefined
		kind: TransactionActivity['kind']
		reportId: string
		submittedAt: string
		token: Address | undefined
		tokenSymbol: string | undefined
	}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

export function receiptGasCost(receipt: { effectiveGasPrice?: bigint | undefined; gasUsed: bigint; transactionHash: Hex }) {
	if (typeof receipt.effectiveGasPrice !== 'bigint') throw new Error(`Receipt ${receipt.transactionHash} is missing its effective gas price`)
	return receipt.gasUsed * receipt.effectiveGasPrice
}

export function transactionLogLevel(status: TransactionActivity['status']) {
	if (status === 'reverted' || status === 'submission-failed') return 'error'
	if (status === 'confirmation-unknown') return 'warning'
	return 'info'
}

export function trackedActivity(submission: TrackedSubmission, status: TransactionActivity['status'], actualGasCostEth: string | undefined = undefined, hash: Hex = submission.hash, trackedNetProfitEth: string | undefined = undefined): TransactionActivity {
	return {
		acceptedTargets: submission.acceptedTargets,
		actualGasCostEth,
		estimatedNetProfitEth: submission.estimatedNetProfitEth,
		failedTargets: submission.failedTargets,
		hash,
		kind: submission.kind,
		mode: submission.mode,
		originalHash: submission.hash,
		reportId: submission.reportId,
		status,
		submittedAt: submission.submittedAt,
		token: submission.token,
		tokenSymbol: submission.tokenSymbol,
		trackedNetProfitEth,
		updatedAt: new Date().toISOString(),
	}
}

export async function submitContractTransaction(
	client: ReadClient,
	wallet: WriteClient,
	config: Pick<Configuration, 'connectivity' | 'submission'>,
	signed: SignedTransaction,
	details: { estimatedNetProfitEth: string | undefined; kind: TransactionActivity['kind']; reportId: string; token?: Address | undefined; tokenSymbol?: string | undefined },
	isPaused: () => boolean,
	track: TrackTransaction,
	boundary?: { beforeSubmit: () => Promise<unknown> | unknown; persistPending: () => Promise<unknown> } | undefined,
): Promise<TrackedSubmission> {
	const account = wallet.account
	const signMessage = account?.signMessage
	if (account === undefined || signMessage === undefined) throw new Error('Execution requires a local relay authentication signer')
	const submittedAt = new Date().toISOString()
	const initial: TrackedSubmission = {
		...signed,
		acceptedTargets: [],
		estimatedNetProfitEth: details.estimatedNetProfitEth,
		failedTargets: [],
		kind: details.kind,
		mode: config.submission.mode,
		reportId: details.reportId,
		submittedAt,
		token: details.token,
		tokenSymbol: details.tokenSymbol,
	}
	try {
		const result = await guardedTransactionSubmission(
			isPaused,
			async () => {
				if (signed.lastValidBlockNumber !== undefined) assertSubmissionWindowOpen(signed.lastValidBlockNumber, await client.getBlockNumber())
			},
			async () => {
				const submit = () => {
					track(trackedActivity(initial, 'submitting'))
					return submitSignedTransaction({
						address: account.address,
						hash: signed.hash,
						maxBlockNumber: signed.maxBlockNumber,
						publicRpcUrls: config.connectivity.publicRpcUrls,
						publicSubmit: sendRawTransactionToRpc,
						serializedTransaction: signed.serializedTransaction,
						settings: config.submission,
						signMessage,
					})
				}
				if (boundary === undefined) return submit()
				const guardBoundary = () =>
					guardedTransactionSubmission(
						isPaused,
						async () => await boundary.beforeSubmit(),
						async () => {},
					)
				return journaledSubmission(boundary.persistPending, submit, guardBoundary)
			},
		)
		const submission = { ...initial, ...result }
		track(trackedActivity(submission, 'pending'))
		return submission
	} catch (error) {
		if (isExecutionPausedError(error)) throw error
		const failedTargets: readonly SubmissionTargetResult[] =
			error instanceof SubmissionFailure
				? error.failedTargets
				: [
						{
							error: errorMessage(error),
							target: config.submission.mode === 'public' ? 'public mempool' : 'private relay submission',
						},
					]
		track(trackedActivity({ ...initial, failedTargets }, 'submission-failed'))
		throw error
	}
}

export async function waitForTrackedTransaction(
	client: ReadClient,
	wallet: WriteClient,
	config: Pick<Configuration, 'connectivity' | 'pollMilliseconds' | 'submission'>,
	submission: TrackedSubmission,
	track: TrackTransaction,
	onReplacement: (replacement: TransactionReplacement) => Promise<unknown> | unknown = () => {},
) {
	const account = wallet.account
	const signMessage = account?.signMessage
	if (account === undefined || signMessage === undefined) throw new Error('Execution requires a local relay authentication signer')
	let tracked = submission
	const receipt = await waitForResolvedTransaction(
		submission.hash,
		parameters => wallet.waitForTransactionReceipt({ ...parameters, timeout: config.pollMilliseconds, transaction: submission.transaction }),
		undefined,
		async error => {
			console.error(`transaction=${submission.hash} confirmationRetry=${errorMessage(error)}`)
			track(trackedActivity(tracked, 'confirmation-unknown'))
			const currentBlockNumber = await client.getBlockNumber()
			if (tracked.lastValidBlockNumber !== undefined && currentBlockNumber >= tracked.lastValidBlockNumber) {
				throw new Error(`Transaction ${submission.hash} was not confirmed in its parent-bound target block ${tracked.lastValidBlockNumber.toString()}`)
			}
			if (config.submission.mode !== 'private') return
			await attemptConfirmationRecovery(
				async () => {
					const retry = await retryPrivateSubmissionWithinWindow({
						currentBlockNumber,
						lastValidBlockNumber: tracked.lastValidBlockNumber,
						submit: maxBlockNumber =>
							submitSignedTransaction({
								address: account.address,
								hash: submission.hash,
								maxBlockNumber,
								publicRpcUrls: config.connectivity.publicRpcUrls,
								publicSubmit: sendRawTransactionToRpc,
								serializedTransaction: submission.serializedTransaction,
								settings: config.submission,
								signMessage,
							}),
					})
					if (!retry.attempted) {
						console.error(`transaction=${submission.hash} relayResubmissionSkipped=calldata-expired`)
						return
					}
					tracked = {
						...tracked,
						acceptedTargets: [...new Set([...tracked.acceptedTargets, ...retry.result.acceptedTargets])],
						failedTargets: retry.result.failedTargets,
						maxBlockNumber: retry.maxBlockNumber,
					}
					track(trackedActivity(tracked, 'pending'))
				},
				retryError => {
					console.error(`transaction=${submission.hash} relayResubmissionFailed=${errorMessage(retryError)}`)
					tracked = {
						...tracked,
						failedTargets: mergeSubmissionFailures(tracked.failedTargets, retryError),
					}
					track(trackedActivity(tracked, 'confirmation-unknown'))
				},
			)
		},
		onReplacement,
		replacement => config.submission.mode === 'public' || replacement.reason === 'repriced',
	)
	const actualGasCostEth = decimalWeth(receiptGasCost(receipt))
	track(trackedActivity(tracked, receipt.status === 'success' ? 'confirmed' : 'reverted', actualGasCostEth, receipt.transactionHash))
	return { receipt, tracked }
}
