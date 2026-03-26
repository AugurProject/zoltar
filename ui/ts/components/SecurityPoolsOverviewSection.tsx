import { isMainnetChain } from '../lib/network.js'
import type { SecurityPoolsOverviewSectionProps } from '../types/components.js'

export function SecurityPoolsOverviewSection({ accountState, liquidationAmount, liquidationTargetVault, loadingSecurityPools, onLiquidationAmountChange, onLiquidationTargetVaultChange, onLoadSecurityPools, onQueueLiquidation, securityPoolOverviewError, securityPoolOverviewResult, securityPools }: SecurityPoolsOverviewSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	return (
		<section className="panel market-panel">
			<div className="market-header">
				<div>
					<p className="panel-label">Security Pools</p>
					<h2>Review all deployed security pools</h2>
					<p className="detail">This tab reads the factory deployment registry, shows the pools currently known on-chain, and lets you queue liquidation against a target vault for any listed pool.</p>
				</div>
			</div>

			<div className="form-grid">
				<div className="actions">
					<button className="secondary" onClick={onLoadSecurityPools} disabled={loadingSecurityPools}>
						{loadingSecurityPools ? 'Loading Pools...' : 'Load All Security Pools'}
					</button>
				</div>

				<div className="field-row">
					<label className="field">
						<span>Target Vault</span>
						<input value={liquidationTargetVault} onInput={event => onLiquidationTargetVaultChange(event.currentTarget.value)} placeholder="0x..." />
					</label>
					<label className="field">
						<span>Liquidation Amount</span>
						<input value={liquidationAmount} onInput={event => onLiquidationAmountChange(event.currentTarget.value)} />
					</label>
				</div>

				{securityPoolOverviewResult === undefined ? undefined : (
					<p className="notice success">
						Queued liquidation for {securityPoolOverviewResult.securityPoolAddress}: {securityPoolOverviewResult.hash}
					</p>
				)}
				{securityPoolOverviewError === undefined ? undefined : <p className="notice error">{securityPoolOverviewError}</p>}

				<div className="contract-list">
					{securityPools.map(pool => (
						<div className="contract-row" key={pool.securityPoolAddress}>
							<div className="contract-copy">
								<div className="contract-topline">
									<span className="badge ok">Deployed</span>
									<h3>{pool.securityPoolAddress}</h3>
								</div>
								<p className="detail">Question ID: {pool.questionId}</p>
								<p className="detail">Universe: {pool.universeId.toString()}</p>
								<p className="detail">Manager: {pool.managerAddress}</p>
								<p className="detail">System state: {pool.systemState}</p>
								<p className="detail">Truth auction: {pool.truthAuctionAddress}</p>
								<p className="detail">Truth auction started: {pool.truthAuctionStartedAt === 0n ? 'Not started' : pool.truthAuctionStartedAt.toString()}</p>
								<p className="detail">Fork mode: {pool.forkOwnSecurityPool ? 'Own escalation fork' : 'Parent/Zoltar fork'}</p>
								<p className="detail">Fork outcome: {pool.forkOutcome}</p>
								<p className="detail">Migrated REP: {pool.migratedRep.toString()}</p>
								<p className="detail">Security multiplier: {pool.securityMultiplier.toString()}</p>
								<p className="detail">Retention rate: {pool.currentRetentionRate.toString()}</p>
							</div>
							<button onClick={() => onQueueLiquidation(pool.managerAddress, pool.securityPoolAddress)} disabled={accountState.address === undefined || !isMainnet}>
								Queue Liquidation
							</button>
						</div>
					))}
				</div>
			</div>
		</section>
	)
}
