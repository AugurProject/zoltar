import { createApplyLinkedLibrariesHelper } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { encodeDeployData, getAddress, getCreate2Address, keccak256, toHex, type Abi, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, ORACLE_FEE_PERCENTAGE, ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_MULTIPLIER, ORACLE_PROTOCOL_FEE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { SEPOLIA_REP_ALLOCATIONS } from '@zoltar/zoltar-shared/deployment/sepoliaRepAllocations'

// These operational oracle constants are duplicated from
// ui/statoblastShared/ts/protocol/deploymentHelpers.ts, which cannot be
// imported without a UI install. Drift is caught hard: every computed init
// code must reproduce the manifest CREATE2 address before verification runs.
const ORACLE_FEE_SINK_ADDRESS = '0x000000000000000000000000000000000000dEaD' satisfies Address
const ORACLE_REPORT_GAS = 100000n
const ORACLE_SETTLEMENT_GAS = 1000000
const ORACLE_SETTLEMENT_TIME = 40 * 12
const ORACLE_DISPUTE_DELAY = 0
const ORACLE_TIME_TYPE = true
const ORACLE_TRACK_DISPUTES = true
const ORACLE_ESCALATION_HALT_MULTIPLIER_BPS = 100000n
const ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS = 30000n
const ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS = 1000n

const SCALAR_OUTCOMES_SOURCE_PATH = 'contracts/ScalarOutcomes.sol'
const SECURITY_POOL_UTILS_SOURCE_PATH = 'contracts/statoblast/SecurityPoolUtils.sol'
const ZERO_SALT = toHex(0, { size: 32 })

export type DeploymentManifest = {
	deploymentSteps: readonly { address: Address; id: string; label: string }[]
	network: { chainId: number; genesisRepTokenAddress: Address; id: 'mainnet' | 'sepolia'; wethAddress: Address }
	protocolConfig: { forkBurnDivisor: bigint; forkThresholdDivisor: bigint; minimumSecurityBondDebtAttoEth: bigint; minimumVaultRepDepositAttoRep: bigint }
}

type CompilerProfile = 'main' | 'openOracle'

type ContractCreationArtifact = {
	abi: Abi
	// Unlinked creation bytecode without a 0x prefix, exactly as compiled.
	creationBytecode: string
}

export type ArtifactLookup = (sourcePath: string, contractName: string) => ContractCreationArtifact

export type VerificationJob = {
	address: Address
	compilerProfile: CompilerProfile
	// ABI-encoded constructor arguments without a 0x prefix; empty when the
	// constructor takes no arguments.
	constructorArguments: string
	contractIdentifier: string
	id: string
	label: string
}

export type VerificationPlan = {
	jobs: VerificationJob[]
	libraryAddresses: { scalarOutcomes: Address; securityPoolUtils: Address }
	skipped: { id: string; reason: string }[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function readString(source: Record<string, unknown>, field: string, label: string): string {
	const value = source[field]
	if (typeof value !== 'string') throw new Error(`Deployment manifest field ${label} must be a string`)
	return value
}

function readDecimalBigInt(source: Record<string, unknown>, field: string, label: string): bigint {
	const value = readString(source, field, label)
	if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`Deployment manifest field ${label} must be a canonical decimal integer`)
	return BigInt(value)
}

export function parseDeploymentManifest(rawManifest: unknown, expectedNetworkId: 'mainnet' | 'sepolia'): DeploymentManifest {
	if (!isRecord(rawManifest)) throw new Error('Deployment manifest must be an object')
	const network = rawManifest['network']
	const protocolConfig = rawManifest['protocolConfig']
	const deploymentSteps = rawManifest['deploymentSteps']
	if (!isRecord(network)) throw new Error('Deployment manifest network must be an object')
	if (!isRecord(protocolConfig)) throw new Error('Deployment manifest protocolConfig must be an object')
	if (!Array.isArray(deploymentSteps)) throw new Error('Deployment manifest deploymentSteps must be an array')
	const chainId = network['chainId']
	if (typeof chainId !== 'number') throw new Error('Deployment manifest network.chainId must be a number')
	const networkId = readString(network, 'id', 'network.id')
	if (networkId !== expectedNetworkId) throw new Error(`Expected ${expectedNetworkId} deployment manifest, received ${networkId}`)
	return {
		deploymentSteps: deploymentSteps.map((step, index) => {
			if (!isRecord(step)) throw new Error(`Deployment manifest step ${index.toString()} must be an object`)
			return {
				address: getAddress(readString(step, 'address', `deploymentSteps[${index.toString()}].address`)),
				id: readString(step, 'id', `deploymentSteps[${index.toString()}].id`),
				label: readString(step, 'label', `deploymentSteps[${index.toString()}].label`),
			}
		}),
		network: {
			chainId,
			genesisRepTokenAddress: getAddress(readString(network, 'genesisRepTokenAddress', 'network.genesisRepTokenAddress')),
			id: networkId,
			wethAddress: getAddress(readString(network, 'wethAddress', 'network.wethAddress')),
		},
		protocolConfig: {
			forkBurnDivisor: readDecimalBigInt(protocolConfig, 'forkBurnDivisor', 'protocolConfig.forkBurnDivisor'),
			forkThresholdDivisor: readDecimalBigInt(protocolConfig, 'forkThresholdDivisor', 'protocolConfig.forkThresholdDivisor'),
			minimumSecurityBondDebtAttoEth: readDecimalBigInt(protocolConfig, 'minimumSecurityBondDebtAttoEth', 'protocolConfig.minimumSecurityBondDebtAttoEth'),
			minimumVaultRepDepositAttoRep: readDecimalBigInt(protocolConfig, 'minimumVaultRepDepositAttoRep', 'protocolConfig.minimumVaultRepDepositAttoRep'),
		},
	}
}

type PlanContext = {
	manifest: DeploymentManifest
	stepAddress: (id: string) => Address
}

type StepDefinition = {
	artifactPath: string
	buildArgs?: (context: PlanContext) => readonly unknown[]
	compilerProfile: CompilerProfile
	contractName: string
	// Source path inside the profile's standard JSON input when it differs
	// from the merged artifact path (the OpenOracle pass compiles under its
	// upstream layout).
	inputPath?: string
	linksLibraries?: boolean
}

const UNVERIFIABLE_STEPS: Readonly<Record<string, string>> = {
	proxyDeployer: 'raw EVM deterministic proxy with no Solidity source',
}

const STEP_DEFINITIONS: Readonly<Record<string, StepDefinition>> = {
	deploymentStatusOracle: {
		artifactPath: 'contracts/DeploymentStatusOracle.sol',
		buildArgs: context => [context.manifest.deploymentSteps.filter(step => step.id !== 'deploymentStatusOracle').map(step => step.address)],
		compilerProfile: 'main',
		contractName: 'DeploymentStatusOracle',
	},
	weth: {
		artifactPath: 'contracts/statoblast/WETH9.sol',
		compilerProfile: 'main',
		contractName: 'WETH9',
	},
	reputationToken: {
		artifactPath: 'contracts/GenesisReputationToken.sol',
		buildArgs: () => [SEPOLIA_REP_ALLOCATIONS.map(allocation => allocation.address), SEPOLIA_REP_ALLOCATIONS.map(allocation => allocation.amount)],
		compilerProfile: 'main',
		contractName: 'GenesisReputationToken',
	},
	multicall3: {
		artifactPath: 'contracts/statoblast/Multicall3.sol',
		compilerProfile: 'main',
		contractName: 'Multicall3',
	},
	scalarOutcomes: {
		artifactPath: SCALAR_OUTCOMES_SOURCE_PATH,
		compilerProfile: 'main',
		contractName: 'ScalarOutcomes',
	},
	zoltarQuestionData: {
		artifactPath: 'contracts/ZoltarQuestionData.sol',
		compilerProfile: 'main',
		contractName: 'ZoltarQuestionData',
		linksLibraries: true,
	},
	zoltar: {
		artifactPath: 'contracts/Zoltar.sol',
		buildArgs: context => [context.stepAddress('zoltarQuestionData'), context.manifest.network.genesisRepTokenAddress, context.manifest.protocolConfig.forkThresholdDivisor, context.manifest.protocolConfig.forkBurnDivisor],
		compilerProfile: 'main',
		contractName: 'Zoltar',
	},
	uniformPriceDualCapBatchAuctionFactory: {
		artifactPath: 'contracts/statoblast/factories/UniformPriceDualCapBatchAuctionFactory.sol',
		compilerProfile: 'main',
		contractName: 'UniformPriceDualCapBatchAuctionFactory',
	},
	securityPoolUtils: {
		artifactPath: SECURITY_POOL_UTILS_SOURCE_PATH,
		compilerProfile: 'main',
		contractName: 'SecurityPoolUtils',
	},
	securityPoolOperationsDelegate: {
		artifactPath: 'contracts/statoblast/SecurityPoolOperationsDelegate.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolOperationsDelegate',
		linksLibraries: true,
	},
	openOracle: {
		artifactPath: 'contracts/statoblast/openOracle/OpenOracle.sol',
		compilerProfile: 'openOracle',
		contractName: 'OpenOracle',
		inputPath: 'src/OpenOracleSlim.sol',
	},
	shareTokenFactory: {
		artifactPath: 'contracts/statoblast/factories/ShareTokenFactory.sol',
		buildArgs: context => [context.stepAddress('zoltar')],
		compilerProfile: 'main',
		contractName: 'ShareTokenFactory',
	},
	priceOracleManagerAndOperatorQueuerFactory: {
		artifactPath: 'contracts/statoblast/factories/PriceOracleManagerAndOperatorQueuerFactory.sol',
		buildArgs: context => [
			context.manifest.network.wethAddress,
			ORACLE_REPORT_GAS,
			ORACLE_SETTLEMENT_GAS,
			ORACLE_GAS_UNITS_FOR_ONE_DISPUTE,
			ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE,
			OPEN_ORACLE_SECURITY_MULTIPLIER_BPS,
			ORACLE_SETTLEMENT_TIME,
			ORACLE_DISPUTE_DELAY,
			ORACLE_PROTOCOL_FEE,
			ORACLE_FEE_PERCENTAGE,
			ORACLE_MULTIPLIER,
			ORACLE_TIME_TYPE,
			ORACLE_TRACK_DISPUTES,
			ORACLE_FEE_SINK_ADDRESS,
			ORACLE_ESCALATION_HALT_MULTIPLIER_BPS,
			ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS,
			ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS,
		],
		compilerProfile: 'main',
		contractName: 'PriceOracleManagerAndOperatorQueuerFactory',
		linksLibraries: true,
	},
	securityPoolForker: {
		artifactPath: 'contracts/statoblast/SecurityPoolForker.sol',
		buildArgs: context => [context.stepAddress('zoltar')],
		compilerProfile: 'main',
		contractName: 'SecurityPoolForker',
		linksLibraries: true,
	},
	escalationGameClaimDelegate: {
		artifactPath: 'contracts/statoblast/EscalationGameClaimDelegate.sol',
		compilerProfile: 'main',
		contractName: 'EscalationGameClaimDelegate',
	},
	escalationGameFactory: {
		artifactPath: 'contracts/statoblast/factories/EscalationGameFactory.sol',
		buildArgs: context => [context.stepAddress('escalationGameClaimDelegate')],
		compilerProfile: 'main',
		contractName: 'EscalationGameFactory',
	},
	securityPoolFactory: {
		artifactPath: 'contracts/statoblast/factories/SecurityPoolFactory.sol',
		buildArgs: context => [
			context.stepAddress('securityPoolForker'),
			context.stepAddress('zoltarQuestionData'),
			context.stepAddress('escalationGameFactory'),
			context.stepAddress('openOracle'),
			context.stepAddress('zoltar'),
			context.stepAddress('shareTokenFactory'),
			context.stepAddress('uniformPriceDualCapBatchAuctionFactory'),
			context.stepAddress('priceOracleManagerAndOperatorQueuerFactory'),
			context.manifest.protocolConfig.minimumSecurityBondDebtAttoEth,
			context.manifest.protocolConfig.minimumVaultRepDepositAttoRep,
			context.stepAddress('securityPoolOperationsDelegate'),
		],
		compilerProfile: 'main',
		contractName: 'SecurityPoolFactory',
		linksLibraries: true,
	},
}

export function buildVerificationPlan(manifest: DeploymentManifest, getArtifact: ArtifactLookup): VerificationPlan {
	const stepsById = new Map(manifest.deploymentSteps.map(step => [step.id, step]))
	const stepAddress = (id: string) => {
		const step = stepsById.get(id)
		if (step === undefined) throw new Error(`Deployment manifest for ${manifest.network.id} is missing the ${id} step`)
		return step.address
	}
	const proxyDeployerAddress = stepAddress('proxyDeployer')
	const libraryAddresses = { scalarOutcomes: stepAddress('scalarOutcomes'), securityPoolUtils: stepAddress('securityPoolUtils') }
	const { applyLibraries } = createApplyLinkedLibrariesHelper(() => [
		{ address: libraryAddresses.scalarOutcomes, hash: keccak256(toHex(`${SCALAR_OUTCOMES_SOURCE_PATH}:ScalarOutcomes`)).slice(2, 36) },
		{ address: libraryAddresses.securityPoolUtils, hash: keccak256(toHex(`${SECURITY_POOL_UTILS_SOURCE_PATH}:SecurityPoolUtils`)).slice(2, 36) },
	])
	const context: PlanContext = { manifest, stepAddress }
	const jobs: VerificationJob[] = []
	const skipped: { id: string; reason: string }[] = []
	for (const step of manifest.deploymentSteps) {
		const unverifiableReason = UNVERIFIABLE_STEPS[step.id]
		if (unverifiableReason !== undefined) {
			skipped.push({ id: step.id, reason: unverifiableReason })
			continue
		}
		const definition = STEP_DEFINITIONS[step.id]
		if (definition === undefined) throw new Error(`Deployment step ${step.id} has no contract-verification definition. Add one to tooling/contracts/contract-verification.mts.`)
		const artifact = getArtifact(definition.artifactPath, definition.contractName)
		const linkedBytecode: Hex = definition.linksLibraries === true ? applyLibraries(artifact.creationBytecode) : `0x${artifact.creationBytecode}`
		const initCode = definition.buildArgs === undefined ? linkedBytecode : encodeDeployData({ abi: artifact.abi, args: definition.buildArgs(context), bytecode: linkedBytecode })
		const computedAddress = getCreate2Address({ bytecode: initCode, from: proxyDeployerAddress, salt: ZERO_SALT })
		if (computedAddress !== step.address) {
			throw new Error(`Computed init code for ${step.id} derives ${computedAddress} instead of the manifest address ${step.address}. The verification constants in tooling/contracts/contract-verification.mts have drifted from the deployment plan, or contract artifacts are stale.`)
		}
		jobs.push({
			address: step.address,
			compilerProfile: definition.compilerProfile,
			constructorArguments: initCode.slice(2 + artifact.creationBytecode.length),
			contractIdentifier: `${definition.inputPath ?? definition.artifactPath}:${definition.contractName}`,
			id: step.id,
			label: step.label,
		})
	}
	return { jobs, libraryAddresses, skipped }
}

export type ExplorerTarget = {
	apiKey: string | undefined
	apiUrl: string
	baseParameters: Readonly<Record<string, string>>
	name: string
	requiresApiKey: boolean
}

export function getExplorerTargets(chainId: number, environment: Readonly<Record<string, string | undefined>>): ExplorerTarget[] {
	const blockscoutApiUrls: Readonly<Record<number, string>> = { 1: 'https://eth.blockscout.com/api', 11_155_111: 'https://eth-sepolia.blockscout.com/api' }
	const blockscoutApiUrl = blockscoutApiUrls[chainId]
	if (blockscoutApiUrl === undefined) return []
	// An unset GitHub Actions secret arrives as an empty string; treat it as missing.
	const etherscanApiKey = environment['ETHERSCAN_API_KEY']
	return [
		{ apiKey: etherscanApiKey === '' ? undefined : etherscanApiKey, apiUrl: 'https://api.etherscan.io/v2/api', baseParameters: { chainid: chainId.toString() }, name: 'Etherscan', requiresApiKey: true },
		{ apiKey: undefined, apiUrl: blockscoutApiUrl, baseParameters: {}, name: 'Blockscout', requiresApiKey: false },
	]
}

export type ExplorerFetch = (url: string, init?: { body?: string; headers?: Record<string, string>; method?: string }) => Promise<{ json(): Promise<unknown>; ok: boolean; status: number }>

export type VerificationOutcome = {
	detail?: string
	id: string
	status: 'already-verified' | 'failed' | 'not-deployed' | 'verified'
}

export type StandardJsonInputs = Readonly<Record<CompilerProfile, { compilerVersion: string; inputJson: string }>>

const SUBMISSION_DELAY_MILLISECONDS = 500
const POLL_INTERVAL_MILLISECONDS = 5_000
const POLL_TIMEOUT_MILLISECONDS = 5 * 60 * 1_000

function isAlreadyVerifiedMessage(message: string) {
	return /already verified/i.test(message)
}

function isMissingContractMessage(message: string) {
	return /unable to locate contractcode|not a smart contract|unable to find contractcode|no contract code|does not have.*code|contract.*not.*deployed/i.test(message)
}

function isPendingMessage(message: string) {
	return /pending|queue|in process|processing/i.test(message)
}

async function callExplorer(fetchFn: ExplorerFetch, target: ExplorerTarget, parameters: Readonly<Record<string, string>>, method: 'GET' | 'POST'): Promise<{ result: unknown; status: string }> {
	const query = new URLSearchParams({ ...target.baseParameters, ...(target.apiKey === undefined ? {} : { apikey: target.apiKey }), ...parameters })
	const response = method === 'GET' ? await fetchFn(`${target.apiUrl}?${query.toString()}`) : await fetchFn(target.apiUrl, { body: query.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, method: 'POST' })
	if (!response.ok) throw new Error(`${target.name} responded with HTTP ${response.status.toString()}`)
	const payload = await response.json()
	if (!isRecord(payload)) throw new Error(`${target.name} returned a non-object response`)
	const status = payload['status']
	return { result: payload['result'], status: typeof status === 'string' ? status : '' }
}

function resultText(result: unknown): string {
	if (typeof result === 'string') return result
	return JSON.stringify(result) ?? String(result)
}

async function isContractAlreadyVerified(fetchFn: ExplorerFetch, target: ExplorerTarget, address: Address): Promise<boolean> {
	const { result } = await callExplorer(fetchFn, target, { action: 'getsourcecode', address, module: 'contract' }, 'GET')
	if (!Array.isArray(result)) return false
	const entry = result[0]
	if (!isRecord(entry)) return false
	const sourceCode = entry['SourceCode']
	return typeof sourceCode === 'string' && sourceCode !== ''
}

type SubmissionResult = { detail: string; kind: 'already-verified' | 'failed' | 'not-deployed' } | { guid: string; kind: 'submitted' }

async function submitVerification(fetchFn: ExplorerFetch, target: ExplorerTarget, job: VerificationJob, input: { compilerVersion: string; inputJson: string }): Promise<SubmissionResult> {
	const { result, status } = await callExplorer(
		fetchFn,
		target,
		{
			action: 'verifysourcecode',
			codeformat: 'solidity-standard-json-input',
			compilerversion: input.compilerVersion,
			// The explorer APIs use this historical misspelling.
			constructorArguements: job.constructorArguments,
			contractaddress: job.address,
			contractname: job.contractIdentifier,
			module: 'contract',
			sourceCode: input.inputJson,
		},
		'POST',
	)
	const message = resultText(result)
	if (status === '1') return { guid: message, kind: 'submitted' }
	if (isAlreadyVerifiedMessage(message)) return { detail: message, kind: 'already-verified' }
	if (isMissingContractMessage(message)) return { detail: message, kind: 'not-deployed' }
	return { detail: message, kind: 'failed' }
}

async function pollVerificationStatus(fetchFn: ExplorerFetch, target: ExplorerTarget, guid: string, sleep: (milliseconds: number) => Promise<void>): Promise<{ detail: string; verified: boolean }> {
	const deadline = Date.now() + POLL_TIMEOUT_MILLISECONDS
	while (true) {
		const { result } = await callExplorer(fetchFn, target, { action: 'checkverifystatus', guid, module: 'contract' }, 'GET')
		const message = resultText(result)
		if (/pass/i.test(message) || isAlreadyVerifiedMessage(message)) return { detail: message, verified: true }
		if (!isPendingMessage(message)) return { detail: message, verified: false }
		if (Date.now() >= deadline) return { detail: `verification did not finish before the ${(POLL_TIMEOUT_MILLISECONDS / 1_000).toString()}s polling deadline (${message})`, verified: false }
		await sleep(POLL_INTERVAL_MILLISECONDS)
	}
}

export async function verifyContractsWithExplorer(parameters: { fetchFn: ExplorerFetch; inputs: StandardJsonInputs; jobs: readonly VerificationJob[]; log: (message: string) => void; sleep: (milliseconds: number) => Promise<void>; target: ExplorerTarget }): Promise<VerificationOutcome[]> {
	const { fetchFn, inputs, jobs, log, sleep, target } = parameters
	const outcomes: VerificationOutcome[] = []
	const pendingSubmissions: { guid: string; job: VerificationJob }[] = []
	for (const job of jobs) {
		try {
			if (await isContractAlreadyVerified(fetchFn, target, job.address)) {
				log(`  ${job.label} (${job.address}): already verified`)
				outcomes.push({ id: job.id, status: 'already-verified' })
				continue
			}
			const submission = await submitVerification(fetchFn, target, job, inputs[job.compilerProfile])
			if (submission.kind === 'submitted') {
				log(`  ${job.label} (${job.address}): submitted (guid ${submission.guid})`)
				pendingSubmissions.push({ guid: submission.guid, job })
			} else {
				log(`  ${job.label} (${job.address}): ${submission.kind} (${submission.detail})`)
				outcomes.push({ detail: submission.detail, id: job.id, status: submission.kind })
			}
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error)
			log(`  ${job.label} (${job.address}): failed (${detail})`)
			outcomes.push({ detail, id: job.id, status: 'failed' })
		}
		await sleep(SUBMISSION_DELAY_MILLISECONDS)
	}
	for (const { guid, job } of pendingSubmissions) {
		try {
			const { detail, verified } = await pollVerificationStatus(fetchFn, target, guid, sleep)
			log(`  ${job.label} (${job.address}): ${verified ? 'verified' : 'failed'} (${detail})`)
			outcomes.push({ detail, id: job.id, status: verified ? 'verified' : 'failed' })
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error)
			log(`  ${job.label} (${job.address}): failed (${detail})`)
			outcomes.push({ detail, id: job.id, status: 'failed' })
		}
	}
	return outcomes
}
