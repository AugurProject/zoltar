import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import type { ComponentChildren } from 'preact'
import type { ForkOutcomeMigrationSeedStatus } from '../hooks/useSelectedAuctionReadState.js'
import type { ForkAuctionActionOptions } from './ForkAuctionActionSections.js'
import * as copy from '../../../copy/forkAuction.js'

export function ForkChildPreparation({
	status,
	readGuard,
	closedGuard,
	onPrepareFeed,
	onPrepareContracts,
	onCreate,
	onInitialize,
	renderAction,
}: {
	status: ForkOutcomeMigrationSeedStatus | undefined
	readGuard: string | undefined
	closedGuard: string | undefined
	onPrepareFeed: () => void
	onPrepareContracts: () => void
	onCreate: () => void
	onInitialize: () => void
	renderAction: (options: ForkAuctionActionOptions) => ComponentChildren
}) {
	if (status?.portfolio !== undefined) {
		const common = readGuard ?? (status.branchReady ? undefined : copy.portfolioBranchRequired)
		const prepared = status.childPool !== zeroAddress
		const prepareReason = common ?? (prepared ? copy.childPreparationComplete : undefined)
		const activateReason = common ?? (!prepared ? copy.prepareChildBeforeMigration : undefined) ?? (status.historyReady ? copy.childPreparationComplete : undefined)
		return (
			<SectionBlock title={copy.portfolioQuestionPreparation} description={copy.portfolioQuestionPreparationHint} variant='embedded'>
				<UserMessage detail={copy.portfolioBranchHint} />
				<p className='detail' role='status'>
					{copy.formatChildHistoryProgress(status.historyOutcomesInitialized)}
				</p>
				<a href={`#/portfolios?portfolio=${status.portfolio}`}>{copy.openPortfolioBranch}</a>
				<div className='actions'>
					{renderAction({ action: 'prepareChildPriceFeed', idleLabel: copy.preparePortfolioQuestion, pendingLabel: copy.creatingChildPool, availability: { disabled: prepareReason !== undefined, reason: prepareReason }, onClick: onPrepareFeed })}
					{renderAction({ action: 'initializeChildHistory', idleLabel: copy.activatePortfolioQuestion, pendingLabel: copy.initializingChildHistory, availability: { disabled: activateReason !== undefined, reason: activateReason }, onClick: onInitialize })}
				</div>
			</SectionBlock>
		)
	}
	const feedReady = status?.sharedFeed !== zeroAddress
	const childReady = status?.childPool !== undefined && status.childPool !== zeroAddress
	const commonGuard = closedGuard ?? readGuard
	const feedGuard = commonGuard ?? (feedReady ? copy.childPreparationComplete : undefined)
	const contractsGuard = commonGuard ?? (!feedReady ? copy.prepareChildFeedFirst : undefined) ?? (status?.dependenciesPrepared ? copy.childPreparationComplete : undefined)
	const createGuard = commonGuard ?? (childReady ? copy.childPoolExists : undefined) ?? (!status?.dependenciesPrepared ? copy.prepareChildContractsFirst : undefined)
	const initializeGuard = readGuard ?? (!childReady ? copy.prepareChildBeforeMigration : undefined) ?? (status?.historyReady ? copy.childPreparationComplete : undefined)
	const availability = (reason: string | undefined) => ({ disabled: reason !== undefined, reason })
	return (
		<SectionBlock title={copy.prepareChildTitle} description={copy.prepareChildDescription} variant='embedded'>
			{childReady ? (
				<p className='detail' role='status'>
					{copy.formatChildHistoryProgress(status?.historyReady ? 3 : (status?.historyOutcomesInitialized ?? 0))}
				</p>
			) : undefined}
			<div className='actions'>
				{status !== undefined && status.sharedFeed === undefined ? undefined : renderAction({ action: 'prepareChildPriceFeed', idleLabel: copy.prepareChildFeed, pendingLabel: copy.preparingChildFeed, availability: availability(feedGuard), onClick: onPrepareFeed })}
				{renderAction({ action: 'prepareChildDependencies', idleLabel: copy.prepareChildContracts, pendingLabel: copy.preparingChildContracts, availability: availability(contractsGuard), onClick: onPrepareContracts })}
				{renderAction({ action: 'createChildUniverse', idleLabel: copy.createChildPool, pendingLabel: copy.creatingChildPool, availability: availability(createGuard), onClick: onCreate })}
				{renderAction({ action: 'initializeChildHistory', idleLabel: copy.initializeChildHistory, pendingLabel: copy.initializingChildHistory, availability: availability(initializeGuard), forceEnabled: childReady, onClick: onInitialize })}
			</div>
		</SectionBlock>
	)
}
