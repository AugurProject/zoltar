import assert from '../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import type { WriteClient } from '../../testSupport/simulator/utils/clients'
import { deployEscalationGame, getActivationTime, readIterativeAttritionCost, readTimeSinceStartFromAttritionCost } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { statoblast_EscalationGame_EscalationGame } from '../../types/contractArtifact'
import { ESCALATION_TIME_LENGTH } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'

describe('Escalation Game: attrition math', () => {
	const fixture = useEscalationGameFixture()
	const { reportBond, nonDecisionThresholdAttoRep } = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
	})

	test('computeIterativeAttritionCostAttoRep: edge cases - time 0 and max time', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)

		// At time 0, cost should equal startBondAttoRep
		const costAt0 = await readIterativeAttritionCost(client, escalationGame, 0n)
		assert.strictEqual(costAt0, reportBond, 'cost at time 0 equals startBondAttoRep')

		// At full time, cost should equal nonDecisionThresholdAttoRep
		const costAtMax = await readIterativeAttritionCost(client, escalationGame, ESCALATION_TIME_LENGTH)
		assert.strictEqual(costAtMax, nonDecisionThresholdAttoRep, 'cost at max time equals nonDecisionThresholdAttoRep')
	})

	// Quantifies the maximum round‑trip error in seconds across the entire time range.
	test('Round‑trip error: max deviation ≤ 20 seconds', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		const step = ESCALATION_TIME_LENGTH / 100n
		let maxError = 0n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = await readIterativeAttritionCost(client, escalationGame, t)
			const recoveredT = await readTimeSinceStartFromAttritionCost(client, escalationGame, cost)
			const error = t > recoveredT ? t - recoveredT : recoveredT - t
			if (error > maxError) maxError = error
		}

		// The binary search tolerance is 64 iterations → ~2^-64 precision on time
		// In practice, observed error ≤20 seconds
		assert.ok(maxError <= 20n, `max round‑trip error ${maxError}s ≤ 20s`)
	})

	test('computeIterativeAttritionCostAttoRep: monotonic increasing with loop', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		const step = ESCALATION_TIME_LENGTH / 100n // test 101 points
		let previousCost = 0n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = await readIterativeAttritionCost(client, escalationGame, t)

			// Cost must always increase or stay same (should always increase for this function)
			assert.ok(cost >= previousCost, `cost at time ${t} should be >= cost at time ${t - step}`)

			// Cost must never exceed nonDecisionThresholdAttoRep
			assert.ok(cost <= nonDecisionThresholdAttoRep, `cost at time ${t} should not exceed nonDecisionThresholdAttoRep`)

			previousCost = cost
		}
	})

	test('computeIterativeAttritionCostAttoRep: dense sampling for monotonicity', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		const step = ESCALATION_TIME_LENGTH / 250n

		let lastCost = 0n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = await readIterativeAttritionCost(client, escalationGame, t)

			assert.ok(cost >= lastCost, `Monotonicity violated at time ${t}: ${lastCost} -> ${cost}`)
			assert.ok(cost >= reportBond, `cost below startBondAttoRep at time ${t}`)
			assert.ok(cost <= nonDecisionThresholdAttoRep, `cost above threshold at time ${t}`)

			lastCost = cost
		}
	})

	test('computeTimeSinceStartFromAttritionCostAttoRep: roundtrip accuracy with loop', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		const step = ESCALATION_TIME_LENGTH / 50n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			// Get expected cost at this time
			const expectedCost = await readIterativeAttritionCost(client, escalationGame, t)

			// Compute time from this cost
			const recoveredTime = await readTimeSinceStartFromAttritionCost(client, escalationGame, expectedCost)

			// Allow some tolerance due to integer math and binary search termination
			const tolerance = 10n // maximum allowed deviation (in time units)
			const diff = t > recoveredTime ? t - recoveredTime : recoveredTime - t
			assert.ok(diff <= tolerance, `Roundtrip error for time ${t}: recovered ${recoveredTime}, diff ${diff}`)
		}
	})

	test('computeTimeSinceStartFromAttritionCostAttoRep: handles boundary conditions', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)

		// Cost <= startBondAttoRep should return 0
		const timeFromLowCost = await readTimeSinceStartFromAttritionCost(client, escalationGame, reportBond)
		assert.strictEqual(timeFromLowCost, 0n, 'startBondAttoRep maps to time 0')

		// Cost >= nonDecisionThresholdAttoRep should return escalationTimeLength
		const timeFromHighCost = await readTimeSinceStartFromAttritionCost(client, escalationGame, nonDecisionThresholdAttoRep)
		assert.strictEqual(timeFromHighCost, ESCALATION_TIME_LENGTH, 'threshold maps to max time')
	})

	test('totalCostAttoRep: returns 0 before game starts and nonDecisionThresholdAttoRep after timeout', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)

		// totalCostAttoRep before activationTime (3 days in the future) returns 0
		const costBeforeStart = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'totalCostAttoRep',
			address: escalationGame,
			args: [],
		})
		assert.strictEqual(costBeforeStart, 0n, 'totalCostAttoRep returns 0 before game starts')

		// Advance time past the escalation period to test after-timeout behavior
		const activationTime = await getActivationTime(client, escalationGame)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		const costAfterTimeout = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'totalCostAttoRep',
			address: escalationGame,
			args: [],
		})
		assert.strictEqual(costAfterTimeout, nonDecisionThresholdAttoRep, 'totalCostAttoRep returns nonDecisionThresholdAttoRep after timeout')
	})

	// =================== Inverse Relationship Tests ===================

	test('computeTimeSinceStartFromAttritionCostAttoRep and computeIterativeAttritionCostAttoRep are inverses', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)

		// Test a dense grid of time values
		const step = ESCALATION_TIME_LENGTH / 50n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			// Compute cost at time t
			const cost = await readIterativeAttritionCost(client, escalationGame, t)

			// Recover time from that cost
			const recoveredT = await readTimeSinceStartFromAttritionCost(client, escalationGame, cost)

			// The recovered time should be within a small tolerance of original
			// Due to binary search termination and fixed-point errors
			const maxError = 20n // allow up to 20 time units error
			const error = t > recoveredT ? t - recoveredT : recoveredT - t
			assert.ok(error <= maxError, `Inverse error at t=${t}: cost=${cost}, recoveredT=${recoveredT}, error=${error}`)
		}
	})

	test('computeTimeSinceStartFromAttritionCostAttoRep: monotonic increasing with cost', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		const step = ESCALATION_TIME_LENGTH / 50n

		const costs: bigint[] = []
		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = await readIterativeAttritionCost(client, escalationGame, t)
			costs.push(cost)
		}

		// Ensure costs are non-decreasing
		for (let i = 1; i < costs.length; i++) {
			const prev = costs[i - 1]
			const curr = costs[i]
			if (prev === undefined || curr === undefined) throw new Error(`costs array element is undefined at index ${i}`)
			assert.ok(curr >= prev, `Costs should be non-decreasing: ${prev} vs ${curr}`)
		}

		// Verify recovered times also non-decreasing
		let prevRecoveredT = 0n
		for (let i = 0; i < costs.length; i++) {
			const cost = costs[i]
			if (cost === undefined) throw new Error(`costs array element is undefined at index ${i}`)
			const recoveredT = await readTimeSinceStartFromAttritionCost(client, escalationGame, cost)

			assert.ok(recoveredT >= prevRecoveredT, `Recovered time should be non-decreasing with cost: ${prevRecoveredT} -> ${recoveredT}`)
			prevRecoveredT = recoveredT
		}
	})

	test('computeTimeSinceStartFromAttritionCostAttoRep: handles intermediate costs correctly', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)

		// Pick some intermediate cost values between startBondAttoRep and nonDecisionThresholdAttoRep
		// Use linear spacing to sample the exponential curve evenly
		const numSamples = 20n

		for (let i = 1n; i < numSamples; i++) {
			// Generate a target cost that's between startBondAttoRep and threshold
			// Using linear interpolation for test simplicity
			const fraction = (i * 10000n) / numSamples // 0 to 10000 (basis points)
			const targetCost = reportBond + ((nonDecisionThresholdAttoRep - reportBond) * fraction) / 10000n

			// Get the time for this cost
			const recoveredT = await readTimeSinceStartFromAttritionCost(client, escalationGame, targetCost)

			// Recovered time should be within [0, ESCALATION_TIME_LENGTH]
			assert.ok(recoveredT <= ESCALATION_TIME_LENGTH, `Recovered time ${recoveredT} <= max`)

			// Compute the expected cost at recoveredT and ensure it's close to targetCost
			const computedCost = await readIterativeAttritionCost(client, escalationGame, recoveredT)

			// The computed cost should be close to targetCost (within 5% for on-chain precision)
			const absError = computedCost > targetCost ? computedCost - targetCost : targetCost - computedCost
			const relErrorBps = (absError * 10000n) / nonDecisionThresholdAttoRep // in basis points
			assert.ok(
				relErrorBps <= 500n, // 5% tolerance
				`Cost mismatch for fraction ${fraction / 10000n}: target=${targetCost}, got=${computedCost}, relError=${relErrorBps / 10000n}`,
			)
		}
	})
})
