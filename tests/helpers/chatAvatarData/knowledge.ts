import type { CmsKnowledgeInput } from '../../services/avatar/CmsChatAvatarDataService';
import { resolve } from 'node:path';

const TEST_DATA_DIR = resolve(process.cwd(), 'test-data');

const KNOWLEDGE_PDF = resolve(TEST_DATA_DIR, 'KB_RAG_PDF.pdf');
const KNOWLEDGE_RAG_DOCX = resolve(TEST_DATA_DIR, 'Test_KB_RAG_Docx.docx');
const KNOWLEDGE_RAG_MP3 = resolve(TEST_DATA_DIR, 'Test_KB_RAG_MP3.mp3');
const KNOWLEDGE_RAG_MP4 = resolve(TEST_DATA_DIR, 'Test_KB_RAG_MP4.mp4');
const KNOWLEDGE_RAG_PDF = resolve(TEST_DATA_DIR, 'Test_KB_RAG_PDF.pdf');
const KNOWLEDGE_RAG_PPTX = resolve(TEST_DATA_DIR, 'Test_KB_RAG_PPTX.pptx');

const KNOWLEDGE_FILE_PDF: CmsKnowledgeInput = {
  type: 'file',
  filePath: KNOWLEDGE_PDF,
  name: 'KB PDF',
};

const KNOWLEDGE_FILE_RAG_DOCX: CmsKnowledgeInput = {
  type: 'file',
  filePath: KNOWLEDGE_RAG_DOCX,
  name: 'KB RAG DOCX',
};

const KNOWLEDGE_FILE_RAG_MP3: CmsKnowledgeInput = {
  type: 'file',
  filePath: KNOWLEDGE_RAG_MP3,
  name: 'KB RAG MP3',
};

const KNOWLEDGE_FILE_RAG_MP4: CmsKnowledgeInput = {
  type: 'file',
  filePath: KNOWLEDGE_RAG_MP4,
  name: 'KB RAG MP4',
};

const KNOWLEDGE_FILE_RAG_PDF: CmsKnowledgeInput = {
  type: 'file',
  filePath: KNOWLEDGE_RAG_PDF,
  name: 'KB RAG PDF',
};

const KNOWLEDGE_FILE_RAG_PPTX: CmsKnowledgeInput = {
  type: 'file',
  filePath: KNOWLEDGE_RAG_PPTX,
  name: 'KB RAG PPTX',
};

const KNOWLEDGE_LINK_DUCKPORT_CANAL: CmsKnowledgeInput = {
  type: 'link',
  name: 'Duckport Canal wiki',
  url: 'https://en.wikipedia.org/wiki/Duckport_Canal',
};

const KNOWLEDGE_TEXT_NICKNAME_AQA: CmsKnowledgeInput = {
  type: 'text',
  name: 'Nickname AQA',
  text:
    'AQA is the short name of the test assistant. In this knowledge base, AQA means Avatar Quality Assistant. Expected answers should be concise, factual, and limited to two or three short sentences.',
};

const KNOWLEDGE_TEXT_WIDGET_SITE_OVERVIEW: CmsKnowledgeInput = {
  type: 'text',
  name: 'Widget Site Overview',
  text:
    'Widget Site is a demo portal for retrieval tests. Its main sections are About, Catalog, Installation Guide, Integrations Guide, FAQ, Contact, and Data Retention Policy. The portal is used to validate link-based and text-based knowledge sources.',
};

const KNOWLEDGE_TEXT_WIDGET_SITE_SUPPORT: CmsKnowledgeInput = {
  type: 'text',
  name: 'Widget Site Support',
  text:
    'Support routing is simple: setup questions belong to Installation Guide, integration questions belong to Integrations Guide, policy questions belong to Data Retention Policy, and direct help requests belong to Contact. FAQ should be checked first for common issues.',
};

const KNOWLEDGE_LINK_WIDGET_SITE_HOME: CmsKnowledgeInput = {
  type: 'link',
  name: 'Widget Site Home',
  url: 'https://widget-site-test-ijpodnap9-propawns-projects.vercel.app/',
};

const KNOWLEDGE_LINK_WIDGET_SITE_ABOUT: CmsKnowledgeInput = {
  type: 'link',
  name: 'Widget Site About',
  url: 'https://widget-site-test-ijpodnap9-propawns-projects.vercel.app/about',
};

const KNOWLEDGE_LINK_WIDGET_SITE_CATALOG: CmsKnowledgeInput = {
  type: 'link',
  name: 'Widget Site Catalog',
  url: 'https://widget-site-test-ijpodnap9-propawns-projects.vercel.app/catalog',
};

const KNOWLEDGE_LINK_WIDGET_SITE_GUIDE_INSTALLATION: CmsKnowledgeInput = {
  type: 'link',
  name: 'Widget Site Installation Guide',
  url: 'https://widget-site-test-ijpodnap9-propawns-projects.vercel.app/guides/installation',
};

const KNOWLEDGE_LINK_WIDGET_SITE_GUIDE_INTEGRATIONS: CmsKnowledgeInput = {
  type: 'link',
  name: 'Widget Site Integrations Guide',
  url: 'https://widget-site-test-ijpodnap9-propawns-projects.vercel.app/guides/integrations',
};

const KNOWLEDGE_LINK_WIDGET_SITE_POLICY_DATA_RETENTION: CmsKnowledgeInput = {
  type: 'link',
  name: 'Widget Site Data Retention Policy',
  url: 'https://widget-site-test-ijpodnap9-propawns-projects.vercel.app/policies/data-retention',
};

const KNOWLEDGE_LINK_WIDGET_SITE_FAQ: CmsKnowledgeInput = {
  type: 'link',
  name: 'Widget Site FAQ',
  url: 'https://widget-site-test-ijpodnap9-propawns-projects.vercel.app/faq',
};

const KNOWLEDGE_LINK_WIDGET_SITE_CONTACT: CmsKnowledgeInput = {
  type: 'link',
  name: 'Widget Site Contact',
  url: 'https://widget-site-test-ijpodnap9-propawns-projects.vercel.app/contact',
};

type CmsChatAvatarKnowledgePreset = {
  items?: CmsKnowledgeInput[];
  tags: string[];
  title: string;
};

export const CMS_CHAT_AVATAR_KNOWLEDGE = {
  none: {
    items: undefined,
    tags: ['@kb_none'],
    title: 'without knowledge',
  },
  mixed_kb: {
    items: [
      KNOWLEDGE_FILE_PDF,
      KNOWLEDGE_LINK_DUCKPORT_CANAL,
      KNOWLEDGE_TEXT_NICKNAME_AQA,
    ],
    tags: ['@kb_mixed'],
    title: 'mixed knowledge',
  },
  file_kb_pdf: {
    items: [KNOWLEDGE_FILE_PDF],
    tags: ['@kb_file_pdf'],
    title: 'KB PDF file',
  },
  file_kb_rag_docx: {
    items: [KNOWLEDGE_FILE_RAG_DOCX],
    tags: ['@kb_file_rag_docx'],
    title: 'KB RAG DOCX file',
  },
  file_kb_rag_mp3: {
    items: [KNOWLEDGE_FILE_RAG_MP3],
    tags: ['@kb_file_rag_mp3'],
    title: 'KB RAG MP3 file',
  },
  file_kb_rag_mp4: {
    items: [KNOWLEDGE_FILE_RAG_MP4],
    tags: ['@kb_file_rag_mp4'],
    title: 'KB RAG MP4 file',
  },
  file_kb_rag_pdf: {
    items: [KNOWLEDGE_FILE_RAG_PDF],
    tags: ['@kb_file_rag_pdf'],
    title: 'KB RAG PDF file',
  },
  file_kb_rag_pptx: {
    items: [KNOWLEDGE_FILE_RAG_PPTX],
    tags: ['@kb_file_rag_pptx'],
    title: 'KB RAG PPTX file',
  },
  link_duckport_canal_wiki: {
    items: [KNOWLEDGE_LINK_DUCKPORT_CANAL],
    tags: ['@kb_link_duckport_canal_wiki'],
    title: 'Duckport Canal wiki link',
  },
  text_nickname_aqa: {
    items: [KNOWLEDGE_TEXT_NICKNAME_AQA],
    tags: ['@kb_text_nickname_aqa'],
    title: 'Nickname AQA text',
  },
  text_widget_site_overview: {
    items: [KNOWLEDGE_TEXT_WIDGET_SITE_OVERVIEW],
    tags: ['@kb_text_widget_site_overview'],
    title: 'Widget Site Overview text',
  },
  text_widget_site_support: {
    items: [KNOWLEDGE_TEXT_WIDGET_SITE_SUPPORT],
    tags: ['@kb_text_widget_site_support'],
    title: 'Widget Site Support text',
  },
  link_widget_site_home: {
    items: [KNOWLEDGE_LINK_WIDGET_SITE_HOME],
    tags: ['@kb_link_widget_site_home'],
    title: 'Widget Site Home link',
  },
  link_widget_site_about: {
    items: [KNOWLEDGE_LINK_WIDGET_SITE_ABOUT],
    tags: ['@kb_link_widget_site_about'],
    title: 'Widget Site About link',
  },
  link_widget_site_catalog: {
    items: [KNOWLEDGE_LINK_WIDGET_SITE_CATALOG],
    tags: ['@kb_link_widget_site_catalog'],
    title: 'Widget Site Catalog link',
  },
  link_widget_site_guide_installation: {
    items: [KNOWLEDGE_LINK_WIDGET_SITE_GUIDE_INSTALLATION],
    tags: ['@kb_link_widget_site_guide_installation'],
    title: 'Widget Site Installation Guide link',
  },
  link_widget_site_guide_integrations: {
    items: [KNOWLEDGE_LINK_WIDGET_SITE_GUIDE_INTEGRATIONS],
    tags: ['@kb_link_widget_site_guide_integrations'],
    title: 'Widget Site Integrations Guide link',
  },
  link_widget_site_policy_data_retention: {
    items: [KNOWLEDGE_LINK_WIDGET_SITE_POLICY_DATA_RETENTION],
    tags: ['@kb_link_widget_site_policy_data_retention'],
    title: 'Widget Site Data Retention Policy link',
  },
  link_widget_site_faq: {
    items: [KNOWLEDGE_LINK_WIDGET_SITE_FAQ],
    tags: ['@kb_link_widget_site_faq'],
    title: 'Widget Site FAQ link',
  },
  link_widget_site_contact: {
    items: [KNOWLEDGE_LINK_WIDGET_SITE_CONTACT],
    tags: ['@kb_link_widget_site_contact'],
    title: 'Widget Site Contact link',
  },
} satisfies Record<string, CmsChatAvatarKnowledgePreset>;

export type CmsChatAvatarKnowledgeName = keyof typeof CMS_CHAT_AVATAR_KNOWLEDGE;

export const CMS_CHAT_AVATAR_KNOWLEDGE_NAMES = Object.keys(
  CMS_CHAT_AVATAR_KNOWLEDGE,
) as CmsChatAvatarKnowledgeName[];

export type CmsChatAvatarKnowledgeDefinition = CmsChatAvatarKnowledgePreset & {
  id: CmsChatAvatarKnowledgeName;
};

export type CmsChatAvatarKnowledgeSelection =
  | CmsChatAvatarKnowledgeName
  | CmsChatAvatarKnowledgeName[];

export type CmsChatAvatarKnowledgeBundle = {
  items?: CmsKnowledgeInput[];
  knowledgeNames: CmsChatAvatarKnowledgeName[];
  tags: string[];
  title: string;
};

const cloneKnowledgeItem = (item: CmsKnowledgeInput): CmsKnowledgeInput => {
  switch (item.type) {
    case 'file':
      return { ...item };
    case 'link':
      return { ...item };
    case 'text':
      return { ...item };
  }
};

const normalizeKnowledgeSelection = (
  knowledgeSelection?: CmsChatAvatarKnowledgeSelection,
): CmsChatAvatarKnowledgeName[] => {
  const selectedKnowledgeNames: CmsChatAvatarKnowledgeName[] = knowledgeSelection === undefined
    ? ['none']
    : Array.isArray(knowledgeSelection)
      ? [...knowledgeSelection]
      : [knowledgeSelection];
  const uniqueKnowledgeNames = Array.from(
    new Set<CmsChatAvatarKnowledgeName>(selectedKnowledgeNames),
  );
  const effectiveKnowledgeNames = uniqueKnowledgeNames.filter(
    (name): name is Exclude<CmsChatAvatarKnowledgeName, 'none'> => name !== 'none',
  );

  return effectiveKnowledgeNames.length ? effectiveKnowledgeNames : ['none'];
};

export const getCmsChatAvatarKnowledgeDefinition = (
  knowledgeName: CmsChatAvatarKnowledgeName,
): CmsChatAvatarKnowledgeDefinition => {
  const knowledge = CMS_CHAT_AVATAR_KNOWLEDGE[knowledgeName];
  if (!knowledge) {
    throw new Error(`Unknown CMS chat avatar knowledge preset: ${knowledgeName}`);
  }

  return {
    id: knowledgeName,
    items: knowledge.items ? knowledge.items.map(cloneKnowledgeItem) : undefined,
    tags: [...knowledge.tags],
    title: knowledge.title,
  };
};

export const getCmsChatAvatarKnowledgeBundle = (
  knowledgeSelection?: CmsChatAvatarKnowledgeSelection,
): CmsChatAvatarKnowledgeBundle => {
  const knowledgeNames = normalizeKnowledgeSelection(knowledgeSelection);
  const knowledgeDefinitions = knowledgeNames.map(getCmsChatAvatarKnowledgeDefinition);
  const items = knowledgeDefinitions.flatMap((knowledge) => knowledge.items ?? []);
  const tags = [...new Set(knowledgeDefinitions.flatMap((knowledge) => knowledge.tags))];
  const title = knowledgeNames[0] === 'none'
    ? 'without knowledge'
    : `with ${knowledgeDefinitions.map((knowledge) => knowledge.title).join(' + ')}`;

  return {
    items: items.length ? items : undefined,
    knowledgeNames,
    tags,
    title,
  };
};
