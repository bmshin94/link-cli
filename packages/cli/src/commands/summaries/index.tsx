import type { ISummariesResource } from '@stripe/link-sdk';
import { Cli } from 'incur';
import type { CliAuthStorage } from '../../auth/storage';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { listAllSummaries, SummariesList } from './list';
import { listOptions } from './schema';

export function createSummariesCli(
  createResource: () => ISummariesResource,
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('summaries', {
    description: 'Summaries and aggregations of financial data from Link',
  });
  cli.command('list', {
    description:
      'List summaries of financial data from Link to answer common financial questions or provide preferences based on past purchase history',
    options: listOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const resource = createResource();
      const summaries = c.options.summary;
      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <SummariesList
            resource={resource}
            summaries={summaries}
            onComplete={() => {}}
          />,
          () => listAllSummaries(resource, summaries),
        );
      }
      return listAllSummaries(resource, summaries);
    },
  });
  return cli;
}
