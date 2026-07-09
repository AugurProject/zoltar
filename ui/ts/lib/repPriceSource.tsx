import { assertNever } from './assert.js'
import { CURATED_TSX_STRINGS, TSX_STRINGS } from './uiStrings.js'

export type RepPriceSource = 'v4' | 'v3' | 'mock'

type RepPriceSourceCopy = {
	badgeLabel: string | undefined
	linkTitle: string | undefined
	quotedCollateralizationLabel: string
	quotedRepPerEthLabel: string
	tooltip: string
}

export function getRepPriceSourceCopy(source: RepPriceSource | undefined): RepPriceSourceCopy {
	switch (source) {
		case 'mock':
			return {
				badgeLabel: TSX_STRINGS.libRepPriceSource.copy001,
				linkTitle: TSX_STRINGS.libRepPriceSource.copy002,
				quotedCollateralizationLabel: TSX_STRINGS.libRepPriceSource.copy003,
				quotedRepPerEthLabel: TSX_STRINGS.libRepPriceSource.copy004,
				tooltip: CURATED_TSX_STRINGS.repPriceSource.mockTooltip,
			}
		case 'v4':
			return {
				badgeLabel: TSX_STRINGS.libRepPriceSource.copy005,
				linkTitle: TSX_STRINGS.libRepPriceSource.copy006,
				quotedCollateralizationLabel: TSX_STRINGS.libRepPriceSource.copy007,
				quotedRepPerEthLabel: TSX_STRINGS.libRepPriceSource.copy008,
				tooltip: CURATED_TSX_STRINGS.repPriceSource.v4Tooltip,
			}
		case 'v3':
			return {
				badgeLabel: TSX_STRINGS.libRepPriceSource.copy009,
				linkTitle: TSX_STRINGS.libRepPriceSource.copy010,
				quotedCollateralizationLabel: TSX_STRINGS.libRepPriceSource.copy011,
				quotedRepPerEthLabel: TSX_STRINGS.libRepPriceSource.copy012,
				tooltip: CURATED_TSX_STRINGS.repPriceSource.v3Tooltip,
			}
		case undefined:
			return {
				badgeLabel: undefined,
				linkTitle: undefined,
				quotedCollateralizationLabel: TSX_STRINGS.libRepPriceSource.copy013,
				quotedRepPerEthLabel: TSX_STRINGS.libRepPriceSource.copy014,
				tooltip: CURATED_TSX_STRINGS.repPriceSource.unavailableTooltip,
			}
		default:
			return assertNever(source)
	}
}

export function renderRepPriceSourceLabel(source: RepPriceSource | undefined, sourceUrl: string | undefined) {
	const copy = getRepPriceSourceCopy(source)
	if (copy.badgeLabel === undefined) return undefined
	if (sourceUrl === undefined || copy.linkTitle === undefined) return TSX_STRINGS.libRepPriceSource.copy015(copy.badgeLabel)
	return (
		<a href={sourceUrl} title={copy.linkTitle} target='_blank' rel='noreferrer'>
			{CURATED_TSX_STRINGS.repPriceSource.wrappedBadgeLabel(copy.badgeLabel)}
		</a>
	)
}
