import { resolve } from 'node:path';
import type { CmsPresentationFileInput } from '../../services/avatar/CmsChatAvatarDataService';

const TEST_DATA_DIR = resolve(process.cwd(), 'test-data');

const PRESENTATION_PDF_10 = resolve(TEST_DATA_DIR, 'Test_presentation_pdf_10slides.pdf');

export const CMS_CHAT_AVATAR_PRESENTATION_NAMES = ['pdf_s_10'] as const;

export type CmsChatAvatarPresentationName = (typeof CMS_CHAT_AVATAR_PRESENTATION_NAMES)[number];

export type CmsChatAvatarPresentationDefinition = {
  id: CmsChatAvatarPresentationName;
  input: CmsPresentationFileInput;
  tags: string[];
  title: string;
};

export const CMS_CHAT_AVATAR_PRESENTATIONS: Record<
  CmsChatAvatarPresentationName,
  CmsChatAvatarPresentationDefinition
> = {
  pdf_s_10: {
    id: 'pdf_s_10',
    input: {
      filePath: PRESENTATION_PDF_10,
      title: 'AQA PDF 10 slides source',
    },
    tags: ['@fmt_pdf', '@slides_10'],
    title: 'PDF small 10 slides',
  },
};

export const getCmsChatAvatarPresentationDefinition = (
  presentationName: CmsChatAvatarPresentationName,
): CmsChatAvatarPresentationDefinition => {
  const presentation = CMS_CHAT_AVATAR_PRESENTATIONS[presentationName];
  if (!presentation) {
    throw new Error(`Unknown CMS chat avatar presentation preset: ${presentationName}`);
  }

  return {
    ...presentation,
    input: {
      ...presentation.input,
    },
    tags: [...presentation.tags],
  };
};
