// Thin wrapper over the ANTLR-generated lexer/parser (faithful to Jpwabc.g4).
// Mirrors VoiceSection.parse() in jpwfile.kt.

import { CharStream, CommonTokenStream } from "antlr4";
import type { ErrorListener } from "antlr4";
import JpwabcLexer from "./parser/JpwabcLexer.js";
import JpwabcParser, { VoiceContext } from "./parser/JpwabcParser.js";
import { expandVoiceAliases } from "./alias";

/** Parse a .Voice section body into the ANTLR VoiceContext (entry* tree).
 *
 *  **先展开演奏记号的简写**（`{yy}` → `{YanYin}`，见 `alias.ts`）：文法里那四个名字是写死的
 *  字面量，而生成出来的词法器改不动。展开会让列号往后挪，要拿 token 位置回指原文的地方
 *  （`VoiceSection.origColumn`）自己换算。 */
export function parseVoiceText(text: string): VoiceContext | null {
  const chars = new CharStream(expandVoiceAliases(text).text);
  const lexer = new JpwabcLexer(chars);
  lexer.removeErrorListeners();
  const tokens = new CommonTokenStream(lexer);
  const parser = new JpwabcParser(tokens);
  parser.removeErrorListeners();
  try {
    const voice = parser.voice();
    // require full consumption (mirrors strm.index()!=strm.size() check)
    if (chars.index !== chars.size) return null;
    return voice;
  } catch {
    return null;
  }
}

export { JpwabcLexer, JpwabcParser };
export type { VoiceContext };

/**
 * **只给校验用**：同一套词法/语法，但把报错收下来数一数。
 *
 * 正式那条（`parseVoiceText`）故意 `removeErrorListeners()` 并靠 ANTLR 的错误恢复兜底
 * ——存量谱面里有不少写法过不了严格检查却排得出来，那条**不能改**。可就地编辑那边
 * 需要一个「这次改动把谱改坏了没有」的信号：`JpwFile.fromString` 太宽（`@` `{` `abc`
 * 塞进 `.Voice` 都照样返回非 null，音符却已经悄悄没了），只有错误计数看得出来。
 *
 * 用法是**比较**而不是归零：拿改动前后各数一遍，变多了才拦（见 `App.validate`）。
 */
export function countVoiceSyntaxErrors(text: string): number {
  let n = 0;
  const listener = {
    syntaxError: (): void => { n += 1; },
  } as unknown as ErrorListener<unknown>;
  // 与 parseVoiceText 同一条起跑线：简写不展开的话 `{yy}` 会被数成若干个词法错误，
  // 于是「比较」那道闸把一次合法的改动拦下来（就地编辑敲 `{yy}5` 提交不了）。
  const chars = new CharStream(expandVoiceAliases(text).text);
  const lexer = new JpwabcLexer(chars);
  lexer.removeErrorListeners();
  lexer.addErrorListener(listener as never);
  const tokens = new CommonTokenStream(lexer);
  const parser = new JpwabcParser(tokens);
  parser.removeErrorListeners();
  parser.addErrorListener(listener as never);
  try {
    parser.voice();
  } catch {
    return n + 1;
  }
  if (chars.index !== chars.size) n += 1;
  return n;
}
