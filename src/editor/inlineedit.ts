// 谱面**就地编辑**：在排好的谱面上双击一个音符/歌词/标题，原地弹一个输入框改它，
// 提交后把改动落回源码（见 docs/实现/谱面就地编辑.md 的「第二步」）。
//
// **源码是唯一真相**：这里不维护任何"谱面侧的编辑状态"，一次提交 = 一次
// `view.dispatch({ changes })`，随后由现有的实时重排把谱面重画。撤销也因此是
// CodeMirror 自己的撤销，不必另建撤销栈。
//
// 要编辑的那一段是哪一段，由 `<g>` 上的 `data-src-from/to` 说了算——那是铺页时
// 由 `App._tagSources` 照 `PageItem.source` 打的，与点选联动同一份账。

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface InlineEditHost {
  /** 改动最终落在它上面。 */
  readonly view: EditorView;
  /** 整篇试解析一遍。false = 这次改动会让谱面**整个排不出来**，不许提交。
   *  判据只有这一条（见那篇的「提交前先验」）——再严就会挡住合法的中间态。 */
  validate(text: string): boolean;
  /** 提交成功 / 被拦下时给用户的一句话。 */
  setStatus(s: string): void;
}

/** 输入框最小宽度（px）。窄到一个字的音符也得点得着、看得见光标。 */
const MIN_WIDTH = 44;

/** 这个图元「点选 / 就地编辑」落在原文的哪一段。
 *
 *  两套属性由 `App._tagSources` 打：`data-src-*` 是**宽**区间（整个词素，命中与光标联动用），
 *  `data-src-edit-*` 是**窄**区间（音符只有数字那一格）。这里一律取窄的、没有才退回宽的
 *  ——用户点的是那个数字，改它不该连带把 `_` 减时线、`,` 八度逗号一起换掉。 */
export function editRangeOf(g: Element): { from: number; to: number } | null {
  const pick = (a: string, b: string): { from: number; to: number } | null => {
    if (!g.hasAttribute(a) || !g.hasAttribute(b)) return null;
    const from = Number(g.getAttribute(a));
    const to = Number(g.getAttribute(b));
    return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : null;
  };
  return pick("data-src-edit-from", "data-src-edit-to") ?? pick("data-src-from", "data-src-to");
}

export class InlineEditor {
  private input: HTMLInputElement | null = null;
  /** 正在编辑的那一段源码。**提交时按它取当前文本**——期间没有别的东西会动文档。 */
  private range: { from: number; to: number } | null = null;
  /** 正在自己收尾，别让 blur 再进来一次。 */
  private closing = false;

  constructor(private host: InlineEditHost) {}

  get active(): boolean {
    return this.input !== null;
  }

  /** 在这个图元上原地开一个输入框。`g` 要带 `data-src-from/to`（有 `data-src-edit-*` 时优先用它）。 */
  open(g: SVGGElement): void {
    const range = editRangeOf(g);
    if (!range) return;
    const { from, to } = range;
    const wrap = g.closest(".score-page-wrap") as HTMLElement | null;
    if (!wrap) return;
    this.close();

    const r = g.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const input = document.createElement("input");
    input.className = "inline-edit";
    input.value = this.host.view.state.sliceDoc(from, to);
    input.spellcheck = false;
    // 贴在那个图元身上：位置照它的**屏幕**包围盒换算到页元素的局部坐标
    // （页元素是 `position: relative` 的，见 styles.css::.score-page-wrap）。
    input.style.left = `${r.left - wr.left}px`;
    input.style.top = `${r.top - wr.top}px`;
    input.style.height = `${Math.max(r.height, 18)}px`;
    input.style.width = `${Math.max(r.width * 1.6, MIN_WIDTH)}px`;
    // 字号跟着谱面缩放走，不然放大之后输入框是个小豆子
    input.style.fontSize = `${Math.min(Math.max(r.height * 0.62, 11), 26)}px`;

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.commit(); }
      else if (e.key === "Escape") { e.preventDefault(); this.close(); }
      // 别让方向键/退格冒泡出去被谱面或全局快捷键截走
      e.stopPropagation();
    });
    input.addEventListener("blur", () => { if (!this.closing) this.commit(); });

    wrap.appendChild(input);
    this.input = input;
    this.range = { from, to };
    input.focus();
    input.select();
    this.host.setStatus("就地编辑：回车提交，Esc 取消");
  }

  close(): void {
    if (!this.input) return;
    this.closing = true;
    this.input.remove();
    this.input = null;
    this.range = null;
    this.closing = false;
  }

  private commit(): void {
    const input = this.input, range = this.range;
    if (!input || !range) return;
    const view = this.host.view;
    const next = input.value;
    const cur = view.state.sliceDoc(range.from, range.to);
    if (next === cur) { this.close(); return; }

    const doc = view.state.doc.toString();
    const candidate = doc.slice(0, range.from) + next + doc.slice(range.to);
    if (!this.host.validate(candidate)) {
      // **不写进文档**：写进去谱面会整个空白，而用户手上没有回头路。
      // 标红、把焦点留住，让他接着改或按 Esc 退掉。
      input.classList.add("bad");
      this.host.setStatus("这样改之后整篇谱解析不了，没有提交（Esc 取消）");
      this.closing = true;
      input.focus();
      this.closing = false;
      return;
    }
    // 先收掉输入框：重排会把整棵页面树换掉，输入框挂在页元素上会跟着没。
    this.close();
    // 选区落在改完的那一段上——重排之后 `App._syncScoreToCursor` 会照它把高亮重新点上。
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: next },
      selection: EditorSelection.single(range.from, range.from + next.length),
    });
    this.host.setStatus("");
  }
}
