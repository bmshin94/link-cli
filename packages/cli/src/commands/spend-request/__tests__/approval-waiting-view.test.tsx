import { render } from 'ink-testing-library';
import { expect, it } from 'vitest';
import { ApprovalWaitingView } from '../approval-waiting-view';

const APPROVAL_URL = 'https://app.link.com/approve/sr_test';

it('renders approval instructions once while the waiting status changes', () => {
  const view = render(
    <ApprovalWaitingView status="waiting" approvalUrl={APPROVAL_URL} />,
  );

  view.rerender(
    <ApprovalWaitingView status="polling" approvalUrl={APPROVAL_URL} />,
  );

  const frame = view.lastFrame();
  expect(frame?.match(/Approve at:/g)).toHaveLength(1);
  expect(frame?.match(/Get the Link app/g)).toHaveLength(1);
  expect(frame).toContain('Waiting for approval...');

  view.unmount();
});
