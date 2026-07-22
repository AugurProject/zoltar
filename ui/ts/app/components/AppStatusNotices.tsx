import * as appCopy from '../../copy/app.js'
import * as commonCopy from '../../copy/common.js'
import { NoticeStack } from '../../components/NoticeStack.js'
import type { NoticeItem } from '../../types/components.js'
import type { ReadBackendStatus } from '../../lib/chainBackend.js'

type AppStatusNoticesProps = {
	errorMessage: string | undefined
	readBackendMessage: string | undefined
	readBackendStatus?: ReadBackendStatus | undefined
	simulationBootstrapError: string | undefined
	showAugurStatoblastDeploymentWarning: boolean
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

function getReadBackendNoticeDetail(readBackendMessage: string) {
	if (readBackendMessage.includes('stale')) return `${readBackendMessage} ${appCopy.staleReadBackendDetail}`
	return `${readBackendMessage} ${appCopy.readWriteNetworkMismatchDetail}`
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
		technicalDetails: appCopy.formatReadRpcOverrideActiveDetail(getConfiguredRpcLabel(readBackendStatus), formatRpcSourceLabel(readBackendStatus.rpcSource), readBackendStatus.rpcUrl),
		tone: 'pending',
		title: appCopy.readRpcOverrideActive,
	}
}

export function AppStatusNotices({ errorMessage, readBackendMessage, readBackendStatus, simulationBootstrapError, showAugurStatoblastDeploymentWarning }: AppStatusNoticesProps) {
	const items: NoticeItem[] = []
	const rpcOverrideNotice = buildRpcOverrideNotice(readBackendStatus)
	if (simulationBootstrapError !== undefined) items.push({ detail: simulationBootstrapError, id: 'simulation-bootstrap-error', tone: 'blocking', title: appCopy.simulationBootstrapFailed })
	if (showAugurStatoblastDeploymentWarning) items.push({ detail: appCopy.deploymentIncompleteReason, id: 'setup-incomplete', tone: 'blocking', title: appCopy.setupIncomplete })
	if (readBackendMessage !== undefined) items.push({ detail: getReadBackendNoticeDetail(readBackendMessage), id: 'read-backend-mismatch', tone: 'blocking', title: appCopy.readRpcMismatch })
	if (errorMessage !== undefined) items.push({ detail: errorMessage, id: 'app-error', tone: 'blocking', title: commonCopy.error })
	if (rpcOverrideNotice !== undefined) items.push(rpcOverrideNotice)

	return <NoticeStack items={items} />
}
