import { render } from 'preact'
import type { SecurityPoolView } from './security-pool-response.ts'
import { formatAmount } from '@zoltar/bot-shared/dashboard/amount'

export function renderSecurityPools(securityPools: readonly SecurityPoolView[] | undefined, stale = false) {
	const target = document.getElementById('security-pool-monitor')
	if (target === null) return
	render(
		<>
			<p class='muted'>
				Select security pool addresses and universes on the Security pools page. Approve each universe separately in Settings. Enable funded takeovers and set exposure limits under Security pool policy in Settings. Previously managed security pools remain visible for exposure accounting. Total principal limits include
				direct ledger capital, owned auction vaults and reserved exposure for pending bids.
			</p>
			<details class='security-pool-guidance'>
				<summary>Monitoring limits</summary>
				<p class='muted'>
					Each scan reads one bounded page of positions and one bounded page of unmaterialized auction winners. Winning bids already back claims before their individual positions are recorded. Unchanged retirement warnings require repeated observations; the monitor retains the latest 256 retiring positions per scope.
				</p>
			</details>
			{stale && <p class='notice warning'>Connection lost. These security pool observations are stale.</p>}
			{securityPools === undefined || securityPools.length === 0 ? (
				<p class='empty'>No managed security pool observations yet. A selected security pool appears after a successful scan.</p>
			) : (
				securityPools.map(securityPool => (
					<article class='panel security-pool-card' key={`${securityPool.address}:${securityPool.universeId}`}>
						<h3>SecurityPool · universe {securityPool.universeId}</h3>
						<p class='security-pool-address'>{securityPool.address}</p>
						<p class='muted'>
							Block {securityPool.blockNumber} · {securityPool.selected ? 'Selected' : 'Exposure monitoring only'} · {securityPool.approvedUniverse ? 'Universe approved' : 'Universe not approved'} · {securityPool.priceValid ? 'Price current' : 'Price expired'} · Automation{' '}
							{securityPool.automation ? 'enabled' : 'disabled'}
						</p>
						<p>
							Owner principal {formatAmount(securityPool.principalRep, 'REP')} · commitment {formatAmount(securityPool.commitmentEth, 'ETH')}. Managed principal {formatAmount(securityPool.managedPrincipalRep, 'REP')} / {formatAmount(securityPool.maximumTotalPrincipalRep, 'REP')} limit.
						</p>
						<p class='muted'>
							Current page from {securityPool.knownPositionCount} registered positions; next cursor {securityPool.nextPositionId}. Auction bids {securityPool.knownAuctionBidCount}; winner scan after bid {securityPool.auctionAfterBidId}.
						</p>
						{securityPool.positions.length === 0 ? (
							<p class='empty'>No live commitments in this page.</p>
						) : (
							<ul class='security-pool-positions'>
								{securityPool.positions.map(position => (
									<li key={position.id}>
										<strong>
											{position.label} · {position.distressed ? 'Distressed' : 'Healthy'} · {formatAmount(position.commitmentEth, 'ETH')}
										</strong>

										<p>
											{position.stalledRetirement ? 'Retirement stalled: ' : 'Retirement: '}
											{position.retirementStatus}
										</p>
										<p>{position.takeoverStatus}</p>
									</li>
								))}
							</ul>
						)}
					</article>
				))
			)}
		</>,
		target,
	)
}
