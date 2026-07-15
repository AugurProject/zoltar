import { NoticeStack } from './NoticeStack.js'
import { TimestampValue } from './TimestampValue.js'
import {
	UI_STRING_ACTIVE_READ_RPC,
	UI_STRING_CONFIGURED_FALLBACK_READ_RPC,
	UI_STRING_DEFAULT,
	UI_STRING_DISPLAYED_ONCHAIN_STATE_MAY_BE_BEHIND_THE_LATEST_CHAIN_STATE_REFRESH_OR_SWITCH_RPC_BEFORE_ACTING_ON_BALANCES_SETTLEMENT_OR_LIQUIDATION,
	UI_STRING_DISPLAYED_ONCHAIN_STATE_MAY_NOT_MATCH_THE_NETWORK_THIS_INTERFACE_WRITES_TO,
	UI_STRING_ENVIRONMENT,
	UI_STRING_ERROR,
	UI_STRING_EXPLICIT_OVERRIDE,
	UI_STRING_GLOBAL_RUNTIME,
	UI_STRING_HAS_FORKED_ON,
	UI_STRING_LOCAL_STORAGE,
	UI_STRING_PAGE_URL,
	UI_STRING_READ_RPC_MISMATCH,
	UI_STRING_READ_RPC_OVERRIDE_ACTIVE,
	UI_STRING_READ_RPC_OVERRIDE_IGNORED,
	UI_STRING_REQUIRED_APPLICATION_CONTRACTS_ARE_NOT_DEPLOYED,
	UI_STRING_SETUP_INCOMPLETE,
	UI_STRING_SIMULATION_BOOTSTRAP_FAILED,
	UI_STRING_UNIVERSE_FORKED,
	UI_STRING_URL_PROVIDED_READ_RPC,
	UI_TEMPLATE_READ_RPC_OVERRIDE_ACTIVE_DETAIL,
	UI_TEMPLATE_READ_RPC_OVERRIDE_FROM_URL_DETAIL,
	UI_TEMPLATE_READ_RPC_OVERRIDE_IGNORED_DETAIL,
} from '../lib/uiStrings.js'
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
	if (source === 'url') return UI_STRING_PAGE_URL
	if (source === 'localStorage') return UI_STRING_LOCAL_STORAGE
	if (source === 'environment') return UI_STRING_ENVIRONMENT
	if (source === 'global') return UI_STRING_GLOBAL_RUNTIME
	if (source === 'override') return UI_STRING_EXPLICIT_OVERRIDE
	return UI_STRING_DEFAULT
}

function getConfiguredRpcLabel(readBackendStatus: ReadBackendStatus) {
	return readBackendStatus.transportMode === 'provider' ? UI_STRING_CONFIGURED_FALLBACK_READ_RPC : UI_STRING_ACTIVE_READ_RPC
}

function getReadBackendNoticeDetail(readBackendMessage: string) {
	if (readBackendMessage.includes('stale')) return `${readBackendMessage} ${UI_STRING_DISPLAYED_ONCHAIN_STATE_MAY_BE_BEHIND_THE_LATEST_CHAIN_STATE_REFRESH_OR_SWITCH_RPC_BEFORE_ACTING_ON_BALANCES_SETTLEMENT_OR_LIQUIDATION}`
	return `${readBackendMessage} ${UI_STRING_DISPLAYED_ONCHAIN_STATE_MAY_NOT_MATCH_THE_NETWORK_THIS_INTERFACE_WRITES_TO}`
}

function buildRpcOverrideNotice(readBackendStatus: ReadBackendStatus | undefined): NoticeItem | undefined {
	if (readBackendStatus === undefined) return undefined
	if (readBackendStatus.rejectedRpcOverride !== undefined) {
		const rejectedOverride = readBackendStatus.rejectedRpcOverride
		const configuredRpcLabel = getConfiguredRpcLabel(readBackendStatus)
		return {
			detail: UI_TEMPLATE_READ_RPC_OVERRIDE_IGNORED_DETAIL(formatRpcSourceLabel(rejectedOverride.source), rejectedOverride.url, rejectedOverride.reason, configuredRpcLabel, readBackendStatus.rpcUrl),
			id: 'read-rpc-override-ignored',
			tone: 'warning',
			title: UI_STRING_READ_RPC_OVERRIDE_IGNORED,
		}
	}
	if (readBackendStatus.rpcSource === 'url')
		return {
			detail: UI_TEMPLATE_READ_RPC_OVERRIDE_FROM_URL_DETAIL(getConfiguredRpcLabel(readBackendStatus), readBackendStatus.rpcUrl),
			id: 'url-read-rpc-override',
			tone: 'warning',
			title: UI_STRING_URL_PROVIDED_READ_RPC,
		}
	if (readBackendStatus.rpcSource === 'default') return undefined
	return {
		detail: UI_TEMPLATE_READ_RPC_OVERRIDE_ACTIVE_DETAIL(getConfiguredRpcLabel(readBackendStatus), formatRpcSourceLabel(readBackendStatus.rpcSource), readBackendStatus.rpcUrl),
		id: 'read-rpc-override-active',
		tone: 'pending',
		title: UI_STRING_READ_RPC_OVERRIDE_ACTIVE,
	}
}

export function AppStatusNotices({ errorMessage, readBackendMessage, readBackendStatus, simulationBootstrapError, showAugurPlaceHolderDeploymentWarning, showZoltarUniverseForkedWarning, zoltarUniverse }: AppStatusNoticesProps) {
	const items: NoticeItem[] = []
	const rpcOverrideNotice = buildRpcOverrideNotice(readBackendStatus)
	if (simulationBootstrapError !== undefined) items.push({ detail: simulationBootstrapError, id: 'simulation-bootstrap-error', tone: 'blocking', title: UI_STRING_SIMULATION_BOOTSTRAP_FAILED })
	if (showZoltarUniverseForkedWarning && zoltarUniverse !== undefined)
		items.push({
			detail: (
				<>
					{formatUniverseLabel(zoltarUniverse.universeId)} {UI_STRING_HAS_FORKED_ON} <TimestampValue timestamp={zoltarUniverse.forkTime} />.
				</>
			),
			id: 'zoltar-forked',
			tone: 'blocking',
			title: UI_STRING_UNIVERSE_FORKED,
		})
	if (showAugurPlaceHolderDeploymentWarning) items.push({ detail: UI_STRING_REQUIRED_APPLICATION_CONTRACTS_ARE_NOT_DEPLOYED, id: 'setup-incomplete', tone: 'blocking', title: UI_STRING_SETUP_INCOMPLETE })
	if (readBackendMessage !== undefined) items.push({ detail: getReadBackendNoticeDetail(readBackendMessage), id: 'read-backend-mismatch', tone: 'blocking', title: UI_STRING_READ_RPC_MISMATCH })
	if (errorMessage !== undefined) items.push({ detail: errorMessage, id: 'app-error', tone: 'blocking', title: UI_STRING_ERROR })
	if (rpcOverrideNotice !== undefined) items.push(rpcOverrideNotice)

	return <NoticeStack items={items} />
}
