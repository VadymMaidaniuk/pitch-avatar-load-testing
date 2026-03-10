export type CmsAvatarLoggedStep = {
  ts: number;
  message: string;
  context?: Record<string, unknown>;
};

export type CmsAvatarTimingSummary = {
  sourcePresentationId?: string;
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
  const parsingCompletedStep = sourcePresentationId
    ? steps.find(
        (step) =>
          step.message === 'Presentation parsing completed' &&
          stringValue(step.context?.presentationId) === sourcePresentationId,
      )
    : undefined;

  return {
    sourcePresentationId,
    sourcePresentationParsingMs:
      uploadStep && parsingCompletedStep ? parsingCompletedStep.ts - uploadStep.ts : null,
    totalCreationMs: finishedAt - startedAt,
  };
};
