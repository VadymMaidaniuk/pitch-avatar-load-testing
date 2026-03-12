import type { CreateCmsChatAvatarDataOptions } from '../services/avatar/CmsChatAvatarDataService';
import {
  defineCmsChatAvatarScenario,
  type CmsChatAvatarScenarioDefinition,
} from './chatAvatarData/scenarioBuilder';

const CMS_CHAT_AVATAR_SCENARIO_LIST = [
  defineCmsChatAvatarScenario({
    id: 'pdf_s_10_no_kb',
    presentation: 'pdf_s_10',
  }),
  defineCmsChatAvatarScenario({
    id: 'pdf_s_10_mixed_kb',
    knowledge: 'mixed_kb',
    presentation: 'pdf_s_10',
  }),
] as const;

export type CmsChatAvatarScenarioName = (typeof CMS_CHAT_AVATAR_SCENARIO_LIST)[number]['id'];

export const CMS_CHAT_AVATAR_SCENARIO_NAMES = CMS_CHAT_AVATAR_SCENARIO_LIST.map(
  (scenario) => scenario.id,
) as CmsChatAvatarScenarioName[];

export const CMS_CHAT_AVATAR_SCENARIOS = Object.fromEntries(
  CMS_CHAT_AVATAR_SCENARIO_LIST.map((scenario) => [scenario.id, scenario]),
) as Record<CmsChatAvatarScenarioName, CmsChatAvatarScenarioDefinition<CmsChatAvatarScenarioName>>;

export const getCmsChatAvatarScenarioDefinition = (
  scenarioName: CmsChatAvatarScenarioName,
): CmsChatAvatarScenarioDefinition => {
  const scenario = CMS_CHAT_AVATAR_SCENARIOS[scenarioName];
  if (!scenario) {
    throw new Error(`Unknown CMS chat avatar scenario: ${scenarioName}`);
  }

  return {
    ...scenario,
    data: {
      ...scenario.data,
      knowledge: scenario.data.knowledge ? [...scenario.data.knowledge] : undefined,
      name: scenario.data.name ?? `aqa-${scenarioName}-${Date.now()}`,
      presentation: {
        ...scenario.data.presentation,
      },
    },
    tags: [...scenario.tags],
  };
};

export const getCmsChatAvatarScenario = (
  scenarioName: CmsChatAvatarScenarioName,
): Omit<CreateCmsChatAvatarDataOptions, 'logger'> => {
  const scenario = getCmsChatAvatarScenarioDefinition(scenarioName);

  return {
    ...scenario.data,
    knowledge: scenario.data.knowledge ? [...scenario.data.knowledge] : undefined,
    presentation: {
      ...scenario.data.presentation,
    },
  };
};
