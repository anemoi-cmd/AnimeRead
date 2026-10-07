declare module "@vendor/foliate-js/*" {
  export function collapse(cfi: string, toEnd?: boolean): string;
  export class EPUB {
    constructor(loader: unknown);
    init(): Promise<unknown>;
  }
}
declare module "@vendor/page-flip/page-flip.module.js" {
  export class PageFlip {
    constructor(host: HTMLElement, settings: Record<string, unknown>);
    loadFromHTML(pages: HTMLElement[]): void;
    flipNext(corner?: "top" | "bottom"): void;
    flipPrev(corner?: "top" | "bottom"): void;
    getBoundsRect(): {
      left: number;
      top: number;
      width: number;
      height: number;
      pageWidth: number;
    };
    getRender(): {
      convertToGlobal(point: { x: number; y: number }): {
        x: number;
        y: number;
      };
    };
    getFlipController(): {
      start(point: { x: number; y: number }): boolean;
      fold(point: { x: number; y: number }): void;
      stopMove(): void;
    };
    on(event: string, callback: (event: { data: unknown }) => void): void;
    destroy(): void;
  }
}
