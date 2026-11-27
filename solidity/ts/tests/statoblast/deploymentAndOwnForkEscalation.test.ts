import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, parseAbiParameters, encodeFunctionData, isHex, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_QuestionForker_QuestionForker as forkerArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_tokens_ShareToken_ShareToken as shareArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	Zoltar_Zoltar as zoltarArtifact,
} from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { approveToken, getChildUniverseId, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, splitMigrationRep, deployChild, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { createCarryProof, hashCarryLeaf } from '../carryProofHelpers'
import { securityPoolEconomics, unit, useSecurityPoolFixture } from './securityPoolFixture'

describe('Statoblast: security pool namespaces and own-fork claims', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const pool = () => fixture.poolFor(fixture.base.questionId).questionLedger
	const securityPool = (address = fixture.securityPool) => ({ abi: securityPoolArtifact.abi, address })
	const forker = () => ({ abi: forkerArtifact.abi, address: getInfraContractAddresses().questionForker })
	const factory = () => ({ abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory })
	const activate = async (outcome: number) => {
		const owner = fixture.owner()
		const controller = await owner.readContract({ ...securityPool(), functionName: 'forkController' })
		const branch = { abi: forkArtifact.abi, address: controller }
		const child = getChildUniverseId(fixture.base.genesisUniverse, outcome)
		const forkTime = (await getUniverseData(owner, fixture.base.genesisUniverse)).forkTime
		if ((await fixture.base.mockWindow.getTime()) < forkTime + 63n * DAY) await fixture.base.mockWindow.setTime(forkTime + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'startBranch', args: [fixture.base.genesisUniverse, BigInt(outcome)] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'finalizeBranch', args: [child] }))
		for (let step = 0; step < 3; step++) await writeContractAndWait(owner, () => owner.writeContract({ ...forker(), functionName: 'materializeSecurityPoolQuestion', args: [pool(), child] }))
		const childPool = await owner.readContract({ ...securityPool(), functionName: 'getQuestionLedger', args: [fixture.base.questionId, child] })
		return { child, childPool }
	}

	test('#1495: the constructor rejects an unusable priority fee without SDK validation', async () => {
		const configuration = encodeAbiParameters(parseAbiParameters('address,uint256,uint248,uint256,uint256,uint256,address,uint256,uint256,uint256,uint256,uint256,uint48'), [
			'0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
			10n ** 16n,
			fixture.base.genesisUniverse,
			20_000n,
			MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS + 1n,
			365n * DAY,
			fixture.questionAdmissionPolicy,
			securityPoolEconomics.purchaseFeeBps,
			securityPoolEconomics.annualFeeBps,
			securityPoolEconomics.minimumPurchaseFeeAttoEth,
			securityPoolEconomics.minimumCommitmentAttoEth,
			securityPoolEconomics.minimumOutcomeRate,
			securityPoolEconomics.rewardVestingSeconds,
		])
		await expect(fixture.owner().simulateContract({ ...factory(), functionName: 'deploySecurityPool', args: [`0x${securityPoolArtifact.evm.bytecode.object}`, configuration] })).rejects.toThrow('Initial report priority fee exceeds OpenOracle limits')
	})

	test('rejects missing universes and invalid origin parameters', async () => {
		const simulateOrigin = async ({ securityMultiplierBps = 20_000n, universeId = fixture.base.genesisUniverse, priorityFee = 10n ** 10n } = {}) => {
			const configuration = encodeAbiParameters(parseAbiParameters('address,uint256,uint248,uint256,uint256,uint256,address,uint256,uint256,uint256,uint256,uint256,uint48'), [
				'0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
				10n ** 16n,
				universeId,
				securityMultiplierBps,
				priorityFee,
				365n * DAY,
				fixture.questionAdmissionPolicy,
				securityPoolEconomics.purchaseFeeBps,
				securityPoolEconomics.annualFeeBps,
				securityPoolEconomics.minimumPurchaseFeeAttoEth,
				securityPoolEconomics.minimumCommitmentAttoEth,
				securityPoolEconomics.minimumOutcomeRate,
				securityPoolEconomics.rewardVestingSeconds,
			])
			return await fixture.owner().simulateContract({ ...factory(), functionName: 'deploySecurityPool', args: [`0x${securityPoolArtifact.evm.bytecode.object}`, configuration] })
		}
		for (const securityMultiplierBps of [0n, 10_000n, 10_001n, 10_002n, 10_499n]) await expect(simulateOrigin({ securityMultiplierBps })).rejects.toThrow('Multiplier must be at least 10500 BPS')
		await expect(simulateOrigin({ universeId: 999999n })).rejects.toThrow('Universe REP token missing')
		await expect(simulateOrigin({ priorityFee: 0n })).rejects.toThrow('Initial priority fee zero')

		for (const securityMultiplierBps of [10_500n, 15_000n]) {
			const created = await fixture.deploySecurityPool(undefined, undefined, { securityMultiplierBps })
			await fixture.register(fixture.base.questionId, created)
			const native = await fixture.owner().readContract({ ...securityPool(created), functionName: 'getQuestionLedger', args: [fixture.base.questionId, fixture.base.genesisUniverse] })
			expect(await fixture.owner().readContract({ abi: poolArtifact.abi, address: native, functionName: 'statoblastSecurityMultiplierBps' })).toBe(securityMultiplierBps)
		}
	})

	test('independent security pools cannot share collateral or overwrite the canonical token namespace', async () => {
		const owner = fixture.owner()
		await fixture.prepare()
		await fixture.mint(3n * unit)
		const second = await fixture.deploySecurityPool()
		await fixture.register(fixture.base.questionId, second)
		await fixture.deposit(2_000n * unit, owner, second)
		await fixture.refreshPrice(fixture.base.questionId, unit, second)
		await fixture.authorize(100n * unit, owner, second)
		await fixture.mint(7n * unit, fixture.base.questionId, { namespace: second })
		const secondPool = await owner.readContract({ ...securityPool(second), functionName: 'getQuestionLedger', args: [fixture.base.questionId, fixture.base.genesisUniverse] })
		const origins = []
		const tokens = []
		for (const [namespace, native, cash] of [
			[fixture.securityPool, pool(), 3n * unit],
			[second, secondPool, 7n * unit],
		] as const) {
			const origin = await owner.readContract({ ...factory(), functionName: 'getQuestionLedgerOriginId', args: [native] })
			const token = await owner.readContract({ abi: poolArtifact.abi, address: native, functionName: 'shareToken' })
			origins.push(origin)
			tokens.push(token)
			expect(await owner.readContract({ ...factory(), functionName: 'getQuestionLedger', args: [origin, fixture.base.genesisUniverse] })).toBe(native)
			expect(await owner.readContract({ ...factory(), functionName: 'securityPoolOf', args: [native] })).toBe(namespace)
			expect(await owner.readContract({ abi: poolArtifact.abi, address: native, functionName: 'settlementCollateralAttoEth' })).toBe(cash)
			expect(await owner.readContract({ abi: shareArtifact.abi, address: token, functionName: 'canonicalQuestionLedgerByUniverse', args: [fixture.base.genesisUniverse] })).toBe(native)
			await expect(owner.writeContract({ abi: shareArtifact.abi, address: token, functionName: 'authorize', args: [native === pool() ? secondPool : pool()] })).rejects.toThrow('ShareToken caller is not authorized')
		}
		expect(origins[0]).not.toBe(origins[1])
		expect(tokens[0]).not.toBe(tokens[1])
		const count = await owner.readContract({ ...factory(), functionName: 'questionLedgerDeploymentCount' })
		await fixture.register(fixture.base.questionId, second)
		expect(await owner.readContract({ ...factory(), functionName: 'questionLedgerDeploymentCount' })).toBe(count)
	})

	test('sibling branches and a new descendant security pool retain separate canonical ledgers', async () => {
		const owner = fixture.owner()
		const question = { ...fixture.base.questionData, title: 'Namespace fork', endTime: (await fixture.base.mockWindow.getTime()) + DAY }
		await createQuestion(owner, question, fixture.base.outcomes)
		await fixture.base.mockWindow.setTime(question.endTime + 1n)
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner, fixture.base.genesisUniverse, getQuestionId(question, fixture.base.outcomes))
		await expect(fixture.deploySecurityPool()).rejects.toThrow('Origin universe forked')
		const yes = await activate(1)
		const no = await activate(2)
		const independent = await fixture.deploySecurityPool(undefined, securityPoolEconomics, { universeId: yes.child })
		await fixture.register(fixture.base.questionId, independent)
		const independentPool = await owner.readContract({ ...securityPool(independent), functionName: 'getQuestionLedger', args: [fixture.base.questionId, yes.child] })
		const inheritedOrigin = await owner.readContract({ ...factory(), functionName: 'getQuestionLedgerOriginId', args: [pool()] })
		const inheritedToken = fixture.poolFor(fixture.base.questionId).shareToken
		for (const { child, childPool } of [yes, no]) {
			expect(await owner.readContract({ ...factory(), functionName: 'getQuestionLedger', args: [inheritedOrigin, child] })).toBe(childPool)
			expect(await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'shareToken' })).toBe(inheritedToken)
			expect(await owner.readContract({ abi: shareArtifact.abi, address: inheritedToken, functionName: 'canonicalQuestionLedgerByUniverse', args: [child] })).toBe(childPool)
		}
		const independentOrigin = await owner.readContract({ ...factory(), functionName: 'getQuestionLedgerOriginId', args: [independentPool] })
		expect(independentOrigin).not.toBe(inheritedOrigin)
		expect(independentPool).not.toBe(yes.childPool)
		expect(await owner.readContract({ abi: poolArtifact.abi, address: independentPool, functionName: 'shareToken' })).not.toBe(inheritedToken)
		expect(await owner.readContract({ ...factory(), functionName: 'getQuestionLedger', args: [independentOrigin, yes.child] })).toBe(independentPool)
	})

	test('a deep independent origin deploys without materializing its ancestor questions', async () => {
		const owner = fixture.owner()
		let universe = fixture.base.genesisUniverse
		for (const outcome of [1, 2]) {
			const question = { ...fixture.base.questionData, title: `Deep namespace fork ${universe}`, endTime: (await fixture.base.mockWindow.getTime()) + DAY }
			await createQuestion(owner, question, fixture.base.outcomes)
			await fixture.base.mockWindow.setTime(question.endTime + 1n)
			await approveToken(owner, getRepTokenAddress(universe), getZoltarAddress())
			await forkUniverse(owner, universe, getQuestionId(question, fixture.base.outcomes))
			if (outcome === 1) {
				await addRepToMigrationBalance(owner, universe, 1_000_000n * unit)
				await splitMigrationRep(owner, universe, 1_000_000n * unit, [BigInt(outcome)])
			} else await deployChild(owner, universe, BigInt(outcome))
			const forkTime = (await getUniverseData(owner, universe)).forkTime
			universe = getChildUniverseId(universe, outcome)
			await fixture.base.mockWindow.setTime(forkTime + 70n * DAY)
		}
		const priorityFee = 20n * 10n ** 9n
		const independent = await fixture.deploySecurityPool(undefined, undefined, { universeId: universe, reportPriorityFeeAttoEthPerGas: priorityFee })
		await fixture.register(fixture.base.questionId, independent)
		const native = await owner.readContract({ ...securityPool(independent), functionName: 'getQuestionLedger', args: [fixture.base.questionId, universe] })
		const expectedOrigin = await owner.readContract({ ...factory(), functionName: 'getQuestionOriginId', args: [independent, universe, fixture.base.questionId, fixture.base.statoblastSecurityMultiplierBps, priorityFee] })
		expect(await owner.readContract({ ...factory(), functionName: 'getQuestionLedgerOriginId', args: [native] })).toBe(expectedOrigin)
		expect(await owner.readContract({ ...securityPool(independent), functionName: 'initialReportPriorityFeeAttoEthPerGas' })).toBe(priorityFee)
		const token = await owner.readContract({ abi: poolArtifact.abi, address: native, functionName: 'shareToken' })
		expect(await owner.readContract({ abi: shareArtifact.abi, address: token, functionName: 'canonicalQuestionLedgerByUniverse', args: [universe] })).toBe(native)
	})

	const payoutCases = [false, true].flatMap(reverse => [
		{ reverse, sameBlock: false, migrationDivisor: 0n },
		{ reverse, sameBlock: true, migrationDivisor: 0n },
		{ reverse, sameBlock: true, migrationDivisor: 2n },
		{ reverse, sameBlock: true, migrationDivisor: 1n },
	])
	test.each(payoutCases)('own-fork reporter payouts conserve escrow (reverse $reverse, same block $sameBlock, migration divisor $migrationDivisor)', async ({ reverse, sameBlock, migrationDivisor }) => {
		const owner = fixture.owner()
		const other = fixture.other()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		const threshold = await owner.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getNonDecisionThresholdAttoRep', args: [fixture.base.genesisUniverse] })
		const amounts = [threshold / 3n + 1n, threshold - threshold / 3n - 1n]
		for (const [index, sender] of [owner, other].entries()) {
			const amount = amounts[index]
			if (amount === undefined) throw new Error('Missing reporter amount')
			await approveToken(sender, getRepTokenAddress(fixture.base.genesisUniverse), pool())
			await writeContractAndWait(sender, () => sender.writeContract({ abi: poolArtifact.abi, address: pool(), functionName: 'depositWalletRepToEscalationGame', args: [1, amount] }))
		}
		if (sameBlock) {
			await fixture.base.mockWindow.requestRaw({ method: 'anvil_setAutomine', params: [false] })
			try {
				const submit = async (to: Address, data: `0x${string}`): Promise<Hash> => {
					const hash = await fixture.base.mockWindow.requestRaw({ method: 'eth_sendTransaction', params: [{ from: owner.account.address, to, data, gas: '0x7a1200', gasPrice: '0x0' }] })
					if (typeof hash !== 'string' || !isHex(hash, { strict: true }) || hash.length !== 66) throw new Error('Anvil returned an invalid transaction hash')
					return `0x${hash.slice(2)}`
				}
				const deposit = await submit(pool(), encodeFunctionData({ abi: poolArtifact.abi, functionName: 'depositWalletRepToEscalationGame', args: [2, threshold] }))
				const fork = await submit(forker().address, encodeFunctionData({ abi: forkerArtifact.abi, functionName: 'forkZoltarWithOwnEscalationGame', args: [pool()] }))
				await fixture.base.mockWindow.requestRaw({ method: 'evm_mine', params: [] })
				const depositReceipt = await owner.getTransactionReceipt({ hash: deposit })
				const forkReceipt = await owner.getTransactionReceipt({ hash: fork })
				expect(depositReceipt.status).toBe('success')
				expect(forkReceipt.status).toBe('success')
				expect(depositReceipt.blockHash).toBe(forkReceipt.blockHash)
			} finally {
				await fixture.base.mockWindow.requestRaw({ method: 'anvil_setAutomine', params: [true] })
			}
		} else {
			await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool(), functionName: 'depositWalletRepToEscalationGame', args: [2, threshold] }))
			await writeContractAndWait(owner, () => owner.writeContract({ ...forker(), functionName: 'forkZoltarWithOwnEscalationGame', args: [pool()] }))
		}
		const source = await owner.readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'escalationGame' })
		const forkTime = (await getUniverseData(owner, fixture.base.genesisUniverse)).forkTime
		const completion = await owner.readContract({ abi: gameArtifact.abi, address: source, functionName: 'getEscalationGameEndDate' })
		expect(forkTime === completion).toBe(sameBlock)
		if (migrationDivisor !== 0n) {
			for (const account of TEST_ADDRESSES) {
				const sender = createWriteClient(fixture.base.mockWindow, account)
				const amount = (await getERC20Balance(owner, getRepTokenAddress(fixture.base.genesisUniverse), sender.account.address)) / migrationDivisor
				if (amount === 0n) continue
				await approveToken(sender, getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
				await addRepToMigrationBalance(sender, fixture.base.genesisUniverse, amount)
			}
			if (migrationDivisor === 1n) expect(await owner.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getForkThresholdAttoRep', args: [fixture.base.genesisUniverse] })).toBeLessThan(threshold)
		}
		const { child, childPool } = await activate(1)
		const childGame = await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'escalationGame' })
		const reporters = await owner.readContract({ ...securityPool(), functionName: 'reporterLedger', args: [child] })
		const escrow = () => owner.readContract({ abi: reporterArtifact.abi, address: reporters, functionName: 'balanceOfGame', args: [childGame] })
		const originalEscrow = await escrow()
		const end = await owner.readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'getEscalationGameEndDate' })
		await fixture.base.mockWindow.setTime(end + 1n)
		const capital = await owner.readContract({ ...securityPool(), functionName: 'capitalLedger', args: [child] })
		const balances = new Map<Address, bigint>()
		for (const sender of [owner, other]) balances.set(sender.account.address, await getERC20Balance(owner, getRepTokenAddress(child), sender.account.address))
		const nodes = await Promise.all([1n, 2n].map(id => owner.readContract({ abi: gameArtifact.abi, address: source, functionName: 'nodes', args: [id] })))
		const leaves = nodes.map((node, index) => hashCarryLeaf(node[1], 1, node[3], BigInt(index), node[5], BigInt(index + 1)))
		for (const index of reverse ? [1, 0] : [0, 1]) {
			const sibling = leaves[1 - index]
			if (sibling === undefined) throw new Error('Missing sibling leaf')
			const proof = await createCarryProof(owner, source, { expectedOutcome: 1, parentDepositIndex: BigInt(index), sourceNodeId: BigInt(index + 1), leafIndex: BigInt(index), merkleMountainRangePeakIndex: 1n, merkleMountainRangeSiblings: [sibling] })
			await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'withdrawForkedEscalationDeposits', args: [1, [proof]] }))
			await expect(owner.writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'withdrawForkedEscalationDeposits', args: [1, [proof]] })).rejects.toThrow()
		}
		let paid = 0n
		for (const [index, sender] of [owner, other].entries()) {
			const amount = amounts[index]
			const before = balances.get(sender.account.address)
			if (amount === undefined || before === undefined) throw new Error('Missing reporter accounting')
			const payout = (await getERC20Balance(owner, getRepTokenAddress(child), sender.account.address)) - before
			expect(payout).toBe(amount + (amount * 3n) / 5n)
			paid += payout
			expect((await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerCollateral', args: [sender.account.address] }))[0]).toBe(0n)
		}
		const remaining = await escrow()
		expect(paid + remaining).toBe(originalEscrow)
		expect(remaining).toBeLessThanOrEqual(1n)
	})
})
