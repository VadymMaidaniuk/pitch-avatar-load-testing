const { spawn } = require('node:child_process');
const path = require('node:path');

const args = process.argv.slice(2);

const readOptionValues = (longName, shortName) => {
  const values = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === longName || (shortName && arg === shortName)) {
      const nextValue = args[index + 1];
      if (nextValue) values.push(nextValue);
      continue;
    }

    if (arg.startsWith(`${longName}=`)) {
      values.push(arg.slice(longName.length + 1));
      continue;
    }

    if (shortName && arg.startsWith(`${shortName}=`)) {
      values.push(arg.slice(shortName.length + 1));
    }
  }

  return values;
};

const grepValues = readOptionValues('--grep', '-g');
const grepInvertValues = readOptionValues('--grep-invert');
const env = { ...process.env };

if (grepValues.length) {
  env.PW_TEST_CLI_GREP = JSON.stringify(grepValues);
}

if (grepInvertValues.length) {
  env.PW_TEST_CLI_GREP_INVERT = JSON.stringify(grepInvertValues);
}

const playwrightPackageJsonPath = require.resolve('playwright/package.json');
const playwrightCliPath = path.join(path.dirname(playwrightPackageJsonPath), 'cli.js');
const child = spawn(process.execPath, [playwrightCliPath, ...args], {
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
