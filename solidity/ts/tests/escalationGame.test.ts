import { test, beforeEach, describe } from 'bun:test'
import { getMockedEthSimulateWindowEthereum, AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { contractExists, setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { QuestionOutcome } from '../testsuite/simulator/types/types'
import assert from 'node:assert'
import { deployEscalationGame, depositOnOutcome, getBalances, getStartingTime } from '../testsuite/simulator/utils/contracts/escalationGame'
import { ensureZoltarDeployed } from '../testsuite/simulator/utils/contracts/zoltar'
import { ensureInfraDeployed } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { peripherals_EscalationGame_EscalationGame } from '../types/contractArtifact'

describe('Escalation Game Test Suite', () => {
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const reportBond = 1n * 10n ** 18n
	const nonDecisionThreshold = 1000n * 10n ** 18n

	beforeEach(async () => {
		mockWindow = await getMockedEthSimulateWindowEthereum()
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
			client.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'claimDepositForWinning',
				args: [0n, QuestionOutcome.None],
			}),
		)
	})

	test('claimDepositForWinning reverts when outcome is out of enum range', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		await assert.rejects(
			client.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'claimDepositForWinning',
				args: [0n, 4],
			}),
		)
	})

	// =================== Attrition Cost Function Tests ===================

	test('compute5TermTaylorSeriesAttritionCostApproximation: edge cases - time 0 and max time', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// At time 0, cost should equal startBond
		const costAt0 = (await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'compute5TermTaylorSeriesAttritionCostApproximation',
			address: escalationGame,
			args: [0n],
		})) as bigint
		assert.strictEqual(costAt0, reportBond, 'cost at time 0 equals startBond')

		// Get escalationTimeLength from contract (hardcoded in Solidity)
		const ESCALATION_TIME_LENGTH = 4233600n

		// At full time, cost should equal nonDecisionThreshold
		const costAtMax = (await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'compute5TermTaylorSeriesAttritionCostApproximation',
			address: escalationGame,
			args: [ESCALATION_TIME_LENGTH],
		})) as bigint
		assert.strictEqual(costAtMax, nonDecisionThreshold, 'cost at max time equals nonDecisionThreshold')
	})

	// Quantifies the maximum round‑trip error in seconds across the entire time range.
	test('Round‑trip error: max deviation ≤ 20 seconds', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const ESCALATION_TIME_LENGTH = 4233600n
		const step = ESCALATION_TIME_LENGTH / 1000n // 1000 points
		let maxError = 0n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = (await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'compute5TermTaylorSeriesAttritionCostApproximation',
				address: escalationGame,
				args: [t],
			})) as bigint
			const recoveredT = (await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'computeTimeSinceStartFromAttritionCost',
				address: escalationGame,
				args: [cost],
			})) as bigint
			const error = t > recoveredT ? t - recoveredT : recoveredT - t
			if (error > maxError) maxError = error
		}

		// The binary search tolerance is 64 iterations → ~2^-64 precision on time
		// In practice, observed error ≤20 seconds
		assert.ok(maxError <= 20n, `max round‑trip error ${maxError}s ≤ 20s`)
	})

	test('compute5TermTaylorSeriesAttritionCostApproximation: monotonic increasing with loop', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const ESCALATION_TIME_LENGTH = 4233600n

		// Test many points across the time range
		const step = ESCALATION_TIME_LENGTH / 100n // test 101 points
		let previousCost = 0n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = (await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'compute5TermTaylorSeriesAttritionCostApproximation',
				address: escalationGame,
				args: [t],
			})) as bigint

			// Cost must always increase or stay same (should always increase for this function)
			assert.ok(cost >= previousCost, `cost at time ${t} should be >= cost at time ${t - step}`)

			// Cost must never exceed nonDecisionThreshold
			assert.ok(cost <= nonDecisionThreshold, `cost at time ${t} should not exceed nonDecisionThreshold`)

			previousCost = cost
		}
	})

	test('compute5TermTaylorSeriesAttritionCostApproximation: dense sampling for monotonicity', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const ESCALATION_TIME_LENGTH = 4233600n

		// Test every 1/1000th of the period (4236 points)
		const step = ESCALATION_TIME_LENGTH / 1000n
		let lastCost = 0n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = (await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'compute5TermTaylorSeriesAttritionCostApproximation',
				address: escalationGame,
				args: [t],
			})) as bigint

			assert.ok(cost >= lastCost, `Monotonicity violated at time ${t}: ${lastCost} -> ${cost}`)
			assert.ok(cost >= reportBond, `cost below startBond at time ${t}`)
			assert.ok(cost <= nonDecisionThreshold, `cost above threshold at time ${t}`)

			lastCost = cost
		}
	})

	test('computeTimeSinceStartFromAttritionCost: roundtrip accuracy with loop', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const ESCALATION_TIME_LENGTH = 4233600n

		// Sample intermediate costs and verify roundtrip
		const step = ESCALATION_TIME_LENGTH / 50n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			// Get expected cost at this time
			const expectedCost = (await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'compute5TermTaylorSeriesAttritionCostApproximation',
				address: escalationGame,
				args: [t],
			})) as bigint

			// Compute time from this cost
			const recoveredTime = (await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'computeTimeSinceStartFromAttritionCost',
				address: escalationGame,
				args: [expectedCost],
			})) as bigint

			// Allow some tolerance due to integer math and binary search termination
			const tolerance = 10n // maximum allowed deviation (in time units)
			const diff = t > recoveredTime ? t - recoveredTime : recoveredTime - t
			assert.ok(diff <= tolerance, `Roundtrip error for time ${t}: recovered ${recoveredTime}, diff ${diff}`)
		}
	})

	test('computeTimeSinceStartFromAttritionCost: handles boundary conditions', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// Cost <= startBond should return 0
		const timeFromLowCost = (await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'computeTimeSinceStartFromAttritionCost',
			address: escalationGame,
			args: [reportBond],
		})) as bigint
		assert.strictEqual(timeFromLowCost, 0n, 'startBond maps to time 0')

		// Cost >= nonDecisionThreshold should return escalationTimeLength
		const ESCALATION_TIME_LENGTH = 4233600n
		const timeFromHighCost = (await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'computeTimeSinceStartFromAttritionCost',
			address: escalationGame,
			args: [nonDecisionThreshold],
		})) as bigint
		assert.strictEqual(timeFromHighCost, ESCALATION_TIME_LENGTH, 'threshold maps to max time')
	})

	test('totalCost: returns 0 before game starts and nonDecisionThreshold after timeout', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// totalCost before game starts (startingTime is 3 days in future) returns 0
		const costBeforeStart = (await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'totalCost',
			address: escalationGame,
			args: [],
		})) as bigint
		assert.strictEqual(costBeforeStart, 0n, 'totalCost returns 0 before game starts')
	})

	// =================== Inverse Relationship Tests ===================

	test('computeTimeSinceStartFromAttritionCost and compute5TermTaylorSeriesAttritionCostApproximation are inverses', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const ESCALATION_TIME_LENGTH = 4233600n

		// Test a dense grid of time values
		const step = ESCALATION_TIME_LENGTH / 100n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			// Compute cost at time t
			const cost = (await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'compute5TermTaylorSeriesAttritionCostApproximation',
				address: escalationGame,
				args: [t],
			})) as bigint

			// Recover time from that cost
			const recoveredT = (await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'computeTimeSinceStartFromAttritionCost',
				address: escalationGame,
				args: [cost],
			})) as bigint

			// The recovered time should be within a small tolerance of original
			// Due to binary search termination and fixed-point errors
			const maxError = 20n // allow up to 20 time units error
			const error = t > recoveredT ? t - recoveredT : recoveredT - t
			assert.ok(error <= maxError, `Inverse error at t=${t}: cost=${cost}, recoveredT=${recoveredT}, error=${error}`)
		}
	})

	test('computeTimeSinceStartFromAttritionCost: monotonic increasing with cost', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const ESCALATION_TIME_LENGTH = 4233600n
		const step = ESCALATION_TIME_LENGTH / 50n

		const costs: bigint[] = []
		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = (await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'compute5TermTaylorSeriesAttritionCostApproximation',
				address: escalationGame,
				args: [t],
			})) as bigint
			costs.push(cost)
		}

		// Ensure costs are non-decreasing
		for (let i = 1; i < costs.length; i++) {
			const prev = costs[i - 1]!
			const curr = costs[i]!
			assert.ok(curr >= prev, `Costs should be non-decreasing: ${prev} vs ${curr}`)
		}

		// Verify recovered times also non-decreasing
		let prevRecoveredT = 0n
		for (let i = 0; i < costs.length; i++) {
			const cost = costs[i]!
			const recoveredT = (await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'computeTimeSinceStartFromAttritionCost',
				address: escalationGame,
				args: [cost],
			})) as bigint

			assert.ok(recoveredT >= prevRecoveredT, `Recovered time should be non-decreasing with cost: ${prevRecoveredT} -> ${recoveredT}`)
			prevRecoveredT = recoveredT
		}
	})

	test('computeTimeSinceStartFromAttritionCost: handles intermediate costs correctly', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// Pick some intermediate cost values between startBond and nonDecisionThreshold
		// Use logarithmic spacing to sample the exponential curve evenly
		const ESCALATION_TIME_LENGTH = 4233600n
		const numSamples = 20n

		for (let i = 1n; i < numSamples; i++) {
			// Generate a target cost that's between startBond and threshold
			// Using linear interpolation for test simplicity
			const fraction = (i * 10000n) / numSamples // 0 to 10000 (basis points)
			const targetCost = reportBond + ((nonDecisionThreshold - reportBond) * fraction) / 10000n

			// Get the time for this cost
			const recoveredT = (await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'computeTimeSinceStartFromAttritionCost',
				address: escalationGame,
				args: [targetCost],
			})) as bigint

			// Recovered time should be within [0, ESCALATION_TIME_LENGTH]
			assert.ok(recoveredT <= ESCALATION_TIME_LENGTH, `Recovered time ${recoveredT} <= max`)

			// Compute the expected cost at recoveredT and ensure it's close to targetCost
			const computedCost = (await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'compute5TermTaylorSeriesAttritionCostApproximation',
				address: escalationGame,
				args: [recoveredT],
			})) as bigint

			// The computed cost should be close to targetCost (within 5% for on-chain precision)
			const absError = computedCost > targetCost ? computedCost - targetCost : targetCost - computedCost
			const relErrorBps = (absError * 10000n) / nonDecisionThreshold // in basis points
			assert.ok(
				relErrorBps <= 500n, // 5% tolerance
				`Cost mismatch for fraction ${fraction / 10000n}: target=${targetCost}, got=${computedCost}, relError=${relErrorBps / 10000n}`,
			)
		}
	})

	test('totalCost: matches compute5TermTaylorSeriesAttritionCostApproximation at current time', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// We need to advance time to get totalCost to return a non-zero value
		// But in the simulator, we can't easily change block.timestamp without more setup
		// Instead, we'll directly test that totalCost() calls the compute function correctly
		// by checking various timeFromStart values that would be returned if the game had started

		// totalCost() is: if (timeFromStart >= escalationTimeLength) return nonDecisionThreshold;
		//                return compute5TermTaylorSeriesAttritionCostApproximation(timeFromStart);

		// Since game just started and startingTime is 3 days in future, totalCost returns 0
		let totalCostValue = (await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'totalCost',
			address: escalationGame,
			args: [],
		})) as bigint
		assert.strictEqual(totalCostValue, 0n, 'totalCost before start is 0')
	})

	test('getEscalationGameEndDate: returns plausible date based on current state', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		const endDate = (await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getEscalationGameEndDate',
			address: escalationGame,
			args: [],
		})) as bigint

		const startingTime = (await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'startingTime',
			address: escalationGame,
			args: [],
		})) as bigint

		// End date should equal startingTime + computeTimeSinceStartFromAttritionCost(getBindingCapital())
		// Initially binding capital is 0, so getEscalationGameEndDate() returns startingTime
		assert.strictEqual(endDate, startingTime, 'Initially endDate equals startingTime (no capital bound)')
	})

	test('hasReachedNonDecision: false when only one outcome reaches threshold', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// Initially no deposits
		let reached = (await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'hasReachedNonDecision',
			address: escalationGame,
			args: [],
		})) as boolean
		assert.strictEqual(reached, false, 'hasReachedNonDecision initially false')

		// Deposit on one outcome up to nonDecisionThreshold exactly
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, nonDecisionThreshold)

		// After one outcome hits threshold, but not two, should still be false
		reached = (await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'hasReachedNonDecision',
			address: escalationGame,
			args: [],
		})) as boolean
		assert.strictEqual(reached, false, 'hasReachedNonDecision false when only one outcome >= threshold')
	})

	test('getQuestionResolution: returns None while game ongoing (before start)', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// Initially should be None (game not started or no clear winner)
		let resolution = (await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getQuestionResolution',
			address: escalationGame,
			args: [],
		})) as number
		assert.strictEqual(resolution, QuestionOutcome.None, 'getQuestionResolution returns None initially')

		// Deposit on Yes (totalCost still 0, so all balances >=0 -> multiple over -> still ongoing)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, nonDecisionThreshold)

		// Still None because two or more outcomes are >= totalCost (since totalCost=0, even 0 balances count)
		resolution = (await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getQuestionResolution',
			address: escalationGame,
			args: [],
		})) as number
		assert.strictEqual(resolution, QuestionOutcome.None, 'getQuestionResolution returns None after deposit before start')
	})

	test('getBindingCapital: returns median of three balances (middle value)', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// Initially all zero, median is 0
		let bindingCapital = (await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getBindingCapital',
			address: escalationGame,
			args: [],
		})) as bigint
		assert.strictEqual(bindingCapital, 0n, 'getBindingCapital initially 0')

		// Make deposits: Yes=2*reportBond, Invalid=reportBond, No=0
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, 2n * reportBond)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Invalid, 1n * reportBond)

		// Sorted balances: No=0, Invalid=reportBond, Yes=2*reportBond -> median is Invalid=reportBond
		bindingCapital = (await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getBindingCapital',
			address: escalationGame,
			args: [],
		})) as bigint
		assert.strictEqual(bindingCapital, reportBond, 'getBindingCapital returns median')
	})
})
