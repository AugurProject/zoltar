import { useEffect, useRef } from 'preact/hooks'
import { AddressValue } from './AddressValue.js'
import { ApprovedAmountValue } from './ApprovedAmountValue.js'
import { CollateralizationMetricField } from './CollateralizationMetricField.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { LatestActionSection } from './LatestActionSection.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { StateHint } from './StateHint.js'
import { TimestampValue } from './TimestampValue.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { normalizeAddress, sameAddress } from '../lib/address.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from '../lib/formatters.js'
import { balanceShortage } from '../lib/inputs.js'
import { isMainnetChain } from '../lib/network.js'
import { parseRepAmountInput } from '../lib/marketForm.js'
import { getSelectedVaultAddress, hasValidSecurityVaultOraclePrice, isSecurityVaultDepositBelowMinimum, isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper, MIN_SECURITY_VAULT_REP_DEPOSIT } from '../lib/securityVault.js'
import { getVaultCollateralizationPercent } from '../lib/trading.js'
import { deriveTokenApprovalRequirement } from '../lib/tokenApproval.js'
import { getWalletPresentation } from '../lib/userCopy.js'
import type { SecurityVaultSectionProps } from '../types/components.js'

export function SecurityVaultSection({
	accountState,
	compactLayout = false,
	autoLoadVault = false,
	loadingSecurityVault,
	onApproveRep,
	onDepositRep,
	onLoadSecurityVault,
	onRedeemFees,
	onSetSecurityBondAllowance,
	onSecurityVaultFormChange,
	oracleManagerDetails,
	onWithdrawRep,
	securityVaultDetails,
	securityVaultError,
	securityVaultForm,
	securityVaultMissing,
	securityVaultActiveAction,
	securityVaultRepApproval,
	securityVaultRepBalance,
	securityVaultResult,
	selectedPoolSecurityMultiplier,
	repEthPrice,
	repEthSource,
	repEthSourceUrl,
	showHeader = true,
	showSecurityPoolAddressInput = true,
}: SecurityVaultSectionProps) {
	const isMainnet = isMainnetChain(accountState?.chainId)
	const normalizedSecurityVaultForm = {
		depositAmount: securityVaultForm.depositAmount ?? '0',
		securityBondAllowanceAmount: securityVaultForm.securityBondAllowanceAmount ?? '0',
		repWithdrawAmount: securityVaultForm.repWithdrawAmount ?? '0',
		securityPoolAddress: securityVaultForm.securityPoolAddress ?? '',
		selectedVaultAddress: securityVaultForm.selectedVaultAddress ?? '',
	}
	const selectedVaultAddress = getSelectedVaultAddress(normalizedSecurityVaultForm.selectedVaultAddress, accountState.address)
	const hasWithdrawAmount = normalizedSecurityVaultForm.repWithdrawAmount.trim() !== '' && normalizedSecurityVaultForm.repWithdrawAmount.trim() !== '0'
	const selectedVaultIsOwnedByAccount = isSelectedVaultOwnedByAccountHelper(selectedVaultAddress, accountState.address)
	const depositAmount = (() => {
		try {
			return parseRepAmountInput(normalizedSecurityVaultForm.depositAmount, 'REP deposit amount')
		} catch {
			return undefined
		}
	})()
	const securityBondAllowanceAmount = (() => {
		try {
			return parseRepAmountInput(normalizedSecurityVaultForm.securityBondAllowanceAmount, 'Security bond allowance')
		} catch {
			return undefined
		}
	})()
	const securityBondAllowance = securityVaultDetails?.securityBondAllowance ?? 0n
	const hasValidOraclePrice = hasValidSecurityVaultOraclePrice(securityVaultDetails?.managerAddress, oracleManagerDetails)
	const oraclePriceValidUntilTimestamp = hasValidOraclePrice ? oracleManagerDetails?.priceValidUntilTimestamp : undefined
	const approvalRequirement = deriveTokenApprovalRequirement(depositAmount, securityVaultRepApproval.value)
	const repBalanceGap = balanceShortage(depositAmount, securityVaultRepBalance)
	const withdrawableRepAmount = securityVaultDetails === undefined ? undefined : securityVaultDetails.repDepositShare > securityVaultDetails.lockedRepInEscalationGame ? securityVaultDetails.repDepositShare - securityVaultDetails.lockedRepInEscalationGame : 0n
	const isDepositBelowMinimum = isSecurityVaultDepositBelowMinimum(securityVaultDetails?.repDepositShare, depositAmount)
	const hasClaimableFees = securityVaultDetails !== undefined && securityVaultDetails.unpaidEthFees > 0n
	const canClaimFees = selectedVaultIsOwnedByAccount && isMainnet && hasClaimableFees
	const hasSufficientDepositAllowance = selectedVaultIsOwnedByAccount && depositAmount !== undefined && depositAmount > 0n && approvalRequirement.hasSufficientApproval
	const hasInsufficientRepBalance = repBalanceGap !== undefined && repBalanceGap > 0n
	const canSetSecurityBondAllowance = selectedVaultIsOwnedByAccount && isMainnet && securityVaultDetails !== undefined && hasValidOraclePrice && securityBondAllowanceAmount !== undefined && securityBondAllowanceAmount > 0n
	const canWithdrawRep = selectedVaultIsOwnedByAccount && accountState.address !== undefined && isMainnet && hasValidOraclePrice && hasWithdrawAmount && withdrawableRepAmount !== undefined && withdrawableRepAmount > 0n
	const approvalGuardMessage = (() => {
		const walletPresentation = getWalletPresentation({ accountAddress: accountState.address, isMainnet })
		if (walletPresentation !== undefined) return walletPresentation.detail
		if (!selectedVaultIsOwnedByAccount) return 'Select your own vault to approve REP.'
		if (securityVaultMissing) return 'Choose a pool first.'
		if (securityVaultDetails === undefined) return 'Refresh the vault first.'
		if (depositAmount === undefined || depositAmount <= 0n) return 'Enter a deposit amount greater than zero.'
		return undefined
	})()
	const latestActionLabel =
		securityVaultResult === undefined
			? undefined
			: {
					approveRep: 'Approve REP',
					depositRep: 'Deposit REP',
					queueSetSecurityBondAllowance: 'Set Security Bond Allowance',
					queueWithdrawRep: 'Withdraw REP',
					redeemFees: 'Redeem Fees',
					updateVaultFees: 'Update Fees',
				}[securityVaultResult.action]
	const autoLoadKey = `${normalizeAddress(selectedVaultAddress) ?? ''}:${normalizeAddress(normalizedSecurityVaultForm.securityPoolAddress) ?? ''}`
	const hasLoadedCurrentVault = securityVaultDetails !== undefined && sameAddress(securityVaultDetails.vaultAddress, selectedVaultAddress) && sameAddress(securityVaultDetails.securityPoolAddress, normalizedSecurityVaultForm.securityPoolAddress)
	const lastAutoLoadKey = useRef<string | undefined>(undefined)
	const vaultLoadNotice = loadingSecurityVault ? (
		<p className='detail'>
			<LoadingText>Loading vault...</LoadingText>
		</p>
	) : securityVaultMissing ? (
		<StateHint presentation={{ key: 'not_found', badgeLabel: 'Not found', badgeTone: 'blocked', detail: 'Try another pool address.' }} />
	) : undefined

	useEffect(() => {
		if (!autoLoadVault) return
		if (accountState.address === undefined) return
		if (normalizedSecurityVaultForm.securityPoolAddress.trim() === '') return
		if (hasLoadedCurrentVault || loadingSecurityVault) return
		if (lastAutoLoadKey.current === autoLoadKey) return
		lastAutoLoadKey.current = autoLoadKey
		void onLoadSecurityVault()
	}, [accountState.address, autoLoadKey, autoLoadVault, hasLoadedCurrentVault, loadingSecurityVault, normalizedSecurityVaultForm.securityPoolAddress, onLoadSecurityVault])

	const vaultSummarySection = (
		<div className='entity-card-subsection'>
			{vaultLoadNotice}
			{securityVaultDetails === undefined ? undefined : (
				<div className='entity-metric-grid'>
					<MetricField className='entity-metric' label='Selected Vault'>
						<AddressValue address={securityVaultDetails.vaultAddress} />
					</MetricField>
					<MetricField className='entity-metric' label='Rep Deposit'>
						<CurrencyValue value={securityVaultDetails.repDepositShare} suffix='REP' />
					</MetricField>
					<MetricField className='entity-metric' label='Approved REP'>
						<ApprovedAmountValue loading={securityVaultRepApproval.loading} value={securityVaultRepApproval.value} suffix='REP' />
					</MetricField>
					<MetricField className='entity-metric' label='Security Bond Allowance'>
						<CurrencyValue value={securityBondAllowance} suffix='ETH' />
					</MetricField>
					<CollateralizationMetricField
						className='entity-metric'
						collateralizationPercent={getVaultCollateralizationPercent(securityVaultDetails.repDepositShare, securityBondAllowance, repEthPrice)}
						repEthSource={repEthSource}
						repEthSourceUrl={repEthSourceUrl}
						securityBondAllowance={securityBondAllowance}
						securityMultiplier={selectedPoolSecurityMultiplier}
					/>
					<MetricField className='entity-metric' label='Unpaid ETH Fees'>
						<CurrencyValue value={securityVaultDetails.unpaidEthFees} suffix='ETH' />
					</MetricField>
					<MetricField className='entity-metric' label='Locked REP'>
						<CurrencyValue value={securityVaultDetails.lockedRepInEscalationGame} suffix='REP' />
					</MetricField>
					<MetricField className='entity-metric' label='Total Security Bond Allowance'>
						<CurrencyValue value={securityVaultDetails.totalSecurityBondAllowance} suffix='ETH' />
					</MetricField>
				</div>
			)}
			<label className='field'>
				<span>Selected Vault Address</span>
				<input value={normalizedSecurityVaultForm.selectedVaultAddress} onInput={event => onSecurityVaultFormChange({ selectedVaultAddress: event.currentTarget.value })} placeholder='0x...' />
			</label>
			{showSecurityPoolAddressInput ? (
				<label className='field'>
					<span>Security Pool Address</span>
					<input value={normalizedSecurityVaultForm.securityPoolAddress} onInput={event => onSecurityVaultFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder='0x...' />
				</label>
			) : undefined}
			<div className='actions'>
				<button className='secondary' onClick={() => onLoadSecurityVault()} disabled={loadingSecurityVault}>
					{loadingSecurityVault ? <LoadingText>Refreshing...</LoadingText> : 'Refresh'}
				</button>
				{selectedVaultIsOwnedByAccount ? (
					<button className='primary' onClick={onRedeemFees} disabled={!canClaimFees}>
						Claim Fees
					</button>
				) : undefined}
			</div>
			{selectedVaultIsOwnedByAccount ? undefined : <p className='detail'>Select your own vault to unlock actions.</p>}
		</div>
	)

	const securityBondAllowanceSection =
		securityVaultDetails === undefined ? undefined : (
			<div className='entity-card-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Set Security Bond Allowance</h4>
				</div>
				<div className='entity-metric-grid'>
					<MetricField className='entity-metric' label='Current Security Bond Allowance'>
						<CurrencyValue value={securityBondAllowance} suffix='ETH' />
					</MetricField>
					{oraclePriceValidUntilTimestamp === undefined ? undefined : (
						<MetricField className='entity-metric' label='Price Valid Until'>
							<TimestampValue timestamp={oraclePriceValidUntilTimestamp} />
						</MetricField>
					)}
				</div>
				<label className='field'>
					<span>Security Bond Allowance Amount</span>
					<input value={normalizedSecurityVaultForm.securityBondAllowanceAmount} onInput={event => onSecurityVaultFormChange({ securityBondAllowanceAmount: event.currentTarget.value })} />
				</label>
				<div className='actions'>
					<button className='secondary' onClick={onSetSecurityBondAllowance} disabled={!canSetSecurityBondAllowance}>
						Set Security Bond Allowance
					</button>
				</div>
				{hasValidOraclePrice ? undefined : <p className='detail'>A valid oracle price is required before setting the security bond allowance.</p>}
			</div>
		)

	const latestAction =
		securityVaultResult === undefined ? undefined : (
			<LatestActionSection
				title='Latest Vault Action'
				embedInCard
				rows={[
					{ label: 'Action', value: latestActionLabel ?? securityVaultResult.action },
					{ label: 'Transaction', value: <TransactionHashLink hash={securityVaultResult.hash} /> },
				]}
			/>
		)

	const vaultDepositSection = (
		<div className='entity-card-subsection'>
			<div className='entity-card-subsection-header'>
				<h4>Deposit REP</h4>
			</div>
			<label className='field'>
				<span>REP Deposit Amount</span>
				<div className='field-inline'>
					<input className='field-inline-input' value={normalizedSecurityVaultForm.depositAmount} onInput={event => onSecurityVaultFormChange({ depositAmount: event.currentTarget.value })} />
					<button
						className='quiet field-inline-action'
						type='button'
						onClick={() => {
							if (securityVaultRepBalance === undefined) return
							const repAmount = formatCurrencyInputBalance(securityVaultRepBalance)
							onSecurityVaultFormChange({ depositAmount: repAmount })
						}}
						disabled={securityVaultRepBalance === undefined}
					>
						Max
					</button>
				</div>
			</label>
			<TokenApprovalControl
				actionLabel='depositing REP'
				allowanceError={securityVaultRepApproval.error}
				allowanceLoading={securityVaultRepApproval.loading}
				approvedAmount={securityVaultRepApproval.value}
				guardMessage={approvalGuardMessage}
				onApprove={amount => onApproveRep(amount)}
				pending={securityVaultActiveAction === 'approveRep'}
				pendingLabel='Approving REP...'
				requiredAmount={depositAmount}
				resetKey={`${securityVaultDetails?.repToken ?? ''}:${securityVaultDetails?.securityPoolAddress ?? ''}:${depositAmount?.toString() ?? ''}`}
				tokenSymbol='REP'
				tokenUnits={18}
			/>
			<div className='actions'>
				<button className='primary' onClick={onDepositRep} disabled={!selectedVaultIsOwnedByAccount || accountState.address === undefined || !isMainnet || !hasSufficientDepositAllowance || hasInsufficientRepBalance || isDepositBelowMinimum}>
					Create / Deposit REP
				</button>
			</div>
			{repBalanceGap !== undefined && repBalanceGap > 0n ? (
				<ErrorNotice message={`Insufficient REP balance. Deposit amount exceeds your wallet balance by ${formatCurrencyBalance(repBalanceGap)} REP.`} />
			) : isDepositBelowMinimum ? (
				<p className='detail'>
					New vaults require at least <CurrencyValue value={MIN_SECURITY_VAULT_REP_DEPOSIT} suffix='REP' copyable={false} /> in the first deposit.
				</p>
			) : undefined}
		</div>
	)

	const vaultRepSection = (
		<div className='entity-card-subsection'>
			<div className='entity-card-subsection-header'>
				<h4>Withdraw REP</h4>
			</div>
			{withdrawableRepAmount === undefined ? (
				<p className='detail'>Refresh to see withdrawable REP.</p>
			) : (
				<div className='entity-metric-grid'>
					<MetricField className='entity-metric' label='Withdrawable REP'>
						<CurrencyValue value={withdrawableRepAmount} suffix='REP' />
					</MetricField>
					{oraclePriceValidUntilTimestamp === undefined ? undefined : (
						<MetricField className='entity-metric' label='Price Valid Until'>
							<TimestampValue timestamp={oraclePriceValidUntilTimestamp} />
						</MetricField>
					)}
				</div>
			)}
			<label className='field'>
				<span>REP Withdraw Amount</span>
				<div className='field-inline'>
					<input className='field-inline-input' value={normalizedSecurityVaultForm.repWithdrawAmount} onInput={event => onSecurityVaultFormChange({ repWithdrawAmount: event.currentTarget.value })} />
					<button
						className='quiet field-inline-action'
						type='button'
						onClick={() => {
							if (withdrawableRepAmount === undefined) return
							onSecurityVaultFormChange({ repWithdrawAmount: formatCurrencyInputBalance(withdrawableRepAmount) })
						}}
						disabled={withdrawableRepAmount === undefined}
					>
						Max
					</button>
				</div>
			</label>
			<div className='actions'>
				<button className='secondary' onClick={onWithdrawRep} disabled={!canWithdrawRep}>
					Withdraw REP
				</button>
			</div>
			{hasValidOraclePrice ? undefined : <p className='detail'>A valid oracle price is required before withdrawing REP.</p>}
		</div>
	)

	if (compactLayout) {
		return (
			<>
				{vaultSummarySection}
				{latestAction}
				{selectedVaultIsOwnedByAccount ? vaultDepositSection : undefined}
				{selectedVaultIsOwnedByAccount ? securityBondAllowanceSection : undefined}
				{selectedVaultIsOwnedByAccount ? vaultRepSection : undefined}
				<ErrorNotice message={securityVaultError} />
			</>
		)
	}

	return (
		<section className='panel market-panel'>
			{showHeader ? (
				<div className='market-header'>
					<div>
						<h2>Security Vault</h2>
						<p className='detail'>Browse vaults for the selected security pool, then manage REP, fees, and redemptions for the selected vault.</p>
					</div>
				</div>
			) : undefined}

			<div className='market-grid'>
				<div className='market-column'>
					<EntityCard title='Selected Vault'>{vaultSummarySection}</EntityCard>

					{securityVaultResult === undefined ? undefined : (
						<LatestActionSection
							title='Latest Vault Action'
							rows={[
								{ label: 'Action', value: latestActionLabel ?? securityVaultResult.action },
								{ label: 'Transaction', value: <TransactionHashLink hash={securityVaultResult.hash} /> },
							]}
						/>
					)}
				</div>

				<div className='market-column'>
					{selectedVaultIsOwnedByAccount ? (
						<EntityCard title='Vault Actions'>
							{vaultDepositSection}
							{securityBondAllowanceSection}
							{vaultRepSection}
						</EntityCard>
					) : undefined}

					<ErrorNotice message={securityVaultError} />
				</div>
			</div>
		</section>
	)
}
