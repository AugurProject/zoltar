import { test, beforeEach, describe } from 'bun:test'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient, writeContractAndWait } from '../testsuite/simulator/utils/viem'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { contractExists, setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { QuestionOutcome } from '../testsuite/simulator/types/types'
import assert from 'node:assert'
import { deployEscalationGame, depositOnOutcome, getBalances, getStartingTime, getQuestionResolution } from '../testsuite/simulator/utils/contracts/escalationGame'
import { ensureZoltarDeployed } from '../testsuite/simulator/utils/contracts/zoltar'
import { ensureInfraDeployed } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { peripherals_EscalationGame_EscalationGame } from '../types/contractArtifact'

const ESCALATION_TIME_LENGTH = 4233600n

describe('Escalation Game Test Suite', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const reportBond = 1n * 10n ** 18n
	const nonDecisionThreshold = 1000n * 10n ** 18n

	const readIterativeAttritionCost = async (escalationGame: `0x${ string }`, timeSinceStart: bigint) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'computeIterativeAttritionCost',
			address: escalationGame,
			args: [timeSinceStart],
		})

	const readTimeSinceStartFromAttritionCost = async (escalationGame: `0x${ string }`, attritionCost: bigint) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'computeTimeSinceStartFromAttritionCost',
			address: escalationGame,
			args: [attritionCost],
		})

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
	})

	test('can start a game', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		assert.ok(await contractExists(client, escalationGame), 'game was deployed')
		const outcomeBalances = await getBalances(client, escalationGame)
		assert.strictEqual(outcomeBalances.yes, 0n, 'yes stake')
		assert.strictEqual(outcomeBalances.no, 0n, 'no stake')
		assert.strictEqual(outcomeBalances.invalid, 0n, 'invalid stake')

		const startingTime = await getStartingTime(client, escalationGame)
		assert.strictEqual(startingTime !== 0n, true, 'game was started')
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.No, reportBond)
		const outcomeBalancesAfterDeposit = await getBalances(client, escalationGame)
		assert.strictEqual(outcomeBalancesAfterDeposit.yes, 0n, 'yes stake')
		assert.strictEqual(outcomeBalancesAfterDeposit.no, reportBond, 'no stake')
		assert.strictEqual(outcomeBalancesAfterDeposit.invalid, 0n, 'invalid stake')
	})

	test('depositOnOutcome reverts when outcome is None', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		await assert.rejects(depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.None, reportBond))
	})

	test('depositOnOutcome reverts when outcome is out of enum range', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		// Values > 3 are outside enum (0=Invalid,1=Yes,2=No,3=None)
		await assert.rejects(depositOnOutcome(client, escalationGame, client.account.address, 4 as unknown as QuestionOutcome, reportBond))
		await assert.rejects(depositOnOutcome(client, escalationGame, client.account.address, 255 as unknown as QuestionOutcome, reportBond))
	})

	test('claimDepositForWinning reverts when outcome is None', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, reportBond)
		await assert.rejects(
			writeContractAndWait(
				client,
				async () =>
					await client.writeContract({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						address: escalationGame,
						functionName: 'claimDepositForWinning',
						args: [0n, QuestionOutcome.None],
					}),
			),
		)
	})

	test('claimDepositForWinning reverts when outcome is out of enum range', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		await assert.rejects(
			writeContractAndWait(
				client,
				async () =>
					await client.writeContract({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						address: escalationGame,
						functionName: 'claimDepositForWinning',
						args: [0n, 4],
					}),
			),
		)
	})

	// =================== Attrition Cost Function Tests ===================

	test('computeIterativeAttritionCost: edge cases - time 0 and max time', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// At time 0, cost should equal startBond
		const costAt0 = await readIterativeAttritionCost(escalationGame, 0n)
		assert.strictEqual(costAt0, reportBond, 'cost at time 0 equals startBond')

		// At full time, cost should equal nonDecisionThreshold
		const costAtMax = await readIterativeAttritionCost(escalationGame, ESCALATION_TIME_LENGTH)
		assert.strictEqual(costAtMax, nonDecisionThreshold, 'cost at max time equals nonDecisionThreshold')
	})

	// Quantifies the maximum round‑trip error in seconds across the entire time range.
	test('Round‑trip error: max deviation ≤ 20 seconds', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const step = ESCALATION_TIME_LENGTH / 100n
		let maxError = 0n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = await readIterativeAttritionCost(escalationGame, t)
			const recoveredT = await readTimeSinceStartFromAttritionCost(escalationGame, cost)
			const error = t > recoveredT ? t - recoveredT : recoveredT - t
			if (error > maxError) maxError = error
		}

		// The binary search tolerance is 64 iterations → ~2^-64 precision on time
		// In practice, observed error ≤20 seconds
		assert.ok(maxError <= 20n, `max round‑trip error ${ maxError }s ≤ 20s`)
	})

	test('computeIterativeAttritionCost: monotonic increasing with loop', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const step = ESCALATION_TIME_LENGTH / 100n // test 101 points
		let previousCost = 0n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = await readIterativeAttritionCost(escalationGame, t)

			// Cost must always increase or stay same (should always increase for this function)
			assert.ok(cost >= previousCost, `cost at time ${ t } should be >= cost at time ${ t - step }`)

			// Cost must never exceed nonDecisionThreshold
			assert.ok(cost <= nonDecisionThreshold, `cost at time ${ t } should not exceed nonDecisionThreshold`)

			previousCost = cost
		}
	})

	test('computeIterativeAttritionCost: dense sampling for monotonicity', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const step = ESCALATION_TIME_LENGTH / 250n

		let lastCost = 0n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = await readIterativeAttritionCost(escalationGame, t)

			assert.ok(cost >= lastCost, `Monotonicity violated at time ${ t }: ${ lastCost } -> ${ cost }`)
			assert.ok(cost >= reportBond, `cost below startBond at time ${ t }`)
			assert.ok(cost <= nonDecisionThreshold, `cost above threshold at time ${ t }`)

			lastCost = cost
		}
	})

	test('computeTimeSinceStartFromAttritionCost: roundtrip accuracy with loop', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const step = ESCALATION_TIME_LENGTH / 50n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			// Get expected cost at this time
			const expectedCost = await readIterativeAttritionCost(escalationGame, t)

			// Compute time from this cost
			const recoveredTime = await readTimeSinceStartFromAttritionCost(escalationGame, expectedCost)

			// Allow some tolerance due to integer math and binary search termination
			const tolerance = 10n // maximum allowed deviation (in time units)
			const diff = t > recoveredTime ? t - recoveredTime : recoveredTime - t
			assert.ok(diff <= tolerance, `Roundtrip error for time ${ t }: recovered ${ recoveredTime }, diff ${ diff }`)
		}
	})

	test('computeTimeSinceStartFromAttritionCost: handles boundary conditions', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// Cost <= startBond should return 0
		const timeFromLowCost = await readTimeSinceStartFromAttritionCost(escalationGame, reportBond)
		assert.strictEqual(timeFromLowCost, 0n, 'startBond maps to time 0')

		// Cost >= nonDecisionThreshold should return escalationTimeLength
		const timeFromHighCost = await readTimeSinceStartFromAttritionCost(escalationGame, nonDecisionThreshold)
		assert.strictEqual(timeFromHighCost, ESCALATION_TIME_LENGTH, 'threshold maps to max time')
	})

	test('totalCost: returns 0 before game starts and nonDecisionThreshold after timeout', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// totalCost before game starts (startingTime is 3 days in future) returns 0
		const costBeforeStart = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'totalCost',
			address: escalationGame,
			args: [],
		})
		assert.strictEqual(costBeforeStart, 0n, 'totalCost returns 0 before game starts')

		// Advance time past the escalation period to test after-timeout behavior
		const startTime = await getStartingTime(client, escalationGame)
		await mockWindow.setTime(startTime + ESCALATION_TIME_LENGTH + 1n)
		const costAfterTimeout = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'totalCost',
			address: escalationGame,
			args: [],
		})
		assert.strictEqual(costAfterTimeout, nonDecisionThreshold, 'totalCost returns nonDecisionThreshold after timeout')
	})

	// =================== Inverse Relationship Tests ===================

	test('computeTimeSinceStartFromAttritionCost and computeIterativeAttritionCost are inverses', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// Test a dense grid of time values
		const step = ESCALATION_TIME_LENGTH / 50n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			// Compute cost at time t
			const cost = await readIterativeAttritionCost(escalationGame, t)

			// Recover time from that cost
			const recoveredT = await readTimeSinceStartFromAttritionCost(escalationGame, cost)

			// The recovered time should be within a small tolerance of original
			// Due to binary search termination and fixed-point errors
			const maxError = 20n // allow up to 20 time units error
			const error = t > recoveredT ? t - recoveredT : recoveredT - t
			assert.ok(error <= maxError, `Inverse error at t=${ t }: cost=${ cost }, recoveredT=${ recoveredT }, error=${ error }`)
		}
	})

	test('computeTimeSinceStartFromAttritionCost: monotonic increasing with cost', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const step = ESCALATION_TIME_LENGTH / 50n

		const costs: bigint[] = []
		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = await readIterativeAttritionCost(escalationGame, t)
			costs.push(cost)
		}

		// Ensure costs are non-decreasing
		for (let i = 1; i < costs.length; i++) {
			const prev = costs[i - 1]
			const curr = costs[i]
			if (prev === undefined || curr === undefined) {
				throw new Error(`costs array element is undefined at index ${ i }`)
			}
			assert.ok(curr >= prev, `Costs should be non-decreasing: ${ prev } vs ${ curr }`)
		}

		// Verify recovered times also non-decreasing
		let prevRecoveredT = 0n
		for (let i = 0; i < costs.length; i++) {
			const cost = costs[i]
			if (cost === undefined) {
				throw new Error(`costs array element is undefined at index ${ i }`)
			}
			const recoveredT = await readTimeSinceStartFromAttritionCost(escalationGame, cost)

			assert.ok(recoveredT >= prevRecoveredT, `Recovered time should be non-decreasing with cost: ${ prevRecoveredT } -> ${ recoveredT }`)
			prevRecoveredT = recoveredT
		}
	})

	test('computeTimeSinceStartFromAttritionCost: handles intermediate costs correctly', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// Pick some intermediate cost values between startBond and nonDecisionThreshold
		// Use linear spacing to sample the exponential curve evenly
		const numSamples = 20n

		for (let i = 1n; i < numSamples; i++) {
			// Generate a target cost that's between startBond and threshold
			// Using linear interpolation for test simplicity
			const fraction = (i * 10000n) / numSamples // 0 to 10000 (basis points)
			const targetCost = reportBond + ((nonDecisionThreshold - reportBond) * fraction) / 10000n

			// Get the time for this cost
			const recoveredT = await readTimeSinceStartFromAttritionCost(escalationGame, targetCost)

			// Recovered time should be within [0, ESCALATION_TIME_LENGTH]
			assert.ok(recoveredT <= ESCALATION_TIME_LENGTH, `Recovered time ${ recoveredT } <= max`)

			// Compute the expected cost at recoveredT and ensure it's close to targetCost
			const computedCost = await readIterativeAttritionCost(escalationGame, recoveredT)

			// The computed cost should be close to targetCost (within 5% for on-chain precision)
			const absError = computedCost > targetCost ? computedCost - targetCost : targetCost - computedCost
			const relErrorBps = (absError * 10000n) / nonDecisionThreshold // in basis points
			assert.ok(
				relErrorBps <= 500n, // 5% tolerance
				`Cost mismatch for fraction ${ fraction / 10000n }: target=${ targetCost }, got=${ computedCost }, relError=${ relErrorBps / 10000n }`,
			)
		}
	})

	test('depositOnOutcome prevents tie by refunding 1 wei', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const depositAmount = 100n * reportBond
		// Deposit on Yes to establish a leader
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, depositAmount)
		// Deposit same amount on Invalid; would tie, but fix reduces by 1 wei
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Invalid, depositAmount)
		const balances = await getBalances(client, escalationGame)
		assert.strictEqual(balances.yes, depositAmount, 'Yes balance as leader')
		assert.strictEqual(balances.invalid, depositAmount - 1n, 'Invalid balance reduced by 1 wei')
		assert.strictEqual(balances.no, 0n, 'No balance remains zero')
		// Advance time past game end
		const startTime = await getStartingTime(client, escalationGame)
		await mockWindow.setTime(startTime + ESCALATION_TIME_LENGTH + 1n)
		const resolution = await getQuestionResolution(client, escalationGame)
		assert.strictEqual(resolution, QuestionOutcome.Yes, 'Winner should be Yes')
	})

	test('deposit on leading outcome does not trigger tie-breaking adjustment', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const amount1 = 100n * reportBond
		const amount2 = 50n * reportBond
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, amount1)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, amount2)
		const balances = await getBalances(client, escalationGame)
		assert.strictEqual(balances.yes, amount1 + amount2, 'Yes balance increased without adjustment')
		assert.strictEqual(balances.invalid, 0n, 'Invalid balance zero')
		assert.strictEqual(balances.no, 0n, 'No balance zero')
		// Advance time past game end
		const startTime = await getStartingTime(client, escalationGame)
		await mockWindow.setTime(startTime + ESCALATION_TIME_LENGTH + 1n)
		const resolution = await getQuestionResolution(client, escalationGame)
		assert.strictEqual(resolution, QuestionOutcome.Yes, 'Resolution should be Yes')
	})
})
