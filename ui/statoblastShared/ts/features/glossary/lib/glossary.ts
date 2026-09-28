import { protocolGuideHref } from '@zoltar/ui-core-shared/copy/app.js'
import type { TermDefinition } from '@zoltar/ui-core-shared/components/Term.js'
import * as glossaryCopy from '../../../copy/glossary.js'

export type GlossaryTermId = 'non-decision-threshold' | 'open-interest-fee' | 'security-multiplier' | 'security-pool' | 'universe' | 'universe-fork'

/** Resolves a documentation page (relative to the protocol guide) to an absolute link that opens outside the app. */
export function getProtocolDocsHref(documentPath: string) {
	return new URL(documentPath, protocolGuideHref).href
}

const glossary: Record<GlossaryTermId, TermDefinition> = {
	'non-decision-threshold': { label: glossaryCopy.nonDecisionThresholdTerm, definition: glossaryCopy.nonDecisionThresholdDefinition, href: getProtocolDocsHref('reference/glossary.html#non-decision-threshold') },
	'open-interest-fee': { label: glossaryCopy.openInterestFeeTerm, definition: glossaryCopy.openInterestFeeDefinition, href: getProtocolDocsHref('explanation/fees.html') },
	'security-multiplier': { label: glossaryCopy.securityMultiplierTerm, definition: glossaryCopy.securityMultiplierDefinition, href: getProtocolDocsHref('explanation/statoblast.html#fees-capacity-liquidations') },
	'security-pool': { label: glossaryCopy.securityPoolTerm, definition: glossaryCopy.securityPoolDefinition, href: getProtocolDocsHref('reference/glossary.html#security-pool') },
	universe: { label: glossaryCopy.universeTerm, definition: glossaryCopy.universeDefinition, href: getProtocolDocsHref('reference/glossary.html#universe') },
	'universe-fork': { label: glossaryCopy.universeForkTerm, definition: glossaryCopy.universeForkDefinition, href: getProtocolDocsHref('explanation/zoltar.html#branching') },
}

export function getGlossaryTerm(id: GlossaryTermId) {
	return glossary[id]
}
