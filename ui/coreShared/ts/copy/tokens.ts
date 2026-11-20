import type { CopyTemplateValue } from './types.js'

/** A token whose address the app has not matched to a known protocol token, shown with its self-reported symbol. */
export const formatUnverifiedTokenLabel = (tokenSymbol: CopyTemplateValue, shortAddress: CopyTemplateValue) => `${tokenSymbol} (${shortAddress})`
/** A token that reported no usable symbol. */
export const formatUnnamedTokenLabel = (shortAddress: CopyTemplateValue) => `Token ${shortAddress}`
