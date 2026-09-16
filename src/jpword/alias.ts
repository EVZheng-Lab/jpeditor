// `.Voice` 里演奏记号的**简写**：`{yy}` = `{YanYin}`（延音记号 fermata），另三个同理。
//
// 为什么要在文法之外做这一层：`Jpwabc.g4` 把这四个记号写死成字面量
// （`fragment Articulation: 'DunYin' | 'BoYin' | 'YanYin' | 'ZhongYin'`），
// 而 `src/jpword/parser/` 那几个文件是 ANTLR **生成**的（词法表是序列化的 ATN，
// 改不动、仓库里也没有重新生成的脚本，要 Java + antlr jar）。所以简写在**交给词法器之前**
// 展开成全名，词法/语法一个字都不用动。
//
// **展开会改变列号**（`{yy}` 4 格 → `{YanYin}` 8 格），而谱面点选、就地编辑、语法着色
// 全都按列号/下标对原文（见 `docs/实现/谱面就地编辑.md`）。所以展开的同时记一份账，
// 由 `origColumn` / `origOffset` 把词法器给的位置换回原文的位置。**别省这一步**——
// 省了的话，一行里只要有一个 `{yy}`，它后面所有音符的点选定位就整体偏 4 格。

/** 简写 → 文法里的全名。key 一律小写（匹配时不分大小写）。 */
export const ARTICULATION_ALIAS = new Map<string, string>([
  ["yy", "YanYin"],   // 延音记号 fermata ◠
  ["dy", "DunYin"],   // 顿音
  ["by", "BoYin"],    // 波音
  ["zy", "ZhongYin"], // 重音
]);

/** 写出去用哪种写法。**改这一个常量就能切回全名**——写简写的 `.jpwabc` 原版 JP-Word 读不了
 *  （它只认全名），要保持互通就把它设成 false。读取端两种一直都认，不受这里影响。 */
export const WRITE_SHORT_ARTICULATION = true;

/** 一处展开。位置**都是展开之后**那份文本里的，`delta` 是比原文长出来的格数。 */
export interface AliasEdit {
  /** 展开后文本里的绝对下标 */
  at: number;
  /** 段内行号（0 基） */
  line: number;
  /** 展开后该行内的列号（0 基） */
  col: number;
  /** 展开后这一段的字符数 */
  len: number;
  /** 展开后比原文长了几格 */
  delta: number;
}

/** 两个字母的简写，可以逗号并列（`{yy,zy}`，文法允许 `Articulation (',' Articulation)*`）。 */
const ALIAS_RE = /\{([A-Za-z]{2}(?:,[A-Za-z]{2})*)\}/g;

/** 把 `.Voice` 文本里的简写展开成全名。没有简写时原样返回（`edits` 为空 = 两个换算都是恒等）。 */
export function expandVoiceAliases(text: string): { text: string; edits: AliasEdit[] } {
  if (!text.includes("{")) return { text, edits: [] };
  const edits: AliasEdit[] = [];
  const lines = text.split("\n");
  const out: string[] = [];
  let base = 0; // 展开后文本里这一行的起点
  for (let ln = 0; ln < lines.length; ln++) {
    const src = lines[ln];
    let dst = "";
    let last = 0;
    let m: RegExpExecArray | null;
    ALIAS_RE.lastIndex = 0;
    while ((m = ALIAS_RE.exec(src)) !== null) {
      const names = m[1].split(",").map((c) => ARTICULATION_ALIAS.get(c.toLowerCase()));
      // 有一个认不出就整段不动——`{ab}` 之类不是简写，留给词法器照原样处置
      if (names.some((n) => n === undefined)) continue;
      const full = `{${names.join(",")}}`;
      dst += src.slice(last, m.index);
      const col = dst.length;
      edits.push({ at: base + col, line: ln, col, len: full.length, delta: full.length - m[0].length });
      dst += full;
      last = m.index + m[0].length;
    }
    dst += src.slice(last);
    out.push(dst);
    base += dst.length + 1; // +1 = 那个 "\n"
  }
  return { text: out.join("\n"), edits };
}

/** 展开后的（段内行号, 列号）→ 原文列号。 */
export function origColumn(edits: AliasEdit[], line: number, col: number): number {
  let d = 0;
  for (const e of edits) if (e.line === line && e.col + e.len <= col) d += e.delta;
  return col - d;
}

/** 展开后的绝对下标 → 原文绝对下标。 */
export function origOffset(edits: AliasEdit[], at: number): number {
  let d = 0;
  for (const e of edits) if (e.at + e.len <= at) d += e.delta;
  return at - d;
}
