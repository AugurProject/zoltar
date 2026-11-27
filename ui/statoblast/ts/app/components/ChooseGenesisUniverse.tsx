import * as pageCopy from '@zoltar/ui-statoblast-shared/copy/statoblastShell.js'
import { useState } from 'preact/hooks'
import { ApplicationBrand } from '@zoltar/ui-core-shared/app/components/OverviewHeaderPanel.js'
import { applicationTitle } from '../lib/appPageTitle.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { AUGUR_GENESIS_FORK_QUESTION, GENESIS_OUTCOMES, type GenesisOutcome } from '@zoltar/zoltar-shared/deployment/genesisUniverses'

export function ChooseGenesisUniverse({ onSelect }: { onSelect: (outcome: GenesisOutcome) => Promise<void> }) {
	const question = AUGUR_GENESIS_FORK_QUESTION
	const [opening, setOpening] = useState<GenesisOutcome>()
	return (
		<div className='app-frame'>
			<header className='app-header'>
				<div className='app-chrome'>
					<div className='application-brand'>
						<ApplicationBrand applicationTitle={applicationTitle} />
					</div>
				</div>
			</header>
			<main className='route-view-flow statoblast-choice'>
				<RouteHeader title={pageCopy.genesisTitle} description={pageCopy.genesisQuestionContext} />
				<SectionBlock title={question.title} description={pageCopy.formatQuestionEnded(formatTimestamp(question.endTime))}>
					<a href={`https://etherscan.io/address/${question.marketAddress}`} target='_blank' rel='noreferrer'>
						{pageCopy.viewQuestionOnEtherscan}
					</a>
					<details>
						<summary>{pageCopy.resolutionRulesAndDetails}</summary>
						<p>{question.description}</p>
						<p>
							{pageCopy.designatedReporterLead}
							<AddressValue longAbbreviation address={question.designatedReporter} />
						</p>
						<p>
							{pageCopy.tagsLead}
							{question.tags.join(', ')}
						</p>
					</details>
				</SectionBlock>
				<div className='statoblast-choices'>
					{GENESIS_OUTCOMES.map(outcome => {
						const label = outcome === 'yes' ? pageCopy.yes : pageCopy.no
						return (
							<SectionBlock key={outcome} title={label} description={pageCopy.formatAugurV2(label)}>
								<button
									type='button'
									disabled={opening !== undefined}
									onClick={() => {
										setOpening(outcome)
										void onSelect(outcome)
									}}
									aria-label={pageCopy.formatOpenUniverse(label)}
								>
									{opening === outcome ? pageCopy.opening : pageCopy.open}
								</button>
							</SectionBlock>
						)
					})}
				</div>
			</main>
		</div>
	)
}
