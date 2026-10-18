import { clear, focusFirst, h, keyToNav, moveFocus } from '@cloudsea/ui';

/**
 * 界面根：HUD 层、提示、模态窗口栈、对话框。
 * 模态窗口打开时接管键盘（焦点导航）；关闭后回到游戏操作。
 */
export class UiRoot {
  readonly root: HTMLElement;
  readonly hudTL = h('div', { id: 'hud-tl' });
  readonly hudTR = h('div', { id: 'hud-tr' });
  readonly partyBar = h('div', { id: 'party-bar' });
  readonly prompt = h('div', { id: 'prompt' });
  readonly hints = h('div', { id: 'hints' });
  readonly toasts = h('div', { id: 'toasts' });
  readonly tutorial = h('div', { id: 'tutorial', class: 'hidden' });
  readonly layer = h('div', { id: 'layer' });
  private readonly modal = h('div', { id: 'modal', class: 'hidden' });
  private readonly dialogueBox = h('div', { id: 'dialogue', class: 'hidden' });
  private modalStack: Array<{ render: () => HTMLElement; onClose?: () => void }> = [];
  private dialogueQueue: Array<{ who: string; lines: string[]; title?: string; done?: () => void; generated?: { onBlock: (line: string) => void } }> = [];
  private dialogueIndex = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    root.append(this.layer, this.hudTL, this.hudTR, this.partyBar, this.prompt, this.hints, this.tutorial, this.toasts, this.modal, this.dialogueBox);
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    this.modal.addEventListener('pointerdown', (e) => {
      if (e.target === this.modal) this.closeModal();
    });
  }

  get modalOpen(): boolean {
    return this.modalStack.length > 0;
  }

  get dialogueOpen(): boolean {
    return this.dialogueQueue.length > 0;
  }

  /** 是否有界面接管了输入（游戏里不该再处理移动等按键）。 */
  get capturing(): boolean {
    return this.modalOpen || this.dialogueOpen;
  }

  toast(text: string, kind: 'info' | 'error' = 'info'): void {
    const t = h('div', { class: `toast ${kind === 'error' ? 'error' : ''}` }, text);
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
    setTimeout(() => t.remove(), kind === 'error' ? 3200 : 2600);
  }

  /** 打开模态窗口；render 每次刷新时重新调用（数据变了就 refresh()）。 */
  openModal(render: () => HTMLElement, onClose?: () => void): void {
    this.modalStack.push({ render, ...(onClose ? { onClose } : {}) });
    this.refresh(true);
  }

  /** 替换栈顶窗口（例如从列表进入详情后再返回）。 */
  replaceModal(render: () => HTMLElement): void {
    const top = this.modalStack[this.modalStack.length - 1];
    if (top) top.render = render;
    this.refresh(true);
  }

  closeModal(): void {
    const top = this.modalStack.pop();
    top?.onClose?.();
    this.refresh(true);
  }

  closeAllModals(): void {
    while (this.modalStack.length) this.closeModal();
  }

  /** 重新渲染栈顶窗口，尽量保持焦点位置。 */
  refresh(resetFocus = false): void {
    const top = this.modalStack[this.modalStack.length - 1];
    if (!top) {
      this.modal.classList.add('hidden');
      clear(this.modal);
      return;
    }
    const activeKey = (document.activeElement as HTMLElement | null)?.dataset?.['key'];
    const scroll = (this.modal.firstElementChild as HTMLElement | null)?.scrollTop ?? 0;
    clear(this.modal);
    const el = top.render();
    this.modal.append(el);
    this.modal.classList.remove('hidden');
    if (!resetFocus) el.scrollTop = scroll;
    const again = activeKey ? this.modal.querySelector<HTMLElement>(`[data-key="${CSS.escape(activeKey)}"]`) : null;
    if (again && !resetFocus) again.focus();
    else focusFirst(this.modal);
  }

  /** generated：AI 生成的话（灵性模式，M3-4）：标出来，并给一个“屏蔽这句”。 */
  say(who: string, lines: readonly string[], title?: string, done?: () => void, generated?: { onBlock: (line: string) => void }): void {
    this.dialogueQueue.push({ who, lines: [...lines], ...(title ? { title } : {}), ...(done ? { done } : {}), ...(generated ? { generated } : {}) });
    if (this.dialogueQueue.length === 1) {
      this.dialogueIndex = 0;
      this.renderDialogue();
    }
  }

  private renderDialogue(): void {
    const cur = this.dialogueQueue[0];
    clear(this.dialogueBox);
    if (!cur) {
      this.dialogueBox.classList.add('hidden');
      return;
    }
    const last = this.dialogueIndex >= cur.lines.length - 1 && this.dialogueQueue.length === 1;
    this.dialogueBox.append(
      h(
        'div',
        { class: 'panel', onclick: () => this.advanceDialogue() },
        h('div', { class: 'who' }, cur.title ? `${cur.who} ·「${cur.title}」` : cur.who, cur.generated ? h('span', { class: 'gen-tag', title: '灵性模式：这句话由你配置的 AI 服务实时生成' }, 'AI 生成') : null),
        h('div', { class: 'line' }, cur.lines[this.dialogueIndex] ?? ''),
        cur.generated
          ? h('button', { class: 'gen-block', onclick: (e: Event) => {
              e.stopPropagation();
              cur.generated!.onBlock(cur.lines[this.dialogueIndex] ?? '');
              this.advanceDialogue();
            } }, '不合适？屏蔽这句')
          : null,
        h('div', { class: 'more' }, last ? '〔Enter / 点击 关闭〕' : '〔Enter / 点击 继续〕'),
      ),
    );
    this.dialogueBox.classList.remove('hidden');
  }

  advanceDialogue(): void {
    const cur = this.dialogueQueue[0];
    if (!cur) return;
    this.dialogueIndex++;
    if (this.dialogueIndex >= cur.lines.length) {
      this.dialogueQueue.shift();
      this.dialogueIndex = 0;
      cur.done?.();
    }
    this.renderDialogue();
  }

  /** 一口气翻完所有对话（测试与场景直达用；对话结束的回调照常执行）。 */
  skipDialogues(): void {
    for (let i = 0; i < 200 && this.dialogueOpen; i++) this.advanceDialogue();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.dialogueOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'e' || e.key === 'E' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.advanceDialogue();
      }
      return;
    }
    if (!this.modalOpen) return;
    const target = e.target as HTMLElement | null;
    if (target?.tagName === 'INPUT' && e.key !== 'Escape' && e.key !== 'Enter') return;
    const nav = keyToNav(e);
    if (!nav && e.key !== 'Tab') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Tab' || nav === 'back') {
      this.closeModal();
      return;
    }
    if (nav === 'confirm') {
      (document.activeElement as HTMLElement | null)?.click();
      return;
    }
    if (nav) moveFocus(this.modal, nav);
  }
}
