import { resolve } from 'node:path';
import type { CmsPresentationFileInput } from '../../services/avatar/CmsChatAvatarDataService';

const TEST_DATA_DIR = resolve(process.cwd(), 'test-data');

const PRESENTATION_PDF_5 = resolve(TEST_DATA_DIR, 'Test_presentation_pdf_5slides.pdf');
const PRESENTATION_PDF_10 = resolve(TEST_DATA_DIR, 'Test_presentation_pdf_10slides.pdf');
const PRESENTATION_PDF_25 = resolve(TEST_DATA_DIR, 'Test_presentation_pdf_25slides.pdf');
const PRESENTATION_PDF_50 = resolve(TEST_DATA_DIR, 'Test_presentation_pdf_50slides.pdf');
const PRESENTATION_PDF_100 = resolve(TEST_DATA_DIR, 'Test_presentation_pdf_100slides.pdf');
const PRESENTATION_PDF_MULTILANG_10 = resolve(TEST_DATA_DIR, 'Test_presentation_pdf_multilang_10slides.pdf');

const PRESENTATION_PPTX_12 = resolve(TEST_DATA_DIR, 'Test_presentation_pptx_12slides.pptx');
const PRESENTATION_PPTX_10 = resolve(TEST_DATA_DIR, 'Test_presentation_pptx_10slides.pptx');
const PRESENTATION_PPTX_25 = resolve(TEST_DATA_DIR, 'Test_presentation_pptx_25slides.pptx');
const PRESENTATION_PPTX_50 = resolve(TEST_DATA_DIR, 'Test_presentation_pptx_50slides.pptx');
const PRESENTATION_PPTX_100 = resolve(TEST_DATA_DIR, 'Test_presentation_pptx_100slides.pptx');
const PRESENTATION_PPTX_BUSINESS_12 = resolve(
  TEST_DATA_DIR,
  'Test_presentation_pptx_bussines_12slides.pptx',
);
const PRESENTATION_PPTX_MULTILANG_10 = resolve(
  TEST_DATA_DIR,
  'Test_presentation_pptx_multilang_10slides.pptx',
);

type CmsChatAvatarPresentationPreset = {
  input: CmsPresentationFileInput;
  tags: string[];
  title: string;
};

export const CMS_CHAT_AVATAR_PRESENTATIONS = {
  pdf_s_5: {
    input: {
      filePath: PRESENTATION_PDF_5,
      title: 'AQA PDF 5 slides source',
    },
    tags: ['@fmt_pdf', '@slides_5'],
    title: 'PDF 5 slides',
  },
  pdf_s_10: {
    input: {
      filePath: PRESENTATION_PDF_10,
      title: 'AQA PDF 10 slides source',
    },
    tags: ['@fmt_pdf', '@slides_10'],
    title: 'PDF small 10 slides',
  },
  pdf_s_25: {
    input: {
      filePath: PRESENTATION_PDF_25,
      title: 'AQA PDF 25 slides source',
    },
    tags: ['@fmt_pdf', '@slides_25'],
    title: 'PDF 25 slides',
  },
  pdf_s_50: {
    input: {
      filePath: PRESENTATION_PDF_50,
      title: 'AQA PDF 50 slides source',
    },
    tags: ['@fmt_pdf', '@slides_50'],
    title: 'PDF 50 slides',
  },
  pdf_s_100: {
    input: {
      filePath: PRESENTATION_PDF_100,
      title: 'AQA PDF 100 slides source',
    },
    tags: ['@fmt_pdf', '@slides_100'],
    title: 'PDF 100 slides',
  },
  pdf_multilang_10: {
    input: {
      filePath: PRESENTATION_PDF_MULTILANG_10,
      title: 'AQA PDF multilang 10 slides source',
    },
    tags: ['@fmt_pdf', '@slides_10', '@lang_multi'],
    title: 'PDF multilang 10 slides',
  },
  pptx_s_2: {
    input: {
      filePath: PRESENTATION_PPTX_12,
      title: 'AQA PPTX 2 slides source',
    },
    tags: ['@fmt_pptx', '@slides_2'],
    title: 'PPTX 2 slides',
  },
  pptx_s_10: {
    input: {
      filePath: PRESENTATION_PPTX_10,
      title: 'AQA PPTX 10 slides source',
    },
    tags: ['@fmt_pptx', '@slides_10'],
    title: 'PPTX small 10 slides',
  },
  pptx_s_25: {
    input: {
      filePath: PRESENTATION_PPTX_25,
      title: 'AQA PPTX 25 slides source',
    },
    tags: ['@fmt_pptx', '@slides_25'],
    title: 'PPTX 25 slides',
  },
  pptx_s_50: {
    input: {
      filePath: PRESENTATION_PPTX_50,
      title: 'AQA PPTX 50 slides source',
    },
    tags: ['@fmt_pptx', '@slides_50'],
    title: 'PPTX 50 slides',
  },
  pptx_s_100: {
    input: {
      filePath: PRESENTATION_PPTX_100,
      title: 'AQA PPTX 100 slides source',
    },
    tags: ['@fmt_pptx', '@slides_100'],
    title: 'PPTX 100 slides',
  },
  pptx_business_12: {
    input: {
      filePath: PRESENTATION_PPTX_BUSINESS_12,
      title: 'AQA PPTX business 12 slides source',
    },
    tags: ['@fmt_pptx', '@slides_12', '@theme_business'],
    title: 'PPTX business 12 slides',
  },
  pptx_multilang_10: {
    input: {
      filePath: PRESENTATION_PPTX_MULTILANG_10,
      title: 'AQA PPTX multilang 10 slides source',
    },
    tags: ['@fmt_pptx', '@slides_10', '@lang_multi'],
    title: 'PPTX multilang 10 slides',
  },
} satisfies Record<string, CmsChatAvatarPresentationPreset>;

export type CmsChatAvatarPresentationName = keyof typeof CMS_CHAT_AVATAR_PRESENTATIONS;

export const CMS_CHAT_AVATAR_PRESENTATION_NAMES = Object.keys(
  CMS_CHAT_AVATAR_PRESENTATIONS,
) as CmsChatAvatarPresentationName[];

export type CmsChatAvatarPresentationDefinition = CmsChatAvatarPresentationPreset & {
  id: CmsChatAvatarPresentationName;
};

export const getCmsChatAvatarPresentationDefinition = (
  presentationName: CmsChatAvatarPresentationName,
): CmsChatAvatarPresentationDefinition => {
  const presentation = CMS_CHAT_AVATAR_PRESENTATIONS[presentationName];
  if (!presentation) {
    throw new Error(`Unknown CMS chat avatar presentation preset: ${presentationName}`);
  }

  return {
    id: presentationName,
    input: {
      ...presentation.input,
    },
    tags: [...presentation.tags],
    title: presentation.title,
  };
};
