/**
 * 四年级学习包填空答案体检（一次性审计脚本）
 *
 * 扫 content/{math,chinese,english}-4-up-* 下所有包的 blank 题，找出三类问题：
 *   A. 「或」语义并列答案：`省、自治区、直辖市` / `A或B` / `A（BC）`
 *   B. 答案带单位而题干空格外也带单位 → 孩子填数字被判错
 *   C. 答案里带括号补充说明（`省(直辖市)`）—— 判分内核能吃，但要看清写法
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const CONTENT = path.join(ROOT, 'content');

/** 度量单位后缀（长名优先，避免「分」先于「分钟」命中） */
const UNITS = [
  '平方千米', '平方厘米', '平方分米', '平方毫米', '平方千米',
  '立方米', '立方厘米', '立方分米',
  '千米', '厘米', '毫米', '分米', '米',
  '千克', '公斤', '克', '吨',
  '分钟', '小时', '星期', '秒',
  '平方米', '公顷', '亩',
  '元', '角', '分', '度', '条', '只', '个', '人', '本', '支', '辆', '棵', '朵', '张',
];
const UNIT_RE = new RegExp(`(${UNITS.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`);

function walkPackages(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkPackages(p, out);
    else if (name.endsWith('.json') && name !== '_set.json' && name !== 'manifest.json') out.push(p);
  }
  return out;
}

function* iterExercises(pkg) {
  for (const unit of pkg.units ?? []) {
    for (const topic of unit.topics ?? []) {
      for (const ex of topic.exercises ?? []) {
        yield { unit: unit.name ?? unit.id, topic: topic.title ?? topic.id, ex };
      }
    }
  }
  for (const ex of pkg.exercises ?? []) {
    yield { unit: '(顶层)', topic: '(顶层)', ex };
  }
}

const report = [];

const dirs = fs
  .readdirSync(CONTENT)
  .filter((d) => /^(math|chinese|english)-4-up/.test(d))
  .map((d) => path.join(CONTENT, d));

for (const dir of dirs) {
  for (const file of walkPackages(dir)) {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      console.error('解析失败', file, e.message);
      continue;
    }
    for (const { unit, topic, ex } of iterExercises(pkg)) {
      if (ex.type !== 'blank') continue;
      const ans = ex.answer;
      const ansText = Array.isArray(ans) ? ans.join(' | ') : String(ans ?? '');
      const q = String(ex.question ?? '');
      const flags = [];

      // A. 或语义并列
      if (/或/.test(ansText)) flags.push('A:含「或」');
      if (/、/.test(ansText)) flags.push('A:顿号并列');
      if (/[（(][^）)]*[）)]/.test(ansText)) flags.push('A:括号补充');

      // B. 答案带单位，且题干空格外也出现同一单位
      const m = UNIT_RE.exec(ansText.replace(/^[\s\d,.]+/, ''));
      if (m) {
        const unit = m[1];
        // 题干里单位出现次数：>1 说明空格外还有一个单位
        const occurrences = q.split(unit).length - 1;
        if (occurrences >= 1) flags.push(`B:答案带「${unit}」且题干也出现`);
      }

      // C. 答案含空格而题干空格数=1（提示"每空一词"）
      if (/\s/.test(ansText) && !/,\s|,/.test(ansText) && /（______）|\(\s*_\s*\)/.test(q)) {
        flags.push('C:单空答案含空格');
      }

      if (flags.length) {
        report.push({
          file: path.relative(ROOT, file).replace(/\\/g, '/'),
          id: ex.id,
          unit,
          topic,
          q,
          ans: ansText,
          flags: [...new Set(flags)],
        });
      }
    }
  }
}

console.log(`命中 ${report.length} 条\n`);
const byFlag = {};
for (const r of report) {
  for (const f of r.flags) (byFlag[f] ??= []).push(r);
}
for (const [f, list] of Object.entries(byFlag)) {
  console.log(`### ${f}  → ${list.length} 条`);
}
console.log('\n================ 明细 ================\n');
for (const r of report) {
  console.log(`[${r.flags.join(' ')}] ${r.id}`);
  console.log(`  Q: ${r.q}`);
  console.log(`  A: ${r.ans}`);
  console.log(`  ${r.file}  ${r.unit} / ${r.topic}\n`);
}
