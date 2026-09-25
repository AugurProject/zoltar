import { UniverseContextSummary } from './UniverseContextSummary.js'
import type { ComponentChildren } from 'preact'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { Question } from '@zoltar/ui-core-shared/components/Question.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { SkeletonList } from '@zoltar/ui-core-shared/components/Skeleton.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import type { DataFreshness } from '@zoltar/ui-core-shared/lib/freshness.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

type UniverseDirectorySectionProps = {
	children?: ComponentChildren
	/** The universe summary's age; omitted where the caller does not refresh it on new blocks. */
	freshness?: DataFreshness | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

export function UniverseDirectorySection({ children, freshness, zoltarUniverse }: UniverseDirectorySectionProps) {
	const freshnessIndicator = freshness === undefined ? undefined : <UpdatedAgo {...freshness} />
	if (zoltarUniverse === undefined)
		return (
			<>
				<SectionBlock variant='plain' actions={freshnessIndicator}>
					<SkeletonList label={commonCopy.loadingUniverseDetails} rows={2} />
				</SectionBlock>
				{children}
			</>
		)

	return (
		<div className='route-view-flow'>
			<SectionBlock variant='plain' actions={freshnessIndicator}>
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
