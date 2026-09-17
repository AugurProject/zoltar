import { UniverseContextSummary } from './UniverseContextSummary.js'
import type { ComponentChildren } from 'preact'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { Question } from '@zoltar/ui-core-shared/components/Question.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

type UniverseDirectorySectionProps = {
	children?: ComponentChildren
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

export function UniverseDirectorySection({ children, zoltarUniverse }: UniverseDirectorySectionProps) {
	if (zoltarUniverse === undefined)
		return (
			<>
				<StateHint presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: commonCopy.loadingUniverseDetails }} />
				{children}
			</>
		)

	return (
		<div className='route-view-flow'>
			<SectionBlock variant='plain'>
				<UniverseContextSummary universe={zoltarUniverse} />
				{zoltarUniverse.forkQuestionDetails === undefined ? undefined : (
					<div className='loaded-question-preview'>
						<Question question={zoltarUniverse.forkQuestionDetails} variant='preview' />
					</div>
				)}
			</SectionBlock>

			{children}
		</div>
	)
}
