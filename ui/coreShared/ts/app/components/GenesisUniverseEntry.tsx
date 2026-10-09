import { useState } from 'preact/hooks'
import type { GenesisOutcome } from '@zoltar/zoltar-shared/deployment/genesisUniverses'
import { GenesisUniverseChoices } from '../../components/GenesisUniverseChoices.js'
import * as copy from '../../copy/universes.js'

/** The startup exception keeps the route's page and section surfaces while waiting for an explicit genesis choice. */
export function GenesisUniverseEntry({ onSelect }: { onSelect: (outcome: GenesisOutcome) => Promise<void> }) {
	const [pending, setPending] = useState(false)
	return (
		<main>
			<div id='app-content' className='route-view-flow'>
				<h1>{copy.chooseTruthfulUniverse}</h1>
				<GenesisUniverseChoices
					disabled={pending}
					onSelect={outcome => {
						if (pending) return
						setPending(true)
						void onSelect(outcome)
					}}
				/>
			</div>
		</main>
	)
}
