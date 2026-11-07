declare global {
  interface Performance {
    readonly memory?: { readonly usedJSHeapSize: number; readonly totalJSHeapSize: number }
  }
}

export {}
