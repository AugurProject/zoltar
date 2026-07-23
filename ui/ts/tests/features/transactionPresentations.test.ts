/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import {
	createForkAuctionSuccessPresentation,
	createForkAuctionTransactionIntent,
	createLiquidationSuccessPresentation,
	createLiquidationTransactionIntent,
	createMarketCreationSuccessPresentation,
	createOpenOracleSuccessPresentation,
	createOpenOracleTransactionIntent,
	createReportingSuccessPresentation,
	createReportingTransactionIntent,
	createSecurityVaultTransactionIntent,
	createTradingSuccessPresentation,
	createTradingTransactionIntent,
} from '../../features/transactionPresentations.js'
import type { ForkAuctionActionResult } from '../../types/contracts.js'
import { createInitialTransactionTrayState, markTransactionFailed, markTransactionPrepared, markTransactionRequested, markTransactionSubmitted } from '../../lib/transactionTray.js'

const transactionHash = '0x1234000000000000000000000000000000000000000000000000000000000000'

function createForkAuctionResult(action: ForkAuctionActionResult['action'], overrides: Partial<ForkAuctionActionResult> = {}): ForkAuctionActionResult {
	return {
		action,
		hash: '0x1234',
		securityPoolAddress: '0x0000000000000000000000000000000000000123',
		universeId: 1n,
		...overrides,
	}
}

describe('transaction presentations', () => {
	test('preserves protocol acronym casing and question terminology', () => {
		expect(createSecurityVaultTransactionIntent('depositRep').submittedTitle).toBe('Deposit REP')
		for (const [marketType, expectedLabel] of [
			['binary', 'Binary'],
			['categorical', 'Categorical'],
			['scalar', 'Scalar'],
		] as const) {
			const questionTypeRow = createMarketCreationSuccessPresentation({ createQuestionHash: '0x1234', marketType, questionId: '0x01' }).rows?.find(row => row.label === 'Question Type')
			expect(questionTypeRow?.value).toBe(expectedLabel)
		}
	})

	test('keeps vault identity in transaction intent rows', () => {
		const intent = createSecurityVaultTransactionIntent('depositRep', {
			securityPoolAddress: '0x0000000000000000000000000000000000000001',
			vaultAddress: '0x0000000000000000000000000000000000000002',
		})
		expect(intent.rows?.map(row => row.label)).toEqual(['Security Pool Address', 'Vault'])
	})

	test('uses resolved token symbols in Open Oracle approval and withdrawal titles', () => {
		const context = {
			token1Symbol: 'WETH',
			token2Symbol: 'REP',
			withdrawalTokenSymbol: 'WETH',
		}

		expect(createOpenOracleTransactionIntent('approveToken1', context).submittedTitle).toBe('Approve WETH')
		expect(createOpenOracleSuccessPresentation({ action: 'approveToken1', hash: '0x1234' }, context).title).toBe('WETH Approved')
		expect(createOpenOracleTransactionIntent('withdrawBalance', context).submittedTitle).toBe('Withdraw WETH')
		expect(createOpenOracleSuccessPresentation({ action: 'withdrawBalance', hash: '0x1234' }, context).title).toBe('WETH Withdrawn')
	})

	test('uses the user-facing report name for Open Oracle creation', () => {
		expect(createOpenOracleTransactionIntent('createReportInstance').submittedTitle).toBe('Create Report')
		expect(createOpenOracleSuccessPresentation({ action: 'createReportInstance', hash: '0x1234' }).title).toBe('Report Created')
	})

	test('keeps pool, universe, and action context in trading and reporting intents', () => {
		const context = {
			securityPoolAddress: '0x0000000000000000000000000000000000000001',
			universeId: 7n,
		}
		const tradingIntent = createTradingTransactionIntent('migrateShares', { ...context, shareOutcome: 'yes' })
		const reportingIntent = createReportingTransactionIntent('reportOutcome', { ...context, outcome: 'no' })

		expect(tradingIntent.rows?.map(row => row.label)).toEqual(['Pool', 'Universe', 'Share Outcome'])
		expect(reportingIntent.rows?.map(row => row.label)).toEqual(['Pool', 'Universe', 'Outcome'])
	})

	test('reuses liquidation identity and submitted values in completion presentations', () => {
		const context = {
			amount: '4.5',
			securityPoolAddress: '0x0000000000000000000000000000000000000001' as const,
			targetVault: '0x0000000000000000000000000000000000000002' as const,
			universeId: 7n,
		}
		const intent = createLiquidationTransactionIntent(context)
		const presentation = createLiquidationSuccessPresentation(
			{
				action: 'queueLiquidation',
				hash: '0x1234',
				securityPoolAddress: context.securityPoolAddress,
			},
			context,
		)

		expect(intent.rows?.map(row => row.label)).toEqual(['Pool', 'Universe', 'Target Vault', 'Amount'])
		expect(presentation.rows?.map(row => row.label)).toEqual(['Pool', 'Universe', 'Target Vault', 'Amount'])
	})

	test('uses the same pool and universe grammar in intent and success presentations', () => {
		const securityPoolAddress = '0x0000000000000000000000000000000000000001'
		const context = { securityPoolAddress, universeId: 7n }
		const cases = [
			{
				intent: createTradingTransactionIntent('createCompleteSet', context),
				presentation: createTradingSuccessPresentation({ action: 'createCompleteSet', hash: '0x1234', securityPoolAddress, universeId: 7n }),
			},
			{
				intent: createReportingTransactionIntent('reportOutcome', { ...context, outcome: 'yes' }),
				presentation: createReportingSuccessPresentation({ action: 'reportOutcome', hash: '0x1234', outcome: 'yes', securityPoolAddress, universeId: 7n }),
			},
		]

		for (const { intent, presentation } of cases) {
			expect(intent.rows?.slice(0, 2).map(row => row.label)).toEqual(['Pool', 'Universe'])
			expect(presentation.rows?.slice(0, 2).map(row => row.label)).toEqual(['Pool', 'Universe'])
		}
	})

	test('preserves representative workflow context through prepare, pending, and failure states', () => {
		const securityPoolAddress = '0x0000000000000000000000000000000000000001'
		const intents = [
			createTradingTransactionIntent('migrateShares', { securityPoolAddress, shareOutcome: 'yes', universeId: 7n }),
			createReportingTransactionIntent('reportOutcome', { outcome: 'no', securityPoolAddress, universeId: 7n }),
			createLiquidationTransactionIntent({ amount: '2', securityPoolAddress, targetVault: '0x0000000000000000000000000000000000000002', universeId: 7n }),
		]

		for (const intent of intents) {
			const requested = markTransactionRequested(createInitialTransactionTrayState(), intent)
			const prepared = markTransactionPrepared(requested, {
				account: '0x0000000000000000000000000000000000000003',
				args: [],
				chainName: 'Ethereum',
				contractAddress: securityPoolAddress,
				functionName: intent.action,
				value: 0n,
			})
			const submitted = markTransactionSubmitted(prepared, transactionHash)
			const failed = markTransactionFailed(submitted, 'Transaction reverted')

			for (const state of [requested, prepared, submitted, failed]) {
				expect(state.active?.rows?.map(row => row.label)).toContain('Pool')
				expect(state.active?.rows?.map(row => row.label)).toContain('Universe')
			}
			expect(prepared.active?.technicalRows?.map(row => row.label)).toContain('Function')
			expect(submitted.active?.technicalRows?.map(row => row.label)).toContain('Function')
			expect(failed.active?.technicalRows?.map(row => row.label)).toContain('Function')
		}
	})

	test('describes truth-auction claim settlement as REP plus auctioned bond allowance', () => {
		const presentation = createForkAuctionSuccessPresentation(createForkAuctionResult('claimAuctionProceeds'))
		expect(presentation.detail).toBe('Selected truth-auction bids were settled. Winning bids received child-pool REP plus Auctioned Bond Allowance (OI Debt), assigning the remaining open-interest debt; refund-only rows returned locked ETH.')
	})

	test('describes finalized refund-only settlement without OI debt assignment', () => {
		const presentation = createForkAuctionSuccessPresentation(createForkAuctionResult('claimAuctionProceeds', { settlementMode: 'refund' }))
		expect(presentation.title).toBe('Settle Finalized Refunds')
		expect(presentation.detail).toBe('Selected finalized truth-auction refund rows were settled. Locked ETH was returned without assigning child-pool REP or Auctioned Bond Allowance (OI Debt).')
	})

	test('uses refund-only transaction intent copy for finalized refund settlement submissions', () => {
		const intent = createForkAuctionTransactionIntent('claimAuctionProceeds', { submittedTitle: 'Settle Finalized Refunds' })
		expect(intent.submittedTitle).toBe('Settle Finalized Refunds')
		expect(intent.submittedDetail).toBeUndefined()
	})

	test('describes unresolved escalation migration as optional parent-lock cleanup', () => {
		const presentation = createForkAuctionSuccessPresentation(createForkAuctionResult('migrateUnresolvedEscalation'))
		expect(presentation.title).toBe('Clear Parent Escalation Locks')
		expect(presentation.detail).toBe('The wallet’s parent escalation-lock accounting was cleared in constant-size work. Child backing and proof eligibility were already available and are unchanged.')
	})

	test('describes direct parent escalation claims without calling them migration', () => {
		const intent = createForkAuctionTransactionIntent('claimParentEscalationDeposits')
		const presentation = createForkAuctionSuccessPresentation(createForkAuctionResult('claimParentEscalationDeposits'))
		expect(intent.submittedTitle).toBe('Claim Parent Escalation Deposits')
		expect(presentation.title).toBe('Claim Parent Escalation Deposits')
		expect(presentation.detail).toBe('Selected winning parent deposits were paid directly in child REP. Their carried proofs are now spent in current and later descendants.')
	})
})
