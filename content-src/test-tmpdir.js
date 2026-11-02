/**
 * 临时目录降级 + 编译报错可读性
 *
 * 背景：用户报「我的代码在力扣能过，这里编译不过」，而界面只显示
 * 「编译过程出错：C:\...\lcgrade123」—— 一个路径，没有原因。
 *
 * 查下来是 java.io.tmpdir 指向的目录存在但 ACL 不允许建子目录。
 * 这类故障有两个层次：
 *   1. CodeGrader 建不了编译产物目录 → 评分永远失败
 *   2. Spring Boot 建不了 Tomcat baseDir → 整个服务起不来（更严重）
 * 所以这条测试要同时钉住两层，以及「报错必须说人话」。
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const API = process.env.LC_API || 'http://127.0.0.1:8099';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

const appSrc = fs.readFileSync(path.join(ROOT, 'src/main/java/com/lc/App.java'), 'utf8');
const graderSrc = fs.readFileSync(path.join(ROOT, 'src/main/java/com/lc/service/CodeGrader.java'), 'utf8');

(async () => {
  console.log('\n[1] 启动入口负责兜住 tmpdir');
  ok('App 在 SpringApplication.run 之前先处理 tmpdir',
    appSrc.indexOf('ensureTempDir()') >= 0 &&
    appSrc.indexOf('ensureTempDir()') < appSrc.indexOf('SpringApplication.run'));
  ok('真的尝试建目录来探测，不是只看目录存在',
    /Files\.createTempDirectory\(base,\s*"probe"\)/.test(appSrc));
  ok('探测完会把探针删掉，不留垃圾',
    /deleteIfExists\(probe\)/.test(appSrc));
  ok('降级候选里包含项目内的 .jtmp', appSrc.includes('Path.of(".jtmp")'));
  ok('改完 java.io.tmpdir 还要改 Tomcat 的 basedir（光改前者不够）',
    appSrc.includes('server.tomcat.basedir'));

  console.log('\n[2] 评分器自己也要能降级');
  ok('用的是 newOutDir() 而不是裸的 Files.createTempDirectory',
    graderSrc.includes('outDir = newOutDir();'));
  ok('newOutDir 有多个候选目录依次尝试',
    /for \(Path base : candidates\)/.test(graderSrc));
  ok('候选里含项目内的 data/grade-tmp', graderSrc.includes('"grade-tmp"'));

  console.log('\n[3] 报错必须说人话');
  ok('不再直接吐 e.getMessage()', !graderSrc.includes('"编译过程出错：" + e.getMessage()'));
  ok('用 describe(e) 翻译异常', graderSrc.includes('describe(e)'));
  ok('明确告诉用户「不是你的代码问题」', graderSrc.includes('不是你的代码问题'));
  ok('AccessDeniedException 会解释成「不允许创建子目录」',
    graderSrc.includes('不允许创建子目录'));
  ok('给出了下一步该干什么', graderSrc.includes('权限检查') || graderSrc.includes('重试一次'));

  console.log('\n[4] 真实服务：编译链路是通的');
  const GOOD = 'class Solution {\n    public void moveZeroes(int[] nums) {\n        int w = 0;\n'
    + '        for (int r = 0; r < nums.length; r++) {\n'
    + '            if (nums[r] != 0) {\n'
    + '                int t = nums[w]; nums[w] = nums[r]; nums[r] = t; w++;\n'
    + '            }\n        }\n    }\n}';
  const BAD = GOOD.replace('int w = 0;', 'int w = ;');

  async function grade(code) {
    const r = await fetch(API + '/api/problem/move-zeroes/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    return { status: r.status, g: await r.json() };
  }

  try {
    const a = await grade(GOOD);
    ok('正确代码 HTTP 200', a.status === 200, 'got ' + a.status);
    ok('正确代码 compiled=true', a.g.compiled === true);
    ok('正确代码没有编译报错',
      !a.g.compileErrors || a.g.compileErrors.length === 0,
      JSON.stringify(a.g.compileErrors));

    const b = await grade(BAD);
    ok('写错代码 compiled=false（没有假装通过）', b.g.compiled === false);
    ok('写错代码报出了行号', (b.g.compileErrors || []).some(e => /第 \d+ 行/.test(e)),
      JSON.stringify(b.g.compileErrors));
    ok('编译失败的错误信息不是「编译环境出错」——那说明环境是好的，错在代码',
      !(b.g.compileErrors || []).some(e => e.includes('编译环境出错')));
  } catch (e) {
    ok('能连上服务', false, e.message);
  }

  console.log('\n[5] 临时目录不留下编译垃圾');
  const gt = path.join(ROOT, 'data/grade-tmp');
  const left = fs.existsSync(gt) ? fs.readdirSync(gt).length : 0;
  ok('data/grade-tmp 里没有残留的 lcgrade* 目录', left === 0, '残留 ' + left + ' 个');

  console.log('\n[6] .jtmp 不能入库');
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  ok('.gitignore 忽略了 .jtmp/', gi.includes('.jtmp/'));

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  process.exitCode = fail ? 1 : 0;
})();
