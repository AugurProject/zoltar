import { AUGUR_GENESIS_FORK_MARKET, AUGUR_GENESIS_FORK_QUESTION, GENESIS_OUTCOMES, type GenesisOutcome } from '@zoltar/zoltar-shared/deployment/genesisUniverses'
import * as copy from '../copy/universes.js'
import { OutcomeSelectionList } from './OutcomeSelectionList.js'
import { SectionBlock } from './SectionBlock.js'

/** Uses the same outcome controls as later forks; genesis chooses a deployment instead of an on-chain child ID. */
export function GenesisUniverseChoices({ selected, disabled = false, onSelect }: { selected?: GenesisOutcome | undefined; disabled?: boolean; onSelect: (outcome: GenesisOutcome) => void }) {
	return (
		<SectionBlock title={copy.augurFork} description={copy.truthfulUniverseDetail} variant='plain'>
			<div className='form-grid'>
				<p>{AUGUR_GENESIS_FORK_QUESTION}</p>
				<a className='detail' href={`https://etherscan.io/address/${AUGUR_GENESIS_FORK_MARKET}#readContract`} target='_blank' rel='noreferrer'>
					{copy.viewAugurFork}
				</a>
				<OutcomeSelectionList
					items={GENESIS_OUTCOMES.map(outcome => ({
						key: outcome,
						label: copy.formatGenesisOutcome(outcome),
						ariaLabel: copy.formatChooseGenesisUniverse(outcome),
						selected: selected === outcome,
						disabled: disabled || selected === outcome,
						onSelect: () => onSelect(outcome),
					}))}
				/>
			</div>
		</SectionBlock>
	)
}
