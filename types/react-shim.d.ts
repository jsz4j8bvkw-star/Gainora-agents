// Minimal React type declarations so the app can be type-checked offline.
// If @types/react is installed later, delete this file.
declare module 'react' {
  export type ReactNode = any;
  export type Key = string | number;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export interface FC<P = {}> { (props: P & { children?: ReactNode }): any }
  export interface RefObject<T> { current: T | null }
  export interface MutableRefObject<T> { current: T }
  export interface ChangeEvent<T = any> { target: T & { value: string; checked: boolean } }
  export interface FormEvent<T = any> { preventDefault(): void; target: T }
  export interface KeyboardEvent<T = any> { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; preventDefault(): void; target: T }
  export interface MouseEvent<T = any> { preventDefault(): void; stopPropagation(): void; metaKey: boolean; ctrlKey: boolean; button: number; target: T }
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly any[]): T;
  export function useCallback<T extends (...args: any[]) => any>(cb: T, deps: readonly any[]): T;
  export function useRef<T>(initial: T): MutableRefObject<T>;
  export function useRef<T>(initial: T | null): RefObject<T>;
  export function useContext<T>(ctx: Context<T>): T;
  export function useId(): string;
  export interface Context<T> { Provider: any; Consumer: any; _t?: T }
  export function createContext<T>(value: T): Context<T>;
  export const Fragment: any;
  export const StrictMode: any;
  const React: { Fragment: any; StrictMode: any };
  export default React;
}
declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare module 'react-dom' {
  export function createPortal(children: any, container: Element): any;
}
declare module 'react-dom/client' {
  export function createRoot(el: Element): { render(node: any): void };
}
declare namespace JSX {
  interface Element { }
  interface IntrinsicElements { [name: string]: any }
  interface ElementChildrenAttribute { children: {} }
  interface IntrinsicAttributes { key?: string | number }
}
