// 谱面**就地编辑**回归（第二步，见 docs/实现/谱面就地编辑.md）。
//
//   npm run build && node scripts/edit-check.mjs
//
// 守的几条：
//   E1 `.jpwabc`：双击音符 → 原地弹输入框，初值**只有那个数字**（减时线/八度点不跟着进来）
//   E2 改完回车 → 源码换成新写法、**减时线等修饰原样留着**，谱面跟着重排，高亮还在
//   E3 Esc 取消 → 源码一个字都不动
//   E4 **会让整篇解析不了的输入一律不提交**：源码不变、输入框留着并标红
//   E5 歌词、标题也能这么改
//   E6 文本谱同样能改
//   E7 调号拍号的值删空 → 纸顶那块跟着不印（从前 `KeyAndMeters` 少一半就抛，import 挂掉、
//      reload 静悄悄退回上一版，看着就是「删不掉」）
import { serveDist, launchPage, loadApp } from "./harness.mjs";

const JPW = [
  ".Title",
  "Title = 就地编辑",
  "KeyAndMeters = 1=C,4/4",
  ".Voice",
  "1 2_ 3' 4 | 5 6, 7_ 1' |",
  ".Words",
  "W1:",
  "一二三四五六七八",
].join("\n");

const PU = [
  "B: 就地编辑",
  "1=C",
  "P: 4/4",
  "Q: 1 2 3 4 | 5 6 7 1",
  "C: 一 二 三 四 五 六 七 八",
].join("\n");

let bad = 0;
const ok = (cond, name, detail) => {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? `　${detail}` : ""}`);
  if (!cond) bad++;
};

const { port, close } = await serveDist();
const { browser, page, errors } = await launchPage({ viewport: { width: 1500, height: 950 }, quiet: true });
await loadApp(page, port, { reveal: true });

/** 在「渲染出来是这几个字」的那个图元上双击，返回输入框现在的值（没开出来给 null）。 */
const dblclickShown = (shown) => page.evaluate((want) => {
  const el = [...document.querySelectorAll("[data-src-from]")]
    .find((e) => (e.textContent ?? "").trim() === want);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const at = { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
  el.dispatchEvent(new MouseEvent("click", at));
  el.dispatchEvent(new MouseEvent("dblclick", at));
  return document.querySelector(".inline-edit")?.value ?? null;
}, shown);

/** 往输入框里写新值，再按一个键（Enter 提交 / Escape 取消）。 */
const typeAndKey = (value, key) => page.evaluate(([v, k]) => {
  const input = document.querySelector(".inline-edit");
  if (!input) return false;
  input.value = v;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  return true;
}, [value, key]);

const docText = () => page.evaluate(() => window.__app.getText());
const state = () => page.evaluate(() => {
  const st = window.__app.view.state, s = st.selection.main;
  const input = document.querySelector(".inline-edit");
  return {
    sel: st.sliceDoc(s.from, s.to),
    inputOpen: !!input,
    inputBad: input ? input.classList.contains("bad") : false,
    highlighted: [...document.querySelectorAll("[data-src-from].selected")]
      .map((e) => (e.textContent ?? "").trim()),
  };
});

const load = async (text, name) => {
  if (name) await page.evaluate(([t, n]) => {
    window.__app.importBytes(new TextEncoder().encode(t), n);
  }, [text, name]);
  else await page.evaluate((t) => window.__app.setText(t), text);
  await page.evaluate(() => window.__app.setViewMode("original"));
  await page.waitForTimeout(500);
};

// ---------------------------------------------------------------- .jpwabc
await load(JPW);

console.log("【E1】双击音符 → 输入框初值只有那个数字");
{
  const v = await dblclickShown("2二"); // entry 组含着它底下的歌词，故是「2二」
  // **不含减时线**：用户点的是那个数字，改它不该把 `_` 一起换掉（见 layout.ts::PageItem.editSource）
  ok(v === "2", "初值 = `2`（减时线不跟着进来）", `实得 \`${v}\``);
  // 单击那一下会把焦点给代码区（`_selectCode` → `view.focus()`），双击必须把它抢回来，
  // 否则输入框弹出来了却敲不进字。
  const focused = await page.evaluate(() =>
    document.activeElement === document.querySelector(".inline-edit"));
  ok(focused, "焦点在输入框里（没被代码区抢走）");
}

console.log("【E3】Esc 取消，源码不动");
{
  const before = await docText();
  await typeAndKey("6,,", "Escape");
  const after = await docText();
  ok(before === after, "源码一个字都没动");
  ok(!(await state()).inputOpen, "输入框收掉了");
}

console.log("【E4】会让整篇解析不了的输入不提交");
{
  const before = await docText();
  await dblclickShown("2二");
  // `@` 不在文法里。注意**不能拿 `X` 试**——那是合法的节奏音符（Jpwabc.g4 的 Pitch）。
  await typeAndKey("@", "Enter");
  await page.waitForTimeout(300);
  const st = await state();
  ok((await docText()) === before, "源码没变");
  ok(st.inputOpen && st.inputBad, "输入框留着并标红", `open=${st.inputOpen} bad=${st.inputBad}`);
  await typeAndKey("", "Escape");
}

console.log("【E2】改完回车 → 源码换掉、谱面重排、高亮还在");
{
  await dblclickShown("2二");
  await typeAndKey("6", "Enter");
  await page.waitForTimeout(500);
  const txt = await docText();
  // **`_` 原样留着**：只换掉数字那一格，这一条是「点的是数字就别动减时线」的正题
  ok(txt.includes("1 6_ 3' 4 |"), "源码里 `2_` 变成了 `6_`（减时线没被动）",
    txt.split("\n").find((l) => l.includes("3'")));
  const st = await state();
  ok(st.sel === "6", "选区落在改完那一格上", `实得 \`${st.sel}\``);
  ok(st.highlighted.length === 1 && st.highlighted[0].startsWith("6"),
    "谱面上高亮的就是改完的那个音符", st.highlighted.join(","));
}

console.log("【E5】歌词 / 标题也能改");
{
  await dblclickShown("三");
  await typeAndKey("叁", "Enter");
  await page.waitForTimeout(400);
  ok((await docText()).includes("一二叁四五六七八"), "歌词第三个字改成了「叁」");

  const v = await dblclickShown("就地编辑");
  ok(v === "就地编辑", "双击标题 → 初值是 `Title =` 的值", `实得 \`${v}\``);
  await typeAndKey("改过的标题", "Enter");
  await page.waitForTimeout(400);
  ok((await docText()).includes("Title = 改过的标题"), "标题改掉了");
}

console.log("【E7】调号拍号：值删空 → 纸顶那块跟着不印（从前是删不掉）");
{
  // 那块是个 Group：`1=` + 音名 + 拍值两个数字（分数线不是文字），textContent 拼起来是 `1=C44`
  const v = await dblclickShown("1=C44");
  ok(v === "1=C,4/4", "双击调号拍号 → 初值是 `KeyAndMeters =` 的值", `实得 \`${v}\``);
  await typeAndKey("", "Enter");
  await page.waitForTimeout(500);
  const st = await state();
  ok(!st.inputBad, "空值不算「解析不了」，提交得出去（`1=F` 这种只写一半的也不许再抛）");
  ok((await docText()).includes("KeyAndMeters = \n"), "源码里那一行的值空了",
    (await docText()).split("\n").find((l) => l.startsWith("KeyAndMeters")));
  const gone = await page.evaluate(() =>
    ![...document.querySelectorAll(".score-page-wrap text")].some((t) => t.textContent === "1="));
  ok(gone, "谱面纸顶不再画 `1=C 4/4`");
  // 写回去要能复原（这块不是一删就永远回不来）
  await page.evaluate(() => window.__app.setText(
    window.__app.getText().replace("KeyAndMeters = ", "KeyAndMeters = 1=G,3/4")));
  await page.waitForTimeout(500);
  const back = await page.evaluate(() =>
    [...document.querySelectorAll(".score-page-wrap text")].map((t) => t.textContent).join(""));
  ok(back.includes("1=") && back.includes("G"), "写回 `1=G,3/4` 又印出来了", back.slice(0, 20));
}

// ---------------------------------------------------------------- 文本谱
console.log("【E6】文本谱同样能改");
await load(PU, "edit-test.pu");
{
  const v = await dblclickShown("4");
  ok(v === "4", "双击音符 → 初值 `4`", `实得 \`${v}\``);
  await typeAndKey("5", "Enter");
  await page.waitForTimeout(400);
  ok((await docText()).includes("Q: 1 2 3 5 |"), "源码里第 4 个音符变成了 5",
    (await docText()).split("\n").find((l) => l.startsWith("Q:")));

  await dblclickShown("三");
  await typeAndKey("叁", "Enter");
  await page.waitForTimeout(400);
  ok((await docText()).includes("一 二 叁 四"), "歌词也能改");
}

const fatal = errors.filter((e) => !/favicon|Failed to load resource/.test(e));
ok(fatal.length === 0, "无控制台错误", fatal.slice(0, 2).join(" | "));

await browser.close();
await close();
console.log(bad === 0 ? "\n全部通过" : `\n${bad} 条未通过`);
process.exit(bad === 0 ? 0 : 1);
