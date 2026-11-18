import * as vscode from 'vscode';
import { COMPARE_SCHEME } from '../shared/constants';

/** Compare tabs kept readable. Each holds two texts, so old ones are dropped. */
const KEEP = 20;

/** Read-only Expected and Actual documents for VS Code's diff editor, and single read-only texts. Nothing touches the disk. */
export class CompareDocs implements vscode.TextDocumentContentProvider {
  static readonly scheme = COMPARE_SCHEME;
  private readonly texts = new Map<string, string>();
  private next = 0;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.texts.get(uri.path) ?? '';
  }

  /** A new address each time: VS Code keeps a document by its address, and the texts may have changed. */
  async open(title: string, expected: string, actual: string, column: vscode.ViewColumn): Promise<void> {
    const id = ++this.next;
    const put = (name: string, text: string) => {
      const path = `/${id}/${name}.txt`;
      this.texts.set(path, text);
      return vscode.Uri.from({ scheme: COMPARE_SCHEME, path });
    };
    const left = put('expected', expected);
    const right = put('actual', actual);
    for (const path of [...this.texts.keys()].slice(0, -2 * KEEP)) this.texts.delete(path);
    await vscode.commands.executeCommand('vscode.diff', left, right, title, { viewColumn: column, preview: true });
  }

  /** One read-only text (the grader's compiler message); `name`'s extension picks the language. */
  async show(name: string, text: string, column: vscode.ViewColumn): Promise<void> {
    const path = `/${++this.next}/${name}`;
    this.texts.set(path, text);
    for (const old of [...this.texts.keys()].slice(0, -2 * KEEP)) this.texts.delete(old);
    await vscode.window.showTextDocument(vscode.Uri.from({ scheme: COMPARE_SCHEME, path }), { viewColumn: column, preview: true });
  }
}
