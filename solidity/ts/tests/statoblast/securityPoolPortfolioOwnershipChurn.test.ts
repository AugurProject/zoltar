import { describe, expect, test } from 'bun:test'
import { useAggregatePortfolioFixture } from './securityPoolPortfolioAggregateFixture'
import { unit } from './securityPoolPortfolioFixture'

describe('Statoblast: reserve ownership churn', () => {
	const { fixture, deposit, withdraw, shares, mint, positionCount, custody, ownerPositionShares, assets } = useAggregatePortfolioFixture()

	test('a completed dust deposit and full exit cannot force an unchanged cohort into a second allocation', async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		await mint()
		const originalCustody = await custody()
		await deposit(1n, fixture.other())
		await withdraw(await shares(fixture.other().account.address), fixture.other())
		await mint(200n * unit)
		expect(await positionCount()).toBe(1n)
		expect(await custody()).toBe(originalCustody)
	})

	test('an allocation made during transient membership never acquires the restored cohort', async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		await mint()
		await deposit(100n * unit, fixture.other())
		await mint(100n * unit, fixture.secondQuestionId)
		const transientOwnerShares = await ownerPositionShares(2n, fixture.other().account.address)
		expect(transientOwnerShares).toBeGreaterThan(0n)
		await withdraw(await shares(fixture.other().account.address), fixture.other())
		await mint(200n * unit)
		expect(await positionCount()).toBe(2n)
		await mint(200n * unit, fixture.secondQuestionId)
		expect(await positionCount()).toBe(3n)
		expect(await ownerPositionShares(2n, fixture.other().account.address)).toBe(transientOwnerShares)
		expect(await ownerPositionShares(3n, fixture.other().account.address)).toBe(0n)
	})

	test('interleaved owner changes cannot restore an unrelated prior ownership version', async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		await mint()
		await deposit(1n, fixture.other())
		await deposit(unit)
		await withdraw(await shares(fixture.other().account.address), fixture.other())
		await mint(200n * unit)
		expect(await positionCount()).toBe(2n)
		expect(await ownerPositionShares(1n)).not.toBe(await ownerPositionShares(2n))
	})

	test('share-generation rollover never restores the old allocation cohort', async () => {
		await deposit(240n * unit)
		await fixture.refreshPrice(fixture.base.questionId)
		await mint()
		expect(await assets()).toBe(0n)
		await deposit(5_000n * unit, fixture.other())
		await mint(200n * unit)
		expect(await positionCount()).toBe(2n)
		expect(await ownerPositionShares(1n, fixture.other().account.address)).toBe(0n)
		expect(await ownerPositionShares(2n)).toBe(0n)
		expect(await ownerPositionShares(2n, fixture.other().account.address)).toBe(5_000n * unit)
	})
})
