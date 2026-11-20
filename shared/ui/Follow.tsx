// The follow-the-creator prompt is gone from this edition. Days still call followPrompt.earn() at their own moments;
// it now does nothing.
export const followPrompt = { earn: (_why?: string) => {}, hide: () => {} };
export const useFollowPrompt = () => followPrompt;
export function FollowCard(_props: { dayNumber: number }) {
  return null;
}
