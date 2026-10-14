import { expect, test } from 'bun:test'
import { getAddress, zeroHash } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { PortfolioBalances } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfolioBalances.js'
import type { PortfolioSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'

const lifecycle = installDomTestLifecycle()
const owner = getAddress('0x0000000000000000000000000000000000000011')

async function renderBalances(pages: bigint, issues: string[] = []) {
	const snapshot: PortfolioSnapshot = {
		chainId: 1,
		blockNumber: 1n,
		blockHash: zeroHash,
		timestamp: 1n,
		portfolio: owner,
		vault: owner,
		owner,
		originUniverseId: 0n,
		questions: [1n],
		branches: [],
		allocatedQuestionPage: { start: 0n, count: 64n, total: pages * 64n },
		coverage: { complete: pages === 1n && issues.length === 0, registryComplete: false, issues, scope: 'registered-and-explicit-pools' },
	}
	lifecycle.trackRendered(
		await renderIntoDocument(
			<PortfolioBalances
				model={{
					snapshot,
					positionPageCount: pages,
					loading: false,
					refresh: async () => undefined,
					watchlistOnly: false,
					setWatchlistOnly: () => undefined,
					preferences: { watchedQuestionIds: [], universeIds: [], selectedQuestionIds: [], knownPositionQuestionIds: [] },
					toggleWatch: () => undefined,
					branchInput: '',
					setBranchInput: () => undefined,
					addBranch: async () => undefined,
				}}
			/>,
		),
	)
	return [...document.querySelectorAll('[data-message-tone="warning"]')].map(node => node.textContent)
}

test('consolidates paged position coverage into one disclosure', async () => {
	const warnings = await renderBalances(5n)
	expect(warnings).toHaveLength(1)
	expect(warnings[0]).toContain('Change pages or enter a question ID')
})

test('keeps native and operation coverage omissions separate from the page scope', async () => {
	const warnings = await renderBalances(5n, ['Universe 7 has no REP token.', 'Operation scan limit reached for pool 0x123; pending exposure may be missing.'])
	expect(warnings).toHaveLength(2)
	expect(warnings[1]).toContain('Universe 7 has no REP token.')
	expect(warnings[1]).toContain('pending exposure may be missing.')
})

test('keeps the subset disclosure when the selected positions fit on one page', async () => {
	const warnings = await renderBalances(1n)
	expect(warnings).toHaveLength(1)
	expect(warnings[0]).toContain('Add IDs to inspect other questions')
})
