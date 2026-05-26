import { useEffect, useRef } from 'preact/hooks'
import type { Address } from 'viem'
import { AddressInfo } from './AddressInfo.js'
import { AddressValue } from './AddressValue.js'
import { CollateralizationMetricField } from './CollateralizationMetricField.js'
import { CurrencyValue } from './CurrencyValue.js'
import { DataGrid } from './DataGrid.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { MetricField } from './MetricField.js'
import { OpenOraclePriceValue } from './OpenOraclePriceValue.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { WarningSurface } from './WarningSurface.js'
import { TransactionStatusCard } from './TransactionStatusCard.js'
import { sameAddress } from '../lib/address.js'
import { createActionAvailability, pickFirstReason } from '../lib/actionAvailability.js'
import { useChainTimestamp } from '../lib/chainTimestamp.js'
import { formatCurrencyInputBalance } from '../lib/formatters.js'
import { getLiquidationFailureReason, simulateLiquidation } from '../lib/liquidation.js'
import { parseRepAmountInput } from '../lib/marketForm.js'
import { getOracleRequestEthGuardMessage } from '../lib/oracleRequestEth.js'
import { getRepPriceSourceCopy, renderRepPriceSourceLabel, type RepPriceSource } from '../lib/repPriceSource.js'
import { getVaultCollateralizationPercent } from '../lib/trading.js'
import type { ActionFeedback } from '../types/components.js'
import type { SecurityPoolStateModel } from '../lib/securityPoolState.js'
import type { ListedSecurityPool, OracleManagerDetails, SecurityPoolOverviewActionResult, SecurityPoolVaultSummary } from '../types/contracts.js'

type LiquidationModalProps = {
	accountAddress: Address | undefined
	closeLiquidationModal: () => void
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	isMainnet: boolean
	liquidationAmount: string
	liquidationMaxAmount: bigint | undefined
	liquidationManagerAddress: Address | undefined
	liquidationModalOpen: boolean
	liquidationSecurityPoolAddress: Address | undefined
	loadingPoolOracleManager: boolean
	onLoadPoolOracleManager: (managerAddress: Address) => void
	onSelectedPoolViewChange: (view: string | undefined) => void
	repPerEthPrice: bigint | undefined
	repPerEthSource: RepPriceSource | undefined
	repPerEthSourceUrl: string | undefined
	poolState?: SecurityPoolStateModel | undefined
	selectedPool: ListedSecurityPool | undefined
	securityPoolOverviewActiveAction: 'queueLiquidation' | undefined
	securityPoolOverviewError: string | undefined
	securityPoolOverviewFeedback?: ActionFeedback<SecurityPoolOverviewActionResult['action']> | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
	liquidationTargetVault: string
	onLiquidationAmountChange: (value: string) => void
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address) => void
	walletEthBalance?: bigint | undefined
}

function getLiquidationExecutionMode(currentPoolOracleManagerDetails: OracleManagerDetails | undefined) {
	if (currentPoolOracleManagerDetails === undefined) return 'refreshing'
	return currentPoolOracleManagerDetails.isPriceValid ? 'execute' : 'queue'
}

function getLiquidationModalTitle(currentPoolOracleManagerDetails: OracleManagerDetails | undefined) {
	switch (getLiquidationExecutionMode(currentPoolOracleManagerDetails)) {
		case 'execute':
			return 'Execute Vault Liquidation'
		case 'queue':
			return 'Queue Vault Liquidation'
		case 'refreshing':
			return 'Liquidate Vault'
	}
}

function getLiquidationButtonLabels(currentPoolOracleManagerDetails: OracleManagerDetails | undefined) {
	switch (getLiquidationExecutionMode(currentPoolOracleManagerDetails)) {
		case 'execute':
			return { idle: 'Execute Liquidation', pending: 'Executing liquidation...' }
		case 'queue':
			return { idle: 'Queue Liquidation', pending: 'Queueing liquidation...' }
		case 'refreshing':
			return { idle: 'Liquidate Vault', pending: 'Submitting liquidation...' }
	}
}

function renderQueuedLiquidationStatusCard({
	onViewInStagedOperations,
	queuedLiquidationOperation,
	queuedLiquidationStatus,
	securityPoolOverviewResult,
}: {
	onViewInStagedOperations: () => void
	queuedLiquidationOperation: OracleManagerDetails['pendingOperation']
	queuedLiquidationStatus: 'executed' | 'failed' | 'missing' | 'queued' | 'refreshing' | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
}) {
	if (queuedLiquidationStatus === undefined) return null

	if (queuedLiquidationStatus === 'queued') {
		if (queuedLiquidationOperation === undefined) return null
		return (
			<TransactionStatusCard
				title='Liquidation Queued'
				badge={<span className='badge warn'>Queued</span>}
				metrics={
					<div className='workflow-metric-grid'>
						<MetricField label='Staged Operation'>#{queuedLiquidationOperation.operationId.toString()}</MetricField>
						<MetricField label='Amount'>
							<CurrencyValue value={queuedLiquidationOperation.amount} />
						</MetricField>
					</div>
				}
				actions={
					<button className='secondary' type='button' onClick={onViewInStagedOperations}>
						View In Staged Operations
					</button>
				}
			/>
		)
	}

	if (queuedLiquidationStatus === 'failed') {
		return <TransactionStatusCard title='Liquidation Failed' badge={<span className='badge blocked'>Failed</span>} detail={securityPoolOverviewResult?.stagedExecution?.errorMessage ?? 'The oracle manager attempted the liquidation immediately, but the security pool rejected it.'} />
	}

	if (queuedLiquidationStatus === 'executed') {
		return <TransactionStatusCard title='Liquidation Executed' badge={<span className='badge ok'>Executed</span>} detail='A valid oracle price was already available, so the liquidation executed immediately and no staged operation was created.' />
	}

	if (queuedLiquidationStatus === 'missing') {
		return <TransactionStatusCard title='Liquidation Submitted' badge={<span className='badge warn'>Check State</span>} detail='The transaction succeeded, but no matching staged operation is currently visible for this vault. Refresh staged operations to confirm the latest manager state.' />
	}

	return <TransactionStatusCard title='Refreshing Liquidation State' badge={<span className='badge muted'>Refreshing</span>} detail='Refreshing the oracle manager to determine whether the liquidation was queued or executed immediately.' />
}
export function LiquidationModal({
	accountAddress,
	closeLiquidationModal,
	currentPoolOracleManagerDetails,
	isMainnet,
	liquidationAmount,
	liquidationMaxAmount,
	liquidationManagerAddress,
	liquidationModalOpen,
	liquidationSecurityPoolAddress,
	loadingPoolOracleManager,
	liquidationTargetVault,
	onLoadPoolOracleManager,
	onSelectedPoolViewChange,
	poolState,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	selectedPool,
	securityPoolOverviewActiveAction,
	securityPoolOverviewError,
	securityPoolOverviewFeedback,
	securityPoolOverviewResult,
	callerVaultSummary,
	targetVaultSummary,
	onLiquidationAmountChange,
	onQueueLiquidation,
	walletEthBalance,
}: LiquidationModalProps) {
	const chainCurrentTimestamp = useChainTimestamp()
	const dialogRef = useRef<HTMLElement | null>(null)
	const closeButtonRef = useRef<HTMLButtonElement | null>(null)
	const onCloseRef = useRef(closeLiquidationModal)
	const showLiquidationModal = liquidationModalOpen || securityPoolOverviewActiveAction === 'queueLiquidation' || securityPoolOverviewFeedback !== undefined || securityPoolOverviewResult?.action === 'queueLiquidation' || securityPoolOverviewError !== undefined

	useEffect(() => {
		onCloseRef.current = closeLiquidationModal
	}, [closeLiquidationModal])

	useEffect(() => {
		if (!showLiquidationModal) return
		if (liquidationManagerAddress === undefined || currentPoolOracleManagerDetails !== undefined || loadingPoolOracleManager) return
		onLoadPoolOracleManager(liquidationManagerAddress)
	}, [currentPoolOracleManagerDetails, liquidationManagerAddress, loadingPoolOracleManager, onLoadPoolOracleManager, showLiquidationModal])

	useEffect(() => {
		if (!showLiquidationModal) return
		const previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
		closeButtonRef.current?.focus()
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onCloseRef.current()
			if (event.key !== 'Tab') return
			const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")
			if (focusableElements === undefined || focusableElements.length === 0) return
			const firstElement = focusableElements[0]
			const lastElement = focusableElements[focusableElements.length - 1]
			if (!(document.activeElement instanceof HTMLElement)) return
			if (event.shiftKey && document.activeElement === firstElement) {
				event.preventDefault()
				lastElement?.focus()
				return
			}
			if (!event.shiftKey && document.activeElement === lastElement) {
				event.preventDefault()
				firstElement?.focus()
			}
		}
		document.addEventListener('keydown', handleKeyDown)
		return () => {
			document.removeEventListener('keydown', handleKeyDown)
			previouslyFocusedElement?.focus()
		}
	}, [showLiquidationModal])

	if (!showLiquidationModal) return undefined
	const currentTimestamp = chainCurrentTimestamp
	const liquidationAmountValue = (() => {
		try {
			return parseRepAmountInput(liquidationAmount, 'Liquidation amount')
		} catch {
			return undefined
		}
	})()
	const poolOraclePrice = currentPoolOracleManagerDetails?.lastPrice ?? selectedPool?.lastOraclePrice
	const poolOracleSettlementTimestamp = currentPoolOracleManagerDetails?.lastSettlementTimestamp ?? selectedPool?.lastOracleSettlementTimestamp ?? 0n
	const poolOracleCollateralization = targetVaultSummary === undefined ? undefined : getVaultCollateralizationPercent(targetVaultSummary.repDepositShare, targetVaultSummary.securityBondAllowance, poolOraclePrice)
	const quotedPriceCollateralization = targetVaultSummary === undefined ? undefined : getVaultCollateralizationPercent(targetVaultSummary.repDepositShare, targetVaultSummary.securityBondAllowance, repPerEthPrice)
	const callerPoolOracleCollateralization = callerVaultSummary === undefined ? undefined : getVaultCollateralizationPercent(callerVaultSummary.repDepositShare, callerVaultSummary.securityBondAllowance, poolOraclePrice)
	const repPriceSourceCopy = getRepPriceSourceCopy(repPerEthSource)
	const liquidationExecutionMode = getLiquidationExecutionMode(currentPoolOracleManagerDetails)
	const buttonLabels = getLiquidationButtonLabels(currentPoolOracleManagerDetails)
	const trimmedLiquidationTargetVault = liquidationTargetVault.trim()
	const sameVaultWarning = accountAddress === undefined || trimmedLiquidationTargetVault === '' || !sameAddress(accountAddress, trimmedLiquidationTargetVault) ? undefined : 'Select a target vault that is different from the caller vault.'
	const liquidationSimulation =
		targetVaultSummary === undefined || poolOraclePrice === undefined || selectedPool?.securityMultiplier === undefined || liquidationAmountValue === undefined
			? undefined
			: simulateLiquidation({
					callerVaultSummary,
					liquidationAmount: liquidationAmountValue,
					repPerEthPrice: poolOraclePrice,
					targetVaultSummary,
				})
	const directLiquidationReason =
		liquidationExecutionMode !== 'execute'
			? undefined
			: selectedPool?.securityMultiplier === undefined
				? 'Reload the selected pool before executing liquidation.'
				: getLiquidationFailureReason({
						callerVaultSummary,
						liquidationAmount: liquidationAmountValue,
						repPerEthPrice: poolOraclePrice,
						securityMultiplier: selectedPool.securityMultiplier,
						targetVaultSummary,
					})
	const queueLiquidationEthGuardMessage =
		liquidationExecutionMode !== 'queue'
			? undefined
			: getOracleRequestEthGuardMessage({
					actionLabel: 'queue this liquidation',
					requestPriceEthCost: currentPoolOracleManagerDetails?.requestPriceEthCost,
					walletEthBalance,
				})
	const liquidationActionReason = pickFirstReason(
		accountAddress === undefined ? 'Connect a wallet before liquidating.' : undefined,
		!isMainnet ? 'Switch to Ethereum mainnet before liquidating.' : undefined,
		poolState?.actions.queueLiquidation.reason,
		liquidationExecutionMode === 'refreshing' ? 'Refreshing Open Oracle validity before liquidation.' : undefined,
		liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined ? 'Reload the selected pool before liquidating.' : undefined,
		trimmedLiquidationTargetVault === '' ? 'Select a target vault first.' : undefined,
		sameVaultWarning,
		liquidationAmount.trim() === '' ? 'Enter a liquidation amount.' : undefined,
		directLiquidationReason,
		queueLiquidationEthGuardMessage,
	)

	const queuedLiquidationOperation =
		securityPoolOverviewResult?.action !== 'queueLiquidation' || currentPoolOracleManagerDetails?.pendingOperation?.operation !== 'liquidation' || currentPoolOracleManagerDetails.pendingOperation.targetVault !== liquidationTargetVault ? undefined : currentPoolOracleManagerDetails.pendingOperation
	const queuedLiquidationStatus =
		securityPoolOverviewResult?.action !== 'queueLiquidation'
			? undefined
			: securityPoolOverviewResult.stagedExecution !== undefined
				? securityPoolOverviewResult.stagedExecution.success
					? 'executed'
					: 'failed'
				: loadingPoolOracleManager || currentPoolOracleManagerDetails === undefined
					? 'refreshing'
					: queuedLiquidationOperation !== undefined
						? 'queued'
						: currentPoolOracleManagerDetails.isPriceValid
							? 'executed'
							: 'missing'

	return (
		<div className='modal-backdrop' role='presentation' onClick={closeLiquidationModal}>
			<section ref={dialogRef} className='modal-panel' role='dialog' aria-modal='true' aria-labelledby='liquidation-modal-title' onClick={event => event.stopPropagation()}>
				<div className='modal-header'>
					<div className='modal-header-title'>
						<h3 id='liquidation-modal-title'>{getLiquidationModalTitle(currentPoolOracleManagerDetails)}</h3>
					</div>
					<button ref={closeButtonRef} className='quiet modal-close-button' type='button' aria-label='Close' title='Close' onClick={closeLiquidationModal}>
						×
					</button>
				</div>
				{renderQueuedLiquidationStatusCard({
					onViewInStagedOperations: () => onSelectedPoolViewChange('staged-operations'),
					queuedLiquidationOperation,
					queuedLiquidationStatus,
					securityPoolOverviewResult,
				})}
				<ErrorNotice message={securityPoolOverviewError} />
				<DataGrid className='modal-summary-grid' columns={2}>
					<AddressInfo address={liquidationSecurityPoolAddress} label='Security Pool' />
					<MetricField label='Security Multiplier'>{selectedPool?.securityMultiplier === undefined ? 'Unavailable' : `${selectedPool.securityMultiplier.toString()}x`}</MetricField>
					<MetricField label='Caller Vault'>{accountAddress === undefined ? 'Connect wallet' : <AddressValue address={accountAddress} />}</MetricField>
					<MetricField label='Target Vault'>{trimmedLiquidationTargetVault === '' ? 'None selected' : <AddressValue address={trimmedLiquidationTargetVault} />}</MetricField>
					<MetricField label='Open Oracle Price' valueTagName='span'>
						<OpenOraclePriceValue currentTimestamp={currentTimestamp} lastPrice={poolOraclePrice} lastSettlementTimestamp={poolOracleSettlementTimestamp} priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp} />
					</MetricField>
					<CollateralizationMetricField
						collateralizationPercent={poolOracleCollateralization}
						label='Target Collateralization @ Open Oracle'
						repPerEthSource={undefined}
						repPerEthSourceUrl={undefined}
						securityBondAllowance={targetVaultSummary?.securityBondAllowance}
						securityMultiplier={selectedPool?.securityMultiplier}
						unavailableCopy='Unavailable'
					/>
					<MetricField
						label={
							<span>
								{repPriceSourceCopy.quotedRepPerEthLabel} {renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
							</span>
						}
					>
						{repPerEthPrice === undefined ? 'Unavailable' : <CurrencyValue value={repPerEthPrice} suffix='REP / ETH' copyable={false} />}
					</MetricField>
					<CollateralizationMetricField
						collateralizationPercent={quotedPriceCollateralization}
						label={
							<span>
								{repPriceSourceCopy.quotedCollateralizationLabel} {renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
							</span>
						}
						repPerEthSource={repPerEthSource}
						repPerEthSourceUrl={repPerEthSourceUrl}
						securityBondAllowance={targetVaultSummary?.securityBondAllowance}
						securityMultiplier={selectedPool?.securityMultiplier}
						unavailableCopy='Unavailable'
					/>
					<CollateralizationMetricField
						collateralizationPercent={callerPoolOracleCollateralization}
						label='Caller Collateralization @ Open Oracle'
						repPerEthSource={undefined}
						repPerEthSourceUrl={undefined}
						securityBondAllowance={callerVaultSummary?.securityBondAllowance}
						securityMultiplier={selectedPool?.securityMultiplier}
						unavailableCopy='Unavailable'
					/>
				</DataGrid>
				{sameVaultWarning === undefined ? null : (
					<WarningSurface as='section' variant='compact'>
						<div className='entity-card-header'>
							<div>
								<h4>Invalid Liquidation Pair</h4>
							</div>
						</div>
						<p className='detail'>{sameVaultWarning}</p>
					</WarningSurface>
				)}
				<div className='form-grid'>
					<label className='field'>
						<span>Liquidation Amount (ETH)</span>
						<div className='field-inline'>
							<FormInput className='field-inline-input' value={liquidationAmount} onInput={event => onLiquidationAmountChange(event.currentTarget.value)} placeholder='0.0' />
							<button className='quiet field-inline-action' type='button' onClick={() => onLiquidationAmountChange(liquidationMaxAmount === undefined ? '' : formatCurrencyInputBalance(liquidationMaxAmount))} disabled={liquidationMaxAmount === undefined || liquidationMaxAmount <= 0n}>
								Max
							</button>
						</div>
					</label>
				</div>
				{liquidationSimulation === undefined ? null : (
					<section className='entity-card compact'>
						<div className='entity-card-header'>
							<div>
								<h4>Caller Vault After Liquidation</h4>
							</div>
						</div>
						<div className='workflow-metric-grid'>
							<MetricField label='REP Collateral'>
								<CurrencyValue value={liquidationSimulation.callerAfter.repDepositShare} suffix='REP' />
							</MetricField>
							<MetricField label='Security Bond Allowance'>
								<CurrencyValue value={liquidationSimulation.callerAfter.securityBondAllowance} suffix='ETH' />
							</MetricField>
							<CollateralizationMetricField
								collateralizationPercent={liquidationSimulation.callerAfter.collateralization}
								label='Collateralization @ Open Oracle'
								repPerEthSource={undefined}
								repPerEthSourceUrl={undefined}
								securityBondAllowance={liquidationSimulation.callerAfter.securityBondAllowance}
								securityMultiplier={selectedPool?.securityMultiplier}
								unavailableCopy='Unavailable'
							/>
							<MetricField label='Rep Moved'>
								<CurrencyValue value={liquidationSimulation.repToMove} suffix='REP' />
							</MetricField>
						</div>
					</section>
				)}
				<div className='actions liquidation-modal-actions'>
					<button className='secondary' onClick={closeLiquidationModal}>
						Cancel
					</button>
					<TransactionActionButton
						idleLabel={buttonLabels.idle}
						pendingLabel={buttonLabels.pending}
						onClick={() => {
							if (liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined) return
							onQueueLiquidation(liquidationManagerAddress, liquidationSecurityPoolAddress)
						}}
						pending={securityPoolOverviewActiveAction === 'queueLiquidation'}
						availability={createActionAvailability(liquidationActionReason)}
						showDisabledReason={liquidationExecutionMode !== 'queue'}
					/>
				</div>
			</section>
		</div>
	)
}
