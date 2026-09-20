import assert from 'node:assert/strict';
import { workerInitializer } from '../server/services/workerInitializer.ts';
import { workerBridge } from '../server/services/workerBridge.ts';
import { jobStore } from '../server/services/jobStore.ts';
import fs from 'fs';
import path from 'path';

async function runTests() {
  console.log('--- Starting Worker Initialization & Architecture Tests ---');

  // Test 1: Initial state is unknown or retrieved from manifest
  console.log('Test 1: Initial state retrieval');
  const initialStatus = workerInitializer.getStatus();
  assert.ok(initialStatus);
  assert.ok(['unknown', 'checking', 'installing', 'ready', 'failed'].includes(initialStatus.state));
  console.log('✓ Test 1 passed: Initial state is valid:', initialStatus.state);

  // Test 2: Initialization Lock prevents duplicate concurrent runs
  console.log('Test 2: Initialization lock');
  assert.equal(workerInitializer.isLocked('test-worker-1'), false);
  // Start initialization
  const initPromise = workerInitializer.initialize('test-worker-1');
  assert.equal(workerInitializer.isLocked('test-worker-1'), true);

  // Attempting concurrent initialization should return the active state without crashing or spawning duplicate
  const concurrentStatus = await workerInitializer.initialize('test-worker-1');
  assert.ok(concurrentStatus);
  console.log('✓ Test 2 passed: Concurrent initialization protected by lock');

  // Wait for first to complete
  const completedStatus = await initPromise;
  assert.equal(workerInitializer.isLocked('test-worker-1'), false);
  assert.ok(completedStatus.state === 'ready' || completedStatus.state === 'failed');
  console.log('✓ Test 3 passed: Initialization completed with state:', completedStatus.state);

  // Test 4: Manifest persistence
  console.log('Test 4: Manifest file persistence');
  const manifestPath = path.join(process.cwd(), 'workspace', '.worker_init_manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'Manifest file must exist in workspace');
  const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  assert.equal(manifestContent.workerId, 'test-worker-1');
  assert.ok(manifestContent.capabilities);
  console.log('✓ Test 4 passed: Manifest successfully persisted with capabilities');

  // Test 5: Already initialized worker skip/quick return
  console.log('Test 5: Already initialized worker fast path');
  const fastPathStatus = await workerInitializer.initialize('test-worker-1');
  assert.equal(fastPathStatus.state, 'ready');
  assert.equal(fastPathStatus.progress, 100);
  console.log('✓ Test 5 passed: Already initialized returns immediately');

  // Test 6: Safe retry resets state and clears error
  console.log('Test 6: Safe retry mechanism');
  const retriedStatus = await workerInitializer.retryInitialization('test-worker-1');
  assert.ok(retriedStatus);
  assert.equal(retriedStatus.error, null);
  console.log('✓ Test 6 passed: Retry clears error and re-runs');

  // Test 7: Secret sanitization in logs
  console.log('Test 7: Secret sanitization');
  const logs = workerInitializer.getLogs();
  assert.ok(Array.isArray(logs));
  for (const log of logs) {
    assert.ok(!log.message.includes('AIzaSy'), 'No Gemini API keys in logs');
    assert.ok(!log.message.includes('gsk_'), 'No Groq API keys in logs');
    assert.ok(!log.message.includes('recap-kaggle-token-2026'), 'No worker tokens in logs');
  }
  console.log('✓ Test 7 passed: Logs contain no secrets');

  // Test 8: Worker Registration & Capabilities in WorkerBridge
  console.log('Test 8: Worker Registration and Capabilities');
  const regResult = workerBridge.registerWorker({
    workerId: 'test-kaggle-gpu-1',
    name: 'Kaggle GPU Worker Tesla T4',
    status: 'ready',
    gpuName: 'Tesla T4',
    vramTotalGb: 15.8,
    vramUsedGb: 1.4,
    hostname: 'kaggle-node-7',
    capabilities: {
      whisper: true,
      edgeTts: true,
      voxcpm2: true,
      ffmpeg: true,
      nvenc: true,
    },
  });
  assert.equal(regResult.success, true);
  const bridgeStatus = workerBridge.getStatus('test-kaggle-gpu-1');
  assert.equal(bridgeStatus.isOnline, true);
  assert.equal(bridgeStatus.gpuName, 'Tesla T4');
  assert.equal(bridgeStatus.capabilities?.voxcpm2, true);
  assert.equal(bridgeStatus.capabilities?.nvenc, true);
  console.log('✓ Test 8 passed: WorkerBridge registered capabilities and online state');

  // Test 9: Heartbeat updating worker status
  console.log('Test 9: Heartbeat handling');
  const hbRes = workerBridge.recordHeartbeat({
    workerId: 'test-kaggle-gpu-1',
    gpuName: 'Tesla T4',
    vramTotalGb: 15.8,
    vramUsedGb: 2.1,
    activeJobId: undefined,
    hostname: 'kaggle-node-7',
  });
  assert.equal(hbRes.success, true);
  console.log('✓ Test 9 passed: Heartbeat recorded successfully');

  // Test 10: Existing job queue still functions perfectly
  console.log('Test 10: Existing Job Queue integrity');
  const testJob = jobStore.createJob({
    sourceType: 'url',
    sourceUrl: 'https://example.com/test-movie.mp4',
    customTitle: 'Verification Test Recap',
    audioMode: 'recap',
    targetLanguage: 'English',
    selectedTtsEngine: 'edge-tts',
  });
  assert.ok(testJob.id);
  assert.equal(testJob.status, 'queued');
  assert.equal(testJob.title, 'Verification Test Recap');

  // Polling by registered worker
  const claimed = workerBridge.claimNextJob('test-kaggle-gpu-1');
  assert.ok(claimed);
  assert.equal(claimed.id, testJob.id);
  console.log('✓ Test 10 passed: Worker successfully claimed queued job');

  // Cleanup test job
  jobStore.cancelJob(testJob.id);

  console.log('\n==================================================');
  console.log('ALL 10 VERIFICATION TESTS PASSED SUCCESSFULLY! ✓');
  console.log('==================================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
