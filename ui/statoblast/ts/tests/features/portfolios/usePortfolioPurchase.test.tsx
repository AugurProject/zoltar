import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { decodeFunctionData, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { usePortfolioPurchase } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioPurchase.js'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { capitalSnapshot, owner, capital, token, unit } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const abi = parseAbi(['function createCompleteSet(uint248 universeId,uint256 questionId,uint256 mintAttoEth,address recipient,uint256 minimumShares) payable returns(uint256)'])
async function setup() {
	const snapshot = capitalSnapshot()
	const source = capitalClient(snapshot)
	const values = { questionOriginIds: `0x${'11'.repeat(32)}`, getPool: capital, questionId: 999n, questionData: token, getQuestionEndDate: 10_000n, escalationGame: zeroAddress, systemState: 0n, purchaseFee: unit / 100n, quoteQuestionMint: unit, availableMintCapacity: 10n * unit }
	for (const [name, value] of Object.entries(values)) source.setRead(name, value)
	source.install()
	const requests: PortfolioTransaction[] = []
	const actions = {
		ownerReason: undefined,
		runPortfolioAction: async (_action: string, _label: string, build: () => PortfolioTransaction | Promise<PortfolioTransaction>) => {
			requests.push(await build())
		},
	}
	const hook = await renderHookWithProps((props: { snapshot: typeof snapshot }) => usePortfolioPurchase({ ...props, loading: false }, actions), { snapshot })
	lifecycle.trackRendered(hook)
	await act(() => {
		hook.state().setQuestionInput('999')
		hook.state().setMintAmount('1')
		hook.state().setMaximumFee('0.02')
		hook.state().setMinimumShares('0.9')
	})
	await waitFor(() => expect(hook.state().quote).toBeDefined())
	return { hook, source, requests }
}
test('purchase uses one aggregate transaction and preserves explicit limits across new blocks', async () => {
	const { hook, requests } = await setup()
	expect(hook.state().reason).toBeUndefined()
	await act(() => hook.state().buy())
	const request = requests[0]
	if (request === undefined) throw new Error('Missing purchase')
	expect(request.value).toBe(unit + unit / 50n)
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'createCompleteSet', args: [0n, 999n, unit, owner, (9n * unit) / 10n] })
	await hook.setProps({ snapshot: capitalSnapshot({ blockNumber: 11n }) })
	expect(hook.state().maximumFee).toBe('0.02')
	expect(hook.state().minimumShares).toBe('0.9')
})
test('a post-review capacity reduction or closed question stops submission', async () => {
	const { hook, requests, source } = await setup()
	await act(() => hook.state().buy())
	const request = requests[0]
	if (request === undefined) throw new Error('Missing purchase')
	await request.validateBeforeSubmit?.()
	source.setRead('availableMintCapacity', 0n)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('prerequisites changed')
	source.setRead('availableMintCapacity', 10n * unit)
	source.setRead('escalationGame', token)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('minting has closed')
})
