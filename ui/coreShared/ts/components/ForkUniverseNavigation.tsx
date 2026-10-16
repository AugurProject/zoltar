import type { ComponentChildren } from 'preact'
import { Badge } from './Badge.js'
import { SectionBlock } from './SectionBlock.js'
import * as commonCopy from '../copy/common.js'
import * as universeCopy from '../copy/universes.js'
import type { SectionBlockProps } from '../types/components.js'

export function ForkUniverseNavigation({ question, loading = false, hasOutcomes = false, headingLevel = 3, children }: { question?: string | undefined; loading?: boolean; hasOutcomes?: boolean; headingLevel?: SectionBlockProps['headingLevel']; children: ComponentChildren }) {
	return (
		<SectionBlock
			title={
				<span className='universe-outcome-heading'>
					{commonCopy.childUniverses}
					<span aria-hidden={!loading || !hasOutcomes} className={loading && hasOutcomes ? undefined : 'universe-outcome-status-idle'}>
						<Badge tone='loading'>{commonCopy.loading}</Badge>
					</span>
				</span>
			}
			variant='plain'
			headingLevel={headingLevel}
			busy={loading}
		>
			<div className='form-grid'>
				{question === undefined || question === '' ? undefined : <p className='detail'>{universeCopy.formatForkQuestion(question)}</p>}
				{children}
			</div>
		</SectionBlock>
	)
}
