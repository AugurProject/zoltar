import { describe, expect, test } from 'bun:test'
import { decodeEventLog, encodeAbiParameters, encodeDeployData, encodeFunctionData, parseAbi, getAddress, parseAbiParameters, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	ReputationToken_ReputationToken as repArtifact,
	statoblast_tokens_ShareToken_ShareToken as shareArtifact,
} from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { deployContract } from '../../testSupport/deployContract'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getTestSecurityPoolDeployers } from '../../testSupport/simulator/utils/contracts/deployTestSecurityPool'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createCompleteSet, redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/questionLedger'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { maximumQuestionHorizonSeconds, securityPoolEconomics, unit, useSecurityPoolFixture } from './securityPoolFixture'

// The creator-chosen tail of the security pool constructor, which the factory appends to its own leading arguments.
const securityPoolConfigurationInputs = parseAbiParameters(
	'(address collateralToken,uint256 minimumReportCollateral,uint248 universeId,uint256 securityMultiplierBps,uint256 reportPriorityFeeAttoEthPerGas) origin,uint256 horizon,address admission,(uint256 purchaseFeeBps,uint256 annualFeeBps,uint256 minimumPurchaseFeeAttoEth,uint256 minimumCommitmentAttoEth,uint256 minimumOutcomeRate,uint48 rewardVestingSeconds) economics',
)

describe('Statoblast: central security pool and native question integration', () => {
	const fixture = useSecurityPoolFixture()
	const securityPool = () => ({ abi: securityPoolArtifact.abi, address: fixture.securityPool })
	const capital = () => ({ abi: capitalArtifact.abi, address: fixture.capitalLedger })
	const demand = () => fixture.owner().readContract({ ...capital(), functionName: 'demandAttoEth' })
	const ownerAccount = () => fixture.owner().readContract({ ...capital(), functionName: 'ownerAccount', args: [fixture.owner().account.address] })

	test('invalid setup economics and missing module code are rejected before creating an unfinished security pool', async () => {
		const infrastructure = getInfraContractAddresses()
		const deployers = getTestSecurityPoolDeployers()
		const origin = (reportPriorityFeeAttoEthPerGas: bigint, securityMultiplierBps = fixture.base.statoblastSecurityMultiplierBps) => ({
			collateralToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const,
			minimumReportCollateral: 10n ** 16n,
			universeId: fixture.base.genesisUniverse,
			securityMultiplierBps,
			reportPriorityFeeAttoEthPerGas,
		})
		const factory = { abi: factoryArtifact.abi, address: infrastructure.securityPoolFactory }
		const creationCode = `0x${securityPoolArtifact.evm.bytecode.object}` as const
		// The factory call is encoded here, without the SDK's validation, so the constructor's own checks are the ones exercised.
		const deploy = (configuration = securityPoolEconomics, reportPriorityFeeAttoEthPerGas = 10_000_000_000n, securityMultiplierBps = fixture.base.statoblastSecurityMultiplierBps) =>
			writeContractAndWait(fixture.owner(), () =>
				fixture.owner().writeContract({
					...factory,
					functionName: 'deploySecurityPool',
					args: [creationCode, encodeAbiParameters(securityPoolConfigurationInputs, [origin(reportPriorityFeeAttoEthPerGas, securityMultiplierBps), maximumQuestionHorizonSeconds, fixture.questionAdmissionPolicy, configuration])],
					gas: 16_777_216n,
				}),
			)
		const securityPoolCount = () => fixture.owner().readContract({ ...factory, functionName: 'securityPoolCount' })
		const before = await securityPoolCount()
		await expect(deploy(securityPoolEconomics, 0n)).rejects.toThrow('Initial priority fee zero')
		for (const multiplier of [10_002n, 10_499n]) await expect(deploy(securityPoolEconomics, 10_000_000_000n, multiplier)).rejects.toThrow('Multiplier must be at least 10500 BPS')
		for (const minimumOutcomeRate of [0n, unit + 1n]) await expect(deploy({ ...securityPoolEconomics, minimumOutcomeRate })).rejects.toThrow('Invalid minimum exchange rate')
		await expect(deploy({ ...securityPoolEconomics, annualFeeBps: 10_001n })).rejects.toThrow('Invalid security pool economics')
		// Fee streams end at the funding time plus the vesting duration and must fit the uint48 clock. A longer
		// duration deployed, then made every fee funding revert: purchases and escalation deposits with it.
		for (const rewardVestingSeconds of [1n, 86_399n, 2n ** 48n - 1n, 10n * 365n * 86_400n + 1n]) await expect(deploy({ ...securityPoolEconomics, rewardVestingSeconds })).rejects.toThrow('Invalid security pool duration')
		expect(await securityPoolCount()).toBe(before)
		// The longest accepted duration still deploys.
		await deploy({ ...securityPoolEconomics, rewardVestingSeconds: 10n * 365n * 86_400n })
		await deploy({ ...securityPoolEconomics, rewardVestingSeconds: 86_400n })
		await deploy({ ...securityPoolEconomics, rewardVestingSeconds: 86_401n })
		// A creator can no longer choose module deployers. The constructor still rejects a deployer without code,
		// which is what stops a factory whose pinned deployers are not all deployed yet from creating a security pool.
		const construct = (modules: typeof deployers) =>
			deployContract(fixture.owner(), encodeDeployData({ abi: securityPoolArtifact.abi, bytecode: creationCode, args: [infrastructure.securityPoolFactory, modules, origin(10_000_000_000n), maximumQuestionHorizonSeconds, fixture.questionAdmissionPolicy, securityPoolEconomics] }))
		for (const key of Object.keys(deployers)) await expect(construct({ ...deployers, [key]: fixture.owner().account.address })).rejects.toThrow(key === 'repairAuctions' ? 'Auction deployer has no code' : 'Security pool deployer has no code')
	})

	test('security pool setup creates its shared capital and oracle without any seed question ledger', async () => {
		const factory = { abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory }
		const before = await fixture.owner().readContract({ ...factory, functionName: 'questionLedgerDeploymentCount' })
		const created = await fixture.deploySecurityPool()
		expect(await fixture.owner().readContract({ ...factory, functionName: 'questionLedgerDeploymentCount' })).toBe(before)
		expect(await fixture.owner().readContract({ abi: securityPoolArtifact.abi, address: created, functionName: 'questionCount' })).toBe(0n)
		expect(await fixture.owner().readContract({ abi: securityPoolArtifact.abi, address: created, functionName: 'capitalLedger', args: [fixture.base.genesisUniverse] })).not.toBe(zeroAddress)
		expect(await fixture.owner().readContract({ abi: securityPoolArtifact.abi, address: created, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })).not.toBe(zeroAddress)
	})

	test('setup registers each security pool once, in order, before it has any question', async () => {
		const factory = { abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory }
		const count = () => fixture.owner().readContract({ ...factory, functionName: 'securityPoolCount' })
		const range = async (start: bigint, size: bigint) => (await fixture.owner().readContract({ ...factory, functionName: 'securityPoolsRange', args: [start, size] })).map(address => getAddress(address))
		const before = await count()
		expect(await range(before - 1n, 1n)).toEqual([getAddress(fixture.securityPool)])
		const beforeBlock = await fixture.owner().getBlockNumber()
		const created = await fixture.deploySecurityPool()
		expect(await count()).toBe(before + 1n)
		expect(await range(before - 1n, 2n)).toEqual([getAddress(fixture.securityPool), getAddress(created)])
		expect(await fixture.owner().readContract({ abi: securityPoolArtifact.abi, address: created, functionName: 'questionCount' })).toBe(0n)
		const registrationLogs = await fixture.owner().getLogs({ address: factory.address, fromBlock: beforeBlock + 1n, toBlock: await fixture.owner().getBlockNumber() })
		const registrations = registrationLogs.map(log => decodeEventLog({ abi: factoryArtifact.abi, data: log.data, topics: log.topics }))
		const feed = await fixture.owner().readContract({ ...factory, functionName: 'sharedPriceFeeds', args: [created, fixture.base.genesisUniverse] })
		expect(registrations).toEqual([
			{ eventName: 'SecurityPoolDeployed', args: { securityPool: getAddress(created), creator: getAddress(fixture.owner().account.address) } },
			{ eventName: 'SecurityPoolRegistered', args: { securityPool: getAddress(created), originUniverseId: fixture.base.genesisUniverse } },
			{ eventName: 'SharedPriceFeedRegistered', args: { securityPool: getAddress(created), universeId: fixture.base.genesisUniverse, priceFeed: getAddress(feed) } },
		])
		expect(await fixture.owner().readContract({ ...factory, functionName: 'isSecurityPool', args: [created] })).toBe(true)
		// Reconfigure a real namespace: the feed reads its immutable collateral configuration.
		await fixture.base.mockWindow.impersonateAccount(created)
		await fixture.base.mockWindow.setBalance(created, unit)
		const sender = createWriteClient(fixture.base.mockWindow, BigInt(created))
		const configure = () => writeContractAndWait(sender, () => sender.writeContract({ ...factory, functionName: 'initializeSecurityPoolPriceFeed', args: [fixture.base.genesisUniverse, 10_000_000_000n] }))
		const receipt = await sender.getTransactionReceipt({ hash: await configure() })
		expect(receipt.logs.filter(log => getAddress(log.address) === getAddress(factory.address))).toEqual([])
		await configure()
		expect(await count()).toBe(before + 1n)
		expect(await range(before - 1n, 2n)).toEqual([getAddress(fixture.securityPool), getAddress(created)])
		// An account the factory did not deploy cannot open a namespace or leave a registry entry.
		await expect(writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...factory, functionName: 'initializeSecurityPoolPriceFeed', args: [fixture.base.genesisUniverse, 10_000_000_000n] }))).rejects.toThrow('Security pool is not canonical')
		expect(await count()).toBe(before + 1n)
		await expect(range(before + 1n, 1n)).rejects.toThrow('Security pool range count too large')
	})

	test('permissionless registration binds distinct canonical shares without authorizing or moving owner capital', async () => {
		const { base, owner, poolFor, secondQuestionId } = fixture
		await fixture.deposit()
		const before = await ownerAccount()
		await fixture.register(secondQuestionId)
		expect(await owner().readContract({ ...securityPool(), functionName: 'questionCount' })).toBe(2n)
		expect(await owner().readContract({ ...securityPool(), functionName: 'getQuestions', args: [0n, 10n] })).toEqual([base.questionId, secondQuestionId])
		expect(poolFor(base.questionId).shareToken).not.toBe(poolFor(secondQuestionId).shareToken)
		for (const question of [base.questionId, secondQuestionId]) {
			const pool = poolFor(question).questionLedger
			expect(await owner().readContract({ abi: poolArtifact.abi, address: pool, functionName: 'securityPoolCustody' })).toBe(fixture.capitalLedger)
			expect(await owner().readContract({ ...securityPool(), functionName: 'getQuestionLedger', args: [question, base.genesisUniverse] })).toBe(pool)
		}
		expect(await ownerAccount()).toEqual(before)
		expect(await demand()).toBe(0n)
	})

	test('an ended question advertises no minting capacity before its first report (#1405)', async () => {
		await fixture.prepare()
		const { base } = fixture
		const pool = { abi: poolArtifact.abi, address: fixture.poolFor(base.questionId).questionLedger }
		const capacity = () => fixture.owner().readContract({ ...pool, functionName: 'additionalMintCapacityAttoEth' })
		await base.mockWindow.setTime(base.questionData.endTime - 600n)
		await fixture.refreshPrice()
		await base.mockWindow.setTime(base.questionData.endTime - 1n)
		expect(await capacity()).toBeGreaterThan(0n)
		await base.mockWindow.setTime(base.questionData.endTime)
		expect(await fixture.owner().readContract({ ...securityPool(), functionName: 'availableMintCapacity', args: [base.genesisUniverse] })).toBeGreaterThan(0n)
		expect(await capacity()).toBe(0n)
	})

	test('#1506: existing question cash is not additional mint capacity', async () => {
		await fixture.prepare(1_000n * unit, 100n * unit)
		await fixture.mint(60n * unit)
		const available = await fixture.owner().readContract({ ...securityPool(), functionName: 'availableMintCapacity', args: [fixture.base.genesisUniverse] })
		for (const question of [fixture.base.questionId, fixture.secondQuestionId]) {
			const address = fixture.poolFor(question).questionLedger
			expect(await fixture.owner().readContract({ abi: poolArtifact.abi, address, functionName: 'additionalMintCapacityAttoEth' })).toBe(available)
		}
	})

	test('#1679 native redemption enforces collateral and REP minima atomically', async () => {
		await fixture.prepare()
		await fixture.mint()
		const trader = fixture.other()
		const pool = fixture.poolFor(fixture.base.questionId)
		const before = await balanceOfShares(trader, pool.shareToken, fixture.base.genesisUniverse, trader.account.address)
		const abi = parseAbi(['function redeemCompleteSet(uint256 shares,uint256 minimumCash,uint256 minimumRep)'])
		const redeem = (cash: bigint, rep: bigint) => writeContractAndWait(trader, () => trader.writeContract({ abi, address: pool.questionLedger, functionName: 'redeemCompleteSet', args: [before[0], cash, rep] }))
		await expect(redeem(1n << 200n, 0n)).rejects.toThrow('Minimum collateral not met')
		await expect(redeem(0n, 1n)).rejects.toThrow('Minimum recovery REP not met')
		expect(await balanceOfShares(trader, pool.shareToken, fixture.base.genesisUniverse, trader.account.address)).toEqual(before)
		await redeem(0n, 0n)
	})

	test('two questions consume one capacity budget while REP remains in one ledger', async () => {
		await fixture.prepare(1_000n * unit, 100n * unit)
		await fixture.mint(60n * unit)
		await expect(fixture.mint(41n * unit, fixture.secondQuestionId)).rejects.toThrow('Purchase exceeds healthy capacity')
		await fixture.mint(39n * unit, fixture.secondQuestionId)
		expect(await demand()).toBeLessThanOrEqual(99n * unit)
		expect(await demand()).toBeGreaterThan(98n * unit)
		const token = getRepTokenAddress(fixture.base.genesisUniverse)
		expect(await fixture.owner().readContract({ abi: repArtifact.abi, address: token, functionName: 'balanceOf', args: [fixture.capitalLedger] })).toBe(1_000n * unit)
		for (const question of [fixture.base.questionId, fixture.secondQuestionId]) expect(await fixture.owner().readContract({ abi: repArtifact.abi, address: token, functionName: 'balanceOf', args: [fixture.poolFor(question).questionLedger] })).toBe(0n)
	})

	test('rejects unsolicited shares at security pool services while delivering a funded purchase (#1408)', async () => {
		await fixture.prepare()
		await fixture.mint()
		const { base } = fixture
		const trader = fixture.other()
		const { shareToken } = fixture.poolFor(base.questionId)
		const services = await trader.readContract({ ...securityPool(), functionName: 'services' })
		const balance = () => balanceOfShares(trader, shareToken, base.genesisUniverse, trader.account.address)
		const before = await balance()
		expect(before[0]).toBeGreaterThan(0n)
		const target = { abi: shareArtifact.abi, address: shareToken }
		const id = base.genesisUniverse << 8n
		await expect(trader.writeContract({ ...target, functionName: 'safeTransferFrom', args: [trader.account.address, services, id, 1n] })).rejects.toThrow('does not implement ERC1155Receiver for single transfers')
		await expect(trader.writeContract({ ...target, functionName: 'safeBatchTransferFrom', args: [trader.account.address, services, [id, id | 1n], [1n, 1n]] })).rejects.toThrow('does not implement ERC1155Receiver for batch transfers')
		expect(await balance()).toEqual(before)
	})

	test('returning complete sets pays traders and lets providers withdraw their own ready requests', async () => {
		await fixture.prepare(1_000n * unit, 100n * unit)
		await fixture.mint(100n * unit)
		const id = (await ownerAccount()).positionId
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...capital(), functionName: 'setCommitment', args: [0n] }))
		const pool = fixture.poolFor(fixture.base.questionId)
		const shares = await balanceOfShares(fixture.owner(), pool.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)
		await redeemCompleteSet(fixture.other(), pool.questionLedger, shares[0])
		expect(await demand()).toBe(0n)
		const index = await fixture.owner().readContract({ ...capital(), functionName: 'commitmentIndex' })
		expect(await fixture.owner().readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })).toMatchObject({ rep: 1_000n * unit, commitment: 100n * unit, remainingCommitment: 0n })
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...capital(), functionName: 'withdrawPrincipal', args: [1_000n * unit, fixture.owner().account.address] }))
		expect((await ownerAccount()).freeAttoRep).toBe(0n)
	})

	test('bound native entry points cannot bypass purchase fees or create manual competing backing', async () => {
		await fixture.prepare()
		const pool = fixture.poolFor(fixture.base.questionId).questionLedger
		await expect(createCompleteSet(fixture.other(), pool, unit)).rejects.toThrow('Use security pool purchase')
		// Encode the removed selector explicitly so the EVM, rather than the current ABI encoder, rejects it.
		const data = encodeFunctionData({ abi: parseAbi(['function depositRepToVault(uint256,uint256)']), functionName: 'depositRepToVault', args: [100n * unit, 15_000n] })
		// The simulator executes and reports reverting transactions before mining them.
		await expect(fixture.owner().sendTransaction({ to: pool, data, gas: 1_000_000n })).rejects.toThrow('execution reverted')
		expect(await fixture.owner().readContract({ ...capital(), functionName: 'totalFreeAttoRep' })).toBe(0n)
		await expect(fixture.other().writeContract({ ...securityPool(), functionName: 'mintQuestionSettlement', args: [unit] })).rejects.toThrow('Unknown question callback')
		await expect(fixture.other().writeContract({ ...securityPool(), functionName: 'onSharedPriceAccepted', args: [fixture.base.genesisUniverse, unit, 1] })).rejects.toThrow('Only canonical shared feed')
		await expect(fixture.other().writeContract({ ...capital(), functionName: 'setDemand', args: [0n] })).rejects.toThrow('Only demand accounting')
	})

	test('a registered pool cannot mint settlement outside an authorized funded purchase', async () => {
		await fixture.prepare()
		const pool = fixture.poolFor(fixture.base.questionId).questionLedger
		await fixture.base.mockWindow.impersonateAccount(pool)
		await fixture.base.mockWindow.setBalance(pool, unit)
		const caller = createWriteClient(fixture.base.mockWindow, BigInt(pool))
		const beforeDemand = await demand()
		const settlement = await fixture.owner().readContract({ ...securityPool(), functionName: 'settlement' })
		const snapshot = () => fixture.owner().readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'snapshotQuestion', args: [pool] })
		const before = await snapshot()
		await expect(writeContractAndWait(caller, () => caller.writeContract({ ...securityPool(), functionName: 'mintQuestionSettlement', args: [unit] }))).rejects.toThrow('No authorized security pool purchase')
		expect(await demand()).toBe(beforeDemand)
		expect(await snapshot()).toEqual(before)
		// The same registered pool can mint through the purchase that funds settlement.
		await fixture.mint(unit)
		expect(await demand()).toBe(beforeDemand + unit)
	})

	test('stale prices block new purchases and live collateral withdrawal while idle owners can exit', async () => {
		await fixture.deposit(1_100n * unit)
		await fixture.refreshPrice()
		await fixture.authorize(100n * unit)
		await fixture.deposit(100n * unit, fixture.other())
		await fixture.base.mockWindow.setTime(await fixture.owner().readContract({ ...capital(), functionName: 'priceValidUntil' }))
		await expect(fixture.mint()).rejects.toThrow()
		expect(await fixture.owner().readContract({ ...securityPool(), functionName: 'availableMintCapacity', args: [fixture.base.genesisUniverse] })).toBe(0n)
		await expect(fixture.owner().writeContract({ ...capital(), functionName: 'withdrawPrincipal', args: [100n * unit, fixture.owner().account.address] })).rejects.toThrow('Capital price stale')
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...capital(), functionName: 'withdrawPrincipal', args: [100n * unit, fixture.other().account.address] }))
		expect((await ownerAccount()).freeAttoRep).toBe(0n)
	})

	test('late question registration cannot reprice, dilute or move existing positions', async () => {
		await fixture.prepare()
		const accountBefore = await ownerAccount()
		const acceptedPrice = await fixture.owner().readContract({ ...capital(), functionName: 'acceptedPrice' })
		const validUntil = await fixture.owner().readContract({ ...capital(), functionName: 'priceValidUntil' })
		for (let i = 0; i < 8; i++) {
			const question = makeQuestion(`Permissionless late question ${i}`, fixture.base.questionData.endTime + BigInt(i + 1))
			const id = getQuestionId(question, fixture.base.outcomes)
			await createQuestion(fixture.owner(), question, fixture.base.outcomes)
			await fixture.register(id)
		}
		expect(await ownerAccount()).toEqual(accountBefore)
		expect(await fixture.owner().readContract({ ...capital(), functionName: 'acceptedPrice' })).toBe(acceptedPrice)
		expect(await fixture.owner().readContract({ ...capital(), functionName: 'priceValidUntil' })).toBe(validUntil)
		const receipt = await fixture.owner().waitForTransactionReceipt({ hash: await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...capital(), functionName: 'claimEarnings', args: [fixture.owner().account.address] })) })
		expect(receipt.gasUsed).toBeLessThan(500_000n)
	})

	test('a second security pool cannot spend the first security pool capital or share balances', async () => {
		await fixture.prepare()
		const second = await fixture.deploySecurityPool()
		await fixture.register(fixture.base.questionId, second)
		const secondPool = fixture.poolFor(fixture.base.questionId, fixture.base.genesisUniverse, zeroAddress, second)
		expect(secondPool.questionLedger).not.toBe(fixture.poolFor(fixture.base.questionId).questionLedger)
		await fixture.refreshPrice(fixture.base.questionId, unit, second)
		await expect(fixture.mint(unit, fixture.base.questionId, { namespace: second })).rejects.toThrow('Purchase exceeds healthy capacity')
		await fixture.refreshPrice()
		await fixture.mint(unit)
		expect(await balanceOfShares(fixture.owner(), secondPool.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)).toEqual([0n, 0n, 0n])
	})
	test('pending partial retirement leaves retained healthy backing available without a queue migration', async () => {
		await fixture.prepare(1_000n * unit, 100n * unit)
		await fixture.mint(20n * unit)
		const id = (await ownerAccount()).positionId
		const index = await fixture.owner().readContract({ ...capital(), functionName: 'commitmentIndex' })
		await fixture.base.mockWindow.setTime(await fixture.owner().readContract({ ...capital(), functionName: 'priceValidUntil' }))
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...capital(), functionName: 'setCommitment', args: [90n * unit] }))
		await fixture.refreshPrice()
		const before = await fixture.owner().readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })
		expect(before).toMatchObject({ commitment: 100n * unit, remainingCommitment: 90n * unit })
		expect(before.batch).not.toBe(0n)
		const capacity = await fixture.owner().readContract({ ...securityPool(), functionName: 'availableMintCapacity', args: [fixture.base.genesisUniverse] })
		expect(capacity).toBe(90n * unit - (await demand()))
		await fixture.mint(10n * unit)
		expect(await fixture.owner().readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })).toMatchObject({ commitment: 100n * unit, remainingCommitment: 90n * unit })
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...capital(), functionName: 'serveRetirement', args: [id] }))
		expect(await fixture.owner().readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })).toMatchObject({ rep: 1_000n * unit, commitment: 90n * unit, remainingCommitment: 0n, batch: 0n })
	})
})
