import type { LoadScenario, WsLoadConfig } from './wsLoadConfig';

export function appendPlainRequestCode(question: string, code: string): string {
  if (!/^[A-Za-z0-9]+$/.test(code)) throw new Error('Request code must contain only letters and digits.');
  return `${question}\nReference code ${code}`;
}

export function stripPlainRequestCode(question: string): string {
  return question.replace(/\nReference code [A-Za-z0-9]+$/, '');
}

/** Preserve the source question; only the plain alphanumeric request code varies. */
export function buildWsLoadQuestion(config: WsLoadConfig, scenario: LoadScenario, session: number, turn: number, runToken: string) {
  const localIndex = (session - 1) * scenario.questions + turn - 1;
  const offsets: Record<string, number> = {
    'chain-1x25': 0, 'parallel-10': 25,
    'parallel-20': 25 + 10 * scenario.questions, 'parallel-50': 25 + 30 * scenario.questions,
  };
  const caseIndex = (offsets[scenario.name] ?? 0) + localIndex;
  const sourceQuestionId = scenario.sessions > 1 && config.parallelQuestionIds
    ? config.parallelQuestionIds[turn - 1] : localIndex % config.questions.length + 1;
  if (!sourceQuestionId || !config.questions[sourceQuestionId - 1]) throw new Error('Missing source question for this turn.');
  const baseQuestion = config.questions[sourceQuestionId - 1];
  const questionId = `AHT${config.environment}${runToken.replace(/[^A-Za-z0-9]/g, '')}N${scenario.sessions}S${session}Q${turn}`;
  return { question: appendPlainRequestCode(baseQuestion, questionId), baseQuestion, sourceQuestionId, questionId, caseIndex, questionWithoutTag: baseQuestion };
}
