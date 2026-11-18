/** The real ProcessApi: every program starts without a shell, so no argument is ever parsed as shell text. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawn = vi.fn(() => ({ on: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));

describe('nodeProcessApi.spawn', () => {
  beforeEach(() => spawn.mockClear());
  it('passes the arguments as an array with shell: false, whatever the caller asks', async () => {
    const { nodeProcessApi } = await import('../src/runner/process');
    nodeProcessApi.spawn('/usr/bin/g++', ['-o', "/o'; rm -rf x", 'a b.cpp'], { cwd: '/w', shell: true } as never);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { shell: unknown; windowsHide: unknown }];
    expect(command).toBe('/usr/bin/g++');
    expect(args).toEqual(['-o', "/o'; rm -rf x", 'a b.cpp']);
    expect(options.shell).toBe(false);
    expect(options.windowsHide).toBe(true);
  });
});
