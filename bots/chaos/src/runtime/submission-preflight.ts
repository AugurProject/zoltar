import { privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { checkPrivateTransactionSubmissionEndpoints, checkPublicTransactionSubmissionEndpoints, type EndpointCheck } from '@zoltar/bot-shared/monitoring/connectivity'
import type { OperatorSettings } from '../config/settings.ts'

function submissionSigner(settings: OperatorSettings) {
	if (settings.privateKey === undefined) throw new Error('Private submission capability preflight requires the configured transaction signer')
	return privateKeyToAccount(settings.privateKey)
}

export async function preflightTransactionSubmissionNetwork(settings: OperatorSettings) {
	const connectivity = settings.connectivity
	if (connectivity === undefined) throw new Error('Submission preflight requires configured connectivity')
	if (settings.submission.mode === 'private') {
		const account = submissionSigner(settings)
		return await checkPrivateTransactionSubmissionEndpoints(settings.submission, settings.network.chainId, { address: account.address, signMessage: account.signMessage })
	}
	return await checkPublicTransactionSubmissionEndpoints(connectivity.publicRpcUrls, settings.network.chainId)
}

export function submissionPreflightConfigurationIdentity(settings: OperatorSettings) {
	const connectivity = settings.connectivity
	const privateMode = settings.submission.mode === 'private'
	const targets = privateMode ? settings.submission.relayUrls : (connectivity?.publicRpcUrls ?? [])
	const authenticatedAddress = privateMode && settings.privateKey !== undefined ? privateKeyToAccount(settings.privateKey).address : undefined
	return JSON.stringify([settings.network.chainId, settings.submission.mode, settings.submission.minimumBundleRelaySuccesses, authenticatedAddress, ...targets])
}

export function submissionPreflightIsDue(checks: readonly EndpointCheck[], settings: OperatorSettings, nowMilliseconds = Date.now()) {
	const connectivity = settings.connectivity
	if (connectivity === undefined) return true
	const privateMode = settings.submission.mode === 'private'
	const expectedKind = privateMode ? 'private-relay' : 'public-rpc'
	const expectedTargets = (privateMode ? settings.submission.relayUrls : connectivity.publicRpcUrls).map(url => new URL(url).origin).sort()
	const actualTargets = checks.map(check => check.target).sort()
	if (expectedTargets.length === 0 || actualTargets.length !== expectedTargets.length || actualTargets.some((target, index) => target !== expectedTargets[index])) return true
	const expectedAuthenticationAddress = privateMode && settings.privateKey !== undefined ? privateKeyToAccount(settings.privateKey).address.toLowerCase() : undefined
	const refreshMilliseconds = Math.max(settings.runtime.lifecyclePollMilliseconds * 2, settings.network.maximumBlockIntervalSeconds * 2_000)
	return checks.some(check => {
		const checkedAt = Date.parse(check.checkedAt)
		const authenticationMatches = privateMode ? expectedAuthenticationAddress !== undefined && check.authenticatedAddress?.toLowerCase() === expectedAuthenticationAddress : check.authenticatedAddress === undefined
		return !authenticationMatches || check.kind !== expectedKind || check.status !== 'healthy' || check.chainId !== settings.network.chainId || !Number.isFinite(checkedAt) || checkedAt > nowMilliseconds || nowMilliseconds - checkedAt >= refreshMilliseconds
	})
}
