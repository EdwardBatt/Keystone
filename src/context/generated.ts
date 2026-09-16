/** Generated locations established by the target layout and STATE.md template.
 * config.yaml is authoritative input, even though it lives beside generated state.
 * This classification does not create any later-phase outputs.
 */
export function isGeneratedPath(relative: string): boolean {
  const name = relative.toLowerCase();
  return name === 'context/state.md' || name === '.context' ||
    name.startsWith('.context/') && name !== '.context/config.yaml';
}
