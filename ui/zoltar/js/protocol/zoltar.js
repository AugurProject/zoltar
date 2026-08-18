import { zeroAddress } from '@zoltar/shared/ethereum';
import { ReputationToken_ReputationToken, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js';
import { readRequiredMulticall, writeContractAndWait } from './core.js';
import { getMarketType, getProtocolPageOffset, getQuestionId, getQuestionIdHex, isStringArray, requireDeployedChildUniverseTupleArray, requireUniverseTupleArray } from './helpers.js';
import { getDeploymentSteps } from './deployment.js';
const CONTRACT_PAGE_SIZE = 30n;
const ANSWER_OPTION_ABI = [
    {
        inputs: [
            { name: 'questionId', type: 'uint256' },
            { name: 'answer', type: 'uint256' },
        ],
        name: 'getAnswerOptionName',
        outputs: [{ name: '', type: 'string' }],
        stateMutability: 'view',
        type: 'function',
    },
];
function requireBigintArray(value, context) {
    if (!Array.isArray(value) || !value.every(item => typeof item === 'bigint'))
        throw new Error(`Unexpected ${context} response`);
    return [...value];
}
function getDeploymentStepAddress(id) {
    const step = getDeploymentSteps().find(candidate => candidate.id === id);
    if (step === undefined)
        throw new Error(`Unknown deployment step: ${id}`);
    return step.address;
}
async function loadOutcomeLabels(client, questionId) {
    let currentIndex = 0n;
    const outcomeLabels = [];
    while (true) {
        const page = await client.readContract({
            abi: ZoltarQuestionData_ZoltarQuestionData.abi,
            functionName: 'getOutcomeLabels',
            address: getDeploymentStepAddress('zoltarQuestionData'),
            args: [questionId, currentIndex, CONTRACT_PAGE_SIZE],
        });
        if (!isStringArray(page))
            throw new Error('Unexpected outcome labels response');
        outcomeLabels.push(...page);
        if (BigInt(page.length) !== CONTRACT_PAGE_SIZE)
            break;
        currentIndex += CONTRACT_PAGE_SIZE;
    }
    return outcomeLabels;
}
async function loadQuestionIds(client) {
    const questionCount = await client.readContract({
        abi: ZoltarQuestionData_ZoltarQuestionData.abi,
        functionName: 'getQuestionCount',
        address: getDeploymentStepAddress('zoltarQuestionData'),
        args: [],
    });
    let currentIndex = 0n;
    const questionIds = [];
    while (currentIndex < questionCount) {
        const page = await client.readContract({
            abi: ZoltarQuestionData_ZoltarQuestionData.abi,
            functionName: 'getQuestions',
            address: getDeploymentStepAddress('zoltarQuestionData'),
            args: [currentIndex, CONTRACT_PAGE_SIZE],
        });
        if (!Array.isArray(page))
            throw new Error('Unexpected question id page response');
        if (!page.every((questionId) => typeof questionId === 'bigint'))
            throw new Error('Unexpected question id page response');
        questionIds.push(...page);
        if (BigInt(page.length) !== CONTRACT_PAGE_SIZE)
            break;
        currentIndex += CONTRACT_PAGE_SIZE;
    }
    return questionIds;
}
async function loadQuestionIdsPage(client, startIndex, count) {
    if (count === 0n)
        return [];
    const page = await client.readContract({
        abi: ZoltarQuestionData_ZoltarQuestionData.abi,
        functionName: 'getQuestions',
        address: getDeploymentStepAddress('zoltarQuestionData'),
        args: [startIndex, count],
    });
    if (!Array.isArray(page))
        throw new Error('Unexpected question id page response');
    if (!page.every((questionId) => typeof questionId === 'bigint'))
        throw new Error('Unexpected question id page response');
    return page;
}
export async function loadMarketDetails(client, questionId) {
    const [question, createdAt] = await readRequiredMulticall(client, [
        {
            abi: ZoltarQuestionData_ZoltarQuestionData.abi,
            functionName: 'questions',
            address: getDeploymentStepAddress('zoltarQuestionData'),
            args: [questionId],
        },
        {
            abi: ZoltarQuestionData_ZoltarQuestionData.abi,
            functionName: 'questionCreatedTimestamp',
            address: getDeploymentStepAddress('zoltarQuestionData'),
            args: [questionId],
        },
    ]);
    const questionData = question;
    const [title, description, startTime, endTime, numTicks, displayValueMin, displayValueMax, answerUnit] = questionData;
    const exists = createdAt > 0n || title !== '' || description !== '' || startTime !== 0n || endTime !== 0n || numTicks !== 0n;
    const outcomeLabels = exists ? await loadOutcomeLabels(client, questionId) : [];
    return {
        answerUnit,
        createdAt,
        description,
        displayValueMax,
        displayValueMin,
        endTime,
        exists,
        marketType: getMarketType({ title, description, startTime, endTime, numTicks, displayValueMin, displayValueMax, answerUnit }, outcomeLabels),
        outcomeLabels,
        numTicks,
        questionId: getQuestionIdHex(questionId),
        startTime,
        title,
    };
}
export async function loadAllZoltarQuestions(client) {
    const questionIds = await loadQuestionIds(client);
    return await Promise.all(questionIds.map(async (questionId) => await loadMarketDetails(client, questionId)));
}
export async function loadZoltarQuestionCount(client) {
    return await client.readContract({
        abi: ZoltarQuestionData_ZoltarQuestionData.abi,
        functionName: 'getQuestionCount',
        address: getDeploymentStepAddress('zoltarQuestionData'),
        args: [],
    });
}
export async function loadZoltarQuestionPage(client, pageIndex, pageSize) {
    const startIndex = getProtocolPageOffset(pageIndex, pageSize);
    const questionCount = await loadZoltarQuestionCount(client);
    if (startIndex >= questionCount) {
        return {
            pageIndex,
            pageSize,
            questionCount,
            questions: [],
        };
    }
    const count = questionCount - startIndex < BigInt(pageSize) ? questionCount - startIndex : BigInt(pageSize);
    const questionIds = await loadQuestionIdsPage(client, startIndex, count);
    return {
        pageIndex,
        pageSize,
        questionCount,
        questions: await Promise.all(questionIds.map(async (questionId) => await loadMarketDetails(client, questionId))),
    };
}
export async function loadZoltarUniverseSummary(client, universeId) {
    const zoltarAddress = getDeploymentStepAddress('zoltar');
    const [repToken, universe, forkTime, forkThresholdAttoRep, forkBurnDivisor] = await readRequiredMulticall(client, [
        {
            abi: Zoltar_Zoltar.abi,
            functionName: 'getRepToken',
            address: zoltarAddress,
            args: [universeId],
        },
        {
            abi: Zoltar_Zoltar.abi,
            functionName: 'universes',
            address: zoltarAddress,
            args: [universeId],
        },
        {
            abi: Zoltar_Zoltar.abi,
            functionName: 'getForkTime',
            address: zoltarAddress,
            args: [universeId],
        },
        {
            abi: Zoltar_Zoltar.abi,
            functionName: 'getForkThresholdAttoRep',
            address: zoltarAddress,
            args: [universeId],
        },
        {
            abi: Zoltar_Zoltar.abi,
            functionName: 'forkBurnDivisor',
            address: zoltarAddress,
            args: [],
        },
    ]);
    if (repToken === zeroAddress)
        return undefined;
    const totalTheoreticalSupplyAttoRep = await client.readContract({
        abi: ReputationToken_ReputationToken.abi,
        functionName: 'getTotalTheoreticalSupplyAttoRep',
        address: repToken,
        args: [],
    });
    const universeData = universe;
    const [storedForkTime, forkQuestionId, forkingOutcomeIndex, , parentUniverseId] = universeData;
    const hasForked = forkTime > 0n || storedForkTime > 0n;
    let childUniverses = [];
    let forkQuestionDetails = undefined;
    if (hasForked && forkQuestionId > 0n) {
        const marketDetails = await loadMarketDetails(client, forkQuestionId);
        forkQuestionDetails = marketDetails;
        if (marketDetails.marketType === 'scalar') {
            const deployedChildUniverses = [];
            let currentIndex = 0n;
            while (true) {
                const pageResponse = await client.readContract({
                    abi: Zoltar_Zoltar.abi,
                    functionName: 'getDeployedChildUniverses',
                    address: getDeploymentStepAddress('zoltar'),
                    args: [universeId, currentIndex, CONTRACT_PAGE_SIZE],
                });
                if (!Array.isArray(pageResponse) || pageResponse.length !== 3)
                    throw new Error('Unexpected deployed child universe page response');
                const [outcomeIndexesRaw, childUniverseIdsRaw, childUniverseTuplesRaw] = pageResponse;
                const page = [requireBigintArray(outcomeIndexesRaw, 'deployed child universe outcome indexes'), requireBigintArray(childUniverseIdsRaw, 'deployed child universe ids'), requireDeployedChildUniverseTupleArray(childUniverseTuplesRaw, 'deployed child universe page')];
                const [outcomeIndexes, childUniverseIds, childUniverseTuples] = page;
                let outcomeLabels = [];
                if (outcomeIndexes.length > 0) {
                    const rawOutcomeLabels = await readRequiredMulticall(client, outcomeIndexes.map(outcomeIndex => ({
                        abi: ANSWER_OPTION_ABI,
                        functionName: 'getAnswerOptionName',
                        address: getDeploymentStepAddress('zoltarQuestionData'),
                        args: [forkQuestionId, outcomeIndex],
                    })));
                    if (!isStringArray(rawOutcomeLabels))
                        throw new Error('Unexpected child universe outcome labels response');
                    outcomeLabels = rawOutcomeLabels.map(outcomeLabel => String(outcomeLabel));
                }
                const pageChildren = outcomeIndexes.map((outcomeIndex, index) => {
                    const childUniverse = childUniverseTuples[index];
                    if (childUniverse === undefined)
                        throw new Error('Unexpected deployed child universe response');
                    const { forkTime: childForkTime, parentUniverseId: childParentUniverseId, reputationToken: childReputationToken } = childUniverse;
                    const outcomeLabel = outcomeLabels[index];
                    if (outcomeLabel === undefined)
                        throw new Error('Unexpected outcome label response');
                    const childUniverseId = childUniverseIds[index];
                    if (childUniverseId === undefined)
                        throw new Error('Unexpected deployed child universe response');
                    return {
                        exists: childReputationToken !== zeroAddress,
                        forkTime: childForkTime,
                        outcomeIndex,
                        outcomeLabel,
                        parentUniverseId: childParentUniverseId,
                        reputationToken: childReputationToken,
                        universeId: childUniverseId,
                    };
                });
                deployedChildUniverses.push(...pageChildren);
                if (BigInt(pageChildren.length) !== CONTRACT_PAGE_SIZE)
                    break;
                currentIndex += CONTRACT_PAGE_SIZE;
            }
            childUniverses = deployedChildUniverses;
        }
        else {
            const childOutcomeEntries = [
                { outcomeIndex: 0n, outcomeLabel: 'Invalid' },
                ...marketDetails.outcomeLabels.map((outcomeLabel, outcomeIndex) => ({
                    outcomeIndex: BigInt(outcomeIndex + 1),
                    outcomeLabel,
                })),
            ];
            const childUniverseIds = requireBigintArray(await readRequiredMulticall(client, childOutcomeEntries.map(({ outcomeIndex }) => ({
                abi: Zoltar_Zoltar.abi,
                functionName: 'getChildUniverseId',
                address: getDeploymentStepAddress('zoltar'),
                args: [universeId, outcomeIndex],
            }))), 'child universe ids');
            const childUniverseTuples = requireUniverseTupleArray(await readRequiredMulticall(client, childUniverseIds.map((childUniverseId) => ({
                abi: Zoltar_Zoltar.abi,
                functionName: 'universes',
                address: getDeploymentStepAddress('zoltar'),
                args: [childUniverseId],
            }))), 'child universe tuple');
            childUniverses = childOutcomeEntries.map(({ outcomeIndex, outcomeLabel }, index) => {
                const childUniverseId = childUniverseIds[index];
                if (childUniverseId === undefined)
                    throw new Error('Unexpected child universe id response');
                const childUniverseData = childUniverseTuples[index];
                if (childUniverseData === undefined)
                    throw new Error('Unexpected child universe response');
                const [childForkTime, , , childReputationToken, childParentUniverseId] = childUniverseData;
                return {
                    exists: childReputationToken !== zeroAddress,
                    forkTime: childForkTime,
                    outcomeIndex,
                    outcomeLabel,
                    parentUniverseId: childParentUniverseId,
                    reputationToken: childReputationToken,
                    universeId: childUniverseId,
                };
            });
        }
    }
    return {
        childUniverses,
        forkBurnDivisor,
        forkQuestionDetails,
        forkThresholdAttoRep,
        forkTime,
        forkingOutcomeIndex,
        hasForked,
        parentUniverseId,
        reputationToken: repToken,
        totalTheoreticalSupplyAttoRep,
        universeId,
        zoltarAddress,
    };
}
export async function createMarket(client, parameters) {
    const questionId = getQuestionId(parameters.questionData, parameters.outcomeLabels);
    const createQuestionHash = await writeContractAndWait(client, () => ({
        address: getDeploymentStepAddress('zoltarQuestionData'),
        abi: ZoltarQuestionData_ZoltarQuestionData.abi,
        functionName: 'createQuestion',
        args: [parameters.questionData, parameters.outcomeLabels],
    }));
    return {
        questionId: getQuestionIdHex(questionId),
        createQuestionHash,
        marketType: parameters.marketType,
    };
}
//# sourceMappingURL=zoltar.js.map