import { useEffect, useState } from 'preact/hooks'
import * as appCopy from '../../copy/app.js'
import * as commonCopy from '../../copy/common.js'
import { NoticeStack } from '../../components/NoticeStack.js'
import type { NoticeItem } from '../../types/components.js'
import type { ReadBackendStatus } from '../../wallet/chainBackend.js'

type AppStatusNoticesProps = {
	errorMessage?: string | undefined
	errorMessages?: readonly string[]
	loadingZoltarUniverse?: boolean
	onRetryZoltarUniverse?: (() => void) | undefined
	/** Validates an unreachable read RPC again now; without it the notice relies on the automatic retries. */
	onRetryReadBackend?: (() => void) | undefined
	readBackendMessage: string | undefined
	readBackendStatus?: ReadBackendStatus | undefined
	simulationBootstrapError: string | undefined
	showApplicationDeploymentWarning: boolean
	zoltarUniverseError?: string | undefined
}

function formatRpcSourceLabel(source: ReadBackendStatus['rpcSource']) {
	if (source === 'url') return appCopy.pageUrl
	if (source === 'localStorage') return appCopy.localStorage
	if (source === 'environment') return appCopy.environment
	if (source === 'global') return appCopy.globalRuntime
	if (source === 'override') return appCopy.explicitOverride
	return appCopy.defaultSource
}

function getConfiguredRpcLabel(readBackendStatus: ReadBackendStatus) {
	return readBackendStatus.transportMode === 'provider' ? appCopy.configuredFallbackReadRpc : appCopy.activeReadRpc
}

function buildReadBackendNotice(readBackendMessage: string, readBackendStatus: ReadBackendStatus | undefined, onRetry: (() => void) | undefined): NoticeItem {
	if (readBackendStatus?.issue === 'unreachable')
		return {
			// The route content is withheld until the read RPC responds, so the notice says so and offers a retry.
			detail: (
				<>
					<p>{`${readBackendMessage} ${appCopy.unavailableReadBackendDetail}`}</p>
					{onRetry === undefined ? undefined : (
						<div className='actions'>
							<button type='button' className='secondary' onClick={onRetry}>
								{commonCopy.retry}
							</button>
						</div>
					)}
				</>
			),
			id: 'read-backend-unreachable',
			tone: 'blocking',
			title: appCopy.readRpcUnavailable,
		}
	const stale = readBackendStatus?.issue === 'stale'
	return {
		detail: `${readBackendMessage} ${stale ? appCopy.staleReadBackendDetail : appCopy.readWriteNetworkMismatchDetail}`,
		id: stale ? 'read-backend-stale' : 'read-backend-mismatch',
		tone: 'blocking',
		title: stale ? appCopy.readRpcStale : appCopy.readRpcMismatch,
	}
}

function buildRpcOverrideNotice(readBackendStatus: ReadBackendStatus | undefined): NoticeItem | undefined {
	if (readBackendStatus === undefined) return undefined
	if (readBackendStatus.rejectedRpcOverride !== undefined) {
		const rejectedOverride = readBackendStatus.rejectedRpcOverride
		const configuredRpcLabel = getConfiguredRpcLabel(readBackendStatus)
		return {
			detail: appCopy.readRpcOverrideIgnoredDetail,
			id: 'read-rpc-override-ignored',
			technicalDetails: appCopy.formatReadRpcOverrideIgnoredDetail(formatRpcSourceLabel(rejectedOverride.source), rejectedOverride.url, rejectedOverride.reason, configuredRpcLabel, readBackendStatus.rpcUrl),
			tone: 'warning',
			title: appCopy.readRpcOverrideIgnored,
		}
	}
	if (readBackendStatus.rpcSource === 'url')
		return {
			detail: appCopy.customReadRpcWarningDetail,
			id: 'url-read-rpc-override',
			technicalDetails: appCopy.formatReadRpcOverrideFromUrlDetail(getConfiguredRpcLabel(readBackendStatus), readBackendStatus.rpcUrl),
			tone: 'warning',
			title: appCopy.urlProvidedReadRpc,
		}
	if (readBackendStatus.rpcSource === 'default') return undefined
	return {
		detail: appCopy.customReadRpcWarningDetail,
		id: 'read-rpc-override-active',
		technicalDetails:
			readBackendStatus.rpcSource === 'localStorage'
				? appCopy.formatReadRpcSavedInSettingsDetail(getConfiguredRpcLabel(readBackendStatus), readBackendStatus.rpcUrl)
				: appCopy.formatReadRpcOverrideActiveDetail(getConfiguredRpcLabel(readBackendStatus), formatRpcSourceLabel(readBackendStatus.rpcSource), readBackendStatus.rpcUrl),
		tone: 'pending',
		title: appCopy.readRpcOverrideActive,
	}
}

export function AppStatusNotices({ errorMessage, errorMessages = [], loadingZoltarUniverse = false, onRetryReadBackend, onRetryZoltarUniverse, readBackendMessage, readBackendStatus, simulationBootstrapError, showApplicationDeploymentWarning, zoltarUniverseError }: AppStatusNoticesProps) {
	const items: NoticeItem[] = []
	const distinctErrorMessages = [...new Set([errorMessage, ...errorMessages].filter((message): message is string => message !== undefined))]
	// Error reports (a failed wallet request, a refresh that did not load) can be closed; one reappears only after it clears and recurs.
	const [dismissedErrorMessages, setDismissedErrorMessages] = useState<readonly string[]>([])
	const distinctErrorKey = distinctErrorMessages.join('\n')
	useEffect(() => {
		const reported = distinctErrorKey.split('\n')
		setDismissedErrorMessages(current => {
			const stillReported = current.filter(message => reported.includes(message))
			return stillReported.length === current.length ? current : stillReported
		})
	}, [distinctErrorKey])
	const rpcOverrideNotice = buildRpcOverrideNotice(readBackendStatus)
	if (simulationBootstrapError !== undefined) items.push({ detail: simulationBootstrapError, id: 'simulation-bootstrap-error', tone: 'blocking', title: appCopy.simulationBootstrapFailed })
	if (showApplicationDeploymentWarning) items.push({ detail: appCopy.deploymentIncompleteReason, id: 'setup-incomplete', tone: 'blocking', title: appCopy.setupIncomplete })
	if (readBackendMessage !== undefined) items.push(buildReadBackendNotice(readBackendMessage, readBackendStatus, onRetryReadBackend))
	if (zoltarUniverseError !== undefined)
		items.push({
			detail: (
				<>
					<p>{zoltarUniverseError}</p>
					{onRetryZoltarUniverse === undefined ? undefined : (
						<div className='actions'>
							<button type='button' className='secondary' disabled={loadingZoltarUniverse} onClick={onRetryZoltarUniverse}>
								{loadingZoltarUniverse ? commonCopy.retrying : commonCopy.retry}
							</button>
						</div>
					)}
				</>
			),
			id: 'zoltar-universe-error',
			tone: 'blocking',
			title: commonCopy.error,
		})
	for (const [index, message] of distinctErrorMessages.entries()) {
		if (dismissedErrorMessages.includes(message)) continue
		items.push({
			detail: message,
			dismiss: { label: appCopy.dismissNotice, onDismiss: () => setDismissedErrorMessages(current => [...current, message]) },
			id: `app-error-${index.toString()}`,
			tone: 'blocking',
			title: commonCopy.error,
		})
	}
	if (rpcOverrideNotice !== undefined) items.push(rpcOverrideNotice)

	return <NoticeStack items={items} />
}
