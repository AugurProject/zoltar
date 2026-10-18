import { getAddress } from '@zoltar/core-shared/evm/ethereum'

export const GENESIS_OUTCOMES = ['yes', 'no'] as const
export type GenesisOutcome = (typeof GENESIS_OUTCOMES)[number]

// Augur V2 mainnet fork identities, verified against both child universes.
// https://github.com/AugurProject/augur-reboot-website/blob/main/docs/moon-fork-final-record.md
export const AUGUR_GENESIS_FORK_MARKET = getAddress('0x963EED85778CC23E2D4636Cd4f29eECDF9827E9e')

// Immutable MarketCreated metadata, including the complete extraInfo.longDescription.
// https://etherscan.io/tx/0x247d3ef9f9a54983a653733fd7730d98a5fe9ce95e4072dbf557cb5323ae7736#eventlog
// Augur identifies this categorical market by address; it has no Zoltar question ID or start time.
export const AUGUR_GENESIS_FORK_QUESTION = {
	title: 'Will the Artemis II Mission successfully liftoff in the first week of April?',
	description:
		'* If the mission achieves liftoff after 2026-04-07 23:59:59.999 UTC this market will resolve as No.\n\n* If the rocket explodes on the launch pad while attempting to launch on a launch day, then this market will resolve as No.\n\n* If the Artemis II Mission is renamed, then this market will resolve in line with the result of the mission formerly known as Artemis II.',
	marketType: 'categorical',
	createdAt: 1772540087n,
	endTime: 1775606400n,
	numTicks: 1000n,
	outcomeLabels: ['Yes', 'No'],
	marketAddress: AUGUR_GENESIS_FORK_MARKET,
	creator: getAddress('0xed1e06B49C53293A1321Dd47Abf8D50F9Be77E11'),
	designatedReporter: getAddress('0xed1e06B49C53293A1321Dd47Abf8D50F9Be77E11'),
	categories: ['space'],
	tags: ['space', 'moon', 'artemis'],
} as const

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
