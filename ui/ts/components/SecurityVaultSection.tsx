import { formatAddress } from '../lib/formatters.js'
import type { SecurityVaultSectionProps } from '../types/components.js'

export function SecurityVaultSection({ accountState, loadingSecurityVault, onApproveRep, onDepositRep, onLoadSecurityVault, onRedeemFees, onRedeemRep, onSecurityVaultFormChange, onUpdateVaultFees, securityVaultDetails, securityVaultError, securityVaultForm, securityVaultResult }: SecurityVaultSectionProps) {
	return (
		<section class="panel market-panel">
			<div class="market-header">
				<div>
					<p class="panel-label">Security Vault</p>
					<h2>Create and operate a security vault</h2>
					<p class="detail">A vault is your position inside a security pool. Deposit REP to create one, then manage fees and redemptions from the connected wallet.</p>
				</div>
			</div>

			<div class="market-grid">
				<div class="market-column">
					{securityVaultDetails === undefined ? null : (
						<div class="status-card">
							<p class="panel-label">Vault Details</p>
							<ul class="status-list hashes">
								<li>
									<span>Security Pool</span>
									<strong>{securityVaultDetails.securityPoolAddress}</strong>
								</li>
								<li>
									<span>Vault</span>
									<strong>{securityVaultDetails.vaultAddress}</strong>
								</li>
								<li>
									<span>REP Token</span>
									<strong>{securityVaultDetails.repToken}</strong>
								</li>
								<li>
									<span>REP Deposit Share</span>
									<strong>{securityVaultDetails.repDepositShare.toString()}</strong>
								</li>
								<li>
									<span>Security Bond Allowance</span>
									<strong>{securityVaultDetails.securityBondAllowance.toString()}</strong>
								</li>
								<li>
									<span>Unpaid ETH Fees</span>
									<strong>{securityVaultDetails.unpaidEthFees.toString()}</strong>
								</li>
								<li>
									<span>Locked REP</span>
									<strong>{securityVaultDetails.lockedRepInEscalationGame.toString()}</strong>
								</li>
							</ul>
						</div>
					)}

					{securityVaultResult === undefined ? null : (
						<div class="status-card">
							<p class="panel-label">Latest Vault Action</p>
							<p class="detail">Action: {securityVaultResult.action}</p>
							<p class="detail">Transaction: {securityVaultResult.hash}</p>
						</div>
					)}
				</div>

				<div class="market-column">
					<div class="form-grid">
						<label class="field">
							<span>Security Pool Address</span>
							<input value={securityVaultForm.securityPoolAddress} onInput={event => onSecurityVaultFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder="0x..." />
						</label>

						<p class="detail">Connected vault address: {accountState.address === undefined ? 'Connect wallet' : formatAddress(accountState.address)}</p>

						<div class="actions">
							<button class="secondary" onClick={onLoadSecurityVault} disabled={loadingSecurityVault}>
								{loadingSecurityVault ? 'Loading Vault...' : 'Load Vault'}
							</button>
						</div>

						<label class="field">
							<span>REP Approval Amount</span>
							<input value={securityVaultForm.repApprovalAmount} onInput={event => onSecurityVaultFormChange({ repApprovalAmount: event.currentTarget.value })} />
						</label>

						<label class="field">
							<span>REP Deposit Amount</span>
							<input value={securityVaultForm.depositAmount} onInput={event => onSecurityVaultFormChange({ depositAmount: event.currentTarget.value })} />
						</label>

						<div class="actions">
							<button class="secondary" onClick={onApproveRep} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Approve REP
							</button>
							<button onClick={onDepositRep} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Deposit REP
							</button>
						</div>

						<div class="actions">
							<button class="secondary" onClick={onUpdateVaultFees} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Update Vault Fees
							</button>
							<button class="secondary" onClick={onRedeemFees} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Redeem Fees
							</button>
							<button class="secondary" onClick={onRedeemRep} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Redeem REP
							</button>
						</div>
					</div>

					{securityVaultError === undefined ? null : <p class="notice error">{securityVaultError}</p>}
				</div>
			</div>
		</section>
	)
}
