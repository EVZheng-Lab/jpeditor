// `.jpwabc`「按乐句重排 / 原始排版」**跟着手改走**的回归。
//
//   npm run build && node scripts/phrase-edit-check.mjs
//
// 从前这两个按钮是照**导入时那份**（`mixedXmlText` 里的 MusicXML）重新生成文本的，
// 手工补的延音线、改过的音高一按就被整篇覆盖，而且悄无声息。现在两边都认编辑器里
// 现在这份文本（口径同文本谱那侧的 `_setPuPhraseLayout`）。守的几条：
//   J1 手改之后按「按乐句重排」→ 改动在重排结果里还在
//   J2 重排只动行结构：音符序列与歌词一个不差
//   J3 在乐句档里手改一个字 → 按钮自己弹回「原始排版」（那份文本成了新的「原样」基准）
//   J4 再按「原始排版」→ 回到**手改之后**那份，不是导入时那份
//   J5 幂等：不动文本连按两次「按乐句重排」，结果一字不变
import { serveDist, launchPage, loadApp } from "./harness.mjs";

// 四行、带歌词，重排才有得断。走真实导入路径（.musicxml）才会启用那两个按钮。
const JPW = [
  ".Title",
  "Title = 乐句重排",
  "KeyAndMeters = 1=C,4/4",
  ".Voice",
  "1 1 3 3 |5- 5- |6- 6 6 |5- 3- |$(true)",
  "5 5 6 6 |7,- 4- |3- 3 3 |2- 1- |$(true)",
  "1 1 3 3 |5- 5- |6- 6 6 |5- 5- |$(true)",
  "1' 1' 5 5 |6- 3- |2 2 2 1 |1--- |]$(true,0,0,true)",
  ".Words",
  "W1@1,1:",
  "一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉",
].join("\n");

let bad = 0;
const ok = (cond, name, detail) => {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? `　${detail}` : ""}`);
  if (!cond) bad++;
};

const { port, close } = await serveDist();
const { browser, page, errors } = await launchPage({ viewport: { width: 1500, height: 950 }, quiet: true });
await loadApp(page, port, { reveal: true });

const docText = () => page.evaluate(() => window.__app.getText());
/** 「原始排版 / 按乐句重排」两个按钮谁是按下的。 */
const active = () => page.evaluate(() => ({
  original: document.getElementById("btn-layout-original")?.getAttribute("aria-pressed"),
  phrase: document.getElementById("btn-phrase")?.getAttribute("aria-pressed"),
}));
/** 曲子的「内容指纹」：行结构之外的一切（音符 + 各段歌词）。重排前后必须一字不差。 */
const fingerprint = () => page.evaluate(async () => {
  const x = await window.__xmlout;
  const f = x.JpwFile.fromString(window.__app.getText());
  const score = f && x.fromJpw(f);
  if (!score) return "解析不了";
  const out = [];
  for (const m of score.parts[0].measures)
    for (const e of m.entries)
      if (e.notes) out.push(
        `${e.notes[0].number}${"'".repeat(Math.max(0, e.notes[0].jpOctave))}${",".repeat(Math.max(0, -e.notes[0].jpOctave))}` +
        `/${e.duration.num}:${e.duration.den}/${e.notes[0].lyrics.map((l) => l?.text ?? "").join("")}`);
  return out.join(" ");
});
const setText = async (t) => {
  await page.evaluate((s) => window.__app.setText(s), t);
  await page.waitForTimeout(400);
};
const phrase = async (on) => {
  await page.evaluate((v) => window.__app.setPhraseLayout(v), on);
  await page.waitForTimeout(500);
};
/** `.Voice` 段的段落体，**并把 `$(true)` 这类换行标记里的括号剔掉**——
 *  要数的是弧线的括号；文件头那行注释里还有个 `(for JP-Word v5.50m)`，
 *  对整篇找 `(` 一定中。 */
const voiceBody = (text) => {
  const ls = text.split("\n");
  const i = ls.findIndex((l) => l.trim() === ".Voice");
  const rest = ls.slice(i + 1);
  const j = rest.findIndex((l) => l.startsWith("."));
  return (j < 0 ? rest : rest.slice(0, j)).join("\n").replace(/\$\([^)]*\)/g, "$");
};

// 走真实导入路径：.jpwabc → Score → MusicXML → importBytes(".musicxml")。
// 只有导入过的文档才会亮出那两个按钮（`_applyImportedJp`），裸开 .jpwabc 是灰的。
const xml = await page.evaluate(async (text) => {
  const x = await window.__xmlout;
  return x.scoreToMusicXml(x.fromJpw(x.JpwFile.fromString(text)));
}, JPW);
await page.evaluate((s) => {
  window.__app.importBytes(new TextEncoder().encode(s), "phrase-test.musicxml");
}, xml);
await page.waitForTimeout(700);
await page.evaluate(() => window.__app.setViewMode("original"));
await page.waitForTimeout(400);

const imported = await docText();
ok(imported.includes(".Voice"), "导入成了 .jpwabc 文本", imported.split("\n")[0]);
ok(!voiceBody(imported).includes("("), "导入时这首谱里没有弧线（下面手工加一条）");
const a0 = await active();
ok(a0.original === "true" && a0.phrase === "false", "起手是「原始排版」");

console.log("【J1】手改之后按「按乐句重排」→ 改动还在");
// 手工给第一条曲行的头两个音符套一条延音线（正是用户手补弧线的那个动作）
const voiceIdx = imported.split("\n").findIndex((l) => l.trim() === ".Voice");
const lines = imported.split("\n");
lines[voiceIdx + 1] = lines[voiceIdx + 1].replace(/^(\S+) (\S+)/, "($1 $2)");
const edited = lines.join("\n");
ok(edited !== imported, "样本里确实改了一处", lines[voiceIdx + 1]);
await setText(edited);
const fpEdited = await fingerprint();

await phrase(true);
const relaid = await docText();
ok(relaid !== edited, "重排出了新的行结构", `${edited.split("\n").length} 行 → ${relaid.split("\n").length} 行`);
ok(voiceBody(relaid).includes("("), "手工补的那条弧线还在重排结果里（从前会被导入时那份整篇覆盖）",
  voiceBody(relaid).split("\n").find((l) => l.includes("(")) ?? "(没了)");
const a1 = await active();
ok(a1.phrase === "true", "按钮切到「按乐句重排」");

console.log("【J2】重排只动行结构");
ok((await fingerprint()) === fpEdited, "音符与歌词一个不差");

console.log("【J5】幂等：不动文本再按一次，结果一样");
await phrase(false);
await phrase(true);
ok((await docText()) === relaid, "两次重排一字不变");

console.log("【J3】乐句档里手改 → 按钮弹回「原始排版」");
const relaidEdited = relaid.replace("Title = 乐句重排", "Title = 重排后又改过");
await setText(relaidEdited);
const a2 = await active();
ok(a2.original === "true" && a2.phrase === "false", "按钮回到「原始排版」",
  `original=${a2.original} phrase=${a2.phrase}`);

console.log("【J4】按「原始排版」→ 回到手改之后那份");
await phrase(true);
await phrase(false);
const back = await docText();
ok(back === relaidEdited, "回到的是手改之后那份，不是导入时那份",
  back === imported ? "回到了导入时那份（从前的毛病）" : "");

const fatal = errors.filter((e) => !/favicon|Failed to load resource/.test(e));
ok(fatal.length === 0, "无控制台错误", fatal.slice(0, 2).join(" | "));

await browser.close();
await close();
console.log(bad === 0 ? "\n全部通过" : `\n${bad} 条未通过`);
process.exit(bad === 0 ? 0 : 1);
