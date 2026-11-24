import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeDeployData, getAddress, getCreateAddress, keccak256, parseAbiParameters, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { boundCloneRuntimeCode, universeCloneBindings } from '@zoltar/statoblast-shared/statoblast/securityPool'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolCapitalFeeStreams_SecurityPoolCapitalFeeStreams as streamsArtifact,
	statoblast_SecurityPoolOpenAdmissionPolicy_SecurityPoolOpenAdmissionPolicy as openAdmissionArtifact,
} from '../types/contractArtifact'
import { deployContract } from '../testSupport/deployContract'
import { createWriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { getRepTokenAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { maximumQuestionHorizonSeconds, securityPoolEconomics, unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

// Audit regression: registering with the factory used to prove nothing. Any contract could open a pool namespace and
// obtain canonical pools, and a security pool creator chose the module deployers that build the ledgers holding provider
// REP and trader collateral. The factory now deploys every security pool itself from pinned creation code and deployers.
const securityPoolConfigurationInputs = parseAbiParameters(
	'(address collateralToken,uint256 minimumReportCollateral,uint248 universeId,uint256 securityMultiplierBps,uint256 reportPriorityFeeAttoEthPerGas) origin,uint256 horizon,address admission,(uint256 purchaseFeeBps,uint256 annualFeeBps,uint256 minimumPurchaseFeeAttoEth,uint256 minimumCommitmentAttoEth,uint256 minimumOutcomeRate,uint48 rewardVestingSeconds) economics',
)
const weth: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

type RuntimeArtifact = { evm: { deployedBytecode: { object: string; immutableReferences: Readonly<Record<string, readonly { start: number; length: number }[]>> } } }
/** Runtime code with its constructor-set immutables blanked, so only the compiled logic is compared. */
function withoutImmutables(code: Hex, artifact: RuntimeArtifact) {
	let masked = code.toLowerCase()
	for (const reference of Object.values(artifact.evm.deployedBytecode.immutableReferences).flat()) {
		const start = 2 + reference.start * 2
		masked = masked.slice(0, start) + '0'.repeat(reference.length * 2) + masked.slice(start + reference.length * 2)
	}
	return masked
}

describe('audit: only security pools the factory deployed are canonical', () => {
	const fixture = useSecurityPoolFixture()
	const infrastructure = () => getInfraContractAddresses()
	const factory = () => ({ abi: factoryArtifact.abi, address: infrastructure().securityPoolFactory })
	const creationCode = (): Hex => `0x${securityPoolArtifact.evm.bytecode.object}`
	const origin = () => ({ collateralToken: weth, minimumReportCollateral: 10n ** 16n, universeId: fixture.base.genesisUniverse, securityMultiplierBps: fixture.base.statoblastSecurityMultiplierBps, reportPriorityFeeAttoEthPerGas: 10_000_000_000n })
	const configuration = () => encodeAbiParameters(securityPoolConfigurationInputs, [origin(), maximumQuestionHorizonSeconds, fixture.questionAdmissionPolicy, securityPoolEconomics])
	const canonicalDeployers = () => ({
		capital: infrastructure().securityPoolCapitalLedgerDeployer,
		commitments: infrastructure().securityPoolCommitmentIndexDeployer,
		fees: infrastructure().securityPoolCapitalFeeStreamsDeployer,
		books: infrastructure().securityPoolSettlementBookDeployer,
		settlement: infrastructure().securityPoolSettlementDeployer,
		reporters: infrastructure().securityPoolReporterLedgerDeployer,
		forks: infrastructure().securityPoolForkCoordinatorDeployer,
		services: infrastructure().securityPoolServicesDeployer,
		repairAuctions: infrastructure().securityPoolRepairAuctionDeployer,
	})
	/** The pre-fix route: the creator deploys the security pool contract and so chooses its module deployers. */
	const deployOutsideFactory = (deployers = canonicalDeployers()) =>
		deployContract(fixture.owner(), encodeDeployData({ abi: securityPoolArtifact.abi, bytecode: creationCode(), args: [infrastructure().securityPoolFactory, deployers, origin(), maximumQuestionHorizonSeconds, fixture.questionAdmissionPolicy, securityPoolEconomics] }))
	const isSecurityPool = (address: Address) => fixture.owner().readContract({ ...factory(), functionName: 'isSecurityPool', args: [address] })
	const securityPoolCount = () => fixture.owner().readContract({ ...factory(), functionName: 'securityPoolCount' })
	const poolCount = () => fixture.owner().readContract({ ...factory(), functionName: 'questionLedgerDeploymentCount' })
	const setupStage = async (address: Address) => Number(await fixture.owner().readContract({ abi: securityPoolArtifact.abi, address, functionName: 'setupStage' }))
	const prepareNext = (address: Address) => writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: securityPoolArtifact.abi, address, functionName: 'prepareNext', gas: 16_777_216n }))

	test('a contract the factory did not deploy cannot open a namespace or obtain a pool', async () => {
		const { base } = fixture
		const securityPoolsBefore = await securityPoolCount()
		const poolsBefore = await poolCount()
		const stranger = fixture.other()
		await expect(stranger.writeContract({ ...factory(), functionName: 'initializeSecurityPoolPriceFeed', args: [base.genesisUniverse, 10_000_000_000n] })).rejects.toThrow('Security pool is not canonical')
		await expect(stranger.writeContract({ ...factory(), functionName: 'deploySecurityPoolQuestionLedger', args: [base.genesisUniverse, base.questionId, base.statoblastSecurityMultiplierBps, 10_000_000_000n] })).rejects.toThrow('Security pool configuration missing')

		// Genuine security pool code with the genuine deployers is still not canonical when the factory did not create it.
		const outsider = await deployOutsideFactory()
		expect(await isSecurityPool(outsider)).toBe(false)
		for (let stage = 1; stage <= 3; stage++) await prepareNext(outsider)
		expect(await setupStage(outsider)).toBe(3)
		await expect(prepareNext(outsider)).rejects.toThrow('Security pool is not canonical')
		expect(await setupStage(outsider)).toBe(3)
		await expect(fixture.register(base.questionId, outsider)).rejects.toThrow('Security pool setup incomplete')
		await base.mockWindow.impersonateAccount(outsider)
		await base.mockWindow.setBalance(outsider, unit)
		const asOutsider = createWriteClient(base.mockWindow, BigInt(outsider))
		await expect(asOutsider.writeContract({ ...factory(), functionName: 'initializeSecurityPoolPriceFeed', args: [base.genesisUniverse, 10_000_000_000n] })).rejects.toThrow('Security pool is not canonical')
		await expect(asOutsider.writeContract({ ...factory(), functionName: 'deploySecurityPoolQuestionLedger', args: [base.genesisUniverse, fixture.secondQuestionId, base.statoblastSecurityMultiplierBps, 10_000_000_000n] })).rejects.toThrow('Security pool configuration missing')

		// The constructor accepts any deployer that holds code, so a creator-chosen deployer still constructs. It stays outside the factory's record.
		const withChosenDeployer = await deployOutsideFactory({ ...canonicalDeployers(), capital: weth })
		expect(await isSecurityPool(withChosenDeployer)).toBe(false)
		await expect(
			(async () => {
				for (let stage = 1; stage <= 4; stage++) await prepareNext(withChosenDeployer)
			})(),
		).rejects.toThrow()
		expect(await setupStage(withChosenDeployer)).toBeLessThan(4)

		expect(await securityPoolCount()).toBe(securityPoolsBefore)
		expect(await poolCount()).toBe(poolsBefore)
		for (const address of [outsider, withChosenDeployer, stranger.account.address]) expect(await fixture.owner().readContract({ ...factory(), functionName: 'sharedPriceFeeds', args: [address, base.genesisUniverse] })).toBe(zeroAddress)
	})

	test('the factory deploys only its pinned creation code with a configuration of exactly the constructor tail', async () => {
		const owner = fixture.owner()
		const deploy = (code: Hex, encodedConfiguration: Hex) => owner.writeContract({ ...factory(), functionName: 'deploySecurityPool', args: [code, encodedConfiguration], gas: 16_777_216n })
		expect(await owner.readContract({ ...factory(), functionName: 'securityPoolCreationCodeHash' })).toBe(keccak256(creationCode()))
		const before = await securityPoolCount()
		// One appended byte, and another contract's code, both hash differently.
		await expect(deploy(`${creationCode()}00`, configuration())).rejects.toThrow('Security pool creation code is not canonical')
		await expect(deploy(`0x${openAdmissionArtifact.evm.bytecode.object}`, configuration())).rejects.toThrow('Security pool creation code is not canonical')
		// A longer configuration would otherwise be read as extra constructor arguments, a shorter one would shift them.
		await expect(deploy(creationCode(), `${configuration()}${'00'.repeat(32)}`)).rejects.toThrow('Security pool configuration length invalid')
		await expect(deploy(creationCode(), `0x${configuration().slice(2 + 64)}`)).rejects.toThrow('Security pool configuration length invalid')
		await expect(deploy(creationCode(), '0x')).rejects.toThrow('Security pool configuration length invalid')
		expect(await securityPoolCount()).toBe(before)
	})

	test('a factory-deployed security pool is canonical, completes setup and registers a question', async () => {
		const { base } = fixture
		const before = await securityPoolCount()
		// The fixture deploys through the factory and runs all four prepareNext stages.
		const created = await fixture.deploySecurityPool()
		expect(await isSecurityPool(created)).toBe(true)
		expect(await setupStage(created)).toBe(4)
		expect(await securityPoolCount()).toBe(before + 1n)
		expect(getAddress(await fixture.owner().readContract({ abi: securityPoolArtifact.abi, address: created, functionName: 'factory' }))).toBe(getAddress(infrastructure().securityPoolFactory))
		await fixture.register(base.questionId, created)
		const pool = fixture.poolFor(base.questionId, base.genesisUniverse, zeroAddress, created).questionLedger
		expect(getAddress(await fixture.owner().readContract({ ...factory(), functionName: 'securityPoolOf', args: [pool] }))).toBe(getAddress(created))
		// Every pool the factory registers therefore belongs to a canonical security pool.
		expect(await isSecurityPool(await fixture.owner().readContract({ ...factory(), functionName: 'securityPoolOf', args: [fixture.poolFor(base.questionId).questionLedger] }))).toBe(true)
	})

	test('a factory-deployed security pool is built by the pinned module deployers', async () => {
		const owner = fixture.owner()
		const created = await fixture.deploySecurityPool()
		expect(getAddress(await owner.readContract({ abi: securityPoolArtifact.abi, address: created, functionName: 'repairAuctionDeployer' }))).toBe(getAddress(infrastructure().securityPoolRepairAuctionDeployer))
		const capital = await fixture.capitalFor(created)
		const root = { abi: capitalArtifact.abi, address: capital } as const
		const modules: readonly [Address, Address, Hex, RuntimeArtifact][] = [
			[capital, await owner.readContract({ abi: securityPoolArtifact.abi, address: created, functionName: 'capitalImplementation' }), universeCloneBindings(fixture.base.genesisUniverse, getRepTokenAddress(fixture.base.genesisUniverse)), capitalArtifact],
			[await owner.readContract({ ...root, functionName: 'commitmentIndex' }), getCreateAddress({ from: infrastructure().securityPoolCommitmentIndexDeployer, nonce: 1n }), capital, indexArtifact],
			[await owner.readContract({ ...root, functionName: 'feeStreams' }), getCreateAddress({ from: infrastructure().securityPoolCapitalFeeStreamsDeployer, nonce: 2n }), capital, streamsArtifact],
		]
		for (const [clone, implementation, bindings, artifact] of modules) {
			expect((await owner.getCode({ address: clone }))?.toLowerCase()).toBe(boundCloneRuntimeCode(implementation, bindings).toLowerCase())
			const code = await owner.getCode({ address: implementation })
			if (code === undefined) throw new Error('Module code missing')
			expect(withoutImmutables(code, artifact)).toBe(withoutImmutables(`0x${artifact.evm.deployedBytecode.object}`, artifact))
		}
		expect(getAddress(await owner.readContract({ ...root, functionName: 'securityPool' }))).toBe(getAddress(created))
	})
})
