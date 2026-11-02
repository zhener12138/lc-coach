const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Referer': 'https://leetcode.cn/problemset/',
  'Origin': 'https://leetcode.cn'
};

const tests = {
  translatedName: `query q($s:String!){question(titleSlug:$s){questionId title topicTags{name slug translatedName}}}`,
  plainTags: `query q($s:String!){question(titleSlug:$s){questionId title topicTags{name slug}}}`,
  fullNoTranslated: `query questionData($titleSlug: String!) { question(titleSlug: $titleSlug) { questionId questionFrontendId title translatedTitle titleSlug difficulty content translatedContent topicTags { name slug translatedName } codeSnippets { lang langSlug code } } }`
};

(async () => {
  for (const [name, query] of Object.entries(tests)) {
    try {
      const res = await fetch('https://leetcode.cn/graphql/', {
        method: 'POST', headers: HEADERS,
        body: JSON.stringify({ query, variables: { s: 'two-sum', titleSlug: 'two-sum' } })
      });
      const text = await res.text();
      console.log(`--- ${name}: HTTP ${res.status}`);
      console.log(text.slice(0, 700).replace(/\n/g, ' '));
      console.log();
    } catch (e) {
      console.log(`--- ${name}: ERROR ${e.message}\n`);
    }
    await new Promise(r => setTimeout(r, 400));
  }
})();
