import { test, expect } from '../fixtures/test';
import { readWsLoadConfig } from '../helpers/wsLoadConfig';
import { runWsLoadScenario, writeWsLoadReport } from '../helpers/wsLoadRunner';

const config = readWsLoadConfig();

for (const scenario of config.scenarios) {
  test(`[@api][@regression] WS load ${scenario.name}`, async ({}, testInfo) => {
    test.setTimeout(Math.ceil(scenario.sessions / config.setupConcurrency) * config.setupAttempts * (config.setupTimeoutMs + config.setupAttempts * 500) + scenario.questions * config.responseTimeoutMs + 30_000);
    const report = await runWsLoadScenario(config, scenario, (event) => {
      if (event.phase === 'ready' ||
          (event.phase === 'preparing' && (event.prepared % 10 === 0 || event.error)) ||
          (event.phase === 'reply' && (event.status !== 'ok' || scenario.sessions === 1 || event.finishedReplies % 10 === 0))) {
        console.log(JSON.stringify({ environment: config.environment, scenario: scenario.name, ...event }));
      }
    });
    await writeWsLoadReport(report, testInfo.outputPath('metrics'));
    for (const [name, contentType] of [['results.json', 'application/json'], ['questions.csv', 'text/csv'], ['summary.md', 'text/markdown']]) {
      await testInfo.attach(name, { path: testInfo.outputPath('metrics', name), contentType });
    }
    const { byTurn, ...summary } = report.summary;
    console.log(JSON.stringify({ environment: config.environment, scenario: scenario.name, ...summary }, null, 2));
    expect(report.summary.cohortError, 'All independent sessions must be ready before load starts').toBeNull();
    expect(report.summary.successfulQuestions, 'Every planned question must receive complete WS text').toBe(report.summary.plannedQuestions);
  });
}
