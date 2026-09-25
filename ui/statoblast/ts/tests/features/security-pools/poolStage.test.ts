/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
import { buildPoolPageRouteHash, mapLegacyStatoblastHash, parsePoolsRouteHash } from '@zoltar/ui-statoblast-shared/lib/statoblastLocation.js'
import { deriveListedPoolLifecycleStep, derivePoolLifecycleStep, getDefaultPoolTab, isForkWorkflowPrimary } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/poolLifecycle.js'
import { derivePoolActionItems, type PoolActionInput } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/poolActions.js'
import { derivePoolViewModel } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/poolViewModel.js'
import { evaluateSecurityPoolState } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolState.js'
import { createAccountState, createForkAuctionDetails, createSecurityPoolVaultSummary, createSelectedPool } from './workflow/builders.js'

const POOL = getAddress('0x00000000000000000000000000000000000000a1')
const ACCOUNT = getAddress('0x00000000000000000000000000000000000000b2')

describe('pool locations', () => {
	test('parses list views, pool pages, and tabs from the hash path', () => {
		expect(parsePoolsRouteHash('#/pools')).toEqual({ view: 'browse' })
		expect(parsePoolsRouteHash('#/pools/create')).toEqual({ view: 'create' })
		expect(parsePoolsRouteHash('#/pools/universes')).toEqual({ view: 'universes' })
		expect(parsePoolsRouteHash(`#/pools/${POOL}`)).toEqual({ securityPoolAddress: POOL, tab: '', view: 'operate' })
		expect(parsePoolsRouteHash(`#/pools/${POOL}/reporting/`)).toEqual({ securityPoolAddress: POOL, tab: 'reporting', view: 'operate' })
		expect(parsePoolsRouteHash('#/pools/create/extra')).toBeUndefined()
		expect(parsePoolsRouteHash(`#/pools/${POOL}/reporting/extra`)).toBeUndefined()
		expect(parsePoolsRouteHash('#/portfolio')).toBeUndefined()
	})

	test('builds pool page hashes that parse back to the same location', () => {
		expect(buildPoolPageRouteHash(POOL, 'fork-workflow')).toBe(`#/pools/${POOL}/fork-workflow`)
		expect(buildPoolPageRouteHash(POOL)).toBe(`#/pools/${POOL}`)
		expect(buildPoolPageRouteHash('')).toBe('#/pools')
	})

	test('maps legacy security pool links onto the path routes and keeps shared query parameters', () => {
		expect(mapLegacyStatoblastHash(`#/security-pools?securityPoolsView=operate&securityPool=${POOL}&selectedPoolView=vaults&universe=0&simulate=1`)).toBe(`#/pools/${POOL}/vaults?universe=0&simulate=1`)
		expect(mapLegacyStatoblastHash(`#/security-pools?securityPool=${POOL}`)).toBe(`#/pools/${POOL}`)
		expect(mapLegacyStatoblastHash('#/security-pools?securityPoolsView=create&questionId=0x42')).toBe('#/pools/create?questionId=0x42')
		expect(mapLegacyStatoblastHash('#/security-pools?securityPoolsView=universes&questionId=0x42')).toBe('#/pools/universes')
		expect(mapLegacyStatoblastHash('#/security-pools?simulate=1&simScenario=security-pool')).toBe('#/pools?simulate=1&simScenario=security-pool')
		expect(mapLegacyStatoblastHash('#/pools')).toBeUndefined()
	})
})

describe('pool lifecycle stage', () => {
	test('maps the lifecycle and reporting axes onto Operational → Escalation → Fork / Migration → Truth auction → Settled', () => {
		expect(derivePoolLifecycleStep({ hasForkActivity: false, lifecycleState: 'operational', reportingOpen: false })).toBe('operational')
		expect(derivePoolLifecycleStep({ hasForkActivity: false, lifecycleState: 'operational', reportingOpen: true })).toBe('escalation')
		expect(derivePoolLifecycleStep({ hasForkActivity: false, lifecycleState: 'operational', reportingOpen: true, reportingStage: 'preOpen' })).toBe('operational')
		expect(derivePoolLifecycleStep({ hasForkActivity: false, lifecycleState: 'operational', reportingOpen: true, reportingStage: 'activeLocked' })).toBe('escalation')
		expect(derivePoolLifecycleStep({ hasForkActivity: false, lifecycleState: 'operational', reportingOpen: true, reportingStage: 'forkTriggered' })).toBe('forkMigration')
		expect(derivePoolLifecycleStep({ hasForkActivity: false, lifecycleState: 'operational', reportingOpen: true, reportingStage: 'resolved' })).toBe('settled')
		expect(derivePoolLifecycleStep({ hasForkActivity: false, lifecycleState: 'poolForked', reportingOpen: true })).toBe('forkMigration')
		expect(derivePoolLifecycleStep({ hasForkActivity: true, lifecycleState: 'forkMigration', reportingOpen: true })).toBe('forkMigration')
		expect(derivePoolLifecycleStep({ hasForkActivity: true, lifecycleState: 'forkTruthAuction', reportingOpen: true })).toBe('truthAuction')
		expect(derivePoolLifecycleStep({ forkSettled: true, hasForkActivity: true, lifecycleState: 'operational', reportingOpen: true })).toBe('settled')
		expect(derivePoolLifecycleStep({ hasForkActivity: false, lifecycleState: 'ended', reportingOpen: true })).toBe('settled')
		expect(derivePoolLifecycleStep({ hasForkActivity: false, lifecycleState: undefined, reportingOpen: false })).toBeUndefined()
	})

	test('opens the tab that holds each stage and promotes Fork & Migration once it matters', () => {
		expect(getDefaultPoolTab('operational', false)).toBe('vaults')
		expect(getDefaultPoolTab('escalation', false)).toBe('reporting')
		expect(getDefaultPoolTab('forkMigration', true)).toBe('fork-workflow')
		expect(getDefaultPoolTab('truthAuction', true)).toBe('fork-workflow')
		expect(getDefaultPoolTab('settled', false)).toBe('trading')
		expect(getDefaultPoolTab('settled', true)).toBe('fork-workflow')
		expect(isForkWorkflowPrimary('operational', false)).toBe(false)
		expect(isForkWorkflowPrimary('forkMigration', false)).toBe(true)
		expect(isForkWorkflowPrimary('settled', true)).toBe(true)
	})

	test('derives a listed pool stage from registry data and the clock', () => {
		const pool = createSelectedPool({ marketDetails: createMarketDetails({ endTime: 100n }) })
		expect(deriveListedPoolLifecycleStep(pool, 50n).step).toBe('operational')
		expect(deriveListedPoolLifecycleStep(pool, 100n).step).toBe('escalation')
		expect(deriveListedPoolLifecycleStep(createSelectedPool({ questionOutcome: 'yes' }), 50n).step).toBe('settled')
		expect(deriveListedPoolLifecycleStep(createSelectedPool({ systemState: 'forkTruthAuction', truthAuctionStartedAt: 10n }), 50n).step).toBe('truthAuction')
	})
})

function createActionInput(overrides: Partial<PoolActionInput>): PoolActionInput {
	return {
		accountConnected: true,
		hasForkActivity: false,
		now: 50n,
		poolState: evaluateSecurityPoolState({ lifecycleState: 'operational', universeHasForked: false }),
		shareBalances: undefined,
		step: 'operational',
		vault: undefined,
		...overrides,
	}
}

describe('pool action items', () => {
	test('puts warnings first, then stage actions, then milestones, and asks to connect when disconnected', () => {
		expect(derivePoolActionItems(createActionInput({ pendingReportId: 7n, stagedOperationCount: 2n, oracleUnavailable: true })).map(item => item.id)).toEqual(['reviewOracle', 'viewPendingReport', 'reviewStagedOperations', 'depositRep', 'mintShares'])
		expect(derivePoolActionItems(createActionInput({ accountConnected: false })).map(item => item.id)).toEqual(['connectWallet'])
	})

	test('bounds stage actions by their deadlines and keeps past deadlines out', () => {
		const escalation = derivePoolActionItems(
			createActionInput({
				escalationEndsAt: 500n,
				reportingStage: 'activeWithdrawable',
				step: 'escalation',
				poolState: evaluateSecurityPoolState({ lifecycleState: 'operational', reportingStage: 'activeWithdrawable', universeHasForked: false }),
				vault: { claimableFeesAttoEth: 0n, disputeStakedAttoRep: 3n, repAttoRep: 10n },
			}),
		)
		expect(escalation.map(item => [item.id, item.deadline])).toEqual([
			['reportOrEscalate', 500n],
			['withdrawEscalation', undefined],
		])
		const migration = derivePoolActionItems(createActionInput({ hasForkActivity: true, migrationEndsAt: 40n, poolState: evaluateSecurityPoolState({ lifecycleState: 'forkMigration', universeHasForked: true }), step: 'forkMigration', vault: { claimableFeesAttoEth: 2n, disputeStakedAttoRep: 0n, repAttoRep: 10n } }))
		expect(migration.map(item => [item.id, item.deadline, item.tab])).toEqual([
			['migrateVault', undefined, 'fork-workflow'],
			['claimFees', undefined, 'vaults'],
		])
		expect(derivePoolActionItems(createActionInput({ auctionEndsAt: 90n, step: 'truthAuction' }))[0]).toEqual({ deadline: 90n, id: 'bidTruthAuction', tab: 'fork-workflow', tone: 'action' })
		expect(derivePoolActionItems(createActionInput({ forkTriggerAvailable: true, step: 'forkMigration' }))[0]?.id).toBe('triggerFork')
	})

	test('offers redemption only for positions the account holds once the pool settles', () => {
		const poolState = evaluateSecurityPoolState({ lifecycleState: 'ended', universeHasForked: false })
		expect(derivePoolActionItems(createActionInput({ poolState, step: 'settled' })).map(item => item.id)).toEqual([])
		const items = derivePoolActionItems(createActionInput({ poolState, shareBalances: { invalidAttoShares: 0n, noAttoShares: 0n, yesAttoShares: 5n }, step: 'settled', vault: { claimableFeesAttoEth: 0n, disputeStakedAttoRep: 0n, repAttoRep: 10n } }))
		expect(items.map(item => item.id)).toEqual(['redeemShares', 'withdrawVaultRep'])
		const forkedPoolState = evaluateSecurityPoolState({ lifecycleState: 'operational', universeHasForked: false })
		expect(derivePoolActionItems(createActionInput({ hasForkActivity: true, poolState: forkedPoolState, step: 'settled' })).map(item => item.id)).toEqual([])
		expect(derivePoolActionItems(createActionInput({ accountConnected: false, forkClaimAvailable: true, hasForkActivity: true, poolState: forkedPoolState, step: 'settled' })).map(item => item.id)).toEqual(['connectWallet'])
		expect(derivePoolActionItems(createActionInput({ forkClaimAvailable: true, hasForkActivity: true, poolState: forkedPoolState, step: 'settled' })).map(item => item.id)).toEqual(['claimForkSettlement'])
	})
})

describe('derivePoolViewModel', () => {
	function derive(overrides: Partial<Parameters<typeof derivePoolViewModel>[0]>) {
		return derivePoolViewModel({
			accountState: createAccountState({ address: ACCOUNT }),
			activeUniverseId: 1n,
			checkedSecurityPoolAddress: POOL,
			forkAuctionDetails: undefined,
			liquidationManagerAddress: undefined,
			loadingSecurityPools: false,
			manualPendingOperationId: '',
			now: 50n,
			poolOracleManagerDetails: undefined,
			poolOracleManagerError: undefined,
			poolOracleManagerErrorAddress: undefined,
			reportingDetails: undefined,
			reportingFormSecurityPoolAddress: '',
			requestPriceReview: undefined,
			securityPoolAddress: POOL,
			securityPoolOverviewError: undefined,
			securityPools: [],
			securityVaultDetails: undefined,
			selectedPoolView: '',
			selectedVaultOwnerInput: '',
			shareBalances: undefined,
			...overrides,
		})
	}

	test('opens an operational pool on its vaults with the account vault actions', () => {
		const model = derive({ securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 100n }), securityPoolAddress: POOL, vaults: [createSecurityPoolVaultSummary({ vaultAddress: ACCOUNT })] })] })
		expect(model.lifecycleStep).toBe('operational')
		expect(model.view).toBe('vaults')
		expect(model.forkWorkflowPrimary).toBe(false)
		expect(model.accountVault).toEqual({ claimableFeesAttoEth: 10n ** 18n, disputeStakedAttoRep: 10n ** 18n, repAttoRep: 5n * 10n ** 18n })
		expect(model.actionItems.map(item => item.id)).toEqual(['manageVault', 'mintShares', 'claimFees'])
	})

	test('opens a pool in fork migration on Fork & Migration with the migration deadline', () => {
		const pool = createSelectedPool({ hasForkActivity: true, securityPoolAddress: POOL, systemState: 'forkMigration', universeHasForked: true })
		const model = derive({ forkAuctionDetails: createForkAuctionDetails({ hasForkActivity: true, migrationEndsAt: 900n, securityPoolAddress: POOL, systemState: 'forkMigration' }), securityPools: [pool] })
		expect(model.lifecycleStep).toBe('forkMigration')
		expect(model.view).toBe('fork-workflow')
		expect(model.forkWorkflowPrimary).toBe(true)
		expect(model.actionItems.find(item => item.id === 'reviewForkMigration')?.deadline).toBe(900n)
	})

	test('keeps an explicit tab and does not act on an unloaded pool', () => {
		expect(derive({ securityPools: [createSelectedPool({ securityPoolAddress: POOL })], selectedPoolView: 'staged-operations' }).view).toBe('staged-operations')
		const missing = derive({ securityPools: [] })
		expect(missing.showSelectedPoolWorkflowDetails).toBe(false)
		expect(missing.lifecycleStep).toBeUndefined()
		expect(missing.actionItems).toEqual([])
	})
})
