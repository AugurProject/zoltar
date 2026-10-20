import { useCallback, useState } from 'preact/hooks'
import { AUGUR_GENESIS_FORK_QUESTION, GENESIS_OUTCOMES, type GenesisOutcome } from '@zoltar/zoltar-shared/deployment/genesisUniverses'
import { ForkUniverseNavigation } from '../../components/ForkUniverseNavigation.js'
import { HeaderToolbar } from '../../components/HeaderToolbar.js'
import { OutcomeUniverseList } from '../../components/OutcomeUniverseList.js'
import { RouteHeader } from '../../components/RouteHeader.js'
import { UniverseBrowserView } from '../../components/UniverseBrowser.js'
import { UserMessage } from '../../components/UserMessage.js'
import * as commonCopy from '../../copy/common.js'
import * as copy from '../../copy/universes.js'
import { MAINNET_NETWORK_PROFILE } from '../../wallet/networkProfile.js'
import { formatAppDocumentTitle } from '../lib/appTitle.js'
import { AppPageHeading } from './AppPageHeading.js'
import { ApplicationBrand } from './OverviewHeaderPanel.js'

/** The historical Augur fork supplies ordinary child-universe navigation before a deployment is selected. */
export function GenesisUniverseEntry({ applicationTitle, onSelect }: { applicationTitle: string; onSelect: (outcome: GenesisOutcome) => Promise<void> }) {
	const [openingOutcome, setOpeningOutcome] = useState<GenesisOutcome>()
	const pending = openingOutcome !== undefined
	const formatDocumentTitle = useCallback((pageTitle: string) => formatAppDocumentTitle(pageTitle, applicationTitle), [applicationTitle])
	return (
		<main>
			<AppPageHeading pageTitle={copy.chooseTruthfulUniverse} formatDocumentTitle={formatDocumentTitle} />
			{/* Only the shared brand is available before a deployment starts the backend and its navigation. */}
			<div className='app-chrome'>
				<HeaderToolbar brand={<ApplicationBrand applicationTitle={applicationTitle} />} />
			</div>
			<div id='app-content' className='route-view-flow'>
				<RouteHeader title={commonCopy.universe} description={copy.chooseTruthfulUniverse} />
				{/* Keep the announcement outside the busy section so it is delivered during initialization. */}
				<UserMessage placement='field' as='span' className='visually-hidden' announcement='polite' detail={openingOutcome === undefined ? '' : copy.formatOpeningGenesisUniverse(openingOutcome)} />
				<UniverseBrowserView
					name={copy.augurUniverse}
					hasForked
					navigation={
						<ForkUniverseNavigation question={AUGUR_GENESIS_FORK_QUESTION} loading={pending} hasOutcomes explorerProfile={MAINNET_NETWORK_PROFILE}>
							<OutcomeUniverseList
								outcomes={GENESIS_OUTCOMES.map(outcome => ({
									key: outcome,
									label: copy.formatGenesisOutcome(outcome),
									disabled: pending,
									pendingLabel: openingOutcome === outcome ? copy.formatOpeningGenesisUniverse(outcome) : undefined,
									onSelect: () => {
										if (pending) return
										setOpeningOutcome(outcome)
										void onSelect(outcome)
									},
								}))}
							/>
						</ForkUniverseNavigation>
					}
				/>
			</div>
		</main>
	)
}
