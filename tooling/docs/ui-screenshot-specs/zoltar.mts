import type { UiScreenshotSpec, UiScreenshotStep } from '../ui-screenshot-specs.mts'

const tutorial = ['tutorials/zoltar-first-question.html']
const pageViewport = { width: 800, height: 900 }
const fillQuestion: readonly UiScreenshotStep[] = [
	{ click: 'Create question' },
	{ waitForText: 'Question type' },
	{ fill: 'Title', value: 'Will it rain in Lisbon on 1 June 2027?' },
	{ fill: 'Description', value: 'Resolves Yes if IPMA reports measurable rain at its Lisbon station on 1 June 2027 (UTC). Invalid if IPMA publishes no reading.' },
	{ fill: 'End time', value: '2027-06-02T00:00' },
	{ waitForText: 'Draft preview' },
]
const createQuestion: readonly UiScreenshotStep[] = [...fillQuestion, { click: 'Create question', nth: -1 }, { waitForText: 'Use for fork' }]

export const ZOLTAR_SCREENSHOTS: readonly UiScreenshotSpec[] = [
	{
		id: 'create-question',
		app: 'zoltar',
		scenario: 'deployed',
		steps: fillQuestion,
		expectText: ['Question type', 'Binary', 'Title', 'Description', 'Start time', 'End time', 'Draft preview'],
		viewport: pageViewport,
		crop: { selector: '.question-create-form', padding: 0 },
		usedBy: tutorial,
	},
	{
		id: 'question-created',
		app: 'zoltar',
		scenario: 'deployed',
		steps: createQuestion,
		expectText: ['Question ID', 'Outcomes', 'Use for fork'],
		viewport: pageViewport,
		crop: { selector: '.entity-card', containing: 'Use for fork' },
		usedBy: tutorial,
	},
	{
		id: 'discover-questions',
		app: 'zoltar',
		scenario: 'deployed',
		steps: [...createQuestion, { click: 'Browse questions' }, { click: 'Discover questions' }, { waitForText: 'Will it rain in Lisbon on 1 June 2027?' }],
		expectText: ['Questions', 'Downloaded', 'Will it rain in Lisbon on 1 June 2027?'],
		viewport: pageViewport,
		crop: { selector: '.section-block', containing: 'Will it rain in Lisbon on 1 June 2027?' },
		usedBy: tutorial,
	},
]
