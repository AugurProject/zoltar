import { encodeAbiParameters, encodeDeployData, getAddress, getContractAddress, getCreate2Address, keccak256, numberToBytes, parseAbiItem, toHex, zeroAddress, type Address, type Hash, type Hex } from 'viem'
import { ABIS } from './abis.js'
import { ScalarOutcomes_ScalarOutcomes, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData, peripherals_EscalationGame_EscalationGame, peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer, peripherals_SecurityPool_SecurityPool, peripherals_SecurityPoolForker_SecurityPoolForker, peripherals_SecurityPoolUtils_SecurityPoolUtils, peripherals_factories_EscalationGameFactory_EscalationGameFactory, peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory, peripherals_factories_SecurityPoolFactory_SecurityPoolFactory, peripherals_factories_ShareTokenFactory_ShareTokenFactory, peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory, peripherals_openOracle_OpenOracle_OpenOracle } from './contractArtifact.js'
import type { BalanceReadClient, ContractReadClient, DeploymentClient, DeploymentReadClient, DeploymentStatus, DeploymentStep, DeploymentStepId, EscalationDeposit, EscalationSide, ListedSecurityPool, MarketCreationResult, MarketDetails, MarketType, MarketWriteClient, OpenOracleActionResult, OracleManagerDetails, QuestionData, ReportingActionResult, ReportingDetails, ReportingOutcomeKey, SecurityPoolCreationResult, SecurityPoolSystemState, SecurityVaultActionResult, SecurityVaultDetails, TradingActionResult } from './types/contracts.js'

const GENESIS_REPUTATION_TOKEN = bigintToAddress(0x221657776846890989a759ba2973e427dff5c9bbn)
const PROXY_DEPLOYER_ADDRESS = bigintToAddress(0x7a0d94f55792c434d74a40883c6ed8545e406d12n)
const PROXY_DEPLOYER_SIGNER = getAddress('0x4c8d290a1b368ac4728d83a9e8321fc3af2b39b1')
const PROXY_DEPLOYER_RAW_TRANSACTION = '0xf87e8085174876e800830186a08080ad601f80600e600039806000f350fe60003681823780368234f58015156014578182fd5b80825250506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222' satisfies Hex
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' satisfies Hash
const ZERO_SALT = numberToBytes(0, { size: 32 })
const FUND_PROXY_DEPLOYER_SIGNER_AMOUNT = 10000000000000000n
const LIQUIDATION_OPERATION_TYPE = 0
const ESCALATION_TIME_LENGTH = 4_233_600n

function bigintToAddress(value: bigint): Address {
	return getAddress(`0x${ value.toString(16).padStart(40, '0') }`)
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function readOptionalBigint(record: Record<string, unknown>, key: string) {
	const value = record[key]
	return typeof value === 'bigint' ? value : undefined
}

function readOptionalAddress(record: Record<string, unknown>, key: string) {
	const value = record[key]
	return typeof value === 'string' ? getAddress(value) : undefined
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isEscalationDepositPage(value: unknown): value is readonly { amount: bigint; cumulativeAmount: bigint; depositor: Address }[] {
	return Array.isArray(value) && value.every(item => isObjectRecord(item) && typeof item['amount'] === 'bigint' && typeof item['cumulativeAmount'] === 'bigint' && typeof item['depositor'] === 'string')
}

function isQuestionTuple(value: unknown): value is [string, string, bigint, bigint, bigint, bigint, bigint, string] {
	return Array.isArray(value)
		&& value.length === 8
		&& typeof value[0] === 'string'
		&& typeof value[1] === 'string'
		&& typeof value[2] === 'bigint'
		&& typeof value[3] === 'bigint'
		&& typeof value[4] === 'bigint'
		&& typeof value[5] === 'bigint'
		&& typeof value[6] === 'bigint'
		&& typeof value[7] === 'string'
}

function isBigintTriple(value: unknown): value is [bigint, bigint, bigint] {
	return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'bigint')
}

function isBigintQuintuple(value: unknown): value is [bigint, bigint, bigint, bigint, bigint] {
	return Array.isArray(value) && value.length === 5 && value.every(item => typeof item === 'bigint')
}

function isForkDataTuple(value: unknown): value is [bigint, Address, bigint, bigint, bigint, boolean, number] {
	return Array.isArray(value)
		&& value.length === 7
		&& typeof value[0] === 'bigint'
		&& typeof value[1] === 'string'
		&& typeof value[2] === 'bigint'
		&& typeof value[3] === 'bigint'
		&& typeof value[4] === 'bigint'
		&& typeof value[5] === 'boolean'
		&& typeof value[6] === 'number'
}

function hasTimestamp(value: unknown): value is { timestamp: bigint } {
	return isObjectRecord(value) && typeof value['timestamp'] === 'bigint'
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

const DEPLOY_SECURITY_POOL_EVENT = parseAbiItem('event DeploySecurityPool(address securityPool, address truthAuction, address priceOracleManagerAndOperatorQueuer, address shareToken, address parent, uint248 universeId, uint256 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount)')

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

async function deployViaProxy(client: DeploymentClient, bytecode: Hex) {
	const hash = await client.sendTransaction({
		to: PROXY_DEPLOYER_ADDRESS,
		data: bytecode,
	})
	await client.waitForTransactionReceipt({ hash })
	return hash
}

async function ensureProxyDeployerDeployed(client: DeploymentClient) {
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

export async function loadDeploymentStatuses(client: DeploymentReadClient): Promise<DeploymentStatus[]> {
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

export async function loadGenesisRepBalance(client: BalanceReadClient, address: Address) {
	return (await client.readContract({
		abi: ABIS.mainnet.erc20,
		functionName: 'balanceOf',
		address: GENESIS_REPUTATION_TOKEN,
		args: [address],
	}))
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

async function loadOutcomeLabels(client: ContractReadClient, questionId: bigint) {
	let currentIndex = 0n
	const pageSize = 30n
	const outcomeLabels: string[] = []

	while (true) {
		const page = await client.readContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'getOutcomeLabels',
			address: getDeploymentStep('zoltarQuestionData').address,
			args: [questionId, currentIndex, pageSize],
		})
		if (!isStringArray(page)) throw new Error('Unexpected outcome labels response')

		const labels = page.filter(label => label.length > 0)
		outcomeLabels.push(...labels)
		if (BigInt(labels.length) !== pageSize) break
		currentIndex += pageSize
	}

	return outcomeLabels
}

async function loadEscalationDeposits(client: ContractReadClient, escalationGameAddress: Address, outcome: ReportingOutcomeKey): Promise<EscalationDeposit[]> {
	let currentIndex = 0n
	const pageSize = 30n
	const deposits: EscalationDeposit[] = []

	while (true) {
		const page = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getDepositsByOutcome',
			args: [getReportingOutcomeValue(outcome), currentIndex, pageSize],
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
		if (BigInt(normalizedPage.length) !== pageSize) break
		currentIndex += pageSize
	}

	return deposits
}

export async function loadMarketDetails(client: ContractReadClient, questionId: bigint): Promise<MarketDetails> {
	const question = await client.readContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'questions',
		address: getDeploymentStep('zoltarQuestionData').address,
		args: [questionId],
	})
	if (!isQuestionTuple(question)) throw new Error('Unexpected question data response')
	const [title, description, startTime, endTime, numTicks, displayValueMin, displayValueMax, answerUnit] = question

	const exists = title !== '' || description !== '' || startTime !== 0n || endTime !== 0n || numTicks !== 0n
	const outcomeLabels = exists ? await loadOutcomeLabels(client, questionId) : []

	return {
		answerUnit,
		description,
		displayValueMax,
		displayValueMin,
		endTime,
		exists,
		marketType: getMarketType({ title, description, startTime, endTime, numTicks, displayValueMin, displayValueMax, answerUnit }, outcomeLabels),
		outcomeLabels,
		questionId: getQuestionIdHex(questionId),
		startTime,
		title,
	}
}

export async function loadReportingDetails(client: ContractReadClient, securityPoolAddress: Address, accountAddress: Address | undefined): Promise<ReportingDetails> {
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
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'universeId',
			address: securityPoolAddress,
			args: [],
		}),
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
	client: MarketWriteClient,
	parameters: {
		marketType: MarketType
		outcomeLabels: string[]
		questionData: QuestionData
		currentRetentionRate: bigint | undefined
		securityMultiplier: bigint | undefined
		startingRepEthPrice: bigint
	},
) {
	const questionId = getQuestionId(parameters.questionData, parameters.outcomeLabels)

	const createQuestionHash = await client.writeContract({
		address: getDeploymentStep('zoltarQuestionData').address,
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'createQuestion',
		args: [parameters.questionData, parameters.outcomeLabels],
	})
	await client.waitForTransactionReceipt({ hash: createQuestionHash })

	return {
		questionId: getQuestionIdHex(questionId),
		createQuestionHash,
		marketType: parameters.marketType,
	} satisfies MarketCreationResult
}

export async function createSecurityPool(
	client: MarketWriteClient,
	parameters: {
		currentRetentionRate: bigint
		questionId: bigint
		securityMultiplier: bigint
		startingRepEthPrice: bigint
	},
) {
	const deployPoolHash = await client.writeContract({
		address: getDeploymentStep('securityPoolFactory').address,
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'deployOriginSecurityPool',
		args: [0n, parameters.questionId, parameters.securityMultiplier, parameters.currentRetentionRate, parameters.startingRepEthPrice],
	})
	await client.waitForTransactionReceipt({ hash: deployPoolHash })

	return {
		deployPoolHash,
		questionId: getQuestionIdHex(parameters.questionId),
		securityMultiplier: parameters.securityMultiplier,
		universeId: 0n,
	} satisfies SecurityPoolCreationResult
}

export async function loadSecurityVaultDetails(client: ContractReadClient, securityPoolAddress: Address, vaultAddress: Address): Promise<SecurityVaultDetails> {
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
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'universeId',
			address: securityPoolAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'securityVaults',
			address: securityPoolAddress,
			args: [vaultAddress],
		}),
	])
	if (!isBigintQuintuple(vaultData)) throw new Error('Unexpected security vault response')

	const [repDepositShare, securityBondAllowance, unpaidEthFees, , lockedRepInEscalationGame] = vaultData

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

export async function approveErc20<Action extends SecurityVaultActionResult['action'] | OpenOracleActionResult['action']>(
	client: MarketWriteClient,
	tokenAddress: Address,
	spenderAddress: Address,
	amount: bigint,
	action: Action,
) {
	const hash = await client.writeContract({
		address: tokenAddress,
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		args: [spenderAddress, amount],
	})
	await client.waitForTransactionReceipt({ hash })
	return { action, hash }
}

export async function depositRepToSecurityPool(client: MarketWriteClient, securityPoolAddress: Address, amount: bigint) {
	const hash = await client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'depositRep',
		args: [amount],
	})
	await client.waitForTransactionReceipt({ hash })
	return {
		action: 'depositRep',
		hash,
	} satisfies SecurityVaultActionResult
}

export async function updateSecurityVaultFees(client: MarketWriteClient, securityPoolAddress: Address, vaultAddress: Address) {
	const hash = await client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'updateVaultFees',
		args: [vaultAddress],
	})
	await client.waitForTransactionReceipt({ hash })
	return {
		action: 'updateVaultFees',
		hash,
	} satisfies SecurityVaultActionResult
}

export async function redeemSecurityVaultFees(client: MarketWriteClient, securityPoolAddress: Address, vaultAddress: Address) {
	const hash = await client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemFees',
		args: [vaultAddress],
	})
	await client.waitForTransactionReceipt({ hash })
	return {
		action: 'redeemFees',
		hash,
	} satisfies SecurityVaultActionResult
}

export async function redeemSecurityVaultRep(client: MarketWriteClient, securityPoolAddress: Address, vaultAddress: Address) {
	const hash = await client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemRep',
		args: [vaultAddress],
	})
	await client.waitForTransactionReceipt({ hash })
	return {
		action: 'redeemRep',
		hash,
	} satisfies SecurityVaultActionResult
}

export async function loadOracleManagerDetails(client: ContractReadClient, managerAddress: Address): Promise<OracleManagerDetails> {
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

export async function requestOraclePrice(client: MarketWriteClient, managerAddress: Address, ethCost: bigint) {
	const hash = await client.writeContract({
		address: managerAddress,
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		functionName: 'requestPrice',
		args: [],
		value: ethCost,
	})
	await client.waitForTransactionReceipt({ hash })
	return {
		action: 'requestPrice',
		hash,
	} satisfies OpenOracleActionResult
}

export async function submitInitialOracleReport(client: MarketWriteClient, reportId: bigint, amount1: bigint, amount2: bigint, stateHash: Hex) {
	const hash = await client.writeContract({
		address: getInfraContractAddresses().openOracle,
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'submitInitialReport',
		args: [reportId, amount1, amount2, stateHash],
	})
	await client.waitForTransactionReceipt({ hash })
	return {
		action: 'submitInitialReport',
		hash,
	} satisfies OpenOracleActionResult
}

export async function settleOracleReport(client: MarketWriteClient, reportId: bigint) {
	const hash = await client.writeContract({
		address: getInfraContractAddresses().openOracle,
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'settle',
		args: [reportId],
	})
	await client.waitForTransactionReceipt({ hash })
	return {
		action: 'settle',
		hash,
	} satisfies OpenOracleActionResult
}

export async function loadAllSecurityPools(client: ContractReadClient): Promise<ListedSecurityPool[]> {
	const logs = await client.getLogs({
		address: getInfraContractAddresses().securityPoolFactory,
		event: DEPLOY_SECURITY_POOL_EVENT,
		fromBlock: 0n,
		toBlock: 'latest',
	})

	return await Promise.all(logs.map(async (log: { args: Record<string, unknown> }) => {
		const args = isObjectRecord(log.args) ? log.args : {}
		const securityPoolAddress = readOptionalAddress(args, 'securityPool') ?? zeroAddress
		const [systemState, truthAuctionAddress, forkData] = await Promise.all([
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
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'forkData',
				address: getInfraContractAddresses().securityPoolForker,
				args: [securityPoolAddress],
			}),
		])
		if (!isForkDataTuple(forkData)) throw new Error('Unexpected fork data response')
		const [, , truthAuctionStartedAt, migratedRep, , forkOwnSecurityPool, forkOutcomeIndex] = forkData

		return {
			currentRetentionRate: readOptionalBigint(args, 'currentRetentionRate') ?? 0n,
			forkOutcome: getReportingOutcomeKey(forkOutcomeIndex),
			forkOwnSecurityPool,
			managerAddress: readOptionalAddress(args, 'priceOracleManagerAndOperatorQueuer') ?? zeroAddress,
			migratedRep,
			parent: readOptionalAddress(args, 'parent') ?? zeroAddress,
			questionId: getQuestionIdHex(readOptionalBigint(args, 'questionId') ?? 0n),
			securityMultiplier: readOptionalBigint(args, 'securityMultiplier') ?? 0n,
			securityPoolAddress,
			startingRepEthPrice: readOptionalBigint(args, 'startingRepEthPrice') ?? 0n,
			systemState: getSecurityPoolSystemState(systemState),
			truthAuctionAddress,
			truthAuctionStartedAt,
			universeId: readOptionalBigint(args, 'universeId') ?? 0n,
		}
	}))
}

export async function queueSecurityPoolLiquidation(client: MarketWriteClient, managerAddress: Address, targetVault: Address, amount: bigint, ethCost: bigint) {
	const hash = await client.writeContract({
		address: managerAddress,
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		functionName: 'requestPriceIfNeededAndQueueOperation',
		args: [LIQUIDATION_OPERATION_TYPE, targetVault, amount],
		value: ethCost,
	})
	await client.waitForTransactionReceipt({ hash })
	return hash
}

export async function createCompleteSetInSecurityPool(client: MarketWriteClient, securityPoolAddress: Address, amount: bigint) {
	const universeId = await client.readContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'universeId',
		args: [],
	})
	const hash = await client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'createCompleteSet',
		args: [],
		value: amount,
	})
	await client.waitForTransactionReceipt({ hash })
	return {
		action: 'createCompleteSet',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies TradingActionResult
}

export async function redeemCompleteSetInSecurityPool(client: MarketWriteClient, securityPoolAddress: Address, amount: bigint) {
	const universeId = await client.readContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'universeId',
		args: [],
	})
	const hash = await client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemCompleteSet',
		args: [amount],
	})
	await client.waitForTransactionReceipt({ hash })
	return {
		action: 'redeemCompleteSet',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies TradingActionResult
}

export async function reportOutcomeInSecurityPool(client: MarketWriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, amount: bigint) {
	const universeId = await client.readContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'universeId',
		args: [],
	})
	const hash = await client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'depositToEscalationGame',
		args: [getReportingOutcomeValue(outcome), amount],
	})
	await client.waitForTransactionReceipt({ hash })
	return {
		action: 'reportOutcome',
		hash,
		outcome,
		securityPoolAddress,
		universeId,
	} satisfies ReportingActionResult
}

export async function withdrawEscalationFromSecurityPool(client: MarketWriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[]) {
	const universeId = await client.readContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'universeId',
		args: [],
	})
	const hash = await client.writeContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'withdrawFromEscalationGame',
		args: [getReportingOutcomeValue(outcome), depositIndexes],
	})
	await client.waitForTransactionReceipt({ hash })
	return {
		action: 'withdrawEscalation',
		hash,
		outcome,
		securityPoolAddress,
		universeId,
	} satisfies ReportingActionResult
}
