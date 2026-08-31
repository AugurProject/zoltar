import { eip191Signer } from 'micro-eth-signer'
import { encodeDeployData, getAddress, keccak256, privateKeyToAccount, TRANSACTION_SUBMISSION_CAPABILITY_PROBE, type Address, type Hex } from '../support/bot-shared.ts'
import { createAnvilNodeForConnectionMode, type AnvilNode } from '../../../../solidity/ts/testSupport/simulator/anvilNode.ts'
import { addressString } from '../../../../solidity/ts/testSupport/simulator/utils/bigint.ts'
import { createWriteClient, writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients.ts'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, WETH_ADDRESS } from '../../../../solidity/ts/testSupport/simulator/utils/constants.ts'
import { deployOriginSecurityPool, ensureInfraDeployed, getInfraContractAddresses, getSecurityPoolAddresses } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast.ts'
import { createQuestion, getQuestionId } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltarQuestionData.ts'
import { manipulatePriceOracle } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/statoblastTestUtils.ts'
import { setupTestAccounts } from '../../../../solidity/ts/testSupport/simulator/utils/utilities.ts'
import { ReputationToken_ReputationToken, ZoltarQuestionData_ZoltarQuestionData, trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory, trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter } from '../../../../solidity/ts/types/contractArtifact.ts'

export const CHAOS_TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
export const CHAOS_TEST_FINALITY_BLOCKS = 2n
export const ONE_TOKEN = 10n ** 18n

const YEAR = 365n * 86_400n
const INITIAL_TIMESTAMP = 2_000_000_000n
const TEST_ETH_BALANCE = 10n * ONE_TOKEN
const TEST_REP_BALANCE = 1_000n * ONE_TOKEN
const ORIGIN_UNIVERSE = 0n
const STATOBLAST_SECURITY_MULTIPLIER_BPS = 20_000n
const TRADING_FEE_BPS = 30n

type JsonRpcRequest = {
	id: number | string
	jsonrpc: '2.0'
	method: string
	params: unknown[]
}

export type ChaosRpcProxy = {
	dispose: () => void
	rawTransactions: readonly Hex[]
	rpcUrl: string
	successfulSendRawTransactionParams: readonly (readonly unknown[])[]
}

export type ChaosPrivateRelay = {
	dispose: () => void
	rawTransactions: readonly Hex[]
	relayUrl: string
}

export type ChaosAnvilFixture = {
	baselineQuestionCount: bigint
	createPrivateRelay: () => ChaosPrivateRelay
	createRpcProxy: (options?: { lostAcknowledgementOrdinal?: number | undefined }) => ChaosRpcProxy
	dispose: () => Promise<void>
	infra: ReturnType<typeof getInfraContractAddresses>
	node: AnvilNode
	pool: ReturnType<typeof getSecurityPoolAddresses>['securityPool']
	questionId: bigint
	restoreBaseline: () => Promise<void>
	signer: Address
	tradingFactory: Address
	tradingRouter: Address
}

function privateTransaction(value: unknown): Hex {
	if (typeof value !== 'object' || value === null || Array.isArray(value) || !('tx' in value) || !hex(value.tx)) throw new Error('Private relay request did not contain serialized transaction bytes')
	return value.tx
}

function relayAuthenticationMatches(value: string | null, requestBody: string) {
	if (value === null) return false
	const [address, signature, extra] = value.split(':')
	if (address === undefined || signature === undefined || extra !== undefined || !/^0x[0-9a-fA-F]{40}$/.test(address) || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return false
	return eip191Signer.verify(signature, keccak256(requestBody), address)
}

function createPrivateRelay(node: AnvilNode): ChaosPrivateRelay {
	const rawTransactions: Hex[] = []
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const requestText = await request.text()
			const body = jsonRpcRequest(JSON.parse(requestText))
			if (body.method === 'eth_chainId') {
				return await fetch(node.rpcUrl, { body: requestText, headers: { 'content-type': 'application/json' }, method: 'POST' })
			}
			const relayAuthentication = request.headers.get('x-flashbots-signature')
			if (relayAuthentication === null) {
				return Response.json({ error: { code: -32_600, message: 'x-flashbots-signature is required' }, id: null, jsonrpc: '2.0' }, { status: 401 })
			}
			if (!relayAuthenticationMatches(relayAuthentication, requestText)) {
				return Response.json({ error: { code: -32_600, message: 'Invalid relay authentication' }, id: body.id, jsonrpc: '2.0' }, { status: 401 })
			}
			if (body.method !== 'eth_sendPrivateTransaction' || body.params.length !== 1) {
				return Response.json({ error: { code: -32_601, message: 'Unsupported private relay method' }, id: body.id, jsonrpc: '2.0' })
			}
			const rawTransaction = privateTransaction(body.params[0])
			const upstream = await fetch(node.rpcUrl, {
				body: JSON.stringify({ id: body.id, jsonrpc: '2.0', method: 'eth_sendRawTransaction', params: [rawTransaction] }),
				headers: { 'content-type': 'application/json' },
				method: 'POST',
			})
			const upstreamText = await upstream.text()
			const upstreamBody: unknown = JSON.parse(upstreamText)
			if (rawTransaction === TRANSACTION_SUBMISSION_CAPABILITY_PROBE && !successfulJsonRpcResult(upstreamBody)) {
				return Response.json({ error: { code: -32_602, message: 'failed to recover the signer from transaction' }, id: body.id, jsonrpc: '2.0' })
			}
			if (!upstream.ok || !successfulJsonRpcResult(upstreamBody)) return new Response(upstreamText, { headers: { 'content-type': 'application/json' }, status: upstream.status })
			rawTransactions.push(rawTransaction)
			await mineFinalityBlocks(node)
			return new Response(upstreamText, { headers: { 'content-type': 'application/json' }, status: upstream.status })
		},
	})
	if (server.port === undefined) {
		server.stop(true)
		throw new Error('Integration private relay did not expose a port')
	}
	return {
		dispose: () => server.stop(true),
		get rawTransactions() {
			return [...rawTransactions]
		},
		relayUrl: `http://127.0.0.1:${server.port.toString()}`,
	}
}

function jsonRpcRequest(value: unknown): JsonRpcRequest {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Integration proxy requires one JSON-RPC request object')
	if (!('id' in value) || (typeof value.id !== 'number' && typeof value.id !== 'string')) throw new Error('Integration proxy request is missing its id')
	if (!('jsonrpc' in value) || value.jsonrpc !== '2.0') throw new Error('Integration proxy requires JSON-RPC 2.0')
	if (!('method' in value) || typeof value.method !== 'string') throw new Error('Integration proxy request is missing its method')
	if (!('params' in value) || !Array.isArray(value.params)) throw new Error('Integration proxy request is missing its params')
	return { id: value.id, jsonrpc: value.jsonrpc, method: value.method, params: value.params }
}

function successfulJsonRpcResult(value: unknown) {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && 'result' in value && !('error' in value)
}

function hex(value: unknown): value is Hex {
	return typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value)
}

function bytecode(value: string, label: string): Hex {
	const candidate = value.startsWith('0x') ? value : `0x${value}`
	if (!hex(candidate) || candidate === '0x') throw new Error(`${label} bytecode is unavailable`)
	return candidate
}

async function deploy(client: ReturnType<typeof createWriteClient>, data: Hex, label: string): Promise<Address> {
	const hash = await client.sendTransaction({ data })
	const receipt = await client.waitForTransactionReceipt({ hash })
	if (receipt.status === 'reverted' || receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error(`${label} deployment failed`)
	return receipt.contractAddress
}

async function mineFinalityBlocks(node: AnvilNode) {
	for (let block = 0n; block < CHAOS_TEST_FINALITY_BLOCKS; block += 1n) {
		await node.anvilWindowEthereum.requestRaw({ method: 'evm_mine', params: [] })
	}
}

function createRpcProxy(node: AnvilNode, options: { lostAcknowledgementOrdinal?: number | undefined } = {}): ChaosRpcProxy {
	const rawTransactions: Hex[] = []
	const successfulSendRawTransactionParams: unknown[][] = []
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const requestText = await request.text()
			const body = jsonRpcRequest(JSON.parse(requestText))
			const upstream = await fetch(node.rpcUrl, {
				body: requestText,
				headers: { 'content-type': 'application/json' },
				method: 'POST',
			})
			const upstreamText = await upstream.text()
			if (body.method !== 'eth_sendRawTransaction' || !upstream.ok) {
				return new Response(upstreamText, { headers: { 'content-type': 'application/json' }, status: upstream.status })
			}
			const upstreamBody: unknown = JSON.parse(upstreamText)
			if (!successfulJsonRpcResult(upstreamBody)) {
				return new Response(upstreamText, { headers: { 'content-type': 'application/json' }, status: upstream.status })
			}
			const rawTransaction = body.params[0]
			if (!hex(rawTransaction)) throw new Error('eth_sendRawTransaction did not contain serialized transaction bytes')
			rawTransactions.push(rawTransaction)
			successfulSendRawTransactionParams.push([...body.params])
			await mineFinalityBlocks(node)
			if (rawTransactions.length === options.lostAcknowledgementOrdinal) {
				return Response.json({
					error: { code: -32_098, message: 'Simulated lost acknowledgement after transaction acceptance' },
					id: body.id,
					jsonrpc: '2.0',
				})
			}
			return new Response(upstreamText, { headers: { 'content-type': 'application/json' }, status: upstream.status })
		},
	})
	if (server.port === undefined) {
		server.stop(true)
		throw new Error('Integration JSON-RPC proxy did not expose a port')
	}
	return {
		dispose: () => server.stop(true),
		get rawTransactions() {
			return [...rawTransactions]
		},
		rpcUrl: `http://127.0.0.1:${server.port.toString()}`,
		get successfulSendRawTransactionParams() {
			return successfulSendRawTransactionParams.map(params => [...params])
		},
	}
}

export async function createChaosAnvilFixture(): Promise<ChaosAnvilFixture> {
	const node = await createAnvilNodeForConnectionMode(
		{ port: 0, rpcUrl: '', type: 'spawn-isolated' },
		{
			chainId: 1,
			context: 'chaos ecosystem workflow integration',
			disableCodeSizeLimit: true,
			gasLimit: 100_000_000n,
			startTimestamp: INITIAL_TIMESTAMP,
		},
	)
	try {
		const simulator = node.anvilWindowEthereum
		await setupTestAccounts(simulator)
		const deployer = createWriteClient(simulator, TEST_ADDRESSES[0], 0)
		await ensureInfraDeployed(deployer)

		const signer = privateKeyToAccount(CHAOS_TEST_PRIVATE_KEY).address
		await simulator.setBalance(signer, TEST_ETH_BALANCE)
		await writeContractAndWait(deployer, () =>
			deployer.writeContract({
				abi: ReputationToken_ReputationToken.abi,
				address: addressString(GENESIS_REPUTATION_TOKEN),
				args: [signer, TEST_REP_BALANCE],
				functionName: 'transfer',
			}),
		)

		const now = await simulator.getTime()
		const question = {
			answerUnit: '',
			description: 'Permanent chaos-bot ecosystem integration fixture',
			displayValueMax: 0n,
			displayValueMin: 0n,
			endTime: now + YEAR,
			numTicks: 0n,
			startTime: 0n,
			title: 'Chaos integration binary question',
		}
		const outcomes = ['Yes', 'No']
		const questionId = getQuestionId(question, outcomes)
		await createQuestion(deployer, question, outcomes)
		await deployOriginSecurityPool(deployer, ORIGIN_UNIVERSE, questionId, STATOBLAST_SECURITY_MULTIPLIER_BPS)
		const infra = getInfraContractAddresses()
		const poolAddresses = getSecurityPoolAddresses(getAddress('0x0000000000000000000000000000000000000000'), ORIGIN_UNIVERSE, questionId, STATOBLAST_SECURITY_MULTIPLIER_BPS)
		const pool = poolAddresses.securityPool
		await manipulatePriceOracle(deployer, simulator, poolAddresses.priceOracleManagerAndOperatorQueuer)

		const tradingFactory = await deploy(
			deployer,
			encodeDeployData({
				abi: trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory.abi,
				args: [infra.securityPoolFactory, TRADING_FEE_BPS],
				bytecode: bytecode(trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory.evm.bytecode.object, 'Trading factory'),
			}),
			'Trading factory',
		)
		const tradingRouter = await deploy(
			deployer,
			encodeDeployData({
				abi: trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter.abi,
				args: [tradingFactory],
				bytecode: bytecode(trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter.evm.bytecode.object, 'Trading router'),
			}),
			'Trading router',
		)

		const baselineQuestionCount = await deployer.readContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			address: infra.zoltarQuestionData,
			functionName: 'getQuestionCount',
		})
		let baselineSnapshot = await simulator.anvilSnapshot()
		return {
			baselineQuestionCount,
			createPrivateRelay: () => createPrivateRelay(node),
			createRpcProxy: options => createRpcProxy(node, options),
			dispose: node.dispose,
			infra,
			node,
			pool,
			questionId,
			restoreBaseline: async () => {
				await simulator.anvilRevert(baselineSnapshot)
				baselineSnapshot = await simulator.anvilSnapshot()
			},
			signer,
			tradingFactory,
			tradingRouter,
		}
	} catch (error) {
		await node.dispose()
		throw error
	}
}

export { GENESIS_REPUTATION_TOKEN, WETH_ADDRESS }
