// `.Voice` 演奏记号**简写**（`{yy}` = `{YanYin}`）的回归。
//
//   npm run build && node scripts/alias-check.mjs
//
// 简写是在交给 ANTLR 词法器**之前**展开的（`src/jpword/alias.ts`），展开会把那一行后面的
// 列号整体往后挪 4 格，所以这一篇的重头不是"认不认"，而是**挪了之后各处位置还对不对**：
//   A1 `{yy}5` 画出延音记号，全名 `{YanYin}5` 照样认
//   A2 写在数字后面（`5{yy}`）不算数——与从前 `5{YanYin}` 的行为一致，不静悄悄地变认
//   A3 **点选定位不偏**：同一行里 `{yy}` 后面的每个音符，点了都选中自己那一段原文
//   A4 **语法着色不错位**：token 流逐字符连续（`.Voice` 那段的着色长度 = 原文长度）
//   A5 就地编辑敲得进去：把一个音符改成 `{yy}5` 能提交（`countVoiceSyntaxErrors` 也要展开）
//   A6 写出去的是简写：Score → .jpwabc 文本里是 `{yy}`
import { serveDist, launchPage, loadApp } from "./harness.mjs";

const mk = (voice) => [
  ".Title", "Title = 简写", "KeyAndMeters = 1=C,4/4",
  ".Voice", voice, ".Words", "W1:", "一二三四五六七八",
].join("\n");

let bad = 0;
const ok = (cond, name, detail) => {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? `　${detail}` : ""}`);
  if (!cond) bad++;
};

const { port, close } = await serveDist();
const { browser, page, errors } = await launchPage({ viewport: { width: 1500, height: 950 }, quiet: true });
await loadApp(page, port, { reveal: true });
await page.evaluate(() => window.__app.setViewMode("original"));

const load = async (voice) => {
  await page.evaluate((t) => window.__app.setText(t), mk(voice));
  await page.waitForTimeout(500);
};
/** 谱面上有几个延音记号（fermata 是个单独的字形，走 Chord.fermata）。 */
const fermatas = () => page.evaluate(() => {
  let n = 0;
  for (const m of window.__app.painter.score.parts[0].measures)
    for (const e of m.entries) if (e.fermata) n++;
  return n;
});

console.log("【A1】两种写法都认");
for (const [name, voice, want] of [
  ["简写 {yy}", "1 2 3 4 |{yy}5 - - - |", 1],
  ["全名 {YanYin}", "1 2 3 4 |{YanYin}5 - - - |", 1],
  ["并列 {yy,zy}", "1 2 3 4 |{yy,zy}5 - - - |", 1],
  ["大写 {YY}", "1 2 3 4 |{YY}5 - - - |", 1],
  ["没写", "1 2 3 4 |5 - - - |", 0],
]) {
  await load(voice);
  ok((await fermatas()) === want, `${name} → ${want} 个延音记号`, `实得 ${await fermatas()}`);
}

console.log("【A2】写在数字后面不算数（与全名一致，不静悄悄地变认）");
await load("1 2 3 4 |5{yy} - - - |");
ok((await fermatas()) === 0, "`5{yy}` 不产生延音记号");

console.log("【A3】点选定位不偏（简写后面的音符照样选中自己那一段）");
await load("1 2 {yy}3 4 5 |6 7 1' 2' |");
{
  // 整行逐个对：位置偏了的话这一串会整体串位（`{yy}3` 之后每个都偏 4 格）
  const WANT = ["1", "2", "{yy}3", "4", "5", "|", "6", "7", "1'", "2'", "|"];
  const got = await page.evaluate(() => {
    const st = window.__app.view.state;
    return [...document.querySelectorAll("[data-src-from]")]
      .map((e) => st.sliceDoc(Number(e.getAttribute("data-src-from")), Number(e.getAttribute("data-src-to"))))
      .filter((s) => /^[0-9{|]/.test(s) && !s.includes("=")); // 音符与小节线；调号拍号那块也以 1 打头，排掉
  });
  ok(JSON.stringify(got) === JSON.stringify(WANT), "整行每个词素都指回自己那一段原文",
    got.join(" "));
  const hit = await page.evaluate(() => {
    const el = [...document.querySelectorAll("[data-src-from]")]
      .find((e) => (e.textContent ?? "").trim().startsWith("3"));
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
    const st = window.__app.view.state, s = st.selection.main;
    return st.sliceDoc(s.from, s.to);
  });
  ok(hit === "3", "点带简写的那个音符 → 只选中数字那一格（简写不跟着选）", `实得 \`${hit}\``);
}

console.log("【A4】语法着色不错位");
{
  // `.note` 是音符的着色类（styles.css）。偏了的话它会罩在别的字上、或者长度对不上。
  const r = await page.evaluate(() => {
    const line = [...document.querySelectorAll(".cm-line")]
      .find((l) => l.textContent.includes("{yy}"));
    return {
      text: line?.textContent ?? "",
      notes: [...(line?.querySelectorAll(".note") ?? [])].map((s) => s.textContent),
    };
  });
  ok(r.text.includes("{yy}3"), "代码区里就是原文那几个字", r.text.trim());
  ok(JSON.stringify(r.notes) === JSON.stringify(["1", "2", "{yy}3", "4", "5", "6", "7", "1'", "2'"]),
    "音符的着色区间逐个对得上", r.notes.join(" "));
}

console.log("【A5】就地编辑敲得进去");
await load("1 2 3 4 |5 6 7 1' |");
{
  const opened = await page.evaluate(() => {
    const el = [...document.querySelectorAll("[data-src-from]")]
      .find((e) => (e.textContent ?? "").trim().startsWith("5"));
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    el.dispatchEvent(new MouseEvent("click", at));
    el.dispatchEvent(new MouseEvent("dblclick", at));
    return document.querySelector(".inline-edit")?.value ?? null;
  });
  ok(opened === "5", "双击音符 → 初值 `5`", `实得 \`${opened}\``);
  await page.evaluate(() => {
    const input = document.querySelector(".inline-edit");
    input.value = "{yy}5";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => ({
    text: window.__app.getText(),
    open: !!document.querySelector(".inline-edit"),
  }));
  ok(st.text.includes("{yy}5"), "提交进去了（没被『会让整篇解析不了』那道闸拦下）",
    st.open ? "输入框还留着 = 被拦了" : "");
  ok((await fermatas()) === 1, "谱面上出现了延音记号");
}

console.log("【A6】写出去的是简写");
{
  const out = await page.evaluate(async () => {
    const x = await window.__xmlout;
    const f = x.JpwFile.fromString(window.__app.getText());
    return x.scoreToJpwabc(x.fromJpw(f));
  });
  ok(out.includes("{yy}"), "Score → .jpwabc 文本里是 `{yy}`",
    out.split("\n").find((l) => l.includes("{yy}")) ?? out.split("\n").find((l) => l.includes("YanYin")) ?? "(都没有)");
}

const fatal = errors.filter((e) => !/favicon|Failed to load resource/.test(e));
ok(fatal.length === 0, "无控制台错误", fatal.slice(0, 2).join(" | "));

await browser.close();
await close();
console.log(bad === 0 ? "\n全部通过" : `\n${bad} 条未通过`);
process.exit(bad === 0 ? 0 : 1);
