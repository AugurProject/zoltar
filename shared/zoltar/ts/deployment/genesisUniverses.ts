import { getAddress } from '@zoltar/core-shared/evm/ethereum'

export const GENESIS_OUTCOMES = ['yes', 'no'] as const
export type GenesisOutcome = (typeof GENESIS_OUTCOMES)[number]

// Augur V2 mainnet fork identities, verified against both child universes.
// https://github.com/AugurProject/augur-reboot-website/blob/main/docs/moon-fork-final-record.md
export const AUGUR_GENESIS_FORK_QUESTION = 'Will the Artemis II Mission successfully liftoff in the first week of April?'
export const AUGUR_GENESIS_FORK_MARKET = getAddress('0x963EED85778CC23E2D4636Cd4f29eECDF9827E9e')

export const MAINNET_GENESIS_UNIVERSES = {
	yes: {
		universeAddress: getAddress('0x281171519Fb41540528398d8ED3EA257f0F32A9f'),
		reputationTokenAddress: getAddress('0xCf6A0A7826fa124B7705d6f3c675eAD76f1e540D'),
	},
	no: {
		universeAddress: getAddress('0xbaaD633FAa0E4847A4b66043E3E92102e5800546'),
		reputationTokenAddress: getAddress('0x2F4005456c2F098358213f01DbE34abDAa2989A4'),
	},
} as const

export function parseGenesisOutcome(value: string | undefined): GenesisOutcome | undefined {
	return value === 'yes' || value === 'no' ? value : undefined
}
