import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { PortfolioButton, type PortfolioActions } from './PortfolioControls.js'
import type { usePortfolioServiceCredit } from '../hooks/usePortfolioServiceCredit.js'
import * as copy from '../../../copy/portfolioReporting.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

export function PortfolioServiceCredit({ model, actions }: { model: ReturnType<typeof usePortfolioServiceCredit>; actions: PortfolioActions }) {
	return (
		<SectionBlock title={copy.serviceTitle} description={copy.serviceDescription}>
			<MetricGrid>
				<MetricField label={copy.serviceBalance} loading={model.loading}>
					<CurrencyValue value={model.amount} suffix={common.eth} />
				</MetricField>
				<MetricField label={copy.serviceRecipient}>
					<AddressValue address={model.recipient} wrap />
				</MetricField>
			</MetricGrid>
			<PortfolioButton model={actions} action='claimPortfolioServiceCredit' label={copy.serviceClaim} pendingLabel={copy.serviceClaiming} reason={model.reason} onClick={model.claim} />
		</SectionBlock>
	)
}
