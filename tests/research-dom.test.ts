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
function find(root:ShadowRoot,text:string) { const button = [...root.querySelectorAll('button')].find(node=>node.textContent===text); if(!button) throw new Error(text); return button; }
afterEach(()=>{ cleanups.splice(0).forEach(fn=>fn()); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('research workflow',()=>{
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
    expect(root.textContent).not.toContain('目的に近い候補');expect(root.querySelector('#status')!.textContent).toContain('中断');expect(send).toHaveBeenCalledWith({type:'RESEARCH_CANCEL',requestId:call.payload.requestId});
  });
  it('keeps raw source and reports absent relevant results without claiming a match',async()=>{
    const send=vi.fn(async(message:unknown)=>(message as {type:string}).type==='RESEARCH_JUDGE'?{ok:true,results:[{id:'1',score:0,confidence:1}],usage:{input_tokens:20,output_tokens:5}}:{ok:true,posts:[post()]});
    const ui=createResearchUi(send);cleanups.push(ui.dispose);ui.open();await flush();const root=ui.host.shadowRoot!;root.querySelector<HTMLInputElement>('input[type=text]')!.value='関係のないテーマ';find(root,'Jevで探す').click();await flush();
    expect(root.querySelector('#status')!.textContent).toContain('候補0件');expect(root.querySelector('#status')!.textContent).toContain('入力20 / 出力5');expect(root.querySelector('a')!.href).toBe('https://x.com/author/status/1');
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
