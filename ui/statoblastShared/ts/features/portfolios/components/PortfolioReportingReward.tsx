import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { PortfolioButton, PortfolioInput, type PortfolioActions } from './PortfolioControls.js'
import type { usePortfolioReportingReward } from '../hooks/usePortfolioReportingReward.js'
import * as copy from '../../../copy/portfolioReporting.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

export function PortfolioReportingReward({ model, actions, questionInput, setQuestionInput }: { model: ReturnType<typeof usePortfolioReportingReward>; actions: PortfolioActions; questionInput: string; setQuestionInput: (value: string) => void }) {
	return (
		<SectionBlock title={copy.title} description={copy.description}>
			<PortfolioInput label={copy.question} value={questionInput} onChange={setQuestionInput} disabled={actions.busy !== undefined} />
			<MetricField label={copy.beneficiary} loading={model.loading}>
				<AddressValue address={model.reward?.beneficiary} wrap />
			</MetricField>
			<MetricGrid>
				<MetricField label={copy.cash} loading={model.loading}>
					<CurrencyValue value={model.reward?.cashAttoEth} suffix={common.eth} />
				</MetricField>
				<MetricField label={copy.rep} loading={model.loading}>
					<CurrencyValue value={model.reward?.recoveryAttoRep} suffix={common.rep} />
				</MetricField>
			</MetricGrid>
			{model.reward?.maintenance ? <UserMessage detail={copy.maintenance} /> : undefined}
			<PortfolioButton model={actions} action='claimPortfolioReportingReward' label={copy.claim} pendingLabel={copy.claiming} reason={model.reason} onClick={model.claim} />
		</SectionBlock>
	)
}
