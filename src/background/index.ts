import { createService } from './service';
const service = createService(chrome.storage.local);
chrome.action.onClicked.addListener(tab => {
  if (tab.id !== undefined) {
    void chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_RESEARCH' }).catch(() => undefined);
  }
});
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  void service.handle(message, sender).then(respond, () => respond({ ok: false, error: { code: 'JEV_UNAVAILABLE', message: '設定またはJev判定を取得できませんでした。' } }));
  return true;
});
