import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '@zoltar/ui-statoblast-shared/copy/app.js'
import * as glossaryCopy from '@zoltar/ui-statoblast-shared/copy/glossary.js'
import * as zoltarCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import type { StatoblastRoute } from '@zoltar/ui-statoblast-shared/types/app.js'
import type { OpenOracleView } from '@zoltar/ui-statoblast-shared/features/oracleTypes.js'
import type { SecurityPoolsView } from '@zoltar/ui-statoblast-shared/features/types.js'
import { formatAppDocumentTitle as formatDocumentTitle } from '@zoltar/ui-core-shared/app/lib/appTitle.js'
import { abbreviateAddress, isHexAddressInput, sameAddress } from '@zoltar/ui-core-shared/lib/address.js'

export type AppPageTitleInput = {
	activeOpenOracleView: OpenOracleView
	activeSecurityPoolsView: SecurityPoolsView
	route: StatoblastRoute
}

export function getAppPageTitle({ activeOpenOracleView, activeSecurityPoolsView, route }: AppPageTitleInput) {
	if (route === 'deploy') return appCopy.deployContracts
	if (route === 'pools') {
		if (activeSecurityPoolsView === 'create') return commonCopy.createSecurityPool
		if (activeSecurityPoolsView === 'operate') return glossaryCopy.securityPoolTerm
		if (activeSecurityPoolsView === 'migrate') return appCopy.migrateRep
		if (activeSecurityPoolsView === 'universes') return zoltarCopy.universesTitle
		return commonCopy.securityPools
	}
	if (route === 'open-oracle') {
		if (activeOpenOracleView === 'create') return statoblastAppCopy.createOracleReport
		if (activeOpenOracleView === 'selected-report') return statoblastAppCopy.oracleReportDetails
		return statoblastAppCopy.openOracle
	}
	return appCopy.pageNotFoundTitle
}

export const applicationTitle = 'Augur Statoblast'

/** `detail` names the specific object on the page, such as the open pool, ahead of the page title. */
export function formatAppDocumentTitle(pageTitle: string, detail?: string) {
	return formatDocumentTitle(detail === undefined ? pageTitle : `${detail} · ${pageTitle}`, applicationTitle)
}

/** Names the open pool by its question once that pool has loaded, otherwise by its short address. */
export function getPoolDocumentTitleDetail({ requestedPoolAddress, selectedPool }: { requestedPoolAddress: string; selectedPool: { marketDetails: { title: string }; securityPoolAddress: string } | undefined }) {
	const address = requestedPoolAddress.trim()
	if (!isHexAddressInput(address)) return undefined
	const question = selectedPool !== undefined && sameAddress(selectedPool.securityPoolAddress, address) ? selectedPool.marketDetails.title.trim() : ''
	return question === '' ? abbreviateAddress(address) : question
}
