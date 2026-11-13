import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWalletClient, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { portfolioObservation, portfolioSettings, unit } from './portfolio-observation.ts'

/** Unpaused live-execution settings, a signer that owns the observed portfolio, and a wallet client that rejects any signer RPC, with state kept in a fresh temporary directory. */
export async function portfolioTakeoverFixture(directoryPrefix: string) {
	const directory = await mkdtemp(join(tmpdir(), directoryPrefix))
	const settings = portfolioSettings()
	settings.runtime.execute = true
	settings.runtime.once = false
	settings.runtime.stateFile = join(directory, 'state.json')
	settings.paused = false
	const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
	const observation = portfolioObservation()
	observation.snapshot.owner = account.address
	observation.snapshot.ownerPrincipalAttoRep = 100n * unit
	observation.snapshot.ownerAccount.freeAttoRep = 100n * unit
	const state = initialRuntimeState(false, account.address, 1)
	state.portfolioScopes = [observation.nextScope]
	const wallet = createWalletClient({
		chain: mainnet,
		account,
		transport: custom({
			request: async () => {
				throw new Error('Unexpected signer RPC')
			},
		}),
	})
	return { directory, observation, settings, state, wallet }
}
