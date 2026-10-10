import type { CopyTemplateValue } from './types.js'

export const genesis = 'Genesis'
export const chooseTruthfulUniverse = 'Choose the truthful universe'
export const augurFork = 'Augur v2 fork'
export const viewAugurFork = 'View fork question on Ethereum'
export const formatGenesisOutcome = (outcome: 'yes' | 'no') => (outcome === 'yes' ? 'Yes' : 'No')
export const formatGenesisUniverse = (outcome: 'yes' | 'no') => `${genesis} › ${formatGenesisOutcome(outcome)}`
export const formatUnknownLineageUniverse = (shortUniverseId: CopyTemplateValue) => `Universe ${shortUniverseId}`

export const lineageAriaLabel = 'Universe lineage'
export const universeId = 'Universe ID'
export const parentUniverse = 'Parent universe'
export const repSupply = 'REP supply'
export const childrenBeforeForkDetail = 'Child universes appear after this universe forks.'
export const openUniverse = 'Open'
export const formatForkQuestion = (title: string) => `Fork question: ${title}`
export const formatOpenChildUniverse = (outcome: CopyTemplateValue) => `Open ${outcome} universe`
export const openOutcomeArrowTail = ' →'

export const formatSwitcherAriaLabel = (universeLabel: CopyTemplateValue) => `Universe: ${universeLabel}. Browse universes`
export const formatForkedSwitcherAriaLabel = (universeLabel: CopyTemplateValue) => `Universe: ${universeLabel}, forked. Browse universes`
export const forked = 'Forked'

export const universeNotFoundTitle = 'Universe not found'
