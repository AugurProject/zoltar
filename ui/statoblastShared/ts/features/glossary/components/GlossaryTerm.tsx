import type { ComponentChildren } from 'preact'
import { Term } from '@zoltar/ui-core-shared/components/Term.js'
import { getGlossaryTerm, type GlossaryTermId } from '../lib/glossary.js'

export function GlossaryTerm({ children, id }: { children?: ComponentChildren; id: GlossaryTermId }) {
	return <Term {...getGlossaryTerm(id)}>{children}</Term>
}
