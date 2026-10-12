import { useState } from 'preact/hooks'
import { AUGUR_GENESIS_FORK_MARKET, AUGUR_GENESIS_FORK_QUESTION, GENESIS_OUTCOMES, type GenesisOutcome } from '@zoltar/zoltar-shared/deployment/genesisUniverses'
import { ForkUniverseNavigation } from '../../components/ForkUniverseNavigation.js'
import { HeaderToolbar } from '../../components/HeaderToolbar.js'
import { OutcomeUniverseList } from '../../components/OutcomeUniverseList.js'
import { UserMessage } from '../../components/UserMessage.js'
import * as copy from '../../copy/universes.js'
import { buildAddressExplorerUrl, MAINNET_NETWORK_PROFILE } from '../../wallet/networkProfile.js'
import { ApplicationBrand } from './OverviewHeaderPanel.js'

/** The historical Augur fork supplies ordinary child-universe navigation before a deployment is selected. */
export function GenesisUniverseEntry({ applicationTitle, onSelect }: { applicationTitle: string; onSelect: (outcome: GenesisOutcome) => Promise<void> }) {
	const [openingOutcome, setOpeningOutcome] = useState<GenesisOutcome>()
	const pending = openingOutcome !== undefined
	const forkQuestionExplorerUrl = buildAddressExplorerUrl(MAINNET_NETWORK_PROFILE, AUGUR_GENESIS_FORK_MARKET)
	if (forkQuestionExplorerUrl === undefined) throw new Error('The Ethereum mainnet address explorer URL is unavailable')
	return (
		<main>
			{/* Only the shared brand is available before a deployment starts the backend and its navigation. */}
			<div className='app-chrome'>
				<HeaderToolbar brand={<ApplicationBrand applicationTitle={applicationTitle} />} />
			</div>
			<div id='app-content' className='route-view-flow'>
				<h1>{copy.chooseTruthfulUniverse}</h1>
				<p className='detail'>{copy.augurFork}</p>
				{/* Keep the announcement outside the busy section so it is delivered during initialization. */}
				<UserMessage placement='field' as='span' className='visually-hidden' announcement='polite' detail={openingOutcome === undefined ? '' : copy.formatOpeningGenesisUniverse(openingOutcome)} />
				<ForkUniverseNavigation question={AUGUR_GENESIS_FORK_QUESTION} loading={pending} hasOutcomes headingLevel={2}>
					<a className='detail' href={`${forkQuestionExplorerUrl}#readContract`} target='_blank' rel='noreferrer'>
						{copy.viewAugurFork}
					</a>
					<OutcomeUniverseList
						outcomes={GENESIS_OUTCOMES.map(outcome => ({
							key: outcome,
							label: copy.formatGenesisOutcome(outcome),
							// These are the existing historical Augur children, before a Zoltar deployment is selected.
							exists: true,
							disabled: pending,
							details: openingOutcome === outcome ? <UserMessage placement='field' as='span' detail={copy.formatOpeningGenesisUniverse(outcome)} /> : undefined,
							onSelect: () => {
								if (pending) return
								setOpeningOutcome(outcome)
								void onSelect(outcome)
							},
						}))}
					/>
				</ForkUniverseNavigation>
			</div>
		</main>
	)
}
