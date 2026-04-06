/**
 * Connection test for the KMRT SAR Traccar server.
 *
 * Checks connectivity to kmrtsar.ddns.net on:
 *   - Port 5055 (OsmAnd protocol — position ingestion)
 *   - Port 8082 (Traccar web/API interface)
 *
 * If port 8082 is reachable, attempts GET /api/server (public endpoint).
 *
 * Usage: npx tsx src/connection-test.ts
 */

import { createConnection } from 'net';

const HOST = 'kmrtsar.ddns.net';
const PORTS = [5055, 8082];
const TCP_TIMEOUT_MS = 5_000;

interface PortResult {
  port: number;
  open: boolean;
  latencyMs: number;
  error?: string;
}

function checkPort(host: string, port: number, timeoutMs: number): Promise<PortResult> {
  return new Promise(resolve => {
    const start = Date.now();
    const socket = createConnection({ host, port });

    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ port, open: false, latencyMs: timeoutMs, error: 'timeout' });
    }, timeoutMs);

    socket.on('connect', () => {
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      socket.destroy();
      resolve({ port, open: true, latencyMs });
    });

    socket.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      resolve({ port, open: false, latencyMs, error: err.code ?? err.message });
    });
  });
}

async function checkApiServer(host: string, port: number): Promise<void> {
  console.log(`\n--- Attempting GET /api/server on ${host}:${port} ---`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TCP_TIMEOUT_MS);
    const res = await fetch(`http://${host}:${port}/api/server`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    console.log(`  Status: ${res.status} ${res.statusText}`);

    if (res.ok) {
      const data = await res.json();
      console.log(`  Server version: ${(data as { version?: string }).version ?? 'unknown'}`);
      console.log(`  Registration open: ${(data as { registration?: boolean }).registration ?? 'unknown'}`);
      console.log(`  Full response:`, JSON.stringify(data, null, 2));
    } else if (res.status === 401) {
      console.log('  Auth required for this endpoint on this server.');
    } else {
      const body = await res.text();
      console.log(`  Response body: ${body.slice(0, 500)}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  Failed: ${message}`);
  }
}

async function checkApiSession(host: string, port: number): Promise<void> {
  console.log(`\n--- Checking if /api/session endpoint exists ---`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TCP_TIMEOUT_MS);
    // A GET to /api/session without a valid session should return 401
    const res = await fetch(`http://${host}:${port}/api/session`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    console.log(`  GET /api/session status: ${res.status} ${res.statusText}`);
    if (res.status === 401) {
      console.log('  Session auth available (401 = endpoint exists, needs credentials).');
    } else if (res.ok) {
      console.log('  Session endpoint returned OK (might be already authenticated or public).');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  Failed: ${message}`);
  }
}

async function main() {
  console.log(`=== Traccar Connection Test ===`);
  console.log(`Host: ${HOST}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  // DNS resolution check
  console.log('--- DNS Resolution ---');
  try {
    const { resolve4 } = await import('dns/promises');
    const addresses = await resolve4(HOST);
    console.log(`  Resolved to: ${addresses.join(', ')}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  DNS resolution failed: ${message}`);
    console.log('  Cannot proceed without DNS resolution.');
    process.exit(1);
  }

  // Port checks
  console.log('\n--- Port Connectivity ---');
  const results: PortResult[] = [];
  for (const port of PORTS) {
    const result = await checkPort(HOST, port, TCP_TIMEOUT_MS);
    results.push(result);
    const status = result.open ? 'OPEN' : `CLOSED (${result.error})`;
    console.log(`  Port ${port}: ${status} (${result.latencyMs}ms)`);
  }

  // API checks if port 8082 is open
  const apiPort = results.find(r => r.port === 8082);
  if (apiPort?.open) {
    await checkApiServer(HOST, 8082);
    await checkApiSession(HOST, 8082);
  } else {
    console.log('\nPort 8082 not reachable — skipping API checks.');
    console.log('The Traccar API may be on a different port or behind a reverse proxy.');
  }

  // Summary
  console.log('\n=== Summary ===');
  for (const r of results) {
    console.log(`  ${r.port}: ${r.open ? 'REACHABLE' : 'UNREACHABLE'}`);
  }

  const anyOpen = results.some(r => r.open);
  if (!anyOpen) {
    console.log('\n  No ports reachable. The server may be:');
    console.log('    - Behind a firewall');
    console.log('    - Using different ports');
    console.log('    - Currently offline');
    console.log('    - Requiring VPN access');
  }
}

main().catch(console.error);
