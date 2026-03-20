import type { CreateCmsChatAvatarDataOptions } from '../services/avatar/CmsChatAvatarDataService';
import {
  defineCmsChatAvatarScenario,
  type CmsChatAvatarScenarioDefinition,
} from './chatAvatarData/scenarioBuilder';

const CMS_CHAT_AVATAR_SCENARIO_LIST = [
  // Smoke coverage: базовый create path без KB и репрезентативный mixed KB.
  defineCmsChatAvatarScenario({
    id: 'pdf_s_10_no_kb',
    presentation: 'pdf_s_10',
    tags: ['@smoke', '@regression'],
  }),
  defineCmsChatAvatarScenario({
    id: 'pptx_s_10_mixed_kb',
    knowledge: 'mixed_kb',
    presentation: 'pptx_s_10',
    tags: ['@smoke', '@regression'],
  }),
  // Regression coverage: KB file formats, multilingual text KB, and link KB set.
  defineCmsChatAvatarScenario({
    id: 'pdf_s_25_file_kb_pdf',
    knowledge: 'file_kb_pdf',
    presentation: 'pdf_s_25',
    tags: ['@regression'],
  }),
  defineCmsChatAvatarScenario({
    id: 'pptx_s_25_file_kb_rag_docx',
    knowledge: 'file_kb_rag_docx',
    presentation: 'pptx_s_25',
    tags: ['@regression'],
  }),
  defineCmsChatAvatarScenario({
    id: 'pdf_s_50_file_kb_rag_pdf',
    knowledge: 'file_kb_rag_pdf',
    presentation: 'pdf_s_50',
    tags: ['@regression'],
  }),
  defineCmsChatAvatarScenario({
    id: 'pptx_s_50_file_kb_rag_pptx',
    knowledge: 'file_kb_rag_pptx',
    presentation: 'pptx_s_50',
    tags: ['@regression'],
  }),
  defineCmsChatAvatarScenario({
    id: 'pdf_s_100_file_kb_rag_mp3',
    knowledge: 'file_kb_rag_mp3',
    presentation: 'pdf_s_100',
    tags: ['@regression'],
  }),
  defineCmsChatAvatarScenario({
    id: 'pptx_s_100_file_kb_rag_mp4',
    knowledge: 'file_kb_rag_mp4',
    presentation: 'pptx_s_100',
    tags: ['@regression'],
  }),
  defineCmsChatAvatarScenario({
    id: 'pdf_multilang_10_text_kb_set',
    knowledge: ['text_nickname_aqa', 'text_widget_site_overview', 'text_widget_site_support'],
    presentation: 'pdf_multilang_10',
    tags: ['@regression'],
    title: 'PDF multilang 10 slides with text knowledge set',
  }),
  defineCmsChatAvatarScenario({
    id: 'pptx_business_12_link_kb_set',
    knowledge: [
      'link_widget_site_home',
      'link_widget_site_about',
      'link_widget_site_catalog',
      'link_widget_site_guide_installation',
      'link_widget_site_guide_integrations',
      'link_widget_site_policy_data_retention',
      'link_widget_site_faq',
      'link_widget_site_contact',
    ],
    presentation: 'pptx_business_12',
    tags: ['@regression'],
    title: 'PPTX business 12 slides with widget site link knowledge set',
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
