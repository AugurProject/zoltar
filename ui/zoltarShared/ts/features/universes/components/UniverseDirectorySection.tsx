import type { ComponentChildren } from 'preact'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { Question } from '@zoltar/ui-core-shared/components/Question.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { UniverseLink } from './UniverseLink.js'
import { formatUniverseLabel } from '../lib/universe.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

type UniverseDirectorySectionProps = {
	children?: ComponentChildren
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

export function UniverseDirectorySection({ children, zoltarUniverse }: UniverseDirectorySectionProps) {
	if (zoltarUniverse === undefined)
		return (
			<>
				<StateHint presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'pending', detail: commonCopy.loadingUniverseDetails }} />
				{children}
			</>
		)

	return (
		<div className='route-view-flow'>
			<SectionBlock variant='plain'>
				<DataGrid>
					<MetricField label={commonCopy.universe}>{formatUniverseLabel(zoltarUniverse.universeId)}</MetricField>
					<MetricField label={commonCopy.status}>
						{zoltarUniverse.hasForked ? commonCopy.forked : marketCopy.unforked}
						{zoltarUniverse.hasForked && zoltarUniverse.forkTime > 0n ? (
							<>
								{' '}
								<TimestampValue timestamp={zoltarUniverse.forkTime} />
							</>
						) : undefined}
					</MetricField>
					<MetricField label={marketCopy.parentUniverse}>{zoltarUniverse.universeId === 0n ? commonCopy.none : <UniverseLink universeId={zoltarUniverse.parentUniverseId} />}</MetricField>
					<MetricField label={zoltarUniverse.reputationTokenName ?? commonCopy.rep}>
						<CurrencyValue value={zoltarUniverse.totalTheoreticalSupplyAttoRep} suffix={zoltarUniverse.reputationTokenSymbol ?? commonCopy.rep} />
					</MetricField>
				</DataGrid>
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
