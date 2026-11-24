import { describe, expect, test } from 'bun:test'
import { encodeFunctionData } from '@zoltar/core-shared/evm/ethereum'
import { createE2E, YES, NO } from '../auditE2EHarness'
import { useSecurityPoolFixture, unit } from './securityPoolFixture'

describe('exact escalation curve crossing (#1535)', () => {
	const fixture = useSecurityPoolFixture()
	const e2e = createE2E(fixture)
	test('cached reads preserve the last-open forward second after each median change and cost less gas', async () => {
		await fixture.prepare()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		const pool = fixture.poolFor(fixture.base.questionId).questionLedger
		for (const [sender, outcome, amount] of [
			[e2e.account(2), YES, 150n * unit],
			[e2e.account(3), NO, 100n * unit],
			[e2e.account(2), YES, 20n * unit],
		] as const) {
			await e2e.deposit(sender, pool, outcome, amount)
			const game = e2e.game(await e2e.gameOf(pool))
			const client = fixture.owner()
			const activation = await client.readContract({ ...game, functionName: 'activationTime' })
			const end = await client.readContract({ ...game, functionName: 'getEscalationGameEndDate' })
			const exact = await client.readContract({ ...game, functionName: 'computeCurveFinalityElapsed' })
			expect(end).toBe(activation + exact)
			const binding = await client.readContract({ ...game, functionName: 'getBindingCapitalAttoRep' })
			const bond = await client.readContract({ ...game, functionName: 'startBondAttoRep' })
			if (binding < bond) continue
			expect(await client.readContract({ ...game, functionName: 'computeIterativeAttritionCostAttoRep', args: [exact] })).toBeLessThanOrEqual(binding)
			expect(await client.readContract({ ...game, functionName: 'computeIterativeAttritionCostAttoRep', args: [exact + 1n] })).toBeGreaterThan(binding)
			const cachedGas = await client.estimateGas({ to: game.address, data: encodeFunctionData({ abi: game.abi, functionName: 'getEscalationGameEndDate' }) })
			const exactGas = await client.estimateGas({ to: game.address, data: encodeFunctionData({ abi: game.abi, functionName: 'computeCurveFinalityElapsed' }) })
			expect(cachedGas + 20_000n).toBeLessThan(exactGas)
			if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ cachedGas, exactGas })
		}
	})
})
