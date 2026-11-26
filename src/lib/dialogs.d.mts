export type DialogTone = "default" | "danger";
export type DialogOpts = { title: string; body?: string; confirmLabel?: string; cancelLabel?: string; tone?: DialogTone; icon?: string };
export type DialogRequest = { id: number; kind: "confirm" | "notice"; opts: DialogOpts };
export type Dialogs = {
  subscribe(fn: () => void): () => void;
  current(): DialogRequest | null;
  confirm(opts: DialogOpts): Promise<boolean>;
  notice(opts: Omit<DialogOpts, "cancelLabel">): Promise<void>;
  settle(value: boolean): void;
};
export function createDialogs(): Dialogs;
export function keyAction(e: { key: string; repeat?: boolean; onCancelButton?: boolean }): "confirm" | "cancel" | null;
export function nextFocus(i: number, n: number, backwards: boolean): number;
