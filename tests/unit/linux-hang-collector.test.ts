import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import collectorHelpers from '../../field-tools/sartracker-linux-hang-collector-lib.cjs'

const temporaryDirectories: string[] = []

describe('Linux external hang collector [DON-247]', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('redacts credentials, private home identities, and URL authorities', () => {
    expect(
      collectorHelpers.sanitizeCollectorText(
        [
          '/home/eamonn/.config/sartracker-web',
          'Authorization: Bearer private-token',
          'Basic c2VjcmV0',
          'https://user:password@example.test/positions',
          '{"token":"private-token"}',
        ].join('\n'),
      ),
    ).toBe(
      [
        '/home/[redacted]/.config/sartracker-web',
        'Authorization: [redacted]',
        '[redacted]',
        'https://[redacted]@example.test/positions',
        '{"token":"[redacted]"}',
      ].join('\n'),
    )
  })

  it('builds a deterministic role-labelled process tree', () => {
    expect(
      collectorHelpers.buildProcessTree(
        [
          { pid: 103, ppid: 100, commandLine: '/app --type=gpu-process' },
          { pid: 100, ppid: 1, commandLine: '/app' },
          { pid: 102, ppid: 100, commandLine: '/app --type=renderer' },
          { pid: 104, ppid: 102, commandLine: '/app --type=utility' },
        ],
        100,
      ),
    ).toEqual({
      pid: 100,
      role: 'main',
      children: [
        {
          pid: 102,
          role: 'renderer',
          children: [{ pid: 104, role: 'utility', children: [] }],
        },
        { pid: 103, role: 'gpu', children: [] },
      ],
    })
  })

  it('collects bounded report-only evidence from a synthetic proc tree', () => {
    const root = createTemporaryDirectory()
    const procRoot = join(root, 'proc')
    const userData = join(root, 'user-data')
    const output = join(root, 'evidence')
    createSyntheticProcess(procRoot, 100, 1, 'sartracker-web', '/opt/sartracker-web', '101')
    createSyntheticProcess(
      procRoot,
      101,
      100,
      'sartracker-web',
      '/opt/sartracker-web --type=renderer',
      '',
    )
    mkdirSync(join(userData, 'logs'), { recursive: true })
    writeFileSync(
      join(userData, 'logs', 'runtime.log'),
      '{"event":"renderer_alive","token":"private-token","path":"/home/eamonn/private"}\n',
      'utf8',
    )
    writeFileSync(
      join(userData, 'storage-diagnostics.json'),
      '{"activeOperation":null,"databaseBytes":4096}\n',
      'utf8',
    )

    const result = spawnSync(
      process.execPath,
      [
        'field-tools/sartracker-linux-hang-collector.cjs',
        '--pid',
        '100',
        '--output',
        output,
        '--proc-root',
        procRoot,
        '--user-data',
        userData,
        '--samples',
        '1',
        '--interval-ms',
        '0',
        '--no-archive',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          SARTRACKER_COLLECTOR_ALLOW_NON_LINUX: '1',
        },
      },
    )

    if (result.status !== 0) {
      throw new Error(`Collector failed: ${result.stderr}\n${result.stdout}`)
    }
    const report = JSON.parse(readFileSync(join(output, 'collector-report.json'), 'utf8'))
    expect(report).toMatchObject({
      schemaVersion: 1,
      rootPid: 100,
      readOnly: true,
      processTree: {
        pid: 100,
        role: 'main',
        children: [{ pid: 101, role: 'renderer', children: [] }],
      },
      samples: [{ processes: expect.arrayContaining([
        expect.objectContaining({ pid: 100, role: 'main' }),
        expect.objectContaining({ pid: 101, role: 'renderer' }),
      ]) }],
    })
    const copiedLog = readFileSync(join(output, 'app-data', 'runtime.log'), 'utf8')
    expect(copiedLog).not.toContain('private-token')
    expect(copiedLog).not.toContain('/home/eamonn')
    expect(copiedLog).toContain('[redacted]')
  })
})

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sartracker-hang-collector-'))
  temporaryDirectories.push(directory)
  return directory
}

function createSyntheticProcess(
  procRoot: string,
  pid: number,
  ppid: number,
  comm: string,
  commandLine: string,
  children: string,
): void {
  const processDirectory = join(procRoot, String(pid))
  const taskDirectory = join(processDirectory, 'task', String(pid))
  mkdirSync(taskDirectory, { recursive: true })
  writeFileSync(
    join(processDirectory, 'status'),
    `Name:\t${comm}\nState:\tS (sleeping)\nPid:\t${pid}\nPPid:\t${ppid}\nVmRSS:\t1024 kB\nThreads:\t1\n`,
    'utf8',
  )
  writeFileSync(join(processDirectory, 'comm'), `${comm}\n`, 'utf8')
  writeFileSync(join(processDirectory, 'cmdline'), commandLine.replaceAll(' ', '\0'), 'utf8')
  writeFileSync(join(processDirectory, 'wchan'), 'ep_poll\n', 'utf8')
  writeFileSync(join(processDirectory, 'io'), 'read_bytes: 4096\nwrite_bytes: 2048\n', 'utf8')
  writeFileSync(join(processDirectory, 'schedstat'), '1 2 3\n', 'utf8')
  writeFileSync(join(taskDirectory, 'children'), children, 'utf8')
  writeFileSync(join(taskDirectory, 'comm'), `${comm}\n`, 'utf8')
  writeFileSync(join(taskDirectory, 'wchan'), 'ep_poll\n', 'utf8')
  writeFileSync(join(taskDirectory, 'stat'), `${pid} (${comm}) S ${ppid} 0 0 0\n`, 'utf8')
  chmodSync(processDirectory, 0o755)
}
