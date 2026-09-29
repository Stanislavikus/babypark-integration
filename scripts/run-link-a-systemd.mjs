#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { D2bClient } from '../src/drupal-d2b/client.mjs';
import { loadSenderConfig } from '../src/drupal-d2b/config.mjs';
import {
  REHEARSAL_AUDIENCE,
  captureLinkAAuthorityEvidence,
  buildLinkASystemdRun,
  executeLinkASystemdUnit,
  lookupServiceIdentity,
  prepareLinkAWorkRoot,
  probeCatalogReadability,
  resolveLinkAReleasePaths,
  resourceEvidence,
  writePrivateJsonAtomic,
  validateRehearsalPath,
} from '../src/catalog/rehearsal/operations.mjs';

function exactArg(args, name) {
  const prefix = `--${name}=`;
  const values = args.filter(value => value.startsWith(prefix));
  if (values.length !== 1 || values[0].length === prefix.length) {
    throw new Error(`exact --${name}= argument is required`);
  }
  return values[0].slice(prefix.length);
}

try {
  if (process.env.BABYPARK_REHEARSAL !== '1') {
    throw new Error('BABYPARK_REHEARSAL must equal 1');
  }
  const args = process.argv.slice(2);
  const workRoot = exactArg(args, 'work-root');
  const stagedSpoolPath = exactArg(args, 'staged-spool');
  const catalogDir = exactArg(args, 'catalog-dir');
  const identityPath = exactArg(args, 'identity');
  const expectedGenerationId = exactArg(args, 'generation');
  const acceptedRun = {
    run_id: exactArg(args, 'run-id'),
    run_digest: exactArg(args, 'run-digest'),
    final_seq: Number(exactArg(args, 'final-seq')),
  };
  if (
    ![workRoot, stagedSpoolPath, catalogDir, identityPath].every(path.isAbsolute) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(expectedGenerationId) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(acceptedRun.run_id) ||
    !/^[a-f0-9]{64}$/.test(acceptedRun.run_digest) ||
    !Number.isSafeInteger(acceptedRun.final_seq) ||
    acceptedRun.final_seq < 1
  ) {
    throw new Error('invalid Link A resource-runner authority arguments');
  }

  validateRehearsalPath(stagedSpoolPath, 'staged-spool');
  validateRehearsalPath(catalogDir, 'catalog-dir');
  validateRehearsalPath(identityPath, 'identity');
  const release = resolveLinkAReleasePaths(import.meta.url);
  const serviceIdentity = lookupServiceIdentity('babypark-catalog');
  const canonicalWorkRoot = prepareLinkAWorkRoot(workRoot, {
    identity: serviceIdentity,
    protectedPaths: [stagedSpoolPath, catalogDir, identityPath, release.releaseRoot],
  });
  if (canonicalWorkRoot !== workRoot) {
    throw new Error('work root must be supplied in canonical form');
  }
  validateRehearsalPath(canonicalWorkRoot, 'work-root');

  const senderConfig = loadSenderConfig(process.env);
  validateRehearsalPath(senderConfig.stateDir, 'sender stateDir');
  if (
    senderConfig.audience !== REHEARSAL_AUDIENCE ||
    senderConfig.kid?.startsWith('rehearsal-') !== true ||
    senderConfig.origin !== 'http://127.0.0.1:18081'
  ) {
    throw new Error('resource runner requires exact loopback rehearsal Catalog authority');
  }
  const client = new D2bClient(senderConfig);
  const beforeAuthority = captureLinkAAuthorityEvidence({
    stagedSpoolPath,
    catalogDir,
    identityPath,
    generationId: expectedGenerationId,
  });
  const beforeProbe = await probeCatalogReadability({
    origin: senderConfig.origin,
    client,
    expectedGenerationId,
    acceptedRun,
  });

  const gatePath = path.join(workRoot, '.systemd-property-gate');
  if (fs.existsSync(gatePath)) throw new Error('gate already exists');
  const unit = `babypark-link-a-${Date.now().toString(16)}`;
  const built = buildLinkASystemdRun({
    unit,
    workRoot,
    gatePath,
    gateScript: release.gateScript,
    linkACli: release.linkACli,
    releaseRoot: release.releaseRoot,
    cliArgs: args,
    node: process.execPath,
  });

  const evidence = await executeLinkASystemdUnit({
    built,
    unit,
    gatePath,
    onCompleted: async show => {
      const reportPath = path.join(workRoot, 'link-a-report.json');
      const reportBytes = fs.readFileSync(reportPath);
      const report = JSON.parse(reportBytes.toString('utf8'));
      const afterAuthority = captureLinkAAuthorityEvidence({
        stagedSpoolPath,
        catalogDir,
        identityPath,
        generationId: expectedGenerationId,
      });
      const afterProbe = await probeCatalogReadability({
        origin: senderConfig.origin,
        client,
        expectedGenerationId,
        acceptedRun,
      });
      return resourceEvidence({
        unit,
        show,
        effectiveProperties: built.properties,
        linkAReport: report,
        linkAReportBytes: reportBytes,
        authorityBefore: beforeAuthority,
        authorityAfter: afterAuthority,
        probeBefore: beforeProbe,
        probeAfter: afterProbe,
        expectedGenerationId,
        acceptedRun,
      });
    },
  });

  writePrivateJsonAtomic(path.join(workRoot, 'link-a-resource-evidence.json'), evidence);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  process.exitCode = evidence.status === 'PASS' ? 0 : 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schema: 'bp.catalog.link-a-resource-evidence/1',
    version: 1,
    status: 'ERROR',
    error: error.message,
  })}\n`);
  process.exitCode = 2;
}