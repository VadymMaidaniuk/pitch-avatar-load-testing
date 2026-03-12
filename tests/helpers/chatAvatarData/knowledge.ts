import type { CmsKnowledgeInput } from '../../services/avatar/CmsChatAvatarDataService';
import { resolve } from 'node:path';

const TEST_DATA_DIR = resolve(process.cwd(), 'test-data');

const KNOWLEDGE_PDF = resolve(TEST_DATA_DIR, 'KB_RAG_PDF.pdf');

export const CMS_CHAT_AVATAR_KNOWLEDGE_NAMES = ['none', 'mixed_kb'] as const;

export type CmsChatAvatarKnowledgeName = (typeof CMS_CHAT_AVATAR_KNOWLEDGE_NAMES)[number];

export type CmsChatAvatarKnowledgeDefinition = {
  id: CmsChatAvatarKnowledgeName;
  items?: CmsKnowledgeInput[];
  tags: string[];
  title: string;
};

export const CMS_CHAT_AVATAR_KNOWLEDGE: Record<
  CmsChatAvatarKnowledgeName,
  CmsChatAvatarKnowledgeDefinition
> = {
  none: {
    id: 'none',
    items: undefined,
    tags: ['@kb_none'],
    title: 'without knowledge',
  },
  mixed_kb: {
    id: 'mixed_kb',
    items: [
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
    tags: ['@kb_mixed'],
    title: 'with mixed knowledge',
  },
};

export const getCmsChatAvatarKnowledgeDefinition = (
  knowledgeName: CmsChatAvatarKnowledgeName,
): CmsChatAvatarKnowledgeDefinition => {
  const knowledge = CMS_CHAT_AVATAR_KNOWLEDGE[knowledgeName];
  if (!knowledge) {
    throw new Error(`Unknown CMS chat avatar knowledge preset: ${knowledgeName}`);
  }

  return {
    ...knowledge,
    items: knowledge.items ? [...knowledge.items] : undefined,
    tags: [...knowledge.tags],
  };
};
