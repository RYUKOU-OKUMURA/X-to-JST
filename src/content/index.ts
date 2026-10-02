import { observePosts } from './observer';
import { createResearchUi } from './research-ui';
import { installInlineResearch } from './inline-research';
observePosts();
const inline = installInlineResearch();
let research: ReturnType<typeof createResearchUi> | undefined;
chrome.runtime.onMessage.addListener((message: unknown) => {
  if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'TOGGLE_RESEARCH') {
    if (inline.toggle()) return;
    research ??= createResearchUi();
    research.toggle();
  }
});
