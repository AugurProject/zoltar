import * as firstRunCopy from '../../../copy/firstRun.js'
import { getProtocolDocsHref } from '../../glossary/lib/glossary.js'

const FIRST_RUN_CARD_STORAGE_KEY = 'statoblast.firstRunRoleGuideDismissed'

type FirstRunStorage = Pick<Storage, 'getItem' | 'setItem'>

type FirstRunRole = {
	detail: string
	guideHref: string
	guideLabel: string
	id: 'reporter' | 'trader' | 'vault-provider'
	title: string
}

export const firstRunRoles: readonly FirstRunRole[] = [
	{ id: 'vault-provider', title: firstRunCopy.vaultProviderRole, detail: firstRunCopy.vaultProviderDetail, guideLabel: firstRunCopy.vaultProviderGuide, guideHref: getProtocolDocsHref('explanation/statoblast.html#participants-assets') },
	{ id: 'trader', title: firstRunCopy.traderRole, detail: firstRunCopy.traderDetail, guideLabel: firstRunCopy.traderGuide, guideHref: getProtocolDocsHref('explanation/trading.html') },
	{ id: 'reporter', title: firstRunCopy.reporterRole, detail: firstRunCopy.reporterDetail, guideLabel: firstRunCopy.reporterGuide, guideHref: getProtocolDocsHref('explanation/escalation-game.html') },
]

// Blocked or full storage only costs the persisted dismissal; the guide still works for the session.
function isStorageAccessError(error: unknown) {
	return error instanceof DOMException
}

export function readFirstRunCardDismissed(storage: FirstRunStorage | undefined) {
	if (storage === undefined) return false
	try {
		return storage.getItem(FIRST_RUN_CARD_STORAGE_KEY) === 'true'
	} catch (error) {
		if (isStorageAccessError(error)) return false
		throw error
	}
}

export function persistFirstRunCardDismissed(storage: FirstRunStorage | undefined) {
	if (storage === undefined) return
	try {
		storage.setItem(FIRST_RUN_CARD_STORAGE_KEY, 'true')
	} catch (error) {
		if (!isStorageAccessError(error)) throw error
	}
}
