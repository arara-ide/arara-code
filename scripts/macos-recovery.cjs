const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function recoveryRelease({ run, jobs, releases, comparison, repository }) {
  if (run.head_branch !== 'main' || run.head_repository?.full_name !== repository || run.path !== '.github/workflows/build.yml' || run.status !== 'completed' || !['push', 'workflow_dispatch'].includes(run.event) || !/^[a-f0-9]{40}$/.test(run.head_sha)) {
    throw new Error('Recovery requires a completed main Build from this repository');
  }
  if (!['ahead', 'identical'].includes(comparison.status)) throw new Error('Source build must be an ancestor of the recovery commit');
  for (const arch of ['x64', 'arm64']) {
    if (!jobs.some(job => job.name === `macos-${arch} / build` && job.conclusion === 'success')) throw new Error(`Missing successful macOS ${arch} build`);
  }
  const matches = releases.filter(release => release.target_commitish === run.head_sha);
  if (matches.length !== 1) throw new Error('Recovery requires exactly one existing release for the source commit');
  const release = matches[0];
  if (release.draft || release.immutable || !/^\d+\.\d+\.\d+$/.test(release.tag_name) || typeof release.prerelease !== 'boolean') throw new Error('Source release is not eligible for recovery');
  if (release.assets?.some(asset => asset.name === `AraraCode-darwin-universal-${release.tag_name}.dmg`)) throw new Error('Source release already contains the universal DMG');
  return { release: release.tag_name, sha: run.head_sha, prerelease: String(release.prerelease) };
}

function recover({ env = process.env, gh = args => execFileSync('gh', args, { encoding: 'utf8' }) } = {}) {
  const id = env.MACOS_SOURCE_RUN;
  const repository = env.GITHUB_REPOSITORY;
  if (env.GITHUB_REF !== 'refs/heads/main' || !/^[1-9]\d*$/.test(id || '') || !/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) throw new Error('Invalid macOS recovery request');
  const api = resource => JSON.parse(gh(['api', `repos/${repository}/${resource}`]));
  const pages = (resource, field) => {
    const result = [];
    for (let page = 1; ; page++) {
      const response = api(`${resource}?per_page=100&page=${page}`);
      const batch = field ? response[field] : response;
      result.push(...batch);
      if (batch.length < 100) return result;
    }
  };
  const run = api(`actions/runs/${id}`);
  if (!/^[a-f0-9]{40}$/.test(run.head_sha || '')) throw new Error('Invalid source commit');
  return recoveryRelease({ run, repository, jobs: pages(`actions/runs/${id}/jobs`, 'jobs'), releases: pages('releases'), comparison: api(`compare/${run.head_sha}...${env.GITHUB_SHA}`) });
}

module.exports = { recover, recoveryRelease };
if (require.main === module) {
  try {
    const result = recover();
    fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
