import { resolve } from 'node:path';
import type { CreateCmsChatAvatarDataOptions } from '../services/avatar/CmsChatAvatarDataService';

const TEST_DATA_DIR = resolve(process.cwd(), 'test-data');

const PRESENTATION_FILE = resolve(TEST_DATA_DIR, 'Test_presentation.pdf');
const KNOWLEDGE_FILE = resolve(TEST_DATA_DIR, 'KB_RAG_Eclipse_Clause.pdf');

export type CmsChatAvatarScenarioName =
  | 'presentation_only'
  | 'presentation_with_mixed_knowledge';

export const CMS_CHAT_AVATAR_SCENARIOS: Record<
  CmsChatAvatarScenarioName,
  Omit<CreateCmsChatAvatarDataOptions, 'logger'>
> = {
  presentation_only: {
    presentation: {
      filePath: PRESENTATION_FILE,
      title: 'AQA Presentation Only Source',
    },
  },
  presentation_with_mixed_knowledge: {
    presentation: {
      filePath: PRESENTATION_FILE,
      title: 'AQA Mixed Knowledge Source',
    },
    knowledge: [
      {
        type: 'file',
        filePath: KNOWLEDGE_FILE,
        name: 'Eclipse Clause KB',
      },
      {
        type: 'link',
        name: 'Duckport Canal wiki',
        url: 'https://en.wikipedia.org/wiki/Duckport_Canal',
      },
      {
        type: 'text',
        name: 'Duckport summary',
        text:
          'Duckport Canal is a flood-control channel built to divert excess Mississippi River water and protect nearby communities during high-water events.',
      },
    ],
  },
};

export const getCmsChatAvatarScenario = (
  scenarioName: CmsChatAvatarScenarioName,
): Omit<CreateCmsChatAvatarDataOptions, 'logger'> => {
  const scenario = CMS_CHAT_AVATAR_SCENARIOS[scenarioName];
  if (!scenario) {
    throw new Error(`Unknown CMS chat avatar scenario: ${scenarioName}`);
  }

  return {
    ...scenario,
    name: scenario.name ?? `aqa-${scenarioName}-${Date.now()}`,
    presentation: {
      ...scenario.presentation,
    },
    knowledge: scenario.knowledge ? [...scenario.knowledge] : undefined,
  };
};
