import { describe, expect, test } from 'bun:test'
import { encodeFunctionData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { createE2E, INVALID, NO, WEEK, YES } from '../auditE2EHarness'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

/** EIP-7825 per-transaction gas limit. */
const TRANSACTION_GAS_CAP = 16_777_216n
/** A single-target migration into an active branch must leave this much of the cap unused. */
const MIGRATION_GAS_BUDGET = 12_000_000n
/** The readiness check runs before any branch work, so the refusal needs only a small part of the cap. */
const REFUSAL_GAS_BUDGET = 3_000_000n
const BRANCH_NOT_ACTIVE = 'Fork branch not active: run prepareBranch, startBranch and finalizeBranch first'

describe('Statoblast: lazy share migration into an unprepared fork branch', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const e2e = createE2E(fixture)

	const callFailure = async (from: Address, to: Address, data: Hex, gas: bigint) => {
		try {
			await fixture.base.mockWindow.request({ method: 'eth_call', params: [{ from, to, data, gas: `0x${gas.toString(16)}` }, 'latest'] })
			return undefined
		} catch (error) {
			return String(error)
		}
	}
	/** Smallest gas limit at which the call succeeds, by `eth_call` bisection. */
	const minimumGas = async (from: Address, to: Address, data: Hex) => {
		let high = 60_000_000n
		const failure = await callFailure(from, to, data, high)
		if (failure !== undefined) throw new Error(`Call fails even with ${high} gas: ${failure}`)
		let low = 21_000n
		while (high - low > 10_000n) {
			const middle = (low + high) / 2n
			if ((await callFailure(from, to, data, middle)) === undefined) high = middle
			else low = middle
		}
		return high
	}

	/** An outsider forks the origin on an unrelated question; nobody chooses a branch. */
	const assertMigrationGasBound = async (questionId: bigint) => {
		const universe = fixture.base.genesisUniverse
		const holder = fixture.other().account.address
		const forkTime = await e2e.forkOn(fixture.owner(), universe, await e2e.unrelatedQuestion('Outsider fork for migration gas'))
		await fixture.base.mockWindow.setTime(forkTime + 9n * WEEK + 5n)
		const shares = e2e.shares(questionId)
		const migrate = encodeFunctionData({ abi: shares.abi, functionName: 'migrate', args: [universe * 256n + BigInt(INVALID), [BigInt(YES)]] })

		// Nothing prepared: migration refuses with the missing step instead of running the fork bootstrap.
		expect(await callFailure(holder, shares.address, migrate, TRANSACTION_GAS_CAP)).toContain(BRANCH_NOT_ACTIVE)
		expect(await callFailure(holder, shares.address, migrate, REFUSAL_GAS_BUDGET)).toContain(BRANCH_NOT_ACTIVE)

		// Once the branch is active through its separately bounded steps, the composite migration fits.
		const child = await e2e.activateBranch(universe, YES)
		expect(child).toBe(getChildUniverseId(universe, YES))
		const required = await minimumGas(holder, shares.address, migrate)
		expect(required).toBeLessThan(MIGRATION_GAS_BUDGET)
		await e2e.migrateShares(fixture.other(), universe, INVALID, [YES], questionId)
		expect(await e2e.shareBalance(holder, child, INVALID, questionId)).toBeGreaterThan(0n)
		console.log(`single-target migrate into an active branch needs ${required} gas`)
	}

	test('one position: migration refuses early, then fits once the branch is active', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit, fixture.secondQuestionId)
		await fixture.base.mockWindow.advanceTime(1000n)
		await assertMigrationGasBound(fixture.secondQuestionId)
	})

	test('a question with a live escalation game: migration refuses early, then fits once the branch is active', async () => {
		const questionId = fixture.base.questionId
		await fixture.prepare()
		await fixture.mint(10n * unit, questionId)
		await fixture.mint(10n * unit, fixture.secondQuestionId)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		const pool = fixture.poolFor(questionId).securityPool
		for (const [index, outcome] of [YES, NO, INVALID].entries()) await e2e.deposit(e2e.account(2 + index), pool, outcome, 2n * unit)
		await assertMigrationGasBound(questionId)
	})
})
