import type { CopyTemplateValue } from './types.js'

const augurV2 = 'Augur v2'
export const chooseTruthfulUniverse = 'Choose the truthful universe'
export const augurUniverse = `${augurV2} universe`
export const formatGenesisOutcome = (outcome: 'yes' | 'no') => (outcome === 'yes' ? 'Yes' : 'No')
export const formatOpeningGenesisUniverse = (outcome: 'yes' | 'no') => `Opening ${formatGenesisOutcome(outcome)} universe`
export const formatGenesisUniverse = (outcome: 'yes' | 'no') => `${augurV2} › ${formatGenesisOutcome(outcome)}`
export const formatUnknownLineageUniverse = (shortUniverseId: CopyTemplateValue) => `Universe ${shortUniverseId}`

export const lineageAriaLabel = 'Universe lineage'
export const universeId = 'Universe ID'
export const parentUniverse = 'Parent universe'
/** Zoltar's accounting figure for fork thresholds, not the child token's ERC-20 totalSupply. */
export const theoreticalRepSupply = 'Theoretical REP supply'
export const childrenBeforeForkDetail = 'Child universes appear after this universe forks.'
export const openUniverse = 'Open'
export const forkQuestion = 'Fork question'
export const outcomesOnThisPage = 'Outcomes on this page'
export const marketAddress = 'Market address'
export const creator = 'Creator'
export const designatedReporter = 'Designated reporter'
export const categories = 'Categories'
export const tags = 'Tags'
export const formatOpenChildUniverse = (outcome: CopyTemplateValue) => `Open ${outcome} universe`
/** On-chain outcome labels can look alike; the immutable outcome index and child universe ID tell them apart. */
export const formatOutcomeIndex = (index: CopyTemplateValue) => `#${index}`
/** Names a categorical outcome by its immutable index; outcome labels built from it already identify that index. */
export const formatUnnamedOutcome = (index: CopyTemplateValue) => `Outcome ${index}`
export const formatIndexedOutcome = (label: CopyTemplateValue, index: CopyTemplateValue) => `${formatUnnamedOutcome(index)}: ${label}`
export const formatOutcomeWithUniverse = (outcome: CopyTemplateValue, shortUniverseId: CopyTemplateValue) => `${outcome} · ${shortUniverseId}`
export const formatOutcomeUniverse = (shortUniverseId: CopyTemplateValue) => `· ${shortUniverseId}`
export const formatOutcomeWithIdentity = (label: CopyTemplateValue, identity: CopyTemplateValue) => `${label} ${identity}`
export const openOutcomeArrowTail = ' →'

export const formatSwitcherContextRootLabel = (rootLabel: CopyTemplateValue) => `${rootLabel} ·`
export const formatSwitcherContextLabel = (rootLabel: CopyTemplateValue, leafLabel: CopyTemplateValue) => `${formatSwitcherContextRootLabel(rootLabel)} ${leafLabel}`
export const formatSwitcherAriaLabel = (universeLabel: CopyTemplateValue) => `Universe: ${universeLabel}. Browse universes`
export const formatForkedSwitcherAriaLabel = (universeLabel: CopyTemplateValue) => `Universe: ${universeLabel}, forked. Browse universes`
export const forked = 'Forked'

export const universeNotFoundTitle = 'Universe not found'

export const earlierGenerationsOmitted = 'Earlier generations omitted'
