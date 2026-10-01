import type { ScannerContext } from './app-context.ts'
import { createDetailViews } from './app-detail-views.ts'
import { element } from './app-dom.ts'
import { createEntityViews } from './app-entity-views.ts'
import { createOperationsViews } from './app-operations-views.ts'
import { createEvidenceComponents } from './evidence-components.ts'
import { exactNumber } from './format.ts'

/** Creates every route view once and links the views that are consumed before they are created. */
export const createScannerViews = (context: ScannerContext) => {
	const evidence = createEvidenceComponents({
		element,
		api: context.api,
		selectedChainId: context.selectedChainId,
		isDemo: context.state.isDemo,
		number: exactNumber,
	})
	const operations = createOperationsViews(context)
	const detail = createDetailViews(context, evidence)
	const entity = createEntityViews(context, { evidence, operations, openAccountTransactions: detail.account.openAccountTransactions })
	context.links.richListItems = () => entity.richList.items
	context.links.addressProfile = () => entity.addressProfile.profile
	return { evidence, operations, detail, entity }
}

export type ScannerViews = ReturnType<typeof createScannerViews>
