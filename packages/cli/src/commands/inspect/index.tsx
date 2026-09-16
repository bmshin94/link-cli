import { Cli, z } from 'incur';
import React from 'react';
import { renderInteractive } from '../../utils/render-interactive';
import type { Directory } from './directory';
import { runInspect } from './inspect';
import { InspectView } from './inspect-view';
import { inspectOptions } from './schema';

export function createInspectCli() {
  const cli = Cli.create('inspect', {
    description:
      'Inspect a URL and return a Directory listing of available agent tools (machine payments, MCP, provisioning, browser checkout)',
    args: z.object({
      url: z.string().describe('URL to inspect'),
    }),
    options: inspectOptions,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const { url } = c.args;
      const timeoutMs = c.options.timeout;

      if (!c.agent && !c.formatExplicit) {
        let capturedResult: Directory | null = null;
        return renderInteractive(
          <InspectView
            url={url}
            timeoutMs={timeoutMs}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => {
            if (!capturedResult)
              throw new Error('Component exited without producing a result');
            return capturedResult;
          },
        );
      }

      return runInspect(url, { timeoutMs });
    },
  });

  return cli;
}
