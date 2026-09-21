import { privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { checkPrivateTransactionSubmissionEndpoints, checkPublicTransactionSubmissionEndpoints, EndpointCheckFailure, type EndpointCheck } from '@zoltar/bot-shared/monitoring/connectivity'
import type { OperatorSettings } from '../config/settings.ts'

function submissionSigner(settings: OperatorSettings) {
	if (settings.privateKey === undefined) throw new Error('Private submission capability preflight requires the configured transaction signer')
	return privateKeyToAccount(settings.privateKey)
}

export async function preflightTransactionSubmissionNetwork(settings: OperatorSettings) {
	const connectivity = settings.connectivity
	if (connectivity === undefined) throw new Error('Submission preflight requires configured connectivity')
	let checks: readonly EndpointCheck[]
	if (settings.submission.mode === 'private') {
		const account = submissionSigner(settings)
		checks = await checkPrivateTransactionSubmissionEndpoints(settings.submission, settings.network.chainId, { address: account.address, signMessage: account.signMessage })
	} else {
		checks = await checkPublicTransactionSubmissionEndpoints(connectivity.publicRpcUrls, settings.network.chainId)
	}
	return assertSubmissionPreflightFresh(checks, settings)
}

export function submissionPreflightConfigurationIdentity(settings: OperatorSettings) {
	const connectivity = settings.connectivity
	const privateMode = settings.submission.mode === 'private'
	const targets = privateMode ? settings.submission.relayUrls : (connectivity?.publicRpcUrls ?? [])
	const authenticatedAddress = privateMode && settings.privateKey !== undefined ? privateKeyToAccount(settings.privateKey).address : undefined
	return JSON.stringify([settings.network.chainId, settings.submission.mode, settings.submission.minimumBundleRelaySuccesses, authenticatedAddress, ...targets])
}

/** How long submission evidence stays current: the larger of two lifecycle polls and two configured block intervals. */
function submissionPreflightRefreshMilliseconds(settings: OperatorSettings) {
	return Math.max(settings.runtime.lifecyclePollMilliseconds * 2, settings.network.maximumBlockIntervalSeconds * 2_000)
}

function submissionPreflightIsDue(checks: readonly EndpointCheck[], settings: OperatorSettings, nowMilliseconds = Date.now()) {
	const connectivity = settings.connectivity
	if (connectivity === undefined) return true
	const privateMode = settings.submission.mode === 'private'
	const expectedKind = privateMode ? 'private-relay' : 'public-rpc'
	const expectedTargets = (privateMode ? settings.submission.relayUrls : connectivity.publicRpcUrls).map(url => new URL(url).origin).sort()
	const actualTargets = checks.map(check => check.target).sort()
	if (expectedTargets.length === 0 || actualTargets.length !== expectedTargets.length || actualTargets.some((target, index) => target !== expectedTargets[index])) return true
	const expectedAuthenticationAddress = privateMode && settings.privateKey !== undefined ? privateKeyToAccount(settings.privateKey).address.toLowerCase() : undefined
	const refreshMilliseconds = submissionPreflightRefreshMilliseconds(settings)
	return checks.some(check => {
		const checkedAt = Date.parse(check.checkedAt)
		const authenticationMatches = privateMode ? expectedAuthenticationAddress !== undefined && check.authenticatedAddress?.toLowerCase() === expectedAuthenticationAddress : check.authenticatedAddress === undefined
		return !authenticationMatches || check.kind !== expectedKind || check.status !== 'healthy' || check.chainId !== settings.network.chainId || !Number.isFinite(checkedAt) || checkedAt > nowMilliseconds || nowMilliseconds - checkedAt >= refreshMilliseconds
	})
}

export function assertSubmissionPreflightFresh(checks: readonly EndpointCheck[], settings: OperatorSettings, nowMilliseconds = Date.now()) {
	const connectivity = settings.connectivity
	if (connectivity === undefined) throw new EndpointCheckFailure('Submission preflight evidence does not match the configured submission network', checks)
	const privateMode = settings.submission.mode === 'private'
	const expectedKind = privateMode ? 'private-relay' : 'public-rpc'
	const expectedTargets = (privateMode ? settings.submission.relayUrls : connectivity.publicRpcUrls).map(url => new URL(url).origin).sort()
	const actualTargets = checks.map(check => check.target).sort()
	if (expectedTargets.length === 0 || actualTargets.length !== expectedTargets.length || actualTargets.some((target, index) => target !== expectedTargets[index])) {
		throw new EndpointCheckFailure('Submission preflight evidence does not match the exact configured targets', checks)
	}
	const expectedAuthenticationAddress = privateMode && settings.privateKey !== undefined ? privateKeyToAccount(settings.privateKey).address.toLowerCase() : undefined
	const incompatibleCheck = checks.find(check => {
		const authenticationMatches = privateMode ? expectedAuthenticationAddress !== undefined && check.authenticatedAddress?.toLowerCase() === expectedAuthenticationAddress : check.authenticatedAddress === undefined
		const degradedWithoutChainEvidence = check.status === 'failed' && check.failureDisposition === 'connectivity-degraded' && check.chainId === undefined
		const malformedFailedEvidence = check.status === 'failed' && (check.error === undefined || check.error.trim() === '')
		const malformedHealthyEvidence = check.status === 'healthy' && (check.error !== undefined || check.failureDisposition !== undefined)
		return !authenticationMatches || check.kind !== expectedKind || malformedFailedEvidence || malformedHealthyEvidence || (!degradedWithoutChainEvidence && check.chainId !== settings.network.chainId)
	})
	if (incompatibleCheck !== undefined) throw new EndpointCheckFailure('Submission preflight evidence does not match the configured chain, mode, or signer', checks)
	const refreshMilliseconds = submissionPreflightRefreshMilliseconds(settings)
	const staleCheck = checks.find(check => {
		const checkedAt = Date.parse(check.checkedAt)
		return !Number.isFinite(checkedAt) || checkedAt > nowMilliseconds || nowMilliseconds - checkedAt >= refreshMilliseconds
	})
	if (staleCheck !== undefined) {
		throw new EndpointCheckFailure('Submission preflight completed with stale endpoint evidence', checks)
	}
	const safetyFailure = checks.find(check => check.status === 'failed' && check.failureDisposition !== 'connectivity-degraded')
	if (safetyFailure !== undefined) throw new EndpointCheckFailure('Submission preflight completed with unsafe endpoint evidence', checks)
	const requiredHealthyOriginCount = privateMode ? settings.submission.minimumBundleRelaySuccesses : 1
	const healthyOriginCount = new Set(checks.filter(check => check.status === 'healthy').map(check => check.target)).size
	if (healthyOriginCount < requiredHealthyOriginCount) throw new EndpointCheckFailure('Submission preflight did not meet its healthy endpoint threshold', checks)
	return checks
}

export async function recordEndpointPreflightChecks(run: () => Promise<readonly EndpointCheck[]>, recordChecks: (checks: readonly EndpointCheck[]) => void) {
	try {
		const checks = await run()
		recordChecks(checks)
		return checks
	} catch (error) {
		if (error instanceof EndpointCheckFailure) recordChecks(error.checks)
		throw error
	}
}

export type SubmissionPreflightResources = {
	submissionPreflightConfigurationIdentity: string | undefined
	submissionPreflightChecks: readonly EndpointCheck[]
	/** When a dry-run refresh last failed, so unhealthy endpoints are re-probed at the refresh cadence rather than every scan. */
	submissionPreflightFailedAt?: number | undefined
}

export type SubmissionReadinessOutcome = 'current' | 'deferred' | 'failed' | 'refreshed' | 'skipped'

/**
 * Keeps submission evidence current in both execution modes, so the Execution mode checklist can be satisfied before
 * the bot is armed instead of only after. Live mode keeps its strict behaviour: a failed refresh is an error for the
 * scan cycle. Dry run records the failed checks as evidence, retries at the refresh cadence, and skips a private-relay
 * probe until a signer is loaded, since the relay evidence must authenticate the account that will submit.
 */
export async function refreshSubmissionReadiness(resources: SubmissionPreflightResources, settings: OperatorSettings, options: { nowMilliseconds?: number; preflight?: (settings: OperatorSettings) => Promise<readonly EndpointCheck[]> } = {}): Promise<SubmissionReadinessOutcome> {
	const nowMilliseconds = options.nowMilliseconds ?? Date.now()
	const configurationIdentity = submissionPreflightConfigurationIdentity(settings)
	const identityChanged = resources.submissionPreflightConfigurationIdentity !== configurationIdentity
	if (!identityChanged && !submissionPreflightIsDue(resources.submissionPreflightChecks, settings, nowMilliseconds)) return 'current'
	if (!settings.runtime.execute) {
		if (settings.submission.mode === 'private' && settings.privateKey === undefined) return 'skipped'
		if (!identityChanged && resources.submissionPreflightFailedAt !== undefined && nowMilliseconds - resources.submissionPreflightFailedAt < submissionPreflightRefreshMilliseconds(settings)) return 'deferred'
	}
	try {
		await recordEndpointPreflightChecks(
			async () => await (options.preflight ?? preflightTransactionSubmissionNetwork)(settings),
			checks => {
				resources.submissionPreflightConfigurationIdentity = configurationIdentity
				resources.submissionPreflightChecks = checks
			},
		)
	} catch (error) {
		if (settings.runtime.execute) throw error
		resources.submissionPreflightConfigurationIdentity = configurationIdentity
		resources.submissionPreflightFailedAt = nowMilliseconds
		return 'failed'
	}
	resources.submissionPreflightFailedAt = undefined
	return 'refreshed'
}
