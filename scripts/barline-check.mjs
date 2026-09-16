// `.jpwabc` 谱面小节线线型与反复记号的渲染回归。
//
//   npm run build && node scripts/barline-check.mjs
//
// 背景：线型与反复有**两种表示**——MusicXML 进来的记在小节上（`Measure.barline` /
// `repeatBackward`），`.jpwabc` 进来的只记在条目上（`BarlineEntry.style` / `.repeat`）。
// 排版层从前只认前一种，于是手写或打开的 `.jpwabc` 里 `|:` `:|` `|]` `||` `[|]`
// 全画成一根普通小节线（反复记号在谱面上整个消失）。
//
// 判据用**差分**：同一首谱只换中间那根小节线，数页面里的 `<path>`（反复点是矢量圆，
// 一个反复记号两颗）与 `<line>`（粗细两根 vs 普通一根）。差分比绝对数稳——
// 数字随字号、页数、别的图元变，差值不变。
import { serveDist, launchPage, loadApp } from "./harness.mjs";

const song = (voice) => [
  ".Title",
  "Title = 小节线测试",
  "KeyAndMeters = 1=C,4/4",
  ".Voice",
  voice,
].join("\n");

let bad = 0;
const ok = (cond, name, detail) => {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? `　${detail}` : ""}`);
  if (!cond) bad++;
};

const { port, close } = await serveDist();
const { browser, page, errors } = await launchPage({ viewport: { width: 1500, height: 950 }, quiet: true });
await loadApp(page, port, { reveal: true });

/** 排一遍，数谱面上的图元。 */
const shapes = async (voice) => {
  await page.evaluate((t) => window.__app.setText(t), song(voice));
  await page.evaluate(() => window.__app.setViewMode("original"));
  await page.waitForTimeout(350);
  return page.evaluate(() => ({
    paths: document.querySelectorAll(".score-page path").length,
    lines: document.querySelectorAll(".score-page line").length,
  }));
};

const plain = await shapes("1 2 3 4 | 5 6 7 1 |");
console.log(`  基准（中间一根 \`|\`）：path ${plain.paths} / line ${plain.lines}`);

console.log("【B1】`|:` 反复开始");
{
  const s = await shapes("1 2 3 4 |: 5 6 7 1 |");
  ok(s.paths === plain.paths + 2, "多出两颗反复点", `path ${plain.paths} → ${s.paths}`);
  ok(s.lines === plain.lines + 1, "细线变成粗细两根", `line ${plain.lines} → ${s.lines}`);
}

console.log("【B2】`:|` 反复结束");
{
  const s = await shapes("1 2 3 4 :| 5 6 7 1 |");
  ok(s.paths === plain.paths + 2, "多出两颗反复点", `path ${plain.paths} → ${s.paths}`);
  ok(s.lines === plain.lines + 1, "细线变成粗细两根", `line ${plain.lines} → ${s.lines}`);
}

console.log("【B3】曲子**一上来**就是 `|:`（记号落在小节开头，不在任何音符之后）");
{
  const s = await shapes("|: 1 2 3 4 | 5 6 7 1 |");
  ok(s.paths === plain.paths + 2, "多出两颗反复点", `path ${plain.paths} → ${s.paths}`);
}

console.log("【B4】`|]` 终止线 / `||` 双细线 / `[|]` 不可见");
{
  const end = await shapes("1 2 3 4 |] 5 6 7 1 |");
  ok(end.lines === plain.lines + 1, "`|]` 是细粗两根", `line ${plain.lines} → ${end.lines}`);
  const dbl = await shapes("1 2 3 4 || 5 6 7 1 |");
  ok(dbl.lines === plain.lines + 1, "`||` 是两根", `line ${plain.lines} → ${dbl.lines}`);
  const none = await shapes("1 2 3 4 [|] 5 6 7 1 |");
  ok(none.lines === plain.lines - 1, "`[|]` 一根都不画", `line ${plain.lines} → ${none.lines}`);
}

console.log("【B5】`:|` 紧接 `|:` 并成一根 `:|:`");
{
  const s = await shapes("1 2 3 4 :| |: 5 6 7 1 |");
  ok(s.paths === plain.paths + 4, "两侧各两颗点", `path ${plain.paths} → ${s.paths}`);
  ok(s.lines === plain.lines + 2, "并成细粗细三根", `line ${plain.lines} → ${s.lines}`);
}

const fatal = errors.filter((e) => !/favicon|Failed to load resource/.test(e));
ok(fatal.length === 0, "无控制台错误", fatal.slice(0, 2).join(" | "));

await browser.close();
await close();
console.log(bad === 0 ? "\n全部通过" : `\n${bad} 条未通过`);
process.exit(bad === 0 ? 0 : 1);
