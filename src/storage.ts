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

export function replayCommandsFromJsonLines(lines: string[], runner?: CommandRunner): { success: boolean; results: Array<{ id: string; success: boolean; reason?: string }> } {
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
