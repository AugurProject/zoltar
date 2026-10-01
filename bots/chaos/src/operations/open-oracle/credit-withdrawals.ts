import { openOracleAbi } from '@zoltar/bot-shared/contracts/abi'
import { encodeAbiParameters, getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { inputInteger, inputMatches, inputText } from '../input-values.ts'
import { amount, choose, eligible, encodePreflightCall, encodeStep, mixSeed, ONE_TOKEN, planBase } from '../planning.ts'
import type { EcosystemSnapshot, OperationDefinition, OperationEvidence, PlanningOptions } from '../types.ts'
import { exactTokenTransferEvidence, tokenHolderEvidence } from './planning.ts'

const OPEN_ORACLE_CREDIT_STEP_GAS_LIMIT = 500_000n
const DEFAULT_PUSH_OR_CREDIT_GAS_LIMIT = 50_000n
const MINIMUM_CUSTOM_PUSH_OR_CREDIT_GAS_LIMIT = 30_000n
const MAXIMUM_CUSTOM_PUSH_OR_CREDIT_GAS_LIMIT = 100_000n

export function creditDefinition(mode: 'withdraw' | 'withdraw-to' | 'push-or-credit'): OperationDefinition {
	const id = `open-oracle.${mode}`
	const method = {
		'push-or-credit': 'pushOrCredit',
		withdraw: 'withdraw',
		'withdraw-to': 'withdrawTo',
	}[mode]
	const candidates = (snapshot: EcosystemSnapshot, options: PlanningOptions) => {
		const knownRep = new Set(snapshot.universes.map(universe => universe.repToken.toLowerCase()))
		const tokens = snapshot.wallet.tokens
			.filter(token => inputMatches(options, 'token', token.address))
			.filter(token => amount(token.openOracleCredit) > 1n && (token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase() || knownRep.has(token.address.toLowerCase())))
			.map(token => ({ address: token.address, credit: token.openOracleCredit }))
		return tokens
	}
	const build = (snapshot: EcosystemSnapshot, options: PlanningOptions, token: ReturnType<typeof candidates>[number]) => {
		const tokenAddress = token.address
		const recipient = mode === 'withdraw-to' ? getAddress(inputText(options, 'recipient', snapshot.wallet.address)) : snapshot.wallet.address
		if (recipient === zeroAddress || recipient.toLowerCase() === snapshot.deployments.openOracle.toLowerCase()) throw new Error('Choose a non-zero external recipient')
		const creditBefore = amount(token.credit)
		const available = creditBefore - 1n
		const spend = inputInteger(options, 'amount', available > ONE_TOKEN ? ONE_TOKEN : available, 1n, available < ONE_TOKEN ? available : ONE_TOKEN)
		const pushVariantSeed = mixSeed(options.seed, `${id}:overload`)
		const useCustomPushGasLimit = mode === 'push-or-credit' && pushVariantSeed % 2 === 1
		const customPushGasLimit = MINIMUM_CUSTOM_PUSH_OR_CREDIT_GAS_LIMIT + (BigInt(mixSeed(options.seed, `${id}:gas-limit`)) % (MAXIMUM_CUSTOM_PUSH_OR_CREDIT_GAS_LIMIT - MINIMUM_CUSTOM_PUSH_OR_CREDIT_GAS_LIMIT + 1n))
		const pushGasLimit = useCustomPushGasLimit ? customPushGasLimit : DEFAULT_PUSH_OR_CREDIT_GAS_LIMIT
		const args = (() => {
			if (mode === 'withdraw') return [tokenAddress, spend] as const
			if (mode === 'withdraw-to') return [tokenAddress, spend, recipient] as const
			if (useCustomPushGasLimit) return [tokenAddress, snapshot.wallet.address, spend, pushGasLimit] as const
			return [tokenAddress, snapshot.wallet.address, spend] as const
		})()
		const evidence: OperationEvidence[] = [tokenHolderEvidence(snapshot, tokenAddress, creditBefore - spend), exactTokenTransferEvidence(snapshot, tokenAddress, spend, recipient)]
		const preflightCalls =
			mode === 'withdraw' || mode === 'withdraw-to'
				? [
						encodePreflightCall({
							abi: openOracleAbi,
							args,
							caller: snapshot.wallet.address,
							expectedResult: encodeAbiParameters([{ type: 'uint256' }], [spend]),
							functionName: method,
							label: `Prove the fixed OpenOracle ${mode === 'withdraw-to' ? 'recipient withdrawal' : 'withdrawal'} still debits its full amount`,
							to: snapshot.deployments.openOracle,
						}),
					]
				: []
		let methodSignature = 'pushOrCredit(address,address,uint128)'
		if (mode === 'withdraw') methodSignature = 'withdraw(address,uint256)'
		else if (mode === 'withdraw-to') methodSignature = 'withdrawTo(address,uint256,address)'
		else if (useCustomPushGasLimit) methodSignature = 'pushOrCredit(address,address,uint128,uint32)'
		const stepId = useCustomPushGasLimit ? `${mode}-custom-gas` : mode
		const label = {
			'push-or-credit': 'Push or credit OpenOracle balance',
			withdraw: 'Withdraw OpenOracle credit',
			'withdraw-to': 'Withdraw OpenOracle credit to recipient',
		}[mode]
		return planBase({
			definitionId: id,
			ecosystem: 'open-oracle',
			label,
			lastValidBlockNumber: (BigInt(snapshot.anchor.blockNumber) + 1n).toString(),
			metadata: { amount: spend.toString(), creditBefore: creditBefore.toString(), methodSignature, recipient, token: tokenAddress, ...(mode === 'push-or-credit' ? { forwardedGasLimit: pushGasLimit.toString() } : {}) },
			postconditions: ['Internal credit decreases and the selected recipient receives the asset externally or as fallback credit'],
			priority: 'random',
			risk: 'low',
			snapshot,
			steps: [
				encodeStep({
					abi: openOracleAbi,
					args,
					evidence,
					functionName: method,
					gasLimit: OPEN_ORACLE_CREDIT_STEP_GAS_LIMIT,
					id: stepId,
					label: methodSignature,
					preflightCalls,
					to: snapshot.deployments.openOracle,
				}),
			],
		})
	}
	return {
		buildPlan(snapshot, options) {
			const token = choose(candidates(snapshot, options), mixSeed(options.seed, id))
			return token === undefined ? undefined : build(snapshot, options, token)
		},
		classification: 'selectable',
		contract: 'OpenOracle',
		description: `${mode === 'withdraw-to' ? 'withdraw-to with the configured wallet fixed as recipient' : mode} from wallet-owned WETH or REP OpenOracle internal credit. Native credit withdrawal/push is excluded because the contract emits no exact native-transfer evidence.`,
		discoveryInputs: ['OpenOracle tokenHolder balances'],
		ecosystem: 'open-oracle',
		evaluate(snapshot) {
			const knownRep = new Set(snapshot.universes.map(universe => universe.repToken.toLowerCase()))
			const found = snapshot.wallet.tokens.some(token => amount(token.openOracleCredit) > 1n && (token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase() || knownRep.has(token.address.toLowerCase())))
			return eligible(found ? undefined : 'No withdrawable OpenOracle credit')
		},
		id,
		label: mode,
		method,
		risk: 'low',
	}
}
