const { spawnSync } = require('node:child_process');

const platforms = ['MAC', 'LINUX', 'WINDOWS'];

function dispatchArguments(argv) {
  let selected;
  for (const argument of argv) {
    if (argument === '--dry-run') continue;
    if (!argument.startsWith('--platform=') || selected) throw new Error('Use --platform=MAC,LINUX,WINDOWS [--dry-run]');
    selected = argument.slice('--platform='.length).toUpperCase().split(',');
    if (selected.some(value => !platforms.includes(value))) throw new Error('Invalid platform. Use MAC, LINUX or WINDOWS.');
  }
  const args = ['workflow', 'run', 'build.yml', '-R', 'arara-ide/arara-code', '--ref', 'main'];
  if (selected) {
    for (const platform of platforms) args.push('-f', `${platform.toLowerCase()}=${selected.includes(platform)}`);
  }
  return args;
}

function main(argv, run = spawnSync) {
  const args = dispatchArguments(argv);
  if (argv.includes('--dry-run')) {
    process.stdout.write(`gh ${args.join(' ')}\n`);
    return 0;
  }
  const result = run('gh', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { dispatchArguments, main };
