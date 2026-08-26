import type { ComponentChildren } from 'preact'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import type { Address } from '@zoltar/shared/ethereum'
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
			<ErrorNotice message={forkAuctionError} />
			{forkAuctionError === undefined || forkAuctionDetailsAvailable || securityPoolAddress === undefined ? undefined : (
				<div className='actions'>
					<button className='secondary' disabled={loadingForkAuctionDetails} onClick={() => onLoadForkAuction(securityPoolAddress)} type='button'>
						{forkAuctionCopy.retryForkWorkflow}
					</button>
				</div>
			)}
			<ErrorNotice message={reportingError} />
			{reportingError === undefined || onLoadReporting === undefined ? undefined : (
				<div className='actions'>
					<button className='secondary' disabled={loadingReportingDetails} onClick={onLoadReporting} type='button'>
						{loadingReportingDetails ? <LoadingText>{forkAuctionCopy.loadingReportingDetails}</LoadingText> : forkAuctionCopy.retryReporting}
					</button>
				</div>
			)}
		</>
	)
	if (embedInCard) return content
	return (
		<RouteWorkflowPanel showHeader={showHeader} title={forkAuctionCopy.forkTruthAuction}>
			{content}
		</RouteWorkflowPanel>
	)
}
