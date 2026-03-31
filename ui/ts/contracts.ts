import { encodeAbiParameters, encodeDeployData, getAddress, getContractAddress, getCreate2Address, keccak256, numberToBytes, parseAbiItem, toHex, zeroAddress, type Address, type Hash, type Hex } from 'viem'
import { ABIS } from './abis.js'
import { ScalarOutcomes_ScalarOutcomes, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData, peripherals_EscalationGame_EscalationGame, peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer, peripherals_SecurityPool_SecurityPool, peripherals_SecurityPoolForker_SecurityPoolForker, peripherals_SecurityPoolUtils_SecurityPoolUtils, peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction, peripherals_factories_EscalationGameFactory_EscalationGameFactory, peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory, peripherals_factories_SecurityPoolFactory_SecurityPoolFactory, peripherals_factories_ShareTokenFactory_ShareTokenFactory, peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory, peripherals_openOracle_OpenOracle_OpenOracle, peripherals_tokens_ShareToken_ShareToken } from './contractArtifact.js'
import { assertNever } from './lib/assert.js'
import type { DeploymentStatus, DeploymentStep, DeploymentStepId, EscalationDeposit, EscalationSide, ForkAuctionAction, ForkAuctionActionResult, ForkAuctionDetails, ListedSecurityPool, MarketCreationResult, MarketDetails, MarketType, OpenOracleActionResult, OracleManagerDetails, OracleQueueOperation, QuestionData, ReadClient, ReportingActionResult, ReportingDetails, ReportingOutcomeKey, SecurityPoolCreationResult, SecurityPoolSystemState, SecurityPoolVaultSummary, SecurityVaultActionResult, SecurityVaultDetails, TradingActionResult, TruthAuctionMetrics, WriteClient, ZoltarChildUniverseActionResult, ZoltarForkActionResult, ZoltarUniverseSummary } from './types/contracts.js'

const GENESIS_REPUTATION_TOKEN = bigintToAddress(0x221657776846890989a759ba2973e427dff5c9bbn)
const PROXY_DEPLOYER_ADDRESS = bigintToAddress(0x7a0d94f55792c434d74a40883c6ed8545e406d12n)
const PROXY_DEPLOYER_SIGNER = getAddress('0x4c8d290a1b368ac4728d83a9e8321fc3af2b39b1')
const PROXY_DEPLOYER_RAW_TRANSACTION = '0xf87e8085174876e800830186a08080ad601f80600e600039806000f350fe60003681823780368234f58015156014578182fd5b80825250506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222' satisfies Hex
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' satisfies Hash
const ZERO_SALT = numberToBytes(0, { size: 32 })
const FUND_PROXY_DEPLOYER_SIGNER_AMOUNT = 10000000000000000n
const LIQUIDATION_OPERATION_TYPE = 0
const ESCALATION_TIME_LENGTH = 4_233_600n
const MIGRATION_TIME_LENGTH = 4_838_400n
const TRUTH_AUCTION_TIME_LENGTH = 604_800n
const QUESTION_OUTCOME_ABI = [parseAbiItem('function getQuestionOutcome(address securityPool) view returns (uint8 outcome)')]
const ANSWER_OPTION_ABI = [parseAbiItem('function getAnswerOptionName(uint256 questionId, uint256 answer) view returns (string memory)')]
const CONTRACT_PAGE_SIZE = 30n

type DeployedChildUniverseRecord = {
	forkQuestionId: bigint
	forkTime: bigint
	forkingOutcomeIndex: bigint
	parentUniverseId: bigint
	reputationToken: Address
}
type DeployedChildUniversesPage = readonly [readonly bigint[], readonly bigint[], readonly DeployedChildUniverseRecord[]]
type QuestionTuple = readonly [string, string, bigint, bigint, bigint, bigint, bigint, string]
type SecurityVaultTuple = readonly [bigint, bigint, bigint, bigint, bigint]
type UniverseTuple = readonly [bigint, bigint, bigint, Address, bigint]
type ForkDataTuple = readonly [bigint, Address, bigint, bigint, bigint, boolean, number]
type AuctionClearingTuple = readonly [boolean, bigint, bigint, bigint]

function bigintToAddress(value: bigint): Address {
	return getAddress(`0x${ value.toString(16).padStart(40, '0') }`)
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isEscalationDepositPage(value: unknown): value is readonly { amount: bigint; cumulativeAmount: bigint; depositor: Address }[] {
	return Array.isArray(value) && value.every(item => isObjectRecord(item) && typeof item['amount'] === 'bigint' && typeof item['cumulativeAmount'] === 'bigint' && typeof item['depositor'] === 'string')
}

function isBigintTriple(value: unknown): value is [bigint, bigint, bigint] {
	return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'bigint')
}

function hasTimestamp(value: unknown): value is { timestamp: bigint } {
	return isObjectRecord(value) && typeof value['timestamp'] === 'bigint'
}

type SecurityPoolDeploymentQueryResult = {
	completeSetCollateralAmount: bigint
	currentRetentionRate: bigint
	parent: Address
	priceOracleManagerAndOperatorQueuer: Address
	questionId: bigint
	securityMultiplier: bigint
	securityPool: Address
	shareToken: Address
	startingRepEthPrice: bigint
	truthAuction: Address
	universeId: bigint
}

const getSecurityPoolUtilsAddress = () =>
	getCreate2Address({
		bytecode: `0x${ peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object }`,
		from: PROXY_DEPLOYER_ADDRESS,
		salt: ZERO_SALT,
	})

const getScalarOutcomesAddress = () =>
	getCreate2Address({
		bytecode: `0x${ ScalarOutcomes_ScalarOutcomes.evm.bytecode.object }`,
		from: PROXY_DEPLOYER_ADDRESS,
		salt: ZERO_SALT,
	})

const getShareTokenFactoryByteCode = (zoltarAddress: Address) =>
	encodeDeployData({
		abi: peripherals_factories_ShareTokenFactory_ShareTokenFactory.abi,
		bytecode: `0x${ peripherals_factories_ShareTokenFactory_ShareTokenFactory.evm.bytecode.object }`,
		args: [zoltarAddress],
	})

const getEscalationGameFactoryByteCode = () =>
	encodeDeployData({
		abi: peripherals_factories_EscalationGameFactory_EscalationGameFactory.abi,
		bytecode: `0x${ peripherals_factories_EscalationGameFactory_EscalationGameFactory.evm.bytecode.object }`,
	})

const getZoltarQuestionDataByteCode = () =>
	encodeDeployData({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		bytecode: applyLibraries(ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object),
	})

const getSecurityPoolForkerByteCode = (zoltarAddress: Address) =>
	encodeDeployData({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		bytecode: applyLibraries(peripherals_SecurityPoolForker_SecurityPoolForker.evm.bytecode.object),
		args: [zoltarAddress],
	})

const getZoltarQuestionDataAddress = () =>
	getContractAddress({
		bytecode: `0x${ ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object }`,
		from: PROXY_DEPLOYER_ADDRESS,
		opcode: 'CREATE2',
		salt: ZERO_SALT,
	})

const getZoltarInitCode = (zoltarQuestionDataAddress: Address) =>
	encodeDeployData({
		abi: Zoltar_Zoltar.abi,
		bytecode: `0x${ Zoltar_Zoltar.evm.bytecode.object }`,
		args: [zoltarQuestionDataAddress],
	})

const getZoltarAddress = () => {
	const zoltarQuestionDataAddress = getZoltarQuestionDataAddress()
	return getCreate2Address({
		from: PROXY_DEPLOYER_ADDRESS,
		salt: ZERO_SALT,
		bytecode: getZoltarInitCode(zoltarQuestionDataAddress),
	})
}

const getSecurityPoolFactoryByteCode = (securityPoolForker: Address, questionData: Address, escalationGameFactory: Address, openOracle: Address, zoltar: Address, shareTokenFactory: Address, uniformPriceDualCapBatchAuctionFactory: Address, priceOracleManagerAndOperatorQueuerFactory: Address) =>
	encodeDeployData({
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		bytecode: applyLibraries(peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.evm.bytecode.object),
		args: [securityPoolForker, questionData, escalationGameFactory, openOracle, zoltar, shareTokenFactory, uniformPriceDualCapBatchAuctionFactory, priceOracleManagerAndOperatorQueuerFactory],
	})

function applyLibraries(bytecode: string): Hex {
	const librariesToReplace = [
		{
			hash: keccak256(toHex('contracts/ScalarOutcomes.sol:ScalarOutcomes')).slice(2, 36),
			address: getScalarOutcomesAddress(),
		},
		{
			hash: keccak256(toHex('contracts/peripherals/SecurityPoolUtils.sol:SecurityPoolUtils')).slice(2, 36),
			address: getSecurityPoolUtilsAddress(),
		},
	] as const

	let updatedBytecode = bytecode
	for (const { hash, address } of librariesToReplace) {
		updatedBytecode = updatedBytecode.replaceAll(`__$${ hash }$__`, address.slice(2).toLowerCase())
	}

	return `0x${ updatedBytecode }`
}

function getInfraContractAddresses() {
	const getAddressForBytecode = (bytecode: Hex) =>
		getCreate2Address({
			bytecode,
			from: PROXY_DEPLOYER_ADDRESS,
			salt: ZERO_SALT,
		})

	const contracts = {
		securityPoolUtils: getSecurityPoolUtilsAddress(),
		openOracle: getAddressForBytecode(`0x${ peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object }`),
		zoltarQuestionData: getAddressForBytecode(getZoltarQuestionDataByteCode()),
		zoltar: getZoltarAddress(),
		shareTokenFactory: getAddressForBytecode(getShareTokenFactoryByteCode(getZoltarAddress())),
		priceOracleManagerAndOperatorQueuerFactory: getAddressForBytecode(`0x${ peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.evm.bytecode.object }`),
		securityPoolForker: getAddressForBytecode(getSecurityPoolForkerByteCode(getZoltarAddress())),
		escalationGameFactory: getAddressForBytecode(getEscalationGameFactoryByteCode()),
		scalarOutcomes: getScalarOutcomesAddress(),
		uniformPriceDualCapBatchAuctionFactory: getAddressForBytecode(`0x${ peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.bytecode.object }`),
	}

	return {
		...contracts,
		securityPoolFactory: getCreate2Address({
			from: PROXY_DEPLOYER_ADDRESS,
			salt: ZERO_SALT,
			bytecode: getSecurityPoolFactoryByteCode(contracts.securityPoolForker, contracts.zoltarQuestionData, contracts.escalationGameFactory, contracts.openOracle, contracts.zoltar, contracts.shareTokenFactory, contracts.uniformPriceDualCapBatchAuctionFactory, contracts.priceOracleManagerAndOperatorQueuerFactory),
		}),
	}
}

async function deployViaProxy(client: WriteClient, bytecode: Hex) {
	const hash = await client.sendTransaction({
		to: PROXY_DEPLOYER_ADDRESS,
		data: bytecode,
	})
	await client.waitForTransactionReceipt({ hash })
	return hash
}

async function writeContractAndWait(client: WriteClient, write: () => Promise<Hash>) {
	const hash = await write()
	await client.waitForTransactionReceipt({ hash })
	return hash
}

async function readSecurityPoolUniverseId(client: Pick<ReadClient, 'readContract'>, securityPoolAddress: Address) {
	return await client.readContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'universeId',
		args: [],
	})
}

async function ensureProxyDeployerDeployed(client: WriteClient) {
	const code = await client.getCode({ address: PROXY_DEPLOYER_ADDRESS })
	if (code !== undefined && code !== '0x') return undefined

	const fundHash = await client.sendTransaction({
		to: PROXY_DEPLOYER_SIGNER,
		value: FUND_PROXY_DEPLOYER_SIGNER_AMOUNT,
	})
	await client.waitForTransactionReceipt({ hash: fundHash })

	const deployHash = await client.sendRawTransaction({
		serializedTransaction: PROXY_DEPLOYER_RAW_TRANSACTION,
	})
	await client.waitForTransactionReceipt({ hash: deployHash })
	return deployHash
}

export function getDeploymentSteps(): DeploymentStep[] {
	const addresses = getInfraContractAddresses()

	return [
		{
			id: 'proxyDeployer',
			label: 'Proxy Deployer',
			address: PROXY_DEPLOYER_ADDRESS,
			dependencies: [],
			deploy: async client => {
				const hash = await ensureProxyDeployerDeployed(client)
				return hash ?? ZERO_HASH
			},
		},
		{
			id: 'uniformPriceDualCapBatchAuctionFactory',
			label: 'UniformPriceDualCapBatchAuctionFactory',
			address: addresses.uniformPriceDualCapBatchAuctionFactory,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${ peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.bytecode.object }`),
		},
		{
			id: 'scalarOutcomes',
			label: 'ScalarOutcomes',
			address: addresses.scalarOutcomes,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${ ScalarOutcomes_ScalarOutcomes.evm.bytecode.object }`),
		},
		{
			id: 'securityPoolUtils',
			label: 'SecurityPoolUtils',
			address: addresses.securityPoolUtils,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${ peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object }`),
		},
		{
			id: 'openOracle',
			label: 'OpenOracle',
			address: addresses.openOracle,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${ peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object }`),
		},
		{
			id: 'zoltarQuestionData',
			label: 'ZoltarQuestionData',
			address: addresses.zoltarQuestionData,
			dependencies: ['proxyDeployer', 'scalarOutcomes'],
			deploy: async client => await deployViaProxy(client, getZoltarQuestionDataByteCode()),
		},
		{
			id: 'zoltar',
			label: 'Zoltar',
			address: addresses.zoltar,
			dependencies: ['proxyDeployer', 'zoltarQuestionData'],
			deploy: async client => await deployViaProxy(client, getZoltarInitCode(addresses.zoltarQuestionData)),
		},
		{
			id: 'shareTokenFactory',
			label: 'ShareTokenFactory',
			address: addresses.shareTokenFactory,
			dependencies: ['proxyDeployer', 'zoltar'],
			deploy: async client => await deployViaProxy(client, getShareTokenFactoryByteCode(addresses.zoltar)),
		},
		{
			id: 'priceOracleManagerAndOperatorQueuerFactory',
			label: 'PriceOracleManagerAndOperatorQueuerFactory',
			address: addresses.priceOracleManagerAndOperatorQueuerFactory,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${ peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.evm.bytecode.object }`),
		},
		{
			id: 'securityPoolForker',
			label: 'SecurityPoolForker',
			address: addresses.securityPoolForker,
			dependencies: ['proxyDeployer', 'scalarOutcomes', 'securityPoolUtils', 'zoltar'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolForkerByteCode(addresses.zoltar)),
		},
		{
			id: 'escalationGameFactory',
			label: 'EscalationGameFactory',
			address: addresses.escalationGameFactory,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getEscalationGameFactoryByteCode()),
		},
		{
			id: 'securityPoolFactory',
			label: 'SecurityPoolFactory',
			address: addresses.securityPoolFactory,
			dependencies: ['proxyDeployer', 'securityPoolForker', 'zoltarQuestionData', 'escalationGameFactory', 'openOracle', 'zoltar', 'shareTokenFactory', 'uniformPriceDualCapBatchAuctionFactory', 'priceOracleManagerAndOperatorQueuerFactory', 'securityPoolUtils'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolFactoryByteCode(addresses.securityPoolForker, addresses.zoltarQuestionData, addresses.escalationGameFactory, addresses.openOracle, addresses.zoltar, addresses.shareTokenFactory, addresses.uniformPriceDualCapBatchAuctionFactory, addresses.priceOracleManagerAndOperatorQueuerFactory)),
		},
	]
}

export async function loadDeploymentStatuses(client: ReadClient): Promise<DeploymentStatus[]> {
	const steps = getDeploymentSteps()
	const deployed = await Promise.all(
		steps.map(async step => {
			const code = await client.getCode({ address: step.address })
			return code !== undefined && code !== '0x'
		}),
	)

	return steps.map((step, index) => ({
		...step,
		deployed: deployed[index] ?? false,
	}))
}

export async function loadGenesisRepBalance(client: ReadClient, address: Address) {
	return (await client.readContract({
		abi: ABIS.mainnet.erc20,
		functionName: 'balanceOf',
		address: GENESIS_REPUTATION_TOKEN,
		args: [address],
	}))
}

export async function loadErc20Balance(client: ReadClient, tokenAddress: Address, ownerAddress: Address) {
	return await client.readContract({
		abi: ABIS.mainnet.erc20,
		functionName: 'balanceOf',
		address: tokenAddress,
		args: [ownerAddress],
	})
}

export async function loadErc20Allowance(client: ReadClient, tokenAddress: Address, ownerAddress: Address, spenderAddress: Address) {
	return await client.readContract({
		abi: ABIS.mainnet.erc20,
		functionName: 'allowance',
		address: tokenAddress,
		args: [ownerAddress, spenderAddress],
	})
}

function getDeploymentStep(id: DeploymentStepId) {
	const step = getDeploymentSteps().find(candidate => candidate.id === id)
	if (step === undefined) throw new Error(`Unknown deployment step: ${ id }`)
	return step
}

function getQuestionId(questionData: QuestionData, outcomeOptions: readonly string[]) {
	return BigInt(
		keccak256(
			encodeAbiParameters(
				[
					{
						type: 'tuple',
						components: [
							{ name: 'title', type: 'string' },
							{ name: 'description', type: 'string' },
							{ name: 'startTime', type: 'uint256' },
							{ name: 'endTime', type: 'uint256' },
							{ name: 'numTicks', type: 'uint256' },
							{ name: 'displayValueMin', type: 'int256' },
							{ name: 'displayValueMax', type: 'int256' },
							{ name: 'answerUnit', type: 'string' },
						],
					},
					{ type: 'string[]' },
				],
				[questionData, outcomeOptions],
			),
		),
	)
}

function getQuestionIdHex(questionId: bigint) {
	return `0x${ questionId.toString(16) }`
}

function getReportingOutcomeValue(outcome: ReportingOutcomeKey) {
	switch (outcome) {
		case 'invalid':
			return 0
		case 'yes':
			return 1
		case 'no':
			return 2
		default:
			throw new Error(`Unhandled reporting outcome: ${ JSON.stringify(outcome) }`)
	}
}

function getReportingOutcomeKey(outcome: bigint | number): ReportingOutcomeKey | 'none' {
	switch (outcome) {
		case 0:
		case 0n:
			return 'invalid'
		case 1:
		case 1n:
			return 'yes'
		case 2:
		case 2n:
			return 'no'
		default:
			return 'none'
	}
}

function getEscalationSideLabel(key: ReportingOutcomeKey) {
	switch (key) {
		case 'invalid':
			return 'Invalid'
		case 'yes':
			return 'Yes'
		case 'no':
			return 'No'
		default:
			throw new Error(`Unhandled escalation side: ${ JSON.stringify(key) }`)
	}
}

function getSecurityPoolSystemState(value: bigint | number): SecurityPoolSystemState {
	switch (value) {
		case 0:
		case 0n:
			return 'operational'
		case 1:
		case 1n:
			return 'poolForked'
		case 2:
		case 2n:
			return 'forkMigration'
		case 3:
		case 3n:
			return 'forkTruthAuction'
		default:
			throw new Error(`Unhandled security pool system state: ${ JSON.stringify(value) }`)
	}
}

function getMarketType(questionData: QuestionData, outcomeLabels: string[]): MarketType {
	if (outcomeLabels.length === 0 && questionData.numTicks > 0n) return 'scalar'
	if (outcomeLabels.length === 2 && outcomeLabels[0] === 'Yes' && outcomeLabels[1] === 'No') return 'binary'
	return 'categorical'
}

async function loadOutcomeLabels(client: ReadClient, questionId: bigint) {
	let currentIndex = 0n
	const outcomeLabels: string[] = []

	while (true) {
		const page = await client.readContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'getOutcomeLabels',
			address: getDeploymentStep('zoltarQuestionData').address,
			args: [questionId, currentIndex, CONTRACT_PAGE_SIZE],
		})
		if (!isStringArray(page)) throw new Error('Unexpected outcome labels response')

		const labels = page.filter(label => label.length > 0)
		outcomeLabels.push(...labels)
		if (BigInt(labels.length) !== CONTRACT_PAGE_SIZE) break
		currentIndex += CONTRACT_PAGE_SIZE
	}

	return outcomeLabels
}

async function loadEscalationDeposits(client: ReadClient, escalationGameAddress: Address, outcome: ReportingOutcomeKey): Promise<EscalationDeposit[]> {
	let currentIndex = 0n
	const deposits: EscalationDeposit[] = []

	while (true) {
		const page = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getDepositsByOutcome',
			args: [getReportingOutcomeValue(outcome), currentIndex, CONTRACT_PAGE_SIZE],
		})
		if (!isEscalationDepositPage(page)) throw new Error('Unexpected escalation deposits response')

		const normalizedPage = page
			.map((deposit, index) => ({
				amount: deposit.amount,
				cumulativeAmount: deposit.cumulativeAmount,
				depositIndex: currentIndex + BigInt(index),
				depositor: deposit.depositor,
			}))
			.filter(deposit => deposit.depositor !== zeroAddress)

		deposits.push(...normalizedPage)
		if (BigInt(normalizedPage.length) !== CONTRACT_PAGE_SIZE) break
		currentIndex += CONTRACT_PAGE_SIZE
	}

	return deposits
}

export async function loadMarketDetails(client: ReadClient, questionId: bigint): Promise<MarketDetails> {
	const [question, createdAt] = await Promise.all([
		client.readContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'questions',
			address: getDeploymentStep('zoltarQuestionData').address,
			args: [questionId],
		}),
		client.readContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'questionCreatedTimestamp',
			address: getDeploymentStep('zoltarQuestionData').address,
			args: [questionId],
		}),
	])
	const questionData: QuestionTuple = question
	const [title, description, startTime, endTime, numTicks, displayValueMin, displayValueMax, answerUnit] = questionData

	const exists = createdAt > 0n || title !== '' || description !== '' || startTime !== 0n || endTime !== 0n || numTicks !== 0n
	const outcomeLabels = exists ? await loadOutcomeLabels(client, questionId) : []

	return {
		answerUnit,
		createdAt,
		description,
		displayValueMax,
		displayValueMin,
		endTime,
		exists,
		marketType: getMarketType({ title, description, startTime, endTime, numTicks, displayValueMin, displayValueMax, answerUnit }, outcomeLabels),
		outcomeLabels,
		numTicks,
		questionId: getQuestionIdHex(questionId),
		startTime,
		title,
	}
}

async function loadQuestionIds(client: ReadClient): Promise<bigint[]> {
	const questionCount = await client.readContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'getQuestionCount',
		address: getDeploymentStep('zoltarQuestionData').address,
		args: [],
	})

	let currentIndex = 0n
	const questionIds: bigint[] = []
	while (currentIndex < questionCount) {
		const page = await client.readContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'getQuestions',
			address: getDeploymentStep('zoltarQuestionData').address,
			args: [currentIndex, CONTRACT_PAGE_SIZE],
		})
		if (!Array.isArray(page)) throw new Error('Unexpected question id page response')

		const normalizedPage = page
			.filter(questionId => typeof questionId === 'bigint' && questionId !== 0n)
			.slice(0, Number(CONTRACT_PAGE_SIZE))
		questionIds.push(...normalizedPage)
		if (BigInt(normalizedPage.length) !== CONTRACT_PAGE_SIZE) break
		currentIndex += CONTRACT_PAGE_SIZE
	}

	return questionIds
}

export async function loadAllZoltarQuestions(client: ReadClient): Promise<MarketDetails[]> {
	const questionIds = await loadQuestionIds(client)
	return await Promise.all(questionIds.map(async questionId => await loadMarketDetails(client, questionId)))
}

export async function loadZoltarQuestionCount(client: ReadClient) {
	return await client.readContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'getQuestionCount',
		address: getDeploymentStep('zoltarQuestionData').address,
		args: [],
	})
}

export async function loadZoltarUniverseSummary(client: ReadClient, universeId: bigint): Promise<ZoltarUniverseSummary> {
	const [universe, forkTime, forkThreshold] = await Promise.all([
		client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'universes',
			address: getDeploymentStep('zoltar').address,
			args: [universeId],
		}),
		client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'getForkTime',
			address: getDeploymentStep('zoltar').address,
			args: [universeId],
		}),
		client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'getForkThreshold',
			address: getDeploymentStep('zoltar').address,
			args: [universeId],
		}),
	])
	const universeData: UniverseTuple = universe
	const [storedForkTime, forkQuestionId, forkingOutcomeIndex, reputationToken, parentUniverseId] = universeData
	const hasForked = forkTime > 0n || storedForkTime > 0n

	let childUniverses: ZoltarUniverseSummary['childUniverses'] = []
	let forkQuestionDetails: MarketDetails | undefined = undefined
	if (hasForked && forkQuestionId > 0n) {
		const marketDetails = await loadMarketDetails(client, forkQuestionId)
		forkQuestionDetails = marketDetails
		if (marketDetails.marketType === 'scalar') {
			const deployedChildUniverses: ZoltarUniverseSummary['childUniverses'] = []
			let currentIndex = 0n
			while (true) {
				const page: DeployedChildUniversesPage = await client.readContract({
					abi: Zoltar_Zoltar.abi,
					functionName: 'getDeployedChildUniverses',
					address: getDeploymentStep('zoltar').address,
					args: [universeId, currentIndex, CONTRACT_PAGE_SIZE],
				})
				const [outcomeIndexes, childUniverseIds, childUniverseTuples] = page
				const pageChildren = await Promise.all(outcomeIndexes.map(async (outcomeIndex, index) => {
					const childUniverse = childUniverseTuples[index]
					if (childUniverse === undefined) throw new Error('Unexpected deployed child universe response')
					const { forkTime: childForkTime, parentUniverseId: childParentUniverseId, reputationToken: childReputationToken } = childUniverse
					const outcomeLabel = await client.readContract({
						abi: ANSWER_OPTION_ABI,
						functionName: 'getAnswerOptionName',
						address: getDeploymentStep('zoltarQuestionData').address,
						args: [forkQuestionId, outcomeIndex],
					})
					const childUniverseId = childUniverseIds[index]
					if (childUniverseId === undefined) throw new Error('Unexpected deployed child universe response')
					return {
						exists: childReputationToken !== zeroAddress,
						forkTime: childForkTime,
						outcomeIndex,
						outcomeLabel,
						parentUniverseId: childParentUniverseId,
						reputationToken: childReputationToken,
						universeId: childUniverseId,
					}
				}))
				deployedChildUniverses.push(...pageChildren)
				if (BigInt(pageChildren.length) !== CONTRACT_PAGE_SIZE) break
				currentIndex += CONTRACT_PAGE_SIZE
			}
			childUniverses = deployedChildUniverses
		} else {
				childUniverses = await Promise.all(marketDetails.outcomeLabels.map(async (outcomeLabel, outcomeIndex) => {
					const childUniverseId = await client.readContract({
						abi: Zoltar_Zoltar.abi,
						functionName: 'getChildUniverseId',
						address: getDeploymentStep('zoltar').address,
						args: [universeId, BigInt(outcomeIndex)],
					})
					const childUniverse = await client.readContract({
						abi: Zoltar_Zoltar.abi,
						functionName: 'universes',
						address: getDeploymentStep('zoltar').address,
						args: [childUniverseId],
					})
				const childUniverseData: UniverseTuple = childUniverse
				const [childForkTime, , , childReputationToken, childParentUniverseId] = childUniverseData
					return {
						exists: childReputationToken !== zeroAddress,
						forkTime: childForkTime,
					outcomeIndex: BigInt(outcomeIndex),
					outcomeLabel,
					parentUniverseId: childParentUniverseId,
					reputationToken: childReputationToken,
					universeId: childUniverseId,
				}
			}))
		}
	}

	return {
		childUniverses,
		forkThreshold,
		forkQuestionDetails,
		forkTime,
		forkingOutcomeIndex,
		hasForked,
		parentUniverseId,
		reputationToken,
		universeId,
	}
}

export async function loadReportingDetails(client: ReadClient, securityPoolAddress: Address, accountAddress: Address | undefined): Promise<ReportingDetails> {
	const [questionId, escalationGameAddress, completeSetCollateralAmount, universeId] = await Promise.all([
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'questionId',
			address: securityPoolAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'escalationGame',
			address: securityPoolAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'completeSetCollateralAmount',
			address: securityPoolAddress,
			args: [],
		}),
		readSecurityPoolUniverseId(client, securityPoolAddress),
	])

	const [
		startBond,
		nonDecisionThreshold,
		startingTime,
		totalCost,
		bindingCapital,
		balances,
		resolution,
		block,
	] = await Promise.all([
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'startBond',
			address: escalationGameAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'nonDecisionThreshold',
			address: escalationGameAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'startingTime',
			address: escalationGameAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'totalCost',
			address: escalationGameAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getBindingCapital',
			address: escalationGameAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getBalances',
			address: escalationGameAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getQuestionResolution',
			address: escalationGameAddress,
			args: [],
		}),
		client.getBlock(),
	])
	if (!isBigintTriple(balances)) throw new Error('Unexpected escalation balances response')
	if (!hasTimestamp(block)) throw new Error('Unexpected block response')

	const marketDetails = await loadMarketDetails(client, questionId)
	const [invalidDeposits, yesDeposits, noDeposits] = await Promise.all([
		loadEscalationDeposits(client, escalationGameAddress, 'invalid'),
		loadEscalationDeposits(client, escalationGameAddress, 'yes'),
		loadEscalationDeposits(client, escalationGameAddress, 'no'),
	])

	const sides: EscalationSide[] = [
		{ balance: balances[0] ?? 0n, deposits: invalidDeposits, key: 'invalid', label: getEscalationSideLabel('invalid'), userDeposits: accountAddress === undefined ? [] : invalidDeposits.filter(deposit => deposit.depositor === accountAddress) },
		{ balance: balances[1] ?? 0n, deposits: yesDeposits, key: 'yes', label: getEscalationSideLabel('yes'), userDeposits: accountAddress === undefined ? [] : yesDeposits.filter(deposit => deposit.depositor === accountAddress) },
		{ balance: balances[2] ?? 0n, deposits: noDeposits, key: 'no', label: getEscalationSideLabel('no'), userDeposits: accountAddress === undefined ? [] : noDeposits.filter(deposit => deposit.depositor === accountAddress) },
	]

	return {
		bindingCapital,
		completeSetCollateralAmount,
		currentRequiredBond: totalCost === 0n ? startBond : totalCost,
		currentTime: block.timestamp,
		escalationEndTime: startingTime + ESCALATION_TIME_LENGTH,
		escalationGameAddress,
		marketDetails,
		nonDecisionThreshold,
		resolution: getReportingOutcomeKey(resolution),
		securityPoolAddress,
		sides,
		startBond,
		startingTime,
		totalCost,
		universeId,
	}
}

export async function createMarket(
	client: WriteClient,
	parameters: {
		marketType: MarketType
		outcomeLabels: string[]
		questionData: QuestionData
	},
) {
	const questionId = getQuestionId(parameters.questionData, parameters.outcomeLabels)

	const createQuestionHash = await writeContractAndWait(client, () => client.writeContract({
		address: getDeploymentStep('zoltarQuestionData').address,
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'createQuestion',
		args: [parameters.questionData, parameters.outcomeLabels],
	}))

	return {
		questionId: getQuestionIdHex(questionId),
		createQuestionHash,
		marketType: parameters.marketType,
	} satisfies MarketCreationResult
}

export async function createSecurityPool(
	client: WriteClient,
	parameters: {
		currentRetentionRate: bigint
		questionId: bigint
		securityMultiplier: bigint
		startingRepEthPrice: bigint
	},
) {
	const deployPoolHash = await writeContractAndWait(client, () => client.writeContract({
		address: getDeploymentStep('securityPoolFactory').address,
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'deployOriginSecurityPool',
		args: [0n, parameters.questionId, parameters.securityMultiplier, parameters.currentRetentionRate, parameters.startingRepEthPrice],
	}))

	return {
		deployPoolHash,
		questionId: getQuestionIdHex(parameters.questionId),
		securityMultiplier: parameters.securityMultiplier,
		universeId: 0n,
	} satisfies SecurityPoolCreationResult
}

function getOriginSecurityPoolShareTokenSalt(questionId: bigint, securityMultiplier: bigint) {
	return keccak256(
		encodeAbiParameters(
			[
				{ type: 'uint256' },
				{ type: 'uint256' },
			],
			[securityMultiplier, questionId],
		),
	)
}

function getOriginSecurityPoolShareTokenAddress(questionId: bigint, securityMultiplier: bigint) {
	return getCreate2Address({
		from: getInfraContractAddresses().shareTokenFactory,
		salt: getOriginSecurityPoolShareTokenSalt(questionId, securityMultiplier),
		bytecode: encodeDeployData({
			abi: peripherals_tokens_ShareToken_ShareToken.abi,
			bytecode: `0x${ peripherals_tokens_ShareToken_ShareToken.evm.bytecode.object }`,
			args: [getInfraContractAddresses().securityPoolFactory, getZoltarAddress(), questionId],
		}),
	})
}

export async function originSecurityPoolExists(client: Pick<ReadClient, 'getCode'>, questionId: bigint, securityMultiplier: bigint) {
	const shareTokenAddress = getOriginSecurityPoolShareTokenAddress(questionId, securityMultiplier)
	const code = await client.getCode({ address: shareTokenAddress })
	return code !== undefined && code !== '0x'
}

export async function loadSecurityVaultDetails(client: ReadClient, securityPoolAddress: Address, vaultAddress: Address): Promise<SecurityVaultDetails> {
	const [currentRetentionRate, poolOwnershipDenominator, repToken, totalSecurityBondAllowance, universeId, vaultData] = await Promise.all([
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'currentRetentionRate',
			address: securityPoolAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'poolOwnershipDenominator',
			address: securityPoolAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'repToken',
			address: securityPoolAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'totalSecurityBondAllowance',
			address: securityPoolAddress,
			args: [],
		}),
		readSecurityPoolUniverseId(client, securityPoolAddress),
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'securityVaults',
			address: securityPoolAddress,
			args: [vaultAddress],
		}),
	])
	const vaultDataTuple: SecurityVaultTuple = vaultData
	const [repDepositShare, securityBondAllowance, unpaidEthFees, , lockedRepInEscalationGame] = vaultDataTuple

	return {
		currentRetentionRate: currentRetentionRate,
		lockedRepInEscalationGame,
		poolOwnershipDenominator: poolOwnershipDenominator,
		repDepositShare,
		repToken,
		securityBondAllowance,
		securityPoolAddress,
		totalSecurityBondAllowance: totalSecurityBondAllowance,
		unpaidEthFees,
		universeId,
		vaultAddress,
	}
}

async function getSecurityPoolVaultCount(client: ReadClient, securityPoolAddress: Address) {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'getVaultCount',
		address: securityPoolAddress,
		args: [],
	})
}

async function getSecurityPoolVaults(client: ReadClient, securityPoolAddress: Address, startIndex: bigint, count: bigint) {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'getVaults',
		address: securityPoolAddress,
		args: [startIndex, count],
	})
}

async function poolOwnershipToRep(client: ReadClient, securityPoolAddress: Address, poolOwnership: bigint) {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'poolOwnershipToRep',
		address: securityPoolAddress,
		args: [poolOwnership],
	})
}

async function loadSecurityPoolVaultSummaries(client: ReadClient, securityPoolAddress: Address): Promise<{ vaultCount: bigint; vaults: SecurityPoolVaultSummary[] }> {
	const vaultCount = await getSecurityPoolVaultCount(client, securityPoolAddress)
	const vaultAddresses = vaultCount === 0n ? [] : await getSecurityPoolVaults(client, securityPoolAddress, 0n, vaultCount)
	const vaults = await Promise.all(vaultAddresses.map(async vaultAddress => {
		const vaultData: SecurityVaultTuple = await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'securityVaults',
			address: securityPoolAddress,
			args: [vaultAddress],
		})
		const [poolOwnership, securityBondAllowance, unpaidEthFees, feeIndex, lockedRepInEscalationGame] = vaultData
		const repDepositShare = await poolOwnershipToRep(client, securityPoolAddress, poolOwnership)
		return {
			feeIndex,
			lockedRepInEscalationGame,
			poolOwnership,
			repDepositShare,
			securityBondAllowance,
			unpaidEthFees,
			vaultAddress,
		} satisfies SecurityPoolVaultSummary
	}))
	return { vaultCount, vaults }
}

export async function approveErc20<Action extends SecurityVaultActionResult['action'] | OpenOracleActionResult['action'] | ZoltarForkActionResult['action']>(
	client: WriteClient,
	tokenAddress: Address,
	spenderAddress: Address,
	amount: bigint,
	action: Action,
) {
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: tokenAddress,
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		args: [spenderAddress, amount],
	}))
	return { action, hash }
}

export async function depositRepToSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint) {
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'depositRep',
		args: [amount],
	}))
	return {
		action: 'depositRep',
		hash,
	} satisfies SecurityVaultActionResult
}

export async function updateSecurityVaultFees(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address) {
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'updateVaultFees',
		args: [vaultAddress],
	}))
	return {
		action: 'updateVaultFees',
		hash,
	} satisfies SecurityVaultActionResult
}

export async function redeemSecurityVaultFees(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address) {
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemFees',
		args: [vaultAddress],
	}))
	return {
		action: 'redeemFees',
		hash,
	} satisfies SecurityVaultActionResult
}

export async function redeemSecurityVaultRep(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address) {
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemRep',
		args: [vaultAddress],
	}))
	return {
		action: 'redeemRep',
		hash,
	} satisfies SecurityVaultActionResult
}

export async function loadOracleManagerDetails(client: ReadClient, managerAddress: Address): Promise<OracleManagerDetails> {
	const [lastPrice, pendingReportId, requestPriceEthCost] = await Promise.all([
		client.readContract({
			abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
			functionName: 'lastPrice',
			address: managerAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
			functionName: 'pendingReportId',
			address: managerAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
			functionName: 'getRequestPriceEthCost',
			address: managerAddress,
			args: [],
		}),
	])

	let callbackStateHash: Hex | undefined
	let exactToken1Report: bigint | undefined
	let token1: Address | undefined
	let token2: Address | undefined

	if (pendingReportId > 0n) {
		const extraData = (await client.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'extraData',
			address: getInfraContractAddresses().openOracle,
			args: [pendingReportId],
		}))

		const reportMeta = (await client.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'reportMeta',
			address: getInfraContractAddresses().openOracle,
			args: [pendingReportId],
		}))

		callbackStateHash = extraData[0]
		exactToken1Report = reportMeta[0]
		token1 = reportMeta[4]
		token2 = reportMeta[6]
	}

	return {
		callbackStateHash,
		exactToken1Report,
		lastPrice,
		managerAddress,
		openOracleAddress: getInfraContractAddresses().openOracle,
		pendingReportId,
		requestPriceEthCost,
		token1,
		token2,
	}
}

export async function requestOraclePrice(client: WriteClient, managerAddress: Address, ethCost: bigint) {
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: managerAddress,
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		functionName: 'requestPrice',
		args: [],
		value: ethCost,
	}))
	return {
		action: 'requestPrice',
		hash,
	} satisfies OpenOracleActionResult
}

export async function submitInitialOracleReport(client: WriteClient, reportId: bigint, amount1: bigint, amount2: bigint, stateHash: Hex) {
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: getInfraContractAddresses().openOracle,
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'submitInitialReport',
		args: [reportId, amount1, amount2, stateHash],
	}))
	return {
		action: 'submitInitialReport',
		hash,
	} satisfies OpenOracleActionResult
}

export async function settleOracleReport(client: WriteClient, reportId: bigint) {
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: getInfraContractAddresses().openOracle,
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'settle',
		args: [reportId],
	}))
	return {
		action: 'settle',
		hash,
	} satisfies OpenOracleActionResult
}

export async function loadForkAuctionDetails(client: ReadClient, securityPoolAddress: Address): Promise<ForkAuctionDetails> {
	const [
		questionId,
		parentSecurityPoolAddress,
		universeId,
		systemStateValue,
		truthAuctionAddress,
		completeSetCollateralAmount,
		forkData,
		block,
		questionOutcome,
	] = await Promise.all([
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'questionId',
			address: securityPoolAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'parent',
			address: securityPoolAddress,
			args: [],
		}),
		readSecurityPoolUniverseId(client, securityPoolAddress),
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'systemState',
			address: securityPoolAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'truthAuction',
			address: securityPoolAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'completeSetCollateralAmount',
			address: securityPoolAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'forkData',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
		client.getBlock(),
		client.readContract({
			abi: QUESTION_OUTCOME_ABI,
			functionName: 'getQuestionOutcome',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
	])
	if (!hasTimestamp(block)) throw new Error('Unexpected block response')
	const marketDetails = await loadMarketDetails(client, questionId)
	const forkDataTuple: ForkDataTuple = forkData
	const [repAtFork, , truthAuctionStartedAt, migratedRep, auctionedSecurityBondAllowance, forkOwnSecurityPool, forkOutcomeIndex] = forkDataTuple
	const systemState = getSecurityPoolSystemState(systemStateValue)
	const migrationEndsAt = truthAuctionStartedAt > 0n ? undefined : (await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'getForkTime',
		address: getInfraContractAddresses().zoltar,
		args: [universeId],
	})) + MIGRATION_TIME_LENGTH

	let truthAuction: TruthAuctionMetrics | undefined
	if (truthAuctionAddress !== zeroAddress && truthAuctionStartedAt > 0n) {
		const [computeClearingResult, ethRaiseCap, ethRaised, finalized, maxRepBeingSold, minBidSize, totalRepPurchased, underfunded] = await Promise.all([
			client.readContract({
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'computeClearing',
				address: truthAuctionAddress,
				args: [],
			}),
			client.readContract({
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'ethRaiseCap',
				address: truthAuctionAddress,
				args: [],
			}),
			client.readContract({
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'ethRaised',
				address: truthAuctionAddress,
				args: [],
			}),
			client.readContract({
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'finalized',
				address: truthAuctionAddress,
				args: [],
			}),
			client.readContract({
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'maxRepBeingSold',
				address: truthAuctionAddress,
				args: [],
			}),
			client.readContract({
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'minBidSize',
				address: truthAuctionAddress,
				args: [],
			}),
			client.readContract({
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'totalRepPurchased',
				address: truthAuctionAddress,
				args: [],
			}),
			client.readContract({
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'underfunded',
				address: truthAuctionAddress,
				args: [],
			}),
		])
		const computeClearingTuple: AuctionClearingTuple = computeClearingResult
		const [hitCap, clearingTick, accumulatedEth, ethAtClearingTick] = computeClearingTuple
		const clearingPrice = clearingTick === 0n && accumulatedEth === 0n ? undefined : await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'tickToPrice',
			address: truthAuctionAddress,
			args: [clearingTick],
		})

		truthAuction = {
			accumulatedEth,
			auctionEndsAt: truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH,
			clearingPrice,
			clearingTick,
			ethAtClearingTick,
			ethRaiseCap,
			ethRaised,
			finalized,
			hitCap,
			maxRepBeingSold,
			minBidSize,
			repPurchasableAtBid: clearingPrice === undefined || clearingPrice === 0n ? undefined : (ethRaiseCap * 10n ** 18n) / clearingPrice,
			timeRemaining: finalized ? 0n : block.timestamp >= truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH ? 0n : truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH - block.timestamp,
			totalRepPurchased,
			underfunded,
		}
	}

	return {
		auctionedSecurityBondAllowance,
		claimingAvailable: systemState === 'operational' && truthAuctionAddress !== zeroAddress,
		completeSetCollateralAmount,
		currentTime: block.timestamp,
		forkOutcome: getReportingOutcomeKey(forkOutcomeIndex),
		forkOwnSecurityPool,
		marketDetails,
		migratedRep,
		migrationEndsAt,
		parentSecurityPoolAddress,
		questionOutcome: getReportingOutcomeKey(questionOutcome),
		repAtFork,
		securityPoolAddress,
		systemState,
		truthAuction,
		truthAuctionAddress,
		truthAuctionStartedAt,
		universeId,
	}
}

async function executeForkAuctionAction(client: WriteClient, action: ForkAuctionAction, securityPoolAddress: Address, universeId: bigint, request: () => Promise<Hash>) {
	const hash = await request()
	await client.waitForTransactionReceipt({ hash })
	return {
		action,
		hash,
		securityPoolAddress,
		universeId,
	} satisfies ForkAuctionActionResult
}

export async function forkZoltarWithOwnEscalation(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(client, 'forkWithOwnEscalation', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => client.writeContract({
		address: getInfraContractAddresses().securityPoolForker,
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'forkZoltarWithOwnEscalationGame',
		args: [securityPoolAddress],
	})))
}

export async function initiateSecurityPoolFork(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(client, 'initiateFork', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => client.writeContract({
		address: getInfraContractAddresses().securityPoolForker,
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'initiateSecurityPoolFork',
		args: [securityPoolAddress],
	})))
}

export async function createChildUniverseFromSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) {
	return await executeForkAuctionAction(client, 'createChildUniverse', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => client.writeContract({
		address: getInfraContractAddresses().securityPoolForker,
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'createChildUniverse',
		args: [securityPoolAddress, getReportingOutcomeValue(outcome)],
	})))
}

export async function createZoltarChildUniverse(client: WriteClient, universeId: bigint, outcomeIndex: bigint) {
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: getDeploymentStep('zoltar').address,
		abi: Zoltar_Zoltar.abi,
		functionName: 'migrateInternalRep',
		args: [universeId, 0n, [outcomeIndex]],
	}))
	return {
		action: 'createChildUniverse',
		hash,
		outcomeIndex,
		universeId,
	} satisfies ZoltarChildUniverseActionResult
}

export async function migrateRepToZoltarFromSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcomes: ReportingOutcomeKey[]) {
	return await executeForkAuctionAction(client, 'migrateRepToZoltar', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => client.writeContract({
		address: getInfraContractAddresses().securityPoolForker,
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'migrateRepToZoltar',
		args: [securityPoolAddress, outcomes.map(outcome => BigInt(getReportingOutcomeValue(outcome)))],
	})))
}

export async function migrateSecurityVault(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) {
	return await executeForkAuctionAction(client, 'migrateVault', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => client.writeContract({
		address: getInfraContractAddresses().securityPoolForker,
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'migrateVault',
		args: [securityPoolAddress, getReportingOutcomeValue(outcome)],
	})))
}

function toUint8(value: bigint) {
	if (value < 0n || value > 255n) {
		throw new Error(`Deposit index out of range: ${ value.toString() }`)
	}

	const numberValue = Number(value)
	if (!Number.isInteger(numberValue) || numberValue < 0 || numberValue > 255) {
		throw new Error(`Deposit index out of range: ${ value.toString() }`)
	}

	return numberValue
}

function toUint8Array(values: bigint[]) {
	return values.map(value => toUint8(value))
}

export async function migrateEscalationDeposits(client: WriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[]) {
	return await executeForkAuctionAction(client, 'migrateEscalationDeposits', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => client.writeContract({
		address: getInfraContractAddresses().securityPoolForker,
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'migrateFromEscalationGame',
		args: [securityPoolAddress, vaultAddress, getReportingOutcomeValue(outcome), toUint8Array(depositIndexes)],
	})))
}

export async function startTruthAuctionForSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(client, 'startTruthAuction', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => client.writeContract({
		address: getInfraContractAddresses().securityPoolForker,
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'startTruthAuction',
		args: [securityPoolAddress],
	})))
}

export async function submitTruthAuctionBid(client: WriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, amount: bigint) {
	return await executeForkAuctionAction(client, 'submitBid', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => client.writeContract({
		address: truthAuctionAddress,
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'submitBid',
		args: [tick],
		value: amount,
	})))
}

export async function refundTruthAuctionBid(client: WriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, bidIndex: bigint) {
	return await executeForkAuctionAction(client, 'refundLosingBids', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => client.writeContract({
		address: truthAuctionAddress,
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'refundLosingBids',
		args: [[{ tick, bidIndex }]],
	})))
}

export async function finalizeSecurityPoolTruthAuction(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(client, 'finalizeTruthAuction', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => client.writeContract({
		address: getInfraContractAddresses().securityPoolForker,
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'finalizeTruthAuction',
		args: [securityPoolAddress],
	})))
}

export async function claimSecurityPoolAuctionProceeds(client: WriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, tick: bigint, bidIndex: bigint) {
	return await executeForkAuctionAction(client, 'claimAuctionProceeds', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => client.writeContract({
		address: getInfraContractAddresses().securityPoolForker,
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'claimAuctionProceeds',
		args: [securityPoolAddress, vaultAddress, [{ tick, bidIndex }]],
	})))
}

export async function loadAllSecurityPools(client: ReadClient): Promise<ListedSecurityPool[]> {
	const deploymentCount = await client.readContract({
		address: getInfraContractAddresses().securityPoolFactory,
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'securityPoolDeploymentCount',
		args: [],
	})

	const deployments: readonly SecurityPoolDeploymentQueryResult[] = deploymentCount === 0n
		? []
		: await client.readContract({
				address: getInfraContractAddresses().securityPoolFactory,
				abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
				functionName: 'securityPoolDeploymentsRange',
				args: [0n, deploymentCount],
			})

	return await Promise.all(deployments.map(async deployment => {
		const { currentRetentionRate, parent, priceOracleManagerAndOperatorQueuer: managerAddress, questionId, securityMultiplier, securityPool: securityPoolAddress, startingRepEthPrice, truthAuction: truthAuctionAddress, universeId } = deployment
		const [systemState, forkData, marketDetails] = await Promise.all([
			client.readContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'systemState',
				address: securityPoolAddress,
				args: [],
			}),
			client.readContract({
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'forkData',
				address: getInfraContractAddresses().securityPoolForker,
				args: [securityPoolAddress],
			}),
			loadMarketDetails(client, questionId),
		])
		const forkDataTuple: ForkDataTuple = forkData
		const [ , , truthAuctionStartedAt, migratedRep, , forkOwnSecurityPool, forkOutcomeIndex] = forkDataTuple

		const { vaultCount, vaults } = await loadSecurityPoolVaultSummaries(client, securityPoolAddress)
		return {
			currentRetentionRate,
			forkOutcome: getReportingOutcomeKey(forkOutcomeIndex),
			forkOwnSecurityPool,
			managerAddress,
			marketDetails,
			migratedRep,
			parent,
			questionId: getQuestionIdHex(questionId),
			securityMultiplier,
			securityPoolAddress,
			startingRepEthPrice,
			systemState: getSecurityPoolSystemState(systemState),
			truthAuctionAddress,
			truthAuctionStartedAt,
			universeId,
			vaultCount,
			vaults,
		}
	}))
}

export async function queueSecurityPoolLiquidation(client: WriteClient, managerAddress: Address, targetVault: Address, amount: bigint, ethCost: bigint) {
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: managerAddress,
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		functionName: 'requestPriceIfNeededAndQueueOperation',
		args: [LIQUIDATION_OPERATION_TYPE, targetVault, amount],
		value: ethCost,
	}))
	return hash
}

function getOracleOperationType(operation: OracleQueueOperation) {
	switch (operation) {
		case 'liquidation':
			return 0
		case 'withdrawRep':
			return 1
		case 'setSecurityBondsAllowance':
			return 2
		default:
			return assertNever(operation)
	}
}

function getShareMigrationOutcomeValue(outcome: ReportingOutcomeKey) {
	switch (outcome) {
		case 'invalid':
			return 0n
		case 'yes':
			return 1n
		case 'no':
			return 2n
		default:
			return assertNever(outcome)
	}
}

function getShareTokenId(universeId: bigint, outcome: ReportingOutcomeKey) {
	const universeMask = (1n << 248n) - 1n
	return ((universeId & universeMask) << 8n) | (getShareMigrationOutcomeValue(outcome) & 255n)
}

export async function queueOracleManagerOperation(client: WriteClient, managerAddress: Address, operation: OracleQueueOperation, targetVault: Address, amount: bigint, ethCost: bigint) {
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: managerAddress,
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		functionName: 'requestPriceIfNeededAndQueueOperation',
		args: [getOracleOperationType(operation), targetVault, amount],
		value: ethCost,
	}))
	return {
		action: 'queueOperation',
		hash,
	} satisfies OpenOracleActionResult
}

export async function redeemSharesInSecurityPool(client: WriteClient, securityPoolAddress: Address) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemShares',
		args: [],
	}))
	return {
		action: 'redeemShares',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies TradingActionResult
}

export async function migrateSharesFromUniverse(client: WriteClient, securityPoolAddress: Address, fromUniverseId: bigint, outcome: ReportingOutcomeKey) {
	const [universeId, shareTokenAddress] = await Promise.all([
		readSecurityPoolUniverseId(client, securityPoolAddress),
		client.readContract({
			address: securityPoolAddress,
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'shareToken',
			args: [],
		}),
	])
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: shareTokenAddress,
		abi: peripherals_tokens_ShareToken_ShareToken.abi,
		functionName: 'migrate',
		args: [getShareTokenId(fromUniverseId, outcome)],
	}))
	return {
		action: 'migrateShares',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies TradingActionResult
}

export async function forkUniverseDirectly(client: WriteClient, universeId: bigint, questionId: bigint, securityPoolAddress: Address) {
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: getInfraContractAddresses().zoltar,
		abi: Zoltar_Zoltar.abi,
		functionName: 'forkUniverse',
		args: [universeId, questionId],
	}))
	return {
		action: 'forkUniverse',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies ForkAuctionActionResult
}

export async function forkZoltarUniverse(client: WriteClient, universeId: bigint, questionId: bigint) {
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: getInfraContractAddresses().zoltar,
		abi: Zoltar_Zoltar.abi,
		functionName: 'forkUniverse',
		args: [universeId, questionId],
	}))
	return {
		action: 'forkZoltar',
		hash,
		questionId: getQuestionIdHex(questionId),
		universeId,
	} satisfies ZoltarForkActionResult
}

export async function withdrawTruthAuctionBids(client: WriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, withdrawFor: Address, tick: bigint, bidIndex: bigint) {
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: truthAuctionAddress,
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'withdrawBids',
		args: [withdrawFor, [{ tick, bidIndex }]],
	}))
	return {
		action: 'withdrawBids',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies ForkAuctionActionResult
}

export async function createCompleteSetInSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'createCompleteSet',
		args: [],
		value: amount,
	}))
	return {
		action: 'createCompleteSet',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies TradingActionResult
}

export async function redeemCompleteSetInSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemCompleteSet',
		args: [amount],
	}))
	return {
		action: 'redeemCompleteSet',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies TradingActionResult
}

export async function reportOutcomeInSecurityPool(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, amount: bigint) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'depositToEscalationGame',
		args: [getReportingOutcomeValue(outcome), amount],
	}))
	return {
		action: 'reportOutcome',
		hash,
		outcome,
		securityPoolAddress,
		universeId,
	} satisfies ReportingActionResult
}

export async function withdrawEscalationFromSecurityPool(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[]) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const hash = await writeContractAndWait(client, () => client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'withdrawFromEscalationGame',
		args: [getReportingOutcomeValue(outcome), depositIndexes],
	}))
	return {
		action: 'withdrawEscalation',
		hash,
		outcome,
		securityPoolAddress,
		universeId,
	} satisfies ReportingActionResult
}
