import { describe, expect, it } from 'vitest';
import { canonicalizeSearchQuery, normalizeSearchText, searchTextIncludes } from '../src/core/search-query';

describe('search query normalization', () => {
  it('matches Google Workspace and googleworkspace in both directions', () => {
    expect(searchTextIncludes('Google Workspace tips', 'googleworkspace')).toBe(true);
    expect(searchTextIncludes('googleworkspace tips', 'Google Workspace')).toBe(true);
  });

  it('matches GPT version spelling regardless of letter case', () => {
    expect(searchTextIncludes('GPT-6.1 release notes', 'gpt-6.1')).toBe(true);
    expect(searchTextIncludes('gpt-6.1 release notes', 'GPT-6.1')).toBe(true);
  });

  it('does not match a GPT model version that continues with digits or another decimal part', () => {
    expect(searchTextIncludes('GPT-6.10', 'gpt-6.1')).toBe(false);
    expect(searchTextIncludes('GPT-6.1.2', 'GPT-6.1')).toBe(false);
    expect(searchTextIncludes('GPT-6.2', 'GPT-6.1')).toBe(false);
    expect(searchTextIncludes('GPT-6.1', 'GPT-6.1')).toBe(true);
    expect(searchTextIncludes('GPT-6.1 release', 'GPT-6.1')).toBe(true);
    expect(searchTextIncludes('GPT-6.1 2026年の紹介', 'gpt-6.1')).toBe(true);
    expect(searchTextIncludes('GPT-6.1. Release notes', 'gpt-6.1')).toBe(true);
    expect(searchTextIncludes('Google Workspace GPT-6.10', 'googleworkspace gpt-6.1')).toBe(false);
    expect(searchTextIncludes('Useful workspace rollout notes', 'workspace roll')).toBe(true);
  });

  it('applies NFKC and ignores whitespace for matching', () => {
    expect(normalizeSearchText(' Ｇｏｏｇｌｅ　Ｗｏｒｋｓｐａｃｅ ')).toBe('googleworkspace');
    expect(searchTextIncludes('Ｇｏｏｇｌｅ　Ｗｏｒｋｓｐａｃｅ tips', 'google workspace')).toBe(true);
    expect(searchTextIncludes('some text', '　 \n\t')).toBe(false);
  });

  it('does not match a related but different product or model version', () => {
    expect(searchTextIncludes('Google Cloud tips', 'Google Workspace')).toBe(false);
    expect(searchTextIncludes('GPT-6.2 release notes', 'GPT-6.1')).toBe(false);
    expect(searchTextIncludes('GPT-61 release notes', 'GPT-6.1')).toBe(false);
  });

  it('canonicalizes the known bare aliases and model version spellings', () => {
    expect(canonicalizeSearchQuery(' googleworkspace ')).toBe('Google Workspace');
    expect(canonicalizeSearchQuery('Google Workspace')).toBe('Google Workspace');
    expect(canonicalizeSearchQuery('gpt6.1')).toBe('GPT-6.1');
    expect(canonicalizeSearchQuery('gpt  6.1')).toBe('GPT-6.1');
    expect(canonicalizeSearchQuery('ＧＰＴ－６.１')).toBe('GPT-6.1');
    expect(canonicalizeSearchQuery('gPt-6.2')).toBe('GPT-6.2');
    expect(canonicalizeSearchQuery('gpt6.1.2')).toBe('GPT-6.1.2');
    expect(canonicalizeSearchQuery('GPT-61')).toBe('GPT-61');
    expect(canonicalizeSearchQuery('GPT-6.10')).toBe('GPT-6.10');
  });

  it('canonicalizes known terms inside ordinary search phrases only', () => {
    expect(canonicalizeSearchQuery('googleworkspace gpt-6.1')).toBe('Google Workspace GPT-6.1');
    expect(canonicalizeSearchQuery('googleworkspace 議事録')).toBe('Google Workspace 議事録');
    expect(canonicalizeSearchQuery('meetingnotes 議事録')).toBe('meetingnotes 議事録');
  });

  it('leaves X operators, quoted literals, handles, hashtags, and exclusions alone', () => {
    expect(canonicalizeSearchQuery(' from:googleworkspace filter:gpt6.1 ')).toBe('from:googleworkspace filter:gpt6.1');
    expect(canonicalizeSearchQuery('googleworkspace from:alice')).toBe('googleworkspace from:alice');
    expect(canonicalizeSearchQuery('from:ａｌｉｃｅ')).toBe('from:ａｌｉｃｅ');
    expect(canonicalizeSearchQuery('googleworkspace(from:alice)')).toBe('googleworkspace(from:alice)');
    expect(canonicalizeSearchQuery('"GoogleWorkspace gpt6.1"')).toBe('"GoogleWorkspace gpt6.1"');
    expect(canonicalizeSearchQuery('"ＧＰＴ－６.１"')).toBe('"ＧＰＴ－６.１"');
    expect(canonicalizeSearchQuery('googleworkspace "gpt6.1 release"')).toBe('googleworkspace "gpt6.1 release"');
    expect(canonicalizeSearchQuery('@googleworkspace #gpt6.1 -GoogleWorkspace')).toBe('@googleworkspace #gpt6.1 -GoogleWorkspace');
  });
});
