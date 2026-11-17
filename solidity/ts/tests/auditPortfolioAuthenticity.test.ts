import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeDeployData, getAddress, keccak256, parseAbiParameters, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolOpenAdmissionPolicy_SecurityPoolOpenAdmissionPolicy as openAdmissionArtifact,
} from '../types/contractArtifact'
import { deployContract } from '../testSupport/deployContract'
import { createWriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { applyLibraries, getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { maximumQuestionHorizonSeconds, portfolioEconomics, unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

// Audit regression: registering with the factory used to prove nothing. Any contract could open a pool namespace and
// obtain canonical pools, and a portfolio creator chose the module deployers that build the ledgers holding provider
// REP and trader collateral. The factory now deploys every portfolio itself from pinned creation code and deployers.
const portfolioConfigurationInputs = parseAbiParameters(
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

describe('audit: only portfolios the factory deployed are canonical', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const infrastructure = () => getInfraContractAddresses()
	const factory = () => ({ abi: factoryArtifact.abi, address: infrastructure().securityPoolFactory })
	const creationCode = () => applyLibraries(portfolioArtifact.evm.bytecode.object)
	const origin = () => ({ collateralToken: weth, minimumReportCollateral: 10n ** 16n, universeId: fixture.base.genesisUniverse, securityMultiplierBps: fixture.base.statoblastSecurityMultiplierBps, reportPriorityFeeAttoEthPerGas: 10_000_000_000n })
	const configuration = () => encodeAbiParameters(portfolioConfigurationInputs, [origin(), maximumQuestionHorizonSeconds, fixture.questionAdmissionPolicy, portfolioEconomics])
	const canonicalDeployers = () => ({
		capital: infrastructure().securityPoolCapitalLedgerDeployer,
		commitments: infrastructure().securityPoolCommitmentIndexDeployer,
		fees: infrastructure().securityPoolCapitalFeeStreamsDeployer,
		books: infrastructure().securityPoolSettlementBookDeployer,
		settlement: infrastructure().securityPoolPortfolioSettlementDeployer,
		reporters: infrastructure().securityPoolReporterLedgerDeployer,
		forks: infrastructure().securityPoolPortfolioForkCoordinatorDeployer,
		services: infrastructure().securityPoolPortfolioServicesDeployer,
		auctions: infrastructure().securityPoolPortfolioAuctionDeployer,
	})
	/** The pre-fix route: the creator deploys the portfolio contract and so chooses its module deployers. */
	const deployOutsideFactory = (deployers = canonicalDeployers()) =>
		deployContract(fixture.owner(), encodeDeployData({ abi: portfolioArtifact.abi, bytecode: creationCode(), args: [infrastructure().securityPoolFactory, deployers, origin(), maximumQuestionHorizonSeconds, fixture.questionAdmissionPolicy, portfolioEconomics] }))
	const isPortfolio = (address: Address) => fixture.owner().readContract({ ...factory(), functionName: 'isPortfolio', args: [address] })
	const portfolioCount = () => fixture.owner().readContract({ ...factory(), functionName: 'portfolioCount' })
	const poolCount = () => fixture.owner().readContract({ ...factory(), functionName: 'securityPoolDeploymentCount' })
	const setupStage = async (address: Address) => Number(await fixture.owner().readContract({ abi: portfolioArtifact.abi, address, functionName: 'setupStage' }))
	const prepareNext = (address: Address) => writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: portfolioArtifact.abi, address, functionName: 'prepareNext', gas: 16_777_216n }))

	test('a contract the factory did not deploy cannot open a namespace or obtain a pool', async () => {
		const { base } = fixture
		const portfoliosBefore = await portfolioCount()
		const poolsBefore = await poolCount()
		const stranger = fixture.other()
		await expect(stranger.writeContract({ ...factory(), functionName: 'initializePortfolioPriceFeed', args: [base.genesisUniverse, 10_000_000_000n] })).rejects.toThrow('Portfolio is not canonical')
		await expect(stranger.writeContract({ ...factory(), functionName: 'deployPortfolioSecurityPool', args: [base.genesisUniverse, base.questionId, base.statoblastSecurityMultiplierBps, 10_000_000_000n] })).rejects.toThrow('Portfolio configuration missing')

		// Genuine portfolio code with the genuine deployers is still not canonical when the factory did not create it.
		const outsider = await deployOutsideFactory()
		expect(await isPortfolio(outsider)).toBe(false)
		for (let stage = 1; stage <= 3; stage++) await prepareNext(outsider)
		expect(await setupStage(outsider)).toBe(3)
		await expect(prepareNext(outsider)).rejects.toThrow('Portfolio is not canonical')
		expect(await setupStage(outsider)).toBe(3)
		await expect(fixture.register(base.questionId, outsider)).rejects.toThrow('Portfolio setup incomplete')
		await base.mockWindow.impersonateAccount(outsider)
		await base.mockWindow.setBalance(outsider, unit)
		const asOutsider = createWriteClient(base.mockWindow, BigInt(outsider))
		await expect(asOutsider.writeContract({ ...factory(), functionName: 'initializePortfolioPriceFeed', args: [base.genesisUniverse, 10_000_000_000n] })).rejects.toThrow('Portfolio is not canonical')
		await expect(asOutsider.writeContract({ ...factory(), functionName: 'deployPortfolioSecurityPool', args: [base.genesisUniverse, fixture.secondQuestionId, base.statoblastSecurityMultiplierBps, 10_000_000_000n] })).rejects.toThrow('Portfolio configuration missing')

		// The constructor accepts any deployer that holds code, so a creator-chosen deployer still constructs. It stays outside the factory's record.
		const withChosenDeployer = await deployOutsideFactory({ ...canonicalDeployers(), capital: weth })
		expect(await isPortfolio(withChosenDeployer)).toBe(false)
		await expect(
			(async () => {
				for (let stage = 1; stage <= 4; stage++) await prepareNext(withChosenDeployer)
			})(),
		).rejects.toThrow()
		expect(await setupStage(withChosenDeployer)).toBeLessThan(4)

		expect(await portfolioCount()).toBe(portfoliosBefore)
		expect(await poolCount()).toBe(poolsBefore)
		for (const address of [outsider, withChosenDeployer, stranger.account.address]) expect(await fixture.owner().readContract({ ...factory(), functionName: 'sharedPriceFeeds', args: [address, base.genesisUniverse] })).toBe(zeroAddress)
	})

	test('the factory deploys only its pinned creation code with a configuration of exactly the constructor tail', async () => {
		const owner = fixture.owner()
		const deploy = (code: Hex, encodedConfiguration: Hex) => owner.writeContract({ ...factory(), functionName: 'deployPortfolio', args: [code, encodedConfiguration], gas: 16_777_216n })
		expect(await owner.readContract({ ...factory(), functionName: 'portfolioCreationCodeHash' })).toBe(keccak256(creationCode()))
		const before = await portfolioCount()
		// One appended byte, and another contract's code, both hash differently.
		await expect(deploy(`${creationCode()}00`, configuration())).rejects.toThrow('Portfolio creation code is not canonical')
		await expect(deploy(applyLibraries(openAdmissionArtifact.evm.bytecode.object), configuration())).rejects.toThrow('Portfolio creation code is not canonical')
		// A longer configuration would otherwise be read as extra constructor arguments, a shorter one would shift them.
		await expect(deploy(creationCode(), `${configuration()}${'00'.repeat(32)}`)).rejects.toThrow('Portfolio configuration length invalid')
		await expect(deploy(creationCode(), `0x${configuration().slice(2 + 64)}`)).rejects.toThrow('Portfolio configuration length invalid')
		await expect(deploy(creationCode(), '0x')).rejects.toThrow('Portfolio configuration length invalid')
		expect(await portfolioCount()).toBe(before)
	})

	test('a factory-deployed portfolio is canonical, completes setup and registers a question', async () => {
		const { base } = fixture
		const before = await portfolioCount()
		// The fixture deploys through the factory and runs all four prepareNext stages.
		const created = await fixture.deployPortfolio()
		expect(await isPortfolio(created)).toBe(true)
		expect(await setupStage(created)).toBe(4)
		expect(await portfolioCount()).toBe(before + 1n)
		expect(getAddress(await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: created, functionName: 'factory' }))).toBe(getAddress(infrastructure().securityPoolFactory))
		await fixture.register(base.questionId, created)
		const pool = fixture.poolFor(base.questionId, base.genesisUniverse, zeroAddress, created).securityPool
		expect(getAddress(await fixture.owner().readContract({ ...factory(), functionName: 'getSecurityPoolPortfolio', args: [pool] }))).toBe(getAddress(created))
		// Every pool the factory registers therefore belongs to a canonical portfolio.
		expect(await isPortfolio(await fixture.owner().readContract({ ...factory(), functionName: 'getSecurityPoolPortfolio', args: [fixture.poolFor(base.questionId).securityPool] }))).toBe(true)
	})

	test('a factory-deployed portfolio is built by the pinned module deployers', async () => {
		const owner = fixture.owner()
		const created = await fixture.deployPortfolio()
		expect(getAddress(await owner.readContract({ abi: portfolioArtifact.abi, address: created, functionName: 'auctionDeployer' }))).toBe(getAddress(infrastructure().securityPoolPortfolioAuctionDeployer))
		const capital = await fixture.capitalFor(created)
		const index = await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'commitmentIndex' })
		const modules: readonly [Address, RuntimeArtifact][] = [
			[capital, capitalArtifact],
			[index, indexArtifact],
		]
		for (const [address, artifact] of modules) {
			const code = await owner.getCode({ address })
			if (code === undefined) throw new Error('Module code missing')
			expect(withoutImmutables(code, artifact)).toBe(withoutImmutables(applyLibraries(artifact.evm.deployedBytecode.object), artifact))
		}
		expect(getAddress(await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'portfolio' }))).toBe(getAddress(created))
	})
})
