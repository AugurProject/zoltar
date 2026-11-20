import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, getAddress, http, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { finalizationRequest, scanSettlementFinalizations, settlementFinalizationCandidate } from '#monitoring/settlement-finalization'

function required(name: string) {
	const value = process.env[name]
	if (value === undefined || value === '') throw new Error(`Missing ${name}`)
	return value
}

function positiveInteger(name: string) {
	const value = required(name)
	if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${name} must be a positive integer`)
	return BigInt(value)
}

if (process.argv.includes('--help')) {
	console.log(`Settlement finalizer: scan a Statoblast portfolio once for funded final questions.
Set SETTLEMENT_RPC_URL, SETTLEMENT_CHAIN_ID, SETTLEMENT_PORTFOLIO and
SETTLEMENT_MINIMUM_CASH (raw collateral units).

For submission, supply a dedicated SETTLEMENT_PRIVATE_KEY plus
SETTLEMENT_MAX_TRANSACTIONS per run, SETTLEMENT_MAX_GAS per transaction and
SETTLEMENT_MAX_GAS_PRICE in attoETH per gas. Run one instance per signer on a timer.`)
	process.exit(0)
}

const url = required('SETTLEMENT_RPC_URL')
const chainId = Number(positiveInteger('SETTLEMENT_CHAIN_ID'))
if (!Number.isSafeInteger(chainId)) throw new Error('Invalid settlement chain ID')
const portfolio = getAddress(required('SETTLEMENT_PORTFOLIO'))
const minimumCash = positiveInteger('SETTLEMENT_MINIMUM_CASH')
const chain = defineChain({ id: chainId, name: 'Settlement chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [url] } } })
const client = createPublicClient({ chain, transport: http(url) })
if ((await client.getChainId()) !== chainId) throw new Error('Settlement RPC chain ID does not match configuration')

const key = process.env['SETTLEMENT_PRIVATE_KEY']
let sender
if (key !== undefined) {
	if (!key.startsWith('0x') || !/^[0-9a-fA-F]{64}$/.test(key.slice(2))) throw new Error('SETTLEMENT_PRIVATE_KEY must be a 32-byte private key')
	const account = privateKeyToAccount(`0x${key.slice(2)}`)
	sender = {
		account,
		wallet: createWalletClient({ account, chain, transport: http(url) }),
		maximumTransactions: positiveInteger('SETTLEMENT_MAX_TRANSACTIONS'),
		maximumGas: positiveInteger('SETTLEMENT_MAX_GAS'),
		maximumGasPrice: positiveInteger('SETTLEMENT_MAX_GAS_PRICE'),
	}
}

let sent = 0n
for await (const candidate of scanSettlementFinalizations(client, portfolio, minimumCash)) {
	console.log('Final settlement candidate', candidate)
	if (sender === undefined) continue
	const { account, wallet, maximumTransactions, maximumGas, maximumGasPrice } = sender
	const latest = await client.getBlock()
	if (latest.number === undefined) throw new Error('Settlement execution requires a numbered block')
	const current = await settlementFinalizationCandidate(client, portfolio, { ...candidate, securityPool: candidate.pool }, minimumCash, latest.number)
	if (current === undefined) continue
	const gasPrice = await client.getGasPrice()
	if (gasPrice > maximumGasPrice) break
	const request = finalizationRequest(current.pool)
	const estimate = await client.estimateContractGas({ ...request, account: account.address })
	const gas = (estimate * 120n + 99n) / 100n
	if (gas > maximumGas) continue
	const [confirmed, pending] = await Promise.all([client.getTransactionCount({ address: account.address, blockTag: 'latest' }), client.getTransactionCount({ address: account.address, blockTag: 'pending' })])
	if (confirmed !== pending) throw new Error('Settlement signer already has a pending transaction')
	const hash = await wallet.sendTransaction({ to: request.address, data: encodeFunctionData(request), gas, gasPrice, nonce: confirmed })
	console.log('Submitted settlement finalization', hash)
	const receipt = await client.waitForTransactionReceipt({ hash })
	if (receipt.status !== 'success') throw new Error(`Settlement finalization reverted: ${hash}`)
	sent++
	if (sent >= maximumTransactions) break
}
