const { execFileSync } = require('node:child_process');

const { removeGeneratedNativeProjects } = require('./reset-generated-native-projects');

const FORCE_ENV_NAME = 'VSAVE_FORCE_NATIVE_REGENERATE';

function listTrackedIosFiles(projectRoot = process.cwd()) {
  try {
    const output = execFileSync('git', ['ls-files', 'ios'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    return output
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildGuardDecision({
  trackedIosFiles = [],
  force = false,
} = {}) {
  if (force === true) {
    return {
      allowed: true,
      reason: 'force-enabled',
    };
  }

  if (trackedIosFiles.length > 0) {
    return {
      allowed: false,
      reason: 'tracked-ios-project',
      messageLines: [
        'Refusing to run destructive native regeneration from `npm run prebuild`.',
        'This repository tracks `mobile/ios`, including hand-written native code.',
        'Use `npm run ios` for normal device builds or `npm run ios:release` for a local Release build.',
        'If you intentionally need to regenerate native projects, run `npm run native:rebuild`.',
      ],
    };
  }

  return {
    allowed: true,
    reason: 'safe-to-reset',
  };
}

if (require.main === module) {
  const projectRoot = process.cwd();
  const lifecycleEvent = process.env.npm_lifecycle_event || 'this command';
  const decision = buildGuardDecision({
    trackedIosFiles: listTrackedIosFiles(projectRoot),
    force: process.env[FORCE_ENV_NAME] === '1',
  });

  if (!decision.allowed) {
    const messageLines = (decision.messageLines || []).map((line, index) => {
      if (index !== 0) {
        return line;
      }

      return `Refusing to run destructive native regeneration from \`npm run ${lifecycleEvent}\`.`;
    });

    for (const line of messageLines) {
      console.error(line);
    }
    process.exit(1);
  }

  const result = removeGeneratedNativeProjects(projectRoot);

  if (result.removed.length === 0) {
    console.log('No generated native folders to remove');
  } else {
    console.log(`Removed generated native folders: ${result.removed.join(', ')}`);
  }
}

module.exports = {
  FORCE_ENV_NAME,
  buildGuardDecision,
  listTrackedIosFiles,
};
