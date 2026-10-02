import { isRecord } from '../types/messages';
const input = document.querySelector<HTMLInputElement>('#api-key')!;
const status = document.querySelector<HTMLElement>('#status')!;
const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')];
async function run(message: unknown, success?: string) {
  buttons.forEach(button => { button.disabled = true; });
  try {
    const reply: unknown = await chrome.runtime.sendMessage(message);
    if (!isRecord(reply) || reply.ok !== true) throw new Error('STORAGE_ERROR');
    input.value = '';
    status.textContent = success ?? (reply.configured ? 'APIキーを保存済みです。' : 'APIキーは未設定です。');
  } catch { status.textContent = '設定を保存・取得できませんでした。もう一度お試しください。'; }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}
document.querySelector('#key-form')!.addEventListener('submit', event => {
  event.preventDefault();
  void run({ type: 'SAVE_API_KEY', key: input.value.trim() }, 'APIキーを保存しました。');
});
document.querySelector('#delete')!.addEventListener('click', () => { void run({ type: 'DELETE_API_KEY' }, 'APIキーを削除しました。'); });
void run({ type: 'GET_KEY_STATUS' });
