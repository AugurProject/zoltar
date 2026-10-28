import { render } from 'preact'
import type { PortfolioView } from './portfolio-response.ts'
import { formatAmount } from '@zoltar/bot-shared/dashboard/amount'

export function renderPortfolios(portfolios: readonly PortfolioView[] | undefined, stale = false) {
	const target = document.getElementById('portfolio-monitor')
	if (target === null) return
	render(
		<>
			<p class='muted'>
				Select portfolio addresses and universes in <code>selectedPortfolios</code> in the operator file, then restart while paused. Approve each universe separately in Settings. Funded takeovers require the separate <code>portfolioPolicy</code> opt-in. Previously managed portfolios remain visible for exposure
				accounting.
			</p>
			<details class='portfolio-guidance'>
				<summary>Monitoring limits</summary>
				<p class='muted'>Each page is a fresh observation. Unchanged retirement warnings require repeated observations; the monitor retains the latest 256 retiring positions per scope.</p>
			</details>
			{stale && <p class='notice warning'>Connection lost. These portfolio observations are stale.</p>}
			{portfolios === undefined || portfolios.length === 0 ? (
				<p class='empty'>No managed portfolio observations yet. A selected portfolio appears after a successful scan.</p>
			) : (
				portfolios.map(portfolio => (
					<article class='panel portfolio-card' key={`${portfolio.address}:${portfolio.universeId}`}>
						<h3>Portfolio · universe {portfolio.universeId}</h3>
						<p class='portfolio-address'>{portfolio.address}</p>
						<p class='muted'>
							Block {portfolio.blockNumber} · {portfolio.selected ? 'Selected' : 'Exposure monitoring only'} · {portfolio.approvedUniverse ? 'Universe approved' : 'Universe not approved'} · {portfolio.priceValid ? 'Price current' : 'Price expired'} · Automation {portfolio.automation ? 'enabled' : 'disabled'}
						</p>
						<p>
							Owner principal {formatAmount(portfolio.principalRep, 'REP')} · commitment {formatAmount(portfolio.commitmentEth, 'ETH')}. Managed principal {formatAmount(portfolio.managedPrincipalRep, 'REP')} / {formatAmount(portfolio.maximumTotalPrincipalRep, 'REP')} limit.
						</p>
						<p class='muted'>
							Current page from {portfolio.knownPositionCount} registered positions; next cursor {portfolio.nextPositionId}.
						</p>
						{portfolio.positions.length === 0 ? (
							<p class='empty'>No live commitments in this page.</p>
						) : (
							<ul class='portfolio-positions'>
								{portfolio.positions.map(position => (
									<li key={position.id}>
										<strong>
											Position {position.id} · {position.distressed ? 'Distressed' : 'Healthy'} · {formatAmount(position.commitmentEth, 'ETH')}
										</strong>
										<p>
											Execution reserve {formatAmount(position.reserveEth, 'ETH')} / {formatAmount(position.requiredReserveEth, 'ETH')} required · {position.reserveAdequate ? 'Adequate' : 'Underfunded'}
										</p>
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
