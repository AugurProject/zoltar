import type { ComponentChildren } from 'preact'
import { Badge } from './Badge.js'
import { SectionBlock } from './SectionBlock.js'
import * as commonCopy from '../copy/common.js'
import type { SectionBlockProps } from '../types/components.js'
import type { ForkQuestionDetails } from '../types/contracts.js'
import { ForkQuestion } from './Question.js'
import type { NetworkProfile } from '../wallet/networkProfile.js'

export function ForkUniverseNavigation({
	question,
	explorerProfile,
	loading = false,
	hasOutcomes = false,
	headingLevel = 3,
	children,
}: {
	question?: ForkQuestionDetails | undefined
	explorerProfile?: NetworkProfile | undefined
	loading?: boolean
	hasOutcomes?: boolean
	headingLevel?: SectionBlockProps['headingLevel']
	children: ComponentChildren
}) {
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
				{question === undefined ? undefined : <ForkQuestion question={question} explorerProfile={explorerProfile} />}
				{children}
			</div>
		</SectionBlock>
	)
}
