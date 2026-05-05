import { useEffect, useRef } from 'preact/hooks'
import { ApprovedAmountValue } from './ApprovedAmountValue.js'
import { CollateralizationMetricField } from './CollateralizationMetricField.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { LatestActionSection } from './LatestActionSection.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { TimestampValue } from './TimestampValue.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { normalizeAddress, sameAddress } from '../lib/address.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from '../lib/formatters.js'
import { balanceShortage } from '../lib/inputs.js'
import { parseRepAmountInput } from '../lib/marketForm.js'
import { isMainnetChain } from '../lib/network.js'
import { deriveTokenApprovalRequirement } from '../lib/tokenApproval.js'
import { getWalletPresentation } from '../lib/userCopy.js'
import { getSelectedVaultAddress, hasValidSecurityVaultOraclePrice, isSecurityVaultDepositBelowMinimum, isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper, MIN_SECURITY_VAULT_REP_DEPOSIT } from '../lib/securityVault.js'
import { getVaultCollateralizationPercent } from '../lib/trading.js'
import type { SecurityVaultSectionProps } from '../types/components.js'

type SelectedVaultSummarySectionProps = Pick<SecurityVaultSectionProps, 'repPerEthPrice' | 'repPerEthSource' | 'repPerEthSourceUrl' | 'securityVaultRepApproval' | 'selectedPoolSecurityMultiplier'> & {
	securityBondAllowance: bigint
	securityVaultDetails: NonNullable<SecurityVaultSectionProps['securityVaultDetails']>
	selectedVaultIsOwnedByAccount: boolean
	variant?: 'embedded' | 'record'
}

export function SelectedVaultSummarySection({ repPerEthPrice, repPerEthSource, repPerEthSourceUrl, securityBondAllowance, securityVaultDetails, securityVaultRepApproval, selectedPoolSecurityMultiplier, selectedVaultIsOwnedByAccount, variant = 'record' }: SelectedVaultSummarySectionProps) {
	const gridClassName = variant === 'embedded' ? 'workflow-metric-grid' : 'entity-metric-grid'
	const metricClassName = variant === 'embedded' ? undefined : 'entity-metric'
	const content = (
		<div className={gridClassName}>
			<MetricField className={metricClassName} label='Rep Deposit'>
				<CurrencyValue value={securityVaultDetails.repDepositShare} suffix='REP' />
			</MetricField>
			<MetricField className={metricClassName} label='Approved REP'>
				<ApprovedAmountValue loading={securityVaultRepApproval.loading} value={securityVaultRepApproval.value} suffix='REP' />
			</MetricField>
			<MetricField className={metricClassName} label='Security Bond Allowance'>
				<CurrencyValue value={securityBondAllowance} suffix='ETH' />
			</MetricField>
			<CollateralizationMetricField
				className={metricClassName}
				collateralizationPercent={getVaultCollateralizationPercent(securityVaultDetails.repDepositShare, securityBondAllowance, repPerEthPrice)}
				repPerEthSource={repPerEthSource}
				repPerEthSourceUrl={repPerEthSourceUrl}
				securityBondAllowance={securityBondAllowance}
				securityMultiplier={selectedPoolSecurityMultiplier}
			/>
			<MetricField className={metricClassName} label='Unpaid ETH Fees'>
				<CurrencyValue value={securityVaultDetails.unpaidEthFees} suffix='ETH' />
			</MetricField>
			<MetricField className={metricClassName} label='Locked REP'>
				<CurrencyValue value={securityVaultDetails.lockedRepInEscalationGame} suffix='REP' />
			</MetricField>
		</div>
	)

	if (variant === 'embedded') {
		return (
			<SectionBlock density='compact' headingLevel={4} title='Vault Summary' variant='embedded'>
				{content}
			</SectionBlock>
		)
	}

	return (
		<EntityCard badge={<span className={`badge ${selectedVaultIsOwnedByAccount ? 'ok' : 'muted'}`}>{selectedVaultIsOwnedByAccount ? 'Owned' : 'Read only'}</span>} title='Selected Vault' variant='record'>
			{content}
		</EntityCard>
	)
}

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
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	showHeader = true,
	showLookupSection = true,
	showSummarySection = true,
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
	const claimFeesGuardMessage = !selectedVaultIsOwnedByAccount ? 'Select your own vault to claim fees.' : !isMainnet ? 'Switch to Ethereum mainnet before claiming fees.' : !hasClaimableFees ? 'No claimable fees are available for this vault.' : undefined
	const setSecurityBondAllowanceGuardMessage = !selectedVaultIsOwnedByAccount
		? 'Select your own vault to set the security bond allowance.'
		: !isMainnet
			? 'Switch to Ethereum mainnet before setting the security bond allowance.'
			: securityVaultDetails === undefined
				? 'Refresh the vault before setting the security bond allowance.'
				: !hasValidOraclePrice
					? 'A valid oracle price is required before setting the security bond allowance.'
					: securityBondAllowanceAmount === undefined || securityBondAllowanceAmount <= 0n
						? 'Enter a security bond allowance greater than zero.'
						: undefined
	const depositGuardMessage = !selectedVaultIsOwnedByAccount
		? 'Select your own vault to deposit REP.'
		: accountState.address === undefined
			? 'Connect a wallet before depositing REP.'
			: !isMainnet
				? 'Switch to Ethereum mainnet before depositing REP.'
				: !hasSufficientDepositAllowance
					? 'Approve enough REP before depositing.'
					: hasInsufficientRepBalance
						? `Need ${formatCurrencyBalance(repBalanceGap ?? 0n)} more REP in this wallet.`
						: isDepositBelowMinimum
							? `New vaults require at least ${formatCurrencyBalance(MIN_SECURITY_VAULT_REP_DEPOSIT)} REP in the first deposit.`
							: undefined
	const withdrawRepGuardMessage = !selectedVaultIsOwnedByAccount
		? 'Select your own vault to withdraw REP.'
		: accountState.address === undefined
			? 'Connect a wallet before withdrawing REP.'
			: !isMainnet
				? 'Switch to Ethereum mainnet before withdrawing REP.'
				: !hasValidOraclePrice
					? 'A valid oracle price is required before withdrawing REP.'
					: !hasWithdrawAmount
						? 'Enter a REP withdraw amount.'
						: withdrawableRepAmount === undefined || withdrawableRepAmount <= 0n
							? 'No REP is currently withdrawable from this vault.'
							: undefined
	const approvalGuardMessage = (() => {
		const walletPresentation = getWalletPresentation({ accountAddress: accountState.address, isMainnet })
		if (walletPresentation !== undefined) return walletPresentation.detail
		if (!selectedVaultIsOwnedByAccount) return 'Select your own vault to approve REP.'
		if (securityVaultMissing) return 'Choose a pool first.'
		if (securityVaultDetails === undefined) return 'Refresh the vault first.'
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
	const latestAction =
		securityVaultResult === undefined ? undefined : (
			<LatestActionSection
				title='Latest Vault Action'
				embedInCard={compactLayout}
				rows={[
					{ label: 'Action', value: latestActionLabel ?? securityVaultResult.action },
					{ label: 'Transaction', value: <TransactionHashLink hash={securityVaultResult.hash} /> },
				]}
			/>
		)

	const sections = (
		<>
			{showLookupSection ? (
				<SectionBlock title='Vault Lookup'>
					{vaultLoadNotice}
					<LookupFieldRow
						label='Selected Vault Address'
						value={normalizedSecurityVaultForm.selectedVaultAddress}
						onInput={selectedVaultAddress => onSecurityVaultFormChange({ selectedVaultAddress })}
						placeholder='0x...'
						action={
							<button className='secondary' onClick={() => onLoadSecurityVault()} disabled={loadingSecurityVault}>
								{loadingSecurityVault ? <LoadingText>Refreshing...</LoadingText> : 'Refresh'}
							</button>
						}
					/>
					{showSecurityPoolAddressInput ? (
						<label className='field'>
							<span>Security Pool Address</span>
							<input value={normalizedSecurityVaultForm.securityPoolAddress} onInput={event => onSecurityVaultFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder='0x...' />
						</label>
					) : undefined}
					{selectedVaultIsOwnedByAccount ? undefined : <p className='detail'>Select your own vault to unlock actions.</p>}
				</SectionBlock>
			) : undefined}

			{showSummarySection && securityVaultDetails !== undefined ? (
				<SelectedVaultSummarySection
					repPerEthPrice={repPerEthPrice}
					repPerEthSource={repPerEthSource}
					repPerEthSourceUrl={repPerEthSourceUrl}
					securityBondAllowance={securityBondAllowance}
					securityVaultDetails={securityVaultDetails}
					securityVaultRepApproval={securityVaultRepApproval}
					selectedPoolSecurityMultiplier={selectedPoolSecurityMultiplier}
					selectedVaultIsOwnedByAccount={selectedVaultIsOwnedByAccount}
				/>
			) : undefined}

			{latestAction}

			<SectionBlock title='Claim Fees'>
				{securityVaultDetails === undefined ? (
					<p className='detail'>Refresh the vault to inspect claimable fees.</p>
				) : (
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label='Claimable Fees'>
							<CurrencyValue value={securityVaultDetails.unpaidEthFees} suffix='ETH' />
						</MetricField>
					</div>
				)}
				<div className='actions'>
					<TransactionActionButton idleLabel='Claim Fees' pendingLabel='Claiming fees...' onClick={onRedeemFees} pending={securityVaultActiveAction === 'redeemFees'} availability={{ disabled: !canClaimFees, reason: claimFeesGuardMessage }} />
				</div>
			</SectionBlock>

			<SectionBlock title='Deposit REP'>
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
					<TransactionActionButton idleLabel='Create / Deposit REP' pendingLabel='Depositing REP...' onClick={onDepositRep} pending={securityVaultActiveAction === 'depositRep'} availability={{ disabled: depositGuardMessage !== undefined, reason: depositGuardMessage }} />
				</div>
				{repBalanceGap !== undefined && repBalanceGap > 0n ? (
					<ErrorNotice message={`Insufficient REP balance. Deposit amount exceeds your wallet balance by ${formatCurrencyBalance(repBalanceGap)} REP.`} />
				) : isDepositBelowMinimum ? (
					<p className='detail'>
						New vaults require at least <CurrencyValue value={MIN_SECURITY_VAULT_REP_DEPOSIT} suffix='REP' copyable={false} /> in the first deposit.
					</p>
				) : undefined}
			</SectionBlock>

			<SectionBlock title='Set Security Bond Allowance'>
				{securityVaultDetails === undefined ? (
					<p className='detail'>Refresh the vault before setting a security bond allowance.</p>
				) : (
					<>
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
							<TransactionActionButton
								idleLabel='Set Security Bond Allowance'
								pendingLabel='Queueing allowance update...'
								onClick={onSetSecurityBondAllowance}
								pending={securityVaultActiveAction === 'queueSetSecurityBondAllowance'}
								tone='secondary'
								availability={{ disabled: !canSetSecurityBondAllowance, reason: setSecurityBondAllowanceGuardMessage }}
							/>
						</div>
					</>
				)}
			</SectionBlock>

			<SectionBlock title='Withdraw REP'>
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
					<TransactionActionButton idleLabel='Withdraw REP' pendingLabel='Queueing REP withdrawal...' onClick={onWithdrawRep} pending={securityVaultActiveAction === 'queueWithdrawRep'} tone='secondary' availability={{ disabled: !canWithdrawRep, reason: withdrawRepGuardMessage }} />
				</div>
			</SectionBlock>

			<ErrorNotice message={securityVaultError} />
		</>
	)

	if (compactLayout) {
		return sections
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

			<div className='workflow-stack route-workflow-stack'>{sections}</div>
		</section>
	)
}
