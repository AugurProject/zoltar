import type { ComponentChildren } from 'preact'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import * as reportingCopy from '../../../copy/reporting.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { renderWorkflowMetricGrid } from './ForkAuctionPresentation.js'

export function ForkTriggeredStage({ currentTimestamp, disabled, hasTriggeredFork, universeForkTime }: { currentTimestamp: bigint | undefined; disabled: boolean; hasTriggeredFork: boolean; universeForkTime: bigint | undefined }) {
	return (
		<fieldset aria-labelledby='fork-workflow-stage-fork-triggered' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-fork-triggered' role='tabpanel'>
			<SectionBlock title={hasTriggeredFork ? commonCopy.forkTriggered : forkAuctionCopy.forkNotTriggered} variant='embedded'>
				{hasTriggeredFork
					? renderWorkflowMetricGrid([
							{ label: commonCopy.status, value: forkAuctionCopy.systemIsForking },
							{ label: forkAuctionCopy.triggeredAt, value: <TimestampValue {...(currentTimestamp === undefined ? {} : { currentTimestamp })} timestamp={universeForkTime} /> },
						])
					: undefined}
			</SectionBlock>
		</fieldset>
	)
}

export function ForkAuctionWorkflowShell({
	children,
	embedInCard,
	forkAuctionDetailsAvailable,
	forkAuctionError,
	loadingForkAuctionDetails,
	loadingReportingDetails,
	onLoadForkAuction,
	onLoadReporting,
	reportingError,
	securityPoolAddress,
	showHeader,
}: {
	children: ComponentChildren
	embedInCard: boolean
	forkAuctionDetailsAvailable: boolean
	forkAuctionError: string | undefined
	loadingForkAuctionDetails: boolean
	loadingReportingDetails: boolean
	onLoadForkAuction: (securityPoolAddress: Address) => void
	onLoadReporting: (() => void) | undefined
	reportingError: string | undefined
	securityPoolAddress: Address | undefined
	showHeader: boolean
}) {
	const content = (
		<>
			{children}
			<RetryableNotice disabled={loadingForkAuctionDetails} message={forkAuctionError} onRetry={forkAuctionDetailsAvailable || securityPoolAddress === undefined ? undefined : () => onLoadForkAuction(securityPoolAddress)} retryLabel={forkAuctionCopy.retryForkWorkflow} />
			<RetryableNotice disabled={loadingReportingDetails} message={reportingError} onRetry={onLoadReporting} retryLabel={loadingReportingDetails ? <LoadingText>{reportingCopy.loadingReportingDetails}</LoadingText> : reportingCopy.retryReporting} />
		</>
	)
	if (embedInCard) return content
	return (
		<RouteWorkflowPanel showHeader={showHeader} title={forkAuctionCopy.forkMigrationTitle}>
			{content}
		</RouteWorkflowPanel>
	)
}
