import { describe, expect, test } from 'bun:test'
import { statoblast_SecurityPoolPortfolioVault_SecurityPoolPortfolioVault as vaultArtifact, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { createCompleteSet, getSecurityVault, getSettlementCollateralAttoEth } from '../../testSupport/simulator/utils/contracts/securityPool'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { emptyOperations, unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: adversarial portfolio allocation economics', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const policy = async () => await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationPolicy' })
	const version = async () => await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationPolicyVersion' })
	const nonce = async () => await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationPolicyNonce' })
	const idle = async () => await getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), fixture.vault)
	const config = () => ({ universeId: fixture.base.genesisUniverse, executor: fixture.other().account.address, expiresAt: fixture.base.questionData.endTime - 1n, depositBudgetAttoRep: 2_000n * unit, commitmentIncreaseBudgetAttoEth: 200n * unit, minimumIdleAttoRep: 100n * unit, minimumHealthFactorBps: 12_000n })
	const questions = () => [fixture.base.questionId, fixture.secondQuestionId]
	const rules = () => questions().map(questionId => ({ questionId, depositBudgetAttoRep: 2_000n * unit, maximumCommitmentAttoEth: 200n * unit }))
	const install = async (configuration = config(), limits = rules()) => {
		const observedVersion = await version()
		const observedNonce = await nonce()
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'setAllocationPolicy', args: [observedVersion, observedNonce, configuration, limits] }))
	}
	const allocate = async (question: bigint, deposit: bigint, commitment: bigint, expectedNonce?: bigint) => {
		const observedVersion = await version()
		const observedNonce = expectedNonce ?? (await nonce())
		return await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'executeAllocation', args: [observedVersion, observedNonce, question, deposit, commitment] }))
	}
	const prepare = async (balance = 2_100n * unit) => {
		await fixture.transferRep(fixture.vault, balance)
		await fixture.refreshPrices(questions())
	}

	const scenarios = [
		{ name: 'aggregate deposit budget', seed: 7n, idle: 10_000n, deposit: 1_000n, commitment: 1_000n, perDeposit: 1_000n, perCommitment: 1_000n },
		{ name: 'aggregate commitment budget', seed: 41n, idle: 10_000n, deposit: 5_000n, commitment: 75n, perDeposit: 3_000n, perCommitment: 100n },
		{ name: 'per-question concentration', seed: 2026n, idle: 10_000n, deposit: 5_000n, commitment: 1_000n, perDeposit: 900n, perCommitment: 30n },
		{ name: 'shared idle reserve', seed: 99n, idle: 1_400n, deposit: 5_000n, commitment: 1_000n, perDeposit: 5_000n, perCommitment: 1_000n },
	]
	for (const scenario of scenarios) {
		test(`interleaved allocations preserve assets and authority when limited by ${scenario.name}`, async () => {
			await prepare(scenario.idle * unit)
			const reserve = 200n * unit
			await install(
				{ ...config(), depositBudgetAttoRep: scenario.deposit * unit, commitmentIncreaseBudgetAttoEth: scenario.commitment * unit, minimumIdleAttoRep: reserve },
				rules().map(rule => ({ ...rule, depositBudgetAttoRep: scenario.perDeposit * unit, maximumCommitmentAttoEth: scenario.perCommitment * unit })),
			)
			const ledger = await Promise.all(questions().map(async questionId => ({ questionId, backing: 0n, commitment: 0n, minimumBacking: await fixture.owner().readContract({ abi: poolArtifact.abi, address: fixture.poolFor(questionId).securityPool, functionName: 'minimumVaultRepDepositAttoRep' }) })))
			let random = scenario.seed
			let funded = scenario.idle * unit
			let spent = 0n
			let committed = 0n
			let successes = 0n
			let failures = 0
			for (let step = 0; step < 18; step++) {
				random = (random * 1_664_525n + 1_013_904_223n) % (1n << 32n)
				const position = ledger[Number((random >> 8n) % 2n)]
				if (position === undefined) throw new Error('Missing model question')
				const deposit = (1n + ((random >> 16n) % 4n)) * 100n * unit
				const increase = deposit / 10n
				const allowed =
					position.backing + deposit >= position.minimumBacking &&
					spent + deposit <= scenario.deposit * unit &&
					committed + increase <= scenario.commitment * unit &&
					position.backing + deposit <= scenario.perDeposit * unit &&
					position.commitment + increase <= scenario.perCommitment * unit &&
					funded - spent - deposit >= reserve
				if (allowed) {
					await allocate(position.questionId, deposit, position.commitment + increase, successes)
					position.backing += deposit
					position.commitment += increase
					spent += deposit
					committed += increase
					successes++
					// Replaying the consumed nonce cannot spend authority on either question.
					await expect(allocate(questions()[step % 2] ?? fixture.base.questionId, 100n * unit, 0n, successes - 1n)).rejects.toThrow('Allocation authorization changed')
				} else {
					await expect(allocate(position.questionId, deposit, position.commitment + increase, successes)).rejects.toThrow()
					failures++
				}
				if (step === 7) {
					// Incoming funds restore liquidity, never previously spent authorization.
					await fixture.transferRep(fixture.vault, 300n * unit, fixture.other())
					funded += 300n * unit
				}
				for (const expected of ledger) {
					const pool = fixture.poolFor(expected.questionId).securityPool
					expect(await fixture.repClaim(pool)).toBe(expected.backing)
					expect((await getSecurityVault(fixture.owner(), pool, fixture.vault)).underwritingLimitAttoEth).toBe(expected.commitment)
					const limit = await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationLimits', args: [expected.questionId] })
					expect(limit[4]).toBe(expected.backing)
				}
				expect(await idle()).toBe(funded - spent)
				expect(await idle()).toBeGreaterThanOrEqual(reserve)
				expect((await policy()).slice(2)).toEqual([spent, committed])
				expect(await nonce()).toBe(successes)
				expect(await version()).toBe(1n)
			}
			expect(successes).toBeGreaterThan(0n)
			expect(failures).toBeGreaterThan(0)
			const first = ledger[0]
			if (first === undefined) throw new Error('Missing first model question')
			let deposit = 0n
			let target = first.commitment
			let reason: string
			switch (scenario.name) {
				case 'aggregate deposit budget':
					deposit = scenario.deposit * unit - spent + 1n
					reason = 'Policy deposit budget exceeded'
					break
				case 'aggregate commitment budget':
					target += scenario.commitment * unit - committed + 1n
					reason = 'Policy commitment budget exceeded'
					break
				case 'per-question concentration':
					target = scenario.perCommitment * unit + 1n
					reason = 'Question commitment cap exceeded'
					break
				case 'shared idle reserve':
					deposit = funded - spent - reserve + 1n
					reason = 'Policy idle reserve violated'
					break
				default:
					throw new Error('Unknown economic constraint')
			}
			await expect(allocate(first.questionId, deposit, target, successes)).rejects.toThrow(reason)
			expect((await policy()).slice(2)).toEqual([spent, committed])
			expect(await idle()).toBe(funded - spent)
			expect(await nonce()).toBe(successes)
		})
	}

	for (const first of [0, 1]) {
		test(`executor may concentrate the entire shared budget in approved question ${first + 1}`, async () => {
			await prepare()
			await install({ ...config(), depositBudgetAttoRep: 1_000n * unit, commitmentIncreaseBudgetAttoEth: 100n * unit })
			const chosen = questions()[first]
			const neglected = questions()[1 - first]
			if (chosen === undefined || neglected === undefined) throw new Error('Missing concentration questions')
			await allocate(chosen, 1_000n * unit, 100n * unit)
			await expect(allocate(neglected, 100n * unit, 10n * unit)).rejects.toThrow('Policy deposit budget exceeded')
			expect(await fixture.repClaim(fixture.poolFor(chosen).securityPool)).toBe(1_000n * unit)
			expect(await fixture.repClaim(fixture.poolFor(neglected).securityPool)).toBe(0n)
			expect(await idle()).toBe(1_100n * unit)
		})
	}

	test('a new policy increase budget does not erase or cap pre-existing commitments in other questions', async () => {
		await fixture.allocate(fixture.base.questionId)
		await prepare(1_100n * unit)
		await install({ ...config(), depositBudgetAttoRep: 1_000n * unit, commitmentIncreaseBudgetAttoEth: 100n * unit })
		await allocate(fixture.secondQuestionId, 1_000n * unit, 100n * unit)
		let totalCommitment = 0n
		for (const question of questions()) {
			totalCommitment += (await getSecurityVault(fixture.owner(), fixture.poolFor(question).securityPool, fixture.vault)).underwritingLimitAttoEth
			expect(await fixture.repClaim(fixture.poolFor(question).securityPool)).toBe(1_000n * unit)
		}
		expect(totalCommitment).toBe(200n * unit)
		expect((await policy())[3]).toBe(100n * unit)
		expect(await idle()).toBe(100n * unit)
	})

	test('deposit authority permits non-earning backing and does not guarantee executor participation', async () => {
		await prepare()
		await install()
		await allocate(fixture.base.questionId, 1_000n * unit, 0n)
		const position = await getSecurityVault(fixture.owner(), fixture.base.securityPoolAddresses.securityPool, fixture.vault)
		expect(position.underwritingLimitAttoEth).toBe(0n)
		expect(position.claimableFeesAttoEth).toBe(0n)
		expect((await policy()).slice(2)).toEqual([1_000n * unit, 0n])
		expect(await fixture.repClaim(fixture.poolFor(fixture.secondQuestionId).securityPool)).toBe(0n)
		await fixture.submit(fixture.base.questionId, { ...emptyOperations(), withdrawAttoRep: 1_000n * unit })
		expect(await idle()).toBe(2_100n * unit)
		expect(await version()).toBe(2n)
	})

	test('the exact policy expiry blocks further questions without releasing existing obligations', async () => {
		await prepare()
		const expiresAt = (await fixture.base.mockWindow.getTime()) + 30n
		await install({ ...config(), expiresAt })
		// Simulator transactions advance one second, so these execute at expiry - 1 and expiry.
		await fixture.base.mockWindow.setTime(expiresAt - 2n)
		await allocate(fixture.base.questionId, 500n * unit, 50n * unit)
		expect((await fixture.owner().getBlock()).timestamp).toBe(expiresAt - 1n)
		const before = await policy()
		await expect(allocate(fixture.secondQuestionId, 500n * unit, 50n * unit)).rejects.toThrow('Policy expired')
		expect((await fixture.owner().getBlock()).timestamp).toBe(expiresAt)
		expect(await policy()).toEqual(before)
		expect(await nonce()).toBe(1n)
		expect(await idle()).toBe(1_600n * unit)
		expect((await getSecurityVault(fixture.owner(), fixture.base.securityPoolAddresses.securityPool, fixture.vault)).underwritingLimitAttoEth).toBe(50n * unit)
	})

	test('question end closes only its allocation window; a future-start sibling remains explicitly allocatable', async () => {
		await fixture.transferRep(fixture.vault, 2_100n * unit)
		await install({ ...config(), expiresAt: fixture.secondEndTime })
		const duration = await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: fixture.base.securityPoolAddresses.openOraclePriceCoordinator, functionName: 'settlementTime' })
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime - duration - 30n)
		await fixture.refreshPrices(questions())
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime - 2n)
		await allocate(fixture.base.questionId, 1_000n * unit, 100n * unit)
		expect((await fixture.owner().getBlock()).timestamp).toBe(fixture.base.questionData.endTime - 1n)
		await expect(allocate(fixture.base.questionId, 100n * unit, 100n * unit)).rejects.toThrow('Allocation question ended')
		expect((await fixture.owner().getBlock()).timestamp).toBe(fixture.base.questionData.endTime)
		await allocate(fixture.secondQuestionId, 1_000n * unit, 100n * unit)
		for (const question of questions()) expect(await fixture.repClaim(fixture.poolFor(question).securityPool)).toBe(1_000n * unit)
		expect((await policy()).slice(2)).toEqual([2_000n * unit, 200n * unit])
		expect(await idle()).toBe(100n * unit)
	})

	test('an incumbent executor can transfer exit burden within an approved question but cannot trap the sibling balance', async () => {
		const incumbent = await fixture.createVault(fixture.other())
		await fixture.allocate(fixture.base.questionId, 1_000n * unit, 100n * unit, fixture.other(), incumbent)
		await fixture.allocate(fixture.secondQuestionId, 500n * unit, 0n)
		await createCompleteSet(fixture.owner(), fixture.base.securityPoolAddresses.securityPool, 100n * unit)
		await prepare(1_100n * unit)
		await install({ ...config(), depositBudgetAttoRep: 1_000n * unit, commitmentIncreaseBudgetAttoEth: 100n * unit })
		await expect(fixture.submit(fixture.base.questionId, { ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 0n, withdrawAttoRep: 1_000n * unit }, { sender: fixture.other(), vault: incumbent })).rejects.toThrow('Commitments below collateral')
		await allocate(fixture.base.questionId, 1_000n * unit, 100n * unit)
		await fixture.submit(fixture.base.questionId, { ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 0n, withdrawAttoRep: 1_000n * unit }, { sender: fixture.other(), vault: incumbent })
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool, incumbent)).toBe(0n)
		expect(await getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), incumbent)).toBe(1_000n * unit)
		await expect(fixture.submit(fixture.base.questionId, { ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 0n, withdrawAttoRep: 1_000n * unit })).rejects.toThrow('Commitments below collateral')
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(1_000n * unit)
		expect(await getSettlementCollateralAttoEth(fixture.owner(), fixture.base.securityPoolAddresses.securityPool)).toBeGreaterThan(0n)
		await fixture.submit(fixture.secondQuestionId, { ...emptyOperations(), withdrawAttoRep: 500n * unit })
		expect(await idle()).toBe(600n * unit)
		expect(await fixture.repClaim(fixture.poolFor(fixture.secondQuestionId).securityPool)).toBe(0n)
		expect((await getSecurityVault(fixture.owner(), fixture.base.securityPoolAddresses.securityPool, fixture.vault)).underwritingLimitAttoEth).toBe(100n * unit)
	})
})
