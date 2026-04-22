import { useEffect, useRef } from 'preact/hooks'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { normalizeAddress, sameAddress } from '../lib/address.js'
import { approvalShortage } from '../lib/inputs.js'
import { formatCurrencyBalance } from '../lib/formatters.js'
import { isMainnetChain } from '../lib/network.js'
import { parseRepAmountInput } from '../lib/marketForm.js'
import { canManageSelectedVault, getSelectedVaultAddress } from '../lib/securityVault.js'
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
	onWithdrawRep,
	securityVaultDetails,
	securityVaultError,
	securityVaultForm,
	securityVaultMissing,
	securityVaultRepAllowance,
	securityVaultRepBalance,
	securityVaultResult,
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
	const selectedVaultIsOwnedByAccount = canManageSelectedVault(selectedVaultAddress, accountState.address)
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
	const approvedRep = securityVaultRepAllowance
	const shortage = approvalShortage(depositAmount, approvedRep)
	const withdrawableRepAmount = securityVaultDetails === undefined ? undefined : securityVaultDetails.repDepositShare > securityVaultDetails.lockedRepInEscalationGame ? securityVaultDetails.repDepositShare - securityVaultDetails.lockedRepInEscalationGame : 0n
	const hasClaimableFees = securityVaultDetails !== undefined && securityVaultDetails.unpaidEthFees > 0n
	const canClaimFees = selectedVaultIsOwnedByAccount && isMainnet && hasClaimableFees
	const hasSufficientDepositAllowance = selectedVaultIsOwnedByAccount && approvedRep !== undefined && depositAmount !== undefined && depositAmount > 0n && approvedRep >= depositAmount
	const canApproveRep = selectedVaultIsOwnedByAccount && isMainnet && securityVaultDetails !== undefined && depositAmount !== undefined && depositAmount > 0n && shortage !== undefined && shortage > 0n
	const canSetSecurityBondAllowance = selectedVaultIsOwnedByAccount && isMainnet && securityVaultDetails !== undefined && securityBondAllowanceAmount !== undefined && securityBondAllowanceAmount > 0n
	const approveButtonLabel = depositAmount === undefined || depositAmount <= 0n || shortage === undefined ? 'Approve REP' : shortage === 0n ? 'Approval Satisfied' : `Approve ${formatCurrencyBalance(shortage)} REP`
	const approveButtonTitle = (() => {
		if (accountState.address === undefined) return 'Connect a wallet before approving REP.'
		if (!isMainnet) return 'Switch your wallet to Ethereum mainnet.'
		if (!selectedVaultIsOwnedByAccount) return 'Select your own vault to approve REP.'
		if (securityVaultMissing) return 'Load an existing security pool before approving REP.'
		if (securityVaultDetails === undefined) return 'Load the vault to calculate the required approval amount.'
		if (depositAmount === undefined || depositAmount <= 0n) return 'Enter a deposit amount greater than zero.'
		if (shortage === 0n) return 'No additional REP approval is needed for this deposit amount.'
		return `Approve ${formatCurrencyBalance(shortage)} more REP before depositing.`
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
		<p className='notice error'>Security pool does not exist.</p>
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
					<MetricField className='entity-metric' label='REP Deposit Share'>
						<CurrencyValue value={securityVaultDetails.repDepositShare} suffix='REP' />
					</MetricField>
					<MetricField className='entity-metric' label='Approved REP'>
						{approvedRep === undefined ? <LoadingText>Loading...</LoadingText> : <CurrencyValue value={approvedRep} suffix='REP' />}
					</MetricField>
					<MetricField className='entity-metric' label='Security Bond Allowance'>
						<CurrencyValue value={securityBondAllowance} suffix='REP' />
					</MetricField>
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
			{selectedVaultIsOwnedByAccount ? undefined : <p className='detail'>Read-only vault. Refresh is available, but write actions are hidden.</p>}
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
						<CurrencyValue value={securityBondAllowance} suffix='REP' />
					</MetricField>
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
			</div>
		)

	const latestAction =
		securityVaultResult === undefined ? undefined : (
			<div className='entity-card-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Latest Vault Action</h4>
				</div>
				<p className='detail'>Action: {latestActionLabel}</p>
				<p className='detail'>
					Transaction: <TransactionHashLink hash={securityVaultResult.hash} />
				</p>
			</div>
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
							const repAmount = securityVaultRepBalance.toString()
							onSecurityVaultFormChange({ depositAmount: repAmount })
						}}
						disabled={securityVaultRepBalance === undefined}
					>
						Max
					</button>
				</div>
			</label>
			<p className='detail'>
				Available REP:{' '}
				{securityVaultMissing ? (
					'Unavailable because the security pool does not exist.'
				) : securityVaultRepBalance === undefined ? (
					selectedVaultIsOwnedByAccount ? (
						'Refresh the vault to fetch your balance.'
					) : (
						'Unavailable for read-only vaults.'
					)
				) : (
					<CurrencyValue value={securityVaultRepBalance} suffix='REP' copyable={false} />
				)}
			</p>
			<div className='actions'>
				<button className='secondary' title={approveButtonTitle} onClick={() => onApproveRep(shortage)} disabled={!canApproveRep}>
					{approveButtonLabel}
				</button>
				<button className='primary' onClick={onDepositRep} disabled={!selectedVaultIsOwnedByAccount || accountState.address === undefined || !isMainnet || !hasSufficientDepositAllowance}>
					Create / Deposit REP
				</button>
			</div>
			{depositAmount === undefined ? undefined : shortage === undefined ? undefined : shortage > 0n ? (
				<p className='detail'>Need {<CurrencyValue value={shortage} suffix='REP' copyable={false} />} more REP approved before depositing.</p>
			) : (
				<p className='detail'>No additional REP approval is needed for this deposit amount.</p>
			)}
		</div>
	)

	const vaultRepSection = (
		<div className='entity-card-subsection'>
			<div className='entity-card-subsection-header'>
				<h4>Withdraw REP</h4>
			</div>
			{withdrawableRepAmount === undefined ? (
				<p className='detail'>Refresh the vault to calculate withdrawable REP.</p>
			) : (
				<div className='entity-metric-grid'>
					<MetricField className='entity-metric' label='Withdrawable REP'>
						<CurrencyValue value={withdrawableRepAmount} suffix='REP' />
					</MetricField>
				</div>
			)}
			<p className='detail'>Withdrawals are queued through the oracle manager.</p>
			<label className='field'>
				<span>REP Withdraw Amount</span>
				<div className='field-inline'>
					<input className='field-inline-input' value={normalizedSecurityVaultForm.repWithdrawAmount} onInput={event => onSecurityVaultFormChange({ repWithdrawAmount: event.currentTarget.value })} />
					<button
						className='quiet field-inline-action'
						type='button'
						onClick={() => {
							if (withdrawableRepAmount === undefined) return
							onSecurityVaultFormChange({ repWithdrawAmount: withdrawableRepAmount.toString() })
						}}
						disabled={withdrawableRepAmount === undefined}
					>
						Max
					</button>
				</div>
			</label>
			<div className='actions'>
				<button className='secondary' onClick={onWithdrawRep} disabled={!selectedVaultIsOwnedByAccount || accountState.address === undefined || !isMainnet || !hasWithdrawAmount || withdrawableRepAmount === 0n}>
					Withdraw REP
				</button>
			</div>
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
						<EntityCard title='Latest Vault Action'>
							<div className='entity-metric-grid'>
								<MetricField className='entity-metric' label='Action'>
									{securityVaultResult.action}
								</MetricField>
								<MetricField className='entity-metric' label='Transaction'>
									<TransactionHashLink hash={securityVaultResult.hash} />
								</MetricField>
							</div>
						</EntityCard>
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
