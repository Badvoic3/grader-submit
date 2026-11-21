import { beforeEach, describe, expect, it, vi } from 'vitest';

type U = { fsPath: string };
const v = vi.hoisted(() => ({
  folders: [] as { uri: { fsPath: string } }[],
  picked: undefined as { fsPath: string }[] | undefined,
  dialogs: [] as Record<string, unknown>[],
  config: {} as Record<string, unknown>,
}));

vi.mock('vscode', () => ({
  workspace: {
    get workspaceFolders() { return v.folders.length ? v.folders : undefined; },
    getWorkspaceFolder: (u: U) => v.folders.find((f) => u.fsPath.startsWith(`${f.uri.fsPath}/`)),
    getConfiguration: () => ({
      get: <T>(key: string, fallback: T) => (key in v.config ? v.config[key] : fallback) as T,
      inspect: () => undefined,
    }),
  },
  window: {
    showOpenDialog: async (o: Record<string, unknown>) => {
      v.dialogs.push(o);
      return v.picked;
    },
  },
}));

import { readConfig } from '../src/config';
import { Attachments } from '../src/flows/attachments';
import type { Host } from '../src/flows/host';

describe('cedtGrader.attachments.saveTo', () => {
  const uri = (fsPath: string) => ({ fsPath });
  let targetFolder: ReturnType<typeof vi.fn>;
  const make = (mode: string, fileUri: U | null) =>
    new Attachments({ cfg: { attachmentsSaveTo: mode }, fileUri, links: { targetFolder } } as unknown as Host);

  beforeEach(() => {
    v.folders = [];
    v.picked = undefined;
    v.dialogs = [];
    v.config = {};
    targetFolder = vi.fn(async () => uri('/beside'));
  });

  it('defaults to beside the active file, and reads only the three values', () => {
    expect(readConfig().attachmentsSaveTo).toBe('activeFileFolder');
    for (const mode of ['workspaceRoot', 'ask', 'activeFileFolder'] as const) {
      v.config = { 'attachments.saveTo': mode };
      expect(readConfig().attachmentsSaveTo).toBe(mode);
    }
    v.config = { 'attachments.saveTo': 'somewhere' };
    expect(readConfig().attachmentsSaveTo).toBe('activeFileFolder');
  });

  it('activeFileFolder uses the existing target folder (beside the file, else root, else a picker)', async () => {
    v.folders = [{ uri: uri('/ws') }];
    expect(await make('activeFileFolder', uri('/ws/a/x.cpp')).saveFolder()).toEqual(uri('/beside'));
    expect(targetFolder).toHaveBeenCalledOnce();
    expect(v.dialogs).toEqual([]);
  });

  it('workspaceRoot picks the root that holds the active file in a multi-root workspace', async () => {
    v.folders = [{ uri: uri('/one') }, { uri: uri('/two') }];
    expect(await make('workspaceRoot', uri('/two/sub/x.cpp')).saveFolder()).toEqual(uri('/two'));
    expect(await make('workspaceRoot', uri('/elsewhere/x.cpp')).saveFolder()).toEqual(uri('/one'));
    expect(await make('workspaceRoot', null).saveFolder()).toEqual(uri('/one'));
    expect(targetFolder).not.toHaveBeenCalled();
  });

  it('workspaceRoot with no workspace open falls back to the target folder', async () => {
    expect(await make('workspaceRoot', uri('/tmp/x.cpp')).saveFolder()).toEqual(uri('/beside'));
    expect(targetFolder).toHaveBeenCalledOnce();
  });

  it('ask shows a folder picker every time; cancelling saves nothing', async () => {
    v.folders = [{ uri: uri('/ws') }];
    v.picked = [uri('/chosen')];
    expect(await make('ask', uri('/ws/x.cpp')).saveFolder()).toEqual(uri('/chosen'));
    expect(v.dialogs[0]).toMatchObject({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, defaultUri: uri('/ws') });
    v.picked = undefined;
    expect(await make('ask', uri('/ws/x.cpp')).saveFolder()).toBeUndefined();
    expect(v.dialogs).toHaveLength(2);
    expect(targetFolder).not.toHaveBeenCalled();
  });
});
