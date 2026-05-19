import { useEffect, useRef } from 'preact/hooks'
import type { Address } from 'viem'
import { AddressInfo } from './AddressInfo.js'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { DataGrid } from './DataGrid.js'
import { FormInput } from './FormInput.js'
import { MetricField } from './MetricField.js'
import { OpenOraclePriceValue } from './OpenOraclePriceValue.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { sameAddress } from '../lib/address.js'
import { formatCurrencyInputBalance } from '../lib/formatters.js'
import { getLiquidationFailureReason, simulateLiquidation } from '../lib/liquidation.js'
import { parseRepAmountInput } from '../lib/marketForm.js'
import { renderRepPriceSourceLabel, type RepPriceSource } from '../lib/repPriceSource.js'
import { getCollateralizationTone, getVaultCollateralizationPercent } from '../lib/trading.js'
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
	selectedPool: ListedSecurityPool | undefined
	securityPoolOverviewActiveAction: 'queueLiquidation' | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
	liquidationTargetVault: string
	onLiquidationAmountChange: (value: string) => void
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address) => void
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

function getCollateralizationValueClassName(collateralizationPercent: bigint | undefined, securityMultiplier: bigint | undefined) {
	const tone = getCollateralizationTone(collateralizationPercent, securityMultiplier)
	return tone === 'success' ? 'metric-value-success' : tone === 'danger' ? 'metric-value-danger' : undefined
}

function getQuotedRepPerEthLabel(source: RepPriceSource | undefined) {
	if (source === 'mock') return 'Simulation REP / ETH'
	if (source === undefined) return 'REP / ETH'
	return 'Uniswap REP / ETH'
}

function getQuotedCollateralizationLabel(source: RepPriceSource | undefined) {
	if (source === 'mock') return 'Target Collateralization @ Simulation Price'
	if (source === undefined) return 'Target Collateralization'
	return 'Target Collateralization @ Uniswap'
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
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	selectedPool,
	securityPoolOverviewActiveAction,
	securityPoolOverviewResult,
	callerVaultSummary,
	targetVaultSummary,
	onLiquidationAmountChange,
	onQueueLiquidation,
}: LiquidationModalProps) {
	const dialogRef = useRef<HTMLElement | null>(null)
	const closeButtonRef = useRef<HTMLButtonElement | null>(null)
	const onCloseRef = useRef(closeLiquidationModal)

	useEffect(() => {
		onCloseRef.current = closeLiquidationModal
	}, [closeLiquidationModal])

	useEffect(() => {
		if (!liquidationModalOpen) return
		if (liquidationManagerAddress === undefined || currentPoolOracleManagerDetails !== undefined || loadingPoolOracleManager) return
		onLoadPoolOracleManager(liquidationManagerAddress)
	}, [currentPoolOracleManagerDetails, liquidationManagerAddress, liquidationModalOpen, loadingPoolOracleManager, onLoadPoolOracleManager])

	useEffect(() => {
		if (!liquidationModalOpen) return
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
	}, [liquidationModalOpen])

	if (!liquidationModalOpen) return undefined
	const currentTimestamp = BigInt(Math.floor(Date.now() / 1000))
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
	const liquidationActionReason =
		accountAddress === undefined
			? 'Connect a wallet before liquidating.'
			: !isMainnet
				? 'Switch to Ethereum mainnet before liquidating.'
				: liquidationExecutionMode === 'refreshing'
					? 'Refreshing Open Oracle validity before liquidation.'
					: liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined
						? 'Reload the selected pool before liquidating.'
						: trimmedLiquidationTargetVault === ''
							? 'Select a target vault first.'
							: sameVaultWarning !== undefined
								? sameVaultWarning
								: liquidationAmount.trim() === ''
									? 'Enter a liquidation amount.'
									: directLiquidationReason

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
					<div>
						<h3 id='liquidation-modal-title'>{getLiquidationModalTitle(currentPoolOracleManagerDetails)}</h3>
					</div>
					<button ref={closeButtonRef} className='quiet' onClick={closeLiquidationModal}>
						Close
					</button>
				</div>
				{queuedLiquidationStatus === undefined ? null : queuedLiquidationStatus === 'queued' ? (
					queuedLiquidationOperation === undefined ? null : (
						<section className='entity-card compact'>
							<div className='entity-card-header'>
								<div>
									<h4>Liquidation Queued</h4>
								</div>
								<span className='badge warn'>Queued</span>
							</div>
							<div className='workflow-metric-grid'>
								<MetricField label='Staged Operation'>#{queuedLiquidationOperation.operationId.toString()}</MetricField>
								<MetricField label='Amount'>
									<CurrencyValue value={queuedLiquidationOperation.amount} />
								</MetricField>
							</div>
							<div className='actions'>
								<button className='secondary' type='button' onClick={() => onSelectedPoolViewChange('staged-operations')}>
									View In Staged Operations
								</button>
							</div>
						</section>
					)
				) : queuedLiquidationStatus === 'failed' ? (
					<section className='entity-card compact'>
						<div className='entity-card-header'>
							<div>
								<h4>Liquidation Failed</h4>
							</div>
							<span className='badge blocked'>Failed</span>
						</div>
						<p className='detail'>{securityPoolOverviewResult?.stagedExecution?.errorMessage ?? 'The oracle manager attempted the liquidation immediately, but the security pool rejected it.'}</p>
					</section>
				) : queuedLiquidationStatus === 'executed' ? (
					<section className='entity-card compact'>
						<div className='entity-card-header'>
							<div>
								<h4>Liquidation Executed</h4>
							</div>
							<span className='badge ok'>Executed</span>
						</div>
						<p className='detail'>A valid oracle price was already available, so the liquidation executed immediately and no staged operation was created.</p>
					</section>
				) : queuedLiquidationStatus === 'missing' ? (
					<section className='entity-card compact'>
						<div className='entity-card-header'>
							<div>
								<h4>Liquidation Submitted</h4>
							</div>
							<span className='badge warn'>Check State</span>
						</div>
						<p className='detail'>The transaction succeeded, but no matching staged operation is currently visible for this vault. Refresh staged operations to confirm the latest manager state.</p>
					</section>
				) : (
					<section className='entity-card compact'>
						<div className='entity-card-header'>
							<div>
								<h4>Refreshing Liquidation State</h4>
							</div>
							<span className='badge muted'>Refreshing</span>
						</div>
						<p className='detail'>Refreshing the oracle manager to determine whether the liquidation was queued or executed immediately.</p>
					</section>
				)}
				<DataGrid className='modal-summary-grid' columns={2}>
					<AddressInfo address={liquidationSecurityPoolAddress} label='Security Pool' />
					<MetricField label='Security Multiplier'>{selectedPool?.securityMultiplier === undefined ? 'Unavailable' : `${selectedPool.securityMultiplier.toString()}x`}</MetricField>
					<MetricField label='Caller Vault'>{accountAddress === undefined ? 'Connect wallet' : <AddressValue address={accountAddress} />}</MetricField>
					<MetricField label='Target Vault'>{trimmedLiquidationTargetVault === '' ? 'None selected' : <AddressValue address={trimmedLiquidationTargetVault} />}</MetricField>
					<MetricField label='Open Oracle Price' valueTagName='span'>
						<OpenOraclePriceValue currentTimestamp={currentTimestamp} lastPrice={poolOraclePrice} lastSettlementTimestamp={poolOracleSettlementTimestamp} priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp} />
					</MetricField>
					<MetricField label='Target Collateralization @ Open Oracle' valueClassName={getCollateralizationValueClassName(poolOracleCollateralization, selectedPool?.securityMultiplier)}>
						{poolOracleCollateralization === undefined ? 'Unavailable' : <CurrencyValue value={poolOracleCollateralization} suffix='%' copyable={false} />}
					</MetricField>
					<MetricField
						label={
							<span>
								{getQuotedRepPerEthLabel(repPerEthSource)} {repPerEthSource === undefined ? undefined : renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
							</span>
						}
					>
						{repPerEthPrice === undefined ? 'Unavailable' : <CurrencyValue value={repPerEthPrice} suffix='REP / ETH' copyable={false} />}
					</MetricField>
					<MetricField
						label={
							<span>
								{getQuotedCollateralizationLabel(repPerEthSource)} {repPerEthSource === undefined ? undefined : renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
							</span>
						}
						valueClassName={getCollateralizationValueClassName(quotedPriceCollateralization, selectedPool?.securityMultiplier)}
					>
						{quotedPriceCollateralization === undefined ? 'Unavailable' : <CurrencyValue value={quotedPriceCollateralization} suffix='%' copyable={false} />}
					</MetricField>
					<MetricField label='Caller Collateralization @ Open Oracle' valueClassName={getCollateralizationValueClassName(callerPoolOracleCollateralization, selectedPool?.securityMultiplier)}>
						{callerPoolOracleCollateralization === undefined ? 'Unavailable' : <CurrencyValue value={callerPoolOracleCollateralization} suffix='%' copyable={false} />}
					</MetricField>
				</DataGrid>
				{sameVaultWarning === undefined ? null : (
					<section className='entity-card compact'>
						<div className='entity-card-header'>
							<div>
								<h4>Invalid Liquidation Pair</h4>
							</div>
							<span className='badge warn'>Warning</span>
						</div>
						<p className='detail'>{sameVaultWarning}</p>
					</section>
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
							<MetricField label='Collateralization @ Open Oracle' valueClassName={getCollateralizationValueClassName(liquidationSimulation.callerAfter.collateralization, selectedPool?.securityMultiplier)}>
								{liquidationSimulation.callerAfter.collateralization === undefined ? 'Unavailable' : <CurrencyValue value={liquidationSimulation.callerAfter.collateralization} suffix='%' copyable={false} />}
							</MetricField>
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
						availability={{ disabled: liquidationActionReason !== undefined, reason: liquidationActionReason }}
						showDisabledReason={liquidationExecutionMode !== 'queue'}
					/>
				</div>
			</section>
		</div>
	)
}
