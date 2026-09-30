import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import type { ActivityRecord } from './browser-types.ts'
import type { ScannerContext } from './app-context.ts'
import { element, lookup } from './app-dom.ts'
import { accountTransactionsError, applyLiveChanges, exactTimestamp, liveSnapshot, renderRetryStatus, setLiveRecord } from './app-presentation.ts'
import { hideCanonicalDialogStatus, syncCanonicalDialogStatus } from './app-status.ts'
import { createAccountDetailRoute } from './account-detail-route.ts'
import { renderActivityRow } from './activity-row.ts'
import { createActivityRoute } from './activity-route.ts'
import { createEventDetailRoute } from './event-detail-route.ts'
import type { createEvidenceComponents } from './evidence-components.ts'
import { exactNumber, utcDateTime } from './format.ts'

type EvidenceComponents = ReturnType<typeof createEvidenceComponents>

/** Wires the activity feed, event drawers, and account transaction dialog. */
export const createDetailViews = (context: ScannerContext, evidence: EvidenceComponents) => {
	const { state, elements, api, links, requiredChainId, selectedChainId } = context
	const { activityDetailState, canonicalState } = state
	const { feed, dialog, detailContent } = elements
	const syncDialogStatus = () => syncCanonicalDialogStatus(state, dialog)

	const rowFor = (log: ActivityRecord) =>
		renderActivityRow(
			{
				setLiveRecord,
				element,
				number: exactNumber,
				isDemo: state.isDemo,
				time: utcDateTime,
				age: context.age,
				exactTimestamp,
				eventDrawerFor: eventDetail.eventDrawerFor,
				closeEventDrawer: options => eventDetail.closeEventDrawer(options),
				openDetail: log => eventDetail.openDetail(log),
			},
			log,
		)

	const activity = createActivityRoute({
		lookup,
		feed,
		feedState: elements.feedState,
		activityRoute: state.activityRoute,
		activityDetailState,
		canonicalState,
		getViewContextVersion: () => state.viewContextVersion,
		requiredChainId,
		selectedChainId,
		api,
		rowFor,
		liveSnapshot,
		applyLiveChanges,
		eventDrawers: () => eventDetail.eventDrawers(),
		captureDetailContext: drawer => eventDetail.captureDetailContext(drawer),
		placeEventDrawer: (drawer, options) => eventDetail.placeEventDrawer(drawer, options),
		updateLogDisclosures: () => eventDetail.updateLogDisclosures(),
		restoreDetailContext: (snapshot, drawer) => eventDetail.restoreDetailContext(snapshot, drawer),
		clearDetailUrl: () => account.clearDetailUrl(),
		getRequestRouteRefresh: () => links.requestRouteRefresh,
		renderRetryStatus,
		errorMessage,
		element,
		logRefreshGate: state.refreshGates.log,
	})

	const eventDetail = createEventDetailRoute({
		feed,
		activityDetailState,
		canonicalState,
		element,
		number: exactNumber,
		api,
		syncCanonicalDialogStatus: syncDialogStatus,
		clearDetailUrl: () => account.clearDetailUrl(),
		errorMessage,
		detailCard: evidence.detailCard,
		evidenceDetailCard: evidence.evidenceDetailCard,
		addressDetailCard: evidence.addressDetailCard,
		decodedArgumentsTable: evidence.decodedArgumentsTable,
	})

	const account = createAccountDetailRoute({
		activityDetailState,
		canonicalState,
		detailContent,
		dialog,
		loaderDeps: {
			activityDetailState,
			canonicalState,
			accountPageRefreshGate: state.refreshGates.accountPage,
			getIsRichList: () => state.route === 'richlist',
			detailContent,
			dialog,
			lookup,
			syncCanonicalDialogStatus: syncDialogStatus,
			removeEventDrawers: eventDetail.removeEventDrawers,
			liveSnapshot,
			setLiveRecord,
			element,
			number: exactNumber,
			time: utcDateTime,
			nativeSymbol: chainId => context.nativeSymbol(chainId),
			internalEvidenceLink: evidence.internalEvidenceLink,
			protocolAddressLink: evidence.protocolAddressLink,
			decodedArgumentsTable: evidence.decodedArgumentsTable,
			applyLiveChanges,
			api,
			selectedChainId,
			errorMessage,
			accountTransactionsError,
		},
		detailRefreshGate: state.refreshGates.detail,
		getIsRichList: () => state.route === 'richlist',
		getIsAddress: () => state.route === 'address',
		getRichListItems: () => links.richListItems(),
		getAddressProfile: () => links.addressProfile(),
		removeEventDrawers: eventDetail.removeEventDrawers,
		hideCanonicalDialogStatus,
	})

	return { activity, eventDetail, account }
}

export type DetailViews = ReturnType<typeof createDetailViews>
