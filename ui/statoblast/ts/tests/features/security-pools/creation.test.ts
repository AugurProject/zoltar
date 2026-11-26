import { expect, test } from 'bun:test'
import { defaultSecurityPoolCreationDraft, parseFixedSecurityPoolQuestions, parseSecurityPoolCreationEconomics, securityPoolDeploymentReviewDescription } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/creation.js'
test('creation configures pool fees and minimums while health remains a personal setting', () => {
	expect(parseSecurityPoolCreationEconomics(defaultSecurityPoolCreationDraft())).toEqual({
		annualFeeBps: 1000n,
		purchaseFeeBps: 100n,
		minimumPurchaseFeeAttoEth: 10n ** 15n,
		minimumCommitmentAttoEth: 10n ** 18n,
		minimumOutcomeRate: 10n ** 16n,
		rewardVestingSeconds: 86_400n,
	})
	expect(parseSecurityPoolCreationEconomics({ ...defaultSecurityPoolCreationDraft(), purchaseFeePercent: '0.07', minimumPurchaseFee: '0', rewardVestingHours: '24.5' })).toMatchObject({ purchaseFeeBps: 7n, minimumPurchaseFeeAttoEth: 0n, rewardVestingSeconds: 88_200n })
	expect(parseSecurityPoolCreationEconomics({ ...defaultSecurityPoolCreationDraft(), annualFeePercent: '51.23' })).toMatchObject({ annualFeeBps: 5_123n })
	for (const patch of [{ annualFeePercent: '100.01' }, { annualFeePercent: '0.001' }, { purchaseFeePercent: '100.01' }, { purchaseFeePercent: '0.001' }, { minimumCommitment: '0' }, { minimumOutcomeRate: '1.01' }, { rewardVestingHours: '0' }, { rewardVestingHours: '23.99' }])
		expect(() => parseSecurityPoolCreationEconomics({ ...defaultSecurityPoolCreationDraft(), ...patch })).toThrow()
})
test('fixed policy questions normalize duplicate IDs and preserve full uint256 precision', () => {
	expect(parseFixedSecurityPoolQuestions('0x10, 2 16\n0')).toEqual([0n, 2n, 16n])
	for (const value of ['', '-1', '2.5', '0x', String(1n << 256n), '1;2']) expect(() => parseFixedSecurityPoolQuestions(value)).toThrow()
})

test('six-decimal collateral parses minimums in token units and rejects excess precision', () => {
	const config = parseSecurityPoolCreationEconomics(defaultSecurityPoolCreationDraft(), 6)
	expect(config.minimumPurchaseFeeAttoEth).toBe(1_000n)
	expect(config.minimumCommitmentAttoEth).toBe(1_000_000n)
	expect(config.minimumOutcomeRate).toBe(10n ** 16n)
	expect(() => parseSecurityPoolCreationEconomics({ ...defaultSecurityPoolCreationDraft(), minimumPurchaseFee: '0.0000001' }, 6)).toThrow('6 decimal places')
})

const deployment = { origin: { universeId: 42n, collateralToken: '0x0000000000000000000000000000000000000001', securityMultiplierBps: 25000n, minimumReportCollateral: 2_000_000n, reportPriorityFeeAttoEthPerGas: 10_000_000_000n }, horizon: 86400n, policy: '0x0000000000000000000000000000000000000002' } as const

test('the deployment review states the purchase fee floor and minimum commitment in collateral units', () => {
	const config = parseSecurityPoolCreationEconomics({ ...defaultSecurityPoolCreationDraft(), minimumCommitment: '100', minimumPurchaseFee: '1.5' }, 6)
	const review = securityPoolDeploymentReviewDescription('open', config, { decimals: 6, symbol: 'USDC' }, deployment)
	expect(review).toContain('minimum 1.5 USDC.')
	expect(review).toContain('Minimum collateral commitment 100 USDC; fork auction lots may be larger;')
})

test('deployment review states every immutable from the captured request (#1731)', () => {
	const review = securityPoolDeploymentReviewDescription(
		'fixed',
		parseSecurityPoolCreationEconomics(defaultSecurityPoolCreationDraft(), 6),
		{ decimals: 6, symbol: 'USDC' },
		{
			origin: { universeId: 42n, collateralToken: '0x0000000000000000000000000000000000000001', securityMultiplierBps: 25000n, minimumReportCollateral: 2_000_000n, reportPriorityFeeAttoEthPerGas: 10_000_000_000n },
			horizon: 86400n,
			policy: '0x0000000000000000000000000000000000000002',
		},
	)
	for (const value of ['42', '86400 seconds', '25000 bps', '2 USDC', '10 nanoETH/gas', '0.01', '0x0000000000000000000000000000000000000001', '0x0000000000000000000000000000000000000002']) expect(review).toContain(value)
})
