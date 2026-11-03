/**
 * 数据库自动备份
 *
 * 背景：曾经因为一次清理操作把 data/lccoach.mv.db 删了，打卡记录、错题本、
 * 力扣绑定全丢，且没有任何备份可恢复。这条测试钉住三件事：
 *   1. 启动时真的会备份，且备份文件落在 data/backup/
 *   2. 备份出来的库**真能恢复并查询**（不是拷了个坏文件）
 *   3. 只保留最近 7 份，不会无限膨胀
 *
 * 恢复方式（已实测）：H2 的 BACKUP TO 产出的 zip 里装的是 .mv.db 文件本身，
 * 用 `org.h2.tools.Restore -file <zip> -dir <目录>` 还原。
 * 不要用 RUNSCRIPT（那是给纯 SQL 脚本的），也不要手工拷 zip 里的文件
 * （名字对不上、还得处理权限）。
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'data', 'backup');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

const src = fs.readFileSync(path.join(ROOT, 'src/main/java/com/lc/service/BackupService.java'), 'utf8');

console.log('\n[1] 备份服务的结构');
ok('有 @Service', src.includes('@Service'));
ok('启动后立刻备份（ApplicationReadyEvent）', src.includes('ApplicationReadyEvent'));
ok('有定时备份（@Scheduled）', src.includes('@Scheduled'));
ok('用 H2 的 BACKUP TO，而不是直接拷文件', src.includes('BACKUP TO'));
ok('保留份数是 7', /KEEP\s*=\s*7/.test(src));
ok('备份失败不拖垮服务（catch 里只记日志）',
  /catch\s*\(Exception e\)\s*\{[\s\S]{0,200}log\(/.test(src) && !src.includes('throw e'));

console.log('\n[2] 真的生成过备份');
ok('data/backup/ 存在', fs.existsSync(BACKUP_DIR));
const zips = fs.existsSync(BACKUP_DIR)
  ? fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.zip')).sort()
  : [];
ok('至少有一份备份', zips.length > 0, '找到 ' + zips.length + ' 份');
ok('文件名带时间戳和触发原因',
  zips.length > 0 && zips.every(f => /^lccoach-\d{8}-\d{6}-(startup|periodic)\.zip$/.test(f)),
  zips.join(', '));
ok('份数不超过 7', zips.length <= 7, '当前 ' + zips.length);

console.log('\n[3] 备份内容的形状（zip 里装的是数据库文件本身）');
// 注意：沙箱禁止 Node spawn 子进程（java 会报 EPERM），所以这里不解压、
// 只用 zip 的 local file header 里明文的文件名 + 尺寸来判定。
// `完整恢复验证` 需要真的跑 java，已由 content-src/verify-backup.sh 单独承担。
if (zips.length) {
  const newest = zips[zips.length - 1];
  const p = path.join(BACKUP_DIR, newest);
  const buf = fs.readFileSync(p);

  // zip local file header: PK\x03\x04，文件名紧跟 30 字节之后
  ok('是合法 zip（PK 头）', buf[0] === 0x50 && buf[1] === 0x4b);
  const nameField = buf.slice(30, 30 + 64).toString('latin1').split('\u0000')[0];
  ok('zip 里装的是 lccoach.mv.db', nameField.startsWith('lccoach.mv.db'), nameField);

  // 尺寸要从 central directory（PK\x01\x02）读，不是 local header。
  // H2 写 zip 时用了 data descriptor（flag bit 3），local header 里的
  // 压缩/原始尺寸都是 0 占位，只有 central directory 才是权威值。
  const cd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  ok('能找到 central directory', cd >= 0);
  if (cd >= 0) {
    const uncompressed = buf.readUInt32LE(cd + 24);   // central dir: 24 处是原始大小
    const compressed = buf.readUInt32LE(cd + 20);
    ok('解压后是完整的库文件（远大于 10KB）', uncompressed > 10 * 1024,
      uncompressed + ' 字节');
    ok('zip 确实压缩了（压缩后小于原始）', compressed > 0 && compressed < uncompressed,
      compressed + ' -> ' + uncompressed);
  }
} else {
  ok('备份内容检查', false, '没有备份文件可验证');
}

console.log('\n[4] 恢复方式在代码里说清楚了');
// 「备份能用」和「备份能恢复」是两件事。README 里必须写明怎么恢复，
// 否则真出事的时候没人知道那堆 zip 该怎么用。
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
ok('README 写了备份位置', readme.includes('data/backup'));
ok('README 写了恢复命令（org.h2.tools.Restore）',
  readme.includes('org.h2.tools.Restore'));
ok('README 明确说了不要用 RUNSCRIPT',
  readme.includes('RUNSCRIPT'));

console.log('\n[5] 备份目录不会入库');
const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
ok('.gitignore 排除了 data/（备份在 data/backup 里，含 cookie）', /^data\/$/m.test(gi));

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exitCode = fail ? 1 : 0;
