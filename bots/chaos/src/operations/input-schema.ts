import { encodeAbiParameters, keccak256, getAddress } from '@zoltar/bot-shared/ethereum'
import type { EcosystemSnapshot, OperationPlan } from './types.ts'
import type { ManualInputs } from './manual-inputs.ts'
import { decodedTransaction } from './transaction-description.ts'

type InputKind = 'integer' | 'amount' | 'text' | 'list' | 'choice' | 'address'
export type InputField = { key: string; label: string; kind: InputKind; path: Array<string | number>; method?: string; minimum?: string; maximum?: string; choices?: 'tokens' | 'pools' | 'pairs' | 'universes' | 'questions' | 'auctions'; options?: Array<{ value: string; label: string }> }
const integer = (key: string, label: string, path: Array<string | number>, minimum = '0', maximum?: string): InputField => ({ key, label, path, kind: 'integer', minimum, ...(maximum === undefined ? {} : { maximum }) })
const amountField = (path: Array<string | number>, label = 'Token amount', key = 'amount'): InputField => ({ key, label, path, kind: 'amount', minimum: '1' })
const selectionKeys = { tokens: 'token', pools: 'pool', pairs: 'pair', universes: 'universeId', questions: 'questionId', auctions: 'auction' }
const selection = (key: NonNullable<InputField['choices']>, label: string, path: Array<string | number>): InputField => ({ key: selectionKeys[key], label, kind: 'choice', choices: key, path })
const pool = selection('pools', 'Security pool', ['metadata', 'pool'])
const pair = selection('pairs', 'Trading pair', ['metadata', 'pair'])
const token = selection('tokens', 'Token', ['metadata', 'token'])
const universe = selection('universes', 'Universe', ['metadata', 'universeId'])
const schemas: Record<string, InputField[]> = {
	'statoblast.vault.deposit-rep': [pool, amountField(['metadata', 'amountAttoRep'], 'REP amount')],
	'open-oracle.weth.wrap': [amountField(['value'], 'ETH amount')],
	'open-oracle.weth.unwrap': [amountField(['args', 0], 'WETH amount')],
	'open-oracle.report': [amountField(['metadata', 'amount1'], 'WETH contribution', 'amount1'), amountField(['metadata', 'amount2'], 'REP contribution', 'amount2')],
	'open-oracle.deposit': [token, amountField(['metadata', 'amount'])],
	'open-oracle.withdraw': [token, amountField(['args', 1])],
	'open-oracle.withdraw-to': [token, amountField(['args', 1]), { key: 'recipient', label: 'Recipient address', kind: 'address', path: ['args', 2] }],
	'open-oracle.push-or-credit': [token, amountField(['args', 2])],
	'statoblast.auction.bid': [selection('auctions', 'Auction', ['metadata', 'auction']), amountField(['metadata', 'bidAttoEth'], 'Exact ETH bid'), integer('tick', 'Bid tick', ['metadata', 'tick'], '-10000', '10000')],
	'trading.pair.initialize-shares': [pair, amountField(['metadata', 'shareAmount'], 'Shares per outcome'), amountField(['metadata', 'minimumLiquidity'], 'Minimum LP tokens', 'minimumLiquidity')],
	'trading.liquidity.add-shares': [pair, amountField(['metadata', 'shareAmount'], 'Shares per outcome'), amountField(['metadata', 'minimumLiquidity'], 'Minimum LP tokens', 'minimumLiquidity')],
	'trading.swap.exact-input': [
		pair,
		{
			key: 'direction',
			label: 'Swap direction',
			path: ['metadata', 'direction'],
			kind: 'choice',
			options: [
				{ value: 'YES-to-NO', label: 'YES to NO' },
				{ value: 'NO-to-YES', label: 'NO to YES' },
			],
		},
		amountField(['metadata', 'inputAmount'], 'Input shares'),
		amountField(['metadata', 'minimumOutput'], 'Minimum output shares', 'minimumOutput'),
	],
	'trading.swap.exact-output': [
		pair,
		{
			key: 'direction',
			label: 'Swap direction',
			path: ['metadata', 'direction'],
			kind: 'choice',
			options: [
				{ value: 'YES-to-NO', label: 'YES to NO' },
				{ value: 'NO-to-YES', label: 'NO to YES' },
			],
		},
		amountField(['metadata', 'outputAmount'], 'Exact output', 'outputAmount'),
		amountField(['metadata', 'maximumInput'], 'Maximum input', 'maximumInput'),
	],
	'zoltar.migration.add': [universe, amountField(['args', 1], 'REP amount')],
	'zoltar.rep.burn': [universe, amountField(['args', 1], 'REP amount')],
}
for (const id of ['statoblast.complete-set.create', 'statoblast.complete-set.redeem']) schemas[id] = [pool, amountField(['metadata', 'amount'], id.endsWith('.create') ? 'ETH amount' : 'Complete sets')]
schemas['statoblast.shares.redeem-winning'] = [pool]
for (const id of ['trading.pair.create-and-initialize', 'trading.pair.initialize-eth', 'trading.liquidity.add-eth', 'trading.position.enter']) {
	const entering = id === 'trading.position.enter'
	const adding = id === 'trading.liquidity.add-eth'
	schemas[id] = [
		{ key: 'target', label: id === 'trading.pair.create-and-initialize' ? 'Security pool' : 'Trading pair', kind: 'choice', choices: id === 'trading.pair.create-and-initialize' ? 'pools' : 'pairs', path: ['args', 0] },
		amountField(['value'], 'Exact ETH amount'),
		amountField(['args', adding ? 1 : 2], entering ? 'Minimum long shares' : 'Minimum LP tokens', entering ? 'minimumOutput' : 'minimumLiquidity'),
		integer('deadline', 'Deadline (Unix seconds)', ['args', adding ? 3 : 4]),
		...(entering
			? [
					{
						key: 'longOutcome',
						label: 'Long outcome',
						kind: 'choice',
						path: ['args', 1],
						options: [
							{ value: '1', label: 'Yes' },
							{ value: '2', label: 'No' },
						],
					} satisfies InputField,
				]
			: []),
	]
}

schemas['trading.liquidity.remove'] = [pair, amountField(['metadata', 'liquidity'], 'LP tokens'), amountField(['metadata', 'minimumYes'], 'Minimum YES shares', 'minimumYes'), amountField(['metadata', 'minimumNo'], 'Minimum NO shares', 'minimumNo')]
for (const id of ['trading.complete-set.redeem', 'trading.position.exit'])
	schemas[id] = [
		pair,
		amountField(['metadata', 'completeAmount'], 'Complete sets'),
		amountField(['metadata', 'minimumEthAttoEth'], 'Minimum ETH received', 'minimumEthAttoEth'),
		...(id === 'trading.position.exit'
			? [
					{
						key: 'longOutcome',
						label: 'Long outcome',
						kind: 'choice',
						path: ['metadata', 'longOutcome'],
						options: [
							{ value: '1', label: 'Yes' },
							{ value: '2', label: 'No' },
						],
					} satisfies InputField,
				]
			: []),
	]

for (const kind of ['binary', 'categorical', 'scalar']) {
	const fields: InputField[] = ['title', 'description'].map(key => ({ key, label: key === 'title' ? 'Question title' : 'Description', kind: 'text', path: ['args', 0, key] }))
	fields.push(integer('startTime', 'Start time (Unix seconds)', ['args', 0, 'startTime'], '0', ((1n << 48n) - 1n).toString()), integer('endTime', 'End time (Unix seconds)', ['args', 0, 'endTime'], '0', ((1n << 48n) - 1n).toString()))
	if (kind === 'scalar')
		fields.push(
			{ key: 'answerUnit', label: 'Answer unit', kind: 'text', path: ['args', 0, 'answerUnit'] },
			integer('numTicks', 'Number of ticks', ['args', 0, 'numTicks'], '1', ((1n << 120n) - 1n).toString()),
			integer('displayValueMin', 'Display minimum', ['args', 0, 'displayValueMin'], (-(1n << 255n)).toString(), ((1n << 255n) - 1n).toString()),
			integer('displayValueMax', 'Display maximum', ['args', 0, 'displayValueMax'], (-(1n << 255n)).toString(), ((1n << 255n) - 1n).toString()),
		)
	else fields.push({ key: 'labels', label: 'Outcome labels (one per line; sorted for the protocol)', kind: 'list', path: ['args', 1] })
	schemas[`zoltar.question.create-${kind}`] = fields
}

export function operationInputSchema(id: string): readonly InputField[] {
	return schemas[id] ?? []
}

const shortIdentity = (value: string) => (value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value)

export function inputChoices(field: InputField, snapshot: EcosystemSnapshot) {
	if (field.options !== undefined) return field.options
	switch (field.choices) {
		case 'tokens':
			return snapshot.wallet.tokens
				.filter(token => token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase() || snapshot.universes.some(universe => universe.repToken.toLowerCase() === token.address.toLowerCase()))
				.map(token => ({ value: token.address, label: `${token.symbol ?? 'Token'} · ${shortIdentity(token.address)}` }))
		case 'pools':
			return snapshot.pools.map(pool => ({ value: pool.address, label: `Universe ${shortIdentity(pool.universeId)} · ${shortIdentity(pool.address)}` }))
		case 'pairs':
			return snapshot.pairs.map(pair => ({ value: pair.address, label: shortIdentity(pair.address) }))
		case 'universes':
			return snapshot.universes.map(universe => ({ value: universe.id, label: `Universe ${shortIdentity(universe.id)}` }))
		case 'questions':
			return snapshot.questions.map(question => ({ value: question.id, label: `Question ${shortIdentity(question.id)}` }))
		case 'auctions':
			return snapshot.auctions.map(auction => ({ value: auction.address, label: shortIdentity(auction.address) }))
		default:
			return undefined
	}
}

function at(value: unknown, path: readonly (string | number)[]): unknown {
	for (const key of path) {
		if (value === null || typeof value !== 'object') return undefined
		value = Reflect.get(value, key)
	}
	return value
}

export function inputFieldValue(field: InputField, plan: OperationPlan | undefined) {
	if (plan === undefined) return ''
	const decoded = plan.steps.flatMap(step => {
		const value = decodedTransaction(step)
		return value === undefined ? [] : [value]
	})
	const transaction = field.method === undefined ? decoded.at(-1) : decoded.find(step => step.method === field.method)
	const value = at({ ...transaction, metadata: plan.metadata }, field.path)
	if (Array.isArray(value)) return JSON.stringify(value)
	return value === undefined ? '' : String(value)
}

export function resolveOperationInputs(id: string, inputs: ManualInputs, snapshot: EcosystemSnapshot) {
	const values: Record<string, string> = {}
	for (const field of operationInputSchema(id)) {
		const input = inputs[field.key]
		if (input === undefined || input.source === 'chaosbot') continue
		const value = input.value
		if (value.length > 16_384) throw new Error(`${field.label} is too long`)
		if (field.kind === 'integer' || field.kind === 'amount') {
			if (!/^-?(0|[1-9]\d*)$/.test(value) || value.length > 79) throw new Error(`${field.label} must be a whole number in base units`)
			const number = BigInt(value)
			if (number < BigInt(field.minimum ?? '0') || number > BigInt(field.maximum ?? ((1n << 256n) - 1n).toString())) throw new Error(`${field.label} is out of range`)
		}
		if (field.kind === 'choice' && !inputChoices(field, snapshot)?.some(choice => choice.value.toLowerCase() === value.toLowerCase())) throw new Error(`${field.label} is no longer available`)
		if (field.kind === 'address') getAddress(value)
		if (field.kind === 'list') {
			const list: unknown = JSON.parse(value)
			if (!Array.isArray(list) || list.length < 2 || list.length > 256 || !list.every(entry => typeof entry === 'string' && entry.length > 0 && entry.length <= 256 && !/[\r\n]/.test(entry)) || new Set(list).size !== list.length) throw new Error(`${field.label} must contain 2–256 distinct, non-empty labels`)
			if (id.endsWith('create-binary') && list.length !== 2) throw new Error('Binary questions require exactly two labels')
			if (id.endsWith('create-categorical') && list.length < 3) throw new Error('Categorical questions require at least three labels')
			const sorted = [...list].sort((left, right) => {
				const a = keccak256(encodeAbiParameters([{ type: 'string' }], [left]))
				const b = keccak256(encodeAbiParameters([{ type: 'string' }], [right]))
				if (a === b) return 0
				return a > b ? -1 : 1
			})
			values[field.key] = JSON.stringify(sorted)
		} else values[field.key] = value
	}
	return values
}
