import { resolve } from 'node:path';
import type { CreateCmsChatAvatarDataOptions } from '../services/avatar/CmsChatAvatarDataService';

const TEST_DATA_DIR = resolve(process.cwd(), 'test-data');

const PRESENTATION_PDF_10 = resolve(TEST_DATA_DIR, 'Test_presentation_pdf_10slides.pdf');
const KNOWLEDGE_PDF = resolve(TEST_DATA_DIR, 'KB_RAG_PDF.pdf');

export const CMS_CHAT_AVATAR_SCENARIO_NAMES = [
  'pdf_s_10_no_kb',
  'pdf_s_10_mixed_kb',
] as const;

export type CmsChatAvatarScenarioName = (typeof CMS_CHAT_AVATAR_SCENARIO_NAMES)[number];

export type CmsChatAvatarScenarioDefinition = {
  data: Omit<CreateCmsChatAvatarDataOptions, 'logger'>;
  id: CmsChatAvatarScenarioName;
  tags: string[];
  title: string;
};

export const CMS_CHAT_AVATAR_SCENARIOS: Record<
  CmsChatAvatarScenarioName,
  CmsChatAvatarScenarioDefinition
> = {
  pdf_s_10_no_kb: {
    data: {
      presentation: {
        filePath: PRESENTATION_PDF_10,
        title: 'AQA PDF 10 slides source',
      },
    },
    id: 'pdf_s_10_no_kb',
    tags: ['@fmt_pdf', '@slides_10', '@kb_none'],
    title: 'PDF small 10 slides without knowledge',
  },
  pdf_s_10_mixed_kb: {
    data: {
      presentation: {
        filePath: PRESENTATION_PDF_10,
        title: 'AQA PDF 10 slides mixed knowledge source',
      },
      knowledge: [
        {
          type: 'file',
          filePath: KNOWLEDGE_PDF,
          name: 'KB PDF',
        },
        {
          type: 'link',
          name: 'Duckport Canal wiki',
          url: 'https://en.wikipedia.org/wiki/Duckport_Canal',
        },
        {
          type: 'text',
          name: 'Nickname AQA',
          text:
            'The nickname "AQA" stands for "Automated Quality Assurance". It is commonly used in the software testing industry to refer to tools, processes, or teams that focus on automating the quality assurance activities to improve efficiency and effectiveness.',
        },
      ],
    },
    id: 'pdf_s_10_mixed_kb',
    tags: ['@fmt_pdf', '@slides_10', '@kb_mixed'],
    title: 'PDF small 10 slides with mixed knowledge',
  },
};

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
