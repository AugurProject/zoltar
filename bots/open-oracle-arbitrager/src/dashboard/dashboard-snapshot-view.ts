import type { PublicOperatorSnapshot } from '#state/operator-state'
import { EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED } from '#state/executor-deployment-recovery'
import { renderBlockStatus as renderSharedBlockStatus, WAITING_FOR_BLOCK } from '@zoltar/bot-shared/dashboard/block-status'
import { renderRepMarketConsensus } from '@zoltar/bot-shared/dashboard/rep-market-consensus'
import { createActivityPanels } from './activity-panels.ts'
import type { DashboardControls } from './dashboard-controls.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { blockAgeLabel, exactAmount, signerControlState, signerSummaryLabel } from './dashboard-format.ts'
import { createHeaderView } from './dashboard-header-view.ts'
import { executorDeploymentRecoveryCopy, operatorNoticePresentation, pauseFailurePresentation } from './dashboard-notice.ts'
import type { DashboardState } from './dashboard-state.ts'
import { explorerLink, type ExplorerLink, setText } from './dom.ts'
import { createMarketPanels } from './market-panels.ts'
import { renderMarketPriceChart } from './market-price-chart.ts'
import { renderBalances, renderHealth, renderTransactions } from './overview-panels.ts'
import { renderSettingsInsights } from './settings-insights.ts'
import { renderSettlements } from './settlement-panel.ts'

type SnapshotViewContext = {
	state: DashboardState
	elements: DashboardElements
	controls: DashboardControls
	/** Scrolls to the section named by the page's URL fragment; called once, after the first snapshot renders. */
	applyInitialFragment: (fragment: string) => void
}

const LAUNCH_NOTICES = {
	unconfigured: { title: 'Network setup required', copy: 'Choose the chain and verified RPC endpoints in Settings. They apply to the next scan; the bot remains paused until you resume it.' },
	mainnet: { title: 'Mainnet execution network', copy: 'Use only reviewed deployments, current market evidence, low risk limits, and supervised recovery procedures.' },
	sepolia: { title: 'Sepolia network', copy: 'Use this network to exercise execution and recovery with a dedicated low-balance key and low risk limits.' },
}

/** Renders a state snapshot into every dashboard panel, re-rendering a table only when its inputs changed. */
export function createSnapshotView({ state, elements, controls, applyInitialFragment }: SnapshotViewContext) {
	// Explorer links render only snapshot data, so the snapshot always supplies the configured explorer.
	const link: ExplorerLink = (value, kind, focusKey) => {
		if (state.latestSnapshot === undefined) throw new Error('Explorer links require a loaded operator snapshot')
		return explorerLink(state.latestSnapshot.explorerUrl, value, kind, focusKey)
	}
	const header = createHeaderView(elements)
	const activity = createActivityPanels(elements, link)
	const markets = createMarketPanels(state, elements, link)
	const renderedPanelSignatures = new Map<string, string>()

	function renderChangedPanel(name: string, value: unknown, renderPanel: () => void) {
		const signature = JSON.stringify(value)
		if (renderedPanelSignatures.get(name) === signature) return
		const expanded = new Set([...document.querySelectorAll('details[data-disclosure-key][open]')].map(details => details.getAttribute('data-disclosure-key')))
		renderPanel()
		for (const details of document.querySelectorAll('details[data-disclosure-key]')) {
			if (expanded.has(details.getAttribute('data-disclosure-key'))) details.setAttribute('open', '')
		}
		renderedPanelSignatures.set(name, signature)
	}

	function renderSignerStatus(snapshot: PublicOperatorSnapshot) {
		const { privateKey, rememberSigner, signerStatus } = elements
		// The panel summary reports the active and saved signer; the status line reports the last request's outcome.
		setText('signer-summary', signerSummaryLabel(snapshot))
		if (state.signerFeedback !== undefined) {
			signerStatus.textContent = state.signerFeedback.message
			signerStatus.setAttribute('role', state.signerFeedback.error ? 'alert' : 'status')
			signerStatus.classList.toggle('error', state.signerFeedback.error)
			privateKey.setAttribute('aria-invalid', state.signerFeedback.error.toString())
		} else {
			signerStatus.textContent = 'Keys stay local and are never returned by the API or logged.'
			signerStatus.setAttribute('role', 'status')
			signerStatus.classList.remove('error')
			privateKey.setAttribute('aria-invalid', 'false')
		}
		const controlState = signerControlState({
			hasQueuedSigner: snapshot.queuedSigner?.kind === 'apply',
			hasWallet: snapshot.wallet !== undefined,
			privateKey: privateKey.value,
			requestPending: state.signerRequestPending,
		})
		privateKey.disabled = controlState.inputDisabled
		rememberSigner.disabled = controlState.inputDisabled
		elements.clearSignerButton.disabled = controlState.clearDisabled
		elements.forgetSignerButton.disabled = state.signerRequestPending || snapshot.savedWallet === undefined
		elements.setSignerButton.disabled = controlState.setDisabled
	}

	/** Re-renders the signer panel from the latest snapshot after a signer request changed its feedback. */
	function refreshSignerStatus() {
		if (state.latestSnapshot !== undefined) renderSignerStatus(state.latestSnapshot)
	}

	function renderBlockStatus(snapshot = state.latestSnapshot) {
		renderSharedBlockStatus(snapshot?.blockNumber === undefined ? WAITING_FOR_BLOCK : `Block ${snapshot.blockNumber} · ${blockAgeLabel(snapshot.blockTimestamp)}`)
	}

	function renderOperatorNotice(snapshot: PublicOperatorSnapshot) {
		if (state.pauseFailure !== undefined && snapshot.paused === state.pauseFailure.requestedPaused) state.pauseFailure = undefined
		if (state.pauseFailure?.message === EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED) {
			if (snapshot.executorDeploymentRecovery !== undefined) state.pauseFailure.recoverySeen = true
			else if (state.pauseFailure.recoverySeen) state.pauseFailure = undefined
		}
		const presentation = state.pauseFailure === undefined ? operatorNoticePresentation(snapshot) : pauseFailurePresentation(state.pauseFailure.message)
		setText('notice-title', presentation.noticeTitle)
		setText('notice-copy', presentation.noticeCopy)
		elements.notice.dataset['tone'] = presentation.noticeTone
	}

	function renderExecutorRecovery(recovery: PublicOperatorSnapshot['executorDeploymentRecovery']) {
		elements.create2Recovery.hidden = recovery === undefined
		if (recovery === undefined) elements.create2RecoveryCopy.replaceChildren()
		else elements.create2RecoveryCopy.replaceChildren(executorDeploymentRecoveryCopy(recovery, 'executor-form'), ' Transaction ', link(recovery.transactionHash, 'tx', 'create2-recovery-transaction'))
	}

	function renderLaunchNotice(snapshot: PublicOperatorSnapshot) {
		const launchNotice = elements.launchNotice
		let notice = LAUNCH_NOTICES.unconfigured
		if (snapshot.networkConfigured) notice = snapshot.network === 'mainnet' ? LAUNCH_NOTICES.mainnet : LAUNCH_NOTICES.sepolia
		launchNotice.hidden = snapshot.networkConfigured
		setText('launch-notice-title', notice.title)
		setText('launch-notice-copy', notice.copy)
		launchNotice.dataset['tone'] = 'warning'
	}

	function renderSummary(snapshot: PublicOperatorSnapshot) {
		setText('last-poll-value', snapshot.lastPollAt === undefined ? 'No poll completed' : `Updated ${new Date(snapshot.lastPollAt).toLocaleTimeString()}`)
		setText('active-report-value', snapshot.activeReportCount.toString())
		renderBlockStatus(snapshot)
		setText('profit-value', exactAmount(snapshot.totalRealizedNetProfitEth, 'ETH'))
		setText('open-profit-value', exactAmount(snapshot.totalOpenHedgedNetProfitEth, 'ETH'))
		setText('hedged-profit-value', exactAmount(snapshot.totalHedgedProfitBeforeGasEth, 'ETH'))
		setText('gas-value', exactAmount(snapshot.totalActualGasCostEth, 'ETH'))
		setText('game-capital-value', exactAmount(snapshot.gameCapital.totalEthWeth, 'ETH'))
		setText('game-capital-detail', `${exactAmount(snapshot.gameCapital.eth, 'ETH')} · ${exactAmount(snapshot.gameCapital.weth, 'WETH')} in observed active games`)
		setText('risk-open-positions', `${snapshot.risk.usage.openPositions.toString()} open · ${snapshot.risk.limits.maxConcurrentPositions.toString()} maximum`)
		setText('risk-locked', `${exactAmount(snapshot.risk.usage.lockedWeth, 'WETH')} / ${exactAmount(snapshot.risk.limits.maxTotalLockedWeth, 'WETH')}`)
		setText('risk-daily-gas', `${exactAmount(snapshot.risk.usage.dailyGasSpentWeth, 'ETH')} / ${exactAmount(snapshot.risk.limits.maxDailyGasSpendWeth, 'ETH')}`)
		setText('risk-position-limit', exactAmount(snapshot.risk.limits.maxPositionNotionalWeth, 'WETH'))
		setText('risk-lifecycle-reserve', exactAmount(snapshot.risk.limits.lifecycleGasReserveWeth, 'ETH'))
		setText('network-value', snapshot.networkConfigured ? `Active: ${snapshot.network} · chain ${snapshot.expectedChainId.toString()}` : 'Network not configured')
	}

	function renderPanels(snapshot: PublicOperatorSnapshot) {
		renderChangedPanel('balances', [snapshot.wallet, snapshot.balances], () => renderBalances(snapshot))
		renderChangedPanel('opportunities', [snapshot.opportunities, snapshot.explorerUrl], () => activity.renderOpportunities(snapshot.opportunities))
		renderChangedPanel('settlements', [snapshot.settlements, snapshot.explorerUrl], () => renderSettlements(snapshot.settlements, link))
		renderSettingsInsights(snapshot)
		renderChangedPanel('transactions', [snapshot.transactionActivity, snapshot.explorerUrl], () => renderTransactions(snapshot.transactionActivity, snapshot.explorerUrl))
		renderChangedPanel('endpoints', [snapshot.endpointChecks, snapshot.rpcEndpointHealth, snapshot.network], () => activity.renderEndpointChecks(snapshot))
		renderChangedPanel('operations', snapshot.operationLog, () => activity.renderOperations(snapshot.operationLog))
		renderChangedPanel('history', [snapshot.executionHistory, snapshot.executionHistoryRecordCount, snapshot.explorerUrl], () => activity.renderHistory(snapshot.executionHistory, snapshot.executionHistoryRecordCount))
		renderChangedPanel('positions', [snapshot.positions, snapshot.positionRecordCount, snapshot.explorerUrl], () => activity.renderPositions(snapshot.positions, snapshot.positionRecordCount))
		renderChangedPanel('tokens', [snapshot.tokenMarkets, snapshot.tokenAddresses, snapshot.universes, snapshot.network, snapshot.explorerUrl, [...state.approvedUniverseIds], elements.tokensFieldset.disabled], () => markets.renderTokenMarkets(snapshot))
		renderChangedPanel('market', [snapshot.centralizedMarket, snapshot.marketConsensus], () => renderRepMarketConsensus(document, snapshot.centralizedMarket, snapshot.marketConsensus))
		renderChangedPanel('paths', [snapshot.reportPaths, snapshot.explorerUrl], () => markets.renderDisputePaths(snapshot))
		renderMarketPriceChart(snapshot)
	}

	function render(snapshot: PublicOperatorSnapshot) {
		const activeElement = document.activeElement
		const focusKey = activeElement instanceof HTMLElement ? activeElement.dataset['focusKey'] : undefined
		const scrollPosition = { left: window.scrollX, top: window.scrollY }
		state.latestSnapshot = snapshot
		renderHealth(snapshot, state.configuredScanIntervalMilliseconds, false)
		setText('deployment-executor', snapshot.executor ?? 'Unavailable')
		setText('deployment-coordinators', snapshot.coordinatorAddresses.length === 0 ? 'No pools discovered in approved universes.' : snapshot.coordinatorAddresses.join('\n'))
		controls.setControlsEnabled(true)
		header.renderHeader(snapshot)
		renderSummary(snapshot)
		controls.updateNetworkTargetStatus()
		renderSignerStatus(snapshot)
		renderLaunchNotice(snapshot)
		renderOperatorNotice(snapshot)
		renderExecutorRecovery(snapshot.executorDeploymentRecovery)
		renderPanels(snapshot)
		if (focusKey !== undefined) {
			const target = Array.from(document.querySelectorAll<HTMLElement>('[data-focus-key]')).find(candidate => candidate.dataset['focusKey'] === focusKey)
			target?.focus({ preventScroll: true })
		}
		window.scrollTo(scrollPosition)
		if (!state.initialFragmentApplied) {
			state.initialFragmentApplied = true
			const fragment = decodeURIComponent(window.location.hash.slice(1))
			if (fragment !== '') applyInitialFragment(fragment)
		}
	}

	/** Shows the last known snapshot as stale and locks every control after a failed state poll. */
	function renderPollFailure(error: unknown) {
		if (state.latestSnapshot !== undefined) renderHealth(state.latestSnapshot, state.configuredScanIntervalMilliseconds, true)
		controls.setControlsEnabled(false)
		header.renderDisconnected(error, state.latestSnapshot)
	}

	/** Re-renders the filtered tables and the price chart when the operator changes a filter or the charted token. */
	function registerFilters() {
		elements.transactionFilter.addEventListener('change', () => {
			if (state.latestSnapshot !== undefined) renderTransactions(state.latestSnapshot.transactionActivity, state.latestSnapshot.explorerUrl)
		})
		elements.operationFilter.addEventListener('change', () => activity.renderOperations(state.latestSnapshot?.operationLog ?? []))
		elements.priceToken.addEventListener('change', () => {
			if (state.latestSnapshot !== undefined) renderMarketPriceChart(state.latestSnapshot)
		})
	}

	return { render, renderPollFailure, renderPollRetry: header.renderPollRetry, renderBlockStatus, renderOperatorNotice, refreshSignerStatus, registerFilters }
}

export type SnapshotView = ReturnType<typeof createSnapshotView>
