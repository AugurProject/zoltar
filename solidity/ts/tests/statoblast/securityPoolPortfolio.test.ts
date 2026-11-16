import { describe, expect, test } from 'bun:test'
import { decodeEventLog, encodeDeployData, getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	ReputationToken_ReputationToken as repArtifact,
} from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { deployContract } from '../../testSupport/deployContract'
import { applyLibraries, getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getTestPortfolioDeployers } from '../../testSupport/simulator/utils/contracts/deployTestPortfolio'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createCompleteSet, depositRepToVault, redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { maximumQuestionHorizonSeconds, portfolioEconomics, unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: central portfolio and native question integration', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const capital = () => ({ abi: capitalArtifact.abi, address: fixture.capitalLedger })
	const demand = () => fixture.owner().readContract({ ...capital(), functionName: 'demandAttoEth' })
	const ownerAccount = () => fixture.owner().readContract({ ...capital(), functionName: 'ownerAccount', args: [fixture.owner().account.address] })

	test('invalid setup economics and missing module code are rejected before creating an unfinished portfolio', async () => {
		const infrastructure = getInfraContractAddresses()
		const deployers = getTestPortfolioDeployers()
		const deploy = (configuration = portfolioEconomics, modules = deployers, reportPriorityFeeAttoEthPerGas = 10_000_000_000n, securityMultiplierBps = fixture.base.statoblastSecurityMultiplierBps) =>
			deployContract(
				fixture.owner(),
				encodeDeployData({
					abi: portfolioArtifact.abi,
					bytecode: applyLibraries(portfolioArtifact.evm.bytecode.object),
					args: [
						infrastructure.securityPoolFactory,
						{ collateralToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', minimumReportCollateral: 10n ** 16n, universeId: fixture.base.genesisUniverse, securityMultiplierBps, reportPriorityFeeAttoEthPerGas },
						maximumQuestionHorizonSeconds,
						modules,
						fixture.questionAdmissionPolicy,
						configuration,
					],
				}),
			)
		await expect(deploy(portfolioEconomics, deployers, 0n)).rejects.toThrow('Initial priority fee zero')
		for (const multiplier of [10_002n, 10_499n]) await expect(deploy(portfolioEconomics, deployers, 10_000_000_000n, multiplier)).rejects.toThrow('Multiplier must be at least 10500 BPS')
		for (const minimumOutcomeRate of [0n, unit + 1n]) await expect(deploy({ ...portfolioEconomics, minimumOutcomeRate })).rejects.toThrow('Invalid minimum exchange rate')
		await expect(deploy({ ...portfolioEconomics, annualFeeBps: 10_001n })).rejects.toThrow('Invalid portfolio economics')
		for (const key of Object.keys(deployers)) await expect(deploy(portfolioEconomics, { ...deployers, [key]: fixture.owner().account.address })).rejects.toThrow(key === 'auctions' ? 'Auction deployer has no code' : 'Portfolio deployer has no code')
	})

	test('portfolio setup creates its shared capital and oracle without any seed question ledger', async () => {
		const factory = { abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory }
		const before = await fixture.owner().readContract({ ...factory, functionName: 'securityPoolDeploymentCount' })
		const created = await fixture.deployPortfolio()
		expect(await fixture.owner().readContract({ ...factory, functionName: 'securityPoolDeploymentCount' })).toBe(before)
		expect(await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: created, functionName: 'questionCount' })).toBe(0n)
		expect(await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: created, functionName: 'capitalLedger', args: [fixture.base.genesisUniverse] })).not.toBe(zeroAddress)
		expect(await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: created, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })).not.toBe(zeroAddress)
	})

	test('setup registers each portfolio once, in order, before it has any question', async () => {
		const factory = { abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory }
		const count = () => fixture.owner().readContract({ ...factory, functionName: 'portfolioCount' })
		const range = async (start: bigint, size: bigint) => (await fixture.owner().readContract({ ...factory, functionName: 'portfoliosRange', args: [start, size] })).map(address => getAddress(address))
		const before = await count()
		expect(await range(before - 1n, 1n)).toEqual([getAddress(fixture.portfolio)])
		const beforeBlock = await fixture.owner().getBlockNumber()
		const created = await fixture.deployPortfolio()
		expect(await count()).toBe(before + 1n)
		expect(await range(before - 1n, 2n)).toEqual([getAddress(fixture.portfolio), getAddress(created)])
		expect(await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: created, functionName: 'questionCount' })).toBe(0n)
		const registrationLogs = await fixture.owner().getLogs({ address: factory.address, fromBlock: beforeBlock + 1n, toBlock: await fixture.owner().getBlockNumber() })
		const registrations = registrationLogs.map(log => decodeEventLog({ abi: factoryArtifact.abi, data: log.data, topics: log.topics }))
		expect(registrations).toEqual([{ eventName: 'PortfolioRegistered', args: { portfolio: getAddress(created), originUniverseId: fixture.base.genesisUniverse } }])
		// Reconfigure a real namespace: the feed reads its immutable collateral configuration.
		await fixture.base.mockWindow.impersonateAccount(created)
		await fixture.base.mockWindow.setBalance(created, unit)
		const sender = createWriteClient(fixture.base.mockWindow, BigInt(created))
		const configure = () => writeContractAndWait(sender, () => sender.writeContract({ ...factory, functionName: 'initializePortfolioPriceFeed', args: [fixture.base.genesisUniverse, 10_000_000_000n] }))
		const receipt = await sender.getTransactionReceipt({ hash: await configure() })
		expect(receipt.logs.filter(log => getAddress(log.address) === getAddress(factory.address))).toEqual([])
		await configure()
		expect(await count()).toBe(before + 1n)
		expect(await range(before - 1n, 2n)).toEqual([getAddress(fixture.portfolio), getAddress(created)])
		// An account without collateral configuration cannot leave a partial registry entry.
		await expect(writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...factory, functionName: 'initializePortfolioPriceFeed', args: [fixture.base.genesisUniverse, 10_000_000_000n] }))).rejects.toThrow('Shared price feed deployment failed')
		expect(await count()).toBe(before + 1n)
		await expect(range(before + 1n, 1n)).rejects.toThrow('Portfolio range count too large')
	})

	test('permissionless registration binds distinct canonical shares without authorizing or moving owner capital', async () => {
		const { base, owner, poolFor, secondQuestionId } = fixture
		await fixture.deposit()
		const before = await ownerAccount()
		await fixture.register(secondQuestionId)
		expect(await owner().readContract({ ...portfolio(), functionName: 'questionCount' })).toBe(2n)
		expect(await owner().readContract({ ...portfolio(), functionName: 'getQuestions', args: [0n, 10n] })).toEqual([base.questionId, secondQuestionId])
		expect(poolFor(base.questionId).shareToken).not.toBe(poolFor(secondQuestionId).shareToken)
		for (const question of [base.questionId, secondQuestionId]) {
			const pool = poolFor(question).securityPool
			expect(await owner().readContract({ abi: poolArtifact.abi, address: pool, functionName: 'portfolioCustody' })).toBe(fixture.capitalLedger)
			expect(await owner().readContract({ ...portfolio(), functionName: 'getPool', args: [question, base.genesisUniverse] })).toBe(pool)
		}
		expect(await ownerAccount()).toEqual(before)
		expect(await demand()).toBe(0n)
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
		for (const question of [fixture.base.questionId, fixture.secondQuestionId]) expect(await fixture.owner().readContract({ abi: repArtifact.abi, address: token, functionName: 'balanceOf', args: [fixture.poolFor(question).securityPool] })).toBe(0n)
	})

	test('returning complete sets pays traders and retires requested backing without question claims', async () => {
		await fixture.prepare(1_000n * unit, 100n * unit)
		await fixture.mint(100n * unit)
		const id = (await ownerAccount()).positionId
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...capital(), functionName: 'setCommitment', args: [0n] }))
		const pool = fixture.poolFor(fixture.base.questionId)
		const shares = await balanceOfShares(fixture.owner(), pool.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)
		await redeemCompleteSet(fixture.other(), pool.securityPool, shares[0])
		expect(await demand()).toBe(0n)
		const index = await fixture.owner().readContract({ ...capital(), functionName: 'commitmentIndex' })
		expect(await fixture.owner().readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })).toMatchObject({ rep: 0n, commitment: 0n, releasedRep: 1_000n * unit })
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...capital(), functionName: 'withdrawPrincipal', args: [1_000n * unit, fixture.owner().account.address] }))
		expect((await ownerAccount()).freeAttoRep).toBe(0n)
	})

	test('bound native entry points cannot bypass purchase fees or create manual competing backing', async () => {
		await fixture.prepare()
		const pool = fixture.poolFor(fixture.base.questionId).securityPool
		await expect(createCompleteSet(fixture.other(), pool, unit)).rejects.toThrow('Use portfolio purchase')
		await expect(depositRepToVault(fixture.owner(), pool, 100n * unit)).rejects.toThrow()
		expect(await fixture.owner().readContract({ ...capital(), functionName: 'totalFreeAttoRep' })).toBe(0n)
		await expect(fixture.other().writeContract({ ...portfolio(), functionName: 'mintQuestionSettlement', args: [unit] })).rejects.toThrow('Unknown question callback')
		await expect(fixture.other().writeContract({ ...portfolio(), functionName: 'onSharedPriceAccepted', args: [fixture.base.genesisUniverse, unit, 1] })).rejects.toThrow('Only canonical shared feed')
		await expect(fixture.other().writeContract({ ...capital(), functionName: 'setDemand', args: [0n] })).rejects.toThrow('Only demand accounting')
	})

	test('a registered pool cannot mint settlement outside an authorized funded purchase', async () => {
		await fixture.prepare()
		const pool = fixture.poolFor(fixture.base.questionId).securityPool
		await fixture.base.mockWindow.impersonateAccount(pool)
		await fixture.base.mockWindow.setBalance(pool, unit)
		const caller = createWriteClient(fixture.base.mockWindow, BigInt(pool))
		const beforeDemand = await demand()
		const settlement = await fixture.owner().readContract({ ...portfolio(), functionName: 'settlement' })
		const snapshot = () => fixture.owner().readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'snapshotQuestion', args: [pool] })
		const before = await snapshot()
		await expect(writeContractAndWait(caller, () => caller.writeContract({ ...portfolio(), functionName: 'mintQuestionSettlement', args: [unit] }))).rejects.toThrow('No authorized portfolio purchase')
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
		expect(await fixture.owner().readContract({ ...portfolio(), functionName: 'availableMintCapacity', args: [fixture.base.genesisUniverse] })).toBe(0n)
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
		const receipt = await fixture.owner().waitForTransactionReceipt({ hash: await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...capital(), functionName: 'claimEarnings' })) })
		expect(receipt.gasUsed).toBeLessThan(500_000n)
	})

	test('a second portfolio cannot spend the first portfolio capital or share balances', async () => {
		await fixture.prepare()
		const second = await fixture.deployPortfolio()
		await fixture.register(fixture.base.questionId, second)
		const secondPool = fixture.poolFor(fixture.base.questionId, fixture.base.genesisUniverse, zeroAddress, second)
		expect(secondPool.securityPool).not.toBe(fixture.poolFor(fixture.base.questionId).securityPool)
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
		const capacity = await fixture.owner().readContract({ ...portfolio(), functionName: 'availableMintCapacity', args: [fixture.base.genesisUniverse] })
		expect(capacity).toBe(90n * unit - (await demand()))
		await fixture.mint(10n * unit)
		expect(await fixture.owner().readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })).toMatchObject({ rep: 1_000n * unit, commitment: 90n * unit, remainingCommitment: 0n, batch: 0n })
	})
})
