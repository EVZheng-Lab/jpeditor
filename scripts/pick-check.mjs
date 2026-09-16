// 谱面 ↔ 源码 **点选联动**回归（第一步，见 docs/实现/谱面就地编辑.md）。
//
//   npm run build && node scripts/pick-check.mjs
//
// 守的几条：
//   P1 `.jpwabc`：点谱面音符 → 编辑器只选中**数字那一格**（八度点/减时线/弧不跟着选，
//      否则接着改音高就把它们一起换掉了）；宽区间仍挂在 DOM 上给 P4 的光标联动用
//   P2 `.jpwabc`：样本里**故意夹着空行与 `//` 注释行**——`JpwFile.parse` 会把它们丢掉，
//      段内行号 ≠ 文档行号，这一条正是 `Section.lineNos` 那份账的理由，去掉它回归就守不住了
//   P3 文本谱：点谱面音符 → 选中该音符在原文里的那一段
//   P4 反向：光标移进某个词素 → 谱面上对应的 `<g>` 带上 `.selected`
//   P5 展开档不联动（一个对象对应多遍，指不回唯一一段原文），且不许报错
//   P6 **不只是音符**：歌词、标题、词曲署名都能点回原文（两种格式）
//   P7 点谁高亮谁：相邻词素之间**没有空格**时（`2_1)`、`|1'.`）不许串到下一个
import { serveDist, launchPage, loadApp } from "./harness.mjs";

// 第 3 行是空行、第 4 行是注释：两者都不进 Section.lines，故 `.Voice` 的首行
// 在段内是第 1 行、在文档里是第 8 行。行号换算错的话 P1 会整片落空。
const JPW = [
  ".Title",
  "Title = 点选测试",
  "",
  "// 这一行是注释，parse 会跳过",
  "KeyAndMeters = 1=C,4/4",
  "WordsByAndMusicBy = 张三 作词\\n李四 作曲",
  ".Voice",
  "1 2_ 3' 4 | 5 6, 7_ 1' |",
  ".Words",
  "W1:",
  "一二三四五六七八",
].join("\n");

const PU = [
  "B: 点选测试",
  "Z: 张三 作词",
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

/** 在元素中心派发一次真 click（带 clientX/Y：`.jpwabc` 那条走几何 pick，要坐标）。 */
const clickEl = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent("click", {
    bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
  }));
  return true;
}, sel);

const selection = () => page.evaluate(() => {
  const st = window.__app.view.state, s = st.selection.main;
  return { from: s.from, to: s.to, text: st.sliceDoc(s.from, s.to) };
});

/** 谱面上所有带源码区间的图元：渲染出来的字 ↔ 它指回的那段原文。 */
const tagged = () => page.evaluate(() => {
  const st = window.__app.view.state;
  return [...document.querySelectorAll("[data-src-from]")].map((e) => ({
    shown: (e.textContent ?? "").trim(),
    src: st.sliceDoc(Number(e.getAttribute("data-src-from")), Number(e.getAttribute("data-src-to"))),
  }));
});

/** 点中「渲染出来是这几个字」的那个图元，返回随后的源码选区。 */
const clickShown = async (shown) => {
  const hit = await page.evaluate((want) => {
    const el = [...document.querySelectorAll("[data-src-from]")]
      .find((e) => (e.textContent ?? "").trim() === want);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent("click", {
      bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
    }));
    return true;
  }, shown);
  return hit ? selection() : null;
};

// ---------------------------------------------------------------- .jpwabc
console.log("【P1/P2】.jpwabc 点谱面 → 选中源码词素（样本夹着空行与注释行）");
await page.evaluate((t) => window.__app.setText(t), JPW);
await page.evaluate(() => window.__app.setViewMode("original"));
await page.waitForTimeout(500);

const jpNotes = await page.evaluate(() => {
  const app = window.__app;
  const out = [];
  for (const m of app.painter.score.parts[0].measures) {
    for (const e of m.entries) {
      if (!e.source) continue;
      const el = app.painter.chordGroupEl(e, 0);
      if (!el) continue;
      el.setAttribute("data-test-note", String(out.length));
      out.push(e.source);
    }
  }
  return out;
});
ok(jpNotes.length === 8, "八个音符都带上了源码位置", `${jpNotes.length}/8`);
// .Voice 首行在文档里是第 8 行（0 基 7）——空行与注释行被 parse 丢掉了，这一条守的就是它
ok(jpNotes.every((s) => s.line === 7), "P2 行号换算到文档行（跳过的空行/注释行没算进去）",
  `line=${[...new Set(jpNotes.map((s) => s.line))].join(",")}`);

const WANT_JPW = ["1", "2", "3", "4", "5", "6", "7", "1"];
for (const i of [0, 1, 2, 5, 6, 7]) {
  await clickEl(`[data-test-note="${i}"]`);
  const s = await selection();
  ok(s.text === WANT_JPW[i], `点第 ${i + 1} 个音符 → 只选中 \`${WANT_JPW[i]}\``, `实得 \`${s.text}\``);
}

console.log("【P4】.jpwabc 光标 → 谱面高亮");
{
  // 把光标放进第 3 个音符（`3'`）的词素中间——**落在那个 `'` 上**，不是数字上。
  // 这一条守的正是「宽区间还在」：点选只选数字那一格，但光标停在词素的任何一格上都该点亮它。
  const src = jpNotes[2];
  const hit = await page.evaluate((s) => {
    const app = window.__app, view = app.view;
    const at = view.state.doc.line(s.line + 1).from + s.column + 1;
    view.dispatch({ selection: { anchor: at } });
    const el = document.querySelector('[data-test-note="2"]');
    const others = [...document.querySelectorAll("[data-test-note]")]
      .filter((e) => e !== el && e.classList.contains("selected")).length;
    return { on: el?.classList.contains("selected") ?? false, others };
  }, src);
  ok(hit.on, "光标落在 `3'` 里 → 该音符高亮");
  ok(hit.others === 0, "同一时刻只有一个音符高亮", `另有 ${hit.others} 个`);
}

console.log("【P6】.jpwabc 不只是音符：歌词 / 标题 / 词曲署名");
{
  const lyr = await clickShown("三");
  ok(lyr?.text === "三", "点歌词「三」→ 选中原文的「三」", `实得 \`${lyr?.text ?? "(没命中)"}\``);
  const ttl = await clickShown("点选测试");
  ok(ttl?.text === "点选测试", "点标题 → 选中 `Title =` 的值", `实得 \`${ttl?.text ?? "(没命中)"}\``);
  // 一条 `WordsByAndMusicBy` 靠 `\n` 拆成两行署名，两行都指回同一段原文
  const cre = await clickShown("张三 作词");
  ok(cre?.text === "张三 作词\\n李四 作曲", "点词曲署名 → 选中整条原文",
    `实得 \`${cre?.text ?? "(没命中)"}\``);
  const all = await tagged();
  ok(all.some((t) => t.shown === "李四 作曲" && t.src === "张三 作词\\n李四 作曲"),
    "第二行署名也指回同一段");
  // 调号拍号那一块是个 Group（`1=` / 音名 / 拍值两个数字 / 分数线），整块指回 KeyAndMeters
  ok(all.some((t) => t.src === "1=C,4/4"), "调号拍号 → 选中 `KeyAndMeters =` 的值",
    all.filter((t) => t.src.includes("=")).map((t) => t.src).join(" | "));
  ok(all.filter((t) => t.src === "|").length >= 1, "小节线也指回原文的 `|`");
}

console.log("【P5】展开档不联动");
{
  await page.evaluate(() => window.__app.setViewMode("expanded"));
  await page.waitForTimeout(400);
  const before = await selection();
  await page.evaluate(() => {
    const app = window.__app;
    const el = document.querySelector(".score-page g");
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent("click", {
      bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
    }));
  });
  const after = await selection();
  ok(before.from === after.from && before.to === after.to, "展开档点谱面不动源码选区");
  await page.evaluate(() => window.__app.setViewMode("original"));
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------- 文本谱
console.log("【P3】文本谱点谱面 → 选中源码");
await page.evaluate((t) => {
  window.__app.importBytes(new TextEncoder().encode(t), "pick-test.pu");
}, PU);
// 档位是两种格式**各记各的**（jpProfile / puProfile，见 app.ts::layoutMode），
// 切成文本谱之后要再切一次「原样」——简谱那边切过不算数。
await page.evaluate(() => window.__app.setViewMode("original"));
await page.waitForTimeout(600);

const puTags = await page.evaluate(() => {
  const els = [...document.querySelectorAll("[data-src-from]")];
  // 音符与歌词都打了标，按渲染出来的字挑出音符那一批
  const notes = els.filter((e) => /^[0-7]$/.test((e.textContent ?? "").trim()));
  notes.forEach((e, i) => e.setAttribute("data-test-note", String(i)));
  return { total: els.length, notes: notes.length };
});
ok(puTags.total === 18, "音符 8 + 歌词 8 + 标题 + 词曲，都打上了 data-src-*", `${puTags.total}/18`);
ok(puTags.notes === 8, "其中八个是音符", `${puTags.notes}/8`);

const WANT_PU = ["1", "2", "3", "4", "5", "6", "7", "1"];
for (const i of [0, 3, 4, 7]) {
  await clickEl(`[data-test-note="${i}"]`);
  const s = await selection();
  ok(s.text === WANT_PU[i], `点第 ${i + 1} 个音符 → 选中 \`${WANT_PU[i]}\``, `实得 \`${s.text}\``);
}

console.log("【P6】文本谱歌词 / 标题 / 词曲");
{
  const lyr = await clickShown("三");
  ok(lyr?.text === "三", "点歌词「三」→ 选中原文的「三」", `实得 \`${lyr?.text ?? "(没命中)"}\``);
  const ttl = await clickShown("点选测试");
  ok(ttl?.text === "点选测试", "点标题 → 选中 `B:` 的值", `实得 \`${ttl?.text ?? "(没命中)"}\``);
  const aut = await clickShown("张三 作词");
  ok(aut?.text === "张三 作词", "点词曲 → 选中 `Z:` 的值", `实得 \`${aut?.text ?? "(没命中)"}\``);
}

console.log("【P4】文本谱光标 → 谱面高亮");
{
  const hit = await page.evaluate(() => {
    const view = window.__app.view;
    const el = document.querySelector('[data-test-note="5"]'); // 第 6 个音符
    view.dispatch({ selection: { anchor: Number(el.getAttribute("data-src-from")) } });
    const others = [...document.querySelectorAll("[data-test-note]")]
      .filter((e) => e !== el && e.classList.contains("selected")).length;
    return { on: el?.classList.contains("selected") ?? false, others };
  });
  ok(hit.on, "光标落在第 6 个音符上 → 该音符高亮");
  ok(hit.others === 0, "同一时刻只有一个音符高亮", `另有 ${hit.others} 个`);
}

console.log("【P4】重排之后高亮还在（SVG 整棵重建过）");
{
  const still = await page.evaluate(async () => {
    const app = window.__app;
    app.reload(app.getText());               // 与实时重排同一条路
    await new Promise((r) => setTimeout(r, 200));
    return [...document.querySelectorAll("[data-src-from].selected")].length;
  });
  ok(still === 1, "重排后仍有且只有一个音符高亮", `实得 ${still}`);
}

console.log("【P7】点谁就高亮谁——相邻词素之间没有空格时也不许串到下一个");
{
  // `2_1)`、`|1'.`、`|(6_`：`.jpwabc` 里这类**紧挨着**的写法极常见，前一个词素的末尾
  // 正是后一个的起点。按选区 `head`（落在末尾）反查就会点亮**下一个**字，于是
  // 「右边高亮的字与左边选中的字对不上」，有没有空格决定它犯不犯，看着就是偶发。
  await page.evaluate((t) => window.__app.setText(t), [
    ".Title", "Title = 紧挨着的词素", "KeyAndMeters = 1=C,4/4",
    ".Voice", "1. 2_ 3__ |(6_ 5__ 3__ 2_1) |1'. |",
    ".Words", "W1:", "一二三四五六七",
  ].join("\n"));
  await page.evaluate(() => window.__app.setViewMode("original"));
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const els = [...document.querySelectorAll("[data-src-from]")];
    els.forEach((e, i) => e.setAttribute("data-pick7", String(i)));
    const bad = [];
    for (const e of els) {
      const r = e.getBoundingClientRect();
      e.dispatchEvent(new MouseEvent("click", {
        bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
      }));
      const hl = document.querySelector("[data-src-from].selected");
      if (hl !== e) {
        const st = window.__app.view.state, s = st.selection.main;
        bad.push(`选中\`${st.sliceDoc(s.from, s.to)}\`却高亮了\`${(hl?.textContent ?? "(无)").trim()}\``);
      }
    }
    return { n: els.length, bad };
  });
  ok(r.bad.length === 0, `逐个点这 ${r.n} 个图元，高亮都落在被点的那个上`, r.bad.slice(0, 3).join(" / "));
}

const fatal = errors.filter((e) => !/favicon|Failed to load resource/.test(e));
ok(fatal.length === 0, "无控制台错误", fatal.slice(0, 2).join(" | "));

await browser.close();
await close();
console.log(bad === 0 ? "\n全部通过" : `\n${bad} 条未通过`);
process.exit(bad === 0 ? 0 : 1);
