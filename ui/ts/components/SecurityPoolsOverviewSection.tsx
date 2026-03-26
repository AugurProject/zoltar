import type { SecurityPoolsOverviewSectionProps } from '../types/components.js'

export function SecurityPoolsOverviewSection({ accountState, liquidationAmount, liquidationTargetVault, loadingSecurityPools, onLiquidationAmountChange, onLiquidationTargetVaultChange, onLoadSecurityPools, onQueueLiquidation, securityPoolOverviewError, securityPoolOverviewResult, securityPools }: SecurityPoolsOverviewSectionProps) {
	return (
		<section class="panel market-panel">
			<div class="market-header">
				<div>
					<p class="panel-label">Security Pools</p>
					<h2>Review all deployed security pools</h2>
					<p class="detail">This tab reads the factory deployment registry, shows the pools currently known on-chain, and lets you queue liquidation against a target vault for any listed pool.</p>
				</div>
			</div>

			<div class="form-grid">
				<div class="actions">
					<button class="secondary" onClick={onLoadSecurityPools} disabled={loadingSecurityPools}>
						{loadingSecurityPools ? 'Loading Pools...' : 'Load All Security Pools'}
					</button>
				</div>

				<div class="field-row">
					<label class="field">
						<span>Target Vault</span>
						<input value={liquidationTargetVault} onInput={event => onLiquidationTargetVaultChange(event.currentTarget.value)} placeholder="0x..." />
					</label>
					<label class="field">
						<span>Liquidation Amount</span>
						<input value={liquidationAmount} onInput={event => onLiquidationAmountChange(event.currentTarget.value)} />
					</label>
				</div>

				{securityPoolOverviewResult === undefined ? undefined : (
					<p class="notice success">
						Queued liquidation for {securityPoolOverviewResult.securityPoolAddress}: {securityPoolOverviewResult.hash}
					</p>
				)}
				{securityPoolOverviewError === undefined ? undefined : <p class="notice error">{securityPoolOverviewError}</p>}

				<div class="contract-list">
					{securityPools.map(pool => (
						<div class="contract-row" key={pool.securityPoolAddress}>
							<div class="contract-copy">
								<div class="contract-topline">
									<span class="badge ok">Deployed</span>
									<h3>{pool.securityPoolAddress}</h3>
								</div>
								<p class="detail">Question ID: {pool.questionId}</p>
								<p class="detail">Universe: {pool.universeId.toString()}</p>
								<p class="detail">Manager: {pool.managerAddress}</p>
								<p class="detail">System state: {pool.systemState}</p>
								<p class="detail">Truth auction: {pool.truthAuctionAddress}</p>
								<p class="detail">Truth auction started: {pool.truthAuctionStartedAt === 0n ? 'Not started' : pool.truthAuctionStartedAt.toString()}</p>
								<p class="detail">Fork mode: {pool.forkOwnSecurityPool ? 'Own escalation fork' : 'Parent/Zoltar fork'}</p>
								<p class="detail">Fork outcome: {pool.forkOutcome}</p>
								<p class="detail">Migrated REP: {pool.migratedRep.toString()}</p>
								<p class="detail">Security multiplier: {pool.securityMultiplier.toString()}</p>
								<p class="detail">Retention rate: {pool.currentRetentionRate.toString()}</p>
							</div>
							<button onClick={() => onQueueLiquidation(pool.managerAddress, pool.securityPoolAddress)} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Queue Liquidation
							</button>
						</div>
					))}
				</div>
			</div>
		</section>
	)
}
