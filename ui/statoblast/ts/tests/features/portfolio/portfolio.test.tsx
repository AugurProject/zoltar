/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { PortfolioSection, type PortfolioSectionProps } from '@zoltar/ui-statoblast-shared/features/portfolio/components/PortfolioSection.js'
import { derivePortfolioViewModel } from '@zoltar/ui-statoblast-shared/features/portfolio/lib/portfolioViewModel.js'
import { createSecurityPoolVaultSummary, createSelectedPool } from '../security-pools/workflow/builders.js'

const ACCOUNT = getAddress('0x00000000000000000000000000000000000000b2')
const OPERATIONAL_POOL = getAddress('0x00000000000000000000000000000000000000a1')
const MIGRATING_POOL = getAddress('0x00000000000000000000000000000000000000a2')
const SHARES_POOL = getAddress('0x00000000000000000000000000000000000000a3')
const OTHER_POOL = getAddress('0x00000000000000000000000000000000000000a4')
const NO_SHARES = { invalidAttoShares: 0n, noAttoShares: 0n, yesAttoShares: 0n }

function createSnapshots() {
	return [
		{ migrationEndsAt: undefined, pool: createSelectedPool({ marketDetails: createMarketDetails({ endTime: 100n, title: 'Operational question' }), securityPoolAddress: OPERATIONAL_POOL, vaults: [createSecurityPoolVaultSummary({ disputeStakedAttoRep: 0n, vaultAddress: ACCOUNT })] }), shareBalances: NO_SHARES },
		{
			migrationEndsAt: 900n,
			pool: createSelectedPool({ hasForkActivity: true, marketDetails: createMarketDetails({ title: 'Migrating question' }), securityPoolAddress: MIGRATING_POOL, systemState: 'forkMigration', universeHasForked: true, vaults: [createSecurityPoolVaultSummary({ claimableFeesAttoEth: 0n, vaultAddress: ACCOUNT })] }),
			shareBalances: NO_SHARES,
		},
		{ migrationEndsAt: undefined, pool: createSelectedPool({ marketDetails: createMarketDetails({ title: 'Resolved question' }), questionOutcome: 'yes', securityPoolAddress: SHARES_POOL }), shareBalances: { ...NO_SHARES, yesAttoShares: 4n } },
		{ migrationEndsAt: undefined, pool: createSelectedPool({ securityPoolAddress: OTHER_POOL, vaults: [createSecurityPoolVaultSummary({ capacityOwnershipAttoRep: 0n, claimableFeesAttoEth: 0n, disputeStakedAttoRep: 0n, vaultAttoRepBacking: 0n, vaultAddress: ACCOUNT })] }), shareBalances: NO_SHARES },
	]
}

describe('derivePortfolioViewModel', () => {
	test('keeps only pools where the account holds a vault or shares', () => {
		const { holdings } = derivePortfolioViewModel({ accountAddress: ACCOUNT, now: 50n, snapshots: createSnapshots() })
		expect(holdings.map(holding => [holding.pool.securityPoolAddress, holding.step])).toEqual([
			[OPERATIONAL_POOL, 'operational'],
			[MIGRATING_POOL, 'forkMigration'],
			[SHARES_POOL, 'settled'],
		])
	})

	test('lists the actions positions need with the soonest deadline first and leaves stage suggestions on the pool page', () => {
		const { actionEntries } = derivePortfolioViewModel({ accountAddress: ACCOUNT, now: 50n, snapshots: createSnapshots() })
		expect(actionEntries.map(({ holding, item }) => [holding.pool.securityPoolAddress, item.id, item.deadline])).toEqual([
			[MIGRATING_POOL, 'migrateVault', 900n],
			[OPERATIONAL_POOL, 'claimFees', undefined],
			[SHARES_POOL, 'redeemShares', undefined],
		])
	})
})

let cleanup: (() => Promise<void>) | undefined
installStatoblastRouting()
installDomTestLifecycle({
	afterTest: async () => {
		await cleanup?.()
		cleanup = undefined
	},
	url: 'http://localhost/#/portfolio',
})

describe('PortfolioSection', () => {
	function createProps(overrides: Partial<PortfolioSectionProps>): PortfolioSectionProps {
		return {
			accountAddress: ACCOUNT,
			currentTimestamp: 50n,
			isConnectingWallet: false,
			onConnect: () => undefined,
			portfolio: { error: undefined, loading: false, onRetry: () => undefined, snapshots: createSnapshots() },
			walletBootstrapComplete: true,
			...overrides,
		}
	}

	test('asks a disconnected visitor to connect a wallet', async () => {
		let connects = 0
		cleanup = (await renderIntoDocument(<PortfolioSection {...createProps({ accountAddress: undefined, onConnect: () => (connects += 1) })} />)).cleanup
		fireEvent.click(within(document.body).getByRole('button', { name: 'Connect wallet' }))
		expect(connects).toBe(1)
	})

	test('points an account without positions at the pools', async () => {
		cleanup = (await renderIntoDocument(<PortfolioSection {...createProps({ portfolio: { error: undefined, loading: false, onRetry: () => undefined, snapshots: [] } })} />)).cleanup
		expect(document.body.textContent).toContain('No positions yet')
		expect(within(document.body).getByRole('link', { name: 'Browse pools' }).getAttribute('href')).toBe('#/pools')
	})

	test('links each action to the pool tab that holds it', async () => {
		cleanup = (await renderIntoDocument(<PortfolioSection {...createProps({})} />)).cleanup
		const page = within(document.body)
		expect(page.getByRole('heading', { name: 'Needs attention' })).not.toBeNull()
		expect(page.getByRole('link', { name: 'Open fork & migration' }).getAttribute('href')).toBe(`#/pools/${MIGRATING_POOL}/fork-workflow?universe=1`)
		expect(page.getByRole('link', { name: 'Open shares' }).getAttribute('href')).toBe(`#/pools/${SHARES_POOL}/trading?universe=1`)
		expect(page.getAllByRole('link', { name: /^Open pool:/ })).toHaveLength(3)
	})

	test('offers a retry when the first load fails', async () => {
		let retries = 0
		cleanup = (await renderIntoDocument(<PortfolioSection {...createProps({ portfolio: { error: 'Failed to load your positions.', loading: false, onRetry: () => (retries += 1), snapshots: undefined } })} />)).cleanup
		fireEvent.click(within(document.body).getByRole('button', { name: 'Retry' }))
		expect(retries).toBe(1)
	})
})
