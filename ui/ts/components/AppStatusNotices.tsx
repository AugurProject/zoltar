import { NoticeStack } from './NoticeStack.js'
import { TimestampValue } from './TimestampValue.js'
import { UI_STRINGS } from '../lib/uiStrings.js'
import { formatUniverseLabel } from '../lib/universe.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'
import type { NoticeItem } from '../types/components.js'
import type { ReadBackendStatus } from '../lib/chainBackend.js'

type AppStatusNoticesProps = {
	errorMessage: string | undefined
	readBackendMessage: string | undefined
	readBackendStatus?: ReadBackendStatus | undefined
	simulationBootstrapError: string | undefined
	showAugurPlaceHolderDeploymentWarning: boolean
	showZoltarUniverseForkedWarning: boolean
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

function formatRpcSourceLabel(source: ReadBackendStatus['rpcSource']) {
	if (source === 'url') return UI_STRINGS.appStatusNotices.pageUrlRpcSourceLabel
	if (source === 'localStorage') return UI_STRINGS.appStatusNotices.localStorageRpcSourceLabel
	if (source === 'environment') return UI_STRINGS.appStatusNotices.environmentRpcSourceLabel
	if (source === 'global') return UI_STRINGS.appStatusNotices.globalRuntimeRpcSourceLabel
	if (source === 'override') return UI_STRINGS.appStatusNotices.explicitOverrideRpcSourceLabel
	return UI_STRINGS.appStatusNotices.defaultRpcSourceLabel
}

function getConfiguredRpcLabel(readBackendStatus: ReadBackendStatus) {
	return readBackendStatus.transportMode === 'provider' ? UI_STRINGS.appStatusNotices.configuredFallbackReadRpcLabel : UI_STRINGS.appStatusNotices.activeReadRpcLabel
}

function getReadBackendNoticeDetail(readBackendMessage: string) {
	if (readBackendMessage.includes('stale')) return `${readBackendMessage} ${UI_STRINGS.appStatusNotices.staleReadBackendSuffix}`
	return `${readBackendMessage} ${UI_STRINGS.appStatusNotices.readBackendMismatchSuffix}`
}

function buildRpcOverrideNotice(readBackendStatus: ReadBackendStatus | undefined): NoticeItem | undefined {
	if (readBackendStatus === undefined) return undefined
	if (readBackendStatus.rejectedRpcOverride !== undefined) {
		const rejectedOverride = readBackendStatus.rejectedRpcOverride
		const configuredRpcLabel = getConfiguredRpcLabel(readBackendStatus)
		return {
			detail: UI_STRINGS.appStatusNotices.readRpcOverrideIgnoredDetail(formatRpcSourceLabel(rejectedOverride.source), rejectedOverride.url, rejectedOverride.reason, configuredRpcLabel, readBackendStatus.rpcUrl),
			id: 'read-rpc-override-ignored',
			tone: 'warning',
			title: UI_STRINGS.appStatusNotices.ignoredReadRpcOverrideTitle,
		}
	}
	if (readBackendStatus.rpcSource === 'url')
		return {
			detail: UI_STRINGS.appStatusNotices.readRpcOverrideFromUrlDetail(getConfiguredRpcLabel(readBackendStatus), readBackendStatus.rpcUrl),
			id: 'url-read-rpc-override',
			tone: 'warning',
			title: UI_STRINGS.appStatusNotices.urlProvidedReadRpcTitle,
		}
	if (readBackendStatus.rpcSource === 'default') return undefined
	return {
		detail: UI_STRINGS.appStatusNotices.readRpcOverrideActiveDetail(getConfiguredRpcLabel(readBackendStatus), formatRpcSourceLabel(readBackendStatus.rpcSource), readBackendStatus.rpcUrl),
		id: 'read-rpc-override-active',
		tone: 'pending',
		title: UI_STRINGS.appStatusNotices.readRpcOverrideActiveTitle,
	}
}

export function AppStatusNotices({ errorMessage, readBackendMessage, readBackendStatus, simulationBootstrapError, showAugurPlaceHolderDeploymentWarning, showZoltarUniverseForkedWarning, zoltarUniverse }: AppStatusNoticesProps) {
	const items: NoticeItem[] = []
	const rpcOverrideNotice = buildRpcOverrideNotice(readBackendStatus)
	if (simulationBootstrapError !== undefined) items.push({ detail: simulationBootstrapError, id: 'simulation-bootstrap-error', tone: 'blocking', title: UI_STRINGS.appStatusNotices.simulationBootstrapFailedTitle })
	if (showZoltarUniverseForkedWarning && zoltarUniverse !== undefined)
		items.push({
			detail: (
				<>
					{formatUniverseLabel(zoltarUniverse.universeId)} {UI_STRINGS.appStatusNotices.universeForkedOnDetailSuffix} <TimestampValue timestamp={zoltarUniverse.forkTime} />.
				</>
			),
			id: 'zoltar-forked',
			tone: 'blocking',
			title: UI_STRINGS.appStatusNotices.universeForkedTitle,
		})
	if (showAugurPlaceHolderDeploymentWarning) items.push({ detail: UI_STRINGS.appStatusNotices.finishSetupBeforeUsingAppDetail, id: 'setup-incomplete', tone: 'blocking', title: UI_STRINGS.appStatusNotices.setupIncompleteTitle })
	if (readBackendMessage !== undefined) items.push({ detail: getReadBackendNoticeDetail(readBackendMessage), id: 'read-backend-mismatch', tone: 'blocking', title: UI_STRINGS.appStatusNotices.readRpcMismatchTitle })
	if (errorMessage !== undefined) items.push({ detail: errorMessage, id: 'app-error', tone: 'blocking', title: UI_STRINGS.appStatusNotices.appErrorTitle })
	if (rpcOverrideNotice !== undefined) items.push(rpcOverrideNotice)

	return <NoticeStack items={items} />
}
