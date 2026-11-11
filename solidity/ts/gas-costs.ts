import { bigintToSafeNumber, encodeDeployData, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioDeploymentRequest, buildPortfolioPrepareNextRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolOpenAdmissionPolicy_SecurityPoolOpenAdmissionPolicy as policyArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
} from './types/contractArtifact'
import { createAnvilNodeForConnectionMode, getGasCostsAnvilConnectionMode } from './testSupport/simulator/anvilNode'
import { createWriteClient, type WriteClient } from './testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from './testSupport/simulator/utils/constants'
import { setupTestAccounts, approveToken, getChildUniverseId } from './testSupport/simulator/utils/utilities'
import { ensureZoltarDeployed, getRepTokenAddress, getZoltarAddress, forkUniverse, getUniverseData } from './testSupport/simulator/utils/contracts/zoltar'
import { applyLibraries, ensureInfraDeployed, getInfraContractAddresses } from './testSupport/simulator/utils/contracts/deployStatoblast'
import { manipulatePriceOracle } from './testSupport/simulator/utils/contracts/statoblastTestUtils'
import { createQuestion, makeQuestion } from './testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'

const unit = 10n ** 18n
const numberFormatter = new Intl.NumberFormat('en-US')
const ethFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })
const usdFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ethPriceUsd = Number.parseFloat(process.env['ETH_PRICE_USD'] ?? '2170.63')
const priorityFeeNanoEth = Number.parseFloat(process.env['PRIORITY_FEE_NANO_ETH'] ?? '1')
const baseFeeNanoEth = Number.parseFloat(process.env['BASE_FEE_NANO_ETH'] ?? '0.035')
const totalGasPriceNanoEth = baseFeeNanoEth + priorityFeeNanoEth
if (!Number.isFinite(ethPriceUsd) || ethPriceUsd <= 0) throw new Error('ETH_PRICE_USD must be a positive number')
if (!Number.isFinite(priorityFeeNanoEth) || priorityFeeNanoEth < 0) throw new Error('PRIORITY_FEE_NANO_ETH must be a non-negative number')
if (!Number.isFinite(baseFeeNanoEth) || baseFeeNanoEth < 0) throw new Error('BASE_FEE_NANO_ETH must be a non-negative number')
if (totalGasPriceNanoEth <= 0) throw new Error('BASE_FEE_NANO_ETH + PRIORITY_FEE_NANO_ETH must be greater than zero')

const anvilNode = await createAnvilNodeForConnectionMode(getGasCostsAnvilConnectionMode(), { context: 'gas-costs', startTimestamp: 1n })
const anvil = anvilNode.anvilWindowEthereum
const owner = createWriteClient(anvil, TEST_ADDRESSES[0])
const trader = createWriteClient(anvil, TEST_ADDRESSES[1])
const results: { section: string; label: string; gas: bigint }[] = []
const measure = async (section: string, label: string, sender: WriteClient, action: () => Promise<Hash>) => {
	try {
		const receipt = await sender.waitForTransactionReceipt({ hash: await action() })
		if (receipt.status !== 'success') throw new Error('Transaction reverted')
		if (receipt.gasUsed > 16_777_216n) throw new Error('Transaction exceeds the protocol gas cap')
		results.push({ section, label, gas: receipt.gasUsed })
		return receipt
	} catch (error) {
		throw new Error(`Scenario failed: ${section} / ${label}`, { cause: error })
	}
}

try {
	await anvil.resetToCleanState()
	await setupTestAccounts(anvil)
	await ensureZoltarDeployed(owner)
	await ensureInfraDeployed(owner)
	const infra = getInfraContractAddresses()
	const policyReceipt = await measure('1. Portfolio deployment', 'Open question admission policy', owner, () => owner.sendTransaction({ data: encodeDeployData({ abi: policyArtifact.abi, bytecode: applyLibraries(policyArtifact.evm.bytecode.object) }) }))
	const policy = policyReceipt.contractAddress
	if (policy === undefined) throw new Error('Missing admission policy')
	const deployment = buildPortfolioDeploymentRequest({
		owner: owner.account.address,
		factory: infra.securityPoolFactory,
		origin: { collateralToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', minimumReportCollateral: 10n ** 16n, universeId: 0n, securityMultiplierBps: 20_000n, reportPriorityFeeAttoEthPerGas: 10n * 10n ** 9n },
		maximumQuestionHorizonSeconds: 20n * 365n * DAY,
		questionAdmissionPolicy: policy,
		economics: { purchaseFeeBps: 100n, annualFeeBps: 0n, minimumPurchaseFeeAttoEth: unit / 1_000n, minimumCommitmentAttoEth: unit, minimumOutcomeRate: 1_000n, rewardVestingSeconds: DAY },
		deployers: {
			capital: infra.securityPoolCapitalLedgerDeployer,
			commitments: infra.securityPoolCommitmentIndexDeployer,
			fees: infra.securityPoolCapitalFeeStreamsDeployer,
			books: infra.securityPoolSettlementBookDeployer,
			settlement: infra.securityPoolPortfolioSettlementDeployer,
			reporters: infra.securityPoolReporterLedgerDeployer,
			forks: infra.securityPoolPortfolioForkCoordinatorDeployer,
			auctions: infra.securityPoolPortfolioAuctionDeployer,
			services: infra.securityPoolPortfolioServicesDeployer,
		},
		artifact: { abi: portfolioArtifact.abi, bytecode: applyLibraries(portfolioArtifact.evm.bytecode.object) },
	})
	const deployed = await measure('1. Portfolio deployment', 'Deploy shared portfolio', owner, () => owner.sendTransaction({ ...deployment, gas: 16_777_216n }))
	const portfolioAddress = deployed.contractAddress
	if (portfolioAddress === undefined) throw new Error('Missing portfolio')
	const portfolio = { abi: portfolioArtifact.abi, address: portfolioAddress }
	for (let step = 1; step <= 4; step++) await measure('1. Portfolio deployment', `Prepare portfolio stage ${step}`, trader, () => trader.sendTransaction({ ...buildPortfolioPrepareNextRequest({ caller: trader.account.address, portfolio: portfolioAddress }), gas: 16_777_216n }))
	const question = makeQuestion('Shared portfolio gas benchmark', (await anvil.getTime()) + 365n * DAY)
	const outcomes = ['Yes', 'No']
	await createQuestion(owner, question, outcomes)
	const questionId = getQuestionId(question, outcomes)
	await measure('1. Portfolio deployment', 'Register question', trader, () => trader.writeContract({ ...portfolio, functionName: 'addQuestion', args: [questionId] }))
	const poolAddress = await owner.readContract({ ...portfolio, functionName: 'getPool', args: [questionId, 0n] })
	const pool = { abi: poolArtifact.abi, address: poolAddress }
	const capital = { abi: capitalArtifact.abi, address: await owner.readContract({ ...portfolio, functionName: 'capitalLedger', args: [0n] }) }
	await approveToken(owner, getRepTokenAddress(0n), capital.address)
	await measure('2. Shared underwriting and trading', 'Deposit shared REP principal', owner, () => owner.writeContract({ ...capital, functionName: 'depositFor', args: [owner.account.address, 1_000n * unit] }))
	const coordinator = await owner.readContract({ ...pool, functionName: 'openOraclePriceCoordinator' })
	await manipulatePriceOracle(owner, anvil, coordinator, unit, 100n * unit)
	await measure('2. Shared underwriting and trading', 'Set owner commitment', owner, () => owner.writeContract({ ...capital, functionName: 'setCommitment', args: [200n * unit] }))
	const quote = await trader.readContract({ ...portfolio, functionName: 'purchaseQuote', args: [0n, questionId, 100n * unit] })
	await measure('2. Shared underwriting and trading', 'Purchase complete sets', trader, () => trader.writeContract({ ...portfolio, functionName: 'createCompleteSet', args: [0n, questionId, 100n * unit, trader.account.address, 0n, 100n * unit + (quote[0] * 10_100n + 9_999n) / 10_000n - 100n * unit], value: 0n }))
	const shares = await trader.readContract({ ...pool, functionName: 'shareTokenSupplyAttoShares' })
	await measure('2. Shared underwriting and trading', 'Return half of complete sets', trader, () => trader.writeContract({ ...pool, functionName: 'redeemCompleteSet', args: [shares / 2n] }))
	await measure('2. Shared underwriting and trading', 'Checkpoint question accounting', trader, () => trader.writeContract({ ...pool, functionName: 'updateSettlementCollateral' }))
	// An unrelated native fork leaves this question open. All underwriting moves
	// once at branch level; lazy question creation does not process owner lists.
	const forkQuestion = makeQuestion('Shared portfolio benchmark fork', (await anvil.getTime()) + DAY)
	await createQuestion(owner, forkQuestion, outcomes)
	await anvil.setTime(forkQuestion.endTime + 1n)
	await approveToken(owner, getRepTokenAddress(0n), getZoltarAddress())
	await measure('3. Shared fork', 'Trigger native fork', owner, () => forkUniverse(owner, 0n, getQuestionId(forkQuestion, outcomes)))
	const branch = { abi: forkArtifact.abi, address: await owner.readContract({ ...portfolio, functionName: 'forkController' }) }
	await measure('3. Shared fork', 'Prepare branch capital and freeze source', owner, () => owner.writeContract({ ...branch, functionName: 'prepareBranch', args: [0n, 1n] }))
	await measure('3. Shared fork', 'Choose prepared owner branch', owner, () => owner.writeContract({ ...branch, functionName: 'choose', args: [0n, 1n] }))
	const forkTime = (await getUniverseData(owner, 0n)).forkTime
	await anvil.setTime(forkTime + 56n * DAY)
	await measure('3. Shared fork', 'Migrate chosen branch once', owner, () => owner.writeContract({ ...branch, functionName: 'startBranch', args: [0n, 1n] }))
	const child = getChildUniverseId(0n, 1)
	await anvil.setTime(forkTime + 63n * DAY)
	await measure('3. Shared fork', 'Activate shared branch', owner, () => owner.writeContract({ ...branch, functionName: 'finalizeBranch', args: [child] }))
	const forker = { abi: forkerArtifact.abi, address: infra.securityPoolForker }
	await measure('3. Shared fork', 'Materialize question without reporter history', owner, () => owner.writeContract({ ...forker, functionName: 'materializePortfolioQuestion', args: [poolAddress, child] }))
	console.log('Measured one-question portfolio lifecycle; infrastructure, approvals and oracle funding are setup costs excluded from these rows.')
	console.log('For auction and large-history transaction bounds, run the portfolio auction and bounded fork gas test suites.')
	const labelWidth = results.reduce((max, result) => (result.label.length > max ? result.label.length : max), 0)
	const gasCostInEth = (gas: bigint) => (bigintToSafeNumber(gas, 'Gas usage') * totalGasPriceNanoEth) / 1_000_000_000
	const gasCostInUsd = (gas: bigint) => gasCostInEth(gas) * ethPriceUsd

	console.log(`# Pricing Assumptions`)
	console.log(`ETH price: $${usdFormatter.format(ethPriceUsd)}`)
	console.log(`Base fee: ${baseFeeNanoEth} nanoETH`)
	console.log(`Priority fee: ${priorityFeeNanoEth} nanoETH`)
	console.log(`Total gas price: ${totalGasPriceNanoEth} nanoETH`)
	console.log('')

	let currentSection = ''
	for (const result of results.toSorted((left, right) => Number.parseInt(left.section, 10) - Number.parseInt(right.section, 10))) {
		if (result.section !== currentSection) {
			if (currentSection !== '') console.log('')
			currentSection = result.section
			console.log(`# ${currentSection}`)
		}
		const line = `${result.label.padEnd(labelWidth)}  ${numberFormatter.format(result.gas).padStart(10)} gas  ${ethFormatter.format(gasCostInEth(result.gas)).padStart(10)} ETH  $${usdFormatter.format(gasCostInUsd(result.gas)).padStart(8)}`
		console.log(line)
	}
} finally {
	await anvilNode.dispose()
}
