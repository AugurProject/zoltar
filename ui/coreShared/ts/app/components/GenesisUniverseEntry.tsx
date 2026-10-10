import { useState } from 'preact/hooks'
import { AUGUR_GENESIS_FORK_MARKET, AUGUR_GENESIS_FORK_QUESTION, GENESIS_OUTCOMES, type GenesisOutcome } from '@zoltar/zoltar-shared/deployment/genesisUniverses'
import { ForkUniverseNavigation } from '../../components/ForkUniverseNavigation.js'
import { OutcomeUniverseList } from '../../components/OutcomeUniverseList.js'
import * as copy from '../../copy/universes.js'

/** The historical Augur fork supplies ordinary child-universe navigation before a deployment is selected. */
export function GenesisUniverseEntry({ onSelect }: { onSelect: (outcome: GenesisOutcome) => Promise<void> }) {
	const [pending, setPending] = useState(false)
	return (
		<main>
			<div id='app-content' className='route-view-flow'>
				<h1>{copy.chooseTruthfulUniverse}</h1>
				<ForkUniverseNavigation question={AUGUR_GENESIS_FORK_QUESTION} loading={pending} hasOutcomes>
					<a className='detail' href={`https://etherscan.io/address/${AUGUR_GENESIS_FORK_MARKET}#readContract`} target='_blank' rel='noreferrer'>
						{copy.viewAugurFork}
					</a>
					<OutcomeUniverseList
						outcomes={GENESIS_OUTCOMES.map(outcome => ({
							key: outcome,
							label: copy.formatGenesisOutcome(outcome),
							exists: true,
							disabled: pending,
							onSelect: () => {
								if (pending) return
								setPending(true)
								void onSelect(outcome)
							},
						}))}
					/>
				</ForkUniverseNavigation>
			</div>
		</main>
	)
}
