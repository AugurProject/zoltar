import { $, element, number, time, exactTimestamp } from './view-presentation.ts'
import { type CanonicalRecovery, type NetworkRecord } from './browser-types.ts'
import { canReuseNetworkStatusPresentation, indexerHeadFreshness, indexerHeadFreshnessTransitionDelay, indexerLagLabel, indexerProgressEstimate, showIndexerSyncDetails } from './live-update.ts'

type NetworkStatusViewContext = {
	latestNetworks: NetworkRecord[]
	selectedChainId: () => string
	invalidateAddressIdentityCache: (chainId: string, missesOnly?: boolean) => void
	serverClockOffsetMs: number
	networkCards: HTMLElement
	activeReorgRecovery: CanonicalRecovery | undefined
	polledReorgRefreshTimer: number | undefined
	refreshCanonicalViews: (title: string, detail: string) => Promise<boolean>
	awaitingResumedNetworkStatus: boolean
	updateConnectionStatus: () => void
	indexerProgressSamples: Map<string, { indexedBlock: number; sampledAt: number; blocksPerSecond?: number }>
	setLiveRecord: <T extends HTMLElement>(node: T, key: string, value: unknown) => T
	headFreshnessState: (stale: boolean) => 'stale' | 'current'
	networkBadgeLabel: (phase: string, stale: boolean, awaitingResumedNetworkStatus: boolean) => string
	age: (value: string | number | Date | null | undefined) => string
	progressCompletionLabel: (progress: { percentage: string | undefined; eta: string }) => string
	until: (value: string | number | Date | null | undefined) => string
	headFreshnessTimer: number | undefined
	lastNetworkRequestFailed: boolean
	canonicalRefreshRequired: boolean
	networkFreshnessThresholdMs: number
}

export function createNetworkStatusView(context: NetworkStatusViewContext) {
	const renderNetworks = (networks: NetworkRecord[]) => {
		const previouslySelectedNetwork = context.latestNetworks.find(network => String(network.chain_id) === context.selectedChainId())
		let selectedReorgAdvanced = false
		for (const network of networks) {
			const previous = context.latestNetworks.find(item => String(item.chain_id) === String(network.chain_id))
			const reorgAdvanced = previous && network.last_reorg_at && previous.last_reorg_at !== network.last_reorg_at
			if (reorgAdvanced) {
				context.invalidateAddressIdentityCache(network.chain_id)
				if (String(network.chain_id) === context.selectedChainId()) selectedReorgAdvanced = true
			} else if (previous && previous.indexed_hash !== network.indexed_hash) context.invalidateAddressIdentityCache(network.chain_id, true)
		}
		context.latestNetworks = networks
		const selectedNetwork = networks.find(item => String(item.chain_id) === context.selectedChainId())
		const currentTime = Date.now() + context.serverClockOffsetMs
		const selectedHeadFreshness = selectedNetwork === undefined ? undefined : indexerHeadFreshness(selectedNetwork, currentTime)
		const renderedNetworkCard = context.networkCards.querySelector<HTMLElement>('.network-card[data-live-key]')
		if (selectedReorgAdvanced && context.activeReorgRecovery !== undefined) context.activeReorgRecovery.pendingRefresh = true
		else if (selectedReorgAdvanced && context.polledReorgRefreshTimer === undefined) {
			const chainId = context.selectedChainId()
			context.polledReorgRefreshTimer = window.setTimeout(() => {
				context.polledReorgRefreshTimer = undefined
				if (context.selectedChainId() === chainId && context.activeReorgRecovery === undefined) void context.refreshCanonicalViews('Canonical history reset detected', 'Address identities and views are refreshing from the latest data.')
			}, 0)
		}
		if (
			!context.awaitingResumedNetworkStatus &&
			previouslySelectedNetwork !== undefined &&
			selectedNetwork !== undefined &&
			selectedHeadFreshness !== undefined &&
			canReuseNetworkStatusPresentation(previouslySelectedNetwork, selectedNetwork, renderedNetworkCard?.dataset.liveKey, renderedNetworkCard?.dataset.headFreshness, String(selectedNetwork.chain_id), selectedHeadFreshness.stale ? 'stale' : 'current')
		) {
			context.networkCards.setAttribute('aria-busy', 'false')
			context.updateConnectionStatus()
			return
		}
		context.networkCards.classList.remove('empty')
		context.networkCards.replaceChildren()
		for (const network of selectedNetwork === undefined ? [] : [selectedNetwork]) {
			const headFreshness = indexerHeadFreshness(network, currentTime)
			const progress = indexerProgressEstimate(network, context.indexerProgressSamples.get(String(network.chain_id)), currentTime)
			if (progress.sample !== undefined) context.indexerProgressSamples.set(String(network.chain_id), progress.sample)
			const card = context.setLiveRecord(element('article', 'network-card'), String(network.chain_id), {
				indexedBlock: network.indexed_block,
				indexedHash: network.indexed_hash,
				indexedTimestamp: network.indexed_timestamp,
				observedBlock: network.observed_block,
				phase: network.phase,
				failures: network.consecutive_failures,
			})
			card.dataset.phase = network.phase
			card.dataset.headFreshness = context.awaitingResumedNetworkStatus ? 'refreshing' : context.headFreshnessState(headFreshness.stale)
			const title = element('div', 'network-title')
			const badge = element('span', 'badge', context.networkBadgeLabel(network.phase, headFreshness.stale, context.awaitingResumedNetworkStatus))
			title.append(badge)
			const block = element(network.indexed_block && network.explorer_base_url ? 'a' : 'p', 'block-number', network.indexed_block ? `#${number(network.indexed_block)}` : 'Awaiting first block')
			if (block instanceof HTMLAnchorElement) {
				block.href = `${String(network.explorer_base_url).replace(/\/$/, '')}/block/${network.indexed_block}`
				block.target = '_blank'
				block.rel = 'noreferrer'
				block.title = `Open block ${network.indexed_block} in the network explorer`
			}
			const meta = element('div', 'block-meta')
			const indexedTime = element('time', '', network.indexed_timestamp ? `${exactTimestamp(network.indexed_timestamp).slice(0, 10)} · ${time(network.indexed_timestamp)} UTC` : 'No timestamp')
			if (network.indexed_timestamp) indexedTime.dateTime = exactTimestamp(network.indexed_timestamp)
			indexedTime.title = exactTimestamp(network.indexed_timestamp)
			const ageNode = element('span', 'age', context.age(network.indexed_timestamp))
			ageNode.dataset.time = network.indexed_timestamp ?? ''
			ageNode.title = exactTimestamp(network.indexed_timestamp)
			const lag = indexerLagLabel(network)
			const displaySyncDetails = showIndexerSyncDetails(network, currentTime)
			meta.append(indexedTime, ageNode)
			if (displaySyncDetails) meta.append(element('span', '', lag))
			const progressLabel = headFreshness.stale ? `${progress.percentage ?? '100.00'}% indexed · RPC head ${context.age(network.indexed_timestamp).replace(/ ago$/, '')} old (limit 1m)` : context.progressCompletionLabel(progress)
			title.prepend(block)
			card.append(title, meta)
			if (displaySyncDetails && !context.awaitingResumedNetworkStatus) card.append(element('p', 'network-progress', progressLabel))
			if (Number(network.consecutive_failures) > 0) {
				const retry = network.next_retry_at ? `next retry ${context.until(network.next_retry_at)}` : 'retry scheduled'
				card.append(element('p', 'network-retry', `${number(network.consecutive_failures)} consecutive failures · ${retry}`))
			}
			if (network.last_error) card.append(element('p', 'network-error', network.last_error))
			context.networkCards.append(card)
		}
		if (context.headFreshnessTimer !== undefined) clearTimeout(context.headFreshnessTimer)
		context.headFreshnessTimer = undefined
		if (selectedNetwork !== undefined) {
			const transitionDelay = indexerHeadFreshnessTransitionDelay(selectedNetwork, currentTime)
			if (transitionDelay !== undefined) {
				context.headFreshnessTimer = window.setTimeout(
					() => {
						context.headFreshnessTimer = undefined
						renderNetworks(context.latestNetworks)
						updateFreshness()
					},
					Math.min(transitionDelay, 2_147_483_647),
				)
			}
		}
		context.networkCards.setAttribute('aria-busy', String(context.awaitingResumedNetworkStatus && !context.lastNetworkRequestFailed))
		context.updateConnectionStatus()
	}

	const updateFreshness = () => {
		if (context.activeReorgRecovery !== undefined) return
		delete $('#freshness-banner').dataset.status
		if (context.canonicalRefreshRequired) {
			const banner = $('#freshness-banner')
			banner.hidden = false
			$('#freshness-title').textContent = 'Chain update refresh incomplete'
			$('#freshness-detail').textContent = 'A chain update was recorded, but the content refresh failed. Retrying automatically.'
			return
		}
		if (context.awaitingResumedNetworkStatus) {
			$('#freshness-banner').dataset.status = context.lastNetworkRequestFailed ? 'failed' : 'refreshing'
			$('#freshness-banner').hidden = false
			$('#freshness-title').textContent = context.lastNetworkRequestFailed ? 'Unable to refresh status' : 'Refreshing status…'
			$('#freshness-detail').textContent = context.lastNetworkRequestFailed ? 'Retrying automatically.' : ''
			return
		}
		if (context.lastNetworkRequestFailed) {
			$('#freshness-banner').hidden = true
			return
		}
		const staleHead = context.latestNetworks.filter(network => String(network.chain_id) === context.selectedChainId()).find(network => indexerHeadFreshness(network, Date.now() + context.serverClockOffsetMs).stale)
		if (staleHead !== undefined) {
			const banner = $('#freshness-banner')
			banner.hidden = false
			$('#freshness-title').textContent = 'RPC chain head is stale'
			$('#freshness-detail').textContent = `Newest observed block is ${context.age(staleHead.indexed_timestamp)}; block-based catch-up status may be misleading.`
			return
		}
		const stale = context.latestNetworks.filter(network => String(network.chain_id) === context.selectedChainId()).filter(network => !network.last_success_at || Date.now() + context.serverClockOffsetMs - new Date(network.last_success_at).getTime() > context.networkFreshnessThresholdMs)
		const banner = $('#freshness-banner')
		if (stale.length === 0) {
			banner.hidden = true
			return
		}
		banner.hidden = false
		$('#freshness-title').textContent = 'Selected network is not updating'
		$('#freshness-detail').textContent = 'Showing the last committed database state.'
	}
	return { updateFreshness, renderNetworks }
}
