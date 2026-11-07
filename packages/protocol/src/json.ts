// SAFETY: only for formats we write ourselves or that a pinned schema describes. The caller names the shape and reads every optional field defensively.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
export const decodeTrusted = <T>(text: string): T =>
  // oxlint-disable-next-line typescript/no-unsafe-return
  JSON.parse(text)
