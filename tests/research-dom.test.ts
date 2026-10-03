// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResearchUi } from '../src/content/research-ui';
import { collectResearchPosts, researchSource } from '../src/content/research-collector';
import { makePost, type ResearchPost } from '../src/core/research';
const cleanups: (()=>void)[] = [];
const flush = () => new Promise(resolve => setTimeout(resolve, 10));
function article(id = '1', text = 'AIで議事録を作る手順') {
  const node = document.createElement('article'); node.dataset.testid = 'tweet';
  const body = document.createElement('p'); body.dataset.testid = 'tweetText'; body.textContent = text; body.lang = 'ja';
  const link = document.createElement('a'); link.href = `https://x.com/author/status/${id}`;
  const time = document.createElement('time'); time.dateTime = '2026-10-02T00:00:00Z'; link.append(time); node.append(body,link); document.body.append(node); return node;
}
function post(id='1',text='議事録の自動化') { return makePost({text,url:`https://x.com/author/status/${id}`},'timeline')!; }
function find(root:ParentNode,text:string) { const button = [...root.querySelectorAll('button')].find(node=>node.textContent===text); if(!button) throw new Error(text); return button; }
afterEach(()=>{ cleanups.splice(0).forEach(fn=>fn()); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('research workflow',()=>{
  it('matches case and whitespace variants in saved posts and notes without matching across fields', async () => {
    const posts = [post('1', 'GPT-6.1とGoogle Workspaceの使い方'), { ...post('2', 'メモだけに関連語'), note: 'googleworkspace' }, { ...post('3', 'Google'), note: 'Workspace' }];
    const send = vi.fn(async (_message: unknown) => ({ ok: true, posts })); const ui = createResearchUi(send); cleanups.push(ui.dispose); ui.open(); await flush();
    const shadow = ui.host.shadowRoot!; const input = shadow.querySelector<HTMLInputElement>('input[type=text]')!;
    for (const keyword of ['Google Workspace', 'googleworkspace', 'Ｇｏｏｇｌｅ　Ｗｏｒｋｓｐａｃｅ']) {
      input.value = keyword; find(shadow, '文字で探す').click();
      expect([...shadow.querySelectorAll('[data-post-id]')].map(post => (post as HTMLElement).dataset.postId)).toEqual(['1', '2']);
    }
    input.value = 'gpt-6.1'; find(shadow, '文字で探す').click(); expect(shadow.querySelectorAll('[data-post-id]')).toHaveLength(1);
    input.value = 'gpt-6.2'; find(shadow, '文字で探す').click(); expect(shadow.querySelectorAll('[data-post-id]')).toHaveLength(0);
    expect(send.mock.calls.every(call => (call[0] as { type: string }).type === 'RESEARCH_LIST')).toBe(true);
  });
  it('passes canonical product names to saved-post judging', async () => {
    const send = vi.fn(async (message: unknown) => (message as { type: string }).type === 'RESEARCH_JUDGE'
      ? { ok: true, results: [{ id: '1', score: 1, confidence: 1 }] } : { ok: true, posts: [post()] });
    const ui = createResearchUi(send); cleanups.push(ui.dispose); ui.open(); await flush(); const shadow = ui.host.shadowRoot!;
    shadow.querySelector<HTMLInputElement>('input[type=text]')!.value = 'googleworkspace gpt-6.1'; find(shadow, 'Jevで探す').click(); await flush();
    const request = send.mock.calls.map(call => call[0] as { type: string; payload?: { query: string } }).find(message => message.type === 'RESEARCH_JUDGE');
    expect(request!.payload!.query).toBe('Google Workspace GPT-6.1');
  });
  it('collects text without clocks only on explicit start, skips ambiguous quotes and stops on dispose',async()=>{
    article(); const unknown=article('2'); const extra=document.createElement('p'); extra.dataset.testid='tweetText'; extra.textContent='quote'; unknown.append(extra);
    const callback=vi.fn(); const stop=collectResearchPosts(document.body,callback); cleanups.push(stop);
    expect(callback.mock.calls[0]![0]).toHaveLength(1); expect(callback.mock.calls[0]![1]).toBe(1);
    article('3'); await flush(); expect(callback.mock.calls.at(-1)![0]).toHaveLength(2);
    stop(); callback.mockClear(); article('4'); await flush(); expect(callback).not.toHaveBeenCalled();
  });
  it('recognizes the current history bookmark tab',()=>{
    const tab=document.createElement('button');tab.setAttribute('role','tab');tab.setAttribute('aria-selected','true');tab.textContent='ブックマーク';document.body.append(tab);
    expect(researchSource('/i/history')).toBe('bookmarks'); tab.textContent='いいね'; expect(researchSource('/i/history')).toBe('other');
  });
  it('stops collection when the selected history source changes at the same URL',async()=>{
    vi.stubGlobal('location',{pathname:'/i/history',href:'https://x.com/i/history'});const tab=document.createElement('button');tab.setAttribute('role','tab');tab.setAttribute('aria-selected','true');tab.textContent='ブックマーク';document.body.append(tab);article();
    const callback=vi.fn();const stop=collectResearchPosts(document.body,callback);cleanups.push(stop);tab.textContent='いいね';await flush();
    expect(callback.mock.calls.at(-1)![2]).toContain('ページが変わった');callback.mockClear();article('2');await flush();expect(callback).not.toHaveBeenCalled();
  });
  it('stops collection when a card switches to related posts',async()=>{
    article();const send=vi.fn(async()=>({ok:true,posts:[]}));const ui=createResearchUi(send);cleanups.push(ui.dispose);ui.open();await flush();const root=ui.host.shadowRoot!;
    find(root,'拾う').click();find(root,'収集を開始').click();find(root,'これとつなげる').click();await flush();article('2');await flush();find(root,'拾う').click();
    expect(root.querySelectorAll('article')).toHaveLength(1);expect(find(root,'収集を停止').disabled).toBe(true);
  });
  it('disables the stop control when a source change ends collection',async()=>{
    vi.stubGlobal('location',{pathname:'/i/history',href:'https://x.com/i/history'});const tab=document.createElement('button');tab.setAttribute('role','tab');tab.setAttribute('aria-selected','true');tab.textContent='ブックマーク';document.body.append(tab);article();
    const ui=createResearchUi(async()=>({ok:true,posts:[]}));cleanups.push(ui.dispose);ui.open();await flush();const root=ui.host.shadowRoot!;find(root,'拾う').click();find(root,'収集を開始').click();
    expect(find(root,'収集を停止').disabled).toBe(false);tab.textContent='いいね';await flush();
    expect(root.textContent).toContain('ページが変わった');expect(find(root,'収集を停止').disabled).toBe(true);expect(find(root,'収集を開始').disabled).toBe(false);
  });
  it('reuses all batches for the same purpose and invalidates them when the purpose changes',async()=>{
    const posts=Array.from({length:21},(_,i)=>post(String(i+1)));const send=vi.fn(async(message:unknown)=>{const value=message as {type:string;payload?:{posts:ResearchPost[]}};return value.type==='RESEARCH_JUDGE'?{ok:true,results:value.payload!.posts.map(p=>({id:p.id,score:1,confidence:1})),usage:{input_tokens:20,output_tokens:5}}:{ok:true,posts};});
    const ui=createResearchUi(send);cleanups.push(ui.dispose);ui.open();await flush();const root=ui.host.shadowRoot!;const input=root.querySelector<HTMLInputElement>('input[type=text]')!;input.value='自動化';find(root,'Jevで探す').click();await flush();
    expect(send.mock.calls.filter(c=>(c[0] as {type:string}).type==='RESEARCH_JUDGE')).toHaveLength(2);find(root,'Jevで探す').click();await flush();expect(send.mock.calls.filter(c=>(c[0] as {type:string}).type==='RESEARCH_JUDGE')).toHaveLength(2);expect(root.querySelector('#status')!.textContent).toContain('入力0 / 出力0');
    input.value='Google Workspace';input.dispatchEvent(new Event('input'));find(root,'Jevで探す').click();await flush();expect(send.mock.calls.filter(c=>(c[0] as {type:string}).type==='RESEARCH_JUDGE')).toHaveLength(4);
  });
  it('does not redraw collection results for unrelated X updates or panel changes',async()=>{
    article();const callback=vi.fn();const stop=collectResearchPosts(document.body,callback);cleanups.push(stop);
    const host=document.createElement('div');host.attachShadow({mode:'open'});document.body.append(host);await flush();
    host.shadowRoot!.append(document.createElement('p'));article('1');await flush();
    expect(callback).toHaveBeenCalledTimes(1);
  });
  it('does no API or collection on opening, preserves focus and collects non-time posts after click',async()=>{
    const focus=document.createElement('button');document.body.append(focus);focus.focus();article();
    const send=vi.fn(async()=>({ok:true,posts:[]})); const ui=createResearchUi(send);cleanups.push(ui.dispose);ui.open();await flush();
    expect(send.mock.calls).toHaveLength(1);expect(send).toHaveBeenCalledWith({type:'RESEARCH_LIST'});
    const root=ui.host.shadowRoot!;find(root,'拾う').click();find(root,'収集を開始').click();await flush();
    expect(root.querySelectorAll('article')).toHaveLength(1);expect(root.textContent).toContain('AIで議事録');expect(send.mock.calls).toHaveLength(1);
    ui.close();expect(ui.host.hidden).toBe(true);expect(document.activeElement).toBe(focus);
  });
  it('saves only selected posts and retrieves them through a recreated panel',async()=>{
    article('1');article('2','音声入力の比較');let saved:ResearchPost[]=[];
    const send=vi.fn(async(message:unknown)=>{const value=message as {type:string;post?:ResearchPost};if(value.type==='RESEARCH_SAVE')saved.push(value.post!);return {ok:true,posts:saved};});
    const ui=createResearchUi(send);cleanups.push(ui.dispose);ui.open();await flush();const root=ui.host.shadowRoot!;
    find(root,'拾う').click();find(root,'収集を開始').click();await flush();const check=root.querySelector<HTMLInputElement>('article input')!;check.checked=true;check.dispatchEvent(new Event('change'));
    find(root,'選んだ投稿を保存').click();await flush();expect(saved).toHaveLength(1);expect(saved[0]!.id).toBe('1');
    ui.dispose();const second=createResearchUi(send);cleanups.push(second.dispose);second.open();await flush();expect(second.host.shadowRoot!.querySelectorAll('article')).toHaveLength(1);
    expect(send.mock.calls.some(call=>(call[0] as {type:string}).type==='RESEARCH_JUDGE')).toBe(false);
  });
  it('drops stale judgments after the query changes and sends cancel with no notes by default',async()=>{
    let finish!:(value:unknown)=>void;
    const send=vi.fn(async(message:unknown)=>{const value=message as {type:string};return value.type==='RESEARCH_JUDGE'?new Promise(resolve=>{finish=resolve;}):{ok:true,posts:[post()]};});
    const ui=createResearchUi(send);cleanups.push(ui.dispose);ui.open();await flush();const root=ui.host.shadowRoot!;const input=root.querySelector<HTMLInputElement>('input[type=text]')!;input.value='仕事を減らす';find(root,'Jevで探す').click();await flush();
    const call=send.mock.calls.find(call=>(call[0] as {type:string}).type==='RESEARCH_JUDGE')![0] as {payload:{includeNotes:boolean;requestId:string}};expect(call.payload.includeNotes).toBe(false);
    input.value='別の目的';input.dispatchEvent(new Event('input'));finish({ok:true,results:[{id:'1',score:1,confidence:1}]});await flush();
    expect(root.textContent).not.toContain('目的に近い候補');expect(root.querySelector('#status')!.textContent).toContain('目的を変更');expect(send).toHaveBeenCalledWith({type:'RESEARCH_CANCEL',requestId:call.payload.requestId});
  });
  it('keeps raw source and reports absent relevant results without claiming a match',async()=>{
    const send=vi.fn(async(message:unknown)=>(message as {type:string}).type==='RESEARCH_JUDGE'?{ok:true,results:[{id:'1',score:0,confidence:1}],usage:{input_tokens:20,output_tokens:5}}:{ok:true,posts:[post()]});
    const ui=createResearchUi(send);cleanups.push(ui.dispose);ui.open();await flush();const root=ui.host.shadowRoot!;root.querySelector<HTMLInputElement>('input[type=text]')!.value='関係のないテーマ';find(root,'Jevで探す').click();await flush();
    expect(root.querySelector('#status')!.textContent).toContain('候補0件');expect(root.querySelector('#status')!.textContent).toContain('入力20 / 出力5');expect(root.querySelector('a')!.href).toBe('https://x.com/author/status/1');
    expect(root.querySelectorAll('#results > article')).toHaveLength(0);
    const others=root.querySelector<HTMLDetailsElement>('#results > details')!;expect(others.open).toBe(false);expect(others.querySelector('summary')!.textContent).toBe('その他の投稿（1件）');expect(others.querySelector('article')!.textContent).toContain('議事録の自動化');
    expect(root.querySelector<HTMLDetailsElement>('#status > details')!.open).toBe(false);
    find(root,'これとつなげる').click();await flush();expect(root.querySelector('#status')!.textContent).toBe('');
  });
  it('puts only matching candidates first, with full source and memo controls available on demand',async()=>{
    const text='Google Workspaceで議事録を作る手順。'.repeat(15);const posts=[post('1','関係のない投稿'),{...post('2',text),note:'あとで試したい'}];
    const send=vi.fn(async(message:unknown)=>(message as {type:string}).type==='RESEARCH_JUDGE'?{ok:true,results:[{id:'1',score:.2,confidence:1},{id:'2',score:.9,confidence:1}]}:{ok:true,posts});
    const ui=createResearchUi(send);cleanups.push(ui.dispose);ui.open();await flush();const root=ui.host.shadowRoot!;root.querySelector<HTMLInputElement>('input[type=text]')!.value='議事録の自動化';find(root,'Jevで探す').click();await flush();
    expect([...root.querySelectorAll<HTMLElement>('#results > article')].map(card=>card.dataset.postId)).toEqual(['2']);
    const card=root.querySelector<HTMLElement>('#results > article')!;expect(card.querySelector('.preview')!.textContent).toHaveLength(141);
    const detail=card.querySelector<HTMLDetailsElement>('details.post-details')!;expect(detail.open).toBe(false);expect(detail.querySelector('p')!.textContent).toBe(text);expect(detail.querySelector('textarea')!.value).toBe('あとで試したい');
    detail.open=true;expect(find(detail,'削除')).toBeDefined();
    const management=root.querySelector<HTMLDetailsElement>('footer details')!;expect(management.open).toBe(false);expect(management.textContent).toContain('拡張を削除すると失われます');
  });
  it('does not restore a deleted card when an earlier judgment completes',async()=>{
    let saved=[post()];let finish!:(value:unknown)=>void;vi.stubGlobal('confirm',vi.fn(()=>true));
    const send=vi.fn(async(message:unknown)=>{const value=message as {type:string;id?:string};if(value.type==='RESEARCH_JUDGE')return new Promise(resolve=>{finish=resolve;});if(value.type==='RESEARCH_DELETE')saved=saved.filter(p=>p.id!==value.id);return {ok:true,posts:saved};});
    const ui=createResearchUi(send);cleanups.push(ui.dispose);ui.open();await flush();const root=ui.host.shadowRoot!;root.querySelector<HTMLInputElement>('input[type=text]')!.value='議事録';find(root,'Jevで探す').click();await flush();
    const call=send.mock.calls.find(call=>(call[0] as {type:string}).type==='RESEARCH_JUDGE')![0] as {payload:{requestId:string}};
    find(root,'削除').click();await flush();expect(root.querySelectorAll('article')).toHaveLength(0);
    finish({ok:true,results:[{id:'1',score:1,confidence:1}]});await flush();
    expect(root.querySelectorAll('article')).toHaveLength(0);expect(root.querySelector('#status')!.textContent).toBe('保存投稿を削除しました。');expect(find(root,'中断').disabled).toBe(true);
    expect(send).toHaveBeenCalledWith({type:'RESEARCH_CANCEL',requestId:call.payload.requestId});
  });
  it('compares one anchor against saved posts and keeps uncertainty visible',async()=>{
    const send=vi.fn(async(message:unknown)=>(message as {type:string}).type==='RESEARCH_JUDGE'?{ok:true,results:[{id:'2',relation:'change',confidence:.2}]}:{ok:true,posts:[post(),post('2','同じツールの別の話')]});
    const ui=createResearchUi(send);cleanups.push(ui.dispose);ui.open();await flush();const root=ui.host.shadowRoot!;find(root,'これとつなげる').click();await flush();find(root,'Jevでつなげる').click();await flush();
    const call=send.mock.calls.find(call=>(call[0] as {type:string}).type==='RESEARCH_JUDGE')![0] as {payload:{posts:ResearchPost[];anchor:ResearchPost;mode:string}};expect(call.payload.mode).toBe('relate');expect(call.payload.anchor.id).toBe('1');expect(call.payload.posts.map(post=>post.id)).toEqual(['2']);expect(root.textContent).toContain('関係は未確定');
  });
  it('distinguishes missing API usage from zero new tokens when reusing results',async()=>{
    const send=vi.fn(async(message:unknown)=>(message as {type:string}).type==='RESEARCH_JUDGE'?{ok:true,results:[{id:'1',score:1,confidence:1}]}:{ok:true,posts:[post()]});
    const ui=createResearchUi(send);cleanups.push(ui.dispose);ui.open();await flush();const root=ui.host.shadowRoot!;root.querySelector<HTMLInputElement>('input[type=text]')!.value='自動化';find(root,'Jevで探す').click();await flush();expect(root.querySelector('#status')!.textContent).toContain('API使用量は未取得');
    find(root,'Jevで探す').click();await flush();expect(root.querySelector('#status')!.textContent).toContain('入力0 / 出力0');expect(send.mock.calls.filter(c=>(c[0] as {type:string}).type==='RESEARCH_JUDGE')).toHaveLength(1);
  });
});
it.each([
  ['2026-10-01T00:00:00Z', '2026-09-24T00:00:00Z', 1, '比較元より前の関連情報（候補）'],
  ['2026-09-24T00:00:00Z', '2026-10-01T00:00:00Z', 1, '比較元より後の関連情報（候補）'],
  ['2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', 1, '関連情報（前後関係は不明）'],
  [undefined, '2026-10-01T00:00:00Z', 1, '関連情報（前後関係は不明）'],
  ['2026-10-01T00:00:00Z', undefined, 1, '関連情報（前後関係は不明）'],
  ['2026-10-01T00:00:00Z', '2026-09-24T00:00:00Z', .5, '関連候補（関係は未確定）'],
])('labels followup using publication order without guessing missing dates (%s / %s, confidence %s)', async (anchorDate, candidateDate, confidence, label) => {
  const posts = [{ ...post('1', '比較元の更新'), postedAtUtc: anchorDate }, { ...post('2', '同じ対象の更新'), postedAtUtc: candidateDate }];
  const send = vi.fn(async (message: unknown) => (message as { type: string }).type === 'RESEARCH_JUDGE'
    ? { ok: true, results: [{ id: '2', relation: 'followup', confidence }] } : { ok: true, posts });
  const ui = createResearchUi(send); cleanups.push(ui.dispose); ui.open(); await flush();
  const root = ui.host.shadowRoot!;
  find(root, 'これとつなげる').click(); await flush(); find(root, 'Jevでつなげる').click(); await flush();
  const card = root.querySelector('[data-post-id="2"]')!;
  expect(card.textContent).toContain(label);
  expect(card.textContent).not.toContain('続報の候補');
  expect((card as HTMLElement).dataset.relationship).toBe('followup');
});
