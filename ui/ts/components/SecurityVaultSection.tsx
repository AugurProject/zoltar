import { EntityCard } from './EntityCard.js'
import { formatAddress, formatCurrencyBalance } from '../lib/formatters.js'
import { isMainnetChain } from '../lib/network.js'
import type { SecurityVaultSectionProps } from '../types/components.js'

export function SecurityVaultSection({ accountState, loadingSecurityVault, onApproveRep, onDepositRep, onLoadSecurityVault, onRedeemFees, onRedeemRep, onSecurityVaultFormChange, onUpdateVaultFees, securityVaultDetails, securityVaultError, securityVaultForm, securityVaultResult, showHeader = true, showSecurityPoolAddressInput = true }: SecurityVaultSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	return (
		<section className="panel market-panel">
			{showHeader ? (
				<div className="market-header">
					<div>
						<h2>Security Vault</h2>
						<p className="detail">Deposit REP to create your own vault, then manage fees and redemptions from the connected wallet.</p>
					</div>
				</div>
			) : undefined}

			<div className="market-grid">
				<div className="market-column">
					{securityVaultDetails === undefined ? undefined : (
						<EntityCard title={formatAddress(securityVaultDetails.vaultAddress)} badge={<span className="badge ok">Your Vault</span>}>
							<div className="entity-metric-grid">
								<div className="entity-metric">
									<span className="metric-label">Security Pool</span>
									<strong>{formatAddress(securityVaultDetails.securityPoolAddress)}</strong>
								</div>
								<div className="entity-metric">
									<span className="metric-label">REP Token</span>
									<strong>{formatAddress(securityVaultDetails.repToken)}</strong>
								</div>
								<div className="entity-metric">
									<span className="metric-label">Universe</span>
									<strong>{securityVaultDetails.universeId.toString()}</strong>
								</div>
								<div className="entity-metric">
									<span className="metric-label">REP Deposit Share</span>
									<strong>{formatCurrencyBalance(securityVaultDetails.repDepositShare)}</strong>
								</div>
								<div className="entity-metric">
									<span className="metric-label">Security Bond Allowance</span>
									<strong>{formatCurrencyBalance(securityVaultDetails.securityBondAllowance)}</strong>
								</div>
								<div className="entity-metric">
									<span className="metric-label">Unpaid ETH Fees</span>
									<strong>{formatCurrencyBalance(securityVaultDetails.unpaidEthFees)}</strong>
								</div>
								<div className="entity-metric">
									<span className="metric-label">Locked REP</span>
									<strong>{formatCurrencyBalance(securityVaultDetails.lockedRepInEscalationGame)}</strong>
								</div>
								<div className="entity-metric">
									<span className="metric-label">Total Bond Allowance</span>
									<strong>{formatCurrencyBalance(securityVaultDetails.totalSecurityBondAllowance)}</strong>
								</div>
							</div>
						</EntityCard>
					)}

					{securityVaultResult === undefined ? undefined : (
						<EntityCard title="Latest Vault Action" badge={<span className="badge muted">{securityVaultResult.action}</span>}>
							<div className="entity-metric-grid">
								<div className="entity-metric">
									<span className="metric-label">Action</span>
									<strong>{securityVaultResult.action}</strong>
								</div>
								<div className="entity-metric">
									<span className="metric-label">Transaction</span>
									<strong>{securityVaultResult.hash}</strong>
								</div>
							</div>
						</EntityCard>
					)}
				</div>

				<div className="market-column">
					<div className="form-grid">
						{showSecurityPoolAddressInput ? (
							<label className="field">
								<span>Security Pool Address</span>
								<input value={securityVaultForm.securityPoolAddress} onInput={event => onSecurityVaultFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder="0x..." />
							</label>
						) : undefined}

						<div className="actions">
							<button className="secondary" onClick={onLoadSecurityVault} disabled={loadingSecurityVault}>
								{loadingSecurityVault ? 'Loading Vault...' : 'Load My Vault'}
							</button>
						</div>

						<label className="field">
							<span>REP Approval Amount</span>
							<input value={securityVaultForm.repApprovalAmount} onInput={event => onSecurityVaultFormChange({ repApprovalAmount: event.currentTarget.value })} />
						</label>

						<label className="field">
							<span>REP Deposit Amount</span>
							<input value={securityVaultForm.depositAmount} onInput={event => onSecurityVaultFormChange({ depositAmount: event.currentTarget.value })} />
						</label>

						<div className="actions">
							<button className="secondary" onClick={onApproveRep} disabled={accountState.address === undefined || !isMainnet}>
								Approve REP
							</button>
							<button onClick={onDepositRep} disabled={accountState.address === undefined || !isMainnet}>
								Create / Deposit REP
							</button>
						</div>

						<div className="actions">
							<button className="secondary" onClick={onUpdateVaultFees} disabled={accountState.address === undefined || !isMainnet}>
								Update Vault Fees
							</button>
							<button className="secondary" onClick={onRedeemFees} disabled={accountState.address === undefined || !isMainnet}>
								Redeem Fees
							</button>
							<button className="secondary" onClick={onRedeemRep} disabled={accountState.address === undefined || !isMainnet}>
								Redeem REP
							</button>
						</div>
					</div>

					{securityVaultError === undefined ? undefined : <p className="notice error">{securityVaultError}</p>}
				</div>
			</div>
		</section>
	)
}
