import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildVersionedFormattedName } from '../../shared/fileNames.js';

const execFileAsync = promisify(execFile);

export type FormatterToolInput = {
  fileName: string;
  inputBuffer: Buffer;
  rootDir: string;
};

export type FormatterToolResult = {
  fileName: string;
  outputBuffer: Buffer;
};

export async function runFormatterTool({
  fileName,
  inputBuffer,
  rootDir,
}: FormatterToolInput): Promise<FormatterToolResult> {
  let tempDir = '';
  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qle-format-'));
    const safeName = path.basename(fileName).replace(/[^\w.\- ]+/g, '_');
    const inputPath = path.join(tempDir, safeName || 'input.xlsx');
    const outputName = buildVersionedFormattedName(safeName || 'input.xlsx', 1);
    const outputPath = path.join(tempDir, outputName);

    await fs.writeFile(inputPath, inputBuffer);
    await execFileAsync(
      process.execPath,
      [path.join(rootDir, 'scripts', 'qle-formatter.js'), '--input', inputPath, '--output', outputPath],
      {
        cwd: rootDir,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    return {
      fileName: outputName,
      outputBuffer: await fs.readFile(outputPath),
    };
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
