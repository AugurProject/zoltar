import { expect, test } from 'bun:test'
import { computeOrdinaryWinningWithdrawal, escalationPayoutExample } from './contract-reference-rules.mts'

test('ordinary withdrawals partition the cumulative payout and burn without losing dust', () => {
	const end = computeOrdinaryWinningWithdrawal(escalationPayoutExample)
	const start = computeOrdinaryWinningWithdrawal({ ...escalationPayoutExample, cumulativeAmountAttoRep: 10n ** 19n, depositAmountAttoRep: 10n ** 19n })
	const whole = computeOrdinaryWinningWithdrawal({ ...escalationPayoutExample, depositAmountAttoRep: 15n * 10n ** 18n })
	expect(end.burnAttoRep).toBe(1_333_333_333_333_333_334n)
	expect(start.burnAttoRep + end.burnAttoRep).toBe(whole.burnAttoRep)
	expect(start.scaledPayoutAttoRep + end.scaledPayoutAttoRep).toBe(whole.scaledPayoutAttoRep)
})
