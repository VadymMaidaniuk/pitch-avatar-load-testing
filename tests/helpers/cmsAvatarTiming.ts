export type CmsAvatarLoggedStep = {
  ts: number;
  message: string;
  context?: Record<string, unknown>;
};

export type CmsAvatarTimingSummary = {
  sourcePresentationId?: string;
  sourcePresentationUploadMs: number | null;
  sourcePresentationParsingMs: number | null;
  totalCreationMs: number;
};

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

export const summarizeCmsAvatarTimings = (
  steps: CmsAvatarLoggedStep[],
  startedAt: number,
  finishedAt: number,
): CmsAvatarTimingSummary => {
  const uploadStep = steps.find(
    (step) =>
      step.message === 'Uploading source presentation file' &&
      stringValue(step.context?.sourcePresentationId),
  );
  const sourcePresentationId = stringValue(uploadStep?.context?.sourcePresentationId);
  const uploadCompletedStep = sourcePresentationId
    ? steps.find(
        (step) =>
          step.message === 'Source presentation file uploaded' &&
          stringValue(step.context?.sourcePresentationId) === sourcePresentationId,
      )
    : undefined;
  const parsingCompletedStep = sourcePresentationId
    ? steps.find(
        (step) =>
          step.message === 'Presentation parsing completed' &&
          stringValue(step.context?.presentationId) === sourcePresentationId,
      )
    : undefined;

  return {
    sourcePresentationId,
    sourcePresentationUploadMs:
      uploadStep && uploadCompletedStep ? uploadCompletedStep.ts - uploadStep.ts : null,
    sourcePresentationParsingMs:
      uploadCompletedStep && parsingCompletedStep
        ? parsingCompletedStep.ts - uploadCompletedStep.ts
        : null,
    totalCreationMs: finishedAt - startedAt,
  };
};
