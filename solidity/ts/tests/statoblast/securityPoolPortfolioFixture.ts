import { wrapWeth } from '../../testSupport/simulator/utils/contracts/statoblast'
import { beforeAll, expect } from 'bun:test'
import { encodeDeployData, parseAbi, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioDeploymentRequest, buildPortfolioPrepareNextRequest, type PortfolioEconomicsConfig } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact, statoblast_SecurityPoolOpenAdmissionPolicy_SecurityPoolOpenAdmissionPolicy as openAdmissionArtifact } from '../../types/contractArtifact'
import { deployContract } from '../../testSupport/deployContract'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { applyLibraries, getInfraContractAddresses, getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { manipulatePriceOracle } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { usePortfolioProtocolFixture } from './portfolioProtocolFixture'

export const unit = 10n ** 18n
export const maximumQuestionHorizonSeconds = 20n * 365n * DAY
export const portfolioEconomics: PortfolioEconomicsConfig = {
	purchaseFeeBps: 100n,
	annualFeeBps: 1_000n,
	minimumPurchaseFeeAttoEth: unit / 1_000n,
	minimumCommitmentAttoEth: unit,
	minimumOutcomeRate: 1_000n,
	rewardVestingSeconds: DAY,
}

export function useSecurityPoolPortfolioFixture(economicsOverrides: Partial<PortfolioEconomicsConfig> = {}) {
	const economics = { ...portfolioEconomics, ...economicsOverrides }
	const base = usePortfolioProtocolFixture()
	let portfolio: Address
	let capitalLedger: Address
	let questionAdmissionPolicy: Address
	let secondQuestionId: bigint
	let secondEndTime: bigint
	const owner = () => base.client
	const other = () => createWriteClient(base.mockWindow, TEST_ADDRESSES[1])
	const poolFor = (questionId: bigint, universeId = base.genesisUniverse, parent = zeroAddress, namespace = portfolio) => getSecurityPoolAddresses(parent, universeId, questionId, base.statoblastSecurityMultiplierBps, base.genesisUniverse, DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, namespace)
	const deployPortfolio = async (policy = questionAdmissionPolicy, configuration = economics, originOverrides: Partial<{ collateralToken: Address; minimumReportCollateral: bigint; universeId: bigint; securityMultiplierBps: bigint; reportPriorityFeeAttoEthPerGas: bigint }> = {}) => {
		const infrastructure = getInfraContractAddresses()
		const origin = {
			collateralToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const,
			minimumReportCollateral: 10n ** 16n,
			universeId: base.genesisUniverse,
			securityMultiplierBps: base.statoblastSecurityMultiplierBps,
			reportPriorityFeeAttoEthPerGas: DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS,
			...originOverrides,
		}
		const request = buildPortfolioDeploymentRequest({
			owner: owner().account.address,
			factory: infrastructure.securityPoolFactory,
			origin,
			maximumQuestionHorizonSeconds,
			questionAdmissionPolicy: policy,
			economics: configuration,
			deployers: {
				capital: infrastructure.securityPoolCapitalLedgerDeployer,
				commitments: infrastructure.securityPoolCommitmentIndexDeployer,
				fees: infrastructure.securityPoolCapitalFeeStreamsDeployer,
				books: infrastructure.securityPoolSettlementBookDeployer,
				settlement: infrastructure.securityPoolPortfolioSettlementDeployer,
				reporters: infrastructure.securityPoolReporterLedgerDeployer,
				forks: infrastructure.securityPoolPortfolioForkCoordinatorDeployer,
				auctions: infrastructure.securityPoolPortfolioAuctionDeployer,
				services: infrastructure.securityPoolPortfolioServicesDeployer,
			},
			artifact: { abi: portfolioArtifact.abi, bytecode: applyLibraries(portfolioArtifact.evm.bytecode.object) },
		})
		const receipt = await owner().waitForTransactionReceipt({ hash: await owner().sendTransaction({ ...request, gas: 16_777_216n }) })
		if (receipt.status !== 'success' || receipt.contractAddress === undefined) throw new Error('Portfolio deployment must succeed within the transaction gas limit')
		const created = receipt.contractAddress
		const setupAbi = parseAbi(['function setupStage() view returns(uint8)'])
		const setupGas = [receipt.gasUsed]
		for (let stage = 1; stage <= 4; stage++) {
			const sender = other()
			await expect(sender.writeContract({ abi: portfolioArtifact.abi, address: created, functionName: 'addQuestion', args: [base.questionId] })).rejects.toThrow('Portfolio setup incomplete')
			await expect(sender.writeContract({ abi: portfolioArtifact.abi, address: created, functionName: 'createCompleteSet', args: [origin.universeId, base.questionId, unit, sender.account.address, 0n, 2n * unit - unit], value: 0n })).rejects.toThrow('Portfolio setup incomplete')
			const setup = buildPortfolioPrepareNextRequest({ caller: sender.account.address, portfolio: created })
			const hash = await writeContractAndWait(sender, () => sender.sendTransaction({ ...setup, gas: 16_777_216n }))
			const setupReceipt = await sender.waitForTransactionReceipt({ hash })
			expect(setupReceipt.gasUsed).toBeLessThanOrEqual(16_777_216n)
			expect(Number(await sender.readContract({ abi: setupAbi, address: created, functionName: 'setupStage' }))).toBe(stage)
			setupGas.push(setupReceipt.gasUsed)
		}
		await writeContractAndWait(other(), () => other().sendTransaction(buildPortfolioPrepareNextRequest({ caller: other().account.address, portfolio: created })))
		expect(Number(await owner().readContract({ abi: setupAbi, address: created, functionName: 'setupStage' }))).toBe(4)
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ portfolioSetupGas: setupGas })
		return created
	}
	const capitalFor = (namespace = portfolio) => owner().readContract({ abi: portfolioArtifact.abi, address: namespace, functionName: 'capitalLedger', args: [base.genesisUniverse] })
	const register = (questionId: bigint, namespace = portfolio, sender = other()) => writeContractAndWait(sender, () => sender.writeContract({ abi: portfolioArtifact.abi, address: namespace, functionName: 'addQuestion', args: [questionId] }))
	const refreshPrice = (questionId = base.questionId, price = unit, namespace = portfolio, requestedInitialAttoWeth = 100n * unit) => manipulatePriceOracle(owner(), base.mockWindow, poolFor(questionId, base.genesisUniverse, zeroAddress, namespace).openOraclePriceCoordinator, price, requestedInitialAttoWeth)
	const deposit = async (amount = 1_000n * unit, sender = owner(), namespace = portfolio) => {
		const capital = await capitalFor(namespace)
		await approveToken(sender, getRepTokenAddress(base.genesisUniverse), capital)
		return writeContractAndWait(sender, () => sender.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'depositFor', args: [sender.account.address, amount] }))
	}
	const authorize = async (commitment = 100n * unit, sender = owner(), namespace = portfolio) => {
		const capital = await capitalFor(namespace)
		return writeContractAndWait(sender, () => sender.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'setCommitment', args: [commitment] }))
	}
	const prepare = async (rep = 1_000n * unit, commitment = 200n * unit) => {
		await deposit(rep)
		await refreshPrice()
		await authorize(commitment)
	}
	const mint = async (amount = 10n * unit, question = base.questionId, options: { sender?: WriteClient; namespace?: Address; minimumShares?: bigint; budget?: bigint; recipient?: Address } = {}) => {
		const sender = options.sender ?? other()
		const namespace = options.namespace ?? portfolio
		const quote = await sender.readContract({ abi: portfolioArtifact.abi, address: namespace, functionName: 'purchaseQuote', args: [base.genesisUniverse, question, amount] })
		const token = await sender.readContract({ abi: portfolioArtifact.abi, address: namespace, functionName: 'collateralToken' })
		const services = await sender.readContract({ abi: portfolioArtifact.abi, address: namespace, functionName: 'services' })
		const allowance = await sender.readContract({ abi: parseAbi(['function allowance(address,address) view returns (uint256)']), address: token, functionName: 'allowance', args: [sender.account.address, services] })
		if (typeof allowance !== 'bigint') throw new Error('Collateral allowance unavailable')
		if (allowance < amount + quote[0]) {
			if (allowance !== 0n) await writeContractAndWait(sender, () => sender.writeContract({ abi: parseAbi(['function approve(address,uint256) returns (bool)']), address: token, functionName: 'approve', args: [services, 0n] }))
			await approveToken(sender, token, services)
		}
		const fee = options.budget ?? (quote[0] * 10_100n + 9_999n) / 10_000n
		return writeContractAndWait(sender, () => sender.writeContract({ abi: portfolioArtifact.abi, address: namespace, functionName: 'createCompleteSet', args: [base.genesisUniverse, question, amount, options.recipient ?? sender.account.address, options.minimumShares ?? 0n, amount + fee - amount], value: 0n }))
	}
	beforeAll(async () => {
		await wrapWeth(owner(), 10_000n * unit)
		await wrapWeth(other(), 10_000n * unit)
		questionAdmissionPolicy = await deployContract(owner(), encodeDeployData({ abi: openAdmissionArtifact.abi, bytecode: applyLibraries(openAdmissionArtifact.evm.bytecode.object) }))
		portfolio = await deployPortfolio()
		capitalLedger = await capitalFor()
		await register(base.questionId)
		secondEndTime = base.questionData.endTime + 365n * DAY
		const secondQuestion = { ...makeQuestion('Portfolio second question', secondEndTime), startTime: base.questionData.endTime + DAY }
		secondQuestionId = getQuestionId(secondQuestion, base.outcomes)
		await createQuestion(owner(), secondQuestion, base.outcomes)
		await register(secondQuestionId)
		await base.setBaselineSnapshot()
	})
	return {
		base,
		owner,
		other,
		poolFor,
		deployPortfolio,
		capitalFor,
		register,
		refreshPrice,
		deposit,
		authorize,
		prepare,
		mint,
		get portfolio() {
			return portfolio
		},
		get capitalLedger() {
			return capitalLedger
		},
		get questionAdmissionPolicy() {
			return questionAdmissionPolicy
		},
		get secondQuestionId() {
			return secondQuestionId
		},
		get secondEndTime() {
			return secondEndTime
		},
	}
}
