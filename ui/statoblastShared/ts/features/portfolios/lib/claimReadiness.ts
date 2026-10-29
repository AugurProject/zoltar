import type { usePortfolio } from '../hooks/usePortfolio.js'
import * as copy from '../../../copy/portfolioReporting.js'

export type PortfolioClaimModel = Pick<ReturnType<typeof usePortfolio>, 'snapshot' | 'setup' | 'loading' | 'discovering' | 'error' | 'managerInput'>

export function getPortfolioClaimReadiness(model: PortfolioClaimModel) {
	const loading = model.loading || model.discovering
	let reason: string | undefined
	if (loading) reason = copy.portfolioLoading
	else if (model.error !== undefined) reason = model.error
	else if (model.snapshot === undefined) {
		if (model.managerInput.trim() === '') reason = copy.selectPortfolio
		else if (model.setup !== undefined && model.setup.stage < 4) reason = copy.portfolioSetup
		else reason = copy.portfolioUnavailable
	}
	return { loading, reason }
}
