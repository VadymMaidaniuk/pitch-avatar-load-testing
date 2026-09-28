import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures/test';
import { readWsLoadConfig } from '../helpers/wsLoadConfig';
import { prepareWsLoadSession } from '../helpers/wsLoadRunner';
import type { TextReply } from '../services/ws/AvatarTextSession';
import { appendPlainRequestCode } from '../helpers/wsLoadQuestions';

const config = readWsLoadConfig();
const prompts = config.questions.slice(0, 3);

test('[@api][@regression] WS avatar preflight', async ({}, testInfo) => {
  test.setTimeout(config.setupTimeoutMs + prompts.length * config.responseTimeoutMs + 10_000);
  const inspectedAtUtc = new Date().toISOString();
  const { metadata, connection } = await prepareWsLoadSession(config, 1);
  const replies: Array<{question: string; reply: TextReply}> = [];
  try {
    if (metadata.ready && connection) {
      for (const prompt of prompts) {
        const question = appendPlainRequestCode(prompt, `AHT${config.environment}${randomUUID().replace(/-/g, '')}`);
        const reply = await connection.ask(question, config.responseTimeoutMs);
        replies.push({ question, reply });
        if (reply.status !== 'ok') break;
      }
    }
  } finally {
    await connection?.close();
    const report = {
      inspectedAtUtc, environment: config.environment, target: config.chatUrl,
      purpose: 'Configuration, language and first three source questions; excluded from load timing comparison.',
      requireCacheDisabled: config.requireCacheDisabled,
      metadata, replies,
    };
    const file = testInfo.outputPath('preflight.json');
    await fs.mkdir(testInfo.outputDir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n');
    await testInfo.attach('preflight.json', {path:file,contentType:'application/json'});
    console.log(JSON.stringify(report, null, 2));
  }
  expect(metadata.ready, metadata.error ?? 'Session must be ready').toBe(true);
  expect(replies.filter(item => item.reply.status === 'ok')).toHaveLength(prompts.length);
});
