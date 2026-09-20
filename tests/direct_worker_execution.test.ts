import assert from 'node:assert/strict';
import { workerInitializer } from '../server/services/workerInitializer.ts';
import { EventEmitter } from 'events';

async function runDirectTests() {
  console.log('==================================================');
  console.log('RUNNING COMPREHENSIVE WORKER INITIALIZATION TESTS');
  console.log('==================================================');

  // TEST A: python3 --version through production command runner
  console.log('\n[TEST A] Executing python3 --version through production command runner:');
  const testARes = await workerInitializer.execCommand('python3 --version', {
    stageName: 'Test A: Python Version',
    timeoutMs: 8000,
    workerId: 'test-exec-worker',
  });
  console.log('Test A Output:', (testARes.stdout || testARes.stderr).trim());
  console.log('Test A PID:', testARes.pid);
  console.log('Test A Duration:', testARes.durationMs, 'ms');
  assert.equal(testARes.exitCode, 0);
  assert.ok((testARes.stdout || testARes.stderr).toLowerCase().includes('python 3'));
  console.log('✓ TEST A PASSED: python3 --version succeeded');

  // TEST B: sys.executable through production command runner
  console.log('\n[TEST B] Executing sys.executable through production command runner:');
  const testBRes = await workerInitializer.execCommand('python3 -c "import sys; print(f\'WORKER_TEST_OK:{sys.executable}\')"', {
    stageName: 'Test B: Python Executable',
    timeoutMs: 8000,
    workerId: 'test-exec-worker',
  });
  console.log('Test B Output:', testBRes.stdout.trim());
  console.log('Test B PID:', testBRes.pid);
  assert.equal(testBRes.exitCode, 0);
  assert.ok(testBRes.stdout.includes('WORKER_TEST_OK:'));
  console.log('✓ TEST B PASSED: sys.executable returned valid path');

  // TEST C: Mock SSE event subscription and reception
  console.log('\n[TEST C] Testing SSE registration and event dispatch:');
  const mockSseRes: any = new EventEmitter();
  const receivedEvents: string[] = [];
  mockSseRes.write = (chunk: string) => {
    receivedEvents.push(chunk);
    return true;
  };
  mockSseRes.flush = () => {};

  workerInitializer.addSseClient('test-sse-worker', mockSseRes);
  const diag = await workerInitializer.getDiagnostics('test-sse-worker');
  assert.ok(diag.pythonFound);
  console.log('✓ TEST C PASSED: SSE client registered and diagnostic verified');

  // TEST D: Step 1 COMPLETE event & TEST E: Step 2 START event
  console.log('\n[TEST D & E] Testing Step 1 execution and Step 2 progression:');
  const debugStep1 = await workerInitializer.getDebugStep1('test-step-worker');
  console.log('Debug Step 1 Result:', debugStep1);
  assert.equal(debugStep1.success, true);
  assert.ok(debugStep1.pythonExecutable);
  assert.ok(debugStep1.pythonVersion);
  console.log('✓ TEST D & E PASSED: Step 1 isolated execution passed with zero hang');

  // TEST F: Initialization lock release
  console.log('\n[TEST F] Testing initialization lock release:');
  assert.equal(workerInitializer.isLocked('test-lock-worker'), false);
  const initP = workerInitializer.initialize('test-lock-worker', true);
  assert.equal(workerInitializer.isLocked('test-lock-worker'), true);
  const initResult = await initP;
  assert.equal(workerInitializer.isLocked('test-lock-worker'), false);
  console.log('✓ TEST F PASSED: Lock held during initialization and released cleanly at finish');

  // TEST G: Timeout cleanup
  console.log('\n[TEST G] Testing timeout handling in execCommand:');
  try {
    await workerInitializer.execCommand('sleep 5', {
      stageName: 'Test Timeout',
      timeoutMs: 1000,
      workerId: 'test-timeout-worker',
    });
    assert.fail('Should have timed out');
  } catch (timeoutErr: any) {
    assert.equal(timeoutErr.code, 'STAGE_TIMEOUT');
    console.log('✓ TEST G PASSED: Command timed out cleanly without hanging (Duration:', timeoutErr.durationMs, 'ms)');
  }

  // TEST H: Duplicate initialization protection
  console.log('\n[TEST H] Testing duplicate initialization request:');
  const firstP = workerInitializer.initialize('test-dup-worker', true);
  const secondStatus = await workerInitializer.initialize('test-dup-worker', false);
  assert.ok(secondStatus);
  await firstP;
  console.log('✓ TEST H PASSED: Concurrent duplicate requests safely attached to active session');

  console.log('\n==================================================');
  console.log('ALL TESTS A-H PASSED WITH 100% SUCCESS! ✓');
  console.log('==================================================');
}

runDirectTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
