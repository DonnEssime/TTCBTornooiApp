import { Command, CommandRunner } from './command';

export function commandToJsonLine(command: Command): string {
  return JSON.stringify(command);
}

export function exportCommandsAsJsonLines(commands: Command[]): string {
  return commands.map(commandToJsonLine).join('\n') + (commands.length > 0 ? '\n' : '');
}

export function commandFromJsonLine(line: string): Command | null {
  try {
    const parsed = JSON.parse(line) as Command;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.id || !parsed.type || !parsed.timestamp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseCommandLogLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export type ReplayResult = {
  success: boolean;
  results: Array<{ id: string; success: boolean; reason?: string }>;
};

export type ReplayProgress = { done: number; total: number };

export type ReplayAsyncOptions = {
  onProgress?: (progress: ReplayProgress) => void;
  /** Yield to the event loop every N commands (default 32). Use 0 to run without yielding. */
  yieldEvery?: number;
};

export function replayCommandsFromJsonLines(lines: string[], runner?: CommandRunner): ReplayResult {
  const commandRunner = runner ?? new CommandRunner();
  const results: Array<{ id: string; success: boolean; reason?: string }> = [];

  for (const line of lines) {
    const cmd = commandFromJsonLine(line);
    if (!cmd) {
      return { success: false, results: [{ id: 'unknown', success: false, reason: 'invalid command format' }] };
    }
    const result = commandRunner.execute(cmd);
    results.push({ id: cmd.id, ...result });
    if (!result.success) {
      return { success: false, results };
    }
  }

  return { success: true, results };
}

export async function replayCommandsFromJsonLinesAsync(
  lines: string[],
  runner?: CommandRunner,
  options: ReplayAsyncOptions = {},
): Promise<ReplayResult> {
  const commandRunner = runner ?? new CommandRunner();
  const results: ReplayResult['results'] = [];
  const total = lines.length;
  const yieldEvery = options.yieldEvery ?? 32;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const cmd = commandFromJsonLine(line);
    if (!cmd) {
      return { success: false, results: [{ id: 'unknown', success: false, reason: 'invalid command format' }] };
    }
    const result = commandRunner.execute(cmd);
    results.push({ id: cmd.id, ...result });
    if (!result.success) {
      return { success: false, results };
    }

    const done = i + 1;
    if (options.onProgress && (done === 1 || done === total || done % Math.max(1, yieldEvery) === 0)) {
      options.onProgress({ done, total });
    }
    if (yieldEvery > 0 && done < total && done % yieldEvery === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  if (options.onProgress && total > 0) {
    options.onProgress({ done: total, total });
  }

  return { success: true, results };
}
