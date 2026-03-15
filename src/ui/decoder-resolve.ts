export type ResolvedDecoder =
  | { kind: 'bundled'; name: string }
  | { kind: 'user'; name: string; source: string };

interface UserDecoderEntry {
  name: string;
  source: string;
}

export function resolveDecoder(
  decoderName: string | undefined,
  bundledNames: string[],
  userDecoders: UserDecoderEntry[],
): ResolvedDecoder | null {
  if (!decoderName) return null;

  const user = userDecoders.find(d => d.name === decoderName);
  if (user) return { kind: 'user', name: user.name, source: user.source };

  if (bundledNames.includes(decoderName)) return { kind: 'bundled', name: decoderName };

  return null;
}
