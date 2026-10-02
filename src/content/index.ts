import { observePosts } from './observer';
import { createResearchUi } from './research-ui';
observePosts();
let research: ReturnType<typeof createResearchUi> | undefined;
chrome.runtime.onMessage.addListener((message: unknown) => {
  if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'TOGGLE_RESEARCH') {
    research ??= createResearchUi();
    research.toggle();
  }
});
