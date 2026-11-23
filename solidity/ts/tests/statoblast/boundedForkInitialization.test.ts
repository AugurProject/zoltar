import { describe, expect, test } from 'bun:test'
import { boundCloneRuntimeCode, universeCloneBindings } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { decodeEventLog, getAddress, keccak256, zeroAddress, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { formatStorageSlot } from '../../testSupport/storage'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getQuestionLedgersEscalationGame, getSystemState } from '../../testSupport/simulator/utils/contracts/questionLedger'
import { initiateQuestionLedgerFork } from '../../testSupport/simulator/utils/contracts/questionForker'
import { getEscalationGameOutcomeState } from '../../testSupport/simulator/utils/contracts/escalationGame'
import {
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_QuestionForker_QuestionForker as forkerArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_factories_OpenOraclePriceCoordinatorFactory_OpenOraclePriceCoordinatorFactory as oracleFactoryArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolCapitalFeeStreams_SecurityPoolCapitalFeeStreams as streamsArtifact,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolCommitmentIndexDeployer as indexDeployerArtifact,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer as streamsDeployerArtifact,
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as coordinatorArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
	Zoltar_Zoltar as zoltarArtifact,
} from '../../types/contractArtifact'
import { useSecurityPoolFixture } from './securityPoolFixture'

const outcomes = [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]
const transactionGasLimit = 16_777_216n

function findCallGas(frame: unknown, target: Address): bigint | undefined {
	if (typeof frame !== 'object' || frame === null) return undefined
	const to: unknown = Reflect.get(frame, 'to')
	const gasUsed: unknown = Reflect.get(frame, 'gasUsed')
	if (typeof to === 'string' && to.toLowerCase() === target.toLowerCase() && typeof gasUsed === 'string') return BigInt(gasUsed)
	const calls: unknown = Reflect.get(frame, 'calls')
	if (Array.isArray(calls)) {
		for (const call of calls) {
			const gas = findCallGas(call, target)
			if (gas !== undefined) return gas
		}
	}
	return undefined
}

describe('Statoblast: bounded fork initialization', () => {
	const fixture = useSecurityPoolFixture()

	test('one fresh branch preparation and subsequent question materialization fit tight gas caps with 192 nonzero carry peaks', async () => {
		const { owner, other, base, poolFor, secondQuestionId } = fixture
		const parent = poolFor(secondQuestionId).questionLedger
		const forker = getInfraContractAddresses().questionForker
		const factory = getInfraContractAddresses().securityPoolFactory
		const coordinator = await owner().readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'forkController' })
		const gasMeasurements: Record<string, string> = {}
		const checkGas = async (hash: Hash, stage: string, limit = transactionGasLimit) => {
			const { gasUsed } = await owner().waitForTransactionReceipt({ hash })
			expect(gasUsed).toBeLessThanOrEqual(limit)
			gasMeasurements[stage] = gasUsed.toString()
		}
		const outcomeIndex = BigInt(QuestionOutcome.No)
		const childUniverse = getChildUniverseId(base.genesisUniverse, QuestionOutcome.No)
		const prepare = { abi: coordinatorArtifact.abi, address: coordinator, functionName: 'prepareBranch', args: [base.genesisUniverse, outcomeIndex], gas: 3_300_000n } as const
		const readCapital = () => owner().readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'capitalLedger', args: [childUniverse] })
		const originToken = getRepTokenAddress(base.genesisUniverse)
		expect(await owner().readContract({ abi: tokenArtifact.abi, address: originToken, functionName: 'allowance', args: [fixture.capitalLedger, getZoltarAddress()] })).toBe((1n << 256n) - 1n)
		const ledgerImplementation = await owner().readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'capitalImplementation' })
		const implementation = { abi: capitalArtifact.abi, address: ledgerImplementation } as const
		const securityPoolCaller = createWriteClient(base.mockWindow, BigInt(fixture.securityPool))
		const emptyModules = [zeroAddress, zeroAddress, zeroAddress, zeroAddress] as const
		await expect(owner().readContract({ ...implementation, functionName: 'universeId' })).rejects.toThrow('Universe module requires a clone')
		await expect(securityPoolCaller.simulateContract({ ...implementation, functionName: 'initialize', args: emptyModules })).rejects.toThrow('Universe module requires a clone')
		await base.mockWindow.setTime(fixture.secondEndTime + 1n)
		await approveToken(owner(), getRepTokenAddress(base.genesisUniverse), parent)
		for (const outcome of outcomes) {
			await writeContractAndWait(owner(), () => owner().writeContract({ abi: poolArtifact.abi, address: parent, functionName: 'depositWalletRepToEscalationGame', args: [outcome, 11n * 10n ** 17n * BigInt(outcome + 1)] }))
		}
		const parentGame = await getQuestionLedgersEscalationGame(owner(), parent)
		const leafCount = (1n << 64n) - 1n
		const stateDiff: Record<string, bigint> = {}
		// Exercise the largest fixed-width carry representation, independent of the
		// number of historical questions, deposits and prior native forks.
		for (const outcome of outcomes) {
			const outcomeSlot = 8n + 78n * BigInt(outcome)
			stateDiff[formatStorageSlot(outcomeSlot + 6n)] = leafCount
			for (let peak = 0; peak < 64; peak++) stateDiff[formatStorageSlot(outcomeSlot + 7n + BigInt(peak))] = BigInt(keccak256(formatStorageSlot(BigInt(1 + outcome * 64 + peak))))
		}
		await base.mockWindow.addStateOverrides({ [parentGame]: { stateDiff } })
		const parentStates = await Promise.all(outcomes.map(outcome => getEscalationGameOutcomeState(owner(), parentGame, outcome)))
		for (const state of parentStates) {
			expect(state.currentLeafCount).toBe(leafCount)
			expect(state.currentPeaks.filter(peak => BigInt(peak) !== 0n)).toHaveLength(64)
		}
		await approveToken(owner(), getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner(), base.genesisUniverse, base.questionId)
		const forkTime = (await getUniverseData(owner(), base.genesisUniverse)).forkTime
		const readNativeToken = () => owner().readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getRepToken', args: [childUniverse] })
		expect((await owner().readContract({ ...prepare, functionName: 'forks', args: [base.genesisUniverse] }))[8]).toBe(false)
		expect(await readCapital()).toBe(zeroAddress)
		expect(await readNativeToken()).toBe(zeroAddress)
		const branchHash = await writeContractAndWait(other(), () => other().writeContract(prepare))
		await checkGas(branchHash, 'fresh branch preparation including native REP and source freeze', prepare.gas)
		if (process.env['REPORT_BOUNDED_FORK_GAS'] === '1') {
			const trace = await base.mockWindow.request({ method: 'debug_traceTransaction', params: [branchHash, { tracer: 'callTracer' }] })
			const ledgerGas = findCallGas(trace, getInfraContractAddresses().securityPoolCapitalLedgerDeployer)
			if (ledgerGas === undefined) throw new Error('The branch trace did not contain the ledger deployer call')
			gasMeasurements['ledger deployment call'] = ledgerGas.toString()
		}
		const childLedger = await readCapital()
		expect(childLedger).not.toBe(zeroAddress)
		expect(await readNativeToken()).toBe(getRepTokenAddress(childUniverse))
		expect((await owner().readContract({ ...prepare, functionName: 'forks', args: [base.genesisUniverse] }))[8]).toBe(true)
		const ledger = { abi: capitalArtifact.abi, address: childLedger } as const
		expect(await owner().readContract({ abi: tokenArtifact.abi, address: getRepTokenAddress(childUniverse), functionName: 'allowance', args: [childLedger, getZoltarAddress()] })).toBe(0n)
		await expect(other().simulateContract({ ...ledger, functionName: 'initialize', args: emptyModules })).rejects.toThrow('Only security pool')
		for (const functionName of ['lifecycleDelegate', 'auctionDelegate'] as const) {
			const origin = await owner().readContract({ ...ledger, address: fixture.capitalLedger, functionName })
			expect(await owner().readContract({ ...ledger, functionName })).toBe(origin)
		}
		expect(await owner().readContract({ ...ledger, functionName: 'universeId' })).toBe(childUniverse)
		expect(await owner().readContract({ ...ledger, functionName: 'repToken' })).toBe(getRepTokenAddress(childUniverse))
		expect((await owner().getCode({ address: childLedger }))?.toLowerCase()).toBe(boundCloneRuntimeCode(ledgerImplementation, universeCloneBindings(childUniverse, getRepTokenAddress(childUniverse))).toLowerCase())
		await expect(securityPoolCaller.simulateContract({ ...ledger, functionName: 'initialize', args: emptyModules })).rejects.toThrow('Capital already initialized')
		await expect(other().call({ to: childLedger, value: 1n, gas: 23_300n })).rejects.toThrow()
		const index = { abi: indexArtifact.abi, address: await owner().readContract({ ...ledger, functionName: 'commitmentIndex' }) } as const
		const streams = { abi: streamsArtifact.abi, address: await owner().readContract({ ...ledger, functionName: 'feeStreams' }) } as const
		const indexDeployer = getInfraContractAddresses().securityPoolCommitmentIndexDeployer
		const streamsDeployer = getInfraContractAddresses().securityPoolCapitalFeeStreamsDeployer
		const indexImplementation = await owner().readContract({ abi: indexDeployerArtifact.abi, address: indexDeployer, functionName: 'implementation' })
		const streamsImplementation = await owner().readContract({ abi: streamsDeployerArtifact.abi, address: streamsDeployer, functionName: 'implementation' })
		const indexFactoryCaller = createWriteClient(base.mockWindow, BigInt(indexDeployer))
		const streamsFactoryCaller = createWriteClient(base.mockWindow, BigInt(streamsDeployer))
		const branchBlock = await owner().getBlock({ blockNumber: (await owner().waitForTransactionReceipt({ hash: branchHash })).blockNumber })
		const streamArgs = [branchBlock.timestamp, await owner().readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'rewardVestingSeconds' })] as const
		expect(await owner().readContract({ ...streams, functionName: 'releasedThrough' })).toBe(streamArgs[0])
		expect(await owner().readContract({ ...streams, functionName: 'rewardDuration' })).toBe(streamArgs[1])
		expect(await owner().readContract({ ...index, functionName: 'nextBatch' })).toBe(2n)
		for (const [address, implementation] of [
			[index.address, indexImplementation],
			[streams.address, streamsImplementation],
		] as const) {
			expect((await owner().getCode({ address }))?.toLowerCase()).toBe(boundCloneRuntimeCode(implementation, childLedger).toLowerCase())
			expect(await owner().readContract({ ...index, address, functionName: 'capitalLedger' })).toBe(childLedger)
			await expect(owner().readContract({ ...index, address: implementation, functionName: 'capitalLedger' })).rejects.toThrow('Capital module requires a clone')
			await expect(other().call({ to: address, value: 1n, gas: 23_300n })).rejects.toThrow()
		}
		await expect(other().simulateContract({ ...index, functionName: 'initialize' })).rejects.toThrow('Only commitment deployer')
		await expect(indexFactoryCaller.simulateContract({ ...index, functionName: 'initialize' })).rejects.toThrow('Commitment index already initialized')
		await expect(indexFactoryCaller.simulateContract({ ...index, address: indexImplementation, functionName: 'initialize' })).rejects.toThrow('Capital module requires a clone')
		await expect(other().simulateContract({ ...streams, functionName: 'initialize', args: streamArgs })).rejects.toThrow('Only fee streams deployer')
		await expect(streamsFactoryCaller.simulateContract({ ...streams, functionName: 'initialize', args: streamArgs })).rejects.toThrow('Fee streams already initialized')
		await expect(streamsFactoryCaller.simulateContract({ ...streams, address: streamsImplementation, functionName: 'initialize', args: streamArgs })).rejects.toThrow('Capital module requires a clone')

		await checkGas(await initiateQuestionLedgerFork(owner(), parent), 'question fork initiation')
		const prepareFeedHash = await writeContractAndWait(other(), () => other().writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'prepareSecurityPoolPriceFeed', args: [parent, childUniverse], gas: 200_000n }))
		await checkGas(prepareFeedHash, 'price feed deployment', 180_000n)
		const createdFeed = await owner().readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'sharedPriceFeeds', args: [fixture.securityPool, childUniverse] })
		const preparation = await owner().waitForTransactionReceipt({ hash: prepareFeedHash })
		const factoryEvents = preparation.logs.filter(log => getAddress(log.address) === getAddress(factory)).map(log => decodeEventLog({ abi: factoryArtifact.abi, topics: log.topics, data: log.data }))
		expect(factoryEvents).toEqual([{ eventName: 'SharedPriceFeedRegistered', args: { securityPool: getAddress(fixture.securityPool), universeId: childUniverse, priceFeed: getAddress(createdFeed) } }])
		await base.mockWindow.setTime(forkTime + 56n * DAY + 1n)
		await checkGas(await writeContractAndWait(other(), () => other().writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'startBranch', args: [base.genesisUniverse, BigInt(QuestionOutcome.No)], gas: transactionGasLimit })), 'shared branch migration')
		await writeContractAndWait(other(), () => other().writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'prepareChildQuestionLedgerCoordinator', args: [parent, BigInt(QuestionOutcome.No)] }))
		const childCoordinator = await owner().readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getChildQuestionLedgerCoordinator', args: [parent, BigInt(QuestionOutcome.No)] })
		const feed = await owner().readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'priceFeed', args: [childUniverse] })
		const originFeed = await owner().readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'priceFeed', args: [base.genesisUniverse] })
		const feedImplementation = await owner().readContract({ abi: oracleFactoryArtifact.abi, address: getInfraContractAddresses().openOraclePriceCoordinatorFactory, functionName: 'sharedPriceFeedImplementations', args: [factory, fixture.securityPool] })
		for (const [universe, address] of [
			[base.genesisUniverse, originFeed],
			[childUniverse, feed],
		] as const) {
			const token = getRepTokenAddress(universe)
			const feedRef = { abi: feedArtifact.abi, address } as const
			expect((await owner().getCode({ address }))?.toLowerCase()).toBe(boundCloneRuntimeCode(feedImplementation, universeCloneBindings(universe, token)).toLowerCase())
			expect(await owner().readContract({ ...feedRef, functionName: 'universeId' })).toBe(universe)
			expect(await owner().readContract({ ...feedRef, functionName: 'reputationToken' })).toBe(token)
			await expect(other().call({ to: address, value: 1n, gas: 23_300n })).rejects.toThrow()
		}
		await expect(other().simulateContract({ abi: feedArtifact.abi, address: feedImplementation, functionName: 'requestSecurityPoolPrice', args: [1n, 0n, 0n] })).rejects.toThrow('Universe module requires a clone')
		const coordinatorCaller = createWriteClient(base.mockWindow, BigInt(childCoordinator))
		// Coordinator registration requires the native child, whose preparation
		// cannot bypass the shared fork activation window.
		await expect(coordinatorCaller.simulateContract({ abi: feedArtifact.abi, address: feed, functionName: 'requestPrice', args: [other().account.address, 1n, 0n, 0n] })).rejects.toThrow('Unregistered coordinator')
		await expect(other().simulateContract({ abi: forkerArtifact.abi, address: forker, functionName: 'prepareSecurityPoolQuestion', args: [parent, childUniverse] })).rejects.toThrow('Fork activation window still open')
		await base.mockWindow.setTime(forkTime + 63n * DAY)
		await checkGas(await writeContractAndWait(other(), () => other().writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'finalizeBranch', args: [childUniverse] })), 'shared branch activation', 2_000_000n)
		await checkGas(await writeContractAndWait(other(), () => other().writeContract({ abi: forkerArtifact.abi, address: forker, functionName: 'prepareSecurityPoolQuestion', args: [parent, childUniverse] })), 'question preparation')
		const child = await owner().readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'getPool', args: [secondQuestionId, childUniverse] })
		expect(await getQuestionLedgersEscalationGame(owner(), child)).toBe(zeroAddress)
		for (let outcome = 0; outcome < 3; outcome++) {
			await checkGas(await writeContractAndWait(other(), () => other().writeContract({ abi: forkerArtifact.abi, address: forker, functionName: 'materializeSecurityPoolQuestion', args: [parent, childUniverse], gas: transactionGasLimit })), `question carry outcome ${outcome}`)
			const game = await getQuestionLedgersEscalationGame(owner(), child)
			expect(await owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'forkCarrySnapshotOutcomesInitialized' })).toBe(BigInt(outcome + 1))
			if (outcome < 2) {
				expect(await getSystemState(owner(), child)).toBe(SystemState.ForkMigration)
				expect(await owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'forkResumedAt' })).toBe(0n)
				await expect(owner().simulateContract({ abi: poolArtifact.abi, address: child, functionName: 'depositWalletRepToEscalationGame', args: [QuestionOutcome.Yes, 1n] })).rejects.toThrow()
				await expect(owner().simulateContract({ abi: poolArtifact.abi, address: child, functionName: 'resumeForkedEscalationGame' })).rejects.toThrow()
			}
		}
		const childGame = await getQuestionLedgersEscalationGame(owner(), child)
		expect(await getSystemState(owner(), child)).toBe(SystemState.Operational)
		expect(await owner().readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkCarrySnapshotInitialized' })).toBe(true)
		const [, activatedAt] = await owner().readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'clocks', args: [childUniverse] })
		expect(await owner().readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkResumedAt' })).toBe(BigInt(activatedAt))
		for (const outcome of outcomes) {
			const state = await getEscalationGameOutcomeState(owner(), childGame, outcome)
			const expected = parentStates[outcome]
			if (expected === undefined) throw new Error('Missing parent outcome state')
			expect(state.currentLeafCount).toBe(leafCount)
			expect(state.snapshotCarryRoot).toEqual(expected.currentCarryRoot)
			expect(state.currentPeaks).toEqual(expected.currentPeaks)
			expect(state.balanceAttoRep).toBe(expected.balanceAttoRep)
		}
		if (process.env['REPORT_BOUNDED_FORK_GAS'] === '1') console.log('Bounded central fork gas', gasMeasurements)
	})

	test('choose and startBranch each initialize a fresh branch with no native child', async () => {
		const { base, owner, other } = fixture
		const source = base.genesisUniverse
		const coordinator = { abi: coordinatorArtifact.abi, address: await owner().readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'forkController' }) } as const
		const nativeToken = (universe: bigint) => owner().readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getRepToken', args: [universe] })
		await fixture.prepare()
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await approveToken(owner(), getRepTokenAddress(source), getZoltarAddress())
		await forkUniverse(owner(), source, base.questionId)
		const yes = getChildUniverseId(source, QuestionOutcome.Yes)
		const no = getChildUniverseId(source, QuestionOutcome.No)
		expect(await nativeToken(yes)).toBe(zeroAddress)
		expect(await nativeToken(no)).toBe(zeroAddress)
		const choiceHash = await writeContractAndWait(owner(), () => owner().writeContract({ ...coordinator, functionName: 'choose', args: [source, BigInt(QuestionOutcome.Yes)], gas: 4_000_000n }))
		expect(await nativeToken(yes)).toBe(getRepTokenAddress(yes))
		expect([...(await owner().readContract({ ...coordinator, functionName: 'choices', args: [source, owner().account.address] }))]).toEqual([BigInt(QuestionOutcome.Yes), true])
		const forkTime = (await getUniverseData(owner(), source)).forkTime
		await base.mockWindow.setTime(forkTime + 56n * DAY + 1n)
		const startHash = await writeContractAndWait(other(), () => other().writeContract({ ...coordinator, functionName: 'startBranch', args: [source, BigInt(QuestionOutcome.No)], gas: 4_000_000n }))
		expect(await nativeToken(no)).toBe(getRepTokenAddress(no))
		expect((await owner().readContract({ ...coordinator, functionName: 'branches', args: [no] })).slice(6)).toEqual([true, true, false])
		if (process.env['REPORT_BOUNDED_FORK_GAS'] === '1') console.log('Fresh branch entrypoint gas', { choose: (await owner().getTransactionReceipt({ hash: choiceHash })).gasUsed, startBranch: (await owner().getTransactionReceipt({ hash: startHash })).gasUsed })
	})
})
