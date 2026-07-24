import { test, beforeEach, describe, setDefaultTimeout } from 'bun:test'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT } from '@zoltar/shared/constants'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/shared/protocolConfig'
import { createWriteClient, WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { approveToken, setupTestAccounts, getERC20Balance, getChildUniverseId, contractExists, sortStringArrayByKeccak } from '../testSupport/simulator/utils/utilities'
import assert from '../testSupport/simulator/utils/assert'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { decodeEventLog, encodeDeployData, hexToBytes } from '@zoltar/shared/ethereum'
import {
	addRepToMigrationBalance,
	deployChild,
	ensureZoltarDeployed,
	forkUniverse,
	getMigrationRepBalance,
	getRepTokenAddress,
	getTotalTheoreticalSupply,
	getUniverseData,
	getUniverseTheoreticalSupply,
	getZoltarAddress,
	getZoltarForkBurnDivisor,
	getZoltarForkThreshold,
	getZoltarForkThresholdDivisor,
	isZoltarDeployed,
	splitMigrationRep,
} from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, getAnswerOptionName, getQuestionId } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { ensureDefined, strictEqualTypeSafe } from '../testSupport/simulator/utils/testUtils'
import { ReputationToken_ReputationToken, test_peripherals_FalseReturningERC20_FalseReturningERC20, Zoltar_Zoltar } from '../types/contractArtifact'
import { formatScalarOutcomeLabel, getScalarOutcomeIndex } from '../testSupport/simulator/utils/contracts/scalarOutcome'

// Forker deposit fraction: the deposit is 5% of total supply (1/20).
const FORKER_DEPOSIT_FRACTION = 20n
const MAX_UINT256 = 2n ** 256n - 1n
const SCALAR_RESERVED_BITS_MASK = ((1n << 15n) - 1n) << 240n

function withScalarReservedBits(answer: bigint, reservedBits = 1n) {
	return answer | ((reservedBits << 240n) & SCALAR_RESERVED_BITS_MASK)
}

function formatStorageSlot(slot: bigint) {
	return `0x${slot.toString(16).padStart(64, '0')}`
}

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('Contract Test Suite', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const genesisUniverse = 0n

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
	})

	test('canDeployContract', async () => {
		const isDeployed = await isZoltarDeployed(client)
		assert.ok(isDeployed, 'Not Deployed!')

		const genesisUniverseData = await getUniverseData(client, 0n)
		assert.strictEqual(BigInt(genesisUniverseData.reputationToken), GENESIS_REPUTATION_TOKEN, 'Genesis universe not recognized or not initialized properly')
	})

	test('exposes configured fork economics', async () => {
		assert.strictEqual(await getZoltarForkBurnDivisor(client), DEFAULT_PROTOCOL_CONFIG.forkBurnDivisor, 'fork burn divisor mismatch')
		assert.strictEqual(await getZoltarForkThresholdDivisor(client), DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor, 'fork threshold divisor mismatch')
	})

	test('fork initiation charges the configured admission haircut', async () => {
		const zoltar = getZoltarAddress()
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const questionData = {
			title: 'child theoretical maximum supply',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(client, questionData, outcomes)

		const parentSupplyBeforeFork = await getUniverseTheoreticalSupply(client, genesisUniverse)
		const forkThreshold = parentSupplyBeforeFork / DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		const forkHaircut = forkThreshold / DEFAULT_PROTOCOL_CONFIG.forkBurnDivisor
		await forkUniverse(client, genesisUniverse, getQuestionId(questionData, outcomes))
		assert.strictEqual(await getMigrationRepBalance(client, genesisUniverse, client.account.address), forkThreshold - forkHaircut, 'fork initiator migration credit should exclude the admission haircut')

		const outcomeIndex = 1n
		await deployChild(client, genesisUniverse, outcomeIndex)
		const childUniverseId = getChildUniverseId(genesisUniverse, outcomeIndex)
		const expectedMaximumSupply = parentSupplyBeforeFork - forkHaircut
		assert.strictEqual(await getUniverseTheoreticalSupply(client, childUniverseId), expectedMaximumSupply, 'child theoretical maximum should exclude the fork admission haircut')
		assert.strictEqual(await getTotalTheoreticalSupply(client, getRepTokenAddress(childUniverseId)), expectedMaximumSupply, 'child REP token maximum should match the child universe theoretical supply')
	})

	test('constructor rejects an invalid fork threshold divisor', async () => {
		const zoltarQuestionDataAddress = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'zoltarQuestionData',
			address: getZoltarAddress(),
			args: [],
		})
		const invalidThresholdDeployment = encodeDeployData({
			abi: Zoltar_Zoltar.abi,
			bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
			args: [zoltarQuestionDataAddress, 1n, DEFAULT_PROTOCOL_CONFIG.forkBurnDivisor],
		})

		await assert.rejects(
			writeContractAndWait(client, () => client.sendTransaction({ data: invalidThresholdDeployment })),
			/Zoltar fork threshold divisor must be greater than one/,
		)
	})

	test('constructor rejects an invalid fork burn divisor', async () => {
		const zoltarQuestionDataAddress = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'zoltarQuestionData',
			address: getZoltarAddress(),
			args: [],
		})
		const invalidBurnDeployment = encodeDeployData({
			abi: Zoltar_Zoltar.abi,
			bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
			args: [zoltarQuestionDataAddress, DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor, 1n],
		})

		await assert.rejects(
			writeContractAndWait(client, () => client.sendTransaction({ data: invalidBurnDeployment })),
			/Zoltar fork burn divisor must be greater than one/,
		)
	})

	test('forkUniverse rejects false-returning genesis REP transfers', async () => {
		const falseReturningGenesisRep = hexToBytes(`0x${test_peripherals_FalseReturningERC20_FalseReturningERC20.evm.deployedBytecode.object}`)
		if (falseReturningGenesisRep === undefined) throw new Error('false returning token bytecode missing')
		const questionData = {
			title: 'false-returning genesis rep fork test',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)

		await mockWindow.addStateOverrides({
			[addressString(GENESIS_REPUTATION_TOKEN)]: {
				code: falseReturningGenesisRep,
			},
		})

		await assert.rejects(forkUniverse(client, genesisUniverse, questionId), /SafeERC20Ops token returned false from ERC20 call/)
	})

	test('constructor rejects missing genesis REP token code', async () => {
		const zoltarQuestionDataAddress = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'zoltarQuestionData',
			address: getZoltarAddress(),
			args: [],
		})
		const deployment = encodeDeployData({
			abi: Zoltar_Zoltar.abi,
			bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
			args: [zoltarQuestionDataAddress, DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor, DEFAULT_PROTOCOL_CONFIG.forkBurnDivisor],
		})

		await mockWindow.addStateOverrides({
			[addressString(GENESIS_REPUTATION_TOKEN)]: {
				code: hexToBytes('0x'),
			},
		})

		await assert.rejects(
			writeContractAndWait(client, () => client.sendTransaction({ data: deployment })),
			/Genesis REP token address must contain code/,
		)
	})

	test('constructor rejects zero genesis REP theoretical supply', async () => {
		const zoltarQuestionDataAddress = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'zoltarQuestionData',
			address: getZoltarAddress(),
			args: [],
		})
		const deployment = encodeDeployData({
			abi: Zoltar_Zoltar.abi,
			bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
			args: [zoltarQuestionDataAddress, DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor, DEFAULT_PROTOCOL_CONFIG.forkBurnDivisor],
		})

		await mockWindow.addStateOverrides({
			[addressString(GENESIS_REPUTATION_TOKEN)]: {
				stateDiff: {
					[formatStorageSlot(REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT)]: 0n,
				},
			},
		})

		await assert.rejects(
			writeContractAndWait(client, () => client.sendTransaction({ data: deployment })),
			/Genesis REP missing supply: theoretical supply must be non-zero/,
		)
	})

	test('forkUniverse rejects uninitialized universes without mutating fork state', async () => {
		const missingUniverseId = 999_999n
		const questionData = {
			title: 'missing universe fork test',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)

		await assert.rejects(forkUniverse(client, missingUniverseId, questionId), /Universe not initialized with a REP token/)

		const universeData = await getUniverseData(client, missingUniverseId)
		assert.strictEqual(universeData.forkTime, 0n, 'missing universe should remain unforked')
	})

	test('forkUniverse rejects zero tracked supply after a valid full-supply burn', async () => {
		const questionData = {
			title: 'fork storage guard coverage',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)

		const universeTheoreticalSupply = await getUniverseTheoreticalSupply(client, genesisUniverse)
		let totalBurned = 0n
		for (const testAddress of TEST_ADDRESSES) {
			const burner = createWriteClient(mockWindow, testAddress, 0)
			const balance = await getERC20Balance(burner, addressString(GENESIS_REPUTATION_TOKEN), burner.account.address)
			if (balance === 0n) continue
			await approveToken(burner, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await writeContractAndWait(burner, () =>
				burner.writeContract({
					abi: Zoltar_Zoltar.abi,
					address: getZoltarAddress(),
					functionName: 'burnRep',
					args: [genesisUniverse, balance],
				}),
			)
			totalBurned += balance
		}
		assert.strictEqual(totalBurned, universeTheoreticalSupply, 'funded test accounts should hold the complete tracked REP supply')
		assert.strictEqual(await getUniverseTheoreticalSupply(client, genesisUniverse), 0n, 'full-supply burn should reach the public zero-supply state')
		await assert.rejects(forkUniverse(client, genesisUniverse, questionId), /Universe theoretical REP supply must be non-zero/)
	})

	test('pre-fork migration and REP burn guards expose their specific reasons', async () => {
		const zoltar = getZoltarAddress()
		const universeTheoreticalSupply = await getUniverseTheoreticalSupply(client, genesisUniverse)

		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: Zoltar_Zoltar.abi,
					address: zoltar,
					functionName: 'burnRep',
					args: [genesisUniverse, 0n],
				}),
			),
			/Burn amount zero/,
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: Zoltar_Zoltar.abi,
					address: zoltar,
					functionName: 'burnRep',
					args: [999_999n, 1n],
				}),
			),
			/Universe not initialized with a REP token/,
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: Zoltar_Zoltar.abi,
					address: zoltar,
					functionName: 'burnRep',
					args: [genesisUniverse, universeTheoreticalSupply + 1n],
				}),
			),
			/Burn exceeds theoretical supply/,
		)
		await assert.rejects(deployChild(client, genesisUniverse, 1n), /Universe has not forked, so child universes are unavailable/)
		await assert.rejects(addRepToMigrationBalance(client, genesisUniverse, 1n), /Universe has not forked, so migration balance cannot be added/)
		await assert.rejects(splitMigrationRep(client, genesisUniverse, 1n, [1n]), /Universe has not forked, so migration REP cannot be split/)
	})

	test('fork and child deployment reject repeated lifecycle actions', async () => {
		const questionData = {
			title: 'repeat lifecycle guard coverage',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, questionId)

		await assert.rejects(forkUniverse(client, genesisUniverse, questionId), /Universe has forked already and cannot fork again/)
		await deployChild(client, genesisUniverse, 1n)
		await assert.rejects(deployChild(client, genesisUniverse, 1n), /Child universe already deployed for this outcome/)
	})

	test('canForkQuestion', async () => {
		const client2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const zoltar = getZoltarAddress()
		const questionText = 'test question'
		const outcomes = sortStringArrayByKeccak(['Outcome 1', 'Outcome 2', 'Outcome 3', 'Outcome 4'])

		await approveToken(client2, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		// Create the question on ZoltarQuestionData
		const questionData = {
			title: questionText,
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		await createQuestion(client, questionData, outcomes)

		const preForkUniverseData = await getUniverseData(client, genesisUniverse)
		const genesisRepToken = getRepTokenAddress(genesisUniverse)
		const totalTheoreticalSupply = await getTotalTheoreticalSupply(client, genesisRepToken)
		assert.strictEqual(preForkUniverseData.forkTime, 0n, 'Universe was forked already')
		assert.strictEqual(preForkUniverseData.parentUniverseId, 0n, 'Universe had parent')
		assert.strictEqual(preForkUniverseData.forkingOutcomeIndex, 0n, 'Universe has forking outcome index')
		assert.strictEqual(preForkUniverseData.reputationToken, genesisRepToken, 'Universe reputation token mismatch')
		const priorRepbalance = await getERC20Balance(client, genesisRepToken, client.account.address)

		const questionId = getQuestionId(questionData, outcomes)

		// do fork
		const forkHash = await forkUniverse(client, genesisUniverse, questionId)
		const forkReceipt = await client.waitForTransactionReceipt({ hash: forkHash })
		const afterForkBalance = await getERC20Balance(client, genesisRepToken, client.account.address)
		assert.strictEqual(afterForkBalance + totalTheoreticalSupply / FORKER_DEPOSIT_FRACTION, priorRepbalance, 'balance mismatch')
		const universeData = await getUniverseData(client, genesisUniverse)
		const forkLog = forkReceipt.logs
			.filter(log => log.address.toLowerCase() === getZoltarAddress().toLowerCase())
			.map(log =>
				decodeEventLog({
					abi: Zoltar_Zoltar.abi,
					data: log.data,
					topics: log.topics,
				}),
			)
			.find(log => log.eventName === 'UniverseForked')
		if (forkLog === undefined) throw new Error('missing UniverseForked log')
		assert.ok(universeData.forkTime > 0, 'Universe was supposed to be forked')
		assert.strictEqual(universeData.parentUniverseId, 0n, 'Universe had parent')
		assert.strictEqual(universeData.forkingOutcomeIndex, 0n, 'Universe has forking outcome index')
		assert.strictEqual(universeData.reputationToken, genesisRepToken, 'Wrong rep token')
		ensureDefined(client.account, 'client.account is undefined')
		assert.strictEqual(await getERC20Balance(client, genesisRepToken, zoltar), 0n, "forker's deposit should be burned (not held)")
		assert.strictEqual(forkLog.args.forker, client.account.address, 'UniverseForked should identify the forker')
		assert.strictEqual(forkLog.args.universeId, genesisUniverse, 'UniverseForked should identify the forked universe')
		assert.strictEqual(forkLog.args.questionId, questionId, 'UniverseForked should identify the fork question')
		assert.strictEqual(forkLog.args.forkTime, universeData.forkTime, 'UniverseForked should expose the stored fork time')
		assert.strictEqual(forkLog.args.forkThreshold, totalTheoreticalSupply / FORKER_DEPOSIT_FRACTION, 'UniverseForked should expose the fork threshold')
		assert.strictEqual(forkLog.args.migrationRepBalance, await getMigrationRepBalance(client, genesisUniverse, client.account.address), 'UniverseForked should expose the forker migration balance')
		assert.strictEqual(forkLog.args.universeTheoreticalSupply, await getUniverseTheoreticalSupply(client, genesisUniverse), 'UniverseForked should expose the new universe theoretical supply')

		// forker claim balance
		const outcomeIndexes = [0, 1, 3]
		const balance = await getMigrationRepBalance(client, genesisUniverse, client.account.address)
		await splitMigrationRep(client, genesisUniverse, balance, outcomeIndexes)

		assert.strictEqual(await getERC20Balance(client, genesisRepToken, zoltar), 0n, "forker's deposit should be burned")
		for (const index of outcomeIndexes) {
			const indexUniverse = getChildUniverseId(genesisUniverse, index)
			const repForIndex = getRepTokenAddress(indexUniverse)
			assert.ok(await contractExists(client, repForIndex), `rep token for index ${index} exists`)
			const ourBalance = await getERC20Balance(client, repForIndex, client.account.address)
			assert.strictEqual(ourBalance, await getMigrationRepBalance(client, genesisUniverse, client.account.address))
		}

		// split rest of the rep
		const splitOutcomeIndexes = [0, 1, 2]
		const priorBalances = await Promise.all(
			splitOutcomeIndexes.map(async index => {
				const indexUniverse = getChildUniverseId(genesisUniverse, index)
				const repForIndex = getRepTokenAddress(indexUniverse)
				return (await contractExists(client, repForIndex)) ? await getERC20Balance(client, repForIndex, client.account.address) : 0n
			}),
		)
		const priorSplitBalance = await getERC20Balance(client, genesisRepToken, client.account.address)
		await addRepToMigrationBalance(client, genesisUniverse, priorSplitBalance)
		await splitMigrationRep(client, genesisUniverse, priorSplitBalance, splitOutcomeIndexes)

		assert.strictEqual(await getERC20Balance(client, genesisRepToken, client.account.address), 0n, "splitter's rep should be gone")
		for (const [index, outcomeIndex] of splitOutcomeIndexes.entries()) {
			const indexUniverse = getChildUniverseId(genesisUniverse, outcomeIndex)
			const repForIndex = getRepTokenAddress(indexUniverse)
			assert.ok(await contractExists(client, repForIndex), `rep token for index ${outcomeIndex} exists`)
			const priorBalance = ensureDefined(priorBalances[index], `priorBalance at index ${index} is undefined`)
			const ourBalance = await getERC20Balance(client, repForIndex, client.account.address)
			assert.strictEqual(ourBalance, priorSplitBalance + priorBalance, 'after split balance mismatch')
		}
	})

	test('splitMigrationRep preserves child balances across outcome orderings and rejects double use of the same balance', async () => {
		const zoltar = getZoltarAddress()
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const questionData = {
			title: 'split migration ordering property',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = sortStringArrayByKeccak(['Yes', 'No', 'Maybe', 'Later'])
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)
		await forkUniverse(client, genesisUniverse, questionId)

		const migrationBalance = await getMigrationRepBalance(client, genesisUniverse, client.account.address)
		const outcomeOrderings: Array<(number | bigint)[]> = [
			[0n, 1n, 3n],
			[3n, 1n, 0n],
		]
		const snapshot = await mockWindow.anvilSnapshot()
		const results: Array<{ childBalances: bigint[]; remainingMigrationBalance: bigint }> = []

		for (const outcomeIndexes of outcomeOrderings) {
			await splitMigrationRep(client, genesisUniverse, migrationBalance, outcomeIndexes)
			const childBalances = await Promise.all(
				outcomeIndexes.map(async outcomeIndex => {
					const childUniverseId = getChildUniverseId(genesisUniverse, outcomeIndex)
					const repToken = getRepTokenAddress(childUniverseId)
					return await getERC20Balance(client, repToken, client.account.address)
				}),
			)
			results.push({
				childBalances,
				remainingMigrationBalance: await getMigrationRepBalance(client, genesisUniverse, client.account.address),
			})
			await assert.rejects(splitMigrationRep(client, genesisUniverse, migrationBalance, outcomeIndexes), /Cannot migrate more than internal balance: requested child REP exceeds sender migration REP/)
			await mockWindow.anvilRevert(snapshot)
		}

		assert.deepStrictEqual(results[0], results[1], 'split migration results should not depend on outcome ordering')
	})

	test('deployChild creates a child universe without requiring migration balance', async () => {
		const zoltar = getZoltarAddress()
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const questionData = {
			title: 'deploy child test',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)
		await forkUniverse(client, genesisUniverse, questionId)

		// Use a second account that has no migration balance to call deployChild.
		// This verifies the property createZoltarChildUniverse in the UI relies on:
		// any caller can deploy a child universe regardless of migration balance.
		const deployer = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const deployerMigrationBalance = await getMigrationRepBalance(deployer, genesisUniverse, deployer.account.address)
		assert.strictEqual(deployerMigrationBalance, 0n, 'deployer should have no migration balance')

		const outcomeIndex = 0n
		await deployChild(deployer, genesisUniverse, outcomeIndex)

		const childUniverseId = getChildUniverseId(genesisUniverse, outcomeIndex)
		const childRepToken = getRepTokenAddress(childUniverseId)
		assert.ok(await contractExists(deployer, childRepToken), 'child universe rep token should be deployed after deployChild')

		const childUniverseData = await getUniverseData(deployer, childUniverseId)
		assert.strictEqual(childUniverseData.forkingOutcomeIndex, outcomeIndex, 'child universe should record the correct outcome index')
		assert.strictEqual(childUniverseData.parentUniverseId, genesisUniverse, 'child universe should point back to the parent')
	})

	test('deployChild rejects malformed child universe outcomes', async () => {
		const zoltar = getZoltarAddress()
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const questionData = {
			title: 'malformed child deploy test',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)
		await forkUniverse(client, genesisUniverse, questionId)

		const malformedOutcomeIndex = 3n
		const childUniverseId = getChildUniverseId(genesisUniverse, malformedOutcomeIndex)
		const childRepToken = getRepTokenAddress(childUniverseId)
		await assert.rejects(deployChild(client, genesisUniverse, malformedOutcomeIndex), /Malformed outcome index for the universe fork question/)
		assert.ok(!(await contractExists(client, childRepToken)), 'malformed child universe rep token should not be deployed')

		const migrationBalance = await getMigrationRepBalance(client, genesisUniverse, client.account.address)
		await assert.rejects(splitMigrationRep(client, genesisUniverse, migrationBalance, [malformedOutcomeIndex]), /Malformed outcome index for the fork migration question/)
	})

	test('child universe ids remain deterministic and scalar malformed answers never deploy', async () => {
		const zoltar = getZoltarAddress()
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const scalarQuestionData = {
			title: 'scalar child universe determinism',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 10n,
			displayValueMin: 0n,
			displayValueMax: 10n,
			answerUnit: 'km',
		}
		await createQuestion(client, scalarQuestionData, [])
		const scalarQuestionId = getQuestionId(scalarQuestionData, [])

		await forkUniverse(client, genesisUniverse, scalarQuestionId)
		const validScalarOutcomeIndexes = [getScalarOutcomeIndex(scalarQuestionData, 0n), getScalarOutcomeIndex(scalarQuestionData, 5n), getScalarOutcomeIndex(scalarQuestionData, 10n)]
		const childUniverseIds = validScalarOutcomeIndexes.map(outcomeIndex => getChildUniverseId(genesisUniverse, outcomeIndex))
		const repeatedChildUniverseIds = validScalarOutcomeIndexes.map(outcomeIndex => getChildUniverseId(genesisUniverse, outcomeIndex))
		let firstChildSupply: bigint | undefined

		assert.deepStrictEqual(repeatedChildUniverseIds, childUniverseIds, 'child universe ids should be deterministic for each scalar answer')
		strictEqualTypeSafe(new Set(childUniverseIds).size, childUniverseIds.length, 'each scalar child universe id should map to exactly one outcome index')

		for (const outcomeIndex of validScalarOutcomeIndexes) {
			const childUniverseId = getChildUniverseId(genesisUniverse, outcomeIndex)
			const childRepToken = getRepTokenAddress(childUniverseId)
			const deployChildHash = await deployChild(client, genesisUniverse, outcomeIndex)
			const deployChildReceipt = await client.waitForTransactionReceipt({ hash: deployChildHash })
			const childUniverseData = await getUniverseData(client, childUniverseId)
			const childSupply = await getTotalTheoreticalSupply(client, childRepToken)
			const deployChildLog = deployChildReceipt.logs
				.filter(log => log.address.toLowerCase() === getZoltarAddress().toLowerCase())
				.map(log =>
					decodeEventLog({
						abi: Zoltar_Zoltar.abi,
						data: log.data,
						topics: log.topics,
					}),
				)
				.find(log => log.eventName === 'DeployChild')
			const theoreticalSupplyLog = deployChildReceipt.logs
				.filter(log => log.address.toLowerCase() === childRepToken.toLowerCase())
				.map(log =>
					decodeEventLog({
						abi: ReputationToken_ReputationToken.abi,
						data: log.data,
						topics: log.topics,
					}),
				)
				.find(log => log.eventName === 'TheoreticalSupplySet')
			if (deployChildLog === undefined) throw new Error('missing DeployChild log')
			if (theoreticalSupplyLog === undefined) throw new Error('missing TheoreticalSupplySet log')

			strictEqualTypeSafe(childUniverseData.parentUniverseId, genesisUniverse, 'child universe should point back to the parent universe')
			strictEqualTypeSafe(childUniverseData.forkingOutcomeIndex, outcomeIndex, 'child universe should store the exact scalar answer index')
			assert.ok(childSupply > 0n, 'child theoretical supply should remain positive')
			assert.strictEqual(deployChildLog.args.deployer, client.account.address, 'DeployChild should identify the deployer')
			assert.strictEqual(deployChildLog.args.universeId, genesisUniverse, 'DeployChild should identify the parent universe')
			assert.strictEqual(deployChildLog.args.outcomeIndex, outcomeIndex, 'DeployChild should identify the outcome')
			assert.strictEqual(deployChildLog.args.childUniverseId, childUniverseId, 'DeployChild should identify the child universe')
			assert.strictEqual(deployChildLog.args.childReputationToken, childRepToken, 'DeployChild should identify the child REP token')
			assert.strictEqual(deployChildLog.args.childUniverseTheoreticalSupply, childSupply, 'DeployChild should expose the child theoretical supply')
			assert.strictEqual(theoreticalSupplyLog.args.totalTheoreticalSupply, childSupply, 'TheoreticalSupplySet should expose the stored child token supply')
			if (firstChildSupply === undefined) {
				firstChildSupply = childSupply
			} else {
				strictEqualTypeSafe(childSupply, firstChildSupply, 'scalar child theoretical supply should be stable across valid outcomes')
			}
		}

		const malformedScalarOutcomeIndex = 11n
		const malformedChildUniverseId = getChildUniverseId(genesisUniverse, malformedScalarOutcomeIndex)
		await assert.rejects(deployChild(client, genesisUniverse, malformedScalarOutcomeIndex), /Malformed outcome index for the universe fork question/)
		assert.ok(!(await contractExists(client, getRepTokenAddress(malformedChildUniverseId))), 'malformed scalar child universe should not be deployed')

		const canonicalScalarOutcomeIndex = getScalarOutcomeIndex(scalarQuestionData, 5n)
		const aliasedScalarOutcomeIndex = withScalarReservedBits(canonicalScalarOutcomeIndex, 0x4567n)
		const aliasedChildUniverseId = getChildUniverseId(genesisUniverse, aliasedScalarOutcomeIndex)
		assert.ok(aliasedChildUniverseId !== getChildUniverseId(genesisUniverse, canonicalScalarOutcomeIndex), 'reserved-bit alias should still hash to a distinct child id before validation')
		await assert.rejects(deployChild(client, genesisUniverse, aliasedScalarOutcomeIndex), /Malformed outcome index for the universe fork question/)
		assert.ok(!(await contractExists(client, getRepTokenAddress(aliasedChildUniverseId))), 'reserved-bit scalar alias should not deploy a child universe')

		const migrationBalance = await getMigrationRepBalance(client, genesisUniverse, client.account.address)
		await assert.rejects(splitMigrationRep(client, genesisUniverse, migrationBalance, [aliasedScalarOutcomeIndex]), /Malformed outcome index for the fork migration question/)
	})

	test('getDeployedChildUniverses pages deployed child universes', async () => {
		const zoltar = getZoltarAddress()
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const questionData = {
			title: 'paged child universes',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = sortStringArrayByKeccak(['Outcome 1', 'Outcome 2', 'Outcome 3', 'Outcome 4'])
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)

		await forkUniverse(client, genesisUniverse, questionId)
		const balance = await getMigrationRepBalance(client, genesisUniverse, client.account.address)
		await splitMigrationRep(client, genesisUniverse, balance, [0, 1, 3])

		const firstPage = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'getDeployedChildUniverses',
			address: getZoltarAddress(),
			args: [genesisUniverse, 0n, 2n],
		})
		const secondPage = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'getDeployedChildUniverses',
			address: getZoltarAddress(),
			args: [genesisUniverse, 2n, 2n],
		})
		const maxCountPage = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'getDeployedChildUniverses',
			address: getZoltarAddress(),
			args: [genesisUniverse, 1n, MAX_UINT256],
		})
		const emptyPage = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'getDeployedChildUniverses',
			address: getZoltarAddress(),
			args: [genesisUniverse, 4n, 2n],
		})

		assert.deepStrictEqual(firstPage[0], [0n, 1n], 'first page should include the first two child outcomes')
		assert.deepStrictEqual(firstPage[1], [getChildUniverseId(genesisUniverse, 0), getChildUniverseId(genesisUniverse, 1)], 'first page child ids should match deployed children')
		assert.deepStrictEqual(
			firstPage[2].map((child: { parentUniverseId: bigint }) => child.parentUniverseId),
			[genesisUniverse, genesisUniverse],
			'first page child universes should point back to genesis',
		)

		assert.deepStrictEqual(secondPage[0], [3n], 'second page should include the remaining child outcome')
		assert.deepStrictEqual(secondPage[1], [getChildUniverseId(genesisUniverse, 3)], 'second page child id should match the deployed child')
		assert.strictEqual(secondPage[2][0]?.forkingOutcomeIndex, 3n, 'second page child universe should retain the outcome index')

		assert.deepStrictEqual(maxCountPage[0], [1n, 3n], 'max-count paging should clamp to the remaining child outcomes')
		assert.deepStrictEqual(maxCountPage[1], [getChildUniverseId(genesisUniverse, 1), getChildUniverseId(genesisUniverse, 3)], 'max-count paging should return matching child ids')
		assert.deepStrictEqual(
			maxCountPage[2].map((child: { parentUniverseId: bigint }) => child.parentUniverseId),
			[genesisUniverse, genesisUniverse],
			'max-count child universes should point back to genesis',
		)

		assert.deepStrictEqual(emptyPage[0], [], 'out of range paging should return no outcome indexes')
		assert.deepStrictEqual(emptyPage[1], [], 'out of range paging should return no child universe ids')
		assert.deepStrictEqual(emptyPage[2], [], 'out of range paging should return no child universes')
	})

	test('all child universes from a single fork inherit the same theoretical supply regardless of deployment order', async () => {
		const zoltar = getZoltarAddress()
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const questionData = {
			title: 'supply symmetry',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)

		await forkUniverse(client, genesisUniverse, questionId)
		await deployChild(client, genesisUniverse, 0n)
		const earlyChildSupply = await getTotalTheoreticalSupply(client, getRepTokenAddress(getChildUniverseId(genesisUniverse, 0)))

		const remainingRepBalance = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), client.account.address)
		const additionalMigrationAmount = remainingRepBalance / 10n
		await addRepToMigrationBalance(client, genesisUniverse, additionalMigrationAmount)

		await deployChild(client, genesisUniverse, 1n)
		const lateChildSupply = await getTotalTheoreticalSupply(client, getRepTokenAddress(getChildUniverseId(genesisUniverse, 1)))

		assert.ok(earlyChildSupply > 0n, 'early child supply should remain positive')
		assert.ok(lateChildSupply > 0n, 'late child supply should remain positive')
		assert.strictEqual(lateChildSupply, earlyChildSupply, 'child universes from the same fork should share the same theoretical supply snapshot')
	})

	test('genesis fork thresholds decrease after REP is burned into migration balances', async () => {
		const zoltar = getZoltarAddress()
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const questionData = {
			title: 'genesis threshold accounting',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)

		const initialThreshold = await getZoltarForkThreshold(client, genesisUniverse)
		await forkUniverse(client, genesisUniverse, questionId)

		const thresholdAfterFork = await getZoltarForkThreshold(client, genesisUniverse)
		assert.ok(thresholdAfterFork < initialThreshold, 'fork threshold should decrease after the initial fork burn')

		const remainingRepBalance = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), client.account.address)
		const additionalMigrationAmount = remainingRepBalance / 10n
		await addRepToMigrationBalance(client, genesisUniverse, additionalMigrationAmount)

		const thresholdAfterAdditionalMigration = await getZoltarForkThreshold(client, genesisUniverse)
		assert.ok(thresholdAfterAdditionalMigration < thresholdAfterFork, 'fork threshold should keep decreasing as more genesis REP is burned into migration balance')
	})

	test('scalar slider values match the contract', async () => {
		const questionData = {
			title: 'scalar slider preview',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 1000n,
			displayValueMin: -500n * 10n ** 18n,
			displayValueMax: 500n * 10n ** 18n,
			answerUnit: 'km',
		}
		await createQuestion(client, questionData, [])
		const questionId = getQuestionId(questionData, [])

		for (const tickIndex of [0n, 250n, 500n, 750n, 1000n]) {
			const outcomeIndex = getScalarOutcomeIndex(questionData, tickIndex)
			const helperLabel = formatScalarOutcomeLabel(questionData, tickIndex)
			const contractLabel = await getAnswerOptionName(client, questionId, outcomeIndex)
			assert.strictEqual(helperLabel, contractLabel, `tick ${tickIndex.toString()} should match the contract`)
		}

		const unevenQuestionData = {
			title: 'scalar uneven preview',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 3n,
			displayValueMin: 0n,
			displayValueMax: 10n * 10n ** 18n,
			answerUnit: 'km',
		}
		await createQuestion(client, unevenQuestionData, [])
		const unevenQuestionId = getQuestionId(unevenQuestionData, [])

		for (const tickIndex of [0n, 1n, 2n, 3n]) {
			const outcomeIndex = getScalarOutcomeIndex(unevenQuestionData, tickIndex)
			const helperLabel = formatScalarOutcomeLabel(unevenQuestionData, tickIndex)
			const contractLabel = await getAnswerOptionName(client, unevenQuestionId, outcomeIndex)
			assert.strictEqual(helperLabel, contractLabel, `uneven tick ${tickIndex.toString()} should match the contract`)
		}
		assert.strictEqual(formatScalarOutcomeLabel(unevenQuestionData, 3n), '10 km', 'the max tick should now hit the exact maximum value')
	})

	test('forkUniverse fails for non-existent question', async () => {
		const client2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const zoltar = getZoltarAddress()
		await approveToken(client2, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const nonExistentQuestionId = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn

		await assert.rejects(forkUniverse(client, genesisUniverse, nonExistentQuestionId), /Question does not exist in ZoltarQuestionData/)
	})

	test('forkUniverse fails when question has not ended', async () => {
		const client2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const zoltar = getZoltarAddress()
		await approveToken(client2, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		// Get current time and create a question that ends in the future
		const currentTime = await mockWindow.getTime()
		const futureEndTime = currentTime + 1000n

		const questionData = {
			title: 'future question',
			description: '',
			startTime: 0n,
			endTime: futureEndTime,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = ['Yes', 'No']
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)

		// Should fail because question hasn't ended
		await assert.rejects(forkUniverse(client, genesisUniverse, questionId), /Question has not ended, so it cannot force a fork yet/)

		// Advance time past the endTime
		await mockWindow.advanceTime(2000n)

		// Should succeed now
		await forkUniverse(client, genesisUniverse, questionId)
	})

	test('forkUniverse succeeds when question has ended', async () => {
		const client2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const zoltar = getZoltarAddress()
		await approveToken(client2, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		// Create a question that ends in the future, then advance time past its end.
		const currentTime = await mockWindow.getTime()
		const futureEndTime = currentTime + 1000n

		const questionData = {
			title: 'past question',
			description: '',
			startTime: 0n,
			endTime: futureEndTime,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = ['Yes', 'No']
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)
		await mockWindow.advanceTime(2000n)

		// Fork should succeed
		await forkUniverse(client, genesisUniverse, questionId)

		// Verify fork succeeded
		const universeData = await getUniverseData(client, genesisUniverse)
		assert.ok(universeData.forkTime > 0n, 'Universe should be forked')
		assert.strictEqual(universeData.forkQuestionId, questionId, 'Fork questionId mismatch')
	})

	test('splitMigrationRep fails for malformed outcome index', async () => {
		const client2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const zoltar = getZoltarAddress()
		await approveToken(client2, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		// Create a question with 4 outcomes
		const questionData = {
			title: 'test malformed outcome',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = ['Yes', 'No']
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)

		// Fork the universe
		await forkUniverse(client, genesisUniverse, questionId)

		// Get the balance available for migration
		const balance = await getMigrationRepBalance(client, genesisUniverse, client.account.address)

		// Try to migrate with a malformed outcome index (5 is > 4 outcomes)
		const malformedOutcomeIndex = 5n
		await assert.rejects(splitMigrationRep(client, genesisUniverse, balance, [malformedOutcomeIndex]), /Malformed outcome index for the fork migration question/)
	})
})
