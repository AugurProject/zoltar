import { formatAddress } from '../lib/formatters.js'
import { isMainnetChain } from '../lib/network.js'
import type { SecurityVaultSectionProps } from '../types/components.js'

export function SecurityVaultSection({ accountState, loadingSecurityVault, onApproveRep, onDepositRep, onLoadSecurityVault, onRedeemFees, onRedeemRep, onSecurityVaultFormChange, onUpdateVaultFees, securityVaultDetails, securityVaultError, securityVaultForm, securityVaultResult }: SecurityVaultSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	return (
		<section className="panel market-panel">
			<div className="market-header">
				<div>
					<p className="panel-label">Security Vault</p>
					<h2>Create and operate a security vault</h2>
					<p className="detail">A vault is your position inside a security pool. Deposit REP to create one, then manage fees and redemptions from the connected wallet.</p>
				</div>
			</div>

			<div className="market-grid">
				<div className="market-column">
					{securityVaultDetails === undefined ? undefined : (
						<div className="status-card">
							<p className="panel-label">Vault Details</p>
							<ul className="status-list hashes">
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
									<span>Universe</span>
									<strong>{securityVaultDetails.universeId.toString()}</strong>
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

					{securityVaultResult === undefined ? undefined : (
						<div className="status-card">
							<p className="panel-label">Latest Vault Action</p>
							<p className="detail">Action: {securityVaultResult.action}</p>
							<p className="detail">Transaction: {securityVaultResult.hash}</p>
						</div>
					)}
				</div>

				<div className="market-column">
					<div className="form-grid">
						<label className="field">
							<span>Security Pool Address</span>
							<input value={securityVaultForm.securityPoolAddress} onInput={event => onSecurityVaultFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder="0x..." />
						</label>

						<p className="detail">Connected vault address: {accountState.address === undefined ? 'Connect wallet' : formatAddress(accountState.address)}</p>

						<div className="actions">
							<button className="secondary" onClick={onLoadSecurityVault} disabled={loadingSecurityVault}>
								{loadingSecurityVault ? 'Loading Vault...' : 'Load Vault'}
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
								Deposit REP
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
