import { beforeEach, describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, encodeAbiParameters, keccak256, type Address } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { deployContract } from '../../testSupport/deployContract'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { approveToken, getERC20Balance, setupTestAccounts, sortStringArrayByKeccak } from '../../testSupport/simulator/utils/utilities'
import { addRepToMigrationBalance, ensureZoltarDeployed, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress, getZoltarForkThreshold, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import {
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as artifact,
	test_statoblast_SecurityPoolReporterLedgerHarness_SecurityPoolReporterLedgerHarness as harness,
	test_statoblast_SecurityPoolReporterLedgerHarness_SecurityPoolReporterAuthorityHarness as authorityArtifact,
} from '../../types/contractArtifact'

const unit = 10n ** 18n

describe('Statoblast: central reporter custody', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let ethereum: AnvilWindowEthereum
	let owner: WriteClient
	let authority: Address
	let ledger: Address
	let questionId: bigint
	const rootCall = async (data: `0x${string}`) => await writeContractAndWait(owner, () => owner.writeContract({ abi: authorityArtifact.abi, address: authority, functionName: 'execute', args: [ledger, data] }))

	const createGame = async (question: bigint, universe = 0n) => {
		const game = await deployContract(owner, encodeDeployData({ abi: harness.abi, bytecode: `0x${harness.evm.bytecode.object}`, args: [getZoltarAddress(), ledger, universe, question] }))
		await rootCall(encodeFunctionData({ abi: artifact.abi, functionName: 'registerGame', args: [question, game] }))
		await approveToken(owner, getRepTokenAddress(universe), game)
		return game
	}
	const deposit = async (game: Address, amount: bigint) => await writeContractAndWait(owner, () => owner.writeContract({ abi: harness.abi, address: game, functionName: 'deposit', args: [amount] }))
	const withdraw = async (game: Address, amount: bigint) => await writeContractAndWait(owner, () => owner.writeContract({ abi: harness.abi, address: game, functionName: 'withdraw', args: [owner.account.address, amount] }))
	const balance = async (game: Address) => await owner.readContract({ abi: artifact.abi, address: ledger, functionName: 'balanceOfGame', args: [game] })
	const book = async (universe = 0n) => await owner.readContract({ abi: artifact.abi, address: ledger, functionName: 'books', args: [universe] })
	const createChild = async (outcome: bigint) => {
		await rootCall(encodeFunctionData({ abi: artifact.abi, functionName: 'createChild', args: [0n, outcome] }))
		return BigInt.asUintN(248, BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [0n, outcome]))))
	}

	beforeEach(async () => {
		ethereum = getAnvilWindowEthereum()
		owner = createWriteClient(ethereum, TEST_ADDRESSES[0])
		await setupTestAccounts(ethereum)
		await ensureZoltarDeployed(owner)
		authority = await deployContract(owner, encodeDeployData({ abi: authorityArtifact.abi, bytecode: `0x${authorityArtifact.evm.bytecode.object}`, args: [getZoltarAddress()] }))
		ledger = await deployContract(owner, encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [authority, getZoltarAddress()] }))
		await rootCall(encodeFunctionData({ abi: artifact.abi, functionName: 'registerUniverse', args: [0n] }))
		const data = { ...makeQuestion('central reporter fork'), startTime: 0n, endTime: 0n }
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(owner, data, outcomes)
		questionId = getQuestionId(data, outcomes)
	})

	test('keeps separately funded question balances and rejects unauthenticated or unfunded credits', async () => {
		const first = await createGame(questionId)
		const second = await createGame(questionId + 1n)
		await deposit(first, 10n * unit)
		await deposit(second, 20n * unit)
		expect(await balance(first)).toBe(10n * unit)
		expect(await balance(second)).toBe(20n * unit)
		expect((await book())[0]).toBe(30n * unit)
		expect(await getERC20Balance(owner, getRepTokenAddress(0n), ledger)).toBe(30n * unit)
		await expect(owner.writeContract({ abi: artifact.abi, address: ledger, functionName: 'depositForGame', args: [first, unit] })).rejects.toThrow('Only canonical reporter game')
		await expect(owner.writeContract({ abi: artifact.abi, address: ledger, functionName: 'transferFromGame', args: [first, owner.account.address, unit] })).rejects.toThrow('Only canonical reporter game')
		await expect(owner.writeContract({ abi: harness.abi, address: first, functionName: 'creditUnfunded', args: [unit] })).rejects.toThrow('Reporter deposit is not funded')
		await expect(withdraw(first, 11n * unit)).rejects.toThrow('Reporter escrow is insufficient')
		await withdraw(first, 3n * unit)
		expect(await balance(first)).toBe(7n * unit)
		expect(await balance(second)).toBe(20n * unit)
	})

	test('successive frozen prefixes never reclassify paid claims when new reporter custody arrives', async () => {
		const first = await createGame(questionId)
		const second = await createGame(questionId + 1n)
		const third = await createGame(questionId + 2n)
		const schedules = [
			{ game: first, amount: 10n, deadline: 1_000 },
			{ game: second, amount: 20n, deadline: 1_002 },
			{ game: third, amount: 30n, deadline: 1_004 },
		]
		for (const { game, amount, deadline } of schedules) {
			await deposit(game, amount * unit)
			await writeContractAndWait(owner, () => owner.writeContract({ abi: harness.abi, address: game, functionName: 'schedule', args: [deadline] }))
		}
		await ethereum.setTime(1_000n)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: artifact.abi, address: ledger, functionName: 'checkpoint', args: [0n] }))
		expect((await book()).slice(0, 2)).toEqual([50n * unit, 10n * unit])
		await withdraw(first, 10n * unit)
		await ethereum.setTime(1_004n)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: artifact.abi, address: ledger, functionName: 'checkpoint', args: [0n] }))
		expect((await book()).slice(0, 2)).toEqual([0n, 50n * unit])
		const fourth = await createGame(questionId + 3n)
		await deposit(fourth, 40n * unit)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harness.abi, address: fourth, functionName: 'schedule', args: [1_100] }))
		await withdraw(second, 20n * unit)
		await ethereum.setTime(1_100n)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: artifact.abi, address: ledger, functionName: 'checkpoint', args: [0n] }))
		expect((await book()).slice(0, 2)).toEqual([0n, 70n * unit])
		await withdraw(third, 30n * unit)
		await withdraw(fourth, 40n * unit)
		expect((await book()).slice(0, 2)).toEqual([0n, 0n])
		expect(await getERC20Balance(owner, getRepTokenAddress(0n), ledger)).toBe(0n)
	})

	test('protects strictly-final parent REP and migrates every live question through one branch root copy', async () => {
		const finalGame = await createGame(questionId)
		const liveGame = await createGame(questionId + 1n)
		await deposit(finalGame, 10n * unit)
		await deposit(liveGame, 20n * unit)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harness.abi, address: finalGame, functionName: 'schedule', args: [1_000] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harness.abi, address: liveGame, functionName: 'schedule', args: [1_001] }))
		await approveToken(owner, getRepTokenAddress(0n), getZoltarAddress())
		await ethereum.setTime(1_000n)
		await forkUniverse(owner, 0n, questionId)
		expect((await getUniverseData(owner, 0n)).forkTime).toBe(1_001n)
		await rootCall(encodeFunctionData({ abi: artifact.abi, functionName: 'freezeFork', args: [0n] }))
		expect((await book())[0]).toBe(20n * unit)
		expect((await book())[1]).toBe(10n * unit)
		expect(await getERC20Balance(owner, getRepTokenAddress(0n), ledger)).toBe(10n * unit)
		await expect(withdraw(liveGame, unit)).rejects.toThrow('Use child reporter escrow')
		const child = await createChild(1n)
		const childState = await owner.readContract({ abi: artifact.abi, address: ledger, functionName: 'question', args: [child, questionId + 1n] })
		expect(childState[0].sourceGame).toBe(liveGame)
		expect(childState[0].balanceAttoRep).toBe(20n * unit)
		expect(childState[0].finalAfter).toBe(1_001n)
		expect((await owner.readContract({ abi: artifact.abi, address: ledger, functionName: 'question', args: [child, questionId] }))[0].balanceAttoRep).toBe(0n)
		const childGame = await createGame(questionId + 1n, child)
		await withdraw(childGame, 4n * unit)
		expect(await balance(childGame)).toBe(16n * unit)
		expect(await balance(liveGame)).toBe(20n * unit)
		const otherChild = await createChild(2n)
		expect((await book(otherChild))[0]).toBe(20n * unit)
		await withdraw(finalGame, 10n * unit)
		expect(await getERC20Balance(owner, getRepTokenAddress(0n), ledger)).toBe(0n)
		await expect(createChild(1n)).rejects.toThrow('Reporter child already exists')
	})

	test('finalizes an untouched inherited deadline after the response floor and permits later direct claims', async () => {
		const source = await createGame(questionId)
		await deposit(source, 10n * unit)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harness.abi, address: source, functionName: 'schedule', args: [1_001] }))
		await approveToken(owner, getRepTokenAddress(0n), getZoltarAddress())
		await ethereum.setTime(1_000n)
		await forkUniverse(owner, 0n, questionId)
		await rootCall(encodeFunctionData({ abi: artifact.abi, functionName: 'freezeFork', args: [0n] }))
		const child = await createChild(1n)
		const unrelated = await createGame(questionId + 2n, child)
		const floor = 1_001n + 3n * 86_400n
		await ethereum.setTime(floor - 1n)
		await deposit(unrelated, 0n)
		expect((await book(child))[0]).toBe(10n * unit)
		await deposit(unrelated, 0n)
		expect((await book(child))[0]).toBe(0n)
		expect((await book(child))[1]).toBe(10n * unit)
		const untouched = await owner.readContract({ abi: artifact.abi, address: ledger, functionName: 'question', args: [child, questionId] })
		expect(untouched[1]).toBe(true)
		expect(untouched[0].sourceGame).toBe(source)
		const lateGame = await createGame(questionId, child)
		await withdraw(lateGame, 10n * unit)
		expect((await book(child))[1]).toBe(0n)
	})

	test('cannot borrow another question escrow for admission and charges only the triggering question haircut', async () => {
		const threshold = await getZoltarForkThreshold(owner, 0n)
		const trigger = await createGame(questionId)
		const other = await createGame(questionId + 1n)
		await deposit(trigger, threshold - 1n)
		await deposit(other, threshold)
		await expect(rootCall(encodeFunctionData({ abi: artifact.abi, functionName: 'triggerFork', args: [0n, questionId] }))).rejects.toThrow('Triggering question lacks fork admission REP')
		await deposit(trigger, 1n)
		await rootCall(encodeFunctionData({ abi: artifact.abi, functionName: 'triggerFork', args: [0n, questionId] }))
		const haircut = threshold / 5n
		expect(await balance(trigger)).toBe(threshold - haircut)
		expect(await balance(other)).toBe(threshold)
		expect((await book())[0]).toBe(2n * threshold - haircut)
		expect(await getERC20Balance(owner, getRepTokenAddress(0n), ledger)).toBe(0n)
		const child = await createChild(1n)
		expect((await owner.readContract({ abi: artifact.abi, address: ledger, functionName: 'question', args: [child, questionId] }))[0].balanceAttoRep).toBe(threshold - haircut)
		expect((await owner.readContract({ abi: artifact.abi, address: ledger, functionName: 'question', args: [child, questionId + 1n] }))[0].balanceAttoRep).toBe(threshold)
		const forkTime = (await getUniverseData(owner, 0n)).forkTime
		await ethereum.setTime(forkTime + 3n * 86_400n)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: artifact.abi, address: ledger, functionName: 'checkpoint', args: [child] }))
		expect((await owner.readContract({ abi: artifact.abi, address: ledger, functionName: 'question', args: [child, questionId] }))[1]).toBe(true)
		expect((await book(child))[0]).toBe(threshold)
		expect((await book(child))[1]).toBe(threshold - haircut)
	})

	test('binds a protected untouched claim after its finalizing universe has itself forked', async () => {
		const source = await createGame(questionId)
		await deposit(source, 10n * unit)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harness.abi, address: source, functionName: 'schedule', args: [1_001] }))
		await approveToken(owner, getRepTokenAddress(0n), getZoltarAddress())
		await ethereum.setTime(1_000n)
		await forkUniverse(owner, 0n, questionId)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: artifact.abi, address: ledger, functionName: 'freezeFork', args: [0n] }))
		const child = await createChild(1n)
		const admission = await getZoltarForkThreshold(owner, child)
		await addRepToMigrationBalance(owner, 0n, admission)
		await splitMigrationRep(owner, 0n, admission, [1n])
		await approveToken(owner, getRepTokenAddress(child), getZoltarAddress())
		await ethereum.setTime(1_001n + 70n * 86_400n)
		await forkUniverse(owner, child, questionId)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: artifact.abi, address: ledger, functionName: 'freezeFork', args: [child] }))
		expect((await book(child))[0]).toBe(0n)
		expect((await book(child))[1]).toBe(10n * unit)
		const lateGame = await createGame(questionId, child)
		await withdraw(lateGame, 10n * unit)
		expect((await book(child))[1]).toBe(0n)
		expect(await getERC20Balance(owner, getRepTokenAddress(child), ledger)).toBe(0n)
	})
})
