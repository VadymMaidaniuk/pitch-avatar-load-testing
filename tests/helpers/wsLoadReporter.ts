import fs from 'node:fs/promises';
import path from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import type { WsLoadReport } from './wsLoadRunner';

/** Reads attachments after workers exit so failed scenarios / worker restarts retain their metrics. */
export default class WsLoadReporter implements Reporter {
  private readonly artifacts = new Map<string, { title: string; file: string }>();
  private expected: { id: string; title: string }[] = [];
  private didStart = false;

  constructor(private readonly options: { outputDir: string }) {}

  onBegin(_config: FullConfig, suite: Suite): void {
    this.expected = suite.allTests().map((test) => ({ id: test.id, title: test.title }));
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const file = result.attachments.find((attachment) => attachment.name === 'results.json')?.path;
    if (file) this.artifacts.set(test.id, { title: test.title, file });
  }

  onTestBegin(): void {
    this.didStart = true;
  }

  async onEnd(result: FullResult): Promise<void> {
    // --list invokes reporters too, but must not look like a completed load run.
    if (!this.didStart && result.status === 'passed') return;
    const reports: WsLoadReport[] = [];
    const missing: string[] = [];
    for (const test of this.expected) {
      const artifact = this.artifacts.get(test.id);
      if (!artifact) { missing.push(test.title); continue; }
      try { reports.push(JSON.parse(await fs.readFile(artifact.file, 'utf8')) as WsLoadReport); }
      catch { missing.push(test.title); }
    }
    const summary = {
      status: result.status,
      expectedScenarios: this.expected.length,
      recordedScenarios: reports.length,
      missingScenarioMetrics: missing,
      scenarios: reports.map(({ environment, scenario, startedAtUtc, target, settings, summary: metrics }) => ({
        environment, scenario, startedAtUtc, target, settings, metrics,
      })),
    };
    const ms = (value: number | null) => value === null ? 'n/a' : value.toFixed(1);
    const lines = [
      '# WebSocket text response load test',
      '',
      `Run status: **${result.status}**. Scenario reports: ${reports.length}/${this.expected.length}.`,
      '',
      '| Environment | Scenario | Ready sessions | Complete / planned | Failed | Skipped | Peak in flight | First text p50 / p95 ms | Full text p50 / p95 / max ms | First send spread ms |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...reports.map((report) => {
        const s = report.summary;
        return `| ${report.environment} | ${report.scenario.name} | ${s.readySessions}/${s.requestedSessions} | ${s.successfulQuestions}/${s.plannedQuestions} | ${s.failedQuestions} | ${s.skippedQuestions} | ${s.peakInFlight} | ${ms(s.firstText.p50Ms)} / ${ms(s.firstText.p95Ms)} | ${ms(s.fullText.p50Ms)} / ${ms(s.fullText.p95Ms)} / ${ms(s.fullText.maxMs)} | ${ms(s.firstWaveSendSpreadMs)} |`;
      }),
      '',
      'Response timing starts immediately before sending a question over WS. HTTP setup, startup greetings and media playback are outside the measurement.',
      'Percentiles use successful complete responses only (nearest rank). Inspect errors/skips alongside latency; low sample counts do not establish an SLA.',
      'Per-question JSON/CSV and scenario summaries are attached to each test in the HTML report.',
      ...reports.filter((report) => report.summary.cohortError).map((report) => `Cohort error (${report.scenario.name}): ${report.summary.cohortError}`),
      ...missing.map((title) => `Missing metrics: ${title}`),
      '',
    ];
    await fs.mkdir(this.options.outputDir, { recursive: true });
    await fs.writeFile(path.join(this.options.outputDir, 'run-summary.json'), JSON.stringify(summary, null, 2) + '\n');
    await fs.writeFile(path.join(this.options.outputDir, 'run-summary.md'), lines.join('\n'));
    console.log(`WS load summary: ${path.resolve(this.options.outputDir, 'run-summary.md')}`);
  }
}
