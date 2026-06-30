import { NoticeStack } from './NoticeStack.js'
import { TimestampValue } from './TimestampValue.js'
import { formatUniverseLabel } from '../lib/universe.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'
import type { NoticeItem } from '../types/components.js'
import type { ReadBackendStatus } from '../lib/chainBackend.js'

type AppStatusNoticesProps = {
	errorMessage: string | undefined
	readBackendMessage: string | undefined
	readBackendStatus?: ReadBackendStatus | undefined
	wrongNetworkMessage: string | undefined
	simulationBootstrapError: string | undefined
	showAugurPlaceHolderDeploymentWarning: boolean
	showZoltarUniverseForkedWarning: boolean
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

function formatRpcSourceLabel(source: ReadBackendStatus['rpcSource']) {
	if (source === 'url') return 'page URL'
	if (source === 'localStorage') return 'local storage'
	if (source === 'environment') return 'environment'
	if (source === 'global') return 'global runtime'
	if (source === 'override') return 'explicit override'
	return 'default'
}

function getConfiguredRpcLabel(readBackendStatus: ReadBackendStatus) {
	return readBackendStatus.transportMode === 'provider' ? 'Configured fallback read RPC' : 'Active read RPC'
}

function buildRpcOverrideNotice(readBackendStatus: ReadBackendStatus | undefined): NoticeItem | undefined {
	if (readBackendStatus === undefined) return undefined
	if (readBackendStatus.rejectedRpcOverride !== undefined) {
		const rejectedOverride = readBackendStatus.rejectedRpcOverride
		return {
			detail: `Ignored ${formatRpcSourceLabel(rejectedOverride.source)} RPC override (${rejectedOverride.url}): ${rejectedOverride.reason} ${getConfiguredRpcLabel(readBackendStatus)} is ${readBackendStatus.rpcUrl}.`,
			id: 'read-rpc-override-ignored',
			tone: 'warning',
			title: 'Read RPC override ignored',
		}
	}
	if (readBackendStatus.rpcSource === 'url')
		return {
			detail: `${getConfiguredRpcLabel(readBackendStatus)} came from the page URL: ${readBackendStatus.rpcUrl}. Verify this endpoint before relying on displayed onchain state.`,
			id: 'url-read-rpc-override',
			tone: 'warning',
			title: 'URL-provided read RPC',
		}
	if (readBackendStatus.rpcSource === 'default') return undefined
	return {
		detail: `${getConfiguredRpcLabel(readBackendStatus)} came from ${formatRpcSourceLabel(readBackendStatus.rpcSource)}: ${readBackendStatus.rpcUrl}. Verify this endpoint before relying on displayed onchain state.`,
		id: 'read-rpc-override-active',
		tone: 'pending',
		title: 'Read RPC override active',
	}
}

export function AppStatusNotices({ errorMessage, readBackendMessage, readBackendStatus, wrongNetworkMessage, simulationBootstrapError, showAugurPlaceHolderDeploymentWarning, showZoltarUniverseForkedWarning, zoltarUniverse }: AppStatusNoticesProps) {
	const items: NoticeItem[] = []
	const rpcOverrideNotice = buildRpcOverrideNotice(readBackendStatus)
	if (simulationBootstrapError !== undefined) items.push({ detail: simulationBootstrapError, id: 'simulation-bootstrap-error', tone: 'blocking', title: 'Simulation bootstrap failed' })
	if (showZoltarUniverseForkedWarning && zoltarUniverse !== undefined)
		items.push({
			detail: (
				<>
					{formatUniverseLabel(zoltarUniverse.universeId)} has forked on <TimestampValue timestamp={zoltarUniverse.forkTime} />.
				</>
			),
			id: 'zoltar-forked',
			tone: 'blocking',
			title: 'Universe forked',
		})
	if (showAugurPlaceHolderDeploymentWarning) items.push({ detail: 'Finish setup in Deploy before using the app.', id: 'setup-incomplete', tone: 'blocking', title: 'Setup incomplete' })
	if (wrongNetworkMessage !== undefined)
		items.push({
			detail: `This interface only enables contract interactions on Ethereum mainnet. ${wrongNetworkMessage === 'Switch to Ethereum mainnet.' ? 'Switch the connected wallet network to Ethereum mainnet to continue.' : wrongNetworkMessage}`,
			id: 'wrong-network',
			tone: 'blocking',
			title: 'Wrong network',
		})
	if (readBackendMessage !== undefined) items.push({ detail: readBackendMessage, id: 'read-backend-mismatch', tone: 'blocking', title: 'Read RPC mismatch' })
	if (errorMessage !== undefined) items.push({ detail: errorMessage, id: 'app-error', tone: 'blocking', title: 'Error' })
	if (rpcOverrideNotice !== undefined) items.push(rpcOverrideNotice)

	return <NoticeStack items={items} />
}
