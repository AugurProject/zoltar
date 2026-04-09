import { useEffect, useRef } from 'preact/hooks'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { LoadingText } from './LoadingText.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { formatCurrencyBalance } from '../lib/formatters.js'
import { isMainnetChain } from '../lib/network.js'
import { parseRepAmountInput } from '../lib/marketForm.js'
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
	}
	const hasWithdrawAmount = normalizedSecurityVaultForm.repWithdrawAmount.trim() !== '' && normalizedSecurityVaultForm.repWithdrawAmount.trim() !== '0'
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
	const approvalShortage = depositAmount === undefined || approvedRep === undefined ? undefined : depositAmount > approvedRep ? depositAmount - approvedRep : 0n
	const withdrawableRepAmount = securityVaultDetails === undefined ? undefined : securityVaultDetails.repDepositShare > securityVaultDetails.lockedRepInEscalationGame ? securityVaultDetails.repDepositShare - securityVaultDetails.lockedRepInEscalationGame : 0n
	const hasClaimableFees = securityVaultDetails !== undefined && securityVaultDetails.unpaidEthFees > 0n
	const canClaimFees = accountState.address !== undefined && isMainnet && hasClaimableFees
	const hasSufficientDepositAllowance = approvedRep !== undefined && depositAmount !== undefined && depositAmount > 0n && approvedRep >= depositAmount
	const canApproveRep = accountState.address !== undefined && isMainnet && securityVaultDetails !== undefined && depositAmount !== undefined && depositAmount > 0n && approvalShortage !== undefined && approvalShortage > 0n
	const canSetSecurityBondAllowance = accountState.address !== undefined && isMainnet && securityVaultDetails !== undefined && securityBondAllowanceAmount !== undefined && securityBondAllowanceAmount > 0n
	const approveButtonLabel = depositAmount === undefined ? 'Approve REP' : approvalShortage === 0n ? 'Approval Satisfied' : `Approve ${formatCurrencyBalance(approvalShortage)} REP`
	const approveButtonTitle = (() => {
		if (accountState.address === undefined) return 'Connect a wallet before approving REP.'
		if (!isMainnet) return 'Switch your wallet to Ethereum mainnet.'
		if (securityVaultDetails === undefined) return 'Load the vault to calculate the required approval amount.'
		if (depositAmount === undefined || depositAmount <= 0n) return 'Enter a deposit amount greater than zero.'
		if (approvalShortage === 0n) return 'No additional REP approval is needed for this deposit amount.'
		return `Approve ${formatCurrencyBalance(approvalShortage)} more REP before depositing.`
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
	const autoLoadKey = `${accountState.address ?? ''}:${normalizedSecurityVaultForm.securityPoolAddress}`
	const hasLoadedCurrentVault = securityVaultDetails !== undefined && securityVaultDetails.vaultAddress.toLowerCase() === accountState.address?.toLowerCase() && securityVaultDetails.securityPoolAddress.toLowerCase() === normalizedSecurityVaultForm.securityPoolAddress.toLowerCase()
	const lastAutoLoadKey = useRef<string | undefined>(undefined)

	useEffect(() => {
		if (!autoLoadVault) return
		if (showSecurityPoolAddressInput) return
		if (accountState.address === undefined) return
		if (normalizedSecurityVaultForm.securityPoolAddress.trim() === '') return
		if (hasLoadedCurrentVault || loadingSecurityVault) return
		if (lastAutoLoadKey.current === autoLoadKey) return
		lastAutoLoadKey.current = autoLoadKey
		void onLoadSecurityVault()
	}, [accountState.address, autoLoadKey, autoLoadVault, hasLoadedCurrentVault, loadingSecurityVault, normalizedSecurityVaultForm.securityPoolAddress, onLoadSecurityVault, showSecurityPoolAddressInput])

	const vaultDetails =
		securityVaultDetails === undefined ? undefined : (
			<div className='entity-card-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Vault Details</h4>
				</div>
				<div className='entity-metric-grid'>
					<div className='entity-metric'>
						<span className='metric-label'>REP Deposit Share</span>
						<strong>
							<CurrencyValue value={securityVaultDetails.repDepositShare} suffix='REP' />
						</strong>
					</div>
					<div className='entity-metric'>
						<span className='metric-label'>Approved REP</span>
						<strong>{approvedRep === undefined ? <LoadingText>Loading...</LoadingText> : <CurrencyValue value={approvedRep} suffix='REP' />}</strong>
					</div>
					<div className='entity-metric'>
						<span className='metric-label'>Security Bond Allowance</span>
						<strong>
							<CurrencyValue value={securityBondAllowance} suffix='REP' />
						</strong>
					</div>
					<div className='entity-metric'>
						<span className='metric-label'>Unpaid ETH Fees</span>
						<strong>
							<CurrencyValue value={securityVaultDetails.unpaidEthFees} suffix='ETH' />
						</strong>
					</div>
					<div className='entity-metric'>
						<span className='metric-label'>Locked REP</span>
						<strong>
							<CurrencyValue value={securityVaultDetails.lockedRepInEscalationGame} suffix='REP' />
						</strong>
					</div>
					<div className='entity-metric'>
						<span className='metric-label'>Total Security Bond Allowance</span>
						<strong>
							<CurrencyValue value={securityVaultDetails.totalSecurityBondAllowance} suffix='ETH' />
						</strong>
					</div>
				</div>
				<div className='actions'>
					<button className='primary' onClick={onRedeemFees} disabled={!canClaimFees}>
						Claim Fees
					</button>
				</div>
			</div>
		)

	const securityBondAllowanceSection =
		securityVaultDetails === undefined ? undefined : (
			<div className='entity-card-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Set Security Bond Allowance</h4>
				</div>
				<div className='entity-metric-grid'>
					<div className='entity-metric'>
						<span className='metric-label'>Current Security Bond Allowance</span>
						<strong>
							<CurrencyValue value={securityBondAllowance} suffix='REP' />
						</strong>
					</div>
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

	const vaultLoadSection = (
		<div className='entity-card-subsection'>
			<div className='entity-card-subsection-header'>
				<h4>Load Vault</h4>
			</div>
			{showSecurityPoolAddressInput ? (
				<label className='field'>
					<span>Security Pool Address</span>
					<input value={normalizedSecurityVaultForm.securityPoolAddress} onInput={event => onSecurityVaultFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder='0x...' />
				</label>
			) : (
				<p className='detail'>Uses the selected security pool address from the selected-pool view.</p>
			)}
			<div className='actions'>
				<button className='secondary' onClick={onLoadSecurityVault} disabled={loadingSecurityVault}>
					{loadingSecurityVault ? <LoadingText>Loading Vault...</LoadingText> : 'Load My Vault'}
				</button>
			</div>
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
			<p className='detail'>Available REP: {securityVaultRepBalance === undefined ? 'Load the vault to fetch your balance.' : <CurrencyValue value={securityVaultRepBalance} suffix='REP' copyable={false} />}</p>
			<div className='actions'>
				<button className='secondary' title={approveButtonTitle} onClick={() => onApproveRep(approvalShortage)} disabled={!canApproveRep}>
					{approveButtonLabel}
				</button>
				<button className='primary' onClick={onDepositRep} disabled={accountState.address === undefined || !isMainnet || !hasSufficientDepositAllowance}>
					Create / Deposit REP
				</button>
			</div>
			{depositAmount === undefined ? undefined : approvalShortage === undefined ? undefined : approvalShortage > 0n ? (
				<p className='detail'>Need {<CurrencyValue value={approvalShortage} suffix='REP' copyable={false} />} more REP approved before depositing.</p>
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
				<p className='detail'>Load the vault to calculate withdrawable REP.</p>
			) : (
				<div className='entity-metric-grid'>
					<div className='entity-metric'>
						<span className='metric-label'>Withdrawable REP</span>
						<strong>
							<CurrencyValue value={withdrawableRepAmount} suffix='REP' />
						</strong>
					</div>
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
				<button className='secondary' onClick={onWithdrawRep} disabled={accountState.address === undefined || !isMainnet || !hasWithdrawAmount || withdrawableRepAmount === 0n}>
					Withdraw REP
				</button>
			</div>
		</div>
	)

	if (compactLayout) {
		return (
			<>
				{vaultDetails}
				{latestAction}
				{vaultLoadSection}
				{vaultDepositSection}
				{securityBondAllowanceSection}
				{vaultRepSection}
				{securityVaultError === undefined ? undefined : <p className='notice error'>{securityVaultError}</p>}
			</>
		)
	}

	return (
		<section className='panel market-panel'>
			{showHeader ? (
				<div className='market-header'>
					<div>
						<h2>Security Vault</h2>
						<p className='detail'>Deposit REP to create your own vault, then manage fees and redemptions from the connected wallet.</p>
					</div>
				</div>
			) : undefined}

			<div className='market-grid'>
				<div className='market-column'>
					{securityVaultDetails === undefined ? undefined : (
						<EntityCard title='Vault Details'>
							<div className='entity-metric-grid'>
								<div className='entity-metric'>
									<span className='metric-label'>REP Deposit Share</span>
									<strong>
										<CurrencyValue value={securityVaultDetails.repDepositShare} suffix='REP' />
									</strong>
								</div>
								<div className='entity-metric'>
									<span className='metric-label'>Approved REP</span>
									<strong>{approvedRep === undefined ? <LoadingText>Loading...</LoadingText> : <CurrencyValue value={approvedRep} suffix='REP' />}</strong>
								</div>
								<div className='entity-metric'>
									<span className='metric-label'>Security Bond Allowance</span>
									<strong>
										<CurrencyValue value={securityBondAllowance} suffix='REP' />
									</strong>
								</div>
								<div className='entity-metric'>
									<span className='metric-label'>Unpaid ETH Fees</span>
									<strong>
										<CurrencyValue value={securityVaultDetails.unpaidEthFees} suffix='ETH' />
									</strong>
								</div>
								<div className='entity-metric'>
									<span className='metric-label'>Locked REP</span>
									<strong>
										<CurrencyValue value={securityVaultDetails.lockedRepInEscalationGame} suffix='REP' />
									</strong>
								</div>
								<div className='entity-metric'>
									<span className='metric-label'>Total Security Bond Allowance</span>
									<strong>
										<CurrencyValue value={securityVaultDetails.totalSecurityBondAllowance} suffix='ETH' />
									</strong>
								</div>
							</div>
							<div className='actions'>
								<button className='primary' onClick={onRedeemFees} disabled={!canClaimFees}>
									Claim Fees
								</button>
							</div>
						</EntityCard>
					)}

					{securityVaultResult === undefined ? undefined : (
						<EntityCard title='Latest Vault Action'>
							<div className='entity-metric-grid'>
								<div className='entity-metric'>
									<span className='metric-label'>Action</span>
									<strong>{securityVaultResult.action}</strong>
								</div>
								<div className='entity-metric'>
									<span className='metric-label'>Transaction</span>
									<strong>
										<TransactionHashLink hash={securityVaultResult.hash} />
									</strong>
								</div>
							</div>
						</EntityCard>
					)}
				</div>

				<div className='market-column'>
					<EntityCard title='Vault Actions'>
						{vaultLoadSection}
						{vaultDepositSection}
						{securityBondAllowanceSection}
						{vaultRepSection}
					</EntityCard>

					{securityVaultError === undefined ? undefined : <p className='notice error'>{securityVaultError}</p>}
				</div>
			</div>
		</section>
	)
}
