import { Box, Static, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { AppDownloadQrCodes } from './app-download-qr-codes';

interface ApprovalWaitingViewProps {
  status: 'waiting' | 'polling';
  approvalUrl: string;
}

export const ApprovalWaitingView: React.FC<ApprovalWaitingViewProps> = ({
  status,
  approvalUrl,
}) => (
  <>
    <Static items={[approvalUrl]}>
      {(url) => (
        <Box key={url} flexDirection="column" paddingY={1}>
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="cyan"
            paddingX={2}
            paddingY={1}
          >
            <Text>
              Approve at:{' '}
              <Text bold color="cyan">
                {url}
              </Text>
            </Text>
            <Text dimColor>Press Enter to open in browser</Text>
          </Box>
          <AppDownloadQrCodes />
        </Box>
      )}
    </Static>
    <Box marginTop={1}>
      {status === 'polling' ? (
        <Text color="cyan">
          <Spinner type="dots" /> Waiting for approval...
        </Text>
      ) : (
        <Text dimColor>Waiting...</Text>
      )}
    </Box>
  </>
);
