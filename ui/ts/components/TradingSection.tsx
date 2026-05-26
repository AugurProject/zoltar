import { useState } from 'preact/hooks'
import { ActionLauncherCard } from './ActionLauncherCard.js'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EnumDropdown } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { MetricField } from './MetricField.js'
import { OperationModal } from './OperationModal.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { ShareMigrationTargetsSection } from './ShareMigrationTargetsSection.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { formatCurrencyInputBalance } from '../lib/formatters.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { WorkflowTransactionStatus } from './WorkflowTransactionStatus.js'
import { isMainnetChain } from '../lib/network.js'
import { getReportingOutcomeLabel, REPORTING_OUTCOME_DROPDOWN_OPTIONS } from '../lib/reporting.js'
import { deriveSecurityPoolLifecycleState, evaluateSecurityPoolState } from '../lib/securityPoolState.js'
import {
	getDefaultShareMigrationTargetOutcomeIndexes,
	getRemainingMintCapacity,
	getSelectedOutcomeShareBalance,
	getTradingMigrateSharesGuardMessage,
	getTradingMintGuardMessage,
	getTradingRedeemCompleteSetGuardMessage,
	getTradingRedeemSharesGuardMessage,
	hasRepBackedPoolWithNoActiveAllowance,
	NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE,
	NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE,
} from '../lib/trading.js'
import type { ReadinessAction } from '../types/components.js'
import type { TradingSectionProps } from '../types/components.js'

type TradingActionModal = 'mint' | 'redeem-complete-sets' | 'migrate-shares' | 'redeem-shares' | undefined

function getTradingOutcomePresentation(action: TradingSectionProps['tradingResult']) {
	if (action === undefined) return undefined

	switch (action.action) {
		case 'createCompleteSet':
			return {
				detail: 'Complete sets were minted for the selected pool.',
				dismissKey: `${action.action}:${action.hash}:outcome`,
				nextStep: 'Review the updated share balances before your next trading action.',
				title: 'Complete Sets Minted',
			}
		case 'redeemCompleteSet':
			return {
				detail: 'Matching complete sets were redeemed back into collateral.',
				dismissKey: `${action.action}:${action.hash}:outcome`,
				nextStep: 'Review the updated share balances and wallet collateral balance.',
				title: 'Complete Sets Redeemed',
			}
		case 'migrateShares':
			return {
				detail: 'Forked shares were migrated into the selected child universes.',
				dismissKey: `${action.action}:${action.hash}:outcome`,
				nextStep: 'Open the target universe or pool views to inspect the migrated balances.',
				title: 'Shares Migrated',
			}
		case 'redeemShares':
			return {
				detail: 'Resolved shares were redeemed for the selected pool.',
				dismissKey: `${action.action}:${action.hash}:outcome`,
				nextStep: 'Review the updated balances and proceed with any remaining resolved positions.',
				title: 'Resolved Shares Redeemed',
			}
	}
}

export function TradingSection({
	accountState,
	embedInCard = false,
	loadingTradingForkUniverse,
	loadingTradingDetails,
	onCreateCompleteSet,
	onMigrateShares,
	onRedeemCompleteSet,
	onRedeemShares,
	onTradingFormChange,
	poolState,
	tradingDetails,
	selectedPool,
	tradingActiveAction,
	tradingFeedback,
	tradingError,
	tradingForm,
	tradingForkUniverse,
	tradingResult,
	showHeader = true,
	showSecurityPoolAddressInput = true,
}: TradingSectionProps) {
	const [activeModal, setActiveModal] = useState<TradingActionModal>(undefined)
	const isMainnet = isMainnetChain(accountState.chainId)
	const hasSelectedPool = selectedPool !== undefined
	const poolUniverseHasForked = selectedPool?.universeHasForked === true || tradingForkUniverse?.hasForked === true
	const resolvedPoolState =
		poolState ??
		evaluateSecurityPoolState({
			lifecycleState: deriveSecurityPoolLifecycleState({
				questionOutcome: selectedPool?.questionOutcome,
				systemState: selectedPool?.systemState,
			}),
			universeHasForked: poolUniverseHasForked,
		})
	const mintEnabled = resolvedPoolState.actions.createCompleteSet.enabled
	const redeemCompleteSetsEnabled = resolvedPoolState.actions.redeemCompleteSet.enabled
	const migrateSharesEnabled = resolvedPoolState.actions.migrateShares.enabled
	const redeemSharesEnabled = resolvedPoolState.actions.redeemShares.enabled
	const shareBalances = tradingDetails?.shareBalances
	const maxRedeemableCompleteSets = tradingDetails?.maxRedeemableCompleteSets
	let selectedTargetOutcomeIndexes: bigint[] = []
	try {
		selectedTargetOutcomeIndexes = tradingForm.targetOutcomeIndexes
			.split(',')
			.map(value => value.trim())
			.filter(value => value !== '')
			.map(value => BigInt(value))
	} catch {
		selectedTargetOutcomeIndexes = []
	}
	const selectedTargetOutcomeIndexSet = new Set(selectedTargetOutcomeIndexes.map(value => value.toString()))
	const mintGuardMessage = getTradingMintGuardMessage({
		accountAddress: accountState.address,
		completeSetCollateralAmount: selectedPool?.completeSetCollateralAmount,
		ethBalance: accountState.ethBalance,
		hasSelectedPool,
		isMainnet,
		mintAmountInput: tradingForm.completeSetAmount,
		totalRepDeposit: selectedPool?.totalRepDeposit,
		totalSecurityBondAllowance: selectedPool?.totalSecurityBondAllowance,
	})
	const redeemCompleteSetGuardMessage = getTradingRedeemCompleteSetGuardMessage({
		accountAddress: accountState.address,
		hasSelectedPool,
		isMainnet,
		loadingTradingDetails,
		redeemAmountInput: tradingForm.redeemAmount,
		shareBalances,
	})
	const migrateSharesGuardMessage = getTradingMigrateSharesGuardMessage({
		accountAddress: accountState.address,
		hasSelectedPool,
		isMainnet,
		loadingTradingForkUniverse,
		loadingTradingDetails,
		selectedShareOutcome: tradingForm.selectedShareOutcome,
		shareBalances,
		targetOutcomeIndexesInput: tradingForm.targetOutcomeIndexes,
		tradingForkUniverse,
	})
	const redeemSharesGuardMessage = getTradingRedeemSharesGuardMessage({
		accountAddress: accountState.address,
		hasSelectedPool,
		isMainnet,
	})
	const remainingMintCapacity = getRemainingMintCapacity(selectedPool?.totalSecurityBondAllowance, selectedPool?.completeSetCollateralAmount)
	const selectedOutcomeBalance = getSelectedOutcomeShareBalance(shareBalances, tradingForm.selectedShareOutcome)
	const mintLauncherBlocker = !hasSelectedPool
		? 'Load a pool before minting complete sets.'
		: accountState.address === undefined
			? 'Connect a wallet before minting complete sets.'
			: !isMainnet
				? 'Switch to Ethereum mainnet before minting complete sets.'
				: remainingMintCapacity === undefined
					? 'Loading mint capacity.'
					: remainingMintCapacity === 0n
						? hasRepBackedPoolWithNoActiveAllowance(selectedPool?.totalRepDeposit, selectedPool?.totalSecurityBondAllowance)
							? NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE
							: 'No mint capacity remaining.'
						: undefined
	const redeemCompleteSetsLauncherBlocker = !hasSelectedPool
		? 'Load a pool before redeeming complete sets.'
		: accountState.address === undefined
			? 'Connect a wallet before redeeming complete sets.'
			: !isMainnet
				? 'Switch to Ethereum mainnet before redeeming complete sets.'
				: loadingTradingDetails
					? 'Loading wallet share balances.'
					: maxRedeemableCompleteSets === undefined
						? 'Loading wallet share balances.'
						: maxRedeemableCompleteSets === 0n
							? NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE
							: undefined
	const migrateSharesLauncherBlocker = !hasSelectedPool
		? 'Load a pool before migrating shares.'
		: accountState.address === undefined
			? 'Connect a wallet before migrating shares.'
			: !isMainnet
				? 'Switch to Ethereum mainnet before migrating shares.'
				: loadingTradingForkUniverse
					? 'Loading fork target universes.'
					: tradingForkUniverse === undefined || !tradingForkUniverse.hasForked
						? 'Refresh the fork target universes.'
						: loadingTradingDetails
							? 'Loading wallet share balances.'
							: selectedOutcomeBalance === undefined
								? 'Loading wallet share balances.'
								: selectedOutcomeBalance === 0n
									? `No ${getReportingOutcomeLabel(tradingForm.selectedShareOutcome)} shares available to migrate.`
									: undefined
	const redeemSharesLauncherBlocker = !hasSelectedPool ? 'Load a pool before redeeming shares.' : accountState.address === undefined ? 'Connect a wallet before redeeming shares.' : !isMainnet ? 'Switch to Ethereum mainnet before redeeming shares.' : undefined
	const effectiveMintLauncherBlocker = mintEnabled ? mintLauncherBlocker : undefined
	const effectiveRedeemCompleteSetsLauncherBlocker = redeemCompleteSetsEnabled ? redeemCompleteSetsLauncherBlocker : undefined
	const effectiveMigrateSharesLauncherBlocker = migrateSharesEnabled ? migrateSharesLauncherBlocker : undefined
	const effectiveRedeemSharesLauncherBlocker = redeemSharesEnabled ? redeemSharesLauncherBlocker : undefined
	const shareMigrationSelectionDisabled = poolUniverseHasForked !== true
	const setAllTargetOutcomeIndexes = () => {
		onTradingFormChange({ targetOutcomeIndexes: getDefaultShareMigrationTargetOutcomeIndexes(tradingForkUniverse) })
	}
	const clearTargetOutcomeIndexes = () => {
		onTradingFormChange({ targetOutcomeIndexes: '' })
	}
	const toggleTargetOutcomeIndex = (outcomeIndex: bigint) => {
		if (selectedTargetOutcomeIndexSet.has(outcomeIndex.toString())) {
			onTradingFormChange({
				targetOutcomeIndexes: selectedTargetOutcomeIndexes
					.filter(index => index !== outcomeIndex)
					.map(index => index.toString())
					.join(', '),
			})
			return
		}
		onTradingFormChange({
			targetOutcomeIndexes: [...selectedTargetOutcomeIndexes, outcomeIndex].map(index => index.toString()).join(', '),
		})
	}
	const renderShareMetricValue = (value: bigint | undefined) => <CurrencyValue loading={loadingTradingDetails} value={value} />
	const getTradingActionStatus = (actionName: NonNullable<TradingSectionProps['tradingFeedback']>['action']) => {
		if (tradingFeedback?.action !== actionName) return undefined
		return tradingFeedback.status.tone === 'success' ? undefined : tradingFeedback.status
	}
	const latestTradingAction =
		tradingResult === undefined
			? undefined
			: {
					dismissKey: tradingResult.hash,
					title: 'Latest Trading Action',
					embedInCard,
					rows: [
						{ label: 'Action', value: tradingResult.action },
						...(tradingResult.action !== 'migrateShares' || tradingResult.shareOutcome === undefined ? [] : [{ label: 'Share Outcome', value: tradingResult.shareOutcome }]),
						...(tradingResult.action !== 'migrateShares' || tradingResult.targetOutcomeIndexes === undefined ? [] : [{ label: 'Target Outcome Indexes', value: tradingResult.targetOutcomeIndexes.join(', ') }]),
						{ label: 'Pool', value: <AddressValue address={tradingResult.securityPoolAddress} /> },
						{ label: 'Universe', value: <UniverseLink universeId={tradingResult.universeId} /> },
						{ label: 'Transaction', value: <TransactionHashLink hash={tradingResult.hash} /> },
					],
				}
	const tradingOutcome = getTradingOutcomePresentation(tradingResult)
	const tradingLaunchers: ReadinessAction[] = [
		{
			actionLabel: 'Mint complete sets',
			description: 'Review mint capacity, available backing, and the collateral amount before minting complete sets.',
			key: 'mint-complete-sets',
			readiness: mintEnabled && effectiveMintLauncherBlocker === undefined ? 'ready' : 'blocked',
			title: 'Mint Complete Sets',
			...(mintEnabled && effectiveMintLauncherBlocker === undefined ? { onAction: () => setActiveModal('mint') } : {}),
			...(effectiveMintLauncherBlocker === undefined ? {} : { blocker: effectiveMintLauncherBlocker }),
		},
		{
			actionLabel: 'Redeem complete sets',
			description: 'Redeem matching yes, no, and invalid shares back into collateral using the available complete-set balance.',
			key: 'redeem-complete-sets',
			readiness: redeemCompleteSetsEnabled && effectiveRedeemCompleteSetsLauncherBlocker === undefined ? 'ready' : 'blocked',
			title: 'Redeem Complete Sets',
			...(redeemCompleteSetsEnabled && effectiveRedeemCompleteSetsLauncherBlocker === undefined ? { onAction: () => setActiveModal('redeem-complete-sets') } : {}),
			...(effectiveRedeemCompleteSetsLauncherBlocker === undefined ? {} : { blocker: effectiveRedeemCompleteSetsLauncherBlocker }),
		},
		{
			actionLabel: 'Migrate forked shares',
			description: 'Select the source outcome and target child universes before migrating forked shares.',
			key: 'migrate-shares',
			readiness: migrateSharesEnabled && effectiveMigrateSharesLauncherBlocker === undefined ? 'ready' : 'blocked',
			title: 'Migrate Forked Shares',
			...(migrateSharesEnabled && effectiveMigrateSharesLauncherBlocker === undefined ? { onAction: () => setActiveModal('migrate-shares') } : {}),
			...(effectiveMigrateSharesLauncherBlocker === undefined ? {} : { blocker: effectiveMigrateSharesLauncherBlocker }),
		},
		{
			actionLabel: 'Redeem resolved shares',
			description: 'Redeem finalized winning shares once the selected pool has resolved.',
			key: 'redeem-shares',
			readiness: redeemSharesEnabled && effectiveRedeemSharesLauncherBlocker === undefined ? 'ready' : 'blocked',
			title: 'Redeem Resolved Shares',
			...(redeemSharesEnabled && effectiveRedeemSharesLauncherBlocker === undefined ? { onAction: () => setActiveModal('redeem-shares') } : {}),
			...(effectiveRedeemSharesLauncherBlocker === undefined ? {} : { blocker: effectiveRedeemSharesLauncherBlocker }),
		},
	]

	const sections = (
		<>
			<WorkflowTransactionStatus latestAction={latestTradingAction} outcome={tradingOutcome} />
			{!showSecurityPoolAddressInput ? undefined : (
				<SectionBlock density='compact'>
					<label className='field'>
						<span>Security Pool Address</span>
						<FormInput value={tradingForm.securityPoolAddress} onInput={event => onTradingFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder='0x...' />
					</label>
				</SectionBlock>
			)}

			{selectedPool === undefined ? undefined : (
				<SectionBlock title='Your Shares'>
					<div className='workflow-metric-grid'>
						<MetricField label='Yes'>{renderShareMetricValue(shareBalances?.yes)}</MetricField>
						<MetricField label='No'>{renderShareMetricValue(shareBalances?.no)}</MetricField>
						<MetricField label='Invalid'>{renderShareMetricValue(shareBalances?.invalid)}</MetricField>
						<MetricField label='Total Complete Sets'>{renderShareMetricValue(maxRedeemableCompleteSets)}</MetricField>
					</div>
				</SectionBlock>
			)}

			<SectionBlock title='Trading Action Launchers'>
				<div className='vault-action-launcher-grid'>
					{tradingLaunchers.map(action => (
						<ActionLauncherCard key={action.key} action={action} />
					))}
				</div>
			</SectionBlock>

			<ErrorNotice message={tradingError} />

			<OperationModal description='Review available capacity and confirm the complete-set mint amount before submitting.' isOpen={activeModal === 'mint'} onClose={() => setActiveModal(undefined)} title='Mint Complete Sets'>
				{selectedPool === undefined ? undefined : (
					<div className='workflow-metric-grid'>
						<MetricField label='Bond Allowance In Use'>
							<CurrencyValue value={selectedPool.totalSecurityBondAllowance} suffix='ETH' />
						</MetricField>
						<MetricField label='REP Backing'>
							<CurrencyValue value={selectedPool.totalRepDeposit} suffix='REP' />
						</MetricField>
					</div>
				)}
				<label className='field'>
					<span>Mint Complete Sets Amount</span>
					<FormInput value={tradingForm.completeSetAmount} inputMode='decimal' onInput={event => onTradingFormChange({ completeSetAmount: event.currentTarget.value })} />
				</label>
				{mintGuardMessage === undefined ? undefined : <p className='detail'>{mintGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						idleLabel='Mint Complete Sets'
						pendingLabel='Minting complete sets...'
						onClick={onCreateCompleteSet}
						pending={tradingActiveAction === 'createCompleteSet'}
						status={getTradingActionStatus('createCompleteSet')}
						availability={{ disabled: !mintEnabled || mintGuardMessage !== undefined, reason: mintEnabled ? mintGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>

			<OperationModal description='Redeeming complete sets requires matching yes, no, and invalid shares. Use the total complete sets metric as the ceiling.' isOpen={activeModal === 'redeem-complete-sets'} onClose={() => setActiveModal(undefined)} title='Redeem Complete Sets'>
				<label className='field'>
					<span>Redeem Complete Sets Amount</span>
					<div className='field-inline'>
						<FormInput className='field-inline-input' value={tradingForm.redeemAmount} inputMode='decimal' onInput={event => onTradingFormChange({ redeemAmount: event.currentTarget.value })} />
						<button
							className='quiet field-inline-action'
							type='button'
							onClick={() => {
								if (maxRedeemableCompleteSets === undefined) return
								onTradingFormChange({ redeemAmount: formatCurrencyInputBalance(maxRedeemableCompleteSets) })
							}}
							disabled={maxRedeemableCompleteSets === undefined || maxRedeemableCompleteSets <= 0n}
						>
							Max
						</button>
					</div>
				</label>
				{redeemCompleteSetGuardMessage === undefined ? undefined : <p className='detail'>{redeemCompleteSetGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						idleLabel='Redeem Complete Sets'
						pendingLabel='Redeeming complete sets...'
						onClick={onRedeemCompleteSet}
						pending={tradingActiveAction === 'redeemCompleteSet'}
						status={getTradingActionStatus('redeemCompleteSet')}
						tone='secondary'
						availability={{ disabled: !redeemCompleteSetsEnabled || redeemCompleteSetGuardMessage !== undefined, reason: redeemCompleteSetsEnabled ? redeemCompleteSetGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>

			<OperationModal description='Select the share outcome and target child universes before migrating forked shares.' isOpen={activeModal === 'migrate-shares'} onClose={() => setActiveModal(undefined)} title='Migrate Forked Shares'>
				<label className='field'>
					<span>Share Outcome To Migrate</span>
					<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={tradingForm.selectedShareOutcome} onChange={selectedShareOutcome => onTradingFormChange({ selectedShareOutcome })} disabled={shareMigrationSelectionDisabled} />
				</label>
				<ShareMigrationTargetsSection
					disabled={shareMigrationSelectionDisabled}
					forkUniverse={tradingForkUniverse}
					onClearOutcomeIndexes={clearTargetOutcomeIndexes}
					onSelectAllOutcomeIndexes={setAllTargetOutcomeIndexes}
					onToggleOutcomeIndex={toggleTargetOutcomeIndex}
					selectedOutcomeIndexes={selectedTargetOutcomeIndexes}
					selectedOutcomeIndexSet={selectedTargetOutcomeIndexSet}
				/>
				{migrateSharesGuardMessage === undefined ? undefined : <p className='detail'>{migrateSharesGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						idleLabel='Migrate Shares'
						pendingLabel='Migrating shares...'
						onClick={onMigrateShares}
						pending={tradingActiveAction === 'migrateShares'}
						status={getTradingActionStatus('migrateShares')}
						tone='secondary'
						availability={{ disabled: !migrateSharesEnabled || migrateSharesGuardMessage !== undefined, reason: migrateSharesEnabled ? migrateSharesGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>

			<OperationModal description='Redeem finalized winning shares once the selected pool has resolved.' isOpen={activeModal === 'redeem-shares'} onClose={() => setActiveModal(undefined)} title='Redeem Resolved Shares'>
				{redeemSharesGuardMessage === undefined ? undefined : <p className='detail'>{redeemSharesGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						idleLabel='Redeem Shares'
						pendingLabel='Redeeming shares...'
						onClick={onRedeemShares}
						pending={tradingActiveAction === 'redeemShares'}
						status={getTradingActionStatus('redeemShares')}
						tone='secondary'
						availability={{ disabled: !redeemSharesEnabled || redeemSharesGuardMessage !== undefined, reason: redeemSharesEnabled ? redeemSharesGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>
		</>
	)

	if (embedInCard) {
		return sections
	}

	return (
		<RouteWorkflowPanel showHeader={showHeader} title='Trading'>
			{sections}
		</RouteWorkflowPanel>
	)
}
